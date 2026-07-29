/**
 * 출력 템플릿 서브그래프
 *
 * -o 문자열 ↔ 노드 수열 왕복, 조각 편집, 가로 위치 = 파일명 순서.
 */
export const name = '출력 템플릿 서브그래프';

export default async function ({ p, step, assert, dialogs, setDialog }) {
  const cmd = () => p.textContent('#cmd');
  const expr = () => p.evaluate(() => __yt.outExpr());
  const outVal = () => p.evaluate(() => {
    const n = Object.values(__yt.state.nodes).find(x => x.stage === 'store');
    return n ? n.values.output : null;
  });

  async function setup(command) {
    await p.evaluate(() => localStorage.clear());
    await p.reload(); await p.waitForTimeout(250);
    await p.click('#import');
    await p.fill('#paste', command);
    await p.click('#do-import');
    await p.waitForTimeout(300);
  }
  const enter = async () => {
    await p.locator('.node').filter({ hasText: '[store]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(300);
  };

  await step('진입: -o 문자열이 조각 수열로 풀린다', async () => {
    await setup('yt-dlp -o "%(uploader)s/%(title)s.%(ext)s" https://a');
    await enter();
    assert(!(await p.locator('#crumb').isHidden()), '브레드크럼이 안 뜸');
    const kinds = await p.evaluate(() =>
      Object.values(__yt.state.output.nodes).map(n => n.type).sort().join(','));
    assert(kinds === 'field,field,field,oout,text,text', '노드 구성: ' + kinds);
    assert(await expr() === '%(uploader)s/%(title)s.%(ext)s', 'expr: ' + await expr());
    return kinds + ' → ' + await expr();
  });

  await step('브레드크럼에 사람이 읽는 미리보기가 뜬다', async () => {
    const here = (await p.textContent('#crumb .here')).replace(/\s+/g, ' ').trim();
    assert(here.startsWith('[store] 출력 템플릿'), '브레드크럼: ' + here);
    assert(here.includes('‹업로더›/‹제목›.‹확장자›'), '미리보기가 없다: ' + here);
    return here;
  });

  await step('필드를 바꾸면 파일명이 따라 바뀐다', async () => {
    const first = p.locator('.node').filter({ hasText: '[field]' }).first();
    await first.locator('select[data-ctl=field]').selectOption('channel');
    await p.waitForTimeout(250);
    assert(await expr() === '%(channel)s/%(title)s.%(ext)s', 'expr: ' + await expr());
    assert((await cmd()).includes('%(channel)s/%(title)s.%(ext)s'), '명령어: ' + await cmd());
    assert(await outVal() === '%(channel)s/%(title)s.%(ext)s', '--output 값: ' + await outVal());
    await first.locator('select[data-ctl=field]').selectOption('uploader');
    await p.waitForTimeout(250);
    return '%(channel)s/…';
  });

  await step('없을 때 값(|)과 날짜 서식(>)이 붙는다', async () => {
    const first = p.locator('.node').filter({ hasText: '[field]' }).first();
    await first.locator('input[data-ctl=fallback]').fill('Unknown');
    await p.waitForTimeout(250);
    assert(await expr() === '%(uploader|Unknown)s/%(title)s.%(ext)s', 'expr: ' + await expr());

    await first.locator('select[data-ctl=field]').selectOption('upload_date');
    await p.waitForTimeout(200);
    await first.locator('select[data-ctl=strf]').selectOption('%Y-%m-%d');
    await p.waitForTimeout(250);
    const e = await expr();
    assert(e === '%(upload_date>%Y-%m-%d|Unknown)s/%(title)s.%(ext)s', 'expr: ' + e);

    await first.locator('select[data-ctl=strf]').selectOption('');
    await first.locator('input[data-ctl=fallback]').fill('');
    await first.locator('select[data-ctl=field]').selectOption('uploader');
    await p.waitForTimeout(250);
    assert(await expr() === '%(uploader)s/%(title)s.%(ext)s', '되돌리기 실패: ' + await expr());
    return e;
  });

  await step('자릿수·자르기와 변환이 붙는다', async () => {
    const second = p.locator('.node').filter({ hasText: '[field]' }).nth(1);
    await second.locator('input[data-ctl=fmt]').fill('.40');
    await p.waitForTimeout(250);
    assert(await expr() === '%(uploader)s/%(title).40s.%(ext)s', 'expr: ' + await expr());
    await second.locator('select[data-ctl=conv]').selectOption('S');
    await p.waitForTimeout(250);
    assert(await expr() === '%(uploader)s/%(title).40S.%(ext)s', 'expr: ' + await expr());
    await second.locator('select[data-ctl=conv]').selectOption('s');
    await second.locator('input[data-ctl=fmt]').fill('');
    await p.waitForTimeout(250);
    return '.40S';
  });

  await step('글자 조각을 고치면 구분자가 바뀐다', async () => {
    const t = p.locator('.node').filter({ hasText: '[text]' }).first();
    await t.locator('input[data-ctl=text]').fill(' - ');
    await p.waitForTimeout(250);
    assert(await expr() === '%(uploader)s - %(title)s.%(ext)s', 'expr: ' + await expr());
    await t.locator('input[data-ctl=text]').fill('/');
    await p.waitForTimeout(250);
    return ' - ';
  });

  await step('가로 위치가 파일명 순서를 정한다', async () => {
    const before = await expr();
    await p.evaluate(() => {
      const g = __yt.state.output;
      const ext = Object.values(g.nodes).find(n => n.name === 'ext');
      ext.x = Math.min(...Object.values(g.nodes).map(n => n.x)) - 600;
      __yt.render();
    });
    await p.waitForTimeout(250);
    const after = await expr();
    assert(after === '%(ext)s%(uploader)s/%(title)s.', '순서가 안 바뀌었다: ' + after);
    await p.click('#autolayout');          // 정렬로 되돌린다
    await p.waitForTimeout(300);
    assert(await expr() === after, '정렬이 순서를 바꿨다');
    return `${before}  →  ${after}`;
  });

  await step('팔레트에서 조각을 더한다', async () => {
    await setup('yt-dlp -o "%(title)s.%(ext)s" https://a');
    await enter();
    await p.click('.pal-item[data-fnode=field]');
    await p.waitForTimeout(250);
    const n = await p.locator('.node .node-tag').filter({ hasText: '[field]' }).count();
    assert(n === 3, `필드 조각 ${n}개`);
    // 아직 -o 출력에 안 이어졌으므로 끊긴 상태
    assert(await p.locator('.node.bypass:not(.io)').count() === 1, '끊김 표시가 없다');
    assert(await expr() === '%(title)s.%(ext)s', '안 이어졌는데 반영됐다: ' + await expr());
    const notes = await p.textContent('#notes');
    assert(notes.includes('이어지지'), '보고가 없다: ' + notes);
    return notes.slice(0, 60);
  });

  await step('이어 붙이면 그 자리에 들어간다', async () => {
    await p.evaluate(() => {
      const g = __yt.state.output;
      const loose = Object.values(g.nodes).find(n => !g.edges.some(e => e.from === n.id) && n.id !== 'oout');
      loose.name = 'id'; loose.x = -600;      // 맨 앞으로
      __yt.connect(loose.id, 'oout', g);
      __yt.render();
    });
    await p.waitForTimeout(250);
    assert(await expr() === '%(id)s%(title)s.%(ext)s', 'expr: ' + await expr());
    assert(await p.locator('.node.bypass').count() === 0, '끊긴 노드가 남았다');
    return await expr();
  });

  await step('TYPES 접두어는 -o 출력 노드가 갖는다', async () => {
    await p.locator('.node[data-id=oout] select[data-ctl=outtype]').selectOption('chapter');
    await p.waitForTimeout(250);
    assert((await expr()).startsWith('chapter:'), 'expr: ' + await expr());
    assert((await cmd()).includes('chapter:'), '명령어: ' + await cmd());
    await p.locator('.node[data-id=oout] select[data-ctl=outtype]').selectOption('');
    await p.waitForTimeout(250);
    return 'chapter:';
  });

  await step('확장자가 빠지면 알려 준다', async () => {
    await setup('yt-dlp -o "%(title)s" https://a');
    await enter();
    const notes = await p.textContent('#notes');
    assert(notes.includes('확장자'), '경고가 없다: ' + notes);
    return notes.slice(0, 70);
  });

  await step('읽을 수 없는 문자열 → 물어보고, 취소하면 그대로 둔다', async () => {
    await setup('yt-dlp -o "%(title" https://a');
    dialogs.length = 0; setDialog('dismiss');
    await p.locator('.node').filter({ hasText: '[store]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(250);
    assert(dialogs.length === 1, '확인 대화상자가 안 떴다');
    assert(await p.locator('#crumb').isHidden(), '취소했는데 들어갔다');
    assert(await p.locator('.row[data-opt=output] input').inputValue() === '%(title',
      '문자열이 훼손됐다');
    setDialog('accept');
    return dialogs[0].split('\n')[2];
  });

  await step('파이프라인으로 복귀 → -o 값 유지 · 두 서브그래프가 공존한다', async () => {
    await setup('yt-dlp -f "bv+ba/b" -o "%(uploader)s/%(title)s.%(ext)s" https://a');
    await enter();
    const o = await expr();
    await p.click('#crumb-back');
    await p.waitForTimeout(250);
    assert(await p.locator('.row[data-opt=output] input').inputValue() === o, '-o 값이 안 맞다');

    // 포맷 서브그래프도 멀쩡한가
    await p.locator('.node').filter({ hasText: '[format]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => __yt.formatExpr()) === 'bv+ba/b', '포맷이 상했다');
    await p.click('#crumb-back');
    await p.waitForTimeout(200);
    const c = await cmd();
    assert(c.includes('bv+ba/b') && c.includes('%(uploader)s'), '명령어: ' + c);
    return c.trim();
  });

  await step('localStorage: 두 서브그래프와 모드까지 복원', async () => {
    await enter();
    const before = await p.evaluate(() =>
      [__yt.outExpr(), __yt.formatExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    await p.waitForTimeout(400);
    await p.reload();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() =>
      [__yt.outExpr(), __yt.formatExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    assert(before === after, `불일치\n${before}\n${after}`);
    return after.split('|')[0];
  });

  await step('조각 노드가 겹치지 않게 놓인다', async () => {
    await setup('yt-dlp -o "%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s" https://a');
    await enter();
    const overlap = await p.evaluate(() => {
      const els = [...document.querySelectorAll('.node')];
      const bs = els.map(e => { const n = __yt.state.output.nodes[e.dataset.id];
        return { id: e.dataset.id, x1: n.x, y1: n.y, x2: n.x + e.offsetWidth, y2: n.y + e.offsetHeight }; });
      const hit = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], c = bs[j];
        if (a.x1 < c.x2 && c.x1 < a.x2 && a.y1 < c.y2 && c.y1 < a.y2) hit.push(a.id + '↔' + c.id);
      }
      return hit;
    });
    assert(overlap.length === 0, '겹친 노드: ' + overlap.join(', '));
    return await expr();
  });
}
