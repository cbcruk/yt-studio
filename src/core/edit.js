/**
 * 명령어 문자열 편집.
 *
 * 원본이 그래프가 아니라 명령어라서 생긴 층이다. 의도 칩을 누르든, 다음 걸음을
 * 누르든, 오타 후보를 누르든 — UI 가 무엇을 하든 결국 문자열이 이 두 함수로
 * 바뀐다. 그래서 규칙도 여기 하나씩만 있다.
 *
 *   · 새 플래그는 URL **앞**에 들어간다 (뒤로 가면 읽기 나쁘다)
 *   · 플래그를 갈아 끼울 때 값은 건드리지 않고, 더 긴 플래그의 앞부분을
 *     잘못 집지도 않는다 (`--sub` 를 고치다 `--sub-langs` 를 깨면 안 된다)
 *
 * DOM 도 앱 상태도 모른다. 문자열이 들어가고 문자열이 나온다.
 */
import { scanCommand } from './pipeline.js';

/**
 * 토큰 하나를 끼운 명령어를 돌려준다.
 *
 * 이어 붙이지 않고 다시 조립한다 — scanCommand 가 값을 표준 인용으로 되돌리므로
 * 여러 번 눌러도 따옴표가 늘거나 줄지 않는다.
 */
export function addToken(command, text) {
  const t = String(text ?? '').trim();
  const cur = String(command ?? '').trim();
  if (!t) return cur;
  if (!cur) return 'yt-dlp ' + t;

  const { head, items } = scanCommand(cur);
  return [
    head || 'yt-dlp',
    ...items.filter(i => i.kind !== 'url').map(i => i.raw),
    t,
    ...items.filter(i => i.kind === 'url').map(i => i.raw),
  ].join(' ');
}

/**
 * 플래그 자리만 갈아 끼운 명령어를 돌려준다.
 *
 * `(?=[\s=]|$)` 가 핵심이다. 이게 없으면 `--sub` 를 고치라는 말이
 * `--sub-langs` 의 앞부분까지 집는다. `--flag=값` 꼴도 살려 둔다.
 */
export function replaceFlag(command, from, to) {
  const cur = String(command ?? '');
  if (!from || !to) return cur;
  const esc = String(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cur.replace(new RegExp(`(^|\\s)${esc}(?=[\\s=]|$)`, 'g'), `$1${to}`);
}
