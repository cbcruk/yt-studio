/**
 * 자동 수정 루프.
 *
 * 모델은 대본으로 대신한다 — 라운드마다 무슨 답이 오는지 정해 두면, 루프가
 * 언제 다시 묻고 언제 그만두는지가 그대로 드러난다. 검증기는 진짜를 쓴다.
 * 여기서 확인하려는 게 "무엇을 오류로 보고 되먹이는가" 이기 때문이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema } from '../../src/core/schema.js';

initSchema(JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8')));
const { MAX_ROUNDS, repairLoop, repairNote } = await import('../../src/core/repair.js');
const { repairText } = await import('../../src/core/ask.js');

/** 라운드마다 답을 하나씩 꺼내 주는 대본. 실제로 받은 user 턴을 다 적어 둔다. */
function script(...replies) {
  const seen = [];
  const send = async user => {
    seen.push(user);
    const r = replies[seen.length - 1];
    if (r === undefined) throw new Error(`대본에 없는 ${seen.length}번째 호출`);
    if (r instanceof Error) throw r;
    return { text: r };
  };
  send.seen = seen;
  return send;
}

const fence = (cmd, note = '') => '```\n' + cmd + '\n```\n' + note;

const GOOD = 'yt-dlp --write-subs https://youtu.be/abc';
const BAD1 = 'yt-dlp --write-sub https://youtu.be/abc';
const BAD2 = 'yt-dlp --write-sub --embed-subtitle https://youtu.be/abc';
const BAD3 = 'yt-dlp --write-sub --embed-subtitle --bogus-flag https://youtu.be/abc';

/* ── 되먹이는 문장 ───────────────────────── */
test('되먹이는 문장에 명령어와 오류가 다 있고, 요구를 바꾸지 말라고 못 박는다', () => {
  const t = repairText(BAD1, ['--write-sub 는 없는 플래그다']);
  assert.match(t, /--write-sub 는 없는 플래그다/);
  assert.ok(t.includes(BAD1));
  assert.match(t, /원래 요구는 그대로/);
});

/* ── 루프 ────────────────────────────────── */
test('한 번에 초록이면 한 번만 부른다', async () => {
  const send = script(fence(GOOD, '한국어 자막을 같이 받는다.'));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(r.ok, true);
  assert.equal(r.command, GOOD);
  assert.equal(r.rounds, 1);
  assert.equal(send.seen.length, 1);
  assert.equal(send.seen[0], '자막도');       // 첫 턴은 그냥 사용자의 요구다
});

test('오류를 되먹여서 두 번째에 고친다', async () => {
  const send = script(fence(BAD1), fence(GOOD, '플래그 이름을 고쳤다.'));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(r.ok, true);
  assert.equal(r.command, GOOD);
  assert.equal(r.rounds, 2);
  // 두 번째 턴은 검증기가 한 말을 그대로 옮긴 것이다
  assert.match(send.seen[1], /--write-sub 는 이 yt-dlp 버전에 없는 플래그다/);
  assert.ok(send.seen[1].includes(BAD1));
  assert.equal(r.trace[0].ok, false);
  assert.equal(r.trace[1].ok, true);
});

test('경고와 참고로는 다시 묻지 않는다 — 판단이지 틀린 게 아니다', async () => {
  const warn = 'yt-dlp -x -f bv https://youtu.be/abc';
  const send = script(fence(warn));
  const r = await repairLoop({ want: '음원만', send });

  assert.equal(send.seen.length, 1, '경고를 오류로 보고 다시 물었다');
  assert.equal(r.ok, true);
  assert.equal(r.command, warn);
});

test('나아지지 않으면 멈춘다 — 같은 답이 두 번 오면 세 번째도 같다', async () => {
  const send = script(fence(BAD1), fence(BAD1), fence(GOOD));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(send.seen.length, 2, `호출 ${send.seen.length}번 — 안 나아지는데 더 물었다`);
  assert.equal(r.ok, false);
  assert.equal(r.rounds, 2);
});

test('더 나빠지면 멈추고, 가장 나은 라운드를 낸다', async () => {
  const send = script(fence(BAD1), fence(BAD3));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(r.command, BAD1, '나중 것이 더 나쁜데 그걸 냈다');
  assert.equal(r.errors.length, 1);
  assert.equal(r.round, 1);
  assert.equal(r.rounds, 2);
});

test('세 번까지만 묻고, 남은 오류를 숨기지 않는다', async () => {
  const send = script(fence(BAD3), fence(BAD2), fence(BAD1), fence(GOOD));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(send.seen.length, MAX_ROUNDS, `호출 ${send.seen.length}번`);
  assert.equal(r.ok, false);
  assert.equal(r.command, BAD1);              // 셋 중 가장 나은 것
  assert.equal(r.errors.length, 1);
});

test('maxRounds 를 줄이면 그만큼만 묻는다', async () => {
  const send = script(fence(BAD3), fence(BAD2), fence(BAD1));
  const r = await repairLoop({ want: '자막도', send, maxRounds: 2 });

  assert.equal(send.seen.length, 2);
  assert.equal(r.command, BAD2);
});

test('지금 명령어가 있으면 "고쳐 줘" 로 시작한다', async () => {
  const send = script(fence(GOOD));
  await repairLoop({ want: '자막도', command: 'yt-dlp -f b https://x/y', send });
  assert.match(send.seen[0], /지금 명령어/);
  assert.match(send.seen[0], /yt-dlp -f b/);
});

test('명령어가 없으면 되먹일 것도 없다 — 거기서 멈춘다', async () => {
  const send = script('무슨 말인지 모르겠습니다', fence(GOOD));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(send.seen.length, 1);
  assert.equal(r.command, '');
  assert.equal(r.lost, true);
  assert.equal(r.ok, false);
});

test('고치다 막히면 고치기 전 것을 낸다', async () => {
  const send = script(fence(BAD1), new Error('요청이 너무 잦다'));
  const r = await repairLoop({ want: '자막도', send });

  assert.equal(r.command, BAD1, '손에 있던 명령어를 버렸다');
  assert.equal(r.failed.message, '요청이 너무 잦다');
  assert.equal(r.rounds, 1);
});

test('첫 호출이 막히면 그대로 던진다 — 보여 줄 게 없다', async () => {
  const send = script(new Error('API 키가 거부됐다'));
  await assert.rejects(() => repairLoop({ want: '자막도', send }), /API 키가 거부됐다/);
});

/* ── 한 줄 알림 ──────────────────────────── */
test('한 번에 됐으면 모델 설명만, 여러 번이면 몇 번인지 붙인다', () => {
  assert.equal(repairNote({ command: GOOD, note: '자막을 받는다.', ok: true, rounds: 1 }),
    '자막을 받는다.');
  assert.match(repairNote({ command: GOOD, note: '고쳤다.', ok: true, rounds: 2 }), /2번 만에 고쳤다/);
  assert.match(repairNote({ command: BAD1, note: '', ok: false, rounds: 3 }), /손으로 고칠 것/);
  assert.match(repairNote({ command: BAD1, note: '', ok: false, rounds: 1, failed: new Error('끊겼다') }),
    /막혔다\(끊겼다\)/);
  assert.equal(repairNote({ command: '', note: '모르겠다', lost: true }), '모르겠다');
});
