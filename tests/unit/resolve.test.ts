/**
 * 스키마를 어디서 집는가.
 *
 * 이 검사가 **여기 있다는 것 자체**가 이번 설계 변경의 요점이다.
 *
 * 예전에는 `core/schema.ts` 가 `export let OPTS/BY_ID/…` 를 들고 `initSchema` 가
 * 그걸 채우는 모양이었다. 그래서 한 프로세스에서 스키마를 두 번 로드하면 앞엣것이
 * 오염됐고 — 그것도 `VERSION` 은 그대로 두고 동작만 바뀌었다 — 해석 순서를 보려면
 * **경우마다 프로세스를 새로 띄우는 수밖에** 없었다. `tests/cli.test.ts` 가 그 일을
 * 하고 있었다.
 *
 * 지금은 스키마가 값이고 `resolveSchema` 가 순수 함수다. 작업 디렉터리와
 * 환경변수까지 인자로 받으므로 `process.chdir` 로 프로세스를 흔들 일도 없다 —
 * 그걸 했으면 같은 프로세스에서 도는 다른 검사 파일에 샜을 것이다.
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

/** 버전만 바꾼 진짜 스키마 한 벌을 디렉터리에 놓는다. */
function dirWith(version: string, opts?: number): string {
  const dir = mkdtempSync(path.join(TMP, 'proj-'));
  writeFileSync(path.join(dir, SCHEMA_FILE), JSON.stringify({
    ...BUNDLED,
    ytdlp_version: version,
    ...(opts === undefined ? {} : { options: BUNDLED.options.slice(0, opts) }),
  }));
  return dir;
}

/** 이름만 같고 우리 것이 아닌 JSON. 남의 프로젝트 루트에 있을 수 있다. */
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

// 조용히 내장으로 떨어지면 엉뚱한 버전으로 검사해 놓고 통과했다고 말하게 된다.
test('가리킨 것이 헛다리면 던진다 — 조용히 안 넘어간다', () => {
  assert.throws(() => resolveSchema({ env: path.join(TMP, '없다.json') }), /읽지 못했다/);
});

// 작업 디렉터리 쪽은 반대로 조용히 넘어간다 — 남의 파일을 집은 것뿐이다.
test('우리 것이 아닌 JSON 은 없는 것으로 친다', () => {
  assert.equal(resolveSchema({ cwd: decoy }).source.from, 'bundled');
});

test('저장소 안에서 부르면 저장소 스키마를 집는다', () => {
  const { source } = resolveSchema({ cwd: ROOT });
  assert.equal(source.from, 'local');
  assert.equal(source.path, path.join(ROOT, SCHEMA_FILE));
});

// ── 여기부터가 예전에 불가능했던 것 ──

test('손잡이 둘이 서로를 안 오염시킨다', () => {
  const a = ytstudio({ cwd: empty });                     // 내장 191개
  const b = ytstudio({ cwd: dirWith('9999.01.01', 5) });  // 5개짜리

  assert.equal(a.schema.opts.length, BUNDLED.options.length);
  assert.equal(b.schema.opts.length, 5);

  // b 를 만든 뒤에도 a 는 그대로다. 예전에는 여기서 a 가 b 의 스키마를 봤다.
  assert.equal(a.lint('yt-dlp --write-subs https://y.be/a').counts.error, 0);
  assert.equal(b.lint('yt-dlp --write-subs https://y.be/a').counts.error, 1);
  assert.equal(a.source.version, BUNDLED.ytdlp_version);
});

// 옵션 메서드는 프로토타입에 심긴다. 예전에는 Ytdlp.prototype 한 곳이라
// 나중 스키마가 앞엣것을 덮었다 — 지금은 스키마마다 제 하위 클래스다.
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
