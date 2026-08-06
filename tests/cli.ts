#!/usr/bin/env node
/**
 * CLI 검사.
 *
 * 브라우저 앱이 하던 일 중 라이브러리가 대신 못 하던 것 — **어디선가 주운
 * 명령어를 검사하기** — 이 여기로 옮겨 왔다. 그래서 여기서 볼 것은 화면이
 * 아니라 셋이다.
 *
 *   · 종료 코드로 말하는가 (스크립트와 CI 가 그걸 본다)
 *   · 표준 입력으로 흘려 넣어도 되는가 (파이프)
 *   · 색을 안 쓸 때 글자만 깨끗이 나오는가 (grep)
 *
 * 실제로 프로세스를 띄운다 — 함수를 부르면 종료 코드도 파이프도 안 보인다.
 * 그리고 **컴파일한 lib/ 를 노드로** 띄운다. 배포하는 물건이 그거라서,
 * 이 검사만은 소스가 아니라 산출물을 상대한다.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');

let pass = 0, fail = 0;

interface Run { code: number; out: string }

// bun 으로 이 파일을 돌려도 CLI 는 node 로 띄운다 — process.execPath 를 쓰면
// 러너를 따라가는데, 우리가 배포하는 건 `#!/usr/bin/env node` 짜리다.
const NODE = 'node';

/** CLI 를 돌리고 { code, out } 을 준다. NO_COLOR 로 색을 끈다. */
function run(args: string[], stdin = ''): Run {
  try {
    const out = execFileSync(NODE, [CLI, ...args], {
      input: stdin, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: 0, out };
  } catch (err) {
    // execFileSync 는 종료 코드가 0 이 아니면 던진다 — 그게 우리가 볼 것이다
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function check(title: string, fn: () => string | void): void {
  try {
    const note = fn();
    pass++; console.log(`  ✓ ${title}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    fail++; console.log(`  ✗ ${title} — ${(e as Error).message}`);
  }
}
const assert = (cond: unknown, msg: string): void => { if (!cond) throw new Error(msg); };

console.log('▸ CLI');

check('맞는 명령어는 0 으로 끝난다', () => {
  const r = run(['lint', 'yt-dlp -f "bv[height<=1080]+ba/b" --merge-output-format mp4 -o "%(title)s.%(ext)s" https://youtu.be/abc']);
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(r.out.includes('확인됨'), r.out);
  return '확인됨';
});

check('오류가 있으면 1 로 끝난다 — 스크립트가 그걸 본다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert(r.code === 1, `종료 코드 ${r.code}`);
  assert(r.out.includes('--write-sub 는 이 yt-dlp 버전에 없는'), r.out);
  return '오류 1개';
});

check('고칠 후보를 같이 준다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert(r.out.includes('--write-subs'), r.out);
});

check('경고만 있으면 0 이다 — 판단이지 틀린 게 아니다', () => {
  const r = run(['lint', 'yt-dlp -x -f bv https://youtu.be/abc']);
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(r.out.includes('경고'), r.out);
  return '경고 1개 · exit 0';
});

check('표준 입력으로 흘려 넣어도 된다', () => {
  const r = run(['lint'], 'yt-dlp --write-sub https://youtu.be/abc\n');
  assert(r.code === 1, `종료 코드 ${r.code}`);
  assert(r.out.includes('--write-sub'), r.out);
  return 'pbpaste | ytstudio lint';
});

check('만들 파일명을 보여 준다', () => {
  const r = run(['lint', 'yt-dlp -P home:/dl -o "%(uploader)s/%(title)s.%(ext)s" https://youtu.be/abc']);
  assert(r.out.includes('/dl/‹업로더›/‹제목›.‹확장자›'), r.out);
});

check('-o 가 없으면 yt-dlp 기본값이라고 말한다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc']);
  assert(r.out.includes('-o 없음'), r.out);
});

check('색을 끄면 이스케이프가 안 남는다 — grep 에 걸리면 곤란하다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert(!/\x1b\[/.test(r.out), '색코드가 남았다');
});

check('explain 은 토큰마다 무슨 옵션인지 말한다', () => {
  const r = run(['explain', 'yt-dlp -x --no-part https://youtu.be/abc']);
  assert(r.out.includes('[후처리]'), r.out);
  assert(r.out.includes('끄기'), '부정형을 끈 것이라고 안 했다');
  assert(r.out.includes('받을 대상'), 'URL 설명이 없다');
});

check('version 은 스키마가 나온 버전을 낸다', () => {
  const r = run(['version']);
  assert(/^\d{4}\.\d{2}\.\d{2}$/.test(r.out.trim()), r.out);
  return r.out.trim();
});

check('인자 없이 부르면 쓰는 법을 낸다', () => {
  const r = run([]);
  assert(r.code === 0, `종료 코드 ${r.code}`);
  assert(r.out.includes('ytstudio lint'), r.out);
});

check('모르는 명령은 2 로 끝난다 — 오류(1)와 구분된다', () => {
  assert(run(['nope']).code === 2, '종료 코드가 2가 아니다');
  assert(run(['lint']).code === 2, '빈 입력도 2여야 한다');
});

console.log(`\n  ${fail ? '✗' : '✓'} CLI: ${pass} 통과${fail ? ` · ${fail} 실패` : ''}`);
process.exit(fail ? 1 : 0);
