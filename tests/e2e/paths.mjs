/**
 * 저장 경로 서브그래프
 *
 * 항목마다 -P 가 하나씩 붙는다. 값 안에 템플릿이 없고 TYPES 가 키다.
 */
export const name = '저장 경로 서브그래프';

export default async function ({ p, step, assert, dialogs, setDialog }) {
  const cmd = () => p.textContent('#cmd');
  const expr = () => p.evaluate(() => __yt.pathExpr());

  async function setup(command) {
    await p.evaluate(() => localStorage.clear());
    await p.reload(); await p.waitForTimeout(250);
    await p.click('#import');
    await p.fill('#paste', command);
    await p.click('#do-import');
    await p.waitForTimeout(300);
  }
  const enter = async () => {
    await p.locator('.node').filter({ hasText: '[store]' })
      .locator('.row[data-opt=paths] .row-sub').click();
    await p.waitForTimeout(300);
  };

  await step('-P 는 여러 번 읽히고 여러 번 나간다', async () => {
    await setup('yt-dlp -P home:/dl -P temp:/tmp/yt https://a');
    const v = await p.evaluate(() => {
      const n = Object.values(__yt.state.nodes).find(x => x.stage === 'store');
      return n.values.paths;
    });
    assert(v === 'home:/dl\ntemp:/tmp/yt', '읽기 결과: ' + JSON.stringify(v));
    const c = await cmd();
    assert(c.includes('-P home:/dl') && c.includes('-P temp:/tmp/yt'), '명령어: ' + c);
    return c.trim();
  });

  await step('진입: 줄마다 항목 노드가 된다', async () => {
    await enter();
    assert(!(await p.locator('#crumb').isHidden()), '브레드크럼이 안 뜸');
    const kinds = await p.evaluate(() =>
      Object.values(__yt.state.paths.nodes).map(n => n.type).sort().join(','));
    assert(kinds === 'path,path,pout', '노드 구성: ' + kinds);
    assert(await expr() === 'home:/dl\ntemp:/tmp/yt', 'expr: ' + JSON.stringify(await expr()));
    const here = (await p.textContent('#crumb .here')).replace(/\s+/g, ' ').trim();
    assert(here.startsWith('[store] 저장 경로') && here.includes('/dl 외 1개'), '브레드크럼: ' + here);
    return here;
  });

  await step('경로를 고치면 -P 가 따라 바뀐다', async () => {
    const first = p.locator('.node').filter({ hasText: '[path]' }).first();
    await first.locator('input[data-ctl=path]').fill('/mnt/videos');
    await p.waitForTimeout(250);
    assert(await expr() === 'home:/mnt/videos\ntemp:/tmp/yt', 'expr: ' + await expr());
    assert((await cmd()).includes('-P home:/mnt/videos'), '명령어: ' + await cmd());
    return await expr();
  });

  await step('종류를 바꾸면 접두어가 바뀐다', async () => {
    const first = p.locator('.node').filter({ hasText: '[path]' }).first();
    await first.locator('select[data-ctl=pathtype]').selectOption('subtitle');
    await p.waitForTimeout(250);
    assert(await expr() === 'subtitle:/mnt/videos\ntemp:/tmp/yt', 'expr: ' + await expr());
    await first.locator('select[data-ctl=pathtype]').selectOption('');
    await p.waitForTimeout(250);
    assert(await expr() === '/mnt/videos\ntemp:/tmp/yt', '접두어 제거: ' + await expr());
    await first.locator('select[data-ctl=pathtype]').selectOption('home');
    await p.waitForTimeout(250);
    return 'subtitle: → (없음) → home:';
  });

  await step('항목을 더하면 -P 가 하나 더 붙는다', async () => {
    await p.click('.pal-item[data-fnode=path]');
    await p.waitForTimeout(250);
    // 아직 안 이어졌다
    assert(await p.locator('.node.bypass:not(.io)').count() === 1, '끊김 표시가 없다');
    assert((await p.textContent('#notes')).includes('이어지지'), '보고가 없다');

    await p.evaluate(() => {
      const g = __yt.state.paths;
      const loose = Object.values(g.nodes).find(n => n.type === 'path' && !g.edges.some(e => e.from === n.id));
      loose.pathType = 'thumbnail'; loose.path = '/dl/thumbs';
      loose.y = Math.max(...Object.values(g.nodes).map(n => n.y)) + 200;
      __yt.connect(loose.id, 'pout', g);
      __yt.render();
    });
    await p.waitForTimeout(250);
    assert(await expr() === 'home:/mnt/videos\ntemp:/tmp/yt\nthumbnail:/dl/thumbs',
      'expr: ' + await expr());
    const c = await cmd();
    assert((c.match(/-P /g) || []).length === 3, `-P 가 3번 안 나온다: ${c}`);
    return c.trim();
  });

  await step('세로 위치가 순서를 정한다', async () => {
    await p.evaluate(() => {
      const g = __yt.state.paths;
      const th = Object.values(g.nodes).find(n => n.pathType === 'thumbnail');
      th.y = Math.min(...Object.values(g.nodes).map(n => n.y)) - 300;
      __yt.render();
    });
    await p.waitForTimeout(250);
    assert((await expr()).startsWith('thumbnail:/dl/thumbs'), 'expr: ' + await expr());
    await p.click('#autolayout');
    await p.waitForTimeout(300);
    assert((await expr()).startsWith('thumbnail:/dl/thumbs'), '정렬이 순서를 바꿨다');
    return await expr();
  });

  await step('같은 종류를 두 번 주면 알려 준다', async () => {
    await setup('yt-dlp -P home:/a -P home:/b https://x');
    await enter();
    const notes = await p.textContent('#notes');
    assert(notes.includes('두 번'), '경고가 없다: ' + notes);
    return notes.slice(0, 70);
  });

  await step('윈도 경로를 종류로 오인하지 않는다', async () => {
    await setup('yt-dlp -P "C:/dl/videos" https://x');
    await enter();
    const t = await p.evaluate(() => {
      const n = Object.values(__yt.state.paths.nodes).find(x => x.type === 'path');
      return [n.pathType, n.path].join('|');
    });
    assert(t === '|C:/dl/videos', '잘못 잘렸다: ' + t);
    assert(await expr() === 'C:/dl/videos', 'expr: ' + await expr());
    return t;
  });

  await step('세 서브그래프가 한 저장물 안에서 공존한다', async () => {
    await setup('yt-dlp -f "bv+ba/b" -o "%(title)s.%(ext)s" -P home:/dl -P temp:/tmp https://x');
    const all = await p.evaluate(() =>
      [__yt.formatExpr(), __yt.outExpr(), __yt.pathExpr()].join(' ‖ '));
    assert(all === 'bv+ba/b ‖ %(title)s.%(ext)s ‖ home:/dl\ntemp:/tmp', all);

    // 셋을 차례로 열었다 닫아도 서로를 상하게 하지 않는다
    for (const opt of ['format', 'output', 'paths']) {
      await p.locator(`.row[data-opt=${opt}] .row-sub`).click();
      await p.waitForTimeout(280);
      await p.click('#crumb-back');
      await p.waitForTimeout(200);
    }
    const after = await p.evaluate(() =>
      [__yt.formatExpr(), __yt.outExpr(), __yt.pathExpr()].join(' ‖ '));
    assert(after === all, `왕복 후 달라졌다\n${all}\n${after}`);
    return all.replace('\n', ' / ');
  });

  await step('localStorage: 세 서브그래프 모두 복원', async () => {
    await enter();
    const before = await p.evaluate(() =>
      [__yt.formatExpr(), __yt.outExpr(), __yt.pathExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    await p.waitForTimeout(400);
    await p.reload();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() =>
      [__yt.formatExpr(), __yt.outExpr(), __yt.pathExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    assert(before === after, `불일치\n${before}\n${after}`);
    return after.split('|')[4];
  });
}
