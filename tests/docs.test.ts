/**
 * JSDoc check for the public surface — makes the machine enforce `.claude/rules/jsdoc.md`.
 *
 * What users see in the editor is not the source but **the `.d.ts` that `tsc` emits**.
 * So this reads `lib/`, not the source — if a comment fell off during declaration
 * emit, that must be caught here too.
 *
 * Two things are checked.
 *
 * - **Missing comments** — every declaration reachable from the entry points
 *   (`ytstudio` · `ytstudio/browser`), and every member of those interfaces ·
 *   classes, has JSDoc.
 * - **Examples** — the code blocks in `@example` compile as-is in a user project.
 *   An example missing its `import` is not merely awkward to read, it is **wrong**.
 *
 * TypeScript 7 has no JS compiler API, so instead of an AST this reads the line
 * shape of the `.d.ts`. Declaration files emitted by `tsc` always look the same —
 * top-level declarations at column 0, members indented 4.
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

/** The entry points users import. Same as `exports` in `package.json`. */
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

/** `{ a, b as c }` → `[['a','a'], ['b','c']]` (original name, visible name) */
const names = (list: string): [string, string][] =>
  list.split(',').map(s => s.trim()).filter(Boolean).map((s) => {
    const [orig, alias] = s.replace(/^type\s+/, '').split(/\s+as\s+/);
    return [orig!, alias ?? orig!];
  });

interface Decl { file: string; line: number; name: string; kind: string }

const DECL = /^(?:export )?(?:declare )?(const|function|class|interface|type|enum) ([\w$]+)/;

/** Follows what `name` refers to inside a file, through re-exports · import aliases. */
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

/** Every name an entry file exports. */
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
 * A member line. Only those starting at 4-space indent — anything deeper is inside a member's type.
 *
 * Not checked: `private` (only the name remains in `.d.ts` and users cannot call it),
 * `constructor` (the public classes are all exported as types only — users have no
 * reason to `new` them), call · index signatures (the interface's own comment
 * describes them).
 */
const MEMBER = /^ {4}(?:readonly |static )*([\w$]+)\??[(<:]/;

/** Members of an interface · class, plus members of what it extends. */
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
      // Declaration merging (`interface Ytdlp` + `class Ytdlp`) needs the comment in
      // only one place, since the editor shows them combined.
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
 * Only this one reads the source instead of `lib/`. A file's leading comment attaches
 * to its first statement, and the entry files' first statement is a value import,
 * so `tsc` drops the comment together with that statement during declaration emit.
 */
test('입구 파일마다 @module 주석이 있다', () => {
  for (const src of SOURCES) {
    const head = readFileSync(path.join(ROOT, src), 'utf8').match(/^\/\*\*[\s\S]*?\*\//)?.[0] ?? '';
    assert.match(head, /@module/, `${src} 맨 앞 주석에 @module 이 없다`);
  }
});

/** Extracts the `@example` code blocks from every `.d.ts` in `lib/`. */
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

  // Same shape as types.test.ts — link the repo as node_modules/ytstudio.
  // So examples go through exports and see the shipped build (lib/).
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
  // `export {}` makes each file a module — as scripts, examples would share globals,
  // and an example missing its import would pass thanks to its neighbour.
  found.forEach((ex, i) => writeFileSync(path.join(dir, `ex${i}.ts`), `${ex.code}\nexport {};\n`));

  try {
    execFileSync(TSC, ['-p', dir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const out = (err as { stdout?: string }).stdout ?? '';
    const named = out.replace(/ex(\d+)\.ts/g, (_, n) => `[${found[Number(n)]!.from} 의 예제 ${n}]`);
    assert.fail(`@example 이 컴파일되지 않는다\n${named}`);
  }
});
