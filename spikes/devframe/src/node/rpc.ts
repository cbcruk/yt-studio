import { defineRpcFunction } from 'devframe';

import { previewFilename, ytstudio } from '../../../../lib/index.js';
import { checkResult, commandArg, explained, sourceResult } from './schemas.ts';

const yt = ytstudio();

export const check = defineRpcFunction({
  name: 'check',
  type: 'query',
  jsonSerializable: true,
  args: [commandArg()],
  returns: checkResult,
  agent: {
    title: 'Check a yt-dlp command',
    description:
      'Check a yt-dlp command string against the installed yt-dlp schema: unknown flags, bad -f/-o grammar, conflicting options, and the filename it will produce. Call this before suggesting or running any yt-dlp command; do not rely on memory for flag names.',
    safety: 'read',
  },
  handler: (command) => {
    const r = yt.lint(command);
    return {
      ok: r.ok,
      issues: r.issues,
      urls: r.urls,
      file: previewFilename(r.values),
      checkedAgainst: `yt-dlp ${yt.source.version} (${yt.source.from})`,
    };
  },
});

export const explain = defineRpcFunction({
  name: 'explain',
  type: 'query',
  jsonSerializable: true,
  args: [commandArg()],
  returns: explained,
  agent: {
    title: 'Explain a yt-dlp command',
    description:
      'Explain each token of a yt-dlp command: which option it is, which processing stage it belongs to, and its value. Use when a user asks what an existing command does.',
    safety: 'read',
  },
  handler: command => yt.explain(yt.scan(command).items),
});

export const source = defineRpcFunction({
  name: 'source',
  type: 'static',
  jsonSerializable: true,
  args: [],
  returns: sourceResult,
  agent: {
    title: 'Active yt-dlp schema',
    description:
      'Report which yt-dlp version the checker compares against and whether it drifted from the bundled types. Call when a check result looks outdated.',
    safety: 'read',
  },
  handler: () => ({ ...yt.source, options: yt.schema.opts.length }),
});
