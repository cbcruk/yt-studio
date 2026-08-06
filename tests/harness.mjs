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

/* ── 저장을 기다렸다가 새로고침 ──────────── */
// 앱의 저장은 250ms 디바운스이고, 렌더가 돌 때마다 타이머가 처음부터 다시
// 시작한다(app.js 의 save). 그래서 "조금 기다렸다가 reload" 는 러너가 느리면
// 진다 — 저장 전에 새로고침하면 복원할 게 없어서, 복원 테스트가 빈 상태를
// 보고 실패한다. 실제로 CI 에서 이걸로 한 번 깨졌다.
const SAVE_DEBOUNCE = 250;

/** 저장소에 든 것 전부. 어느 키가 늦게 써지든 걸리도록 한꺼번에 본다. */
const storeDump = p => p.evaluate(() =>
  JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('ytstudio.'))
    .sort().map(k => [k, localStorage.getItem(k)])));

/**
 * 저장이 **멎을 때까지** 기다린다.
 *
 * 디바운스보다 긴 시간 동안 저장소가 안 바뀌면 대기 중인 타이머가 없다는 뜻이다.
 * 시계를 재는 게 아니라 값이 멎는 것을 보므로 러너 속도와 무관하다.
 */
export async function settled(p, quiet = SAVE_DEBOUNCE + 50, cap = 5000) {
  const deadline = Date.now() + cap;
  let prev = null, since = Date.now();
  for (;;) {
    const cur = await storeDump(p);
    if (cur !== prev) { prev = cur; since = Date.now(); }
    else if (Date.now() - since >= quiet) return;
    // 저장이 안 멎으면 조용히 매달려 있지 말고 그렇다고 말한다
    if (Date.now() > deadline) throw new Failed(`${cap}ms 동안 저장이 안 멎었다`);
    await p.waitForTimeout(50);
  }
}

/** 저장이 끝난 뒤 새로고침하고, 앱이 다시 설 때까지 기다린다. */
export async function reloadSaved(p) {
  await settled(p);
  await p.reload();
  await p.waitForFunction(() => !!window.__yt);
  await p.waitForTimeout(120);          // 첫 렌더가 한 틱 뒤에 온다
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
