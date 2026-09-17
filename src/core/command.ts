/**
 * Command string ↔ sequence of items.
 *
 * There is exactly one path for reading a command in this repo. The checker and
 * the builder both go through the same `scanCommand`, so they can't see
 * different commands.
 *
 * The writing side uses just `quote` — when producing a line to paste into a shell.
 */
import type { Schema } from './schema.js';
import type { Opt } from './schema.js';

/** Characters a shell passes through as-is. Anything outside this gets the value quoted. */
const SAFE = /^[A-Za-z0-9._:,\/=+@%^-]+$/;

/** Keeps a value one token when pasted into a shell. Leaves it alone if already safe. */
export const quote = (v: string): string =>
  SAFE.test(v) ? v : '"' + String(v).replace(/([\\"$`])/g, '\\$1') + '"';

/** Why a token was treated as unknown to the schema. */
export type UnknownWhy = 'no-flag' | 'no-value' | 'flag-took-value';

/**
 * One item read out of a command.
 *
 * `raw` is not the original text but **the re-quoted form** — so round-trips are stable.
 */
export type Item =
  | { kind: 'url'; raw: string }
  | {
      kind: 'opt'; raw: string; flag: string; opt: Opt; negated: boolean;
      /** null for a flag that takes no value. */
      value: string | null;
    }
  | { kind: 'unknown'; raw: string; flag: string; value: string | null; why: UnknownWhy };

/** Splits into tokens, honoring shell quoting. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '', q: string | null = null, open = false;
  // `open` is needed separately — `""` is an empty token, not the absence of one.
  // (Swallow `--sub-langs ""` and nobody ever sees that the value was empty.)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; }
      else if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; open = true; }
    else if (/\s/.test(c)) { if (open) { out.push(cur); cur = ''; open = false; } }
    else { cur += c; open = true; }
  }
  if (open) out.push(cur);
  return out;
}

/**
 * Command string → sequence of items, preserving order and original text.
 *
 * `head` is the leading `yt-dlp`. It reads fine without one — pastes aren't always whole.
 */
export function scanCommand(schema: Schema, text: string): { head: string | null; items: Item[] } {
  const toks = tokenize((text || '').replace(/\\\n/g, ' '));
  const head = (toks[0] && /yt-dlp|youtube-dl/.test(toks[0])) ? toks.shift()! : null;

  const items: Item[] = [];
  for (let i = 0; i < toks.length; i++) {
    const raw0 = toks[i];
    if (!raw0.startsWith('-') || raw0 === '-') { items.push({ kind: 'url', raw: raw0 }); continue; }

    let flag = raw0, inline: string | null = null;
    if (raw0.startsWith('--') && raw0.includes('=')) {
      const k = raw0.indexOf('=');
      flag = raw0.slice(0, k); inline = raw0.slice(k + 1);
    }
    const hit = schema.byFlag[flag];
    if (!hit) { items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-flag' }); continue; }

    const { opt, negated } = hit;
    if (opt.kind === 'flag') {
      // `--flag=value` gives a value to a flag — don't silently swallow it.
      if (inline != null) {
        items.push({ kind: 'unknown', raw: raw0, flag, value: inline, why: 'flag-took-value' });
        continue;
      }
      items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: null });
      continue;
    }
    if (inline != null) { items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: inline }); continue; }

    const v = toks[i + 1];
    // If the next token is another flag, the value is missing. Negatives (-1) and `-` can be values.
    const looksFlag = v !== undefined && v.startsWith('-') && v.length > 1 && !/^-?\d/.test(v);
    if (v === undefined || looksFlag) {
      items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-value' });
      continue;
    }
    i++;
    items.push({ kind: 'opt', raw: raw0 + ' ' + quote(v), flag, opt, negated, value: v });
  }
  return { head, items };
}
