/**
 * Command diagnostics.
 *
 * This is the center of the tool. LLMs write plausible yt-dlp commands but
 * **cannot tell when they are wrong** — they use flags that existed at training
 * time and build `-f` / `-o` values from memory rather than grammar. Here we look
 * at the real thing, not memory.
 *
 * - Does the flag exist in this yt-dlp version?     the reflected schema
 * - Is there a value where one is required?         opt.kind
 * - Is it one of the allowed values?                opt.choices
 * - Do -f and -o follow their grammar?              runs the real parsers
 * - Does a repeated flag replace a value it didn't mean to? (`-f b -f w`, `-P home:/a -P home:/b`)
 * - Are options that contradict each other given together?
 *
 * Knows nothing of the DOM or app state. One string goes in, a list of
 * diagnostics comes out.
 */

import { scanCommand } from './command.js';
import { grammarMessage } from './grammar-error.js';
import { parseFormat } from './format-grammar.js';
import { parseTemplate, splitType } from './output-template.js';
import { splitEntry } from './paths.js';
import { parseCookieSource } from './cookies.js';
import { keysOf } from './schema.js';
import type { Opt, Schema } from './schema.js';
import type { Item } from './command.js';
import type { Piece } from './output-template.js';

/** `error` must not be run as is, `warn` may not do what was intended, `info` is for reference. */
export const LEVELS = ['error', 'warn', 'info'] as const;
/** Severity of a diagnostic. Ordered as in {@linkcode LEVELS}. */
export type Level = (typeof LEVELS)[number];
const rank = (l: Level): number => LEVELS.indexOf(l);

/** One thing the checker caught. `fixes` holds up to three close candidates for an unknown flag. */
export interface Issue {
  /** Severity. A single `error` makes {@linkcode LintResult.ok} false. */
  level: Level;
  /** One line for humans. It is in Korean. */
  msg: string;
  /** The offending flag as written in the command. Absent when no single flag is at fault. */
  flag?: string;
  /** Id of the offending option (`write-subs`). Absent when the schema does not know the flag. */
  opt?: string;
  /** Flags to use instead. For an unknown flag, up to three, closest first. */
  fixes?: string[];
}

/** Option id → value read. Flags are booleans, repeatables are arrays. */
export type Values = Record<string, string | boolean | (string | null)[] | null>;

/** The result of checking one command string. */
export interface LintResult {
  /** Items read from the command, in their original order. */
  items: Item[];
  /** Tokens that are not options — what to download. */
  urls: string[];
  /** Option id → value read. {@linkcode previewFilename} consumes this. */
  values: Values;
  /** Everything caught, most severe first. */
  issues: Issue[];
  /** True when there are no errors. Warnings do not count here. */
  ok: boolean;
  /**
   * Counts for a one-line summary.
   *
   * `opts` is the number of distinct options this command uses, `total` the
   * number of options in the schema it was checked against.
   */
  counts: { error: number; warn: number; info: number; opts: number; total: number };
}

/** Edit distance. With about 200 candidates, a plain DP is enough. */
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
 * Flags close to an unknown one.
 *
 * Picking by distance alone pairs `--foo` with some unrelated three-letter flag.
 * The threshold scales with length, and if nothing is left we try substrings once
 * more.
 */
export function nearestFlags(schema: Schema, flag: string, limit = 3): string[] {
  const q = String(flag || '').replace(/^-+/, '').toLowerCase();
  if (!q) return [];
  // A shared prefix counts as closer. By distance alone --embed-subtitle gets
  // some unrelated short flag — people usually get the tail wrong.
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
 * Options whose values come from a fixed set, like `--fixup never`.
 *
 * The list is reflected from yt-dlp, so it is closed — yt-dlp rejects values
 * outside it too. But there are **two forms we must not reject**.
 *
 * - several, comma-separated (`--sponsorblock-remove sponsor,intro`)
 * - removal with a leading `-` (`--compat-options all,-multistreams`)
 *
 * Both are forms `_set_from_options_callback` really accepts. Without allowing
 * them a valid command is flagged as an error, which for this tool is worse than
 * missing one.
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
 * Values that are a grammar over a vocabulary, like `--recode-video "aac>mp3/mkv"`.
 *
 * Checks the same thing as yt-dlp's `FFmpeg*PP.FORMAT_RE` — a `/`-joined order
 * of preference where each slot is `[source>]target`, and **only the target**
 * must be in the vocabulary. The source means "only for this extension", so any
 * extension goes.
 *
 * Types cannot enforce this grammar (doing so would turn valid values into
 * errors), so closing it happens here.
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
 * A type prefixed to the value, like `-o thumbnail:%(id)s`.
 *
 * yt-dlp **does not reject** an unknown type — it treats it as not a type and
 * puts the whole value in the default slot. So `-o nope:%(id)s.%(ext)s` quietly
 * produces a file starting with `nope:`. It goes wrong silently, so we say so here.
 *
 * It is a warning — the value may simply contain a colon
 * (`--exec "sed s/a:b/c/ …"`). So we only look **when it looks like a type**: a
 * single word before the colon.
 */
function checkKeys(opt: Opt, value: string | null): string | null {
  if (!opt.keys?.length || !value) return null;
  const head = /^(\w+):/.exec(value)?.[1];
  if (!head || opt.keys.includes(head)) return null;
  return `${head}: 는 ${opt.flag} 가 아는 종류가 아니다 (${opt.keys.join(' · ')})`
    + ` — yt-dlp 는 이걸 종류로 안 읽고 값에 그대로 남긴다`;
}

/**
 * Runs `--cookies-from-browser` through the real parser.
 *
 * It is not just a browser name — it is a four-slot structure like
 * `firefox::Personal`, so a wrong shape and a wrong vocabulary word must be
 * reported separately.
 */
function checkCookies(opt: Opt, value: string | null): string | null {
  if (!opt.vocabs || value == null || value === '') return null;
  try { parseCookieSource(value, opt.vocabs); return null; }
  catch (e) { return `${opt.flag} — ${grammarMessage(e)}`; }
}

/** Runs `-f` through the real parser. If it cannot be read, returns what the parser said. */
function checkFormat(value: string): string | null {
  try { parseFormat(value); return null; }
  catch (e) { return grammarMessage(e); }
}

function checkOutput(value: string): { error?: string; pieces?: Piece[]; hasExt?: boolean } {
  const { template } = splitType(value);
  let pieces;
  try { pieces = parseTemplate(template); }
  catch (e) { return { error: grammarMessage(e) }; }
  const hasExt = pieces.some(p => p.t === 'field' && (p.name === 'ext' || /(^|\.)ext$/.test(p.name)));
  return { pieces, hasExt };
}

function checkPaths(values: string[]): string[] {
  const out: string[] = [];
  for (const line of values) {
    const { type, path } = splitEntry(line);
    if (!path) out.push(`-P ${type || 'home'} 의 경로가 비어 있다`);
  }
  return out;
}

/**
 * Combinations that are grammatical but miss the intent. Only certain ones are
 * kept — adding vague rules makes warnings common, and common warnings go unread.
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
 * Command string → { items, urls, values, issues, ok }.
 *
 * issues: { level, msg, flag?, opt?, fixes? } — most severe first.
 */
export function lintCommand(schema: Schema, text: string): LintResult {
  const { items } = scanCommand(schema, text);
  const issues: Issue[] = [];
  const urls = items.filter(i => i.kind === 'url').map(i => i.raw);
  const values: Values = {};               // optId → value (arrays for repeatable)
  const count: Record<string, number> = {};
  // Keyed options replace per key set: optId → key set ("default", "dash,m3u8") → times given
  const keyCount: Record<string, Record<string, number>> = {};

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

    const keys = opt.keyed && !opt.keyed.append && value != null ? keysOf(opt, value) : null;
    if (keys) {
      const set = [...keys].sort().join(',');
      (keyCount[opt.id] ||= {})[set] = (keyCount[opt.id]![set] || 0) + 1;
    }
  }

  for (const id in count) {
    const o = schema.byId[id]!;
    if (count[id]! > 1 && o.kind !== 'repeatable') {
      issues.push({ level: 'warn', opt: id,
        msg: `${o.flag} 를 ${count[id]}번 줬다 — 마지막 것만 쓰인다` });
    }
  }
  // Only an identical key set is flagged. A partial overlap is how you set a default
  // and then override one key (`--color never --color stderr:always`) — that is intended.
  for (const id in keyCount) {
    const o = schema.byId[id]!;
    for (const [set, n] of Object.entries(keyCount[id]!)) {
      if (n < 2) continue;
      issues.push({ level: 'warn', opt: id,
        msg: `${o.short || o.flag} 에 ${set} 가 ${n === 2 ? '두 번' : `${n}번`} 있다 — 뒤엣것만 쓰인다` });
    }
  }

  const has = (id: string): boolean => id in values && values[id] !== false;
  const val = (id: string): string | null => (typeof values[id] === 'string' ? values[id] : null);

  if (has('format')) {
    const err = checkFormat(values.format as string);
    if (err) issues.push({ level: 'error', opt: 'format', msg: `-f 값을 읽지 못했다 — ${err}` });
  }
  if (has('output')) {
    // Every template is read, not just the first. The missing-extension warning is
    // for the main file only — for thumbnails and subtitles yt-dlp adds the extension.
    for (const out of ([] as (string | null)[]).concat(values.output as string | (string | null)[])) {
      if (out == null) continue;
      const r = checkOutput(out);
      if (r.error) issues.push({ level: 'error', opt: 'output', msg: `-o 값을 읽지 못했다 — ${r.error}` });
      else if (!r.hasExt && !splitType(out).type) {
        issues.push({ level: 'warn', opt: 'output',
          msg: '-o 에 %(ext)s 가 없다 — 확장자 없는 파일이 만들어진다' });
      }
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
