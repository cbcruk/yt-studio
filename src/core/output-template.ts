/**
 * The yt-dlp output template grammar.
 *
 * `-o` is not a tree like the format selector, but a single sequence alternating
 * literals and field references.
 *
 *   [TYPES:]  %(NAME[>STRF][|DEFAULT])[FMT]CONV  or a literal
 *
 * Parsing goes only as far as recognizing the structure, and emitting gives back
 * exactly what was read. So grammar we do not know survives intact — `|` is split
 * first, then `>`, and they are rejoined in the same order, so it is lossless.
 */

/** File types that can prefix `-o` and `-P`, with a one-line description. `''` is the default. */
export const OUT_TYPES: [type: string, label: string][] = [
  ['', 'default (all files)'],
  ['chapter', 'chapter — per-chapter split files'],
  ['subtitle', 'subtitle — subtitles'],
  ['thumbnail', 'thumbnail — thumbnails'],
  ['description', 'description — description'],
  ['annotation', 'annotation — annotations (yt-dlp accepts it, but YouTube removed the feature)'],
  ['infojson', 'infojson — metadata JSON'],
  ['link', 'link — internet shortcut'],
  ['pl_video', 'pl_video — playlist entry'],
  ['pl_thumbnail', 'pl_thumbnail — playlist thumbnail'],
  ['pl_description', 'pl_description — playlist description'],
  ['pl_infojson', 'pl_infojson — playlist JSON'],
];

/**
 * Output template fields, grouped.
 *
 * Each item carries two texts. `label` is the English description shown in
 * autocomplete. `preview` is the Korean placeholder the filename preview prints
 * (`‹제목›`) — that is runtime output, which is in Korean like the lint messages.
 */
export const FIELDS: [group: string, items: [field: string, label: string, preview: string][]][] = [
  ['Video', [
    ['title', 'title', '제목'], ['fulltitle', 'title (original)', '제목 (원본)'],
    ['id', 'video id', '영상 ID'], ['ext', 'file extension', '확장자'],
    ['upload_date', 'upload date (YYYYMMDD)', '업로드 날짜 (YYYYMMDD)'],
    ['timestamp', 'upload time (epoch)', '업로드 시각 (epoch)'],
    ['duration', 'length (seconds)', '길이 (초)'], ['duration_string', 'length (HH:MM:SS)', '길이 (HH:MM:SS)'],
    ['view_count', 'view count', '조회수'], ['like_count', 'like count', '좋아요 수'],
    ['webpage_url', 'page URL', '페이지 URL'],
    ['is_live', 'whether it is live now', '지금 생중계인가'], ['was_live', 'whether it was a live stream', '생중계였던 것인가'],
    ['live_status', 'live status (is_live · was_live · upcoming …)', '생중계 상태 (is_live · was_live · upcoming …)'],
    ['availability', 'visibility (public · unlisted · subscriber_only …)', '공개 범위 (public · unlisted · subscriber_only …)'],
    ['age_limit', 'age limit', '연령 제한'], ['license', 'license', '라이선스'],
  ]],
  ['Channel · people', [
    ['uploader', 'uploader', '업로더'], ['uploader_id', 'uploader id', '업로더 ID'],
    ['channel', 'channel', '채널'], ['channel_id', 'channel id', '채널 ID'],
    ['artist', 'artist', '아티스트'], ['album', 'album', '앨범'], ['track', 'track', '트랙'],
  ]],
  ['Playlist', [
    ['playlist', 'playlist', '재생목록'], ['playlist_title', 'playlist title', '재생목록 제목'],
    ['playlist_id', 'playlist id', '재생목록 ID'],
    ['playlist_index', 'playlist index', '재생목록 번호'], ['playlist_count', 'playlist size', '재생목록 개수'],
    ['n_entries', 'number of entries', '항목 수'], ['autonumber', 'auto number', '자동 번호'],
  ]],
  ['Format', [
    ['format', 'format', '포맷'], ['format_id', 'format id', '포맷 ID'], ['format_note', 'format note', '포맷 노트'],
    ['resolution', 'resolution', '해상도'], ['height', 'height', '세로'], ['width', 'width', '가로'],
    ['fps', 'frame rate', '프레임'],
    ['vcodec', 'video codec', '영상 코덱'], ['acodec', 'audio codec', '음성 코덱'], ['filesize', 'file size', '파일 크기'],
  ]],
  ['Section', [
    ['chapter', 'chapter', '챕터'], ['chapter_number', 'chapter number', '챕터 번호'],
    ['section_title', 'section title', '구간 제목'], ['section_number', 'section number', '구간 번호'],
    ['section_start', 'section start', '구간 시작'], ['section_end', 'section end', '구간 끝'],
  ]],
  ['Other', [
    ['extractor', 'extractor', '추출기'], ['extractor_key', 'extractor key', '추출기 키'],
    ['epoch', 'current time (epoch)', '현재 시각 (epoch)'],
  ]],
];

/** Conversion characters at the end of a field, with a one-line description. */
export const CONVERSIONS: [conv: string, label: string][] = [
  ['s', 's — string'], ['d', 'd — integer'], ['f', 'f — float'],
  ['B', 'B — bytes'], ['j', 'j — JSON'], ['l', 'l — list (comma-separated)'],
  ['q', 'q — shell-quoted'], ['D', 'D — like 1.05M'], ['S', 'S — filename-safe'],
  ['U', 'U — Unicode-normalized'], ['h', 'h — HTML-escaped'],
];

const TYPE_SET = new Set(OUT_TYPES.map(([v]) => v).filter(Boolean));

/** Field → English description, for autocomplete. */
export const FIELD_HELP: Record<string, string> =
  Object.fromEntries(FIELDS.flatMap(([, items]) => items.map(([f, label]) => [f, label])));

/** Field → Korean placeholder, for the filename preview. */
export const FIELD_PREVIEW: Record<string, string> =
  Object.fromEntries(FIELDS.flatMap(([, items]) => items.map(([f, , preview]) => [f, preview])));

/** A piece of a template: either a literal or a field reference. */
export type Piece =
  | { t: 'text'; text: string }
  | {
      t: 'field';
      name: string;
      /** The strftime format after `>`. */
      strf: string;
      /** The fallback value after `|`. null when absent. */
      fallback: string | null;
      /** Flags, width and precision between the parenthesis and the conversion (`03`, `.40`). */
      fmt: string;
      /** The trailing conversion character (`s`, `d`, `B`, …). */
      conv: string;
    };

/** Splits the prefix off `[TYPES:]TEMPLATE`. Only splits for known types. */
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

/** Splits the inside of the parentheses in three. Rejoining in the same order gives back the original. */
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

/** Template string → pieces. Throws with the reason when it cannot be read. */
export function parseTemplate(src: string): Piece[] {
  const s = src || '';
  const out: Piece[] = [];
  let text = '';
  const flush = (): void => { if (text) { out.push({ t: 'text', text }); text = ''; } };

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '%') { text += s[i]; continue; }
    if (s[i + 1] === '%') { text += '%'; i++; continue; }   // %% → literal %
    if (s[i + 1] !== '(') throw new Error(`'%' 뒤에 '(' 가 없다 (${i + 1}번째 글자)`);

    const close = s.indexOf(')', i + 2);
    if (close < 0) throw new Error("'%(' 의 괄호가 닫히지 않았다");
    const body = s.slice(i + 2, close);
    if (!body) throw new Error(`빈 필드 %() (${i + 1}번째 글자)`);

    // After the parenthesis: flags, width, precision, then one conversion character.
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

/** One piece → template string. `%` in literals goes back to `%%`. */
export const emitPiece = (piece: Piece): string =>
  piece.t === 'text'
    ? String(piece.text || '').replace(/%/g, '%%')
    : '%(' + joinBody(piece) + ')' + (piece.fmt || '') + (piece.conv || 's');

/** A human-readable preview. Values are unknown, so fields become placeholders. */
export function previewTemplate(pieces: Piece[]): string {
  return pieces.map(p => {
    if (p.t === 'text') return p.text;
    if (p.fallback != null && !p.name) return p.fallback;
    return '‹' + (FIELD_PREVIEW[p.name] || p.name || '?') + '›';
  }).join('');
}
