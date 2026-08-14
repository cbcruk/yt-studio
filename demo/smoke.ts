/**
 * 데모가 진짜로 도는가 — 브라우저를 띄워서 본다.
 *
 * 이 페이지의 약속 두 개는 **브라우저 안에서만** 확인된다.
 *
 *   1. 배포하는 `.d.ts` 로 자동완성이 뜬다 — 가상 파일 시스템에 얹은 타입을
 *      브라우저 안 타입스크립트가 실제로 풀어냈다는 뜻이다. 모듈 해석이
 *      어긋나면 목록이 통째로 비는데, 화면은 멀쩡해 보인다.
 *   2. 손님 코드가 명령어가 된다 — 트랜스파일하고 돌려서 검사까지 간다.
 *
 * 둘 다 노드에서 도는 검사로는 볼 수 없다. 그래서 여기 있다.
 *
 *   bun run build && bun smoke.ts
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const DIST = path.join(import.meta.dirname, 'dist');
const TYPE: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.ttf': 'font/ttf',
};

/**
 * 페이지가 놓일 자리.
 *
 * GitHub Pages 는 `/<repo>/` 아래다. 빌드가 그걸 자산 경로에 박으므로, 여기서
 * 루트에 놓고 보면 **자산이 전부 404 인 페이지**를 검사하게 된다. 그러면 아홉
 * 가지가 한꺼번에 깨지는데 원인은 자산 하나다.
 *
 * 그래서 빌드가 쓴 것과 같은 자리에 놓는다. 이 값이 곧 검사 대상이다 —
 * 하위 경로 배포가 깨져 있으면 여기서 걸린다.
 */
const BASE = (process.env.DEMO_BASE ?? '/').replace(/\/*$/, '/');

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const rel = url.startsWith(BASE) ? url.slice(BASE.length - 1) : url;
  const file = path.join(DIST, rel === '/' ? 'index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPE[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise<void>(r => server.listen(0, r));
const port = (server.address() as { port: number }).port;

// 이미 깔린 크로미움이 있으면 그걸 쓴다(CI · 이 컨테이너). 없으면 playwright 가 찾는다.
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();

const problems: string[] = [];
page.on('pageerror', e => problems.push(`페이지 오류: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') problems.push(`콘솔: ${m.text()}`); });

let failed = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((e: Error) => { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); });

await page.goto(`http://127.0.0.1:${port}${BASE}`, { waitUntil: 'networkidle' });

await check('첫 예제가 명령어가 된다', async () => {
  await page.waitForFunction(() => document.querySelector('#command code')?.textContent?.length, null, { timeout: 20_000 });
  const cmd = await page.textContent('#command code');
  assert.equal(cmd, 'yt-dlp -x --audio-format mp3 --embed-thumbnail https://youtu.be/dQw4w9WgXcQ');
});

await check('검사와 설명이 같이 나온다', async () => {
  assert.match((await page.textContent('#verdict'))!, /확인됨/);
  assert.equal((await page.locator('#explain li').all()).length, 4);
  assert.match((await page.textContent('#file'))!, /‹제목›/);
});

await check('스키마 버전과 옵션 수를 화면에 적는다', async () => {
  assert.match((await page.textContent('#meta'))!, /yt-dlp \d{4}\.\d{2}\.\d{2} · 옵션 \d+개/);
});

// 스키마에 있던 yt-dlp 의 설명문이 `.d.ts` 의 JSDoc 이 되고, 그게 에디터
// 툴팁으로 뜬다. 그 사슬 전체가 이어져 있는지는 여기서만 보인다.
await check('마우스오버에 옵션 설명이 뜬다', async () => {
  await page.locator('.view-lines').getByText('extractAudio', { exact: true }).hover();
  await page.waitForSelector('.monaco-hover-content', { timeout: 20_000 });
  const hover = await page.textContent('.monaco-hover-content');
  assert.match(hover!, /audio-only/, `yt-dlp 설명문이 안 왔다: ${hover}`);
});

// 이 검사가 이 파일의 존재 이유다. 목록이 배포하는 `.d.ts` 에서 나온다는 것을
// 브라우저 밖에서는 확인할 방법이 없다.
await check('자동완성이 배포하는 .d.ts 에서 나온다', async () => {
  await page.click('.editor');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nytdlp().em');
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.suggest-widget.visible', { timeout: 20_000 });
  const rows = await page.locator('.suggest-widget .monaco-list-row').allTextContents();
  const joined = rows.join(' ');
  for (const m of ['embedThumbnail', 'embedSubs', 'embedMetadata']) {
    assert.ok(joined.includes(m), `자동완성에 ${m} 이 없다 — 뜬 것: ${joined.slice(0, 200)}`);
  }
});

// `#diags` 는 위 검사가 남긴 오류(`em`)로 이미 떠 있다. 보이는지가 아니라
// **글자가 바뀌는지**를 기다려야 한다.
await check('없는 옵션은 타입 오류가 된다', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('bedThumbnailz');
  await page.waitForFunction(
    () => document.querySelector('#diags')?.textContent?.includes('embedThumbnailz'),
    null, { timeout: 20_000 });
});

// 옵션 이름만이 아니라 **값**도 목록이 있다. 그 목록은 파이썬 상수에서
// 나와서 스키마 · `.d.ts` 를 거쳐 여기까지 온 것이라, 사슬 중 한 칸이라도
// 끊기면 이 칸이 빈다.
await check('값의 자동완성도 뜬다 — yt-dlp 가 정한 목록', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+End');
  await page.keyboard.type("\nytdlp().convertSubs('");
  // 따옴표는 타입스크립트의 트리거 문자가 아니다 — 값 목록은 불러야 뜬다.
  // 페이지 머리에 Ctrl+Space 라고 적어 둔 것이 이 때문이다.
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.suggest-widget.visible', { timeout: 20_000 });
  const rows = (await page.locator('.suggest-widget .monaco-list-row').allTextContents()).join(' ');
  for (const v of ['srt', 'vtt', 'ass', 'lrc', 'none']) {
    assert.ok(rows.includes(v), `값 목록에 ${v} 가 없다 — 뜬 것: ${rows.slice(0, 200)}`);
  }
});

// 탭은 이름으로 고른다 — 자리로 고르면 예제를 하나 끼워 넣을 때마다 깨진다.
await check('예제 탭을 누르면 그 명령어로 바뀐다', async () => {
  await page.click(`.tabs button:text-is("포맷 식")`);
  await page.waitForFunction(
    () => document.querySelector('#command code')?.textContent?.includes('bv[height<=1080]'),
    null, { timeout: 20_000 });
});

await check('검사 예제는 오류 1 · 경고 2 를 잡는다', async () => {
  await page.click(`.tabs button:text-is("검사")`);
  await page.waitForFunction(
    () => document.querySelector('#verdict')?.textContent?.includes('오류'),
    null, { timeout: 20_000 });
  assert.equal(await page.textContent('#verdict'), '오류 1 · 경고 2');
});

await check('콘솔이 조용하다', () => {
  assert.deepEqual(problems, []);
});

await browser.close();
server.close();

console.log(failed ? `\n${failed} 개 실패` : '\n전부 통과');
process.exit(failed ? 1 : 0);
