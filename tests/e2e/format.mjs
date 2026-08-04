/**
 * 포맷 셀렉터 서브그래프
 *
 * -f 문자열 ↔ 노드 그래프 왕복, 필터 UI, 피연산자 순서, 괄호 자동 삽입.
 */
export const view = 'graph';
export const name = '포맷 셀렉터 서브그래프';

export default async function ({ p, step, assert, dialogs, setDialog }) {
  const cmd = () => p.textContent('#cmd');
  const expr = () => p.evaluate(() => __yt.formatExpr());
  const fmtVal = () => p.evaluate(() => {
    const n = Object.values(__yt.state.nodes).find(x => x.stage === 'format');
    return n ? n.values.format : null;
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
    await p.locator('.node').filter({ hasText: '[format]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(250);
  };

  await step('진입: -f 문자열이 서브그래프로 풀린다', async () => {
    await setup('yt-dlp -f "bv*[height<=720]+ba" -o "%(title)s.%(ext)s" https://youtu.be/xyz');
    await enter();
    assert(!(await p.locator('#crumb').isHidden()), '브레드크럼이 안 뜸');
    const kinds = await p.evaluate(() =>
      Object.values(__yt.state.format.nodes).map(n => n.type).sort().join(','));
    assert(kinds === 'fout,merge,stream,stream', '노드 구성이 다르다: ' + kinds);
    assert(await expr() === 'bv*[height<=720]+ba', '컴파일 결과: ' + await expr());
    return kinds + ' → ' + await expr();
  });

  await step('브레드크럼 문구가 서술자에서 나온다', async () => {
    const here = (await p.textContent('#crumb .here')).replace(/\s+/g, ' ').trim();
    assert(here.startsWith('[format] 포맷 셀렉터'), '브레드크럼: ' + here);
    assert(here.includes('bv*[height<=720]+ba'), '표현식이 안 붙었다: ' + here);
    assert(await p.locator('#field-q').isHidden(), '서브그래프에서 검색이 살아 있다');
    assert(await p.locator('#autowire').isHidden(), '서브그래프에서 전부 잇기가 살아 있다');
    return here;
  });

  await step('스트림 노드에 셀렉터·필터 UI가 붙는다', async () => {
    const streams = p.locator('.node').filter({ hasText: '[stream]' });
    assert(await streams.count() === 2, `스트림 노드 ${await streams.count()}개`);
    const sels = await streams.locator('.fsel select').count();
    assert(sels === 2, `셀렉터 select ${sels}개`);
    const filt = await streams.locator('.filt-row').count();
    assert(filt === 1, `필터 행 ${filt}개 (height<=720 하나 기대)`);
    const key = await streams.locator('.filt-row select').first().inputValue();
    assert(key === 'height', '필터 필드가 height가 아님: ' + key);
    return `셀렉터 2 · 필터 1 (${key})`;
  });

  await step('필터 값 수정 → 명령어까지 즉시 반영', async () => {
    await p.locator('.filt-row input').first().fill('1080');
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=1080]+ba', 'expr: ' + await expr());
    assert((await cmd()).includes('bv*[height<=1080]+ba'), '명령어 미반영: ' + await cmd());
    assert(await fmtVal() === 'bv*[height<=1080]+ba', '--format 값 미동기화: ' + await fmtVal());
    return await fmtVal();
  });

  await step('필터를 치는 동안 -f 출력 노드와 브레드크럼이 저절로 따라온다', async () => {
    const val = p.locator('.filt-row input[type=text]').first();
    await val.click();
    await val.fill('');
    await p.keyboard.type('4320', { delay: 12 });
    await p.waitForTimeout(200);

    assert(await val.inputValue() === '4320', '입력이 잘렸다: ' + await val.inputValue());
    const still = await p.evaluate(() =>
      document.activeElement.dataset && document.activeElement.dataset.ctl);
    assert(still === 'filt:0:val', '포커스가 떠났다: ' + still);

    // 예전에는 이 셋을 renderAfterEdit 가 손으로 갱신했다.
    const foutText = (await p.textContent('#fout-expr')).trim();
    const crumb = (await p.textContent('#crumb .here')).replace(/\s+/g, ' ');
    assert(foutText === 'bv*[height<=4320]+ba', '-f 출력 노드: ' + foutText);
    assert(crumb.includes('bv*[height<=4320]+ba'), '브레드크럼: ' + crumb);
    assert((await cmd()).includes('bv*[height<=4320]+ba'), '명령어: ' + await cmd());

    await val.fill('1080');
    await p.waitForTimeout(200);
    return foutText;
  });

  await step('필터 필드를 바꾸면 연산자 목록이 따라 바뀐다', async () => {
    const s1 = p.locator('.node').filter({ hasText: '[stream]' }).first();
    const key = s1.locator('.filt-row select').first();
    const op = s1.locator('.filt-row select').nth(1);
    const numOps = await op.locator('option').count();
    await key.selectOption('ext');            // 숫자 필드 → 문자열 필드
    await p.waitForTimeout(200);
    const strOps = await op.locator('option').count();
    assert(strOps !== numOps, `연산자 목록이 그대로다 (${numOps} → ${strOps})`);
    const opts = await op.locator('option').allTextContents();
    assert(opts.includes('로 시작'), '문자열 연산자가 없다: ' + opts.join(','));
    await key.selectOption('height');
    await p.waitForTimeout(200);
    return `${numOps}개 → ${strOps}개`;
  });

  await step('연산자 바꾸기 (≤ → =)', async () => {
    await p.locator('.filt-row select').nth(1).selectOption('=');
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height=1080]+ba', 'expr: ' + await expr());
    await p.locator('.filt-row select').nth(1).selectOption('<=');
    await p.waitForTimeout(200);
  });

  await step('"값 모르는 포맷도 통과 (?)" 토글', async () => {
    await p.locator('.filt-q input').first().check();
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=?1080]+ba', 'expr: ' + await expr());
    // 필터마다 독립이어야 한다: 두 번째 필터를 붙여도 첫 필터의 ? 는 유지된다
    const s1 = p.locator('.node').filter({ hasText: '[stream]' }).first();
    await s1.locator('.row-sub').click();
    await p.waitForTimeout(200);
    await s1.locator('.filt-row').nth(1).locator('select').first().selectOption('fps');
    await p.waitForTimeout(150);
    await s1.locator('.filt-row').nth(1).locator('select').nth(1).selectOption('>');
    await s1.locator('.filt-row').nth(1).locator('input[type=text]').fill('30');
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=?1080][fps>30]+ba', '독립성 깨짐: ' + await expr());
    assert(await s1.locator('.filt-q input').first().isChecked(), '첫 필터 ? 가 풀림');
    assert(!(await s1.locator('.filt-q input').nth(1).isChecked()), '두 번째 필터에 ? 가 붙음');
    await s1.locator('.filt-row').nth(1).locator('.row-x').click();
    await p.waitForTimeout(200);
    await p.locator('.filt-q input').first().uncheck();
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=1080]+ba', '되돌리기 실패: ' + await expr());
    return '? 는 필터마다 독립';
  });

  await step('필터 추가 / 제거', async () => {
    const s1 = p.locator('.node').filter({ hasText: '[stream]' }).first();
    await s1.locator('.row-sub').click();          // + 필터
    await p.waitForTimeout(200);
    const rows = await s1.locator('.filt-row').count();
    assert(rows === 2, `필터 ${rows}개`);
    await s1.locator('.filt-row select').nth(2).selectOption('fps');
    await p.waitForTimeout(150);
    await s1.locator('.filt-row').nth(1).locator('select').nth(1).selectOption('>');
    await s1.locator('.filt-row').nth(1).locator('input[type=text]').fill('30');
    await p.waitForTimeout(200);
    const e = await expr();
    assert(e === 'bv*[height<=1080][fps>30]+ba', 'expr: ' + e);
    await s1.locator('.filt-row').nth(1).locator('.row-x').click();
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=1080]+ba', '제거 실패: ' + await expr());
    return e + ' → 되돌림';
  });

  await step('존재 필터 ([format_note] / [!format_note])', async () => {
    const s1 = p.locator('.node').filter({ hasText: '[stream]' }).first();
    await s1.locator('.row-sub').click();
    await p.waitForTimeout(200);
    await s1.locator('.filt-row').nth(1).locator('select').first().selectOption('format_note');
    await p.waitForTimeout(150);
    await s1.locator('.filt-row').nth(1).locator('select').nth(1).selectOption('has');
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=1080][format_note]+ba', 'has: ' + await expr());
    await s1.locator('.filt-row').nth(1).locator('select').nth(1).selectOption('hasnot');
    await p.waitForTimeout(200);
    assert(await expr() === 'bv*[height<=1080][!format_note]+ba', 'hasnot: ' + await expr());
    await s1.locator('.filt-row').nth(1).locator('.row-x').click();
    await p.waitForTimeout(200);
    return '존재/부재 필터 OK';
  });

  await step('팔레트에서 폴백 노드 추가 → 병합/폴백 조합', async () => {
    await p.click('.pal-item[data-fnode=fallback]');
    await p.waitForTimeout(200);
    const n = await p.locator('.node .node-tag').filter({ hasText: '[/]' }).count();
    assert(n === 1, `폴백 노드 ${n}개`);
    // 폴백은 아직 -f 출력에 안 이어졌으므로 우회 상태여야 한다
    assert(await p.locator('.node.bypass').count() >= 1, '끊긴 노드 표시가 없음');
    return '폴백 노드 배치됨 (미연결)';
  });

  await step('배선: merge → fallback → fout, 스트림 추가로 (…)+ba/b 구성', async () => {
    await p.evaluate(() => {
      const g = __yt.state.format;
      const N = Object.values(g.nodes);
      const merge = N.find(n => n.type === 'merge');
      const fb = N.find(n => n.type === 'fallback');
      // 스트림 하나 더 만들어 b 로 두고, 위치로 순서를 정한다
      const nb = __yt.addFormatNode('stream', merge.x, merge.y + 260, { sel: 'b' });
      g.edges = g.edges.filter(e => e.to !== 'fout');
      __yt.connect(merge.id, fb.id, g);
      __yt.connect(nb.id, fb.id, g);
      __yt.connect(fb.id, 'fout', g);
      // 폴백 노드는 병합보다 오른쪽에 두어야 읽기 좋다
      fb.x = merge.x + 260; fb.y = merge.y + 120;
      __yt.render();
      return { merge: merge.id, fb: fb.id, nb: nb.id };
    });
    await p.waitForTimeout(250);
    const e = await expr();
    assert(e === 'bv*[height<=1080]+ba/b', 'expr: ' + e);
    assert(await p.locator('.node.bypass').count() === 0, '끊긴 노드가 남음');
    assert((await cmd()).includes('bv*[height<=1080]+ba/b'), '명령어: ' + await cmd());
    return e;
  });

  await step('세로 위치가 피연산자 순서를 정한다', async () => {
    const before = await expr();
    // b 스트림을 merge 위로 올리면 폴백 순서가 뒤집혀야 한다
    await p.evaluate(() => {
      const g = __yt.state.format;
      const nb = Object.values(g.nodes).find(n => n.type === 'stream' && n.sel === 'b');
      const merge = Object.values(g.nodes).find(n => n.type === 'merge');
      nb.y = merge.y - 300;
      __yt.render();
    });
    await p.waitForTimeout(200);
    const after = await expr();
    assert(after === 'b/bv*[height<=1080]+ba', '뒤집히지 않음: ' + after);
    await p.evaluate(() => {
      const g = __yt.state.format;
      const nb = Object.values(g.nodes).find(n => n.type === 'stream' && n.sel === 'b');
      const merge = Object.values(g.nodes).find(n => n.type === 'merge');
      nb.y = merge.y + 300;
      __yt.render();
    });
    await p.waitForTimeout(200);
    assert(await expr() === before, '되돌리기 실패: ' + await expr());
    return `${before}  ⇄  ${after}`;
  });

  await step('우선순위가 낮은 자식에는 괄호가 자동으로 붙는다', async () => {
    const e = await p.evaluate(() => {
      // (bv/wv)+ba : fallback 을 merge 의 자식으로 넣는다
      const g = { nodes: {}, edges: [], view: { x:0,y:0,k:1 } };
      __yt.state.format = g;
      g.nodes.fout = { id:'fout', type:'fout', x:900, y:200 };
      const a = __yt.addFormatNode('stream', 0, 0, { sel:'bv' });
      const b2 = __yt.addFormatNode('stream', 0, 120, { sel:'wv' });
      const c = __yt.addFormatNode('stream', 0, 300, { sel:'ba' });
      const fb = __yt.addFormatNode('fallback', 300, 60);
      const mg = __yt.addFormatNode('merge', 600, 180);
      __yt.connect(a.id, fb.id, g); __yt.connect(b2.id, fb.id, g);
      __yt.connect(fb.id, mg.id, g); __yt.connect(c.id, mg.id, g);
      __yt.connect(mg.id, 'fout', g);
      __yt.render();
      return __yt.formatExpr();
    });
    await p.waitForTimeout(200);
    assert(e === '(bv/wv)+ba', 'expr: ' + e);
    // 다시 파싱해도 같은 트리인지
    const stable = await p.evaluate(() => {
      const s = __yt.formatExpr();
      return __yt.emitTree(__yt.parseFormat(s)) === s;
    });
    assert(stable, '재파싱 불안정');
    return e;
  });

  await step('fout 연결을 끊으면 -f 가 비고 문제가 보고된다', async () => {
    await p.evaluate(() => {
      __yt.state.format.edges = __yt.state.format.edges.filter(e => e.to !== 'fout');
      __yt.render();
    });
    await p.waitForTimeout(200);
    assert(await expr() === '', 'expr가 안 비었다: ' + await expr());
    assert(await fmtVal() === '', '--format 값: ' + JSON.stringify(await fmtVal()));
    assert(!(await cmd()).includes('-f'), '명령어에 -f가 남음: ' + await cmd());
    const notes = await p.textContent('#notes');
    assert(notes.includes('이어지지'), '문제 보고 없음: ' + notes);
    return notes.slice(0, 70);
  });

  await step('-f 출력은 입력 하나만 받는다 (새로 이으면 교체)', async () => {
    const n = await p.evaluate(() => {
      const g = __yt.state.format;
      const streams = Object.values(g.nodes).filter(x => x.type === 'stream');
      __yt.connect(streams[0].id, 'fout', g);
      __yt.connect(streams[1].id, 'fout', g);
      __yt.render();
      return g.edges.filter(e => e.to === 'fout').length;
    });
    assert(n === 1, `fout 입력 ${n}개`);
    return 'fout 입력 1개 유지';
  });

  await step('파이프라인으로 복귀 → -f 값 유지', async () => {
    await p.evaluate(() => {
      const g = __yt.state.format;
      const mg = Object.values(g.nodes).find(x => x.type === 'merge');
      g.edges = g.edges.filter(e => e.to !== 'fout');
      __yt.connect(mg.id, 'fout', g);
      __yt.render();
    });
    await p.waitForTimeout(200);
    const e = await expr();
    await p.click('#crumb-back');
    await p.waitForTimeout(250);
    assert(await p.locator('#crumb').isHidden(), '브레드크럼이 안 사라짐');
    assert(await p.locator('.pal-item[data-stage]').count() === 9, '팔레트가 단계로 안 돌아옴');
    const row = await p.locator('.row[data-opt=format] input').inputValue();
    assert(row === e, `행 값 ${row} != ${e}`);
    assert((await cmd()).includes(e), '명령어: ' + await cmd());
    return e;
  });

  await step('레이아웃 유지: 다시 들어가도 그래프가 보존된다', async () => {
    const before = await p.evaluate(() => JSON.stringify(__yt.state.format.nodes));
    await enter();
    const after = await p.evaluate(() => JSON.stringify(__yt.state.format.nodes));
    assert(before === after, '그래프가 재생성됨');
    return '노드 배치 그대로';
  });

  await step('문자열을 손으로 고치면 다음 진입 때 다시 파싱된다', async () => {
    await p.click('#crumb-back');
    await p.waitForTimeout(200);
    await p.locator('.row[data-opt=format] input').fill('bv[ext=mp4]+ba[ext=m4a]/b');
    await p.waitForTimeout(250);
    await enter();
    const kinds = await p.evaluate(() =>
      Object.values(__yt.state.format.nodes).map(n => n.type).sort().join(','));
    assert(kinds === 'fallback,fout,merge,stream,stream,stream', '노드 구성: ' + kinds);
    assert(await expr() === 'bv[ext=mp4]+ba[ext=m4a]/b', 'expr: ' + await expr());
    return kinds;
  });

  await step('읽을 수 없는 문자열 → 물어보고, 취소하면 그대로 둔다', async () => {
    await p.click('#crumb-back'); await p.waitForTimeout(200);
    await p.locator('.row[data-opt=format] input').fill('bv+((broken');
    await p.waitForTimeout(250);
    dialogs.length = 0; setDialog('dismiss');
    await p.locator('.node').filter({ hasText: '[format]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(250);
    assert(dialogs.length === 1, '확인 대화상자가 안 뜸');
    assert(dialogs[0].includes('읽지 못했다'), '메시지: ' + dialogs[0]);
    assert(await p.locator('#crumb').isHidden(), '취소했는데 서브그래프로 들어감');
    assert(await p.locator('.row[data-opt=format] input').inputValue() === 'bv+((broken', '문자열이 훼손됨');
    return dialogs[0].split('\n')[2];
  });

  await step('읽을 수 없는 문자열 → 수락하면 빈 그래프로 시작', async () => {
    dialogs.length = 0; setDialog('accept');
    await p.locator('.node').filter({ hasText: '[format]' }).locator('.row-sub').first().click();
    await p.waitForTimeout(250);
    assert(!(await p.locator('#crumb').isHidden()), '서브그래프로 안 들어감');
    assert(await p.evaluate(() => Object.keys(__yt.state.format.nodes).length) === 1, '빈 그래프가 아님');
    const notes = await p.textContent('#notes');
    assert(notes.includes('덮어썼다'), '경고 없음: ' + notes);
    return notes.slice(0, 60);
  });

  await step('명령어 읽기가 -f 를 서브그래프까지 풀어 준다', async () => {
    await setup('yt-dlp -f "bestvideo[height<=?1080][fps>30]+bestaudio/best" https://a');
    const kinds = await p.evaluate(() =>
      Object.values(__yt.state.format.nodes).map(n => n.type).sort().join(','));
    assert(kinds === 'fallback,fout,merge,stream,stream,stream', '노드 구성: ' + kinds);
    assert(await expr() === 'bestvideo[height<=?1080][fps>30]+bestaudio/best', 'expr: ' + await expr());
    assert(await fmtVal() === 'bestvideo[height<=?1080][fps>30]+bestaudio/best', 'val: ' + await fmtVal());
    return kinds;
  });

  await step('읽을 수 없는 -f 는 문자열로 두고 알린다', async () => {
    await setup('yt-dlp -f "bv+((nope" https://a');
    const notes = await p.textContent('#notes');
    assert(notes.includes('서브그래프로 못 읽었다'), '경고 없음: ' + notes);
    assert((await cmd()).includes('bv+((nope'), '문자열이 사라짐: ' + await cmd());
    return notes.slice(0, 80);
  });

  await step('서브그래프 정렬 버튼', async () => {
    await setup('yt-dlp -f "bv[ext=mp4]+ba/wv+wa/b" https://a');
    await enter();
    const before = await expr();
    await p.click('#autolayout');
    await p.waitForTimeout(300);
    assert(await expr() === before, `정렬이 표현식을 바꿨다: ${before} → ${await expr()}`);
    const overlap = await p.evaluate(() => {
      const els = [...document.querySelectorAll('.node')];
      const box = e => { const n = __yt.state.format.nodes[e.dataset.id];
        return { x1:n.x, y1:n.y, x2:n.x + e.offsetWidth, y2:n.y + e.offsetHeight }; };
      const bs = els.map(box); const hit = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2)
          hit.push(els[i].dataset.id + '↔' + els[j].dataset.id);
      }
      return hit;
    });
    assert(overlap.length === 0, `겹친 노드: ${overlap.join(', ')}`);
    return before;
  });

  await step('localStorage: 서브그래프와 모드까지 복원', async () => {
    const before = await p.evaluate(() => [__yt.formatExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    await p.waitForTimeout(400);
    await p.reload();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => [__yt.formatExpr(), __yt.commandString(), __yt.ui.mode].join('|'));
    assert(before === after, `불일치\n${before}\n${after}`);
    assert(!(await p.locator('#crumb').isHidden()), '서브그래프 모드가 복원 안 됨');
    return after.split('|')[0];
  });

  await step('그래프 JSON 왕복', async () => {
    await p.click('#graph-io');
    await p.waitForTimeout(150);
    const json = await p.locator('#graph-text').inputValue();
    assert(json.includes('"format"'), 'JSON에 서브그래프가 없음');
    const before = await p.evaluate(() => __yt.commandString());
    await p.click('#graph-load');
    await p.waitForTimeout(300);
    assert(await p.evaluate(() => __yt.commandString()) === before, 'JSON 왕복 불일치');
    return `${Math.round(json.length / 1024)}KB`;
  });

  await step('서브그래프 노드 삭제 → 앞뒤 재연결', async () => {
    await setup('yt-dlp -f "bv+ba/b" https://a');
    await enter();
    const before = await expr();
    assert(before === 'bv+ba/b', 'setup: ' + before);
    await p.evaluate(() => {
      const mg = Object.values(__yt.state.format.nodes).find(n => n.type === 'merge');
      __yt.removeNode(mg.id, __yt.state.format);
      __yt.render();
    });
    await p.waitForTimeout(250);
    // merge 를 지우면 bv, ba 가 fallback 으로 직결된다
    const after = await expr();
    assert(after === 'bv/ba/b', `expr: ${after}`);
    assert(await p.locator('.node.bypass').count() === 0, '끊긴 노드가 남음');
    return `${before} → ${after}`;
  });
}
