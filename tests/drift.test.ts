/**
 * 실물 yt-dlp 와 벌어졌는지 본다.
 *
 * 나머지 검사는 전부 **2026.07.04 스냅샷 안에서** 돈다 — 커밋된 스키마,
 * 커밋된 도움말, 그 도움말을 `cat` 하는 껍데기 yt-dlp. 그래서 결정적이고,
 * 내 변경이 뭘 깼는지 정확히 말한다. 대신 **바깥에서 오는 변화는 못 본다.**
 *
 * 이 저장소가 내건 문장이 "기억이 아니라 실물을 본다"인데 검사가 기억만 보고
 * 있으면 앞뒤가 안 맞는다. 여기서 진짜 yt-dlp 를 깔고 묻는다.
 *
 *   · 도움말 파서가 **지금** yt-dlp 의 서식을 읽는가
 *   · `gen_schema.py` 가 **지금** yt-dlp 에서 도는가
 *   · `ytstudio types` 가 실물을 상대로 끝까지 가는가
 *
 * PR 마다 돌리지 않는다. yt-dlp 릴리스 때문에 남의 PR 이 빨개지면 그건 알림이
 * 아니라 방해다. 정기 잡(`.github/workflows/drift.yml`)이 yt-dlp 를 깔고
 * 돌린다. **yt-dlp 가 없으면 통째로 건너뛴다** — 그래야 `bun test` 를 그냥
 * 쳐도 안 깨진다.
 *
 * 커밋된 스키마가 최신보다 낡은 것 자체는 실패가 아니다 — 그건 늘 그렇다.
 * 실패는 **기계가 고장 났을 때**뿐이다.
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

const BASE: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'ytstudio.schema.json'), 'utf8'));

/** yt-dlp 가 있나. skipIf 는 정의 시점에 읽히므로 모듈 최상단에서 정한다. */
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
  // 이게 깨지면 저장소가 다음 릴리스에 스키마를 못 뽑는다는 뜻이다
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

// 아는 옵션은 한 글자도 달라선 안 된다. 새 옵션은 도움말이 못 주는 것
// (choices · 숨은 별칭 · repeatable 여부)을 물려받을 데가 없으므로 뺀다.
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

live('ytstudio types 가 실물로 끝까지 간다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-drift-'));
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

// 커밋된 스키마가 뒤처진 것은 늘 그런 일이라 실패로 안 친다. 알리기만 한다.
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
  console.log('      다시 뽑으려면: python3 gen_schema.py > ytstudio.schema.json && bun run gen:types');
});
