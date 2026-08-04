/**
 * e2e 스위트 공용 하네스.
 *
 * 앱은 의존성 0 의 단일 HTML 이라 테스트도 그 산출물(dist/ytdlp-studio.html)을
 * file:// 로 직접 연다. 서버가 없으니 띄울 것도 없다.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const APP_URL = 'file://' + path.join(ROOT, 'dist', 'ytdlp-studio.html');

// 이 컨테이너에는 미리 받아 둔 크로미움이 있다. 없으면 playwright 기본값을 쓴다.
const BUNDLED = '/opt/pw-browsers/chromium';
const launchOpts = () => {
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync(BUNDLED) ? BUNDLED : null);
  return exe ? { executablePath: exe } : {};
};

// 앱이 Google Fonts CDN 을 참조한다. 오프라인에서 로드가 늘어지지 않게 잘라낸다.
const FONT_CDN = /fonts\.(googleapis|gstatic)\.com/;
// 그 차단 때문에 생기는 소음. 앱의 결함이 아니다.
const NOISE = /ERR_CONNECTION_RESET|ERR_FAILED|ERR_BLOCKED_BY_CLIENT/;

export class Failed extends Error {}
export function assert(cond, msg) {
  if (!cond) throw new Failed(msg);
}

/**
 * 스위트 하나를 브라우저 하나로 돌린다.
 * body 는 { p, step, dialogs, setDialog } 를 받는다.
 */
export async function runSuite(name, body, { view = 'ask' } = {}) {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'ytdlp-studio.html')))
    throw new Error('dist/ytdlp-studio.html 이 없다. 먼저 `python3 build.py` 를 돌려라.');

  const browser = await chromium.launch(launchOpts());
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // 앱은 프롬프트 화면으로 열린다. 캔버스를 보는 스위트는 그 화면을 미리
  // 골라 둔다 — 스위트 안에서 reload 를 해도 계속 유지되도록 초기 스크립트로.
  if (view === 'graph') {
    await p.addInitScript(() => { localStorage.setItem('ytstudio.view', 'graph'); });
  }
  p.setDefaultTimeout(8000);
  p.setDefaultNavigationTimeout(30000);
  await p.route(FONT_CDN, r => r.abort());

  const consoleErrors = [];
  p.on('console', m => {
    if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text());
  });
  p.on('pageerror', e => consoleErrors.push('PAGEERROR ' + e.message));

  const dialogs = [];
  let dialogAction = 'accept';
  const setDialog = a => { dialogAction = a; };
  p.on('dialog', d => {
    dialogs.push(d.message());
    dialogAction === 'accept' ? d.accept() : d.dismiss();
  });

  const results = [];
  const step = async (title, fn) => {
    try {
      const note = await fn();
      results.push({ title, ok: true, note });
      console.log(`  ✓ ${title}${note ? ` — ${note}` : ''}`);
    } catch (e) {
      results.push({ title, ok: false, note: e.message });
      console.log(`  ✗ ${title} — ${e.message}`);
    }
  };

  console.log(`\n▸ ${name}`);
  let fatal = null;
  try {
    await p.goto(APP_URL);
    await p.waitForTimeout(250);
    await body({ p, step, dialogs, setDialog, assert });
  } catch (e) {
    fatal = e;
    console.log(`  ✗✗ 스위트 중단 — ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
  }

  for (const e of consoleErrors) console.log(`  ! 콘솔: ${e}`);

  return {
    name,
    passed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length + (fatal ? 1 : 0),
    consoleErrors,
  };
}
