/**
 * 옵션 191개를 사람이 훑을 수 있게 만드는 층.
 *
 * 평평한 191개는 아무도 못 읽는다. 단계(9개)로 나눠도 "접속 36개" 같은
 * 덩어리가 남는다. 그래서 축을 하나 더 둔다 — **의도**다.
 *
 *   의도 (16)  →  핵심 (3~7)  →  관련 전체 (검색)  →  단계별 전체 (191)
 *
 * 의도는 손으로 정한다. schema.json 에는 "사람이 무엇을 원하는가"가 없고,
 * 리플렉션으로는 절대 안 나온다. schema.js 의 KO 사전과 같은 층이며,
 * 이 도구의 부가가치도 같은 자리에 있다.
 *
 * ids 는 그 의도의 **핵심**이지 전부가 아니다. 나머지는 q 로 넓힌다 —
 * KO 사전이 이미 "자막 → sub subtitle srt" 를 알고 있으므로 검색이 곧 확장이다.
 */
import { BY_ID, OPTS, search } from './schema.js';

export const INTENTS = [
  { key: 'quality', label: '화질·해상도', q: '화질',
    ids: ['format', 'format-sort', 'merge-output-format', 'list-formats', 'check-formats'] },
  { key: 'subs', label: '자막', q: '자막',
    ids: ['write-subs', 'write-auto-subs', 'sub-langs', 'embed-subs', 'sub-format', 'convert-subs', 'list-subs'] },
  { key: 'audio', label: '음원만 뽑기', q: '음원',
    ids: ['extract-audio', 'audio-format', 'audio-quality', 'embed-thumbnail', 'embed-metadata'] },
  { key: 'thumb', label: '썸네일·표지', q: '썸네일',
    ids: ['write-thumbnail', 'embed-thumbnail', 'convert-thumbnails', 'write-all-thumbnails'] },
  { key: 'name', label: '파일명·저장 위치', q: '파일명',
    ids: ['output', 'paths', 'restrict-filenames', 'windows-filenames', 'trim-filenames', 'output-na-placeholder'] },
  { key: 'playlist', label: '재생목록·채널', q: '재생목록',
    ids: ['no-playlist', 'playlist-items', 'flat-playlist', 'lazy-playlist', 'playlist-random', 'max-downloads'] },
  { key: 'section', label: '구간·챕터 자르기', q: '구간',
    ids: ['download-sections', 'split-chapters', 'embed-chapters', 'remove-chapters', 'force-keyframes-at-cuts'] },
  { key: 'sponsor', label: '광고 건너뛰기', q: '광고',
    ids: ['sponsorblock-remove', 'sponsorblock-mark', 'sponsorblock-chapter-title', 'no-sponsorblock'] },
  { key: 'auth', label: '로그인·쿠키', q: '로그인',
    ids: ['cookies-from-browser', 'cookies', 'username', 'password', 'netrc', 'twofactor', 'video-password'] },
  { key: 'bypass', label: '차단 우회', q: '우회',
    ids: ['impersonate', 'proxy', 'geo-verification-proxy', 'xff', 'source-address', 'add-headers'] },
  { key: 'speed', label: '속도·재시도', q: '속도',
    ids: ['limit-rate', 'concurrent-fragments', 'retries', 'fragment-retries', 'retry-sleep', 'sleep-requests', 'throttled-rate'] },
  { key: 'resume', label: '이어받기·중복 방지', q: '이어받기',
    ids: ['continue', 'part', 'no-overwrites', 'force-overwrites', 'download-archive', 'break-on-existing'] },
  { key: 'meta', label: '메타데이터', q: '메타데이터',
    ids: ['embed-metadata', 'parse-metadata', 'replace-in-metadata', 'write-info-json', 'embed-info-json', 'xattrs'] },
  { key: 'convert', label: '변환·병합', q: '변환',
    ids: ['recode-video', 'remux-video', 'merge-output-format', 'audio-format', 'keep-video'] },
  { key: 'filter', label: '조건으로 거르기', q: '목록',
    ids: ['match-filters', 'break-match-filters', 'dateafter', 'datebefore', 'date', 'min-filesize', 'max-filesize', 'age-limit'] },
  { key: 'dryrun', label: '미리보기·점검', q: '미리보기',
    ids: ['simulate', 'skip-download', 'print', 'dump-json', 'list-formats', 'verbose', 'quiet'] },
];

export const INTENT = Object.fromEntries(INTENTS.map(i => [i.key, i]));

/** 의도의 핵심 옵션들. 스키마에 없는 id 는 조용히 빠진다 (yt-dlp 가 옵션을 지울 수 있다). */
export const intentCore = key =>
  ((INTENT[key] && INTENT[key].ids) || []).map(id => BY_ID[id]).filter(Boolean);

/** 핵심 말고 나머지 — KO 사전을 태운 검색으로 넓힌다. */
export function intentMore(key) {
  const it = INTENT[key];
  if (!it) return [];
  const core = new Set(it.ids);
  return (search(it.q) || []).filter(o => !core.has(o.id));
}

/** 어느 의도에도 안 걸리는 옵션들. "핵심만 골라 뒀다"가 거짓이 아닌지 보는 눈. */
export function uncovered() {
  const seen = new Set(INTENTS.flatMap(i => i.ids));
  return OPTS.filter(o => !seen.has(o.id));
}

/* ── LLM 에게 줄 카탈로그 ─────────────────── */

/**
 * 옵션 한 줄 = `--flag <METAVAR>  도움말`.
 *
 * 191개를 전부 넣어도 help 를 자르면 6천 토큰 남짓이라 검색·RAG 가 필요 없다.
 * 고르지 않고 통째로 주는 편이 정확하다 — 무엇을 빼야 할지는 우리가 모른다.
 */
export function catalogLine(o, helpMax = 110) {
  const name = o.short ? `${o.flag}, ${o.short}` : o.flag;
  const arg = o.kind === 'flag' ? '' : ' ' + (o.metavar || 'VALUE');
  const help = (o.help || '').replace(/\s+/g, ' ').trim();
  const cut = help.length > helpMax ? help.slice(0, helpMax - 1) + '…' : help;
  const tail = [];
  if (o.choices) tail.push(`choices: ${o.choices.join('|')}`);
  if (o.kind === 'repeatable') tail.push('반복 가능');
  if (o.negation) tail.push(o.negation);
  return `${name}${arg}  ${cut}${tail.length ? `  [${tail.join(' · ')}]` : ''}`;
}

/** 단계별로 묶은 카탈로그 전문. */
export function catalogText(stages, byStage, helpMax = 110) {
  return stages.map(s => {
    const lines = (byStage[s.id] || []).map(o => catalogLine(o, helpMax));
    return `## ${s.id} — ${s.label} (${s.blurb})\n${lines.join('\n')}`;
  }).join('\n\n');
}
