/**
 * CLI tests — **what only shows up when there is a process.**
 *
 * What remains here are properties you cannot see by calling a function. What
 * it says is covered by unit tests (`unit/explain.test.ts` · `unit/lint.test.ts`);
 * here we only look at how it behaves as a process.
 *
 * - Does it speak through the exit code? (scripts and CI read it)
 * - Can input be piped in on stdin? (pipes)
 * - Does it print clean text when color is off? (grep)
 * - Does the shipped `lib/` actually run on node?
 *
 * **There used to be five schema-resolution-order tests here.** The schema was
 * process-global, so the only option was a fresh process per case. That was not
 * a reason for this file to exist but a symptom that `core/schema.ts` was the
 * wrong shape — the tests did not just bypass the interface, they had to fork
 * processes.
 *
 * When the schema became a value, those five moved to `unit/resolve.test.ts`.
 * The one left here is not about order but **whether the CLI says it on screen**.
 */
import { beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const SCHEMA_FILE = 'yt-studio.schema.json';

beforeAll(() => {
  // This test targets the **compiled output**, not the source. If it is missing,
  // say why — otherwise "didn't build" shows up as an unrelated failure.
  assert.ok(existsSync(CLI), `${CLI} 가 없다 — 'bun run build' 를 먼저 돌릴 것`);
});

interface Run { code: number; out: string }
interface Env { cwd: string; env: Record<string, string> }

// Even when bun runs this file, the CLI is launched with node — process.execPath
// would follow the runner, but what we ship is a `#!/usr/bin/env node` script.
const NODE = 'node';

/**
 * Runs the CLI and returns { code, out }. NO_COLOR turns color off.
 *
 * Pointing `cwd` outside the repo avoids the local schema lookup — the
 * schema-resolution-order test uses that.
 */
function run(args: string[], stdin = '', extra: Partial<Env> = {}): Run {
  try {
    const out = execFileSync(NODE, [CLI, ...args], {
      input: stdin, encoding: 'utf8', stdio: 'pipe',
      cwd: extra.cwd ?? ROOT,
      env: { ...process.env, NO_COLOR: '1', ...extra.env },
    });
    return { code: 0, out };
  } catch (err) {
    // execFileSync throws on a non-zero exit code — that is what we want to see
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('맞는 명령어는 0 으로 끝난다', () => {
  const r = run(['lint', 'yt-dlp -f "bv[height<=1080]+ba/b" --merge-output-format mp4 -o "%(title)s.%(ext)s" https://youtu.be/abc']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /확인됨/);
});

test('오류가 있으면 1 로 끝난다 — 스크립트가 그걸 본다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--write-sub 는 이 yt-dlp 버전에 없는/);
});

test('경고만 있으면 0 이다 — 판단이지 틀린 게 아니다', () => {
  const r = run(['lint', 'yt-dlp -x -f bv https://youtu.be/abc']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /경고/);
});

test('표준 입력으로 흘려 넣어도 된다 — pbpaste | yt-studio lint', () => {
  const r = run(['lint'], 'yt-dlp --write-sub https://youtu.be/abc\n');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--write-sub/);
});

test('색을 끄면 이스케이프가 안 남는다 — grep 에 걸리면 곤란하다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert.doesNotMatch(r.out, /\x1b\[/, '색코드가 남았다');
});

// What it says is covered by unit/explain.test.ts. Here we only check that the
// subcommand is wired up and emits one chunk per token — asserting on screen text
// breaks the test every time the wording is polished.
test('explain 은 토큰마다 한 덩이씩 낸다', () => {
  const r = run(['explain', 'yt-dlp -x --no-part https://youtu.be/abc']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.split('\n').filter(l => l.startsWith('  ')).length, 3, r.out);
});

test('version 은 첫 줄에 버전만 낸다 — 스크립트가 그걸 읽는다', () => {
  const r = run(['version']);
  assert.match(r.out.split('\n')[0]!.trim(), /^\d{4}\.\d{2}\.\d{2}$/);
});

// The resolution order itself is covered by unit/resolve.test.ts — since the schema
// became a value, no process fork is needed. The one left here is **whether the CLI
// says it on screen**. A verdict without what it was checked against is unreadable.
test('무엇에 대조했는지 판정 옆에 적는다', () => {
  const here = run(['lint', 'yt-dlp https://youtu.be/abc']);
  assert.ok(here.out.includes(path.join(ROOT, SCHEMA_FILE)), here.out);

  const outside = run(['lint', 'yt-dlp https://youtu.be/abc'], '', { cwd: os.tmpdir() });
  assert.match(outside.out, /패키지 내장/);
});

test('인자 없이 부르면 쓰는 법을 낸다', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /yt-studio lint/);
});

test('모르는 명령은 2 로 끝난다 — 오류(1)와 구분된다', () => {
  assert.equal(run(['nope']).code, 2);
  assert.equal(run(['lint']).code, 2, '빈 입력도 2여야 한다');
});

// Without quotes the shell splits the command, and `-x` looks like one of ours. The
// arguments after lint are the yt-dlp command, not flags for this CLI.
test('따옴표 없이 줘도 lint 는 나머지를 yt-dlp 명령어로 읽는다', () => {
  const r = run(['lint', 'yt-dlp', '-x', '--write-sub', 'https://youtu.be/abc']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--write-sub 는 이 yt-dlp 버전에 없는/);
});

test('types 에 모르는 옵션을 주면 2 로 끝난다', () => {
  const r = run(['types', '--bogus']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /모르는 옵션이다: --bogus/);
});

// A failed read used to come back as '' and say "no command" — the cause vanished.
test('표준 입력을 못 읽으면 명령어가 없다고 하지 않고 이유를 말한다', () => {
  const dir = openSync(os.tmpdir(), 'r');
  try {
    const r = spawnSync(NODE, [CLI, 'lint'], {
      stdio: [dir, 'pipe', 'pipe'], encoding: 'utf8', cwd: ROOT, env: { ...process.env, NO_COLOR: '1' },
    });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 2, out);
    assert.match(out, /표준 입력을 읽지 못했다/);
    assert.doesNotMatch(out, /검사할 명령어가 없다/);
  } finally {
    closeSync(dir);
  }
});

// The schema used to be decided at the top of the module — a bad pointer printed a stack
// trace even for --help, and a broken local schema blocked `types`, the command that fixes it.
test('스키마를 못 읽으면 스택 트레이스 대신 한 줄로 말하고 2 로 끝난다', () => {
  const bad = { env: { YT_STUDIO_SCHEMA: '/nope/yt-studio.schema.json' } };

  const lint = run(['lint', 'yt-dlp -x https://youtu.be/abc'], '', bad);
  assert.equal(lint.code, 2, lint.out);
  assert.match(lint.out, /YT_STUDIO_SCHEMA 가 가리키는 스키마를 읽지 못했다/);
  assert.doesNotMatch(lint.out, /\n\s+at /, '스택 트레이스가 새어 나왔다');

  const help = run(['--help'], '', bad);
  assert.equal(help.code, 0, help.out);
  assert.match(help.out, /yt-studio lint/);
});

test('로컬 스키마가 깨져 있어도 types 는 돈다 — 그걸 다시 뽑는 명령이다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-studio-cli-'));
  writeFileSync(path.join(dir, SCHEMA_FILE), '{"ytdlp_version": "2026');
  const r = run(['types', '--yt-dlp', '/nope/yt-dlp'], '', { cwd: dir });
  // Fails on the missing binary — not on the broken schema it is meant to replace
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /yt-dlp 를 실행하지 못했다/);
});

// Importing must not touch the file system — users passing their own schema pay nothing.
// Watched from a separate process: fs is patched before the compiled entry point loads.
test('yt-studio 를 import 만 하면 파일을 안 읽는다', () => {
  const probe = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const read = [];
    const orig = fs.readFileSync;
    fs.readFileSync = (p, ...a) => { read.push(String(p)); return orig(p, ...a); };
    syncBuiltinESMExports();
    await import(${JSON.stringify(path.join(ROOT, 'lib', 'index.js'))});
    console.log(JSON.stringify(read.filter(p => p.endsWith('.json'))));
  `;
  const out = execFileSync(NODE, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), []);
});
