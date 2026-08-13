/**
 * 브라우저 입구가 정말 순수한가.
 *
 * `ytstudio/browser` 의 약속은 하나다 — **파일 시스템을 안 본다.** 그건
 * 함수를 불러 보는 것으로는 확인이 안 된다. `readFileSync` 를 부르지 않는
 * 경로만 밟아도 통과해 버리니까. 확인하는 방법은 하나뿐이다: 브라우저용으로
 * **묶어 보고** 노드 빌트인이 하나라도 딸려 오는지 본다.
 *
 * 이 검사가 없으면 `src/browser.ts` 어딘가에 `node:path` 하나가 스며들어도
 * 노드에서 도는 검사는 전부 통과하고, 데모 페이지를 띄울 때에야 깨진다.
 */
import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { RawSchema } from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'ytstudio.schema.json'), 'utf8'));

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

// 데모 페이지가 통째로 받아 가는 것이라 크기가 곧 사용자가 기다리는 시간이다.
// 정확한 수는 중요하지 않고, 자릿수가 바뀌면 알아야 한다.
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

// 자동완성이 어느 버전에서 나왔는지는 브라우저에서도 답할 수 있어야 한다 —
// 예전에는 그 답이 패키지에 실린 **파일**에만 있었다.
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
