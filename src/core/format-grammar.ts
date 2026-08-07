/**
 * yt-dlp 포맷 셀렉터 문법.
 *
 * `-f` 는 평평한 값이 아니라 표현식이다. 이 파일이 그 문법의 전부다.
 *
 *   atom     := (셀렉터 | '(' expr ')') 필터*   bv*[height<=1080] · (mp4,webm)[height<480]
 *   merge    := atom ('+' atom)*                bv+ba
 *   fallback := merge ('/' merge)*              bv+ba/b   ==   (bv+ba)/b
 *   multi    := fallback (',' fallback)*        bv,ba
 */

/** 연산자 우선순위. 자식이 부모보다 낮으면 괄호로 묶는다. */
export const PREC = { multi: 0, fallback: 1, merge: 2, sel: 3 } as const;

/** 표현식을 이루는 연산자. */
export type FormatOp = 'merge' | 'fallback' | 'multi';

const OP_SEP: Record<FormatOp, string> = { merge: '+', fallback: '/', multi: ',' };

/** `[height<=?1080]` 한 칸. `loose` 가 참이면 `?` 가 붙는다. */
export interface Filter {
  key: string;
  op: string;
  loose?: boolean;
  value: string;
}

/**
 * 식 트리.
 *
 * 필터는 셀렉터에만 붙는 게 아니라 **연산자 노드에도 붙는다** —
 * `(mp4,webm)[height<480]` 은 yt-dlp 문서에 나오는 표현이다.
 */
export type FormatNode =
  | { t: 'sel'; name: string; filters: Filter[] }
  | { t: FormatOp; kids: FormatNode[]; filters?: Filter[] };

/**
 * 셀렉터 어휘 — 이름과 한 줄 설명.
 *
 * 리플렉션이 못 주는 층이다. yt-dlp 는 `-f` 값을 그냥 문자열로 받으므로
 * optparse 트리에는 `b` · `bv` 가 무슨 뜻인지가 없다. 손으로 적는다.
 * 빌더의 메서드 이름과 자동완성 설명이 여기서 나온다.
 */
export const SELECTORS: [group: string, items: [sel: string, help: string][]][] = [
  ['영상 + 음성 (한 파일)', [
    ['b',  'best — 영상·음성이 같이 든 것 중 최고'],
    ['b*', 'best* — 종류 안 가리고 최고'],
    ['w',  'worst — 같이 든 것 중 최저'],
    ['w*', 'worst* — 종류 안 가리고 최저'],
  ]],
  ['영상만', [
    ['bv',  'bestvideo — 영상만 든 것 중 최고'],
    ['bv*', 'bestvideo* — 영상이 든 것 중 최고 (음성 동봉 허용)'],
    ['wv',  'worstvideo — 영상만 든 것 중 최저'],
    ['wv*', 'worstvideo* — 영상이 든 것 중 최저'],
  ]],
  ['음성만', [
    ['ba',  'bestaudio — 음성만 든 것 중 최고'],
    ['ba*', 'bestaudio* — 음성이 든 것 중 최고 (영상 동봉 허용)'],
    ['wa',  'worstaudio — 음성만 든 것 중 최저'],
    ['wa*', 'worstaudio* — 음성이 든 것 중 최저'],
  ]],
];

export const SEL_HELP: Record<string, string> =
  Object.fromEntries(SELECTORS.flatMap(([, items]) => items));

/**
 * 필터 필드. yt-dlp 문서에서 옮긴 것으로, `num`/`str` 에 따라 쓸 수 있는
 * 비교가 다르다. 이것도 손으로 적는 층이다 — 빌더의 `Filters` 타입이 여기서 난다.
 */
export const FKEYS: [key: string, label: string, type: 'num' | 'str'][] = [
  ['height', '세로 해상도', 'num'], ['width', '가로 해상도', 'num'], ['fps', '프레임', 'num'],
  ['tbr', '전체 비트레이트', 'num'], ['vbr', '영상 비트레이트', 'num'], ['abr', '음성 비트레이트', 'num'],
  ['asr', '샘플레이트', 'num'], ['audio_channels', '음성 채널 수', 'num'],
  ['filesize', '파일 크기', 'num'], ['filesize_approx', '대략 크기', 'num'],
  ['aspect_ratio', '화면비', 'num'],
  ['ext', '확장자', 'str'], ['vcodec', '영상 코덱', 'str'], ['acodec', '음성 코덱', 'str'],
  ['container', '컨테이너', 'str'], ['protocol', '프로토콜', 'str'], ['format_id', '포맷 ID', 'str'],
  ['format_note', '포맷 노트', 'str'], ['resolution', '해상도', 'str'], ['language', '언어', 'str'],
  ['dynamic_range', '다이내믹 레인지', 'str'],
];

/** `height<=?1080` · `format_note` · `!format_note` 를 필터 한 칸으로. */
export function parseFilterBody(body: string): Filter {
  const b = body.trim();
  if (!b) throw new Error('빈 필터');
  const m = b.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(!?[\^$*~]?=|<=|>=|<|>)(\??)\s*(.*)$/);
  if (m) return { key: m[1], op: m[2], loose: m[3] === '?', value: m[4].trim() };
  if (/^![A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b.slice(1), op: 'hasnot', value: '' };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b, op: 'has', value: '' };
  throw new Error(`필터를 읽지 못했다: [${body}]`);
}

/** 포맷 셀렉터 문자열 → 트리. 못 읽으면 이유를 담아 던진다. */
export function parseFormat(src: string): FormatNode | null {
  const s = (src || '').trim();
  if (!s) return null;
  let i = 0;
  const ws = (): void => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = (): string | undefined => s[i];

  const expr = (): FormatNode => multi();

  function multi(): FormatNode {
    const kids = [fallback()]; ws();
    while (peek() === ',') { i++; kids.push(fallback()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'multi', kids };
  }
  function fallback(): FormatNode {
    const kids = [merge()]; ws();
    while (peek() === '/') { i++; kids.push(merge()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'fallback', kids };
  }
  function merge(): FormatNode {
    const kids = [atom()]; ws();
    while (peek() === '+') { i++; kids.push(atom()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'merge', kids };
  }

  /**
   * atom := (셀렉터 | '(' expr ')') 필터*
   *
   * 필터를 읽는 자리를 셀렉터 뒤가 아니라 atom 끝에 둔다 — 무엇이 왔든 그
   * 노드에 단다. 그래야 그룹에 붙은 필터도 읽힌다.
   */
  function atom(): FormatNode {
    ws();
    let node: FormatNode;
    if (peek() === '(') {
      i++; node = expr(); ws();
      if (peek() !== ')') throw new Error("')' 가 닫히지 않았다");
      i++;
    } else {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_*.\-]/.test(s[i])) i++;
      if (i === start) throw new Error(`셀렉터를 찾지 못했다 (${i + 1}번째 글자 근처)`);
      node = { t: 'sel', name: s.slice(start, i), filters: [] };
    }
    ws();
    while (peek() === '[') {
      i++;
      const j = s.indexOf(']', i);
      if (j < 0) throw new Error("']' 가 닫히지 않았다");
      (node.filters ||= []).push(parseFilterBody(s.slice(i, j)));
      i = j + 1; ws();
    }
    return node;
  }

  const tree = expr(); ws();
  if (i < s.length) throw new Error(`읽고 남은 글자: "${s.slice(i)}"`);
  return tree;
}

/** 필터 하나 → `[height<=1080]`. `has`/`hasnot` 은 값 없이 이름만 쓴다. */
export function emitFilter(f: Filter): string {
  if (f.op === 'has') return '[' + f.key + ']';
  if (f.op === 'hasnot') return '[!' + f.key + ']';
  return '[' + f.key + f.op + (f.loose ? '?' : '') + f.value + ']';
}

/**
 * 괄호를 붙일지 정할 때 쓰는 실효 우선순위.
 *
 * 필터가 달린 연산자는 이미 제 괄호를 쓰고 나온다(`(mp4,webm)[…]`). 그러면
 * 원자와 다를 바 없으므로 부모가 또 감싸지 않게 sel 취급한다.
 */
const effPrec = (n: FormatNode): number =>
  (n.t !== 'sel' && (n.filters || []).length) ? PREC.sel : PREC[n.t];

/** 트리 → 포맷 셀렉터 문자열. 필요한 괄호만 붙인다. */
export function emitTree(n: FormatNode | null): string {
  if (!n) return '';
  const filters = (n.filters || []).map(emitFilter).join('');
  if (n.t === 'sel') return n.name + filters;
  const body = n.kids.map(k => {
    const s = emitTree(k);
    return effPrec(k) < PREC[n.t] ? '(' + s + ')' : s;   // 우선순위가 낮으면 괄호로
  }).join(OP_SEP[n.t]);
  return filters ? '(' + body + ')' + filters : body;
}
