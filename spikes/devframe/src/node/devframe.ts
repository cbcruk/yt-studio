import { fileURLToPath } from 'node:url';
import { defineDevframe } from 'devframe';

import { check, explain, source } from './rpc.ts';

/**
 * ytstudio as a devframe: one definition feeding a browser panel and an MCP server.
 *
 * The panel and the agent call the same three RPCs, so a human pasting a
 * command and a coding agent checking one see identical verdicts.
 */
export default defineDevframe({
  id: 'ytstudio',
  name: 'ytstudio',
  version: '0.0.0',
  packageName: 'ytstudio-devframe-spike',
  homepage: 'https://github.com/cbcruk/yt-studio',
  description: 'Check yt-dlp commands against the installed yt-dlp.',
  importMetaUrl: import.meta.url,
  clientAssets: fileURLToPath(new URL('../../dist/client', import.meta.url)),
  cli: {
    command: 'ytstudio-devframe',
    port: 9797,
    host: '127.0.0.1',
  },
  setup(ctx) {
    const rpc = ctx.scope('ytstudio').rpc;
    rpc.register(check);
    rpc.register(explain);
    rpc.register(source);
  },
});
