#!/usr/bin/env node
/**
 * 개발 서버 스모크.
 *
 * 이제 앱을 띄우는 길이 둘이다 — vite(개발)와 build.py(배포). 둘은 서로
 * 다른 방식으로 깨진다.
 *
 *   배포만 깨짐  새 모듈을 MODULES 에 안 적었다  → build.py 가 잡는다
 *   개발만 깨짐  app.js 가 import 없이 심볼을 썼다 → 여기서 잡는다
 *                (배포는 한 스코프로 합쳐서 돌아가므로 안 걸린다)
 *
 * 그래서 이 스모크는 "vite 로 띄워서 콘솔이 조용한가"만 본다. 기능 검증은
 * e2e 가 dist 를 상대로 한다.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BUNDLED = '/opt/pw-browsers/chromium';
const NOISE = /ERR_CONNECTION_RESET|ERR_FAILED|ERR_BLOCKED_BY_CLIENT/;

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
vite.stdout.on('data', d => { log += d; });
vite.stderr.on('data', d => { log += d; });

const stop = () => { try { vite.kill('SIGTERM'); } catch {} };
process.on('exit', stop);

async function waitReady(ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (/ready in|Local:/.test(log)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

console.log('\n▸ 개발 서버 스모크');
if (!await waitReady()) {
  console.log('  ✗ vite 가 안 떴다\n' + log);
  stop();
  process.exit(1);
}

const exe = process.env.CHROMIUM_PATH || (fs.existsSync(BUNDLED) ? BUNDLED : null);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

const errs = [];
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

const results = [];
const check = (name, cond, note = '') => {
  results.push(cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${note ? ' — ' + note : ''}`);
};

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  // 고정 대기는 vite 의 첫 의존성 최적화와 경합한다. 앱이 그려질 때까지 기다린다.
  await page.locator('.ak-put textarea').first().waitFor({ timeout: 20000 }).catch(() => {});

  // 화면이 둘이라 import 빠짐도 두 갈래로 난다. 프롬프트 쪽을 먼저 밟는다.
  check('프롬프트 화면이 뜬다', (await page.locator('.ak-put textarea').count()) === 1);
  await page.fill('.ak-cmd-box', 'yt-dlp -f "bv+ba/" --write-sub https://youtu.be/x');
  await page.waitForTimeout(300);
  check('검증기가 돈다', (await page.textContent('.rp-issues')).includes('-f 값을 읽지 못했다'));
  check('판독이 그려진다', (await page.locator('.rp-verdict').count()) === 1);
  await page.click('.br-open');
  await page.locator('.br-chip').first().click();
  await page.waitForTimeout(250);
  check('옵션 찾아보기가 열린다', (await page.locator('.br-row').count()) >= 3,
    `${await page.locator('.br-row').count()}개`);

  await page.fill('.ak-cmd-box', '');
  await page.click('#view-graph');
  await page.locator('.node').first().waitFor({ timeout: 20000 }).catch(() => {});
  check('그래프 화면이 뜬다', (await page.locator('.node').count()) === 2);
  // 노드는 캔버스 라이브러리의 그림자 DOM 밖(light DOM)에 있어야 app.css 가 닿는다.
  check('CSS 가 붙었다',
    await page.evaluate(() => getComputedStyle(document.querySelector('.node')).width === '300px'));
  check('스키마가 JSON import 로 들어온다', (await page.textContent('#ver')).includes('개 옵션'),
    (await page.textContent('#ver')).trim());

  // 얕게 훑으면 못 잡는다. import 빠짐은 그 심볼이 실제로 불릴 때만 터지므로,
  // 명령어 하나를 읽혀 옵션 행·서브그래프 진입까지 실사용 경로를 밟는다.
  await page.click('#import');
  await page.fill('#paste',
    'yt-dlp -f "bv*[height<=1080]+ba/b" -o "%(uploader)s/%(title)s.%(ext)s" '
    + '-P home:/dl -P temp:/tmp --embed-subs --sub-langs ko,en https://youtu.be/x');
  await page.click('#do-import');
  await page.waitForTimeout(400);
  check('명령어를 읽어 그래프를 세운다', (await page.locator('.node').count()) >= 5,
    `노드 ${await page.locator('.node').count()}개`);
  check('옵션 행이 그려진다', (await page.locator('.row').count()) >= 4,
    `행 ${await page.locator('.row').count()}개`);

  // 서브그래프 세 개를 차례로 열고 닫는다 — 레지스트리·본문·배선을 전부 밟는다
  for (const opt of ['format', 'output', 'paths']) {
    await page.locator(`.row[data-opt=${opt}] .row-sub`).click();
    await page.waitForTimeout(320);
    const inside = (await page.locator('.node').count()) > 0
      && !(await page.locator('#crumb').isHidden());
    check(`서브그래프 진입: ${opt}`, inside);
    await page.click('#crumb-back');
    await page.waitForTimeout(220);
  }

  check('콘솔이 조용하다', errs.length === 0, errs.join(' / '));
} catch (e) {
  check('스모크 진행', false, e.message);
} finally {
  await browser.close().catch(() => {});
  stop();
}

const failed = results.filter(r => !r).length;
console.log(`  ${failed ? '✗' : '✓'} 개발 서버: ${results.length - failed} 통과${failed ? ` · ${failed} 실패` : ''}`);
process.exit(failed ? 1 : 0);
