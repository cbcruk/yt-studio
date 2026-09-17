import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Demo page build.
 *
 * `base` is needed for the GitHub Pages `/<repo>/` subpath. When viewing locally with
 * `vite dev` it must be `/`, so an environment variable decides.
 *
 * Reads **only what the repo produced** — the compiled output in `lib/` and
 * `yt-studio.schema.json`. Reading `src/` directly would show the ingredients rather
 * than what users install, and keeping a hand-copied duplicate would make the demo
 * start lying from that moment on. Hence `bun run build` comes first.
 *
 * It is wired with an alias because it is a sibling directory. With
 * `"yt-studio": "file:.."` bun **copies the whole repo** in (minus the gitignored
 * `lib/`), which leaves out exactly what is needed, and the copy soon goes stale.
 */
export default defineConfig({
  base: process.env.DEMO_BASE ?? '/',
  resolve: {
    alias: { 'yt-studio/browser': at('../lib/browser.js') },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    // monaco's TypeScript worker is one big chunk, so it always trips the default
    // threshold (500KB). It is a lazily loaded worker, so it does not block first paint.
    chunkSizeWarningLimit: 8192,
  },
});
