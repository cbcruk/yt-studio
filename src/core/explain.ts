/**
 * Turns a command back into plain language.
 *
 * Where the checker says "this is wrong", this says **"this is what it means"**.
 * A command from a prompt was not written by you but handed to you, so it has to
 * be readable before it is run. That is the only place in this flow where trust
 * is earned.
 *
 * - which option each token is and which stage it belongs to
 * - what the **filename** this command produces looks like
 * - what would naturally follow the current combination of options
 */

import { previewTemplate, parseTemplate, splitType } from './output-template.js';
import { splitEntry } from './paths.js';
import type { Opt, Schema } from './schema.js';
import type { Item } from './command.js';
import type { Values } from './lint.js';

/** The filename this command produces. If `-o` could not be read, `ok` is false and the original text comes back. */
export interface FilePreview {
  /** Whether `-o` was read. When false, `text` is the original text. */
  ok: boolean;
  /** The type prefix on `-o` (`thumbnail` in `thumbnail:`). */
  type: string;
  /** The filename. Fields are placeholders like `‹제목›`, prefixed with `-P home` when given. */
  text: string;
  /** True when there was no `-o` and yt-dlp's default template was used. */
  dflt?: boolean;
}

/** One token read as one line. */
export interface Explained {
  /** The kind of token — option, URL, or unreadable. */
  kind: Item['kind'];
  /** The text as written in the command (re-quoted). */
  text: string;
  /** One-line description. For an option it is yt-dlp's help, with `— 끄기` appended for the negated form. */
  ko: string;
  /** Option id. Present only for options. */
  id?: string;
  /** Lifecycle stage id (`format`, `store`, …). Present only for options. */
  stage?: string;
  /** Human-readable name of the stage. */
  stageLabel?: string;
  /** The value given to the option. `null` for flags that take no value. */
  value?: string | null;
}

/** One option worth adding next, and why. */
export interface Suggestion {
  /** The suggested option. */
  opt: Opt;
  /** Why it follows from the current command. One line. */
  why: string;
}

/** The output template yt-dlp uses when no -o is given. */
export const DEFAULT_OUTTMPL = '%(title)s [%(id)s].%(ext)s';

/**
 * The filename this command produces.
 *
 * Values are unknown, so fields become placeholders like ‹제목›. When -P home is
 * given it is prepended — "what lands where" should read as one line.
 */
export function previewFilename(values: Values): FilePreview {
  const rawOut = (Array.isArray(values.output) ? values.output[0] : values.output) as string | null;
  const { type, template } = splitType(rawOut || DEFAULT_OUTTMPL);
  let body: string;
  try { body = previewTemplate(parseTemplate(template)); }
  catch { return { ok: false, text: rawOut || DEFAULT_OUTTMPL, type }; }

  let home = '';
  if (values.paths) {
    for (const line of ([] as string[]).concat(values.paths as string | string[])) {
      const e = splitEntry(line);
      if (!e.type || e.type === 'home') home = e.path;
    }
  }
  const sep = home && !/[/\\]$/.test(home) ? '/' : '';
  return { ok: true, type, text: home + sep + body, dflt: !rawOut };
}

/** Describes one token in one line. */
export function explainItem(schema: Schema, it: Item): Explained {
  if (it.kind === 'url') return { kind: 'url', text: it.raw, ko: '받을 대상' };
  if (it.kind === 'unknown') return { kind: 'unknown', text: it.raw, ko: '읽지 못한 토큰' };
  const { opt, negated, value } = it;
  const help = (opt.help || '').replace(/\s+/g, ' ').trim();
  return {
    kind: 'opt',
    id: opt.id,
    text: it.raw,
    stage: opt.stage,
    stageLabel: schema.stage[opt.stage]?.label || opt.stage,
    value,
    ko: negated ? `${help} — 끄기` : help,
  };
}

/** Calls {@linkcode explainItem} for each item. */
export const explainCommand = (schema: Schema, items: Item[]): Explained[] =>
  items.map(it => explainItem(schema, it));

/**
 * Options that naturally follow the current combination.
 *
 * Not "any of the 191" but only **what the current command calls for**. With this
 * many options, laying down the next step instead of making people scan a list is
 * the only thing that works. The rules are written by hand — the schema has no
 * such neighbor relations.
 */
const RULES: { when: (v: Values) => unknown; ids: string[]; why: string }[] = [
  { when: v => v['extract-audio'], ids: ['audio-format', 'audio-quality', 'embed-thumbnail', 'embed-metadata'],
    why: '음원만 뽑을 때 대개 같이 준다' },
  { when: v => v['write-subs'] || v['write-auto-subs'], ids: ['sub-langs', 'embed-subs', 'sub-format'],
    why: '자막을 받을 때 이어지는 것' },
  { when: v => typeof v.format === 'string' && v.format.includes('+'), ids: ['merge-output-format'],
    why: '합칠 컨테이너를 정한다' },
  { when: v => v['download-sections'], ids: ['force-keyframes-at-cuts', 'split-chapters'],
    why: '구간을 자를 때 이어지는 것' },
  { when: v => v.output || v.paths, ids: ['restrict-filenames', 'windows-filenames', 'trim-filenames'],
    why: '파일명이 깨지는 걸 막는다' },
  { when: v => v.cookies || v['cookies-from-browser'], ids: ['sleep-requests', 'impersonate'],
    why: '로그인 상태로 긁을 때 차단을 덜 부른다' },
  { when: v => v['sponsorblock-remove'] || v['sponsorblock-mark'], ids: ['sponsorblock-chapter-title'],
    why: '표시 이름을 정한다' },
];

/** When no rule matches. A brand-new command should still have a next step. */
const STARTERS = ['format', 'output', 'paths', 'download-archive', 'embed-metadata'];

export function suggestNext(schema: Schema, values: Values, limit = 6): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (id: string, why: string): void => {
    const o = schema.byId[id];
    if (!o || id in values || out.some(x => x.opt.id === id)) return;
    out.push({ opt: o, why });
  };
  for (const r of RULES) { if (r.when(values)) r.ids.forEach(id => push(id, r.why)); }
  if (!out.length) STARTERS.forEach(id => push(id, '거의 모든 명령어가 결국 쓴다'));
  return out.slice(0, limit);
}
