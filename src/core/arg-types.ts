/**
 * 값의 타입 — 리플렉션 위에 얹는 덧칠.
 *
 * 옵션 **목록**은 스키마가 정한다. 여기서 정하는 것은 그 옵션이 받는 값이
 * 무엇으로 생겼는지뿐이다. 이 파일이 통째로 없어져도 메서드는 그대로 있고,
 * 다만 전부 `Arg` 가 된다.
 *
 * 지금까지 값 받는 옵션은 전부 `Arg = string | number` 였다. 그건 **양쪽으로
 * 틀리다** — 파일 경로에 숫자를 받고, 초에 아무 문자열을 받는다.
 *
 *     ytdlp(u).cookies(42)            // 경로에 숫자
 *     ytdlp(u).socketTimeout('빠르게')  // 초에 글자
 *
 * 좁힐 때 지키는 것 하나: **yt-dlp 가 받는 값을 막으면 안 된다.** 못 잡는 것보다
 * 나쁘다. 그래서 여기 적힌 것은 전부 yt-dlp 의 파서에 넣어 확인한 것이다.
 */
import type { Opt } from './schema.js';

/**
 * 값이 절대 숫자일 수 없는 metavar.
 *
 * optparse 의 `type` 은 이걸 못 갈라 준다 — 값을 받는 옵션 86개가 전부
 * `string` 이다. 명령줄에서는 뭐든 문자열이니 당연하다. 그래서 "숫자를 쓰는
 * 게 자연스러운 것"(`--audio-quality 0` · `--max-filesize 1024`)과 갈라야 하는데,
 * **확실한 쪽만** 적는다. 애매하면 안 적는다.
 */
const NEVER_NUMBER = new Set([
  'FILE', 'PATH', 'DIR', 'CERTFILE', 'KEYFILE',
  'URL', 'IP',
  'USERNAME', 'PASSWORD', 'TWOFACTOR', 'NETRC_CMD',
]);

/**
 * metavar 마다의 값 타입. 여기 적힌 이름은 `options.gen.ts` 가 같이 낸다.
 *
 * 셋 다 yt-dlp 의 파서로 대조했다.
 *
 *   · `SIZE` · `RATE` — `parse_bytes` 는 `<수>[KMGTPEZY]` 를 대소문자 없이 받고
 *     소수도 받는다(`44.6M`). `50KB` 는 **거절한다** — 표에 없는 단위다.
 *   · `RETRIES` — 수 아니면 `infinite`.
 */
const BY_METAVAR: Record<string, string> = {
  SIZE: 'Size',
  RATE: 'Size',
  RETRIES: 'Retries',
};

/**
 * 이 옵션이 받는 값의 타입 이름. 모르겠으면 `null` — 그러면 `Arg` 가 된다.
 *
 * 순서가 있다. metavar 로 아는 모양이 먼저이고(`SIZE`), 그다음이 optparse 의
 * `type`(`int` · `float`), 마지막이 "숫자일 수 없는 것".
 */
export function argType(o: Opt): string | null {
  const mv = o.metavar ?? '';
  const named = BY_METAVAR[mv];
  if (named) return named;

  // optparse 가 수로 읽는다고 적어 둔 것. 아닌 값은 optparse 가 거절한다.
  if (o.valueType === 'int' || o.valueType === 'float') return 'number';

  if (NEVER_NUMBER.has(mv)) return 'string';
  return null;
}

/** `arg-types.ts` 가 아는 metavar 전부. 검사가 스키마와 대조한다. */
export const KNOWN_METAVARS: string[] = [...Object.keys(BY_METAVAR), ...NEVER_NUMBER];
