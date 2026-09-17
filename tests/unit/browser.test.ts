/**
 * Is the browser entry point really pure?
 *
 * `yt-studio/browser` makes one promise — **it never touches the file system.**
 * Calling functions cannot confirm that; a test that only walks paths not calling
 * `readFileSync` would pass anyway. There is only one way to confirm it: **bundle
 * it** for the browser and see whether any node builtin comes along.
 *
 * Without this test, a single `node:path` sneaking into `src/browser.ts` would
 * pass every test running on node and only break when the demo page loads.
 */
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { RawSchema } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'yt-studio.schema.json'), 'utf8'));

const bundle = await Bun.build({
  entrypoints: [path.join(ROOT, 'src/browser.ts')],
  target: 'browser',
  minify: true,
});

test('브라우저용으로 묶인다', () => {
  assert.equal(bundle.success, true, bundle.logs.join('\n'));
});

test('노드 빌트인이 하나도 안 딸려 온다', async () => {
  const js = await bundle.outputs[0]!.text();
  const found = [...new Set(js.match(/node:[a-z_]+/g) ?? [])];
  assert.deepEqual(found, [], `브라우저 입구에 노드 빌트인이 샜다: ${found.join(' ')}`);
});

// The demo page downloads this whole, so its size is the time users wait.
// The exact number does not matter; we need to know when the order of magnitude changes.
test('묶은 것이 작다 — 50KB 아래', async () => {
  const js = await bundle.outputs[0]!.text();
  expect(js.length).toBeLessThan(50_000);
});

test('스키마를 직접 주면 손잡이가 된다', async () => {
  const { studio } = await import('../../src/browser.js');
  const yt = studio(RAW);
  assert.equal(yt.schema.opts.length, RAW.options.length);
  assert.equal(yt.ytdlp('https://youtu.be/abc').extractAudio().build(),
    'yt-dlp -x https://youtu.be/abc');
  assert.equal(yt.lint('yt-dlp --write-sub https://youtu.be/abc').counts.error, 1);
});

// Which version autocomplete came from must be answerable in the browser too —
// the answer used to live only in a **file** shipped with the package.
test('타입 버전을 파일 없이 안다', async () => {
  const { studio, TYPES_VERSION } = await import('../../src/browser.js');
  assert.equal(TYPES_VERSION, RAW.ytdlp_version);

  const yt = studio(RAW);
  assert.equal(yt.source.from, 'given');
  assert.equal(yt.source.stale, false);

  const other = studio({ ...RAW, ytdlp_version: '2099.01.01' });
  assert.equal(other.source.stale, true, '타입과 갈렸으면 갈렸다고 말해야 한다');
  assert.equal(other.source.typesVersion, TYPES_VERSION);
});
