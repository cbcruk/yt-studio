/**
 * Schema → type declarations for option methods.
 *
 * Two places do the same job, so it lives here.
 *
 * - `gen_options.ts`, when this repo is built — all 191 options as `Options`
 * - `yt-studio types`, in the user's environment — **only what differs from the
 *   bundle**, as an augmentation
 *
 * Both must emit the same names and the same signatures. With two sets of rules
 * you get slots where the type exists but the method doesn't — so `methodName`
 * also lives only here.
 *
 * This module imports nothing (types aside). The generator uses it, and if it
 * relied on generated output, the generator couldn't run when `options.gen.ts`
 * is missing.
 */
import { argType } from './arg-types.js';
import { NOTES } from './option-notes.js';
import type { Opt } from './schema.js';

/** `--embed-subs` → `embedSubs`. Short flags aren't used — code is meant to be read. */
export const methodName = (flag: string): string =>
  String(flag).replace(/^--?/, '').replace(/-+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `bv*` → `bvStar`. Inventing new names would make them impossible to look up in yt-dlp's docs. */
export const selMethod = (sel: string): string => sel.replace('*', 'Star');

/**
 * Makes help text safe to put inside JSDoc.
 *
 * If the closing marker comes through as-is, the comment ends right there — the
 * generator broke on that once.
 */
export const doc = (s: string): string =>
  String(s || '').replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim();

export const union = (xs: readonly string[]): string => xs.map(x => `'${x}'`).join(' | ');

/** `-f` · `-o` · `-P` · `--cookies-from-browser` take structured values, so their
 * signatures are hand-written in `build.ts`. The vocabulary still comes from the schema. */
export const HAND_WRITTEN = new Set(['format', 'output', 'paths', 'cookies-from-browser',
  'match-filters', 'break-match-filters', 'download-sections']);

/** Method declaration for one option, JSDoc included — this is the help autocomplete shows. */
export function optionMethod(o: Opt, extra?: string): string {
  const name = methodName(o.flag);
  const alias = [o.short, ...(o.aliases || [])].filter(Boolean);
  // If we have a short guide line, it goes first and yt-dlp's own text follows. The
  // original is the truth and ours is a signpost, hence the order. Without one,
  // only the original shows, as before.
  const note = NOTES[o.id];
  const head = `\`${o.flag}\`${alias.length ? ` (${alias.join(' · ')})` : ''}`;
  const lines = note
    ? ['  /**', `   * ${head} — ${doc(note)}`, '   *', `   * ${doc(o.help)}`, '   *',
      `   * @stage ${o.stage} · ${doc(o.group)}`]
    : ['  /**', `   * ${head} — ${doc(o.help)}`, '   *', `   * @stage ${o.stage} · ${doc(o.group)}`];
  if (o.negation) lines.push(`   * @remarks \`.${name}(false)\` → \`${o.negation}\``);
  if (extra) lines.push(`   * ${extra}`);
  lines.push('   */');

  lines.push(`  ${name}(${signature(o)}): this;`);
  return lines.join('\n');
}

/**
 * Type of the value taken.
 *
 * When the allowed values are fixed, it's that union instead of `Arg` — the list
 * is reflected from yt-dlp (`gen_schema.py`), not made up.
 *
 * `repeatable` options that have a list (`--compat-options` · `--sponsorblock-*`)
 * **can subtract an entry with a leading `-`** — turning everything on with `all`
 * and then removing a few is common usage. So the union includes the subtracted
 * forms too.
 */
function signature(o: Opt): string {
  if (o.kind === 'flag') return 'on?: boolean';

  // A grammar over a vocabulary (`aac>mp3/best`) must not be closed into a union — valid
  // values would become type errors. `| (string & {})` accepts any string while
  // **still surfacing the vocabulary in autocomplete**. The checker handles the grammar.
  if (o.rule) return `value: ${union(o.rule.vocab)} | (string & {})`;

  const one = o.choices?.length ? union(o.choices) : (argType(o) ?? 'Arg');
  if (o.kind !== 'repeatable') return `value: ${one}`;
  if (!o.choices?.length) return `...values: ${argType(o) ?? 'Arg'}[]`;
  return `...values: (${one} | \`-\${${one}}\`)[]`;
}

export interface EnvTypes {
  /** Version of the yt-dlp the user installed. */
  version: string;
  /** Options not in the bundle — these become methods. */
  added: Opt[];
  /** Options in the bundle that are gone — they can't be removed, so they only get struck through. */
  removed: Opt[];
}

/**
 * The `yt-studio-env.d.ts` file to drop in the project root.
 *
 * **The `import 'yt-studio'` at the top is mandatory.** Without it the file isn't a
 * module, so `declare module` becomes an **ambient declaration** rather than an
 * augmentation, and shadows the real package entirely
 * (`has no exported member 'ytdlp'`).
 *
 * Augmentation **only adds**. There's no way to delete a removed option, so it is
 * redeclared with the same signature plus `@deprecated` — the editor strikes it through.
 */
export function emitEnvTypes(e: EnvTypes): string {
  // optionMethod is indented 2 spaces for the top-level interface (Options). Here
  // it sits inside the augmentation block, one level deeper.
  const body = [
    ...e.added.filter(o => !HAND_WRITTEN.has(o.id)).map(o => optionMethod(o)),
    ...e.removed.filter(o => !HAND_WRITTEN.has(o.id)).map(o =>
      optionMethod(o, `@deprecated not an option in yt-dlp ${e.version}`)),
  ].map(m => m.split('\n').map(l => `  ${l}`).join('\n'));

  return `// Generated by \`yt-studio types\`. Do not edit by hand.
// yt-dlp ${e.version} · reflected from --help · added ${e.added.length} · removed ${e.removed.length}
//
// tsconfig.json's include must cover this file, or it is silently ignored.
import 'yt-studio';

declare module 'yt-studio' {
  interface Ytdlp {${body.length ? `\n${body.join('\n\n')}\n  ` : ''}}
}
`;
}
