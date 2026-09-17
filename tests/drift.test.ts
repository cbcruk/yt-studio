/**
 * Checks whether we have drifted from the real yt-dlp.
 *
 * Every other test runs **inside the 2026.07.04 snapshot** — the committed schema,
 * the committed help, and a stub yt-dlp that `cat`s that help. So they are
 * deterministic and say exactly what my change broke. In exchange **they cannot
 * see change coming from outside.**
 *
 * This repo's claim is "look at the real thing, not memory"; tests that only look
 * at memory would contradict it. Here we install the real yt-dlp and ask.
 *
 * - Does the help parser read **today's** yt-dlp format?
 * - Does `gen_schema.py` run on **today's** yt-dlp?
 * - Does `yt-studio types` go all the way against the real thing?
 *
 * Not run on every PR. If a yt-dlp release turns someone else's PR red, that is
 * not an alert but an obstruction. A scheduled job (`.github/workflows/drift.yml`)
 * installs yt-dlp and runs it. **Without yt-dlp the whole file is skipped** — so
 * a plain `bun test` does not break.
 *
 * The committed schema being older than the latest is not a failure in itself —
 * that is always the case. It fails **only when the machinery is broken**.
 */
import { afterAll, beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import { parseHelp } from '../src/core/help-schema.js';
import type { HelpResult } from '../src/core/help-schema.js';
import type { Opt, RawSchema } from '../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const PYTHON = process.env.PYTHON_BIN || 'python3';

const BASE: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'yt-studio.schema.json'), 'utf8'));

/** Is yt-dlp available? skipIf is read at definition time, so decide at module top level. */
const version = ((): string | null => {
  try {
    return execFileSync(YTDLP, ['--version'], { encoding: 'utf8', stdio: 'pipe' })
      .trim().split('\n')[0]!.trim();
  } catch { return null; }
})();

const skip = version === null;
const live = test.skipIf(skip);

let parsed: HelpResult;
let optparse: RawSchema;

beforeAll(() => {
  if (skip) return;
  const help = execFileSync(YTDLP, ['--help'], { encoding: 'utf8', maxBuffer: 8 << 20 });
  // If this breaks, the repo cannot extract a schema at the next release
  optparse = JSON.parse(execFileSync(PYTHON, [path.join(ROOT, 'gen_schema.py')],
    { encoding: 'utf8', maxBuffer: 32 << 20 }));
  parsed = parseHelp(help, version!, BASE);
});

live(`gen_schema.py 가 지금 yt-dlp 에서 돈다`, () => {
  assert.equal(optparse.ytdlp_version, version);
  assert.ok(optparse.options.length > 0, 'optparse 리플렉션이 비었다');
});

live('도움말 파서가 optparse 와 같은 개수를 읽는다', () => {
  assert.equal(parsed.schema.options.length, optparse.options.length);
});

// Known options must not differ by a single character. New options are excluded:
// what help cannot give (choices · hidden aliases · repeatable) has nowhere to inherit from.
const FULL: Array<keyof Opt> =
  ['id', 'short', 'aliases', 'stage', 'group', 'kind', 'metavar', 'choices', 'negation', 'help'];
const HELP_ONLY: Array<keyof Opt> = ['id', 'short', 'group', 'metavar', 'negation', 'help'];

live('필드까지 같다 — 아는 옵션은 완전 일치, 새 옵션은 도움말이 주는 만큼', () => {
  const liveBy = new Map(optparse.options.map(o => [o.flag, o]));
  const baseBy = new Map(BASE.options.map(o => [o.flag, o]));
  const bad: string[] = [];

  for (const o of parsed.schema.options) {
    const want = liveBy.get(o.flag);
    if (!want) { bad.push(`${o.flag}: optparse 에 없는데 도움말에서 읽혔다`); continue; }
    for (const k of baseBy.has(o.flag) ? FULL : HELP_ONLY) {
      if (JSON.stringify(o[k]) !== JSON.stringify(want[k])) {
        bad.push(`${o.flag} [${k}]  파서 ${JSON.stringify(o[k])}  실물 ${JSON.stringify(want[k])}`);
      }
    }
  }
  assert.deepEqual(bad, [], `도움말 파서가 optparse 와 어긋난다\n  ${bad.join('\n  ')}`);
});

live('yt-studio types 가 실물로 끝까지 간다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-studio-drift-'));
  writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
  try {
    const out = execFileSync('node', [CLI, 'types', '--yt-dlp', YTDLP], {
      cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NO_COLOR: '1' },
    });
    console.log(out.trimEnd().split('\n').map(l => `      ${l}`).join('\n'));
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    assert.fail(`실물에서 실패했다\n${((e.stdout || '') + (e.stderr || '')).trim()}`);
  }
});

// The committed schema lagging behind is routine, so it is not a failure. Only report it.
afterAll(() => {
  if (skip) {
    console.log(`  · yt-dlp 가 없어 건너뛰었다 (${YTDLP}) — 정기 잡에서 깔고 돌린다`);
    return;
  }
  const liveBy = new Map(optparse.options.map(o => [o.flag, o]));
  const baseBy = new Map(BASE.options.map(o => [o.flag, o]));
  const added = optparse.options.filter(o => !baseBy.has(o.flag)).map(o => o.flag);
  const removed = BASE.options.filter(o => !liveBy.has(o.flag)).map(o => o.flag);

  if (BASE.ytdlp_version === version && !added.length && !removed.length) {
    console.log(`  · 커밋된 스키마가 최신이다 (${version})`);
    return;
  }
  console.log(`  · 커밋된 스키마 ${BASE.ytdlp_version} · 실물 ${version} — 새로 ${added.length} · 사라짐 ${removed.length}`);
  if (added.length) console.log(`      새 옵션: ${added.join(' ')}`);
  if (removed.length) console.log(`      사라진 옵션: ${removed.join(' ')}`);
  console.log('      다시 뽑으려면: python3 gen_schema.py > yt-studio.schema.json && bun run gen:types');
});
