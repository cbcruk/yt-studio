#!/usr/bin/env node
/**
 * `ytstudio types` 검사.
 *
 * 이 명령은 손님 프로젝트에 **파일을 쓴다.** 그래서 함수를 부르는 것으로는
 * 모자라다 — 진짜 디렉터리를 만들고, 진짜 프로세스를 띄우고, 만들어진
 * `.d.ts` 를 **진짜 tsc 로 컴파일해** 새 메서드가 통과하는지 본다. 그게 이
 * 명령이 약속한 전부다.
 *
 * yt-dlp 를 깔 필요는 없다. 도움말을 뱉는 껍데기면 된다 — 이 명령이 보는 것이
 * `--version` 과 `--help` 출력뿐이라서, 그걸 흉내 내는 것이 곧 실물이다.
 * 붙박이 도움말을 고쳐서 "새 옵션이 생긴 yt-dlp"와 "옵션이 사라진 yt-dlp"를
 * 만든다.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');
const HELP = readFileSync(path.join(ROOT, 'tests/fixtures/yt-dlp-2026.07.04.help.txt'), 'utf8');
const BASE = JSON.parse(readFileSync(path.join(ROOT, 'ytstudio.schema.json'), 'utf8'));

interface Run { code: number; out: string }

/**
 * 손님 프로젝트 한 채.
 *
 * `node_modules/ytstudio` 를 저장소로 심볼릭 링크한다 — 진짜로 설치하면
 * 검사마다 몇 초씩 든다. 해석되는 모양은 같다.
 */
function project(help: string | null, tsconfig?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-types-'));
  mkdirSync(path.join(dir, 'src'));
  mkdirSync(path.join(dir, 'node_modules'));
  symlinkSync(ROOT, path.join(dir, 'node_modules', 'ytstudio'), 'dir');
  writeFileSync(path.join(dir, 'tsconfig.json'), tsconfig ?? JSON.stringify({
    compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmit: true, skipLibCheck: true,
    },
  }));
  if (help !== null) {
    writeFileSync(path.join(dir, 'help.txt'), help);
    const fake = path.join(dir, 'fake-yt-dlp');
    writeFileSync(fake, `#!/bin/sh\ncase "$1" in\n  --version) echo 2099.01.01 ;;\n  --help) cat "${dir}/help.txt" ;;\nesac\n`);
    execFileSync('chmod', ['+x', fake]);
  }
  return dir;
}

function types(dir: string, args: string[] = []): Run {
  const bin = path.join(dir, 'fake-yt-dlp');
  try {
    const out = execFileSync('node', [CLI, 'types', '--yt-dlp', bin, ...args], {
      cwd: dir, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** 만들어진 타입이 진짜인지 보는 유일한 방법 — 컴파일해 본다. */
function compiles(dir: string, code: string): Run {
  writeFileSync(path.join(dir, 'src', 't.ts'), code);
  try {
    return { code: 0, out: execFileSync(TSC, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const exists = (dir: string, name: string): boolean => {
  try { readFileSync(path.join(dir, name)); return true; } catch { return false; }
};

let pass = 0, fail = 0;
function check(name: string, fn: () => string | void): void {
  try {
    const note = fn();
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${note ? ` \x1b[2m— ${note}\x1b[0m` : ''}`);
  } catch (err) {
    fail++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}
const assert = (c: unknown, msg: string): void => { if (!c) throw new Error(msg); };

console.log('\n\x1b[1m▸ ytstudio types\x1b[0m');

check('아무것도 안 달라졌으면 새로 0 · 사라짐 0', () => {
  const dir = project(HELP);
  const r = types(dir);
  assert(r.code === 0, `종료 코드 ${r.code}\n${r.out}`);
  assert(/새로 0 · 사라짐 0/.test(r.out), r.out);
  assert(exists(dir, 'ytstudio.schema.json') && exists(dir, 'ytstudio-env.d.ts'), '파일을 안 썼다');
});

// 이 검사가 이 명령의 존재 이유다 — 손님 yt-dlp 에만 있는 옵션이 타입이 된다.
check('새 옵션이 진짜 메서드가 된다 (tsc 로 확인)', () => {
  const dir = project(HELP.replace('    -v, --verbose',
    '    --brand-new NAME                Something new in this build\n    -v, --verbose'));
  const r = types(dir);
  assert(/새로 1/.test(r.out), r.out);
  assert(/--brand-new/.test(r.out), '새 옵션을 안 알렸다');

  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').brandNew('x').build();\n");
  assert(c.code === 0, `컴파일 실패\n${c.out}`);
  return 'brandNew(value: Arg)';
});

check('값을 안 받는 새 옵션은 boolean 을 받는다', () => {
  const dir = project(HELP.replace('    -v, --verbose',
    '    --brand-flag                    Just a switch\n    -v, --verbose'));
  types(dir);
  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').brandFlag().build();\n");
  assert(c.code === 0, `컴파일 실패\n${c.out}`);
});

// 확장 선언은 더하기만 된다. 사라진 옵션을 지울 방법이 없으므로 취소선만 긋는다.
check('사라진 옵션에 @deprecated 를 붙인다', () => {
  const dir = project(HELP.split('\n').filter(l => !l.startsWith('    --sub-langs ')).join('\n'));
  const r = types(dir);
  assert(/사라짐 1/.test(r.out), r.out);
  const dts = readFileSync(path.join(dir, 'ytstudio-env.d.ts'), 'utf8');
  assert(/@deprecated yt-dlp 2099\.01\.01 에 없는 옵션이다/.test(dts), dts.slice(0, 400));
  assert(/subLangs\(value: Arg\): this;/.test(dts), '같은 시그니처로 다시 선언해야 병합된다');
  // 그래도 컴파일은 통과해야 한다 — 취소선이지 오류가 아니다
  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').subLangs('ko').build();\n");
  assert(c.code === 0, `컴파일 실패\n${c.out}`);
});

check('만든 스키마를 검증기가 곧바로 집는다', () => {
  const dir = project(HELP.replace('    -v, --verbose',
    '    --brand-new NAME                Something new\n    -v, --verbose'));
  types(dir);
  // 같은 디렉터리에서 lint 를 돌리면 방금 쓴 스키마를 로컬로 읽는다
  const r = execFileSync('node', [CLI, 'lint', 'yt-dlp --brand-new x https://youtu.be/abc'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert(/확인됨/.test(r), `새 플래그를 못 알아봤다\n${r}`);
  assert(/ytstudio\.schema\.json/.test(r), r);
  return '런타임과 타입이 같은 리플렉션에서 나온다';
});

check('yt-dlp 를 못 찾으면 1 로 끝난다 — 조용히 안 넘어간다', () => {
  const dir = project(null);
  const r = types(dir);
  assert(r.code === 1, `종료 코드 ${r.code}\n${r.out}`);
  assert(/yt-dlp 를 실행하지 못했다/.test(r.out), r.out);
  assert(!exists(dir, 'ytstudio-env.d.ts'), '실패했는데 파일을 썼다');
});

// 도움말은 사람용 출력이라 서식이 바뀔 수 있다. 몇 개만 뽑아 놓고 성공했다고
// 말하면 손님의 모든 플래그가 오탈자가 된다.
check('서식이 깨지면 거부하고 아무것도 안 쓴다', () => {
  const dir = project('Usage: yt-dlp\n\nOptions:\n\n  General Options:\n    -h, --help    Print this\n');
  const r = types(dir);
  assert(r.code === 1, `종료 코드 ${r.code}\n${r.out}`);
  assert(/파서가 이 서식을 못 읽는다/.test(r.out), r.out);
  assert(!exists(dir, 'ytstudio-env.d.ts') && !exists(dir, 'ytstudio.schema.json'), '거부했는데 파일을 썼다');
  return `번들 ${BASE.options.length}개 중 20% 넘게 사라지면`;
});

// 파일은 생겼는데 자동완성이 안 늘어나는 것 — 이 도구가 가장 조용히 실패하는 길
check('tsconfig 가 안 덮으면 경고한다', () => {
  const dir = project(HELP, JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
    include: ['src/**/*'],
  }));
  const r = types(dir);
  assert(r.code === 0, `경고지 오류가 아니다 — 종료 코드 ${r.code}`);
  assert(/include 가 ytstudio-env\.d\.ts 을 안 덮는/.test(r.out), r.out);
});

check('덮으면 경고하지 않는다', () => {
  const dir = project(HELP, JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
    include: ['src/**/*', 'ytstudio-env.d.ts'],
  }));
  assert(!/include 가/.test(types(dir).out), '멀쩡한 설정에 경고를 냈다');
});

// 2 는 "네가 나를 잘못 불렀다", 1 은 "시키신 걸 하려는데 대상이 문제다".
// 스크립트가 둘을 갈라 봐야 한다.
check('--yt-dlp 뒤가 비면 2 로 끝난다 — 잘못 부른 것이다', () => {
  const dir = project(HELP);
  let code = 0, out = '';
  try {
    execFileSync('node', [CLI, 'types', '--yt-dlp'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    code = e.status ?? -1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  assert(code === 2, `종료 코드 ${code}\n${out}`);
  assert(!exists(dir, 'ytstudio-env.d.ts'), '인자가 틀렸는데 파일을 썼다');
});

console.log(`\n  ${fail ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m ytstudio types: ${pass} 통과${fail ? ` · ${fail} 실패` : ''}\n`);
process.exit(fail ? 1 : 0);
