/**
 * 명령어 진단.
 *
 * 이 도구의 중심이다. LLM 은 yt-dlp 명령어를 그럴듯하게 쓰지만 **틀린 줄을
 * 모른다** — 학습 시점에 있던 플래그를 쓰고, `-f` · `-o` 값을 문법이 아니라
 * 기억으로 만든다. 여기서는 기억이 아니라 실물을 본다.
 *
 *   · 플래그가 이 yt-dlp 버전에 있는가          schema.json (리플렉션)
 *   · 값이 필요한 자리에 값이 있는가             opt.kind
 *   · 고를 수 있는 값 중 하나인가                opt.choices
 *   · -f · -o 가 문법에 맞는가                   진짜 파서를 돌린다
 *   · -P 에 같은 종류가 두 번 오지 않는가
 *   · 서로 어긋나는 옵션을 같이 주지 않았는가
 *
 * DOM 도 앱 상태도 모른다. 문자열 하나가 들어가고 진단 목록이 나온다.
 */
import { BY_FLAG, BY_ID, OPTS } from './schema.js';
import { scanCommand } from './command.js';
import { parseFormat } from './format-grammar.js';
import { parseTemplate, splitType } from './output-template.js';
import { splitEntry } from './paths.js';
import type { Opt } from './schema.js';
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
export function nearestFlags(flag: string, limit = 3): string[] {
  const q = String(flag || '').replace(/^-+/, '').toLowerCase();
  if (!q) return [];
  // 앞이 같으면 가깝게 본다. 거리만 보면 --embed-subtitle 에 엉뚱한 짧은
  // 플래그가 붙는다 — 사람이 틀리는 자리는 대개 뒤쪽이다.
  const scored = Object.keys(BY_FLAG).filter(f => f.startsWith('--')).map(f => {
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

/** `--merge-output-format mp4` 처럼 고를 수 있는 값이 정해진 옵션. */
function checkChoice(opt: Opt, value: string | null): string | null {
  const { choices } = opt;
  if (!choices || value == null) return null;
  // 쉼표로 여러 개를 주는 옵션이 있다 (--sponsorblock-remove 등).
  const parts = String(value).split(',').map(s => s.trim()).filter(Boolean);
  const bad = parts.filter(p => !choices.includes(p));
  if (!bad.length) return null;
  return `${bad.join(', ')} 는 고를 수 있는 값이 아니다 (${choices.join(' · ')})`;
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
export function lintCommand(text: string): LintResult {
  const { items } = scanCommand(text);
  const issues: Issue[] = [];
  const urls = items.filter(i => i.kind === 'url').map(i => i.raw);
  const values: Values = {};               // optId → 값 (repeatable 은 배열)
  const count: Record<string, number> = {};

  for (const it of items) {
    if (it.kind === 'unknown') {
      if (it.why === 'no-flag') {
        const fixes = nearestFlags(it.flag);
        issues.push({ level: 'error', flag: it.flag, fixes,
          msg: `${it.flag} 는 이 yt-dlp 버전에 없는 플래그다`
            + (fixes.length ? ` — ${fixes.join(' · ')} 를 찾은 것 아닐까` : '') });
      } else if (it.why === 'no-value') {
        const o: Opt = BY_FLAG[it.flag].opt;
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
    const bad = checkChoice(opt, value);
    if (bad) issues.push({ level: 'error', flag: it.flag, opt: opt.id, msg: bad });
  }

  for (const id in count) {
    const o = BY_ID[id];
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
      total: OPTS.length,
    },
  };
}
