/**
 * 파이프라인 그래프
 *
 * 노드 배치·배선·절단·우회 반영, 명령어 왕복, 저장 복원까지.
 */
export const name = '파이프라인 그래프';

export default async function ({ p, step, assert, dialogs, setDialog }) {
  const cmd = () => p.textContent('#cmd');
  const notes = () => p.textContent('#notes');

  await step('초기 렌더', async () => {
    const n = await p.locator('.node').count();
    assert(n === 2, `노드 ${n}개 (기대 2)`);
    const w = await p.locator('.wire').count();
    assert(w === 1, `와이어 ${w}개`);
    assert((await cmd()).includes('yt-dlp'), 'yt-dlp 없음');
    return `노드 ${n} · 와이어 ${w}`;
  });

  await step('URL 입력', async () => {
    await p.fill('.node[data-id=src] textarea', 'https://youtu.be/abc123');
    await p.waitForTimeout(120);
    assert((await cmd()).includes('abc123'), 'URL 미반영: ' + await cmd());
  });

  await step('팔레트 클릭 → format 노드 생성 + 자동 배선', async () => {
    await p.click('.pal-item[data-stage=format]');
    await p.waitForTimeout(150);
    const n = await p.locator('.node').count();
    assert(n === 3, `노드 ${n}개`);
    const w = await p.locator('.wire').count();
    assert(w === 2, `와이어 ${w}개 (src→format→out 기대)`);
    assert(await p.locator('.node.bypass').count() === 0, '새 노드가 우회 상태');
    return `노드 ${n} · 와이어 ${w}`;
  });

  await step('노드 안에서 옵션 추가 (--format)', async () => {
    const node = p.locator('.node').filter({ hasText: '[format]' });
    await node.locator('.add').click();
    await p.waitForTimeout(120);
    await node.locator('.picker input').fill('--format');
    await p.waitForTimeout(120);
    const first = node.locator('.picker li button').first();
    assert(await first.count() === 1, '피커 결과 없음');
    await first.click();
    await p.waitForTimeout(150);
    assert(await node.locator('.row').count() >= 1, '행이 안 생김');
    await node.locator('.row[data-opt=format] input').fill('bv*[height<=1080]+ba');
    await p.waitForTimeout(150);
    const c = await cmd();
    assert(c.includes('height<=1080'), '명령어 미반영: ' + c);
    return c.trim();
  });

  await step('와이어 끊기 → 우회 + 명령어에서 빠짐', async () => {
    const box = await p.locator('.wire-hit').first().boundingBox();
    // 첫 와이어(src→format)의 중간 지점 클릭
    const paths = await p.locator('.wire-hit').all();
    const el = paths[0];
    const d = await el.evaluate(n => n.getAttribute('d'));
    const pt = await el.evaluate(n => { const l = n.getTotalLength(); const q = n.getPointAtLength(l / 2); return [q.x, q.y]; });
    const vpb = await p.locator('#viewport').boundingBox();
    const svgPt = await p.evaluate(([x, y]) => {
      const g = document.querySelector('#wire-layer');
      const m = g.getCTM();
      const r = document.querySelector('#viewport').getBoundingClientRect();
      return [r.left + m.a * x + m.c * y + m.e, r.top + m.b * x + m.d * y + m.f];
    }, pt);
    await p.mouse.click(svgPt[0], svgPt[1]);
    await p.waitForTimeout(200);
    assert(await p.locator('.node.bypass:not(.io)').count() === 1, '우회 단계 노드가 안 생김');
    assert(await p.locator('.node.bypass.io').count() === 2, '소스·명령어도 끊김 표시가 나야 한다');
    const c = await cmd();
    assert(!c.includes('height<=1080'), '끊었는데 아직 명령어에 있음: ' + c);
    assert((await notes()).includes('우회'), '우회 안내 없음: ' + await notes());
    return await notes();
  });

  await step('포트 드래그로 다시 잇기', async () => {
    const out = await p.locator('.node[data-id=src] .port.out').boundingBox();
    const inn = await p.locator('.node.bypass:not(.io) .port.in').boundingBox();
    await p.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
    await p.mouse.down();
    await p.mouse.move(inn.x + inn.width / 2, inn.y + inn.height / 2, { steps: 12 });
    await p.mouse.up();
    await p.waitForTimeout(200);
    assert(await p.locator('.node.bypass').count() === 0, '아직 우회 상태');
    assert(await p.locator('.wire.dead').count() === 0, '죽은 와이어가 남음');
    assert((await cmd()).includes('height<=1080'), '명령어 복구 안 됨: ' + await cmd());
  });

  await step('노드 헤더 드래그로 이동', async () => {
    const node = p.locator('.node').filter({ hasText: '[format]' });
    const before = await node.evaluate(n => n.style.left);
    const h = await node.locator('.node-head').boundingBox();
    await p.mouse.move(h.x + 60, h.y + h.height / 2);
    await p.mouse.down();
    await p.mouse.move(h.x + 200, h.y + 120, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(150);
    const after = await node.evaluate(n => n.style.left);
    assert(before !== after, `안 움직임 ${before} → ${after}`);
    return `${before} → ${after}`;
  });

  await step('전역 검색 → 결과 클릭으로 배치', async () => {
    await p.fill('#q', '자막');
    await p.waitForTimeout(150);
    const n = await p.locator('.hit').count();
    assert(n > 0, '검색 결과 없음');
    await p.locator('.hit').first().click();
    await p.waitForTimeout(200);
    assert(await p.locator('.node').count() === 4, '노드가 안 늘어남');
    return `${n}건 일치`;
  });

  await step('휠 줌 · 팬', async () => {
    const vpb = await p.locator('#viewport').boundingBox();
    await p.mouse.move(vpb.x + 400, vpb.y + 300);
    await p.mouse.wheel(0, -400);
    await p.waitForTimeout(120);
    const z = await p.textContent('#zoom-label');
    assert(z !== '100%', '줌 안 됨: ' + z);
    await p.click('#zoom-reset');
    await p.waitForTimeout(120);
    return '줌 ' + z + ' → ' + await p.textContent('#zoom-label');
  });

  await step('명령어 읽기 → 그래프 복원', async () => {
    await p.click('#import');
    await p.fill('#paste', 'yt-dlp -f "bv*[height<=720]+ba" --embed-subs --sub-langs ko,en -o "%(title)s.%(ext)s" --sponsorblock-remove sponsor --cookies-from-browser chrome --bogus-flag https://youtu.be/xyz');
    await p.click('#do-import');
    await p.waitForTimeout(300);
    const nodes = await p.locator('.node').count();
    const c = await cmd();
    assert(nodes >= 5, `노드 ${nodes}개`);
    assert(await p.locator('.node.bypass').count() === 0, '우회 노드가 있음');
    assert(c.includes('height<=720') && c.includes('--embed-subs') && c.includes('xyz'), '명령어 부실: ' + c);
    assert((await notes()).includes('--bogus-flag'), '미지 토큰 보고 없음: ' + await notes());
    return `노드 ${nodes} · ${(await notes()).slice(0, 60)}`;
  });

  await step('왕복: 읽은 명령어 == 조립한 명령어', async () => {
    const c = (await p.evaluate(() => commandString())).replace(/\s+/g, ' ');
    for (const frag of ['-f "bv*[height<=720]+ba"', '--embed-subs', '--sub-langs ko,en', '--sponsorblock-remove sponsor', '--cookies-from-browser chrome'])
      assert(c.includes(frag), `누락: ${frag}\n실제: ${c}`);
    return c;
  });

  await step('순환 연결 차단', async () => {
    const ok = await p.evaluate(() => {
      const ids = Object.keys(state.nodes).filter(i => state.nodes[i].type === 'stage');
      return connect('out', 'src') === false && connect(ids[1], ids[0]) === false;
    });
    assert(ok, '순환이 허용됨');
  });

  await step('localStorage 복원', async () => {
    const before = await p.evaluate(() => commandString());
    await p.waitForTimeout(400);
    await p.reload();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => commandString());
    assert(before === after, `복원 불일치\n${before}\n${after}`);
    return '동일';
  });

  await step('conf 출력', async () => {
    const conf = await p.evaluate(() => confString());
    assert(conf.split('\n').filter(Boolean).length >= 5, 'conf 줄 수 부족: ' + conf);
    return conf.split('\n').filter(Boolean).length + '줄';
  });

  await step('노드 접기/펴기', async () => {
    const node = p.locator('.node').filter({ hasText: '[format]' });
    assert(await node.locator('.node-body').count() === 1, '본문이 없음');
    await node.locator('.node-x').first().click();
    await p.waitForTimeout(150);
    assert(await node.locator('.node-body').count() === 0, '접히지 않음');
    const c = await cmd();
    assert(c.includes('height<=720'), '접었더니 명령어가 바뀜: ' + c);
    await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(400);
    const node2 = p.locator('.node').filter({ hasText: '[format]' });
    assert(await node2.locator('.node-body').count() === 0, '접힘 상태가 저장 안 됨');
    await node2.locator('.node-x').first().click();
    await p.waitForTimeout(150);
    assert(await node2.locator('.node-body').count() === 1, '펴지지 않음');
    return '접힘 상태 저장까지 확인';
  });

  await step('노드 삭제 ✕ → 앞뒤 재연결', async () => {
    const before = await p.locator('.node').count();
    const node = p.locator('.node').filter({ hasText: '[process]' });
    await node.locator('.node-x').nth(1).click();
    await p.waitForTimeout(200);
    assert(await p.locator('.node').count() === before - 1, '삭제 안 됨');
    assert(await p.locator('.node.bypass').count() === 0, '삭제로 체인이 끊김');
    const c = await cmd();
    assert(!c.includes('sponsorblock'), '삭제했는데 옵션이 남음: ' + c);
    assert(c.includes('height<=720') && c.includes('%(title)s'), '다른 노드가 같이 날아감: ' + c);
    return c.trim();
  });

  await step('정렬 버튼', async () => {
    await p.click('#autolayout');
    await p.waitForTimeout(250);
    assert(await p.locator('.node.bypass').count() === 0, '정렬 후 끊김');
  });
}
