/**
 * User code → command → check → explanation.
 *
 * What runs on this page is **the real library**. `yt-studio/browser` never looks at
 * the file system, so it runs in the browser as-is, and the schema is the repo's
 * `yt-studio.schema.json` baked in at build time. So the commands and check results
 * shown here are the same as running the same code on node.
 *
 * Evaluation is `new Function` — it is the user's own code running in the user's own
 * browser, so no new risk arises. Nothing is sent to a server.
 */
import {
  studio, previewFilename, tokenize, quote, distance, DEFAULT_OUTTMPL,
} from 'yt-studio/browser';
import type { LintResult, Explained, FilePreview } from 'yt-studio/browser';
import raw from '../../yt-studio.schema.json';

/** What the demo checks against — the very schema the repo ships. */
export const yt = studio(raw as Parameters<typeof studio>[0]);

export interface Result {
  command: string;
  lint: LintResult;
  explained: Explained[];
  file: FilePreview;
}

/** Why the code did not make it to a command. Distinct from type errors — this happened while running. */
export class RunError extends Error {}

/**
 * Turns transpiled ESM into a body this page can call.
 *
 * `import` and `export` are syntax errors inside `new Function`. The shape the demo
 * encourages is fixed (one `import … from 'yt-studio'` line, one `export default`), so
 * only those two are rewritten. For any other shape, `evaluate` below says so.
 */
function toBody(js: string): string {
  return js
    .replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]yt-studio(?:\/browser)?['"];?\s*$/gm,
      (_m, clause: string) => `const ${clause.trim()} = __ytstudio;`)
    .replace(/^\s*export\s+default\s+/m, 'return ');
}

/** Can `.build()` be called on it? */
const buildable = (v: unknown): v is { build(): string } =>
  typeof (v as { build?: unknown } | null)?.build === 'function';

/**
 * Extracts one command.
 *
 * Exporting the builder as-is is fine (`export default ytdlp('…').extractAudio()`), and so
 * is a string that already called `.build()`. The former is shorter, so examples use it.
 */
export function evaluate(js: string): Result {
  const body = toBody(js);
  if (/^\s*(import|export)\s/m.test(body)) {
    throw new RunError('import 는 yt-studio 한 줄만, 내보내기는 export default 하나만 된다');
  }

  let value: unknown;
  try {
    value = new Function('__ytstudio', `"use strict";\n${body}`)(api);
  } catch (e) {
    throw new RunError(e instanceof Error ? e.message : String(e));
  }

  const command = buildable(value) ? value.build() : value;
  if (typeof command !== 'string' || !command) {
    throw new RunError('export default 로 빌더나 명령어 문자열을 내야 한다');
  }

  const lint = yt.lint(command);
  return {
    command,
    lint,
    explained: yt.explain(lint.items),
    file: previewFilename(lint.values),
  };
}

/** What enters user code under the name `yt-studio`. */
const api = {
  ytdlp: (...urls: string[]) => yt.ytdlp(...urls),
  lintCommand: (text: string) => yt.lint(text),
  scanCommand: (text: string) => yt.scan(text),
  explainCommand: (items: Parameters<typeof yt.explain>[0]) => yt.explain(items),
  suggestNext: (values: Parameters<typeof yt.suggest>[0], limit?: number) => yt.suggest(values, limit),
  nearestFlags: (flag: string, limit?: number) => yt.nearest(flag, limit),
  studio, previewFilename, tokenize, quote, distance, DEFAULT_OUTTMPL,
};
