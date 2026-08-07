/**
 * CLI 검사 — **프로세스가 있어야만 보이는 것들.**
 *
 * 여기 남은 것은 함수를 불러서는 볼 수 없는 성질뿐이다. 무엇을 말하는지는
 * 단위 테스트가 보고(`unit/explain.test.ts` · `unit/lint.test.ts`), 여기서는
 * 프로세스로서 어떻게 행동하는지만 본다.
 *
 *   · 종료 코드로 말하는가 (스크립트와 CI 가 그걸 본다)
 *   · 표준 입력으로 흘려 넣어도 되는가 (파이프)
 *   · 색을 안 쓸 때 글자만 깨끗이 나오는가 (grep)
 *   · 배포하는 `lib/` 가 노드에서 실제로 도는가
 *
 * **여기 스키마 해석 순서 검사가 다섯 개 있었다.** 스키마가 프로세스 전역이라
 * 경우마다 프로세스를 새로 띄우는 수밖에 없었기 때문이다. 그건 이 파일이 필요한
 * 이유가 아니라 `core/schema.ts` 가 잘못 생겼다는 증상이었다 — 검사가 인터페이스를
 * 우회하는 정도가 아니라 프로세스를 갈라야 했으니까.
 *
 * 스키마를 값으로 바꾸면서 그 다섯은 `unit/resolve.test.ts` 로 갔다. 여기 남은
 * 하나는 순서가 아니라 **CLI 가 그걸 화면에 말하는가**다.
 */
import { beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const SCHEMA_FILE = 'ytstudio.schema.json';

beforeAll(() => {
  // 이 검사는 소스가 아니라 **컴파일한 산출물**을 상대한다. 없으면 왜 없는지
  // 말해 준다 — 안 그러면 "빌드를 안 했다"가 엉뚱한 실패로 보인다.
  assert.ok(existsSync(CLI), `${CLI} 가 없다 — 'bun run build' 를 먼저 돌릴 것`);
});

interface Run { code: number; out: string }
interface Env { cwd: string; env: Record<string, string> }

// bun 이 이 파일을 돌려도 CLI 는 node 로 띄운다 — process.execPath 를 쓰면
// 러너를 따라가는데, 우리가 배포하는 건 `#!/usr/bin/env node` 짜리다.
const NODE = 'node';

/**
 * CLI 를 돌리고 { code, out } 을 준다. NO_COLOR 로 색을 끈다.
 *
 * `cwd` 를 저장소 밖으로 돌리면 로컬 스키마 탐색을 피할 수 있다 — 스키마 해석
 * 순서를 보는 검사가 그걸 쓴다.
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
    // execFileSync 는 종료 코드가 0 이 아니면 던진다 — 그게 우리가 볼 것이다
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

test('표준 입력으로 흘려 넣어도 된다 — pbpaste | ytstudio lint', () => {
  const r = run(['lint'], 'yt-dlp --write-sub https://youtu.be/abc\n');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--write-sub/);
});

test('색을 끄면 이스케이프가 안 남는다 — grep 에 걸리면 곤란하다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert.doesNotMatch(r.out, /\x1b\[/, '색코드가 남았다');
});

// 무슨 말을 하는지는 unit/explain.test.ts 가 본다. 여기서는 서브명령이 붙어
// 있고 토큰 수만큼 낸다는 것까지다 — 화면 글자에 단언을 걸면 문구를 다듬을
// 때마다 검사가 깨진다.
test('explain 은 토큰마다 한 덩이씩 낸다', () => {
  const r = run(['explain', 'yt-dlp -x --no-part https://youtu.be/abc']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out.split('\n').filter(l => l.startsWith('  ')).length, 3, r.out);
});

test('version 은 첫 줄에 버전만 낸다 — 스크립트가 그걸 읽는다', () => {
  const r = run(['version']);
  assert.match(r.out.split('\n')[0]!.trim(), /^\d{4}\.\d{2}\.\d{2}$/);
});

// 해석 순서 자체는 unit/resolve.test.ts 가 본다 — 스키마가 값이 된 뒤로는
// 프로세스를 안 갈라도 된다. 여기 남은 하나는 **CLI 가 그걸 화면에 말하는가**다.
// 판정만 있고 무엇에 대조했는지가 없으면 판정을 읽을 수 없다.
test('무엇에 대조했는지 판정 옆에 적는다', () => {
  const here = run(['lint', 'yt-dlp https://youtu.be/abc']);
  assert.ok(here.out.includes(path.join(ROOT, SCHEMA_FILE)), here.out);

  const outside = run(['lint', 'yt-dlp https://youtu.be/abc'], '', { cwd: os.tmpdir() });
  assert.match(outside.out, /패키지 내장/);
});

test('인자 없이 부르면 쓰는 법을 낸다', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ytstudio lint/);
});

test('모르는 명령은 2 로 끝난다 — 오류(1)와 구분된다', () => {
  assert.equal(run(['nope']).code, 2);
  assert.equal(run(['lint']).code, 2, '빈 입력도 2여야 한다');
});
