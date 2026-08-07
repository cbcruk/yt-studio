#!/usr/bin/env node
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
 *
 * 그중 **스키마 해석 순서**가 이 파일을 대체 불가능하게 만든다. `src/index.ts`
 * 는 모듈 최상단에서 스키마를 정하고 `initSchema` 가 프로세스 전역을 덮어쓰기
 * 때문에, 한 프로세스에서 두 번 로드하면 앞엣것이 오염된다 — 그것도 버전은
 * 그대로 두고 동작만 바뀐다. 경우마다 새 프로세스를 띄우는 수밖에 없다.
 *
 * (`lib/` 를 노드로 띄우는 것 자체는 `tests/types-cmd.ts` 도 한다. 그건 이
 * 파일만의 이유가 아니다.)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const SCHEMA_FILE = 'ytstudio.schema.json';

// 이 검사는 소스가 아니라 **컴파일한 산출물**을 상대한다. 없으면 검사가
// 통째로 실패하는데, 그 이유가 "빌드를 안 했다"임을 여기서 말해 준다.
if (!existsSync(CLI)) {
  console.error(`${CLI} 가 없다 — 'npm run build' 를 먼저 돌릴 것 (npm test 는 같이 한다).`);
  process.exit(2);
}

// 스키마 해석 순서를 보려면 저장소 밖의 디렉터리 둘이 필요하다 — 가짜 버전을
// 박은 진짜 스키마 하나, 이름만 같고 우리 것이 아닌 JSON 하나.
const TMP = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-cli-'));
const FAKE = path.join(TMP, 'fake.schema.json');
writeFileSync(FAKE, JSON.stringify({
  ...JSON.parse(readFileSync(path.join(ROOT, SCHEMA_FILE), 'utf8')),
  ytdlp_version: '9999.01.01',
}));

const DECOY = path.join(TMP, 'decoy');
mkdirSync(DECOY, { recursive: true });
writeFileSync(path.join(DECOY, SCHEMA_FILE),
  JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema' }));

let pass = 0, fail = 0;

interface Run { code: number; out: string }

// bun 으로 이 파일을 돌려도 CLI 는 node 로 띄운다 — process.execPath 를 쓰면
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

interface Env { cwd: string; env: Record<string, string> }

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

check('색을 끄면 이스케이프가 안 남는다 — grep 에 걸리면 곤란하다', () => {
  const r = run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert(!/\x1b\[/.test(r.out), '색코드가 남았다');
});

// 무슨 말을 하는지는 tests/unit/explain.test.ts 가 본다. 여기서는 서브명령이
// 붙어 있고 토큰 수만큼 낸다는 것까지다 — 화면 글자에 단언을 걸면 문구를
// 다듬을 때마다 검사가 깨진다.
check('explain 은 토큰마다 한 덩이씩 낸다', () => {
  const r = run(['explain', 'yt-dlp -x --no-part https://youtu.be/abc']);
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(r.out.split('\n').filter(l => l.startsWith('  ')).length === 3, r.out);
});

check('version 은 스키마가 나온 버전을 낸다', () => {
  const r = run(['version']);
  // 첫 줄만 버전이다 — 스키마 출처는 표준 오류로 나가므로 스크립트가 안 본다
  assert(/^\d{4}\.\d{2}\.\d{2}$/.test(r.out.split('\n')[0]!.trim()), r.out);
  return r.out.split('\n')[0]!.trim();
});

// 검증기의 값어치는 "설치된 실물과 대조한다"에 있다. 패키지에 실린 스키마는
// 이 저장소를 구울 때의 yt-dlp 이지 손님 것이 아니므로, 손님이 제 것을 놓으면
// 그게 이겨야 한다. 아래 셋이 그 순서를 지킨다.
check('작업 디렉터리에 스키마가 없으면 패키지 내장을 쓴다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc'], '', { cwd: os.tmpdir() });
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(r.out.includes('패키지 내장'), r.out);
});

check('작업 디렉터리의 ytstudio.schema.json 이 이긴다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc']);
  assert(r.out.includes(path.join(ROOT, SCHEMA_FILE)), r.out);
});

check('YTSTUDIO_SCHEMA 가 가장 세다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc'], '',
    { cwd: os.tmpdir(), env: { YTSTUDIO_SCHEMA: FAKE } });
  assert(r.out.includes('9999.01.01'), `가리킨 스키마를 안 봤다\n${r.out}`);
  return '환경변수 > 작업 디렉터리 > 내장';
});

// 가리킨 것이 안 읽히면 조용히 내장으로 떨어지면 안 된다 — 그러면 엉뚱한
// 버전으로 검사해 놓고 통과했다고 말하게 된다.
check('YTSTUDIO_SCHEMA 가 헛다리면 조용히 넘어가지 않는다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc'], '',
    { cwd: os.tmpdir(), env: { YTSTUDIO_SCHEMA: path.join(TMP, 'none.json') } });
  assert(r.code !== 0, `조용히 통과했다\n${r.out}`);
  assert(r.out.includes('읽지 못했다'), r.out);
});

// 남의 프로젝트 루트에 JSON Schema 가 이 이름으로 있을 수 있다. 모양이 아니면
// 없는 것으로 쳐야지, 집어 들고 터지면 안 된다.
check('우리 것이 아닌 JSON 은 없는 것으로 친다', () => {
  const r = run(['lint', 'yt-dlp https://youtu.be/abc'], '', { cwd: DECOY });
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(r.out.includes('패키지 내장'), r.out);
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
