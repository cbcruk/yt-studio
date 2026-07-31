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
    // 검색창은 열리는 그 순간에 포커스를 가져간다 — 바로 칠 수 있어야 한다.
    const at = await p.evaluate(() =>
      document.activeElement.dataset && document.activeElement.dataset.ctl);
    assert(at === 'picker', '검색창에 포커스가 안 갔다: ' + at);
    await p.keyboard.type('--format', { delay: 10 });
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

  await step('연타해도 포커스가 안 날아간다', async () => {
    const inp = p.locator('.row[data-opt=format] input');
    await inp.click();
    await inp.fill('');
    // 한 글자씩 실제로 친다. 렌더가 DOM 을 갈아엎으면 첫 글자 뒤 포커스를 잃고
    // 나머지가 안 들어간다.
    await p.keyboard.type('bv*[height<=1080]+ba', { delay: 12 });
    await p.waitForTimeout(200);
    const v = await inp.inputValue();
    assert(v === 'bv*[height<=1080]+ba', `입력이 잘렸다: "${v}"`);
    const still = await p.evaluate(() =>
      document.activeElement.dataset && document.activeElement.dataset.ctl);
    assert(still === 'opt:format', '포커스가 떠났다: ' + still);
    assert((await cmd()).includes('bv*[height<=1080]+ba'), '명령어 미반영: ' + await cmd());
    return v;
  });

  await step('가운데에 끼워 넣어도 캐럿이 제자리', async () => {
    const inp = p.locator('.row[data-opt=format] input');
    await inp.fill('abcd');
    await inp.click();
    await p.evaluate(() => {
      const el = document.querySelector('.row[data-opt=format] input');
      el.focus(); el.setSelectionRange(2, 2);
    });
    await p.keyboard.type('XY', { delay: 12 });
    await p.waitForTimeout(150);
    const v = await inp.inputValue();
    assert(v === 'abXYcd', `캐럿이 밀렸다: "${v}"`);
    const caret = await p.evaluate(() => document.activeElement.selectionStart);
    assert(caret === 4, `캐럿 위치 ${caret} (기대 4)`);
    await inp.fill('bv*[height<=1080]+ba');
    await p.waitForTimeout(150);
    return `${v} · 캐럿 ${caret}`;
  });

  await step('조합(IME) 중에도 필드가 살아남는다', async () => {
    const inp = p.locator('.row[data-opt=format] input');
    await inp.click();
    await inp.fill('bv');

    // 지금 DOM 노드에 표식을 남긴다. 다시 만들어지면 표식이 사라진다.
    await p.evaluate(() => {
      document.querySelector('.row[data-opt=format] input').__mark = 'ime';
    });

    // 한글 조합 중 — IME 가 필드 안에서 음절을 만드는 사이다. 여기서 엘리먼트를
    // 갈아 끼우거나 값을 되돌려 놓으면 음절이 통째로 깨진다.
    const during = await p.evaluate(() => {
      const el = document.querySelector('.row[data-opt=format] input');
      el.focus();
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.value = 'bv가';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const same = document.querySelector('.row[data-opt=format] input');
      return {
        kept: same === el && same.__mark === 'ime',
        value: same.value,
        focused: document.activeElement === same,
      };
    });
    assert(during.kept, '조합 중에 필드가 다시 만들어졌다 — 음절이 깨진다');
    assert(during.value === 'bv가', '조합 중 값이 덮어써졌다: ' + during.value);
    assert(during.focused, '조합 중에 포커스가 떠났다');
    // 노드를 통째로 비켜 가지 않으므로 파생 표시는 조합 중에도 따라온다.
    assert((await cmd()).includes('bv가'), '조합 중 명령어 미반영: ' + await cmd());

    // 조합이 끝나도 같은 엘리먼트다. 예외 상태가 없으니 돌아올 것도 없다.
    const after = await p.evaluate(() => {
      const el = document.querySelector('.row[data-opt=format] input');
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      el.value = 'bv+ba';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const same = document.querySelector('.row[data-opt=format] input');
      return same === el && same.__mark === 'ime';
    });
    assert(after, '조합이 끝나자 필드가 갈렸다');
    assert((await cmd()).includes('bv+ba'), '명령어 미반영: ' + await cmd());

    await inp.fill('bv*[height<=1080]+ba');
    await p.waitForTimeout(150);
    return '조합 중·후 같은 엘리먼트 · 값 보존 · 파생 표시 갱신';
  });

  await step('와이어 끊기 → 우회 + 명령어에서 빠짐', async () => {
    // src → format 와이어에서 노드에 가리지 않은 지점을 찾아 누른다.
    const pt = await p.locator('yt-wire[data-from=src]').locator('.hit').evaluate(n => {
      const len = n.getTotalLength(), m = n.getScreenCTM();
      const at = f => {
        const q = n.getPointAtLength(len * f);
        return [m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f];
      };
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const [x, y] = at(f);
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('rete-connection-wrapper')) return [x, y];
      }
      return at(0.5);
    });
    await p.mouse.click(pt[0], pt[1]);
    await p.waitForTimeout(250);
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
    assert(await p.locator('yt-wire .dead').count() === 0, '죽은 와이어가 남음');
    assert((await cmd()).includes('height<=1080'), '명령어 복구 안 됨: ' + await cmd());
  });

  await step('노드 헤더 드래그로 이동', async () => {
    // 자리는 캔버스가 갖지만 뜻은 그래프가 갖는다 — 그래프의 x 를 본다.
    const xOf = () => p.evaluate(() =>
      Object.values(__yt.state.nodes).find(n => n.stage === 'format').x);
    const before = await xOf();
    const h = await p.locator('.node').filter({ hasText: '[format]' })
      .locator('.node-head').boundingBox();
    await p.mouse.move(h.x + 60, h.y + h.height / 2);
    await p.mouse.down();
    await p.mouse.move(h.x + 200, h.y + 120, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(250);
    const after = await xOf();
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
    const c = (await p.evaluate(() => __yt.commandString())).replace(/\s+/g, ' ');
    for (const frag of ['-f "bv*[height<=720]+ba"', '--embed-subs', '--sub-langs ko,en', '--sponsorblock-remove sponsor', '--cookies-from-browser chrome'])
      assert(c.includes(frag), `누락: ${frag}\n실제: ${c}`);
    return c;
  });

  await step('플래그 토글 (켜기 ⇄ 끄기)', async () => {
    const row = p.locator('.row[data-opt=embed-subs]');
    assert(await row.count() === 1, '--embed-subs 행이 없다');
    await row.locator('[data-ctl="tri:embed-subs:false"]').click();
    await p.waitForTimeout(200);
    assert((await cmd()).includes('--no-embed-subs'), '끄기 미반영: ' + await cmd());
    await row.locator('[data-ctl="tri:embed-subs:true"]').click();
    await p.waitForTimeout(200);
    const c = await cmd();
    assert(c.includes('--embed-subs') && !c.includes('--no-embed-subs'), '켜기 미반영: ' + c);
    const on = await row.locator('[data-ctl="tri:embed-subs:true"]').getAttribute('aria-pressed');
    assert(on === 'true', '누른 표시가 안 따라온다: aria-pressed=' + on);
    return '--embed-subs ⇄ --no-embed-subs';
  });

  await step('순환 연결 차단', async () => {
    const ok = await p.evaluate(() => {
      const ids = Object.keys(__yt.state.nodes).filter(i => __yt.state.nodes[i].type === 'stage');
      return __yt.connect('out', 'src') === false && __yt.connect(ids[1], ids[0]) === false;
    });
    assert(ok, '순환이 허용됨');
  });

  await step('localStorage 복원', async () => {
    const before = await p.evaluate(() => __yt.commandString());
    await p.waitForTimeout(400);
    await p.reload();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => __yt.commandString());
    assert(before === after, `복원 불일치\n${before}\n${after}`);
    return '동일';
  });

  await step('conf 출력', async () => {
    const conf = await p.evaluate(() => __yt.confString());
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
