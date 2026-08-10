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
import { beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import type { RawSchema } from '../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');
const HELP = readFileSync(path.join(ROOT, 'tests/fixtures/yt-dlp-2026.07.04.help.txt'), 'utf8');
const BASE: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'ytstudio.schema.json'), 'utf8'));

beforeAll(() => {
  assert.ok(existsSync(CLI), `${CLI} 가 없다 — 'bun run build' 를 먼저 돌릴 것`);
});

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
    writeFileSync(fake, `#!/bin/sh\ncase "$1" in\n  --version) echo 2099.01.01 ;;\n  --help) cat "${dir}/help.txt" ;;\nesac\n`, { mode: 0o755 });
  }
  return dir;
}

/** 배포물을 노드로 띄운다 — `#!/usr/bin/env node` 짜리라서. */
function spawn(dir: string, args: string[]): Run {
  try {
    const out = execFileSync('node', [CLI, ...args], {
      cwd: dir, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const types = (dir: string, args: string[] = []): Run =>
  spawn(dir, ['types', '--yt-dlp', path.join(dir, 'fake-yt-dlp'), ...args]);

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

const wrote = (dir: string, name: string): boolean => existsSync(path.join(dir, name));

/** 도움말에 옵션 한 줄을 끼워 넣는다. `-v, --verbose` 앞이 늘 있는 자리다. */
const withOption = (line: string): string =>
  HELP.replace('    -v, --verbose', `${line}\n    -v, --verbose`);

test('아무것도 안 달라졌으면 새로 0 · 사라짐 0', () => {
  const dir = project(HELP);
  const r = types(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /새로 0 · 사라짐 0/);
  assert.ok(wrote(dir, 'ytstudio.schema.json') && wrote(dir, 'ytstudio-env.d.ts'), '파일을 안 썼다');
});

// 이 검사가 이 명령의 존재 이유다 — 손님 yt-dlp 에만 있는 옵션이 타입이 된다.
test('새 옵션이 진짜 메서드가 된다 — brandNew(value: Arg)', () => {
  const dir = project(withOption('    --brand-new NAME                Something new in this build'));
  const r = types(dir);
  assert.match(r.out, /새로 1/, r.out);
  assert.match(r.out, /--brand-new/, '새 옵션을 안 알렸다');

  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').brandNew('x').build();\n");
  assert.equal(c.code, 0, `컴파일 실패\n${c.out}`);
});

test('값을 안 받는 새 옵션은 boolean 을 받는다', () => {
  const dir = project(withOption('    --brand-flag                    Just a switch'));
  types(dir);
  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').brandFlag().build();\n");
  assert.equal(c.code, 0, `컴파일 실패\n${c.out}`);
});

// 확장 선언은 더하기만 된다. 사라진 옵션을 지울 방법이 없으므로 취소선만 긋는다.
test('사라진 옵션에 @deprecated 를 붙인다', () => {
  const dir = project(HELP.split('\n').filter(l => !l.startsWith('    --sub-langs ')).join('\n'));
  const r = types(dir);
  assert.match(r.out, /사라짐 1/, r.out);

  const dts = readFileSync(path.join(dir, 'ytstudio-env.d.ts'), 'utf8');
  assert.match(dts, /@deprecated yt-dlp 2099\.01\.01 에 없는 옵션이다/);
  assert.match(dts, /subLangs\(value: Arg\): this;/, '같은 시그니처로 다시 선언해야 병합된다');

  // 그래도 컴파일은 통과해야 한다 — 취소선이지 오류가 아니다
  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').subLangs('ko').build();\n");
  assert.equal(c.code, 0, `컴파일 실패\n${c.out}`);
});

test('만든 스키마를 검증기가 곧바로 집는다 — 런타임과 타입이 같은 리플렉션에서 나온다', () => {
  const dir = project(withOption('    --brand-new NAME                Something new'));
  types(dir);
  // 같은 디렉터리에서 lint 를 돌리면 방금 쓴 스키마를 로컬로 읽는다
  const r = spawn(dir, ['lint', 'yt-dlp --brand-new x https://youtu.be/abc']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /확인됨/, `새 플래그를 못 알아봤다\n${r.out}`);
  assert.match(r.out, /ytstudio\.schema\.json/);
});

test('yt-dlp 를 못 찾으면 1 로 끝난다 — 조용히 안 넘어간다', () => {
  const dir = project(null);
  const r = types(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /yt-dlp 를 실행하지 못했다/);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts'), '실패했는데 파일을 썼다');
});

// 도움말은 사람용 출력이라 서식이 바뀔 수 있다. 몇 개만 뽑아 놓고 성공했다고
// 말하면 손님의 모든 플래그가 오탈자가 된다.
test(`서식이 깨지면 거부하고 아무것도 안 쓴다 — 번들 ${BASE.options.length}개 중 20% 넘게 사라지면`, () => {
  const dir = project('Usage: yt-dlp\n\nOptions:\n\n  General Options:\n    -h, --help    Print this\n');
  const r = types(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /파서가 이 서식을 못 읽는다/);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts') && !wrote(dir, 'ytstudio.schema.json'), '거부했는데 파일을 썼다');
});

// 파일은 생겼는데 자동완성이 안 늘어나는 것 — 이 도구가 가장 조용히 실패하는 길
const narrow = (include: string[]): string => JSON.stringify({
  compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
  include,
});

test('tsconfig 가 안 덮으면 경고한다', () => {
  const r = types(project(HELP, narrow(['src/**/*'])));
  assert.equal(r.code, 0, `경고지 오류가 아니다 — 종료 코드 ${r.code}`);
  assert.match(r.out, /include 가 ytstudio-env\.d\.ts 을 안 덮는/);
});

test('덮으면 경고하지 않는다', () => {
  const r = types(project(HELP, narrow(['src/**/*', 'ytstudio-env.d.ts'])));
  assert.doesNotMatch(r.out, /include 가/, '멀쩡한 설정에 경고를 냈다');
});

// 인자를 손으로 훑던 때(indexOf('--yt-dlp'))는 이 형태를 못 찾아서 **손님이
// 지정한 경로를 조용히 버리고** PATH 를 봤다. 이 저장소가 계속 잡아 온 종류의
// 실패라 여기 못 박는다.
test('--yt-dlp=경로 형태도 읽는다 — 조용히 안 버린다', () => {
  const dir = project(HELP);
  const bin = path.join(dir, 'fake-yt-dlp');
  const r = spawn(dir, ['types', `--yt-dlp=${bin}`]);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(bin), `가리킨 경로를 안 썼다\n${r.out}`);
});

// strict 라서 모르는 플래그가 조용히 통과하지 않는다.
test('모르는 옵션은 2 로 끝난다', () => {
  const dir = project(HELP);
  const r = spawn(dir, ['types', '--nonsense']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /모르는 옵션이다: --nonsense/);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts'), '인자가 틀렸는데 파일을 썼다');
});

// 2 는 "네가 나를 잘못 불렀다", 1 은 "시키신 걸 하려는데 대상이 문제다".
// 스크립트가 둘을 갈라 봐야 한다.
test('--yt-dlp 뒤가 비면 2 로 끝난다 — 잘못 부른 것이다', () => {
  const dir = project(HELP);
  const r = spawn(dir, ['types', '--yt-dlp']);
  assert.equal(r.code, 2, r.out);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts'), '인자가 틀렸는데 파일을 썼다');
});
