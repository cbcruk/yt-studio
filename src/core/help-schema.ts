/**
 * `yt-dlp --help` → schema.
 *
 * `gen_schema.py` **imports yt-dlp as a Python module** and reads the optparse
 * tree. That is more accurate but mostly fails on users' machines —
 * `brew install yt-dlp`, the standalone binary and pipx all fail `import yt_dlp`.
 * So on the users' side we take the path that works with any install: ask the
 * binary for its help.
 *
 * Help is output for humans, with no stability guarantee. So this parser protects
 * itself in two ways.
 *
 * - **It uses the bundled schema as a baseline.** Options with the same name
 *   inherit what the help cannot give (`choices`, the remaining aliases, `dest`,
 *   whether it is `repeatable`). So the loss is confined **to new options**.
 * - **It refuses when too much disappears.** The worst outcome is a format change
 *   after which the parser extracts three options and reports success — every one
 *   of the users' flags becomes a typo. The caller decides; this returns the list
 *   of what disappeared.
 */
import type { Opt, OptKind, RawSchema, Stage } from './schema.js';

/**
 * Kinds of lines in the help.
 *
 * As of 2026.07.04, groups are indented 2 spaces, options 4, and continuation lines
 * of a description 36. To avoid depending on the description column (36),
 * continuation lines are recognized only as "heavily indented lines" — this
 * survives optparse moving the column.
 */
const GROUP = /^ {2}(\S.*?):\s*$/;
const OPTION = /^ {4}(-{1,2}\S(?:\S|[ ](?![ ]))*)(?:\s{2,}(.*))?\s*$/;
const CONT = /^ {8,}(\S.*?)\s*$/;

/** One `-I, --playlist-items ITEM_SPEC` line. Options without a long flag are not accepted. */
const DECL = /^(?:(-[^-,\s]),\s*)?(--[\w-]+)(?:[ =](.+))?$/;

/** `(Alias: --a, --b)` at the end of a help text. The only place the help reveals aliases. */
const ALIAS = /\(Alias:\s*([^)]+)\)/;

/** What was read straight from the help. Not a schema yet. */
interface Parsed {
  flag: string;
  short: string | null;
  metavar: string | null;
  group: string;
  help: string;
  aliases: string[];
}

/**
 * Tells whether a wrapped description should be rejoined without a space.
 *
 * optparse wraps descriptions with textwrap, which **does not break only at word
 * boundaries.** It also breaks at hyphens (`--convert-` / `subtitles)`), and when
 * a single word is longer than the width it cuts the word itself
 * (`…sponsor.ajay.a` / `pp/w/…`). Rejoining with plain spaces puts a space in the
 * middle of flag names and URLs.
 *
 * So lines are joined without a space in only two cases.
 *
 * - the previous line ends with a hyphen — it was broken at the hyphen
 * - the previous line fills the width, and the two pieces together are longer than
 *   the width — a word was cut
 *
 * The second condition needs "longer than the width" because most lines that fill
 * the width simply wrapped at a word (64 of 65 lines in this dump).
 */
function glued(prev: string, cur: string, width: number): boolean {
  if (prev.endsWith('-')) return true;
  if (prev.length < width) return false;
  const tail = prev.slice(prev.lastIndexOf(' ') + 1);
  const head = cur.split(' ')[0] ?? '';
  return tail.length + head.length > width;
}

/** Wrapped lines → one line. `width` is the text width measured over the whole help. */
function unwrap(parts: string[], width: number): string {
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!, cur = parts[i]!;
    out += (glued(prev, cur, width) ? '' : ' ') + cur;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `--no-foo`, `--yes-foo` → `['foo', 'no' | 'yes']`. Same rule as `gen_schema.py`. */
function baseName(flag: string): [string, 'no' | 'yes' | null] {
  const n = flag.replace(/^-+/, '');
  if (n.startsWith('no-')) return [n.slice(3), 'no'];
  if (n.startsWith('yes-')) return [n.slice(4), 'yes'];
  return [n, null];
}

/** Scans help lines and collects option declarations. */
function scan(help: string, width: number): Parsed[] {
  const out: Parsed[] = [];
  let group = '';
  let cur: { p: Parsed; lines: string[] } | null = null;

  const flush = (): void => {
    if (!cur) return;
    const text = unwrap(cur.lines, width);
    const m = ALIAS.exec(text);
    if (m) cur.p.aliases = m[1]!.split(/,\s*/).map(s => s.trim()).filter(s => s.startsWith('--'));
    cur.p.help = text;
    out.push(cur.p);
    cur = null;
  };

  for (const line of help.split('\n')) {
    const c = CONT.exec(line);
    if (c && cur) { cur.lines.push(c[1]!); continue; }

    const o = OPTION.exec(line);
    if (o) {
      flush();
      const d = DECL.exec(o[1]!.trim());
      // Skip lines without a long flag — gen_schema.py does the same
      if (!d) continue;
      cur = {
        p: {
          flag: d[2]!, short: d[1] ?? null, metavar: d[3]?.trim() ?? null,
          group, help: '', aliases: [],
        },
        lines: o[2] ? [o[2]] : [],
      };
      continue;
    }

    const g = GROUP.exec(line);
    if (g) { flush(); group = g[1]!; }
  }
  flush();
  return out;
}

/**
 * Folds `--foo` and `--no-foo` into one control.
 *
 * This is why the builder has no separate `.noPart()` — the schema holds
 * `--no-part` as the negation of `part`, so `.part(false)` is enough. Another
 * method would give the same option two names.
 */
function fold(list: Parsed[]): Array<Parsed & { negation: string | null }> {
  const byBase = new Map<string, Array<[Parsed, 'no' | 'yes' | null]>>();
  for (const p of list) {
    const [base, pol] = baseName(p.flag);
    const arr = byBase.get(base) ?? [];
    arr.push([p, pol]);
    byBase.set(base, arr);
  }

  const out: Array<Parsed & { negation: string | null }> = [];
  for (const arr of byBase.values()) {
    const pos = arr.filter(([, p]) => p === null).map(([o]) => o);
    const neg = arr.filter(([, p]) => p === 'no').map(([o]) => o);
    const yes = arr.filter(([, p]) => p === 'yes').map(([o]) => o);

    if (pos.length && (neg.length || yes.length)) {
      out.push({ ...pos[0]!, negation: (neg[0] ?? yes[0])!.flag });
    } else if (neg.length && yes.length) {
      // Both sides are prefixed forms, like --no-playlist / --yes-playlist
      out.push({ ...neg[0]!, negation: yes[0]!.flag });
    } else {
      for (const o of arr) out.push({ ...o[0], negation: null });
    }
  }
  return out;
}

/** Group name → stage. The bundled schema already holds the mapping as `stages[].groups`. */
function stageOf(stages: Stage[], group: string): string | null {
  for (const s of stages) if (s.groups.includes(group)) return s.id;
  return null;
}

/** Kind decided from the help alone. `value` if it takes a value, otherwise `flag`. */
function kindOf(metavar: string | null): OptKind {
  return metavar ? 'value' : 'flag';
}

export interface HelpResult {
  schema: RawSchema;
  /** Flags not in the bundle. */
  added: string[];
  /** Flags in the bundle but missing from the help. If this is large, the parser is broken. */
  removed: string[];
  /** Group names that map to no stage. New groups show up here. */
  unmappedGroups: string[];
}

/**
 * Turns one help dump into a schema.
 *
 * `base` is the schema shipped with the package. The stage mapping and the values
 * the help cannot give come from it — so that no copy has to be made.
 */
export function parseHelp(help: string, version: string, base: RawSchema): HelpResult {
  const known = new Map(base.options.map(o => [o.flag, o]));
  const unmapped = new Set<string>();

  // optparse decides the text width. Measuring the whole dump keeps up with format changes.
  let width = 0;
  for (const line of help.split('\n')) {
    const c = CONT.exec(line);
    if (c) width = Math.max(width, c[1]!.length);
  }

  const options: Opt[] = fold(scan(help, width)).map(p => {
    const prev = known.get(p.flag);
    const stage = prev?.stage ?? stageOf(base.stages, p.group);
    if (!stage) unmapped.add(p.group);

    const kind = kindOf(p.metavar);
    // The help reliably reveals neither choices nor "may be given several times".
    // As long as both agree it takes a value, trust the more detailed side (the bundle).
    const richer = prev && kind !== 'flag' && prev.kind !== 'flag' ? prev.kind : kind;

    return {
      id: p.flag.replace(/^-+/, ''),
      flag: p.flag,
      short: p.short ?? prev?.short ?? null,
      // The help reveals only 19 of 28 aliases via (Alias: …), and some of those
      // list only part of them (--convert-subs), so take the union — drop neither side.
      aliases: [...new Set([...(prev?.aliases ?? []), ...p.aliases])],
      // A new group has nowhere to go. Better to put it in the run stage and report it than to drop it
      stage: stage ?? base.stages[0]!.id,
      group: p.group,
      dest: prev?.dest ?? null,
      kind: richer,
      // Some options take no value yet carry a metavar in optparse
      // (--format-sort-force). It does not show in the help, so inherit it from the bundle.
      metavar: p.metavar ?? prev?.metavar ?? null,
      // Allowed values appear in the help only as prose — `(currently supported:
      // best (default), aac, …)` has nested parentheses and breaks when mined. As
      // long as both agree it takes a value, use the bundle's list as is.
      choices: prev && richer !== 'flag' ? prev.choices : null,
      keys: prev && richer !== 'flag' ? prev.keys : null,
      rule: prev && richer !== 'flag' ? prev.rule : null,
      vocabs: prev && richer !== 'flag' ? prev.vocabs : null,
      // The help does not show optparse's type. As long as both agree it takes a
      // value, use the bundle's; new options are treated as strings.
      valueType: prev && richer !== 'flag' ? prev.valueType : (richer === 'flag' ? null : 'string'),
      default: prev?.default ?? null,
      help: p.help,
      negation: p.negation,
    };
  });

  const order = base.stages.map(s => s.id);
  options.sort((a, b) =>
    order.indexOf(a.stage) - order.indexOf(b.stage) || a.id.localeCompare(b.id));

  const now = new Set(options.map(o => o.flag));
  return {
    schema: { ytdlp_version: version, source: 'help', stages: base.stages, options },
    added: options.filter(o => !known.has(o.flag)).map(o => o.flag),
    removed: base.options.filter(o => !now.has(o.flag)).map(o => o.flag),
    unmappedGroups: [...unmapped],
  };
}
