/**
 * yt-dlp 포맷 셀렉터 문법.
 *
 * -f 는 평평한 값이 아니라 표현식이다. 이 파일이 그 문법의 전부이며,
 * DOM 도 앱 상태도 모른다. 그래서 브라우저 없이 단위 테스트할 수 있다.
 *
 *   atom     := 셀렉터 필터*          bv*[height<=1080]
 *   merge    := atom ('+' atom)*      bv+ba
 *   fallback := merge ('/' merge)*    bv+ba/b   ==   (bv+ba)/b
 *   multi    := fallback (',' …)*     bv,ba
 */

/** 연산자 우선순위. 자식이 부모보다 낮으면 괄호로 묶는다. */
export const PREC = { multi: 0, fallback: 1, merge: 2, sel: 3 };

/** 표현식 노드가 되는 연산자들. */
export const FORMAT_OPS = ['merge', 'fallback', 'multi'];

/** 연산자 → 표기 기호. */
export const OP_SEP = { merge: '+', fallback: '/', multi: ',' };

/**
 * 셀렉터 어휘 — 이름과 한 줄 설명.
 *
 * 리플렉션이 못 주는 층이다. yt-dlp 는 `-f` 값을 그냥 문자열로 받으므로
 * optparse 트리에는 `b` · `bv` 가 무슨 뜻인지가 없다. 손으로 적는다.
 * 빌더의 메서드 이름과 자동완성 설명이 여기서 나온다.
 */
export const SELECTORS = [
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
export const SEL_HELP = Object.fromEntries(SELECTORS.flatMap(([, items]) => items));
export const SEL_SET = new Set(Object.keys(SEL_HELP));

// yt-dlp 문서의 필터 필드. num/str 에 따라 쓸 수 있는 연산자가 다르다.
// 이것도 손으로 적는 층이다 — 빌더의 Filters 타입이 여기서 나온다.
export const FKEYS = [
  ['height','세로 해상도','num'], ['width','가로 해상도','num'], ['fps','프레임','num'],
  ['tbr','전체 비트레이트','num'], ['vbr','영상 비트레이트','num'], ['abr','음성 비트레이트','num'],
  ['asr','샘플레이트','num'], ['audio_channels','음성 채널 수','num'],
  ['filesize','파일 크기','num'], ['filesize_approx','대략 크기','num'], ['aspect_ratio','화면비','num'],
  ['ext','확장자','str'], ['vcodec','영상 코덱','str'], ['acodec','음성 코덱','str'],
  ['container','컨테이너','str'], ['protocol','프로토콜','str'], ['format_id','포맷 ID','str'],
  ['format_note','포맷 노트','str'], ['resolution','해상도','str'], ['language','언어','str'],
  ['dynamic_range','다이내믹 레인지','str'],
];
export const FKEY_TYPE = Object.fromEntries(FKEYS.map(([k, , t]) => [k, t]));

export const NUM_OPS = [['<','<'],['<=','≤'],['>','>'],['>=','≥'],['=','='],['!=','≠']];
export const STR_OPS = [['=','='],['!=','≠'],['^=','로 시작'],['$=','로 끝남'],['*=','포함'],['~=','정규식'],
                        ['!^=','로 시작 안 함'],['!$=','로 끝나지 않음'],['!*=','포함 안 함'],['!~=','정규식 불일치']];
export const EXIST_OPS = [['has','있음'],['hasnot','없음']];
export const OP_LABEL = Object.fromEntries([...NUM_OPS, ...STR_OPS, ...EXIST_OPS]);

export const isExistOp = op => op === 'has' || op === 'hasnot';

/** `height<=?1080` · `format_note` · `!format_note` 를 {key, op, loose, value} 로. */
export function parseFilterBody(body) {
  const b = body.trim();
  if (!b) throw new Error('빈 필터');
  const m = b.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(!?[\^$*~]?=|<=|>=|<|>)(\??)\s*(.*)$/);
  if (m) return { key: m[1], op: m[2], loose: m[3] === '?', value: m[4].trim() };
  if (/^![A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b.slice(1), op: 'hasnot', value: '' };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b, op: 'has', value: '' };
  throw new Error(`필터를 읽지 못했다: [${body}]`);
}

/** 포맷 셀렉터 문자열 → 트리. 못 읽으면 이유를 담아 던진다. */
export function parseFormat(src) {
  const s = (src || '').trim();
  if (!s) return null;
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => s[i];

  const expr = () => multi();
  function multi() {
    const kids = [fallback()]; ws();
    while (peek() === ',') { i++; kids.push(fallback()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'multi', kids };
  }
  function fallback() {
    const kids = [merge()]; ws();
    while (peek() === '/') { i++; kids.push(merge()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'fallback', kids };
  }
  function merge() {
    const kids = [atom()]; ws();
    while (peek() === '+') { i++; kids.push(atom()); ws(); }
    return kids.length === 1 ? kids[0] : { t: 'merge', kids };
  }
  /**
   * atom := (셀렉터 | '(' expr ')') 필터*
   *
   * 필터는 셀렉터에만 붙는 게 아니라 **그룹에도 붙는다** —
   * `(mp4,webm)[height<480]` 은 yt-dlp 문서에 나오는 표현이다. 그래서 필터를
   * 읽는 자리를 셀렉터 뒤가 아니라 atom 끝에 둔다. 무엇이 왔든 그 노드에 단다.
   */
  function atom() {
    ws();
    let node;
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
export function emitFilter(f) {
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
const effPrec = n => (n.t !== 'sel' && (n.filters || []).length) ? PREC.sel : PREC[n.t];

export function emitTree(n) {
  if (!n) return '';
  const filters = (n.filters || []).map(emitFilter).join('');
  if (n.t === 'sel') return n.name + filters;
  const body = n.kids.map(k => {
    const s = emitTree(k);
    return effPrec(k) < PREC[n.t] ? '(' + s + ')' : s;  // 우선순위가 낮으면 괄호로 묶는다
  }).join(OP_SEP[n.t]);
  return filters ? '(' + body + ')' + filters : body;
}
