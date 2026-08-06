/**
 * yt-dlp 출력 템플릿 문법.
 *
 * `-o` 는 포맷 셀렉터처럼 트리는 아니지만, 리터럴과 필드 참조가 번갈아 놓인
 * 하나의 수열이다.
 *
 *   [TYPES:]  %(NAME[>STRF][|DEFAULT])[FMT]CONV  또는 리터럴
 *
 * 파싱은 구조를 알아보는 데까지만 하고, 다시 뱉을 때는 읽은 그대로를 되돌린다.
 * 그래서 우리가 모르는 문법이 섞여 있어도 문자열이 상하지 않는다 — `|` 를 먼저,
 * 그다음 `>` 를 자르고 같은 순서로 붙이므로 무손실이다.
 *
 * **아무것도 import 하지 않는다.** 이유는 format-grammar.ts 와 같다 —
 * `gen_options.mjs` 가 빌드 전에 이 파일을 그대로 읽는다.
 */

export const OUT_TYPES: [type: string, label: string][] = [
  ['', '기본 (모든 파일)'],
  ['default', 'default — 기본'],
  ['chapter', 'chapter — 챕터별 분할 파일'],
  ['subtitle', 'subtitle — 자막'],
  ['thumbnail', 'thumbnail — 썸네일'],
  ['description', 'description — 설명'],
  ['infojson', 'infojson — 메타데이터 JSON'],
  ['link', 'link — 인터넷 바로가기'],
  ['pl_video', 'pl_video — 재생목록 항목'],
  ['pl_thumbnail', 'pl_thumbnail — 재생목록 썸네일'],
  ['pl_description', 'pl_description — 재생목록 설명'],
  ['pl_infojson', 'pl_infojson — 재생목록 JSON'],
];

export const FIELDS: [group: string, items: [field: string, label: string][]][] = [
  ['영상', [
    ['title', '제목'], ['fulltitle', '제목 (원본)'], ['id', '영상 ID'], ['ext', '확장자'],
    ['upload_date', '업로드 날짜 (YYYYMMDD)'], ['timestamp', '업로드 시각 (epoch)'],
    ['duration', '길이 (초)'], ['duration_string', '길이 (HH:MM:SS)'],
    ['view_count', '조회수'], ['like_count', '좋아요 수'], ['webpage_url', '페이지 URL'],
  ]],
  ['채널·사람', [
    ['uploader', '업로더'], ['uploader_id', '업로더 ID'],
    ['channel', '채널'], ['channel_id', '채널 ID'],
    ['artist', '아티스트'], ['album', '앨범'], ['track', '트랙'],
  ]],
  ['재생목록', [
    ['playlist', '재생목록'], ['playlist_title', '재생목록 제목'], ['playlist_id', '재생목록 ID'],
    ['playlist_index', '재생목록 번호'], ['playlist_count', '재생목록 개수'],
    ['n_entries', '항목 수'], ['autonumber', '자동 번호'],
  ]],
  ['포맷', [
    ['format', '포맷'], ['format_id', '포맷 ID'], ['format_note', '포맷 노트'],
    ['resolution', '해상도'], ['height', '세로'], ['width', '가로'], ['fps', '프레임'],
    ['vcodec', '영상 코덱'], ['acodec', '음성 코덱'], ['filesize', '파일 크기'],
  ]],
  ['구간', [
    ['chapter', '챕터'], ['chapter_number', '챕터 번호'],
    ['section_title', '구간 제목'], ['section_number', '구간 번호'],
    ['section_start', '구간 시작'], ['section_end', '구간 끝'],
  ]],
  ['기타', [
    ['extractor', '추출기'], ['extractor_key', '추출기 키'], ['epoch', '현재 시각 (epoch)'],
  ]],
];

export const CONVERSIONS: [conv: string, label: string][] = [
  ['s', 's — 문자열'], ['d', 'd — 정수'], ['f', 'f — 실수'],
  ['B', 'B — 바이트'], ['j', 'j — JSON'], ['l', 'l — 목록(쉼표)'],
  ['q', 'q — 셸 인용'], ['D', 'D — 1.05M 꼴'], ['S', 'S — 파일명 안전'],
  ['U', 'U — 유니코드 정규화'], ['h', 'h — HTML 이스케이프'],
];

const TYPE_SET = new Set(OUT_TYPES.map(([v]) => v).filter(Boolean));

export const FIELD_HELP: Record<string, string> =
  Object.fromEntries(FIELDS.flatMap(([, items]) => items));

/** 템플릿을 이루는 조각. 리터럴 아니면 필드 참조다. */
export type Piece =
  | { t: 'text'; text: string }
  | {
      t: 'field';
      name: string;
      /** `>` 뒤의 strftime 서식. */
      strf: string;
      /** `|` 뒤의 없을 때 값. 없으면 null. */
      fallback: string | null;
      /** 괄호와 변환 글자 사이의 플래그·폭·정밀도 (`03` · `.40`). */
      fmt: string;
      /** 맨 뒤 변환 글자 (`s` · `d` · `B` …). */
      conv: string;
    };

/** `[TYPES:]TEMPLATE` 에서 접두어를 떼어 낸다. 아는 종류일 때만 자른다. */
export function splitType(src: string): { type: string; template: string } {
  const s = src || '';
  const i = s.indexOf(':');
  if (i > 0) {
    const head = s.slice(0, i);
    if (TYPE_SET.has(head)) return { type: head, template: s.slice(i + 1) };
  }
  return { type: '', template: s };
}

type Body = { name: string; strf: string; fallback: string | null };

/** 괄호 안쪽을 셋으로. 자른 순서 그대로 되붙이면 원문이 된다. */
function splitBody(body: string): Body {
  const bar = body.indexOf('|');
  const head = bar < 0 ? body : body.slice(0, bar);
  const fallback = bar < 0 ? null : body.slice(bar + 1);
  const gt = head.indexOf('>');
  return {
    name: gt < 0 ? head : head.slice(0, gt),
    strf: gt < 0 ? '' : head.slice(gt + 1),
    fallback,
  };
}

const joinBody = ({ name, strf, fallback }: Body): string =>
  name + (strf ? '>' + strf : '') + (fallback != null ? '|' + fallback : '');

/** 템플릿 문자열 → 조각들. 못 읽으면 이유를 담아 던진다. */
export function parseTemplate(src: string): Piece[] {
  const s = src || '';
  const out: Piece[] = [];
  let text = '';
  const flush = (): void => { if (text) { out.push({ t: 'text', text }); text = ''; } };

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '%') { text += s[i]; continue; }
    if (s[i + 1] === '%') { text += '%'; i++; continue; }   // %% → 리터럴 %
    if (s[i + 1] !== '(') throw new Error(`'%' 뒤에 '(' 가 없다 (${i + 1}번째 글자)`);

    const close = s.indexOf(')', i + 2);
    if (close < 0) throw new Error("'%(' 의 괄호가 닫히지 않았다");
    const body = s.slice(i + 2, close);
    if (!body) throw new Error(`빈 필드 %() (${i + 1}번째 글자)`);

    // 괄호 뒤: 플래그·폭·정밀도 다음에 변환 글자 하나.
    let j = close + 1;
    while (j < s.length && /[#0\-+ .,\d]/.test(s[j])) j++;
    if (j >= s.length) throw new Error(`%(${body}) 뒤에 변환 글자가 없다`);

    flush();
    out.push({ t: 'field', fmt: s.slice(close + 1, j), conv: s[j], ...splitBody(body) });
    i = j;
  }
  flush();
  return out;
}

/** 조각 하나 → 템플릿 문자열. 리터럴의 `%` 는 `%%` 로 되돌린다. */
export const emitPiece = (piece: Piece): string =>
  piece.t === 'text'
    ? String(piece.text || '').replace(/%/g, '%%')
    : '%(' + joinBody(piece) + ')' + (piece.fmt || '') + (piece.conv || 's');

/** 사람이 읽을 미리보기. 값을 모르므로 필드는 자리표시자로 둔다. */
export function previewTemplate(pieces: Piece[]): string {
  return pieces.map(p => {
    if (p.t === 'text') return p.text;
    if (p.fallback != null && !p.name) return p.fallback;
    return '‹' + (FIELD_HELP[p.name] || p.name || '?') + '›';
  }).join('');
}
