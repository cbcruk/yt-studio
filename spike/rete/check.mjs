import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const vite = spawn('npx', ['vite', '--port', '5210', '--strictPort'], { stdio: ['ignore','pipe','pipe'] });
let log = ''; vite.stdout.on('data', d => log += d); vite.stderr.on('data', d => log += d);
const stop = () => { try { vite.kill('SIGTERM'); } catch {} };
process.on('exit', stop);
for (let i = 0; i < 100 && !/ready in|Local:/.test(log); i++) await new Promise(r => setTimeout(r, 200));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const ok = [];
const check = (n, c, note='') => { ok.push(c); console.log(`  ${c?'✓':'✗'} ${n}${note?' — '+note:''}`); };

try {
  await p.goto('http://localhost:5210/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  check('노드가 뜬다', await p.locator('.node').count() === 3, `${await p.locator('.node').count()}개`);
  check('본문이 우리 것이다 (.row[data-opt=format])', await p.locator('.row[data-opt=format]').count() === 1);
  check('포트가 붙었다', await p.locator('.port').count() >= 4, `${await p.locator('.port').count()}개`);
  // blankPipeline 이 src→out 을 갖고 있으므로 src→out · src→format · format→out 셋.
  check('와이어가 그려진다', await p.locator('yt-wire path').count() === 3,
        `${await p.locator('yt-wire path').count()}개`);
  const cmd0 = await p.textContent('#cmd');
  check('명령어가 조립된다', cmd0.includes('bv*[height<=1080]+ba/b'), cmd0.trim());

  // 본문 입력 → state 반영
  await p.locator('.row[data-opt=format] input').fill('bv+ba');
  await p.waitForTimeout(400);
  check('본문 편집이 명령어로 간다', (await p.textContent('#cmd')).includes('-f bv+ba'),
        (await p.textContent('#cmd')).trim());

  // 옵션 추가 버튼 → 본문 행이 는다
  const before = await p.locator('.row').count();
  await p.locator('.node').filter({ hasText: '[format]' }).locator('.node-x').first().click();
  await p.waitForTimeout(400);
  check('노드 안 옵션 추가', await p.locator('.row').count() === before + 1);

  // 위치가 순서를 정한다 — 단, 엣지로 순서가 정해지지 않는 형제 노드끼리만.
  // (사슬로 이어 놓으면 위상 정렬이 먼저라 x 를 아무리 끌어도 안 바뀐다.)
  await p.locator('#add').click();               // process 단계 추가
  await p.waitForTimeout(300);
  await p.evaluate(async () => {
    const s = __spike.state;
    const proc = Object.values(s.nodes).find(n => n.stage === 'process');
    s.edges.push({ from: 'src', to: proc.id }, { from: proc.id, to: 'out' });
    s.nodes[proc.id].values['embed-subs'] = true;
    __spike.refresh();
  });
  await p.waitForTimeout(300);
  const at = async x => {
    await p.evaluate(async px => {
      const proc = Object.values(__spike.state.nodes).find(n => n.stage === 'process');
      await __spike.area.translate(proc.id, { x: px, y: 420 });
    }, x);
    await p.waitForTimeout(300);
    return (await p.textContent('#cmd')).trim();
  };
  const right = await at(900), left = await at(-400);
  check('형제 노드는 x 위치가 플래그 순서를 정한다',
        right.indexOf('-f') < right.indexOf('--embed-subs')
     && left.indexOf('--embed-subs') < left.indexOf('-f'),
        `\n      오른쪽: ${right}\n      왼쪽  : ${left}`);

  // 와이어 끊기 → 우회. format 으로 들어가는 것을 끊는다.
  await p.evaluate(async () => {
    const fmt = Object.values(__spike.state.nodes).find(n => n.stage === 'format');
    const c = __spike.editor.getConnections().find(x => x.target === fmt.id);
    await __spike.editor.removeConnection(c.id);
  });
  await p.waitForTimeout(400);
  check('끊으면 우회로 표시된다', (await p.textContent('#notes')).includes('우회'),
        (await p.textContent('#notes')).trim());
  check('끊긴 노드에 bypass 클래스', await p.locator('.node.bypass').count() > 0,
        `${await p.locator('.node.bypass').count()}개`);

  await p.screenshot({ path: 'shot.png' });
  check('콘솔이 조용하다', errs.length === 0, errs.slice(0,2).join(' / '));
} catch (e) {
  check('스파이크 진행', false, e.message);
} finally {
  await b.close().catch(()=>{});
  stop();
}
const f = ok.filter(x => !x).length;
console.log(`\n  ${f ? '✗' : '✓'} ${ok.length - f}/${ok.length} 통과`);
process.exit(f ? 1 : 0);
