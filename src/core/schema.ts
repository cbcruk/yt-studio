/**
 * The yt-dlp option schema.
 *
 * Builds indexes from one reflected raw JSON. **The result is a value** —
 * `buildSchema` is a pure function and this module holds no mutable state.
 *
 * For a while it was the opposite. Five `export let OPTS/BY_ID/…` were filled in
 * by `initSchema`, which left what callers need to know out of the signatures.
 *
 * - `initSchema` must be called first for the rest to be valid
 * - calling it twice rewrites the state of **every module in the process**
 * - there is no way to hold two schemas at once
 *
 * The last one actually bit. Loading a fake schema once more made the earlier
 * `lintCommand` silently see the new schema while `VERSION` stayed the same —
 * **the module lied about its own state.** And the tests had to spawn a fresh
 * process per case to work around it, which means the seam was at process start.
 *
 * Now it is a value, so the seam is an argument. Two schemas can be held side by
 * side.
 */

/** One option, exactly as `gen_schema.py` extracted it from the optparse tree. */
export interface Opt {
  /** The long flag without `--` (`write-subs`). This repository refers to options by this name. */
  id: string;
  /** The long flag. Method names come from this. */
  flag: string;
  /** The short flag. When present, this is what gets written into commands. */
  short: string | null;
  /** Other long flags for the same option (`--ies` → `use-extractors`). */
  aliases: string[];
  /** Lifecycle stage — `source`, `format`, `store`, … */
  stage: string;
  /** Group name in yt-dlp `--help`. */
  group: string;
  /** Attribute optparse stores the value in. `null` for options that store none. */
  dest: string | null;
  /** How the option takes a value. */
  kind: OptKind;
  /** Name of the value slot shown in help (`FORMAT`, `FILE`). `null` when no value is taken. */
  metavar: string | null;
  /** The whole value must be one of these. `--fixup never` */
  choices: string[] | null;
  /**
   * Types that go **in front of** the value. `thumbnail` in `-o thumbnail:%(id)s`.
   *
   * The value itself is a free string (path, template, command), so these are not
   * `choices`. Only the prefix is closed.
   */
  keys: string[] | null;
  /**
   * A value that is **a small grammar over a vocabulary**. `--recode-video "aac>mp3/mkv"`
   *
   * As `choices`, `aac>mp3` would be flagged as an error. Autocomplete uses the
   * vocabulary; the checker handles the grammar.
   */
  rule: OptRule | null;
  /**
   * When the value is **a structure with several slots**, the vocabulary per slot.
   *
   * Only `--cookies-from-browser BROWSER[+KEYRING][:PROFILE][::CONTAINER]` has one.
   * `core/cookies.ts` owns the grammar; only the vocabulary lives here.
   */
  vocabs: Record<string, string[]> | null;
  /**
   * How a `KEYS:VALUE` value is split into keys, for options yt-dlp stores as a dict.
   *
   * Repeating such an option replaces the earlier value **only for the same keys** —
   * `-o a.%(ext)s -o thumbnail:%(id)s` keeps both. `null` for every other option.
   * Missing in schemas written before this field existed, which reads as `null`.
   */
  keyed?: OptKeyed | null;
  /**
   * What optparse reads the value as — `'string'`, `'int'`, `'float'`, `'choice'`.
   *
   * `null` for options that take no value. `int` and `float` are real numbers, so
   * their type becomes `number`. `string` says little, since the command line is
   * all strings anyway — `--audio-quality 0` is a `string` too.
   */
  valueType: 'string' | 'int' | 'float' | 'choice' | null;
  /** optparse's default. Its shape varies per option, so it is not narrowed. */
  default: unknown;
  /** The description paragraph from yt-dlp `--help`, with `%default` already filled in. */
  help: string;
  /** The flag for the off form, when there is a separate one like `--no-part`. */
  negation: string | null;
}

/**
 * How an option takes a value.
 *
 * `flag` takes none, `value` takes one, `choice` takes one of a fixed set, and
 * `repeatable` can be given several times with every value kept — unless
 * {@linkcode Opt.keyed} says a repeat replaces the same keys.
 */
export type OptKind = 'flag' | 'value' | 'choice' | 'repeatable';

/** The `callback_kwargs` of yt-dlp's `_dict_from_options_callback`, as reflected. */
export interface OptKeyed {
  /** yt-dlp's `allowed_keys` regex for one key. Also valid as a JavaScript regex. */
  pattern: string;
  /** Keys used when the value has no `KEYS:` prefix. `null` when a prefix is required. */
  defaults: string[] | null;
  /** Whether one prefix may name several keys, comma-separated (`dash,m3u8:native`). */
  multiple: boolean;
  /** Whether a repeat **adds** to the same key instead of replacing it (`--exec`). */
  append: boolean;
}

const keyRegex = new WeakMap<OptKeyed, RegExp>();

/**
 * The keys a value of a keyed option lands on, the way yt-dlp splits them.
 *
 * `-o thumbnail:%(id)s` → `['thumbnail']`, `-o %(title)s` → `['default']`.
 * Keys are lowercased, as yt-dlp does. `null` when the option isn't keyed, or when
 * the value has no prefix and the option has no default (yt-dlp rejects it).
 */
export function keysOf(opt: Opt, value: string): string[] | null {
  const k = opt.keyed;
  if (!k) return null;
  let re = keyRegex.get(k);
  if (!re) {
    const one = `(?:${k.pattern})`;
    re = new RegExp(`^(${k.multiple ? `${one}(?:,${one})*` : one}):`, 'is');
    keyRegex.set(k, re);
  }
  const m = re.exec(value);
  if (m) return m[1]!.split(',').map(s => s.toLowerCase());
  return k.defaults;
}

/**
 * `[source>]target(/[source>]target)*` — a port of yt-dlp's `FFmpeg*PP.FORMAT_RE`.
 *
 * `/` joins an order of preference (first wins). `source>` means "only for this
 * extension", so any extension goes there, not just the vocabulary.
 */
export interface OptRule {
  /** Extensions allowed as the target. */
  vocab: string[];
  /** Whether the `source>target` form is accepted. Only `--merge-output-format` rejects it. */
  from: boolean;
}

/** A lifecycle stage. A hand-filled layer that gives stages human-readable names. */
export interface Stage {
  /** Stage name (`run`, `format`, …). {@linkcode Opt.stage} points to this. */
  id: string;
  /** Short Korean name (`실행`). */
  label: string;
  /** One line on what this stage decides, in Korean (`한 번의 실행 전체가 어떻게 동작할지`). */
  blurb: string;
  /** Names of the yt-dlp `--help` groups in this stage. */
  groups: string[];
}

/** What a single flag string points to. `negated` is true for the negated form. */
export interface FlagHit {
  opt: Opt;
  negated: boolean;
}

/**
 * Which reflection the schema came from.
 *
 * `optparse` means `gen_schema.py` imported yt-dlp as a Python module and read the
 * option objects directly; `help` means `yt-dlp --help` output was parsed. The
 * latter is less faithful — some aliases and `choices` never appear as text in the
 * help. In exchange it works with any kind of install.
 */
export type SchemaFrom = 'optparse' | 'help';

/** The JSON exactly as `gen_schema.py` emits it. */
export interface RawSchema {
  /** Version of the reflected yt-dlp (`2026.07.04`). */
  ytdlp_version: string;
  /** `optparse` when absent — before this field existed, that was the only kind of schema. */
  source?: SchemaFrom;
  /** Lifecycle stages, in the order a command is processed. */
  stages: Stage[];
  /** Every option. Those hidden from `--help` are not included. */
  options: Opt[];
}

/**
 * A schema with its indexes attached. In this repository, "schema" means this value.
 *
 * Treated as read-only — nobody modifies it after it is built. So many places can
 * share the same value without contaminating each other.
 */
export interface Schema {
  /** The yt-dlp version this schema came from. */
  version: string;
  /** Which reflection it came from. */
  from: SchemaFrom;
  /** Every option, in the same order as {@linkcode RawSchema.options}. */
  opts: readonly Opt[];
  /** Option id → option. */
  byId: Readonly<Record<string, Opt>>;
  /** Stage id → stage. */
  stage: Readonly<Record<string, Stage>>;
  /** Every flag, including aliases, short and negated forms. The checker uses it to read strings back. */
  byFlag: Readonly<Record<string, FlagHit>>;
  /** The raw input it was built from. Used when `yt-studio types` has to write it out again. */
  raw: RawSchema;
}

/** A schema JSON that claims to be ours but can't be used — says what is wrong. */
export class SchemaError extends Error {
  /** Each problem found, as a path and what was expected (`options[3].aliases — 문자열 배열이어야 한다`). */
  readonly problems: string[];

  constructor(problems: string[]) {
    const shown = problems.slice(0, 5).join(' · ');
    const more = problems.length > 5 ? ` … ${problems.length - 5}개 더` : '';
    super(`스키마 모양이 맞지 않다 — ${shown}${more}`);
    this.name = 'SchemaError';
    this.problems = problems;
  }
}

const KINDS: readonly string[] = ['flag', 'value', 'choice', 'repeatable'] satisfies OptKind[];
const VALUE_TYPES: readonly unknown[] = ['string', 'int', 'float', 'choice', null];

/**
 * Checks that an unknown value has every field the code reads, and returns it as a {@linkcode RawSchema}.
 *
 * The code trusts the schema completely — `buildSchema` walks `aliases` and `stages`
 * without asking. So a half-right file used to die later as a `TypeError` naming
 * neither the file nor the field. Here every problem is collected at once.
 *
 * Fields added after the first schemas (`keys` · `rule` · `vocabs` · `valueType` ·
 * `keyed`) may be missing and read as `null`; a wrong type is still a problem.
 *
 * @throws {SchemaError} listing every problem found.
 */
export function checkRawSchema(v: unknown): RawSchema {
  const bad: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const isStrs = (x: unknown): boolean => Array.isArray(x) && x.every(s => typeof s === 'string');
  const need = (ok: boolean, at: string, what: string): void => { if (!ok) bad.push(`${at} — ${what}`); };
  const strOrNull = (x: unknown): boolean => x === null || typeof x === 'string';
  const later = (o: Record<string, unknown>, k: string, ok: (x: unknown) => boolean, at: string, what: string): void => {
    if (o[k] !== undefined) need(ok(o[k]), `${at}.${k}`, what);
  };

  if (!isObj(v)) throw new SchemaError(['(최상위) — 객체여야 한다']);
  need(typeof v.ytdlp_version === 'string', 'ytdlp_version', '문자열이어야 한다');
  need(v.source === undefined || v.source === 'optparse' || v.source === 'help', 'source', "'optparse' 나 'help' 여야 한다");

  if (!Array.isArray(v.stages)) bad.push('stages — 배열이어야 한다');
  else v.stages.forEach((s, i) => {
    const at = `stages[${i}]`;
    if (!isObj(s)) return void bad.push(`${at} — 객체여야 한다`);
    for (const k of ['id', 'label', 'blurb']) need(typeof s[k] === 'string', `${at}.${k}`, '문자열이어야 한다');
    need(isStrs(s.groups), `${at}.groups`, '문자열 배열이어야 한다');
  });

  if (!Array.isArray(v.options)) bad.push('options — 배열이어야 한다');
  else v.options.forEach((o, i) => {
    const at = `options[${i}]`;
    if (!isObj(o)) return void bad.push(`${at} — 객체여야 한다`);
    for (const k of ['id', 'flag', 'stage', 'group', 'help']) need(typeof o[k] === 'string', `${at}.${k}`, '문자열이어야 한다');
    for (const k of ['short', 'dest', 'metavar', 'negation']) need(strOrNull(o[k]), `${at}.${k}`, '문자열이나 null 이어야 한다');
    need(isStrs(o.aliases), `${at}.aliases`, '문자열 배열이어야 한다');
    need(KINDS.includes(o.kind as string), `${at}.kind`, `${KINDS.join(' · ')} 중 하나여야 한다`);
    need(o.choices === null || isStrs(o.choices), `${at}.choices`, '문자열 배열이나 null 이어야 한다');
    later(o, 'keys', x => x === null || isStrs(x), at, '문자열 배열이나 null 이어야 한다');
    later(o, 'rule', x => x === null || (isObj(x) && isStrs(x.vocab) && typeof x.from === 'boolean'), at,
      '{ vocab: 문자열 배열, from: boolean } 이나 null 이어야 한다');
    later(o, 'vocabs', x => x === null || (isObj(x) && Object.values(x).every(isStrs)), at,
      '문자열 배열을 값으로 갖는 객체나 null 이어야 한다');
    later(o, 'valueType', x => VALUE_TYPES.includes(x), at, "'string' · 'int' · 'float' · 'choice' · null 중 하나여야 한다");
    later(o, 'keyed', x => x === null || (isObj(x) && typeof x.pattern === 'string'
      && (x.defaults === null || isStrs(x.defaults)) && typeof x.multiple === 'boolean' && typeof x.append === 'boolean'), at,
      '{ pattern, defaults, multiple, append } 나 null 이어야 한다');
  });

  if (bad.length) throw new SchemaError(bad);
  return v as unknown as RawSchema;
}

/** Raw JSON → indexed schema. A pure function. */
export function buildSchema(raw: RawSchema): Schema {
  const opts = raw.options;
  const byFlag: Record<string, FlagHit> = {};

  for (const o of opts) {
    byFlag[o.flag] = { opt: o, negated: false };
    if (o.short) byFlag[o.short] = { opt: o, negated: false };
    for (const a of o.aliases) byFlag[a] = { opt: o, negated: false };
    if (o.negation) byFlag[o.negation] = { opt: o, negated: true };
  }

  return {
    version: raw.ytdlp_version,
    from: raw.source ?? 'optparse',
    opts,
    byId: Object.fromEntries(opts.map(o => [o.id, o])),
    stage: Object.fromEntries(raw.stages.map(s => [s.id, s])),
    byFlag,
    raw,
  };
}
