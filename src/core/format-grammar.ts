/**
 * The yt-dlp format selector grammar.
 *
 * `-f` is not a flat value but an expression. This file is the whole grammar.
 *
 *   atom     := (selector | '(' expr ')') filter*   bv*[height<=1080] · (mp4,webm)[height<480]
 *   merge    := atom ('+' atom)*                    bv+ba
 *   fallback := merge ('/' merge)*                  bv+ba/b   ==   (bv+ba)/b
 *   multi    := fallback (',' fallback)*            bv,ba
 */

import type { Result } from 'effect';

import { GrammarError, readGrammar } from './grammar-error.js';

/** Operator precedence. A child lower than its parent gets parenthesized. */
export const PREC = { multi: 0, fallback: 1, merge: 2, sel: 3 } as const;

/** Operators that make up an expression. */
export type FormatOp = 'merge' | 'fallback' | 'multi';

const OP_SEP: Record<FormatOp, string> = { merge: '+', fallback: '/', multi: ',' };

/** One `[height<=?1080]` slot. `?` is added when `loose` is true. */
export interface Filter {
  /** Format field name (`height`, `ext`). */
  key: string;
  /** Comparison operator (`<=`, `^=`, `!*=`, …). A bare name without a value gives `has` / `hasnot`. */
  op: string;
  /** When true, formats missing the field also pass — adds `?`. */
  loose?: boolean;
  /** The value to compare. Empty for `has` / `hasnot`. */
  value: string;
}

/**
 * The expression tree.
 *
 * Filters attach not only to selectors but **to operator nodes too** —
 * `(mp4,webm)[height<480]` appears in the yt-dlp docs.
 */
export type FormatNode =
  | { t: 'sel'; name: string; filters: Filter[] }
  | { t: FormatOp; kids: FormatNode[]; filters?: Filter[] };

/**
 * Selector vocabulary — names and one-line descriptions.
 *
 * A layer reflection cannot provide. yt-dlp takes the `-f` value as a plain
 * string, so the optparse tree says nothing about what `b` or `bv` mean. Written
 * by hand. The builder's method names and autocomplete descriptions come from here.
 */
export const SELECTORS: [group: string, items: [sel: string, help: string][]][] = [
  ['Video + audio (one file)', [
    ['b',  'best — best of files with both video and audio'],
    ['b*', 'best* — best of any kind'],
    ['w',  'worst — worst of files with both'],
    ['w*', 'worst* — worst of any kind'],
  ]],
  ['Video only', [
    ['bv',  'bestvideo — best of video-only files'],
    ['bv*', 'bestvideo* — best of files with video (audio allowed)'],
    ['wv',  'worstvideo — worst of video-only files'],
    ['wv*', 'worstvideo* — worst of files with video'],
  ]],
  ['Audio only', [
    ['ba',  'bestaudio — best of audio-only files'],
    ['ba*', 'bestaudio* — best of files with audio (video allowed)'],
    ['wa',  'worstaudio — worst of audio-only files'],
    ['wa*', 'worstaudio* — worst of files with audio'],
  ]],
];

export const SEL_HELP: Record<string, string> =
  Object.fromEntries(SELECTORS.flatMap(([, items]) => items));

/**
 * Filter fields. Taken from the yt-dlp docs; which comparisons are allowed depends
 * on `num`/`str`. Also a hand-written layer — the builder's `Filters` type comes
 * from here.
 */
export const FKEYS: [key: string, label: string, type: 'num' | 'str'][] = [
  ['height', 'vertical resolution', 'num'], ['width', 'horizontal resolution', 'num'], ['fps', 'frame rate', 'num'],
  ['tbr', 'total bitrate', 'num'], ['vbr', 'video bitrate', 'num'], ['abr', 'audio bitrate', 'num'],
  ['asr', 'audio sample rate', 'num'], ['audio_channels', 'number of audio channels', 'num'],
  ['filesize', 'file size', 'num'], ['filesize_approx', 'approximate file size', 'num'],
  ['aspect_ratio', 'aspect ratio', 'num'],
  ['ext', 'file extension', 'str'], ['vcodec', 'video codec', 'str'], ['acodec', 'audio codec', 'str'],
  ['container', 'container', 'str'], ['protocol', 'protocol', 'str'], ['format_id', 'format id', 'str'],
  ['format_note', 'format note', 'str'], ['resolution', 'resolution', 'str'], ['language', 'language', 'str'],
  ['dynamic_range', 'dynamic range', 'str'],
];

/** `height<=?1080`, `format_note`, `!format_note` → one filter slot. Fails with {@linkcode GrammarError} when it cannot be read. */
export function parseFilterBody(body: string): Result.Result<Filter, GrammarError> {
  return readGrammar(() => readFilter(body));
}

function readFilter(body: string): Filter {
  const b = body.trim();
  if (!b) throw new GrammarError('빈 필터');
  const m = b.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(!?[\^$*~]?=|<=|>=|<|>)(\??)\s*(.*)$/);
  // All four groups are required, so each is a string whenever `m` matched.
  if (m) return { key: m[1]!, op: m[2]!, loose: m[3] === '?', value: m[4]!.trim() };
  if (/^![A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b.slice(1), op: 'hasnot', value: '' };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(b)) return { key: b, op: 'has', value: '' };
  throw new GrammarError(`필터를 읽지 못했다: [${body}]`);
}

/**
 * Nesting deeper than this is refused instead of overflowing the stack.
 *
 * Real selectors nest two or three levels; 64 leaves plenty of room.
 */
const MAX_DEPTH = 64;

/**
 * Format selector string → tree. Fails with {@linkcode GrammarError} carrying the reason when it cannot be read.
 *
 * Succeeds with `null` for an empty or blank string.
 */
export function parseFormat(src: string): Result.Result<FormatNode | null, GrammarError> {
  return readGrammar(() => readFormat(src));
}

function readFormat(src: string): FormatNode | null {
  const s = (src || '').trim();
  if (!s) return null;
  let i = 0, depth = 0;
  const ws = (): void => { while (i < s.length && /\s/.test(s.charAt(i))) i++; };
  const peek = (): string | undefined => s[i];

  const expr = (): FormatNode => multi();

  function multi(): FormatNode {
    const first = fallback(), kids = [first]; ws();
    while (peek() === ',') { i++; kids.push(fallback()); ws(); }
    return kids.length === 1 ? first : { t: 'multi', kids };
  }
  function fallback(): FormatNode {
    const first = merge(), kids = [first]; ws();
    while (peek() === '/') { i++; kids.push(merge()); ws(); }
    return kids.length === 1 ? first : { t: 'fallback', kids };
  }
  function merge(): FormatNode {
    const first = atom(), kids = [first]; ws();
    while (peek() === '+') { i++; kids.push(atom()); ws(); }
    return kids.length === 1 ? first : { t: 'merge', kids };
  }

  /**
   * atom := (selector | '(' expr ')') filter*
   *
   * Filters are read at the end of the atom, not after the selector — they attach
   * to whatever node came. That way filters on groups are read too.
   */
  function atom(): FormatNode {
    ws();
    let node: FormatNode;
    if (peek() === '(') {
      if (++depth > MAX_DEPTH) throw new GrammarError(`괄호가 ${MAX_DEPTH}겹보다 깊다`, i);
      i++; node = expr(); ws();
      if (peek() !== ')') throw new GrammarError("')' 가 닫히지 않았다", i);
      i++; depth--;
    } else {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_*.\-]/.test(s.charAt(i))) i++;
      if (i === start) throw new GrammarError(`셀렉터를 찾지 못했다 (${i + 1}번째 글자 근처)`, i);
      node = { t: 'sel', name: s.slice(start, i), filters: [] };
    }
    ws();
    while (peek() === '[') {
      i++;
      const j = s.indexOf(']', i);
      if (j < 0) throw new GrammarError("']' 가 닫히지 않았다", i);
      (node.filters ||= []).push(readFilter(s.slice(i, j)));
      i = j + 1; ws();
    }
    return node;
  }

  const tree = expr(); ws();
  if (i < s.length) throw new GrammarError(`읽고 남은 글자: "${s.slice(i)}"`, i);
  return tree;
}

/** One filter → `[height<=1080]`. `has`/`hasnot` write just the name, no value. */
export function emitFilter(f: Filter): string {
  if (f.op === 'has') return '[' + f.key + ']';
  if (f.op === 'hasnot') return '[!' + f.key + ']';
  return '[' + f.key + f.op + (f.loose ? '?' : '') + f.value + ']';
}

/**
 * Effective precedence used to decide on parentheses.
 *
 * An operator with filters already comes out in its own parentheses
 * (`(mp4,webm)[…]`). That makes it no different from an atom, so it is treated as
 * sel and the parent does not wrap it again.
 */
const effPrec = (n: FormatNode): number =>
  (n.t !== 'sel' && (n.filters || []).length) ? PREC.sel : PREC[n.t];

/** Tree → format selector string. Adds only the parentheses needed. */
export function emitTree(n: FormatNode | null): string {
  if (!n) return '';
  const filters = (n.filters || []).map(emitFilter).join('');
  if (n.t === 'sel') return n.name + filters;
  const body = n.kids.map(k => {
    const s = emitTree(k);
    return effPrec(k) < PREC[n.t] ? '(' + s + ')' : s;   // parenthesize when lower precedence
  }).join(OP_SEP[n.t]);
  return filters ? '(' + body + ')' + filters : body;
}
