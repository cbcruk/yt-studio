/**
 * 공개 표면의 JSDoc 검사 — `.claude/rules/jsdoc.md` 를 기계가 지키게 한다.
 *
 * 손님이 에디터에서 보는 것은 소스가 아니라 **`tsc` 가 낸 `.d.ts`** 다. 그래서
 * 소스가 아니라 `lib/` 를 읽는다 — 주석이 선언 방출에서 떨어져 나갔다면 그것도
 * 여기서 잡혀야 한다.
 *
 * 둘을 본다.
 *
 * - **빠진 주석** — 입구(`ytstudio` · `ytstudio/browser`)에서 닿는 선언과, 그
 *   인터페이스 · 클래스의 멤버마다 JSDoc 이 붙었나.
 * - **예제** — `@example` 의 코드 블록이 손님 프로젝트에서 그대로 컴파일되나.
 *   `import` 를 빼먹은 예제는 읽기 불편한 게 아니라 **틀린** 것이다.
 *
 * TypeScript 7 은 JS 컴파일러 API 가 없어서 AST 대신 `.d.ts` 의 줄 모양을 본다.
 * `tsc` 가 내는 선언 파일은 모양이 늘 같다 — 최상위 선언은 0칸, 멤버는 4칸.
 */
import { beforeAll, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib');
const TSC = path.join(ROOT, 'node_modules', '.bin', 'tsc');

/** 손님이 import 하는 입구. `package.json` 의 `exports` 와 같다. */
const ENTRIES = ['index.d.ts', 'browser.d.ts'];
const SOURCES = ['src/index.ts', 'src/browser.ts'];

beforeAll(() => {
  assert.ok(existsSync(path.join(LIB, 'index.d.ts')), `${LIB} 가 없다 — 'bun run build' 를 먼저 돌릴 것`);
});

const cache = new Map<string, string[]>();
const linesOf = (file: string): string[] => {
  let lines = cache.get(file);
  if (!lines) cache.set(file, lines = readFileSync(file, 'utf8').split('\n'));
  return lines;
};

/** `'./core/lint.js'` → `lib/core/lint.d.ts` */
const dts = (from: string, spec: string): string =>
  path.resolve(path.dirname(from), spec.replace(/\.js$/, '.d.ts'));

/** `{ a, b as c }` → `[['a','a'], ['b','c']]` (원래 이름, 보이는 이름) */
const names = (list: string): [string, string][] =>
  list.split(',').map(s => s.trim()).filter(Boolean).map((s) => {
    const [orig, alias] = s.replace(/^type\s+/, '').split(/\s+as\s+/);
    return [orig!, alias ?? orig!];
  });

interface Decl { file: string; line: number; name: string; kind: string }

const DECL = /^(?:export )?(?:declare )?(const|function|class|interface|type|enum) ([\w$]+)/;

/** 파일 안에서 `name` 이 가리키는 선언을 따라간다. 재수출 · import 별칭까지. */
function resolve(file: string, name: string, seen = new Set<string>()): Decl[] {
  const key = `${file}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const lines = linesOf(file);
  const own = lines.flatMap((l, i) => {
    const m = DECL.exec(l);
    return m && m[2] === name ? [{ file, line: i, name, kind: m[1]! }] : [];
  });
  if (own.length) return own;

  const text = lines.join('\n');
  for (const m of text.matchAll(/^(?:export|import)(?: type)? \{([^}]*)\}(?: from '([^']+)')?;/gm)) {
    const hit = names(m[1]!).find(([, alias]) => alias === name);
    if (hit && m[2]) return resolve(dts(file, m[2]), hit[0], seen);
  }
  for (const m of text.matchAll(/^export \* from '([^']+)';/gm)) {
    const found = resolve(dts(file, m[1]!), name, seen);
    if (found.length) return found;
  }
  return [];
}

/** 입구 파일이 내보내는 이름 전부. */
function exportsOf(file: string): string[] {
  const text = linesOf(file).join('\n');
  const out = new Set<string>();
  for (const m of text.matchAll(/^export (?:declare )?(?:const|function|class|interface|type|enum) ([\w$]+)/gm)) out.add(m[1]!);
  for (const m of text.matchAll(/^export(?: type)? \{([^}]*)\}/gm)) for (const [, alias] of names(m[1]!)) out.add(alias);
  for (const m of text.matchAll(/^export \* from '([^']+)';/gm)) for (const n of exportsOf(dts(file, m[1]!))) out.add(n);
  return [...out];
}

const documented = (lines: string[], i: number): boolean => lines[i - 1]?.trim().endsWith('*/') ?? false;

/**
 * 멤버 줄. 4칸 들여쓰기에서 시작하는 것만 — 더 깊은 것은 멤버 타입의 안쪽이다.
 *
 * 안 보는 것: `private` (`.d.ts` 에 이름만 남고 손님이 못 부른다), `constructor`
 * (공개 클래스는 전부 타입으로만 나간다 — 손님이 `new` 할 일이 없다), 호출 ·
 * 인덱스 시그니처(인터페이스 자체의 주석이 그 설명이다).
 */
const MEMBER = /^ {4}(?:readonly |static )*([\w$]+)\??[(<:]/;

/** 인터페이스 · 클래스의 멤버와, 그것이 확장하는 것의 멤버. */
function members(d: Decl, seen: Set<string>): { where: string; ok: boolean }[] {
  const lines = linesOf(d.file);
  const head = lines[d.line]!;
  const out: { where: string; ok: boolean }[] = [];

  const ext = /\bextends ([^{]+)\{/.exec(head);
  if (ext) {
    for (const base of ext[1]!.split(/,(?![^<]*>)/)) {
      const n = base.trim().replace(/<.*$/, '');
      for (const b of resolve(d.file, n)) {
        const key = `${b.file}#${b.name}#${b.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(...members(b, seen));
      }
    }
  }

  if (!head.endsWith('{')) return out;
  for (let i = d.line + 1; i < lines.length && lines[i] !== '}'; i++) {
    const m = MEMBER.exec(lines[i]!);
    if (!m || m[1] === 'constructor' || /^ {4}private /.test(lines[i]!)) continue;
    out.push({ where: `${d.name}.${m[1]}`, ok: documented(lines, i) });
  }
  return out;
}

test('입구에서 닿는 선언과 멤버에 전부 JSDoc 이 있다', () => {
  const missing: string[] = [];
  const seen = new Set<string>();
  let count = 0;

  for (const entry of ENTRIES) {
    const file = path.join(LIB, entry);
    for (const name of exportsOf(file)) {
      const decls = resolve(file, name);
      assert.ok(decls.length, `${entry} 의 ${name} 선언을 못 찾았다 — 검사의 줄 읽기가 낡았다`);
      // 선언 병합(`interface Ytdlp` + `class Ytdlp`)은 에디터가 주석을 합쳐 보여
      // 주므로 한 곳에만 있으면 된다.
      if (!decls.some(d => documented(linesOf(d.file), d.line))) {
        missing.push(`${path.relative(LIB, decls[0]!.file)}  ${name}`);
      }
      for (const d of decls) {
        const key = `${d.file}#${d.name}#${d.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        count++;
        const rel = path.relative(LIB, d.file);
        if (d.kind === 'interface' || d.kind === 'class') {
          for (const m of members(d, seen)) {
            count++;
            if (!m.ok) missing.push(`${rel}  ${m.where}`);
          }
        }
      }
    }
  }

  expect(count).toBeGreaterThan(100);
  assert.deepEqual(missing, [], `JSDoc 이 없는 공개 선언 ${missing.length}개`);
});

/**
 * 여기만 `lib/` 가 아니라 소스를 본다. 파일 맨 앞 주석은 첫 문장에 붙는데,
 * 입구 파일의 첫 문장이 값 import 라서 `tsc` 가 선언 방출에서 그 문장과 함께
 * 주석을 버린다.
 */
test('입구 파일마다 @module 주석이 있다', () => {
  for (const src of SOURCES) {
    const head = readFileSync(path.join(ROOT, src), 'utf8').match(/^\/\*\*[\s\S]*?\*\//)?.[0] ?? '';
    assert.match(head, /@module/, `${src} 맨 앞 주석에 @module 이 없다`);
  }
});

/** `lib/` 의 모든 `.d.ts` 에서 `@example` 코드 블록을 뽑는다. */
function examples(): { from: string; code: string }[] {
  const out: { from: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.d.ts')) {
        const text = readFileSync(p, 'utf8');
        for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
          const body = block[0].split('\n').map(l => l.replace(/^\s*\*? ?/, '')).join('\n');
          for (const ex of body.split(/^@example\b/m).slice(1)) {
            const fence = /```ts\n([\s\S]*?)```/.exec(ex.split(/^@\w/m)[0]!);
            assert.ok(fence, `${path.relative(LIB, p)} 의 @example 에 \`\`\`ts 블록이 없다`);
            out.push({ from: path.relative(LIB, p), code: fence[1]! });
          }
        }
      }
    }
  };
  walk(LIB);
  return out;
}

test('@example 이 손님 프로젝트에서 그대로 컴파일된다', () => {
  const found = examples();
  expect(found.length).toBeGreaterThan(0);

  // types.test.ts 와 같은 모양 — 저장소를 node_modules/ytstudio 로 링크한다.
  // 그래서 예제는 exports 를 지나 배포물(lib/)을 본다.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-docs-'));
  mkdirSync(path.join(dir, 'node_modules'));
  symlinkSync(ROOT, path.join(dir, 'node_modules', 'ytstudio'), 'dir');
  symlinkSync(path.join(ROOT, 'node_modules', '@types'), path.join(dir, 'node_modules', '@types'), 'dir');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      types: ['node'], strict: true, noEmit: true, skipLibCheck: true,
    },
  }));
  // `export {}` 로 파일마다 모듈이 되게 한다 — 스크립트로 두면 예제끼리 전역을
  // 나눠 써서, import 를 빼먹은 예제가 옆 예제 덕에 통과한다.
  found.forEach((ex, i) => writeFileSync(path.join(dir, `ex${i}.ts`), `${ex.code}\nexport {};\n`));

  try {
    execFileSync(TSC, ['-p', dir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const out = (err as { stdout?: string }).stdout ?? '';
    const named = out.replace(/ex(\d+)\.ts/g, (_, n) => `[${found[Number(n)]!.from} 의 예제 ${n}]`);
    assert.fail(`@example 이 컴파일되지 않는다\n${named}`);
  }
});
