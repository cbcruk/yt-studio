import { connectDevframe } from 'devframe/client';

import type { StandardSchemaV1 } from 'devframe/utils/simple-schema';

import type { checkResult, sourceResult } from '../src/node/schemas.ts';

type CheckResult = StandardSchemaV1.InferOutput<typeof checkResult>;
type SourceResult = StandardSchemaV1.InferOutput<typeof sourceResult>;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function main(): Promise<void> {
  const rpc = await connectDevframe();
  const call = rpc.call as (name: string, ...args: unknown[]) => Promise<unknown>;

  const src = (await call('ytstudio:source')) as SourceResult;
  $('source').textContent = `yt-dlp ${src.version} · ${src.from} · ${src.options} options${src.stale ? ' · stale' : ''}`;

  const cmd = $<HTMLTextAreaElement>('cmd');
  const run = async (): Promise<void> => {
    const r = (await call('ytstudio:check', cmd.value)) as CheckResult;
    $('file').textContent = `file: ${r.file.text}  ${r.ok ? '✓' : '✗'}`;
    $('issues').replaceChildren(...r.issues.map((i) => {
      const li = document.createElement('li');
      li.className = i.level;
      li.textContent = i.msg;
      return li;
    }));
    const ex = (await call('ytstudio:explain', cmd.value)) as { text: string; ko: string }[];
    $('explain').textContent = ex.map(e => `${e.text.padEnd(28)} ${e.ko}`).join('\n');
  };
  cmd.addEventListener('input', () => void run());
  await run();
}

main().catch((err: unknown) => {
  document.body.prepend(`failed: ${(err as Error).message}`);
});
