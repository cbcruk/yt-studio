/**
 * The types the editor sees — **exactly the `.d.ts` the repo actually ships.**
 *
 * This is the point of the demo. The autocomplete list could have been written by hand
 * or rebuilt from the schema, but then the repo would have two `option catalog → types`
 * implementations, and two always diverge. Instead the `lib/**` that `tsc` emitted is
 * grabbed whole and fed as-is to the in-browser TypeScript. So autocomplete on this page
 * comes from the same files as in the editor of someone who ran `npm i yt-studio`.
 *
 * Read with `?raw`, so it is baked in as strings at build time — no runtime fetch.
 */
const DTS = import.meta.glob('../../lib/**/*.d.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** Turns it back into a path relative to the package (`lib/core/build.d.ts`). */
const rel = (p: string): string => `lib/${p.split('/lib/')[1]}`;

/**
 * Virtual `node_modules/yt-studio`.
 *
 * TypeScript in the browser finds modules the same way node does. So for
 * `import { ytdlp } from 'yt-studio'` to resolve, **there must be a package.json** — it
 * follows the `exports` map to `lib/index.d.ts`. The reason for writing a minimal one here
 * instead of copying the repo's is that the editor needs only the two type entry points.
 */
const PKG = JSON.stringify({
  name: 'yt-studio',
  version: '0.1.0',
  type: 'module',
  types: './lib/index.d.ts',
  exports: {
    '.': { types: './lib/index.d.ts', import: './lib/index.js' },
    './browser': { types: './lib/browser.d.ts', import: './lib/browser.js' },
  },
});

export interface Lib { path: string; content: string }

/** Files placed into the editor. The `file:///` path is the location in the virtual file system. */
export const libs: Lib[] = [
  { path: 'file:///node_modules/yt-studio/package.json', content: PKG },
  ...Object.entries(DTS).map(([p, content]) => ({
    path: `file:///node_modules/yt-studio/${rel(p)}`,
    content,
  })),
];
