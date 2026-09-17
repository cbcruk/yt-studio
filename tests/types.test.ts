/**
 * Tests for `ytstudio types`.
 *
 * This command **writes files** into the user's project. So calling a function
 * is not enough — make a real directory, spawn a real process, and **compile the
 * generated `.d.ts` with real tsc** to see the new methods pass. That is all the
 * command promises.
 *
 * No need to install yt-dlp. A stub that prints help is enough — this command only
 * looks at `--version` and `--help` output, so imitating that is the real thing.
 * Editing the fixture help produces "a yt-dlp with a new option" and "a yt-dlp
 * with an option removed".
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
 * One user project.
 *
 * Symlinks `node_modules/ytstudio` to the repo — a real install would cost a few
 * seconds per test. It resolves the same way.
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

/** Launches the build output with node — it is a `#!/usr/bin/env node` script. */
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

/** The only way to know the generated types are real — compile them. */
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

/** Inserts one option line into the help. The spot before `-v, --verbose` always exists. */
const withOption = (line: string): string =>
  HELP.replace('    -v, --verbose', `${line}\n    -v, --verbose`);

test('아무것도 안 달라졌으면 새로 0 · 사라짐 0', () => {
  const dir = project(HELP);
  const r = types(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /새로 0 · 사라짐 0/);
  assert.ok(wrote(dir, 'ytstudio.schema.json') && wrote(dir, 'ytstudio-env.d.ts'), '파일을 안 썼다');
});

// This test is why the command exists — options only in the user's yt-dlp become types.
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

// Augmentation can only add. There is no way to remove a gone option, so only strike it through.
test('사라진 옵션에 @deprecated 를 붙인다', () => {
  const dir = project(HELP.split('\n').filter(l => !l.startsWith('    --sub-langs ')).join('\n'));
  const r = types(dir);
  assert.match(r.out, /사라짐 1/, r.out);

  const dts = readFileSync(path.join(dir, 'ytstudio-env.d.ts'), 'utf8');
  assert.match(dts, /@deprecated not an option in yt-dlp 2099\.01\.01/);
  assert.match(dts, /subLangs\(value: Arg\): this;/, '같은 시그니처로 다시 선언해야 병합된다');

  // It must still compile — a strikethrough, not an error
  const c = compiles(dir, "import { ytdlp } from 'ytstudio';\nytdlp('u').subLangs('ko').build();\n");
  assert.equal(c.code, 0, `컴파일 실패\n${c.out}`);
});

test('만든 스키마를 검증기가 곧바로 집는다 — 런타임과 타입이 같은 리플렉션에서 나온다', () => {
  const dir = project(withOption('    --brand-new NAME                Something new'));
  types(dir);
  // Running lint in the same directory reads the just-written schema as local
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

// Help is human-facing output, so its format can change. Extracting only a few and
// reporting success would turn every one of the user's flags into a typo.
test(`서식이 깨지면 거부하고 아무것도 안 쓴다 — 번들 ${BASE.options.length}개 중 20% 넘게 사라지면`, () => {
  const dir = project('Usage: yt-dlp\n\nOptions:\n\n  General Options:\n    -h, --help    Print this\n');
  const r = types(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /파서가 이 서식을 못 읽는다/);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts') && !wrote(dir, 'ytstudio.schema.json'), '거부했는데 파일을 썼다');
});

// The file exists but autocomplete does not grow — the quietest way this tool fails
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

// Back when arguments were scanned by hand (indexOf('--yt-dlp')), this form was not
// found, so it **silently dropped the path the user gave** and looked at PATH. This
// is the kind of failure this repo keeps catching, so pin it here.
test('--yt-dlp=경로 형태도 읽는다 — 조용히 안 버린다', () => {
  const dir = project(HELP);
  const bin = path.join(dir, 'fake-yt-dlp');
  const r = spawn(dir, ['types', `--yt-dlp=${bin}`]);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(bin), `가리킨 경로를 안 썼다\n${r.out}`);
});

// strict, so unknown flags do not pass silently.
test('모르는 옵션은 2 로 끝난다', () => {
  const dir = project(HELP);
  const r = spawn(dir, ['types', '--nonsense']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /모르는 옵션이다: --nonsense/);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts'), '인자가 틀렸는데 파일을 썼다');
});

// 2 means "you called me wrong", 1 means "I tried to do what you asked but the target
// is the problem". Scripts need to tell the two apart.
test('--yt-dlp 뒤가 비면 2 로 끝난다 — 잘못 부른 것이다', () => {
  const dir = project(HELP);
  const r = spawn(dir, ['types', '--yt-dlp']);
  assert.equal(r.code, 2, r.out);
  assert.ok(!wrote(dir, 'ytstudio-env.d.ts'), '인자가 틀렸는데 파일을 썼다');
});
