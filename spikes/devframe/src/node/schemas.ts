import { s } from 'devframe/utils/simple-schema';

/**
 * A yt-dlp command string that also advertises itself as JSON Schema.
 *
 * devframe's `s` helpers have no Standard JSON Schema converter, so the MCP
 * surface would otherwise describe this argument as an arbitrary object.
 */
export function commandArg(): ReturnType<typeof s.string> {
  const base = s.string();
  const jsonSchema = (): Record<string, unknown> => ({
    type: 'string',
    description: "A full yt-dlp command line, e.g. yt-dlp -f 'bv+ba' https://youtu.be/abc",
  });
  Object.assign(base['~standard'], { jsonSchema: { input: jsonSchema, output: jsonSchema } });
  return base;
}

const issue = s.object({
  level: s.picklist(['error', 'warn', 'info']),
  msg: s.string(),
  flag: s.optional(s.string()),
  opt: s.optional(s.string()),
  fixes: s.optional(s.array(s.string())),
});

const filePreview = s.object({
  ok: s.boolean(),
  type: s.string(),
  text: s.string(),
  dflt: s.optional(s.boolean()),
});

/** Verdict for one command string, including the filename it would produce. */
export const checkResult = s.object({
  ok: s.boolean(),
  issues: s.array(issue),
  urls: s.array(s.string()),
  file: filePreview,
  checkedAgainst: s.string(),
});

/** One token of a command read back as an option. */
export const explained = s.array(s.object({
  kind: s.string(),
  text: s.string(),
  ko: s.string(),
  id: s.optional(s.string()),
  stage: s.optional(s.string()),
  stageLabel: s.optional(s.string()),
  value: s.optional(s.nullable(s.string())),
}));

/** Which yt-dlp the checker compares against. */
export const sourceResult = s.object({
  from: s.string(),
  path: s.optional(s.string()),
  version: s.string(),
  typesVersion: s.string(),
  stale: s.boolean(),
  options: s.number(),
});
