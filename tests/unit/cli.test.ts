/**
 * What the CLI **says**, without starting a process.
 *
 * `main(argv)` returns the exit code, and every line it says goes through Effect's
 * `Console` — both ours and the ones `effect/cli` prints for help and parse errors.
 * `Console` is a service, so swapping it here collects that text as a value.
 *
 * `cli.test.ts` keeps what only a process shows — that the code actually reaches
 * the shell, pipes, color, and that the built `lib/` runs on node. Those cost about
 * 100ms each; these cost nothing.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ConfigProvider, Console, Effect } from 'effect';

// Color is decided when the module loads, so this has to come first.
process.env.NO_COLOR = '1';
const { main } = await import('../../src/cli-main.js');

interface Said {
  code: number;
  /** stdout — the answer. */
  out: string;
  /** stderr — why it failed. */
  err: string;
}

/**
 * Runs the CLI in this process and collects what it said.
 *
 * `env` goes in as a `ConfigProvider` rather than by touching `process.env` — the
 * default provider reads the environment once, and every test in this file shares
 * the process.
 */
async function run(argv: string[], env: Record<string, string> = {}): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  const capture: Console.Console = Object.assign(Object.create(console), {
    log: (...args: unknown[]) => { out.push(args.join(' ')); },
    error: (...args: unknown[]) => { err.push(args.join(' ')); },
  });
  const code = await Effect.runPromise(main(argv).pipe(
    Effect.provideService(Console.Console, capture),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: { ...process.env as Record<string, string>, ...env } })),
  ));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('인자 없이 부르면 쓰는 법을 낸다', async () => {
  const r = await run([]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /yt-studio lint/);
  assert.match(r.out, /pbpaste \| yt-studio lint/);
});

test('모르는 명령은 2 로 끝나고 무엇이 틀렸는지 말한다', async () => {
  const r = await run(['nope']);
  assert.equal(r.code, 2);
  assert.match(r.err, /모르는 명령이다: nope/);
});

test('types 에 모르는 옵션을 주면 2 로 끝난다', async () => {
  const r = await run(['types', '--bogus']);
  assert.equal(r.code, 2);
  assert.match(r.err, /모르는 옵션이다: --bogus/);
});

// What it says per token is covered by unit/explain.test.ts. Here we only check that
// the subcommand is wired up and emits one chunk per token.
test('explain 은 토큰마다 한 덩이씩 낸다', async () => {
  const r = await run(['explain', 'yt-dlp -x --no-part https://youtu.be/abc']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split('\n').filter(l => l.startsWith('    ')).length, 3, r.out);
});

test('맞는 명령어는 확인됨으로 끝나고, 무엇에 대조했는지 적는다', async () => {
  const r = await run(['lint', 'yt-dlp -f "bv[height<=1080]+ba/b" -o "%(title)s.%(ext)s" https://youtu.be/abc']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /확인됨/);
  // A verdict without what it was checked against is unreadable.
  assert.match(r.out, /스키마 {4}.*yt-dlp \d{4}\.\d{2}\.\d{2}/);
});

test('없는 플래그는 오류로 세고 1 로 끝난다', async () => {
  const r = await run(['lint', 'yt-dlp --write-sub https://youtu.be/abc']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--write-sub 는 이 yt-dlp 버전에 없는/);
  assert.match(r.out, /오류 1개/);
});

test('제한 시간 환경변수가 틀리면 2 로 끝난다', async () => {
  const r = await run(['types', '--yt-dlp', '/nope/yt-dlp'], { YT_STUDIO_YTDLP_TIMEOUT: 'soon' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /YT_STUDIO_YTDLP_TIMEOUT/);
});

// A bug in yt-studio is not a wrong command. Scripts read 1 as "the command is
// wrong", so a crash used to look like a verdict.
test('결함은 70 으로 끝나고 버그라고 말한다', async () => {
  const said: string[] = [];
  const broken: Console.Console = Object.assign(Object.create(console), {
    log: () => { throw new TypeError('심어 둔 버그'); },
    error: (...args: unknown[]) => { said.push(args.join(' ')); },
  });
  const code = await Effect.runPromise(main(['lint', 'yt-dlp -x https://youtu.be/abc']).pipe(
    Effect.provideService(Console.Console, broken),
  ));
  assert.equal(code, 70);
  const out = said.join('\n');
  assert.match(out, /yt-studio 의 버그다/);
  assert.match(out, /심어 둔 버그/, '스택을 함께 내야 버그를 고칠 수 있다');
});
