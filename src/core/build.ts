/**
 * yt-dlp commands written in code.
 *
 * This repo changed its input three times — node graph, prompt, and now code.
 * What survived all three was **the reflected schema and real parsers**, and
 * here both are simply turned around. The reading parser already exists, so the
 * writing side only has to call the compiler.
 *
 *   parseFormat   string → tree   used by the checker
 *   emitTree      tree → string   used by the builder
 *
 * The reason the graph didn't fit is inverted here. A yt-dlp command is a flat
 * list of flags, so edges had nothing to do; a method chain has no edges to
 * begin with. Only the three whose values have structure (`-f` expression ·
 * `-o` sequence · `-P` set) get their own grammar. The reasoning is in
 * docs/builder.md.
 *
 * The 184 options **grow from the schema** — there is no hand-written list. The
 * types come from the same place (gen_options.ts). So options missing from the
 * installed yt-dlp don't show in autocomplete, and runtime and types can't drift.
 *
 * Knows nothing of the DOM or the file system. The schema is an argument —
 * `makeYtdlp(schema)`.
 */

import { SELECTORS, emitTree } from './format-grammar.js';
import { FIELDS, emitPiece } from './output-template.js';
import { lintCommand } from './lint.js';
import { quote } from './command.js';
import { emitCookieSource } from './cookies.js';
import { keysOf } from './schema.js';
import type { Opt, Schema } from './schema.js';
import { methodName, selMethod } from './env-types.js';

import type { Filter, FormatNode, FormatOp } from './format-grammar.js';
import type { Piece as OutNode } from './output-template.js';
import type { Issue } from './lint.js';

import type {
  Arg, Browser, Conversion, Filters, FormatFactory as GenFactory, Keyring, MatchFields,
  NumCond, OutFields, OutType, Options, PathMap, StrCond,
} from './options.gen.js';

export type {
  Arg, Browser, Conversion, Filters, Keyring, MatchFields, NumCond, OutField, OutType,
  PathMap, Selector, StrCond, Version,
} from './options.gen.js';

/**
 * A time range for `--download-sections`.
 *
 * Seconds (`90`), `min:sec` (`1:30`) or `hr:min:sec`. Omitted ends mean from the start / to the end.
 */
export interface Section {
  from?: number | string;
  to?: number | string;
}

/**
 * Filter object → one `--match-filters` expression.
 *
 * `-f` concatenates `[key=v][k2=v2]`; this joins with ` & `. Presence/absence is
 * `key` · `!key`, without brackets.
 */
function matchExpr(arg: MatchFields | string): string {
  if (typeof arg === 'string') return arg;
  return toFilters(arg as Filters).map(f => {
    if (f.op === 'has') return f.key;
    if (f.op === 'hasnot') return `!${f.key}`;
    return `${f.key}${f.op}${f.loose ? '?' : ''}${f.value}`;
  }).join(' & ');
}

/** The three slots after the browser in `--cookies-from-browser`. All optional. */
export interface CookieFrom {
  /** Keyring used to decrypt Chromium-based cookies on Linux. */
  keyring?: Keyring;
  /** Profile name or path to a profile directory. */
  profile?: string;
  /** Firefox container name. */
  container?: string;
}
export type { Filter, FormatNode } from './format-grammar.js';
export type { Issue } from './lint.js';

const SEL_NAMES = SELECTORS.flatMap(([, items]) => items.map(([k]) => k));
const FIELD_NAMES = FIELDS.flatMap(([, items]) => items.map(([k]) => k));

// The naming rule **must match** the generator's. Runtime method names are made
// here and type names there; if they diverge you get slots with a type but no
// method. So the rule lives once in env-types.ts and is only re-exported here.
export { methodName, selMethod };

/**
 * The form actually printed in the command.
 *
 * Uses the short flag when there is one — that's how people write it by hand, and
 * it has to match the flags shown in check results to compare by eye. The method
 * **name** comes from the long flag (`.format()`, not `-f`) — code is meant to be read.
 */
const flagOf = (opt: Opt): string => opt.short || opt.flag;

/** Whether two values of a keyed option land on exactly the same keys. */
const sameKeys = (opt: Opt, a: string, b: string): boolean =>
  [...(keysOf(opt, a) ?? [])].sort().join(',') === [...(keysOf(opt, b) ?? [])].sort().join(',');


const COND_OPS: Record<string, string> = {
  lt: '<', lte: '<=', gt: '>', gte: '>=', eq: '=', ne: '!=',
  startsWith: '^=', endsWith: '$=', includes: '*=', matches: '~=',
  notStartsWith: '!^=', notEndsWith: '!$=', notIncludes: '!*=', notMatches: '!~=',
};

/**
 * Filter object → list of filters.
 *
 * A bare value means `=`. There are ten string comparisons; requiring an operator
 * every time would make the most common case (`ext: 'mp4'`) the noisiest.
 */
export function toFilters(spec?: Filters): Filter[] {
  const out: Filter[] = [];
  for (const [key, v] of Object.entries(spec || {})) {
    if (v == null) continue;
    // Always fill in `loose` — parseFilterBody does. If a single slot differs,
    // "builder tree = parser tree" breaks.
    if (v === true) { out.push({ key, op: 'has', loose: false, value: '' }); continue; }
    if (v === false) { out.push({ key, op: 'hasnot', loose: false, value: '' }); continue; }
    if (typeof v !== 'object') { out.push({ key, op: '=', loose: false, value: String(v) }); continue; }

    const { loose, ...rest } = v as NumCond & StrCond;
    for (const [name, value] of Object.entries(rest)) {
      const op = COND_OPS[name];
      if (!op) throw new TypeError(`${key} 에 모르는 비교다: ${name}`);
      out.push({ key, op, loose: !!loose, value: String(value) });
    }
  }
  return out;
}

/**
 * A wrapper around one expression node.
 *
 * The tree inside has **the same shape** as what `parseFormat` returns. So an
 * expression written with the builder and one received as a string can be handled
 * in the same place — reading and writing share one grammar, and unit tests guard
 * that with deepEqual.
 */
export class Expr {
  constructor(
    /** The wrapped expression tree, in exactly the shape `parseFormat` returns. */
    readonly node: FormatNode,
  ) {}

  private op(t: FormatOp, rest: Expr[]): Expr {
    const kids = [this.node, ...rest.map(r => r.node)];
    // Consecutive uses of the same operator flatten into one node — a.plus(b).plus(c)
    // must come out as a+b+c, not ((a+b)+c), to match what a person would write.
    // A node with filters emits its own parentheses, so it isn't flattened.
    const flat = this.node.t === t && !(this.node.filters || []).length
      ? [...(this.node as { kids: FormatNode[] }).kids, ...kids.slice(1)]
      : kids;
    // With no filters, don't create the slot at all — parseFormat doesn't. If a
    // single slot differs, "builder tree = parser tree" breaks.
    return new Expr({ t, kids: flat });
  }

  /** `+` — merges video and audio. */
  plus(...rest: Expr[]): Expr { return this.op('merge', rest); }
  /** `/` — the next one if the previous isn't available. */
  or(...rest: Expr[]): Expr { return this.op('fallback', rest); }
  /** `,` — downloads both. */
  also(...rest: Expr[]): Expr { return this.op('multi', rest); }

  /** Applies filters to the whole expression — `emitTree` adds the parentheses. */
  where(spec: Filters): Expr {
    return new Expr({ ...this.node, filters: [...(this.node.filters || []), ...toFilters(spec)] });
  }

  /** The string to pass to `-f` (`bv[height<=1080]+ba/b`). */
  toString(): string { return emitTree(this.node); }
}

/** The `f` in `.format(f => …)`. One method per selector. */
export interface FormatFactory extends GenFactory<Expr> {}

/** One method per selector. The list grows from `SELECTORS`. */
export function formatFactory(): FormatFactory {
  const f: Record<string, unknown> = {
    raw: (s: string) => new Expr({ t: 'sel', name: String(s), filters: [] }),
  };
  for (const name of SEL_NAMES) {
    f[selMethod(name)] = (spec?: Filters) =>
      new Expr({ t: 'sel', name, filters: toFilters(spec) });
  }
  return f as unknown as FormatFactory;
}

/** One `%(upload_date>%Y-%m-%d|Unknown)s` slot — the field piece from `output-template.ts`. */
export type FieldPiece = Extract<OutNode, { t: 'field' }>;
export type { OutNode };

/**
 * One field slot in a `-o` template — what `t.title` gives you.
 *
 * Each method returns a new piece, so calls chain (`t.upload_date.date('%Y').or('?')`).
 */
export class Piece {
  constructor(
    /** The wrapped field piece, in exactly the shape `output-template.ts` reads. */
    readonly p: FieldPiece,
  ) {}
  private with(patch: Partial<FieldPiece>): Piece { return new Piece({ ...this.p, ...patch }); }

  /** `|` — what to use when the value is missing. */
  or(fallback: string): Piece { return this.with({ fallback: String(fallback) }); }
  /** `>` — date format (`%Y-%m-%d`). */
  date(strf: string): Piece { return this.with({ strf: String(strf) }); }
  /** `.40S` — truncate and make filename-safe. */
  trunc(n: number): Piece { return this.with({ fmt: `.${n}`, conv: 'S' }); }
  /** `%(playlist_index)03d` — zero-pad. */
  pad(n: number, conv: Conversion = 'd'): Piece { return this.with({ fmt: `0${n}`, conv }); }
  /** Set the conversion character directly. */
  as(conv: Conversion): Piece { return this.with({ conv }); }

  /** The string that goes into the template (`%(title).40S`). */
  toString(): string { return emitPiece(this.p); }
}

const field = (name: string): Piece =>
  new Piece({ t: 'field', name, strf: '', fallback: null, fmt: '', conv: 's' });

/** An output template produced by the `` t`…` `` tag. */
export class Template {
  constructor(
    /** Pieces alternating between literals and fields. */
    readonly pieces: OutNode[],
  ) {}
  /** The string to pass to `-o` (`%(title)s [%(id)s].%(ext)s`). */
  toString(): string { return this.pieces.map(emitPiece).join(''); }
}

/** Tagged template plus field accessors. `-o` is a template to begin with, so this fits best. */
export interface OutTag extends OutFields<Piece> {
  (strings: TemplateStringsArray, ...values: (Piece | string | number)[]): Template;
  /** A field not in the catalog. */
  field(name: string): Piece;
}

export function outTag(): OutTag {
  const tag = (strings: TemplateStringsArray, ...values: (Piece | string | number)[]) => {
    const pieces: OutNode[] = [];
    strings.forEach((s, i) => {
      if (s) pieces.push({ t: 'text', text: s });
      if (i < values.length) {
        const v = values[i];
        pieces.push(v instanceof Piece ? v.p : { t: 'text', text: String(v) });
      }
    });
    return new Template(pieces);
  };
  (tag as unknown as OutTag).field = (name: string) => field(String(name));
  for (const name of FIELD_NAMES) {
    Object.defineProperty(tag, name, { get: () => field(name), enumerable: true });
  }
  return tag as unknown as OutTag;
}

interface Part { id: string; flag: string; value?: string }

// -f · -o · -P · --cookies-from-browser take structured values, so hand-written methods handle them.
const HAND_WRITTEN = new Set(['format', 'output', 'paths', 'cookies-from-browser',
  'match-filters', 'break-match-filters', 'download-sections']);

/**
 * The 184 methods grown from the schema are merged in here.
 *
 * Class and interface declaration merging — at runtime `grow()` plants them on the
 * prototype, and the generator emits the types. Both come from the one schema, so
 * they can't drift.
 */
export interface Ytdlp extends Options {}

export class Ytdlp {
  /** The schema this command is checked against. Each instance holds its own. */
  readonly schema: Schema;
  /** What to download. Appended at the very end of the command. */
  urls: string[] = [];
  /** Placed flags and values, emitted in the order they were written. */
  parts: Part[] = [];

  constructor(schema: Schema, urls: string[] = []) {
    this.schema = schema;
    this.url(...urls);
  }

  /**
   * Looks up one option in the schema.
   *
   * Hand-written methods (`format` · `output` · …) exist whatever the schema says, so
   * the option may be missing — a schema reflected from a yt-dlp that renamed it.
   * Without this check that surfaced as `undefined is not an object (opt.short)`.
   */
  private opt(id: string): Opt {
    const o = this.schema.byId[id];
    if (!o) throw new Error(`--${id} 는 이 스키마(yt-dlp ${this.schema.version})에 없는 옵션이다`);
    return o;
  }

  /** Adds URLs. They always go at the end of the command. */
  url(...urls: string[]): this {
    for (const u of urls) if (u) this.urls.push(String(u));
    return this;
  }

  /**
   * Places one flag.
   *
   * Giving the same option twice **overwrites it in place.** Appending instead would
   * let edit order in code reorder the command, so changing one line produces a
   * two-line diff. Repeatable options accumulate — except keyed ones, where a value
   * for the same keys replaces the earlier one, as yt-dlp does
   * (`.output(a).output('thumbnail', b)` keeps both, `.output(a).output(b)` keeps `b`).
   */
  place(id: string, flag: string, value?: string): this {
    const opt = this.opt(id);
    const same = opt.kind !== 'repeatable'
      ? (p: Part) => p.id === id
      : opt.keyed && !opt.keyed.append && value != null
        ? (p: Part) => p.id === id && p.value != null && sameKeys(opt, p.value, value)
        : null;
    const at = same ? this.parts.findIndex(same) : -1;
    if (at >= 0) this.parts[at] = { id, flag, value };
    else this.parts.push({ id, flag, value });
    return this;
  }

  /** Removes the flag placed for an option id. Does nothing if absent. */
  drop(id: string): this {
    this.parts = this.parts.filter(p => p.id !== id);
    return this;
  }

  /**
   * `-f` — format selector.
   *
   * @example As an expression
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc')
   *   .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
   *   .build();
   * // yt-dlp -f "bv[height<=1080]+ba/b" https://youtu.be/abc
   * ```
   */
  format(build: (f: FormatFactory) => Expr): this;
  /** `-f` as a raw string. `.lint()` checks the grammar. */
  format(selector: string): this;
  format(arg: string | ((f: FormatFactory) => Expr)): this {
    const v = typeof arg === 'function' ? String(arg(formatFactory())) : String(arg);
    return this.place('format', flagOf(this.opt('format')), v);
  }

  /**
   * `-o` — output template.
   *
   * @example As a tagged template
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc')
   *   .output(t => t`${t.title} [${t.id}].${t.ext}`)
   *   .build();
   * // yt-dlp -o "%(title)s [%(id)s].%(ext)s" https://youtu.be/abc
   * ```
   */
  output(build: (t: OutTag) => Template): this;
  /** A template for one file type (`thumbnail:…`). */
  output(type: OutType, build: (t: OutTag) => Template): this;
  /** `-o` as a raw string. */
  output(template: string): this;
  output(a: unknown, b?: unknown): this {
    const [type, arg] = b === undefined ? ['', a] : [a as string, b];
    const body = typeof arg === 'function'
      ? (arg as (t: OutTag) => Template)(outTag()) : arg;
    const text = String(body);
    return this.place('output', flagOf(this.opt('output')), type ? `${type}:${text}` : text);
  }

  /** `-P` — download paths per file type. */
  paths(map: PathMap): this {
    for (const [type, path] of Object.entries(map || {})) {
      if (path == null) continue;
      this.place('paths', flagOf(this.opt('paths')), type === 'home' ? String(path) : `${type}:${path}`);
    }
    return this;
  }

  /**
   * `--cookies-from-browser` — loads cookies from a browser.
   *
   * The value is `BROWSER[+KEYRING][:PROFILE][::CONTAINER]`, four slots. Joining
   * them as a string makes it easy to mix up `::` and `:`, so each slot gets a
   * name — especially for a container without a profile (`firefox::Personal`).
   *
   * @example Slots by name
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc').cookiesFromBrowser('firefox', { container: 'Personal' }).build();
   * // yt-dlp --cookies-from-browser firefox::Personal https://youtu.be/abc
   *
   * ytdlp('https://youtu.be/abc').cookiesFromBrowser('chrome', { keyring: 'GNOMEKEYRING' }).build();
   * // yt-dlp --cookies-from-browser chrome+GNOMEKEYRING https://youtu.be/abc
   * ```
   */
  cookiesFromBrowser(browser: Browser, from: CookieFrom = {}): this {
    const id = 'cookies-from-browser';
    const value = emitCookieSource({
      browser,
      keyring: from.keyring ?? null,
      profile: from.profile ?? null,
      container: from.container ?? null,
    });
    return this.place(id, flagOf(this.opt(id)), value);
  }

  /**
   * `--match-filters` — downloads only videos matching the conditions.
   *
   * **The operators are the same as `-f` filters and the fields the same as `-o`
   * templates** — that's how yt-dlp defines it. So `toFilters` is reused as-is.
   * Giving it multiple times means OR.
   *
   * @example As an object
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc').matchFilters({ duration: { gt: 120 }, is_live: false }).build();
   * // yt-dlp --match-filters "duration>120 & !is_live" https://youtu.be/abc
   * ```
   */
  matchFilters(spec: MatchFields): this;
  /** For fields outside the catalog. Several mean OR — that's how yt-dlp reads them. */
  matchFilters(...exprs: string[]): this;
  matchFilters(...args: [MatchFields] | string[]): this {
    return this.pushAll('match-filters', args);
  }

  /** `--break-match-filters` — like the above, but **stops right there** on a non-match. */
  breakMatchFilters(spec: MatchFields): this;
  /** For fields outside the catalog. Stops right there on a non-match. */
  breakMatchFilters(...exprs: string[]): this;
  breakMatchFilters(...args: [MatchFields] | string[]): this {
    return this.pushAll('break-match-filters', args);
  }

  /** Stacks filter arguments one by one. The option is repeatable, so `place` appends. */
  private pushAll(id: string, args: [MatchFields] | string[]): this {
    const flag = flagOf(this.opt(id));
    for (const a of args) this.place(id, flag, matchExpr(a as MatchFields | string));
    return this;
  }

  /**
   * `--download-sections` — downloads only part of a video.
   *
   * An object is a time range (`*start-end`); a string is **a regex on chapter titles**.
   * They mean entirely different things, so the asterisk isn't left to be added by hand.
   *
   * @example Time range
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc').downloadSections({ from: 60, to: '2:30' }).build();
   * // yt-dlp --download-sections "*60-2:30" https://youtu.be/abc
   *
   * ytdlp('https://youtu.be/abc').downloadSections({ from: 60 }).build();
   * // yt-dlp --download-sections "*60-inf" https://youtu.be/abc
   * ```
   *
   * @example Chapter title
   * ```ts
   * import { ytdlp } from 'yt-studio';
   *
   * ytdlp('https://youtu.be/abc').downloadSections('Intro').build();
   * // yt-dlp --download-sections Intro https://youtu.be/abc
   * ```
   */
  downloadSections(range: Section): this;
  /** Downloads only chapters whose title matches this regex. */
  downloadSections(chapter: string): this;
  downloadSections(arg: Section | string): this {
    const id = 'download-sections';
    const v = typeof arg === 'string' ? arg
      : `*${arg.from ?? 0}-${arg.to ?? 'inf'}`;
    return this.place(id, flagOf(this.opt(id)), v);
  }

  /** Copies everything built so far. */
  clone(): this {
    // new Ytdlp() would be a shell without the grown methods — option methods live
    // on the prototype of the subclass made per schema.
    const Self = this.constructor as new (schema: Schema) => this;
    const c = new Self(this.schema);
    c.urls = [...this.urls];
    c.parts = this.parts.map(p => ({ ...p }));
    return c;
  }

  /**
   * Flags and values as tokens.
   *
   * A value starting with `-` is emitted **attached** (`--compat-options=-multistreams`).
   * Detached, optparse still accepts it — it just takes the next token as the value —
   * but a reader can't tell it from a flag. This repo's checker actually flagged it
   * as an "unknown flag". **If the builder's output is rejected by its own checker,**
   * it's the builder that's wrong, not the checker.
   *
   * The `-` subtracting form comes from options that remove entries from a list,
   * like `--compat-options all,-multistreams`.
   */
  private tokens(esc: (v: string) => string): string[] {
    const out: string[] = [];
    for (const p of this.parts) {
      if (p.value === undefined) { out.push(p.flag); continue; }
      const v = String(p.value);
      if (v.startsWith('-')) out.push(`${p.flag}=${esc(v)}`);
      else { out.push(p.flag); out.push(esc(v)); }
    }
    return out;
  }

  /** argv to pass to `spawn`. No quotes — there's no shell, so quotes would stay in the value. */
  toArray(): string[] {
    return [...this.tokens(v => v), ...this.urls];
  }

  /** One line to paste into a shell. Values containing spaces are quoted. */
  build(): string {
    return ['yt-dlp', ...this.tokens(quote), ...this.urls].join(' ');
  }

  /**
   * Runs the built command through the checker.
   *
   * Types already block unknown flags and choices, so what's left here is
   * **combinations** — `-x` with a video-only `-f`, or `--embed-subs` without
   * downloading subtitles. Types can't see this layer, which is why the checker
   * doesn't go away just because there's a builder.
   */
  lint(): { ok: boolean; issues: Issue[] } {
    const { ok, issues } = lintCommand(this.schema, this.build());
    return { ok, issues };
  }

  /** Same as {@linkcode Ytdlp.build}. */
  toString(): string { return this.build(); }
}

/**
 * Grows the 184 methods from the schema and plants them on a prototype.
 *
 * The point is that there's no hand-written list — when yt-dlp adds an option,
 * rerunning `gen_schema.py` and `gen_options.ts` is all it takes for the method and
 * its type to appear together.
 *
 * **Takes the prototype as an argument.** Option lists can differ per schema, so
 * planting on `Ytdlp.prototype` alone would let a later schema overwrite an earlier one.
 */
function grow(schema: Schema, proto: Record<string, unknown>): void {
  for (const opt of schema.opts) {
    if (HAND_WRITTEN.has(opt.id)) continue;

    proto[methodName(opt.flag)] =
      opt.kind === 'flag'
        ? function (this: Ytdlp, on = true) {
          if (on) return this.place(opt.id, flagOf(opt));
          // With a negated form, turn it off explicitly; otherwise "not passing it" is the only way off
          return opt.negation ? this.place(opt.id, opt.negation) : this.drop(opt.id);
        }
        : opt.kind === 'repeatable'
          ? function (this: Ytdlp, ...values: Arg[]) {
            for (const v of values) this.place(opt.id, flagOf(opt), String(v));
            return this;
          }
          : function (this: Ytdlp, value: Arg) {
            return this.place(opt.id, flagOf(opt), String(value));
          };
  }
}

/**
 * Creates a `ytdlp()` bound to one schema.
 *
 * Each schema gets **its own subclass** with the methods planted there. So two
 * schemas held side by side don't overwrite each other's methods — previously they
 * were planted on `Ytdlp.prototype` alone and the later one won.
 */
export function makeYtdlp(schema: Schema): (...urls: string[]) => Ytdlp {
  class Bound extends Ytdlp {}
  grow(schema, Bound.prototype as unknown as Record<string, unknown>);
  return (...urls: string[]) => new Bound(schema, urls);
}
