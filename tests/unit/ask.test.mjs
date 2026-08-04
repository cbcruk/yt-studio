/**
 * 프롬프트 층 — 카탈로그 · 프롬프트 조립 · 답 파싱 · 판독.
 *
 * 모델을 부르는 부분은 fetch 를 넣어서 검사한다. 실제로 호출하지 않는다 —
 * 검사가 네트워크와 키에 매이면 테스트가 아니라 도박이 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema, BY_ID } from '../../src/core/schema.js';

const SCHEMA = JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8'));
initSchema(SCHEMA);
const { STAGES, BY_STAGE, OPTS } = await import('../../src/core/schema.js');
const catalog = await import('../../src/core/catalog.js');
const askmod = await import('../../src/core/ask.js');
const explain = await import('../../src/core/explain.js');
const { lintCommand } = await import('../../src/core/lint.js');

const { INTENTS, catalogLine, catalogText, intentCore, intentMore, uncovered } = catalog;
const { ask, AskError, describeStatus, extractCommand, systemBlocks, userText, maskKey } = askmod;
const { previewFilename, explainCommand, suggestNext, DEFAULT_OUTTMPL } = explain;

/* ── 카탈로그 ────────────────────────────── */
test('의도가 가리키는 옵션은 전부 실재한다', () => {
  for (const it of INTENTS) {
    for (const id of it.ids) {
      assert.ok(BY_ID[id], `${it.key} 의 ${id} 가 스키마에 없다`);
    }
  }
});

test('의도 키와 이름은 겹치지 않는다', () => {
  assert.equal(new Set(INTENTS.map(i => i.key)).size, INTENTS.length);
  assert.equal(new Set(INTENTS.map(i => i.label)).size, INTENTS.length);
});

test('의도마다 핵심이 있고, 관련은 핵심과 겹치지 않는다', () => {
  for (const it of INTENTS) {
    const core = intentCore(it.key);
    assert.ok(core.length >= 3, `${it.key} 의 핵심이 ${core.length}개뿐이다`);
    const ids = new Set(core.map(o => o.id));
    for (const o of intentMore(it.key)) {
      assert.equal(ids.has(o.id), false, `${it.key}: ${o.id} 가 핵심과 관련에 겹친다`);
    }
  }
});

test('의도 16개가 옵션의 절반 가까이를 덮는다', () => {
  const covered = OPTS.length - uncovered().length;
  assert.ok(covered >= 70, `${covered}개만 덮는다 — 의도를 더 채울 것`);
});

test('카탈로그 한 줄에 플래그·인자·도움말이 다 있다', () => {
  const line = catalogLine(BY_ID.format);
  assert.match(line, /--format, -f/);
  assert.match(line, /FORMAT/);
  const flag = catalogLine(BY_ID['embed-subs']);
  assert.doesNotMatch(flag, /VALUE/);           // 플래그는 인자 자리가 없다
  assert.match(catalogLine(BY_ID.fixup), /choices: never\|/);
  assert.match(catalogLine(BY_ID.paths), /반복 가능/);
});

test('카탈로그 전문은 옵션 191개를 한 줄씩 담는다', () => {
  const text = catalogText(STAGES, BY_STAGE);
  for (const s of STAGES) assert.ok(text.includes(`## ${s.id} — ${s.label}`), s.id);
  const lines = text.split('\n').filter(l => l.startsWith('--') || l.startsWith('-'));
  assert.equal(lines.length, OPTS.length);
});

/* ── 프롬프트 ────────────────────────────── */
test('시스템 블록은 규칙과 카탈로그 둘로 나뉘고 카탈로그에 캐시가 걸린다', () => {
  const blocks = systemBlocks(SCHEMA.ytdlp_version, STAGES, BY_STAGE);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].cache_control, undefined);
  assert.deepEqual(blocks[1].cache_control, { type: 'ephemeral' });
  assert.match(blocks[1].text, new RegExp(SCHEMA.ytdlp_version));
  assert.match(blocks[0].text, /카탈로그에 없는 플래그는 절대 쓰지 마라/);
});

test('명령어가 있으면 "고쳐 줘" 로 묻는다', () => {
  assert.equal(userText('자막도', ''), '자막도');
  const t = userText('자막도', 'yt-dlp -f b https://x/y');
  assert.match(t, /지금 명령어/);
  assert.match(t, /yt-dlp -f b/);
  assert.match(t, /자막도/);
});

/* ── 답 파싱 ─────────────────────────────── */
test('코드 펜스에서 명령어를 꺼내고 뒤의 한 줄을 설명으로 삼는다', () => {
  const r = extractCommand('```bash\nyt-dlp -f b https://x/y\n```\n1080p 로 받는다.');
  assert.equal(r.command, 'yt-dlp -f b https://x/y');
  assert.equal(r.note, '1080p 로 받는다.');
});

test('펜스가 없어도 yt-dlp 로 시작하는 줄을 찾는다', () => {
  assert.equal(extractCommand('이렇게 하세요:\nyt-dlp --embed-subs https://x/y').command,
    'yt-dlp --embed-subs https://x/y');
});

test('줄바꿈 이어쓰기를 편다', () => {
  const r = extractCommand('```\nyt-dlp -f b \\\n  --embed-subs https://x/y\n```');
  // 공백은 안 건드린다 — 인용부호 안의 공백까지 뭉갤 수는 없다
  assert.equal(r.command, 'yt-dlp -f b  --embed-subs https://x/y');
});

test('명령어가 없으면 빈 문자열이다 — 지어내지 않는다', () => {
  assert.equal(extractCommand('무슨 말인지 모르겠습니다').command, '');
  assert.equal(extractCommand('').command, '');
});

/* ── 호출 ────────────────────────────────── */
test('키가 없으면 부르기 전에 멈춘다', async () => {
  await assert.rejects(() => ask({ key: '', user: 'x', fetchImpl: () => { throw new Error('불렸다'); } }),
    e => e instanceof AskError && e.kind === 'auth');
});

test('브라우저에서 직접 부르는 헤더를 붙인다', async () => {
  let seen = null;
  await ask({
    key: 'sk-test', user: '자막', system: [{ type: 'text', text: 'rules' }],
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'yt-dlp -f b https://x' }] }) };
    },
  });
  assert.equal(seen.url, askmod.ENDPOINT);
  assert.equal(seen.init.headers['x-api-key'], 'sk-test');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.messages, [{ role: 'user', content: '자막' }]);
});

test('상태 코드를 다음에 할 일로 옮긴다', async () => {
  assert.equal(describeStatus(401)[0], 'auth');
  assert.equal(describeStatus(429)[0], 'rate');
  assert.equal(describeStatus(503)[0], 'server');
  await assert.rejects(
    () => ask({ key: 'k', user: 'x', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }),
    e => e.kind === 'auth' && /API 키가 거부됐다/.test(e.message));
});

test('네트워크가 끊기면 그렇게 말한다', async () => {
  await assert.rejects(
    () => ask({ key: 'k', user: 'x', fetchImpl: async () => { throw new Error('offline'); } }),
    e => e.kind === 'network');
});

test('키는 끝 네 자리만 보인다', () => {
  assert.equal(maskKey(''), '');
  assert.match(maskKey('sk-ant-abcdefghijklmnop'), /^sk-ant-…mnop$/);
  assert.equal(maskKey('short'), '••••');
});

/* ── 판독 ────────────────────────────────── */
test('파일명 미리보기 — -o 가 없으면 yt-dlp 기본값을 쓴다', () => {
  const p = previewFilename({});
  assert.equal(p.dflt, true);
  assert.match(p.text, /‹제목›/);
  assert.match(DEFAULT_OUTTMPL, /%\(ext\)s/);
});

test('파일명 미리보기 — -P home 을 앞에 붙인다', () => {
  const { values } = lintCommand('yt-dlp -P home:/dl -o "%(uploader)s/%(title)s.%(ext)s" https://x/y');
  const p = previewFilename(values);
  assert.equal(p.text, '/dl/‹업로더›/‹제목›.‹확장자›');
});

test('파일명 미리보기 — 못 읽으면 원문을 그대로 둔다', () => {
  const p = previewFilename({ output: '%(title)s.%(ext' });
  assert.equal(p.ok, false);
  assert.equal(p.text, '%(title)s.%(ext');
});

test('토큰마다 무슨 옵션인지 말한다', () => {
  const { items } = lintCommand('yt-dlp --embed-subs --no-part https://x/y');
  const rows = explainCommand(items);
  assert.equal(rows[0].id, 'embed-subs');
  assert.equal(rows[0].stageLabel, '후처리');
  assert.match(rows[1].ko, /끄기$/);           // 부정형은 끈 것이라고 말한다
  assert.equal(rows[2].kind, 'url');
});

test('다음 걸음은 지금 조합이 부르는 것만 낸다', () => {
  const audio = suggestNext(lintCommand('yt-dlp -x https://x/y').values).map(s => s.opt.id);
  assert.ok(audio.includes('audio-format'));
  assert.equal(audio.includes('sub-langs'), false);

  const subs = suggestNext(lintCommand('yt-dlp --write-subs https://x/y').values).map(s => s.opt.id);
  assert.ok(subs.includes('embed-subs'));
});

test('이미 준 옵션은 다시 권하지 않는다', () => {
  const v = lintCommand('yt-dlp -x --audio-format mp3 --embed-thumbnail --embed-metadata https://x/y').values;
  const ids = suggestNext(v).map(s => s.opt.id);
  for (const id of ['audio-format', 'embed-thumbnail', 'embed-metadata']) {
    assert.equal(ids.includes(id), false, id);
  }
});

test('아무 규칙도 안 걸리면 시작점을 준다', () => {
  const ids = suggestNext(lintCommand('yt-dlp https://x/y').values).map(s => s.opt.id);
  assert.ok(ids.includes('format'));
});
