/**
 * 자동 수정 루프.
 *
 * 지금까지 고리가 이랬다 — 모델이 명령어를 내고, 검증기가 오류를 잡고,
 * **사람이 그걸 읽고 다시 물었다.** 마지막 칸에 사람이 있을 이유가 없다.
 * 검증기가 뱉은 오류를 그대로 모델에 되먹여서 초록이 될 때까지 돌린다.
 *
 * 툴콜이 아니라 그냥 다음 user 턴이다. 프로토콜을 안 쓰므로 어느 모델에나
 * 통하고, 화면에 새로 그릴 것도 없다 — 대화가 아니라 명령어 한 줄만 바뀐다.
 *
 * 지키는 선이 넷 있다.
 *
 *   · **오류만 다시 묻는다.** 경고와 참고는 판단이지 틀린 게 아니다.
 *     그걸로 다시 물으면 사용자가 시킨 것을 모델이 되돌린다.
 *   · **나아지지 않으면 멈춘다.** 같은 답이 두 번 오면 세 번째도 같다.
 *   · **가장 나은 것을 낸다.** 마지막 라운드가 첫 라운드보다 나쁠 수 있다.
 *   · **최대 세 번.** 호출은 돈이고, 세 번에 못 고치면 사람이 봐야 한다.
 *
 * 고치다가 호출이 깨지면 고치기 전 것을 낸다 — 첫 라운드가 깨진 게 아니라면
 * 손에 명령어가 있다. 그걸 버리고 오류만 보여 주는 건 사용자에게 손해다.
 *
 * ask 를 인자로 받는다 — 네트워크 없이 단위 테스트가 된다.
 */
import { extractCommand, repairText, userText } from './ask.js';
import { lintCommand } from './lint.js';

export const MAX_ROUNDS = 3;

const errorsOf = command =>
  lintCommand(command).issues.filter(i => i.level === 'error').map(i => i.msg);

/**
 * { want, command, send, maxRounds } → 가장 나은 라운드 + 전체 기록.
 *
 * send(userText) 는 { text } 를 주는 함수다 (core/ask.js 의 ask 를 감싼 것).
 * 돌려주는 것: { command, note, errors, ok, rounds, trace, failed? }
 */
export async function repairLoop({ want, command = '', send, maxRounds = MAX_ROUNDS }) {
  const trace = [];
  let user = userText(want, command);
  let best = null;
  let failed = null;

  for (let round = 1; round <= maxRounds; round++) {
    let text;
    try {
      ({ text } = await send(user));
    } catch (e) {
      if (!best) throw e;                     // 첫 라운드가 깨지면 보여 줄 게 없다
      failed = e;
      break;
    }
    const got = extractCommand(text);

    if (!got.command) {
      trace.push({ round, command: '', note: got.note, errors: [], ok: false, lost: true });
      break;                                  // 명령어가 없으면 되먹일 것도 없다
    }

    const errors = errorsOf(got.command);
    const step = { round, command: got.command, note: got.note, errors, ok: !errors.length };
    trace.push(step);

    if (!best || errors.length < best.errors.length) best = step;
    if (step.ok) break;

    const prev = trace[trace.length - 2];
    if (prev && !prev.lost && errors.length >= prev.errors.length) break;   // 안 나아진다

    user = repairText(got.command, errors);
  }

  const out = best || trace[trace.length - 1]
    || { round: 0, command: '', note: '', errors: [], ok: false, lost: true };
  return { ...out, rounds: trace.length, trace, failed };
}

/**
 * 결과를 사람에게 한 줄로.
 *
 * 몇 번 돌았는지는 숨기지 않는다 — 호출이 돈이므로 사용자가 알아야 한다.
 */
export function repairNote(r) {
  const model = (r.note || '').trim();
  if (r.lost || !r.command) return model;
  const line =
    r.failed ? `고치려 다시 묻다가 막혔다(${r.failed.message}) — 아래는 고치기 전 것이다.`
      : r.ok && r.rounds <= 1 ? ''
        : r.ok ? `검증기가 잡은 오류를 ${r.rounds}번 만에 고쳤다.`
          : `${r.rounds}번 물었지만 오류가 남았다 — 아래를 보고 손으로 고칠 것.`;
  return [model, line].filter(Boolean).join(' ');
}
