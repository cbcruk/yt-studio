/**
 * yt-dlp 옵션 스키마 파생.
 *
 * gen_schema.py 가 떨군 raw JSON 하나에서 색인들을 만든다.
 * initSchema 를 부르기 전에는 어떤 바인딩도 유효하지 않다.
 */

export let STAGES = [];
export let OPTS = [];
export let BY_ID = {};
export let STAGE_ORDER = [];
export let STAGE = {};
export let BY_STAGE = {};
export let BY_FLAG = {};       // 플래그 문자열 → { opt, negated }
export let HAY = {};           // 검색 색인
export let VERSION = '';

/**
 * 한국어 의도 → yt-dlp 어휘.
 *
 * introspection 이 절대 못 주는 층이라 손으로 채운다. 이 도구의 실제
 * 부가가치가 여기 있다. 쓰다가 안 걸리는 말이 나오면 계속 추가할 것.
 */
export const KO = {
  '자막':'sub subtitle srt','자동자막':'auto-sub automatic','번역':'sub translate',
  '썸네일':'thumbnail','표지':'thumbnail cover','화질':'format quality resolution height',
  '해상도':'height width resolution format','포맷':'format container','코덱':'vcodec acodec format-sort',
  '음원':'audio extract-audio','오디오':'audio','소리':'audio','음성':'audio',
  '영상만':'video-only format','재생목록':'playlist','플레이리스트':'playlist',
  '채널':'playlist flat-playlist','구간':'download-sections chapter split',
  '자르기':'download-sections split-chapters','챕터':'chapter',
  '광고':'sponsorblock','스폰서':'sponsorblock','건너뛰':'sponsorblock skip',
  '쿠키':'cookies browser','로그인':'username password cookies netrc','인증':'auth username password',
  '프록시':'proxy socket source-address','우회':'proxy geo impersonate',
  '차단':'geo proxy impersonate','지역':'geo xff','아이피':'source-address proxy',
  '속도':'rate-limit throttled concurrent','제한':'limit rate','동시':'concurrent fragments',
  '재시도':'retries retry','이어받기':'continue part','중단':'abort break',
  '중복':'download-archive no-overwrites','기록':'archive','아카이브':'archive',
  '파일명':'output paths restrict-filenames windows-filenames','경로':'paths output home',
  '이름':'output filename','폴더':'paths output batch',
  '병합':'merge-output-format remux recode','변환':'recode remux audio-format',
  '메타데이터':'metadata embed-metadata parse-metadata','태그':'metadata',
  '자바스크립트':'extractor-args player','확장':'extractor-args plugin',
  '로그':'verbose print quiet progress dump','조용':'quiet no-warnings',
  '미리보기':'simulate print list-formats dump-json','목록':'list-formats list-subs print',
  '테스트':'simulate skip-download','받지않':'skip-download simulate',
  '느림':'concurrent rate-limit downloader','에러':'ignore-errors abort verbose retries',
  '403':'impersonate extractor-args cookies user-agent','429':'sleep-requests rate-limit retries',
  '기다':'sleep wait-for-video','라이브':'live-from-start wait-for-video',
};

/** 검색어 하나를 KO 사전으로 넓힌다. */
export function expand(t) {
  const out = [t];
  for (const k in KO) if (k.includes(t) || t.includes(k)) out.push(...KO[k].split(' '));
  return out;
}

/** 공백으로 나눈 모든 항이 각각 (넓혀서) 걸려야 통과. 빈 질의는 null. */
export function search(q, pool) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return null;
  const terms = s.split(/\s+/).map(expand);
  return (pool || OPTS).filter(o => terms.every(g => g.some(t => HAY[o.id].includes(t))));
}

export function initSchema(raw) {
  VERSION = raw.ytdlp_version;
  STAGES = raw.stages;
  OPTS = raw.options;
  BY_ID = Object.fromEntries(OPTS.map(o => [o.id, o]));
  STAGE_ORDER = STAGES.map(s => s.id);
  STAGE = Object.fromEntries(STAGES.map(s => [s.id, s]));
  BY_STAGE = Object.fromEntries(STAGE_ORDER.map(s => [s, OPTS.filter(o => o.stage === s)]));

  // 별칭·단축·부정형까지 전부 색인해 둔다 — 검증기가 문자열을 되읽을 때 쓴다.
  BY_FLAG = {};
  for (const o of OPTS) {
    BY_FLAG[o.flag] = { opt: o, negated: false };
    if (o.short) BY_FLAG[o.short] = { opt: o, negated: false };
    for (const a of o.aliases) BY_FLAG[a] = { opt: o, negated: false };
    if (o.negation) BY_FLAG[o.negation] = { opt: o, negated: true };
  }

  HAY = Object.fromEntries(OPTS.map(o =>
    [o.id, (o.flag + ' ' + (o.short || '') + ' ' + o.aliases.join(' ') + ' ' + o.help).toLowerCase()]));

  return { STAGES, OPTS, STAGE_ORDER };
}

export const stageIdx = id => STAGE_ORDER.indexOf(id);
