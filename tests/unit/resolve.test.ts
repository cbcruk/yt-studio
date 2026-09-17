/**
 * Where the schema is picked up from.
 *
 * **The mere fact that this test lives here** is the point of this design change.
 *
 * `core/schema.ts` used to hold `export let OPTS/BY_ID/…` filled in by `initSchema`.
 * So loading a schema twice in one process polluted the first one — and changed only
 * behaviour while leaving `VERSION` as is — and checking resolution order left **no
 * option but a fresh process per case**. `tests/cli.test.ts` was doing that.
 *
 * Now the schema is a value and `resolveSchema` is a pure function. It takes even the
 * working directory and environment variables as arguments, so there is no need to
 * shake the process with `process.chdir` — doing so would have leaked into other test
 * files running in the same process.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import type { RawSchema } from '../../src/core/schema.js';

const { BUNDLED, resolveSchema, ytstudio } = await import('../../src/index.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-resolve-'));
const SCHEMA_FILE = 'ytstudio.schema.json';

/** Puts a copy of the real schema, with only the version changed, into a directory. */
function dirWith(version: string, opts?: number): string {
  const dir = mkdtempSync(path.join(TMP, 'proj-'));
  writeFileSync(path.join(dir, SCHEMA_FILE), JSON.stringify({
    ...BUNDLED,
    ytdlp_version: version,
    ...(opts === undefined ? {} : { options: BUNDLED.options.slice(0, opts) }),
  }));
  return dir;
}

/** JSON with the same name that is not ours. Could sit at the root of someone else's project. */
const decoy = ((): string => {
  const dir = path.join(TMP, 'decoy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SCHEMA_FILE),
    JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema' }));
  return dir;
})();

const empty = ((): string => {
  const dir = path.join(TMP, 'empty');
  mkdirSync(dir, { recursive: true });
  return dir;
})();

test('아무것도 없으면 패키지 내장을 쓴다', () => {
  const { source } = resolveSchema({ cwd: empty });
  assert.equal(source.from, 'bundled');
  assert.equal(source.version, BUNDLED.ytdlp_version);
  assert.equal(source.stale, false);
});

test('작업 디렉터리의 ytstudio.schema.json 이 내장을 이긴다', () => {
  const { source, raw } = resolveSchema({ cwd: dirWith('2026.09.01') });
  assert.equal(source.from, 'local');
  assert.equal(raw.ytdlp_version, '2026.09.01');
  assert.equal(source.stale, true, '타입은 번들 기준이라 갈렸다고 말해야 한다');
  assert.equal(source.typesVersion, BUNDLED.ytdlp_version);
});

test('명시적으로 가리킨 것이 가장 세다 — 환경변수 > 작업 디렉터리 > 내장', () => {
  const local = dirWith('2026.09.01');
  const pointed = path.join(dirWith('2030.12.31'), SCHEMA_FILE);
  const { source } = resolveSchema({ cwd: local, env: pointed });
  assert.equal(source.from, 'env');
  assert.equal(source.version, '2030.12.31');
});

// Silently falling back to bundled would check against the wrong version and report a pass.
test('가리킨 것이 헛다리면 던진다 — 조용히 안 넘어간다', () => {
  assert.throws(() => resolveSchema({ env: path.join(TMP, '없다.json') }), /읽지 못했다/);
});

// The working-directory side, conversely, moves on quietly — it just picked up someone else's file.
test('우리 것이 아닌 JSON 은 없는 것으로 친다', () => {
  assert.equal(resolveSchema({ cwd: decoy }).source.from, 'bundled');
});

test('저장소 안에서 부르면 저장소 스키마를 집는다', () => {
  const { source } = resolveSchema({ cwd: ROOT });
  assert.equal(source.from, 'local');
  assert.equal(source.path, path.join(ROOT, SCHEMA_FILE));
});

// ── From here on: what used to be impossible ──

test('손잡이 둘이 서로를 안 오염시킨다', () => {
  const a = ytstudio({ cwd: empty });                     // bundled, 191
  const b = ytstudio({ cwd: dirWith('9999.01.01', 5) });  // only 5

  assert.equal(a.schema.opts.length, BUNDLED.options.length);
  assert.equal(b.schema.opts.length, 5);

  // a is unchanged even after creating b. It used to see b's schema here.
  assert.equal(a.lint('yt-dlp --write-subs https://y.be/a').counts.error, 0);
  assert.equal(b.lint('yt-dlp --write-subs https://y.be/a').counts.error, 1);
  assert.equal(a.source.version, BUNDLED.ytdlp_version);
});

// Option methods are planted on the prototype. It used to be the single Ytdlp.prototype,
// so a later schema overwrote the earlier one — now each schema gets its own subclass.
test('빌더 메서드도 손잡이마다 다르다', () => {
  const a = ytstudio({ cwd: empty });
  const b = ytstudio({ cwd: dirWith('9999.01.01', 5) });

  const has = (yt: { ytdlp: () => unknown }, m: string): boolean =>
    typeof (yt.ytdlp() as Record<string, unknown>)[m] === 'function';

  assert.equal(has(a, 'writeSubs'), true);
  assert.equal(has(b, 'writeSubs'), false, '5개짜리 스키마에는 없는 옵션이다');
});

test('스키마를 직접 줄 수도 있다 — 파일을 안 거친다', () => {
  const raw: RawSchema = { ...BUNDLED, ytdlp_version: '2100.01.01', options: BUNDLED.options.slice(0, 3) };
  const yt = ytstudio({ raw });
  assert.equal(yt.schema.opts.length, 3);
  assert.equal(yt.source.version, '2100.01.01');
  assert.equal(yt.source.stale, true);
});
