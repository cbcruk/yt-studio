/**
 * 프롬프트 화면
 *
 * 모델을 부르지 않고 도는 부분 전부 — 명령어 칸이 원본이라는 것, 검증기와
 * 판독이 그 칸을 따라가는 것, 옵션 찾아보기가 층층이 열리는 것, 그래프와
 * 왕복해도 명령어가 안 깎이는 것.
 *
 * 모델 호출만 fetch 를 바꿔치기해서 확인한다. 키를 넣고 실제로 부르면
 * 테스트가 아니라 돈 드는 도박이 된다.
 */
export const view = 'ask';
export const name = '프롬프트 화면';

export default async function ({ p, step, assert }) {
  const cmdBox = () => p.inputValue('.ak-cmd-box');
  const setCmd = async t => {
    await p.fill('.ak-cmd-box', t);
    await p.waitForTimeout(150);
  };
  const verdict = () => p.textContent('.rp-verdict');
  const issues = () => p.textContent('.rp-issues').catch(() => '');

  await step('첫 화면은 프롬프트다', async () => {
    assert(await p.locator('.ask').isVisible(), '프롬프트 화면이 안 보인다');
    assert(!(await p.locator('.main').isVisible()), '캔버스가 같이 보인다');
    assert(await p.locator('#view-ask').getAttribute('aria-selected') === 'true', '탭이 안 눌려 있다');
    const egs = await p.locator('.ak-eg').count();
    assert(egs >= 3, `예시 ${egs}개`);
    return `예시 ${egs}개`;
  });

  await step('예시를 누르면 프롬프트 칸에 들어간다', async () => {
    const t = await p.locator('.ak-eg').first().textContent();
    await p.locator('.ak-eg').first().click();
    await p.waitForTimeout(120);
    assert((await p.inputValue('#prompt')) === t, '프롬프트가 안 채워졌다');
    await p.fill('#prompt', '');
  });

  await step('명령어를 붙여넣으면 바로 검증한다', async () => {
    await setCmd('yt-dlp -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 -o "%(title)s.%(ext)s" https://youtu.be/abc');
    const v = await verdict();
    assert(v.includes('확인됨'), `판정: ${v}`);
    assert(v.includes('스키마'), '대조 개수가 없다');
    return v.replace(/\s+/g, ' ').trim();
  });

  await step('없는 플래그를 잡고 고칠 후보를 준다', async () => {
    await setCmd('yt-dlp --write-sub https://youtu.be/abc');
    assert((await verdict()).includes('오류'), '오류로 안 봤다');
    const fix = p.locator('.rp-fix').first();
    assert(await fix.count() > 0, '고칠 후보가 없다');
    const to = (await fix.textContent()).trim();
    await fix.click();
    await p.waitForTimeout(200);
    assert((await cmdBox()).includes(to), `${to} 로 안 바뀌었다: ${await cmdBox()}`);
    assert(!(await cmdBox()).includes('--write-sub '), '옛 플래그가 남았다');
    return `--write-sub → ${to}`;
  });

  await step('-f 문법을 진짜 파서로 본다', async () => {
    await setCmd('yt-dlp -f "bv+ba/" https://youtu.be/abc');
    assert((await issues()).includes('-f 값을 읽지 못했다'), await issues());
  });

  await step('만들 파일명을 보여 준다', async () => {
    await setCmd('yt-dlp -P home:/dl -o "%(uploader)s/%(title)s.%(ext)s" https://youtu.be/abc');
    const f = await p.textContent('.rp-file');
    assert(f.includes('/dl/‹업로더›/‹제목›.‹확장자›'), `미리보기: ${f}`);
  });

  await step('토큰별로 읽기 — 무슨 옵션인지 말해 준다', async () => {
    await setCmd('yt-dlp --embed-subs --write-subs https://youtu.be/abc');
    await p.locator('.rp-more summary').click();
    await p.waitForTimeout(120);
    const rows = await p.locator('.rp-explain li').count();
    assert(rows === 2, `설명 ${rows}줄 (기대 2)`);
    assert((await p.textContent('.rp-explain')).includes('후처리'), '단계 이름이 없다');
  });

  await step('다음 걸음을 누르면 명령어에 들어간다', async () => {
    await setCmd('yt-dlp -x https://youtu.be/abc');
    const sug = p.locator('.rp-sug').first();
    const flag = (await sug.textContent()).trim();
    await sug.click();
    await p.waitForTimeout(200);
    assert((await cmdBox()).includes(flag), `${flag} 가 안 들어갔다`);
    // URL 은 늘 뒤에 남는다
    assert(/https:\/\/youtu\.be\/abc\s*$/.test(await cmdBox()), `URL 이 뒤가 아니다: ${await cmdBox()}`);
    return flag;
  });

  /* ── 옵션 찾아보기 ─────────────────────── */
  await step('의도 → 핵심 → 관련 → 단계 순으로 열린다', async () => {
    await setCmd('yt-dlp https://youtu.be/abc');
    await p.click('.br-open');
    await p.waitForTimeout(150);
    const chips = await p.locator('.br-chip').count();
    assert(chips >= 12, `의도 ${chips}개`);
    assert(await p.locator('.br-row').count() === 0, '고르기 전인데 옵션이 보인다');

    await p.locator('.br-chip').first().click();
    await p.waitForTimeout(150);
    const core = await p.locator('.br-row').count();
    assert(core >= 3 && core <= 10, `핵심 ${core}개 — 너무 많거나 적다`);

    await p.locator('.br-more').first().click();
    await p.waitForTimeout(150);
    const more = await p.locator('.br-row').count();
    assert(more > core, `관련을 폈는데 ${more}개 (핵심 ${core})`);
    return `의도 ${chips} · 핵심 ${core} → ${more}`;
  });

  await step('플래그형은 눌러서 바로 들어간다', async () => {
    await p.fill('.br-q', 'embed-subs');
    await p.waitForTimeout(200);
    const row = p.locator('.br-row').filter({ hasText: '--embed-subs' }).first();
    await row.locator('.br-pick').click();
    await p.waitForTimeout(200);
    assert((await cmdBox()).includes('--embed-subs'), await cmdBox());
  });

  await step('값형은 값 칸이 먼저 열린다', async () => {
    await p.fill('.br-q', 'sub-langs');
    await p.waitForTimeout(200);
    const row = p.locator('.br-row').filter({ hasText: '--sub-langs' }).first();
    await row.locator('.br-pick').click();
    await p.waitForTimeout(150);
    assert(await row.locator('.br-val input').count() === 1, '값 칸이 안 열렸다');
    await row.locator('.br-val input').fill('ko,en');
    await row.locator('.br-val .btn').click();
    await p.waitForTimeout(200);
    assert((await cmdBox()).includes('--sub-langs ko,en'), await cmdBox());
  });

  await step('단계별 전체도 열린다 — 191개가 다 닿는다', async () => {
    await p.fill('.br-q', '');
    await p.waitForTimeout(150);
    await p.locator('.br-more').last().click();
    await p.waitForTimeout(150);
    const heads = await p.locator('.br-sh').count();
    assert(heads === 9, `단계 ${heads}개 (기대 9)`);
    const sum = await p.evaluate(() =>
      [...document.querySelectorAll('.br-sh .n')].reduce((a, e) => a + Number(e.textContent), 0));
    assert(sum === 191, `단계 합계 ${sum}개 (기대 191)`);
    return `${heads}단계 · ${sum}개`;
  });

  /* ── 그래프 왕복 ───────────────────────── */
  await step('그래프에서 고치기 → 명령어가 그대로 돌아온다', async () => {
    await setCmd('yt-dlp -f "bv+ba" --embed-subs --write-subs -o "%(title)s.%(ext)s" https://youtu.be/abc');
    const before = await cmdBox();
    await p.locator('.ak-cmd-head .btn', { hasText: '그래프에서 고치기' }).click();
    await p.waitForTimeout(400);
    assert(await p.locator('.main').isVisible(), '캔버스로 안 갔다');
    assert((await p.textContent('#cmd')).includes('--embed-subs'), '그래프가 옵션을 놓쳤다');

    await p.click('#view-ask');
    await p.waitForTimeout(300);
    const after = await cmdBox();
    for (const t of ['-f bv+ba', '--embed-subs', '--write-subs', 'youtu.be/abc'])
      assert(after.includes(t), `${t} 가 왕복에서 사라졌다: ${after}`);
    return before.length === after.length ? '글자까지 동일' : '토큰 보존';
  });

  await step('모르는 플래그도 왕복에서 안 사라진다', async () => {
    await setCmd('yt-dlp --embed-subs --write-subs --some-future-flag https://youtu.be/abc');
    await p.locator('.ak-cmd-head .btn', { hasText: '그래프에서 고치기' }).click();
    await p.waitForTimeout(400);
    assert((await p.textContent('#notes')).includes('--some-future-flag'), '노트에 안 남았다');
    assert((await p.textContent('#cmd')).includes('--some-future-flag'), '명령어에서 사라졌다');

    await p.click('#view-ask');
    await p.waitForTimeout(300);
    assert((await cmdBox()).includes('--some-future-flag'), `사라졌다: ${await cmdBox()}`);
  });

  /* ── 모델 호출 ─────────────────────────── */
  await step('키가 없으면 프롬프트 팩을 연다', async () => {
    await p.fill('#prompt', '자막도 넣어 줘');
    await p.click('.ak-bar .btn.primary');
    await p.waitForTimeout(250);
    assert(await p.locator('#dlg-pack').isVisible(), '프롬프트 팩이 안 열렸다');
    const pack = await p.inputValue('#pack-text');
    assert(pack.includes('카탈로그에 없는 플래그는 절대 쓰지 마라'), '규칙이 없다');
    assert(pack.includes('--embed-subs'), '카탈로그가 없다');
    assert(pack.includes('자막도 넣어 줘'), '요구가 없다');
    await p.click('#dlg-pack .btn[value=cancel]');
    await p.waitForTimeout(150);
    return `${Math.round(pack.length / 1000)}k자`;
  });

  await step('키를 넣으면 모델을 부르고 답에서 명령어만 꺼낸다', async () => {
    await p.evaluate(() => {
      window.__calls = [];
      window.fetch = async (url, init) => {
        window.__calls.push({ url, init });
        return {
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: '이렇게 하세요.\n```bash\nyt-dlp --write-subs --sub-langs ko https://youtu.be/abc\n```\n한국어 자막을 같이 받는다.' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        };
      };
    });
    await p.locator('.ak-bar .btn', { hasText: '키 넣기' }).click();
    await p.waitForTimeout(200);
    await p.fill('#key-input', 'sk-ant-test-key-0000');
    await p.click('#key-save');
    await p.waitForTimeout(250);

    await p.fill('#prompt', '한국어 자막도 받아 줘');
    await p.click('.ak-bar .btn.primary');
    await p.waitForTimeout(500);

    const calls = await p.evaluate(() => window.__calls.length);
    assert(calls === 1, `호출 ${calls}번`);
    const cmd = await cmdBox();
    assert(cmd === 'yt-dlp --write-subs --sub-langs ko https://youtu.be/abc', `꺼낸 명령어: ${cmd}`);
    assert((await p.textContent('.ak-note')).includes('한국어 자막'), '설명이 안 붙었다');
    assert((await p.inputValue('#prompt')) === '', '프롬프트가 안 비워졌다');
    assert((await verdict()).includes('확인됨'), '받아 온 명령어를 검증 안 했다');
  });

  await step('키는 가려서 보이고 히스토리에 남는다', async () => {
    const label = await p.locator('.ak-bar .btn', { hasText: '키 ' }).textContent();
    assert(label.includes('…0000'), `키 표시: ${label}`);
    assert(!label.includes('test-key-0000'), '키가 통째로 보인다');

    await p.click('.ak-hist summary');
    await p.waitForTimeout(150);
    const hist = await p.textContent('.ak-hist');
    assert(hist.includes('--sub-langs ko'), '히스토리에 없다');
    assert(hist.includes('한국어 자막도 받아 줘'), '프롬프트가 안 남았다');
  });

  await step('모델이 거부하면 그렇게 말한다', async () => {
    await p.evaluate(() => {
      window.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    });
    await p.fill('#prompt', '뭐든');
    await p.click('.ak-bar .btn.primary');
    await p.waitForTimeout(400);
    const err = await p.textContent('.ak-err');
    assert(err.includes('API 키가 거부됐다'), `오류: ${err}`);
  });

  await step('새로고침해도 명령어와 히스토리가 남는다', async () => {
    const before = await cmdBox();
    await p.reload();
    await p.waitForTimeout(400);
    assert((await cmdBox()) === before, '명령어가 날아갔다');
    assert(await p.locator('.ak-hist').count() === 1, '히스토리가 날아갔다');
    assert((await p.locator('.ak-bar .btn', { hasText: '키 ' }).textContent()).includes('…0000'), '키가 날아갔다');
  });
}
