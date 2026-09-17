/**
 * Does the demo really run? — launch a browser and look.
 *
 * The page's two promises can be confirmed **only inside a browser**.
 *
 *   1. Autocomplete comes from the shipped `.d.ts` — meaning the in-browser
 *      TypeScript actually resolved the types placed on the virtual file system.
 *      If module resolution goes wrong, the list is entirely empty while the page
 *      looks fine.
 *   2. User code becomes a command — transpiled, run, and all the way to the check.
 *
 * Neither can be seen by tests running on node. That is why this exists.
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
 * Where the page is served.
 *
 * GitHub Pages serves under `/<repo>/`. The build bakes that into asset paths, so
 * serving at the root here would test **a page whose assets all 404**. Nine checks
 * would then break at once, while the cause is a single asset path.
 *
 * So serve it at the same place the build used. This value is what is under test —
 * if subpath deployment is broken, it gets caught here.
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

// Use an already-installed chromium if there is one (CI · this container). Otherwise playwright finds one.
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

// yt-dlp's description in the schema becomes JSDoc in the `.d.ts`, which shows up as an
// editor tooltip. Whether that whole chain is connected is visible only here.
await check('마우스오버에 옵션 설명이 뜬다', async () => {
  await page.locator('.view-lines').getByText('extractAudio', { exact: true }).hover();
  await page.waitForSelector('.monaco-hover-content', { timeout: 20_000 });
  const hover = await page.textContent('.monaco-hover-content');
  assert.match(hover!, /audio-only/, `yt-dlp 설명문이 안 왔다: ${hover}`);
});

// This check is why this file exists. There is no way outside a browser to confirm the
// list comes from the shipped `.d.ts`.
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

// `#diags` already shows the error (`em`) left by the check above. Wait not for it to be
// visible but for **its text to change**.
await check('없는 옵션은 타입 오류가 된다', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('bedThumbnailz');
  await page.waitForFunction(
    () => document.querySelector('#diags')?.textContent?.includes('embedThumbnailz'),
    null, { timeout: 20_000 });
});

// Not only option names but **values** have lists. Those lists come from Python constants
// and travel through the schema · `.d.ts` to here, so if any link in the chain breaks,
// this comes up empty.
await check('값의 자동완성도 뜬다 — yt-dlp 가 정한 목록', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+End');
  await page.keyboard.type("\nytdlp().convertSubs('");
  // A quote is not a TypeScript trigger character — the value list has to be invoked.
  // That is why the page header says Ctrl+Space.
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.suggest-widget.visible', { timeout: 20_000 });
  const rows = (await page.locator('.suggest-widget .monaco-list-row').allTextContents()).join(' ');
  for (const v of ['srt', 'vtt', 'ass', 'lrc', 'none']) {
    assert.ok(rows.includes(v), `값 목록에 ${v} 가 없다 — 뜬 것: ${rows.slice(0, 200)}`);
  }
});

// Tabs are picked by name — picking by position breaks every time an example is inserted.
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
