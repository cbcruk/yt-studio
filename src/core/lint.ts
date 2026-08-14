/**
 * 명령어 진단.
 *
 * 이 도구의 중심이다. LLM 은 yt-dlp 명령어를 그럴듯하게 쓰지만 **틀린 줄을
 * 모른다** — 학습 시점에 있던 플래그를 쓰고, `-f` · `-o` 값을 문법이 아니라
 * 기억으로 만든다. 여기서는 기억이 아니라 실물을 본다.
 *
 *   · 플래그가 이 yt-dlp 버전에 있는가          리플렉션한 스키마
 *   · 값이 필요한 자리에 값이 있는가             opt.kind
 *   · 고를 수 있는 값 중 하나인가                opt.choices
 *   · -f · -o 가 문법에 맞는가                   진짜 파서를 돌린다
 *   · -P 에 같은 종류가 두 번 오지 않는가
 *   · 서로 어긋나는 옵션을 같이 주지 않았는가
 *
 * DOM 도 앱 상태도 모른다. 문자열 하나가 들어가고 진단 목록이 나온다.
 */

import { scanCommand } from './command.js';
import { parseFormat } from './format-grammar.js';
import { parseTemplate, splitType } from './output-template.js';
import { splitEntry } from './paths.js';
import { parseCookieSource } from './cookies.js';
import type { Opt, Schema } from './schema.js';
import type { Item } from './command.js';
import type { Piece } from './output-template.js';

/** error 는 그대로 돌리면 안 되는 것, warn 은 의도와 다를 수 있는 것, info 는 참고. */
export const LEVELS = ['error', 'warn', 'info'] as const;
export type Level = (typeof LEVELS)[number];
const rank = (l: Level): number => LEVELS.indexOf(l);

/** 검증기가 잡은 것 하나. `fixes` 는 없는 플래그일 때 가까운 후보 셋. */
export interface Issue {
  level: Level;
  msg: string;
  flag?: string;
  opt?: string;
  fixes?: string[];
}

/** 옵션 id → 읽어 낸 값. 플래그는 boolean, repeatable 은 배열이다. */
export type Values = Record<string, string | boolean | (string | null)[] | null>;

export interface LintResult {
  items: Item[];
  urls: string[];
  values: Values;
  issues: Issue[];
  /** 오류가 하나도 없으면 참. 경고는 여기 안 센다. */
  ok: boolean;
  counts: { error: number; warn: number; info: number; opts: number; total: number };
}

/** 편집거리. 후보가 200개 남짓이라 단순 DP 로 충분하다. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * 모르는 플래그와 가까운 것들.
 *
 * 거리로만 고르면 `--foo` 에 엉뚱한 세 글자짜리가 붙는다. 길이에 비례한
 * 문턱을 두고, 그래도 없으면 부분 문자열로 한 번 더 본다.
 */
export function nearestFlags(schema: Schema, flag: string, limit = 3): string[] {
  const q = String(flag || '').replace(/^-+/, '').toLowerCase();
  if (!q) return [];
  // 앞이 같으면 가깝게 본다. 거리만 보면 --embed-subtitle 에 엉뚱한 짧은
  // 플래그가 붙는다 — 사람이 틀리는 자리는 대개 뒤쪽이다.
  const scored = Object.keys(schema.byFlag).filter(f => f.startsWith('--')).map(f => {
    const name = f.replace(/^-+/, '').toLowerCase();
    let p = 0;
    while (p < q.length && p < name.length && q[p] === name[p]) p++;
    const d = distance(q, name);
    return { f, d, score: d - Math.min(p, 8) * 0.5 };
  });
  const limitD = Math.max(3, Math.ceil(q.length / 2));
  const near = scored.filter(x => x.d <= limitD);
  const pool = near.length ? near
    : scored.filter(x => x.f.includes(q) || q.includes(x.f.replace(/^-+/, '')));
  return pool.sort((a, b) => a.score - b.score || a.f.length - b.f.length)
    .slice(0, limit).map(x => x.f);
}

/**
 * `--fixup never` 처럼 고를 수 있는 값이 정해진 옵션.
 *
 * 목록은 yt-dlp 를 리플렉션한 것이라 닫혀 있다 — 없는 값을 주면 yt-dlp 도
 * 거절한다. 다만 **거절하지 말아야 할 두 가지**가 있다.
 *
 *   · 쉼표로 여러 개 (`--sponsorblock-remove sponsor,intro`)
 *   · 앞에 `-` 를 붙여 빼기 (`--compat-options all,-multistreams`)
 *
 * 둘 다 `_set_from_options_callback` 이 진짜로 받는 형태다. 안 봐주면 멀쩡한
 * 명령어가 오류로 잡히는데, 이 도구에서 그건 못 잡는 것보다 나쁘다.
 */
function checkChoice(opt: Opt, value: string | null): string | null {
  const { choices } = opt;
  if (!choices || value == null) return null;
  const many = opt.kind === 'repeatable';
  const parts = String(value).split(',').map(s => s.trim()).filter(Boolean);
  const bad = parts.filter(p => !choices.includes(many ? p.replace(/^-/, '') : p));
  if (!bad.length) return null;
  const shown = choices.length > 12 ? `${choices.slice(0, 12).join(' · ')} … ${choices.length}개` : choices.join(' · ');
  return `${bad.join(', ')} 는 고를 수 있는 값이 아니다 (${shown})`;
}

/**
 * `--recode-video "aac>mp3/mkv"` 처럼 어휘 위의 문법인 값.
 *
 * yt-dlp 의 `FFmpeg*PP.FORMAT_RE` 와 같은 것을 본다 — `/` 로 이은 선호 순서에
 * 각 칸이 `[원본>]대상` 이고, **대상만** 어휘에 있어야 한다. 원본은 "이
 * 확장자일 때만"이라 아무 확장자나 온다.
 *
 * 타입은 이 문법을 못 막는다(막으면 멀쩡한 값이 오류가 된다). 그래서 닫는
 * 일은 여기서 한다.
 */
function checkRule(opt: Opt, value: string | null): string | null {
  const { rule } = opt;
  if (!rule || value == null || value === '') return null;

  const bad: string[] = [];
  for (const part of String(value).split('/')) {
    const s = part.trim();
    if (!s) { bad.push('(빈 칸)'); continue; }
    const i = rule.from ? s.indexOf('>') : -1;
    const to = (i >= 0 ? s.slice(i + 1) : s).trim();
    if (!rule.vocab.includes(to)) bad.push(to || s);
  }
  if (!bad.length) return null;

  const how = rule.from ? '[원본>]대상 을 / 로 이어 준다' : '/ 로 이어 준다';
  return `${bad.join(', ')} 는 ${opt.flag} 가 만들 수 있는 것이 아니다 (${rule.vocab.join(' · ')}) — ${how}`;
}

/**
 * `-o thumbnail:%(id)s` 처럼 값 앞에 붙는 종류.
 *
 * 모르는 종류를 줘도 yt-dlp 는 **거절하지 않는다** — 종류가 아닌 것으로 보고
 * 값 전체를 기본 자리에 넣는다. 그래서 `-o nope:%(id)s.%(ext)s` 는 오류 없이
 * `nope:` 로 시작하는 파일을 만든다. 조용히 어긋나는 쪽이라 여기서 말해 준다.
 *
 * 경고다 — 값에 그냥 콜론이 든 것일 수도 있어서다(`--exec "sed s/a:b/c/ …"`).
 * 그래서 **종류처럼 생겼을 때만** 본다: 콜론 앞이 낱말 하나일 때.
 */
function checkKeys(opt: Opt, value: string | null): string | null {
  if (!opt.keys?.length || !value) return null;
  const head = /^(\w+):/.exec(value)?.[1];
  if (!head || opt.keys.includes(head)) return null;
  return `${head}: 는 ${opt.flag} 가 아는 종류가 아니다 (${opt.keys.join(' · ')})`
    + ` — yt-dlp 는 이걸 종류로 안 읽고 값에 그대로 남긴다`;
}

/**
 * `--cookies-from-browser` 를 진짜 파서에 넣어 본다.
 *
 * 브라우저 이름 하나만 보는 게 아니다 — `firefox::Personal` 처럼 자리가 넷인
 * 구조라, 모양이 틀린 것과 어휘가 틀린 것을 갈라서 말해야 한다.
 */
function checkCookies(opt: Opt, value: string | null): string | null {
  if (!opt.vocabs || value == null || value === '') return null;
  try { parseCookieSource(value, opt.vocabs); return null; }
  catch (e) { return `${opt.flag} — ${(e as Error).message}`; }
}

/** `-f` 를 진짜 파서에 넣어 본다. 못 읽으면 파서가 한 말을 그대로 돌려준다. */
function checkFormat(value: string): string | null {
  try { parseFormat(value); return null; }
  catch (e) { return (e as Error).message; }
}

function checkOutput(value: string): { error?: string; pieces?: Piece[]; hasExt?: boolean } {
  const { template } = splitType(value);
  let pieces;
  try { pieces = parseTemplate(template); }
  catch (e) { return { error: (e as Error).message }; }
  const hasExt = pieces.some(p => p.t === 'field' && (p.name === 'ext' || /(^|\.)ext$/.test(p.name)));
  return { pieces, hasExt };
}

function checkPaths(values: string[]): string[] {
  const seen = new Map<string, string>(), out: string[] = [];
  for (const line of values) {
    const { type, path } = splitEntry(line);
    const key = type || 'home';
    if (seen.has(key)) out.push(`-P 에 ${key} 가 두 번 있다 — 뒤엣것만 쓰인다`);
    seen.set(key, path);
    if (!path) out.push(`-P ${key} 의 경로가 비어 있다`);
  }
  return out;
}

/**
 * 문법은 맞지만 의도와 어긋나는 조합. 확실한 것만 둔다 —
 * 애매한 규칙을 늘리면 경고가 흔해지고, 흔한 경고는 안 읽힌다.
 */
function crossChecks(has: (id: string) => boolean, val: (id: string) => string | null): Issue[] {
  const out: Issue[] = [];
  const f = val('format');

  if (has('extract-audio') && f && /(^|[^a-z*])(bv|wv)\b|bestvideo|worstvideo/.test(f) && !/\bba\b|bestaudio/.test(f)) {
    out.push({ level: 'warn', opt: 'extract-audio',
      msg: `-x 로 음원만 뽑는데 -f 가 영상 전용이다 ("${f}") — 음성이 없는 포맷을 받아 변환이 실패할 수 있다` });
  }
  if ((has('simulate') || has('skip-download')) && (has('output') || has('paths'))) {
    out.push({ level: 'warn', opt: 'simulate',
      msg: '받지 않는 모드인데 저장 위치를 정했다 — 파일이 나오지 않는다' });
  }
  if (has('embed-subs') && !has('write-subs') && !has('write-auto-subs')) {
    out.push({ level: 'warn', opt: 'embed-subs',
      msg: '--embed-subs 만으로는 자막을 받지 않는다 — --write-subs 또는 --write-auto-subs 가 같이 있어야 한다' });
  }
  if (f && /\+/.test(f) && !has('merge-output-format')) {
    out.push({ level: 'info', opt: 'format',
      msg: '-f 가 영상과 음성을 합친다 — 컨테이너를 정하려면 --merge-output-format 을 준다' });
  }
  if (has('audio-format') && !has('extract-audio')) {
    out.push({ level: 'warn', opt: 'audio-format',
      msg: '--audio-format 은 -x (--extract-audio) 와 같이 있을 때만 쓰인다' });
  }
  if (has('sponsorblock-remove') && has('sponsorblock-mark')) {
    out.push({ level: 'info', opt: 'sponsorblock-remove',
      msg: '지우기와 표시하기를 같이 준다 — 같은 구간에 둘 다 걸리면 지우기가 이긴다' });
  }
  return out;
}

/**
 * 명령어 문자열 → { items, urls, values, issues, ok }.
 *
 * issues: { level, msg, flag?, opt?, fixes? } — 심각한 것부터.
 */
export function lintCommand(schema: Schema, text: string): LintResult {
  const { items } = scanCommand(schema, text);
  const issues: Issue[] = [];
  const urls = items.filter(i => i.kind === 'url').map(i => i.raw);
  const values: Values = {};               // optId → 값 (repeatable 은 배열)
  const count: Record<string, number> = {};

  for (const it of items) {
    if (it.kind === 'unknown') {
      if (it.why === 'no-flag') {
        const fixes = nearestFlags(schema, it.flag);
        issues.push({ level: 'error', flag: it.flag, fixes,
          msg: `${it.flag} 는 이 yt-dlp 버전에 없는 플래그다`
            + (fixes.length ? ` — ${fixes.join(' · ')} 를 찾은 것 아닐까` : '') });
      } else if (it.why === 'no-value') {
        const o: Opt = schema.byFlag[it.flag]!.opt;
        issues.push({ level: 'error', flag: it.flag, opt: o.id,
          msg: `${it.flag} 는 값이 필요하다 (${o.metavar || 'VALUE'})` });
      } else {
        issues.push({ level: 'error', flag: it.flag,
          msg: `${it.flag} 는 값을 받지 않는 플래그인데 값을 줬다` });
      }
      continue;
    }
    if (it.kind !== 'opt') continue;

    const { opt, value, negated } = it;
    count[opt.id] = (count[opt.id] || 0) + 1;
    if (opt.kind === 'repeatable') ((values[opt.id] ||= []) as (string | null)[]).push(value);
    else if (opt.kind === 'flag') values[opt.id] = !negated;
    else values[opt.id] = value;

    if (opt.kind !== 'flag' && value === '') {
      issues.push({ level: 'warn', flag: it.flag, opt: opt.id,
        msg: `${it.flag} 의 값이 비어 있다 (${opt.metavar || 'VALUE'}) — 채우거나 빼야 한다` });
    }
    const bad = checkChoice(opt, value) ?? checkRule(opt, value) ?? checkCookies(opt, value);
    if (bad) issues.push({ level: 'error', flag: it.flag, opt: opt.id, msg: bad });

    const odd = checkKeys(opt, value);
    if (odd) issues.push({ level: 'warn', flag: it.flag, opt: opt.id, msg: odd });
  }

  for (const id in count) {
    const o = schema.byId[id];
    if (count[id] > 1 && o.kind !== 'repeatable') {
      issues.push({ level: 'warn', opt: id,
        msg: `${o.flag} 를 ${count[id]}번 줬다 — 마지막 것만 쓰인다` });
    }
  }

  const has = (id: string): boolean => id in values && values[id] !== false;
  const val = (id: string): string | null => (typeof values[id] === 'string' ? values[id] : null);

  if (has('format')) {
    const err = checkFormat(values.format as string);
    if (err) issues.push({ level: 'error', opt: 'format', msg: `-f 값을 읽지 못했다 — ${err}` });
  }
  if (has('output')) {
    const first = (Array.isArray(values.output) ? values.output[0] : values.output) as string;
    const r = checkOutput(first);
    if (r.error) issues.push({ level: 'error', opt: 'output', msg: `-o 값을 읽지 못했다 — ${r.error}` });
    else if (!r.hasExt) {
      issues.push({ level: 'warn', opt: 'output',
        msg: '-o 에 %(ext)s 가 없다 — 확장자 없는 파일이 만들어진다' });
    }
  }
  if (has('paths')) {
    for (const m of checkPaths(([] as string[]).concat(values.paths as string | string[])))
      issues.push({ level: 'warn', opt: 'paths', msg: m });
  }
  if (!urls.length && !has('batch-file') && !has('load-info-json')
      && !has('update') && !has('version') && !has('list-extractors')) {
    issues.push({ level: 'error', msg: 'URL 이 없다 — 무엇을 받을지 정해지지 않았다' });
  }

  issues.push(...crossChecks(has, val));
  issues.sort((a, b) => rank(a.level) - rank(b.level));

  return {
    items, urls, values, issues,
    ok: !issues.some(i => i.level === 'error'),
    counts: {
      error: issues.filter(i => i.level === 'error').length,
      warn: issues.filter(i => i.level === 'warn').length,
      info: issues.filter(i => i.level === 'info').length,
      opts: Object.keys(count).length,
      total: schema.opts.length,
    },
  };
}
