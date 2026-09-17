#!/usr/bin/env node
/**
 * Checks commands from the terminal.
 *
 * Of what the browser app used to do, there was one thing **the library can't
 * do instead** — checking a command picked up from somewhere. Seen on a blog,
 * pasted by a colleague, or handed over by an LLM, it arrives as a string. The
 * builder only sees what was written with the builder.
 *
 * That job never needed a screen. A pipe is enough.
 *
 *     yt-studio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
 *     pbpaste | yt-studio lint
 *
 * It speaks through the exit code — 1 if there are errors. It drops straight
 * into CI or scripts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { Data, Effect } from 'effect';

import { bundledSchema, previewFilename, studio } from './index.js';
import { resolveWith } from './resolve.js';
import { emitEnvTypes } from './core/env-types.js';
import { parseHelp } from './core/help-schema.js';
import type { LintResult, Ytstudio } from './index.js';

// Colors are off when piped — color codes getting caught by grep is a nuisance.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n: number, s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

const MARK = { error: red('✗'), warn: yellow('!'), info: dim('·') };

let handle: Ytstudio | undefined;

/**
 * The schema this process checks against — decided once, on first use.
 *
 * It used to be decided at the top of the module, so a bad `YT_STUDIO_SCHEMA` or a
 * broken local schema printed a stack trace even for `--help`, and blocked
 * `yt-studio types` — the command that rewrites that very file.
 *
 * Only the failures {@linkcode resolveWith} declares become exit 2. It used to catch
 * everything, so a bug in the reader looked like a broken schema file.
 */
function yt(): Ytstudio {
  return (handle ??= Effect.runSync(resolveWith({}).pipe(Effect.match({
    onSuccess: ({ raw, source }) => studio(raw, source),
    onFailure: (e): never => {
      console.error(`${red('✗')} ${e.message}`);
      console.error(dim('  YT_STUDIO_SCHEMA 나 작업 디렉터리의 yt-studio.schema.json 을 고치거나 지울 것 — yt-studio types 로 다시 뽑을 수 있다.'));
      process.exit(2);
    },
  }))));
}

const help = (version: string): string => `yt-studio — 설치된 yt-dlp(${version}) 에 명령어를 대조한다

  yt-studio lint <명령어>       스키마와 문법에 어긋나는 곳을 찾는다
  yt-studio explain <명령어>    토큰마다 무슨 옵션인지 말한다
  yt-studio types               당신이 깐 yt-dlp 를 리플렉션해 스키마와 타입을 다시 뽑는다
  yt-studio version             지금 대조하는 스키마의 yt-dlp 버전

명령어를 인자로 주거나 표준 입력으로 흘려 넣는다.

  yt-studio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
  pbpaste | yt-studio lint

오류가 있으면 1 로 끝난다.

기본은 패키지에 실린 스키마다 — 이 저장소를 구울 때의 yt-dlp 이지 당신 것이
아니다. 당신 것에 맞추려면 한 번 뽑아 두면 된다.

  npx yt-studio types                    PATH 의 yt-dlp 를 읽는다
  npx yt-studio types --yt-dlp <경로>    다른 자리에 있으면

작업 디렉터리의 yt-studio.schema.json 을 검증기가 먼저 본다. YT_STUDIO_SCHEMA 로
다른 자리를 가리킬 수도 있다.`;

/** Help must show even when the schema is broken — that is when it's needed most. */
function helpText(): string {
  // A schema that can't be read shows as `?`; the command that needs it reports why.
  return help(Effect.runSync(resolveWith({}).pipe(Effect.match({
    onSuccess: ({ raw }) => raw.ytdlp_version,
    onFailure: () => '?',
  }))));
}

/** One line on which schema was used. Without it, nobody knows what the verdict is a verdict about. */
function source(): string {
  const { from, path, version } = yt().source;
  return `${from === 'bundled' ? '패키지 내장' : path} ${dim(`(yt-dlp ${version})`)}`;
}

/**
 * The arguments if given, otherwise all of standard input.
 *
 * Without a pipe it doesn't read — typing a bare `yt-studio lint` in a terminal
 * would stall waiting for input. That looks broken.
 */
function input(args: string[]): string {
  if (args.length) return args.join(' ');
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8').trim(); } catch { return ''; }
}

/**
 * Prints the check result in the order a person reads it.
 *
 * Most severe first (lint.js already returns them in that order), then the
 * filename it will produce, and a one-line verdict last. With errors present it
 * doesn't suggest next steps — telling someone to pile more onto something
 * wrong is noise.
 */
function report(r: LintResult): void {
  for (const i of r.issues) {
    console.log(`${MARK[i.level]} ${i.msg}`);
    if (i.fixes?.length) console.log(dim(`    → ${i.fixes.join('  ')}`));
  }

  const f = previewFilename(r.values);
  if (r.urls.length || Object.keys(r.values).length) {
    console.log(`\n${dim('만들 파일')}  ${f.text}${f.dflt ? dim('  (종류 없는 -o 없음, yt-dlp 기본값)') : ''}`);
  }

  const { error, warn, opts, total } = r.counts;
  const verdict = error ? red(`오류 ${error}개`)
    : warn ? yellow(`경고 ${warn}개`)
      : c(32, '확인됨');
  console.log(`${dim('판정')}      ${verdict} ${dim(`· 옵션 ${opts}개를 스키마 ${total}개와 대조`)}`);
  console.log(`${dim('스키마')}    ${source()}`);

  // Suggest next steps only when there are no errors — suggesting on top of something wrong is noise
  if (!error) {
    const next = yt().suggest(r.values).slice(0, 4);
    if (next.length) console.log(`${dim('이어서')}    ${next.map(s => s.opt.flag).join('  ')}`);
  }
}

/** Which option each token is. No checking — it only reads it back. */
function explain(r: LintResult): void {
  for (const row of yt().explain(r.items)) {
    const where = row.stageLabel ? dim(`  [${row.stageLabel}]`) : '';
    console.log(`${bold(row.text)}${where}\n    ${row.ko}`);
  }
}

/**
 * What `parseArgs` throws, in Korean.
 *
 * This CLI's output is all Korean, yet the messages Node throws leak out in
 * English. Split them by code, and pass unknown ones through verbatim — better
 * than making something up.
 */
function argError(e: unknown): string {
  const code = (e as { code?: string }).code;
  const msg = (e as Error).message;
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    return `모르는 옵션이다: ${/'([^']+)'/.exec(msg)?.[1] ?? msg}`;
  }
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return '--yt-dlp 뒤에 경로가 없다.';
  if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') return 'types 는 인자를 안 받는다.';
  return msg;
}

/** `types` was called wrong. */
class UsageError extends Data.TaggedError('UsageError')<{ readonly reason: string }> {}
/** The yt-dlp binary couldn't be run. */
class YtdlpFailed extends Data.TaggedError('YtdlpFailed')<{ readonly bin: string }> {}
/** The help parser lost too many options — its format has changed. */
class HelpUnreadable extends Data.TaggedError('HelpUnreadable')<{ readonly removed: number; readonly total: number }> {}
/** A generated file couldn't be written. */
class WriteFailed extends Data.TaggedError('WriteFailed')<{ readonly path: string; readonly cause: unknown }> {}

type TypesError = UsageError | YtdlpFailed | HelpUnreadable | WriteFailed;

/**
 * The one place a `types` failure becomes an exit code and the lines explaining it.
 *
 * The codes used to be `return 1` / `return 2` scattered through the command, and a
 * failed write had no code at all — it escaped as a stack trace. Now the switch is
 * exhaustive, so a new failure doesn't compile until it has a code.
 */
function typesFailure(e: TypesError): { code: 1 | 2; lines: string[] } {
  switch (e._tag) {
    case 'UsageError':
      return { code: 2, lines: [`${red('✗')} ${e.reason}`, dim('  쓰는 법: yt-studio types [--yt-dlp <경로>]')] };
    case 'YtdlpFailed':
      // Silently falling back to the bundled one would pretend to succeed while changing nothing
      return { code: 1, lines: [`${red('✗')} yt-dlp 를 실행하지 못했다: ${e.bin}`, dim('  PATH 에 없으면 --yt-dlp <경로> 로 가리킬 것.')] };
    case 'HelpUnreadable':
      return { code: 1, lines: [
        `${red('✗')} 도움말에서 옵션 ${e.removed}개가 사라졌다 (번들 ${e.total}개 중) — 파서가 이 서식을 못 읽는다`,
        dim('  아무것도 쓰지 않았다. 반쯤 쓴 스키마가 제일 나쁘다.'),
      ] };
    case 'WriteFailed':
      return { code: 1, lines: [`${red('✗')} ${e.path} 에 쓰지 못했다 (${(e.cause as Error).message})`] };
  }
}

/**
 * Reflects the yt-dlp users installed and regenerates the schema and types.
 *
 * The schema shipped with the package is the yt-dlp **this repo was built
 * with**. If users' is newer, new flags are flagged as nonexistent with exit 1
 * — wired into CI, that breaks someone else's build. This command removes that.
 *
 * It doesn't use the Python reflection (`gen_schema.py`) because that mostly
 * can't run in users' environments. `brew`, standalone binaries, and pipx all
 * fail on `import yt_dlp`.
 */
const typesWith = (args: string[]): Effect.Effect<void, TypesError> => Effect.gen(function* () {
  const bin = yield* Effect.try({
    // Scanning arguments by hand stopped here, and only here. `indexOf('--yt-dlp')`
    // couldn't find `--yt-dlp=/path`, so it **silently dropped the path users
    // gave** and looked at PATH — exactly the kind of failure this repo keeps
    // catching. Being strict, unknown flags are caught here too.
    try: () => parseArgs({
      args, strict: true, allowPositionals: false,
      options: { 'yt-dlp': { type: 'string' } },
    }).values['yt-dlp'] ?? 'yt-dlp',
    catch: e => new UsageError({ reason: argError(e) }),
  });

  const ask = (flag: string): Effect.Effect<string, YtdlpFailed> => Effect.try({
    try: () => execFileSync(bin, [flag], { encoding: 'utf8', maxBuffer: 8 << 20 }),
    catch: () => new YtdlpFailed({ bin }),
  });

  const version = (yield* ask('--version')).trim().split('\n')[0]!.trim();   // split always returns at least one
  const help = yield* ask('--help');

  const bundled = bundledSchema();
  const r = parseHelp(help, version, bundled);

  // Help is output meant for people, so its format can change. A broken parser
  // extracts only a few and reports success — and then every one of users'
  // flags becomes a typo.
  if (r.removed.length / bundled.options.length > 0.2) {
    return yield* new HelpUnreadable({ removed: r.removed.length, total: bundled.options.length });
  }

  const byFlag = new Map(bundled.options.map(o => [o.flag, o]));
  const next = new Map(r.schema.options.map(o => [o.flag, o]));
  const dts = emitEnvTypes({
    version,
    added: r.added.map(f => next.get(f)!),
    removed: r.removed.map(f => byFlag.get(f)!),
  });

  const schemaPath = resolve(process.cwd(), 'yt-studio.schema.json');
  const dtsPath = resolve(process.cwd(), 'yt-studio-env.d.ts');
  // Write beside the target, then rename. An interrupted write used to leave half a
  // schema under our file name — now the old file stays until the new one is whole.
  const put = (path: string, text: string): Effect.Effect<void, WriteFailed> => Effect.try({
    try: () => {
      writeFileSync(`${path}.tmp`, text);
      renameSync(`${path}.tmp`, path);
    },
    catch: cause => new WriteFailed({ path, cause }),
  });
  yield* put(schemaPath, `${JSON.stringify(r.schema, null, 1)}\n`);
  yield* put(dtsPath, dts);

  console.log(`${dim('읽음')}      ${bin} ${dim(`(yt-dlp ${version}) · --help 파싱`)}`);
  console.log(`${dim('옵션')}      ${r.schema.options.length}개 ${dim(`· 새로 ${r.added.length} · 사라짐 ${r.removed.length} (번들 ${bundled.options.length} 대비)`)}`);
  console.log(`${dim('씀')}        ${basename(schemaPath)} · ${basename(dtsPath)}`);
  if (r.added.length) console.log(`${dim('새 옵션')}   ${r.added.slice(0, 6).join('  ')}${r.added.length > 6 ? dim(` … ${r.added.length - 6}개 더`) : ''}`);
  if (r.unmappedGroups.length) {
    console.log(`${yellow('!')} 처음 보는 그룹이라 실행 단계에 뒀다: ${r.unmappedGroups.join(' · ')}`);
  }
  for (const w of tsconfigWarnings(dtsPath)) console.log(`${yellow('!')} ${w}`);
});

/** Runs `types` and returns its exit code. Defects are not caught — they print as themselves. */
function types(args: string[]): number {
  return Effect.runSync(typesWith(args).pipe(Effect.match({
    onSuccess: () => 0,
    onFailure: e => {
      const { code, lines } = typesFailure(e);
      for (const line of lines) console.error(line);
      return code;
    },
  })));
}

/**
 * If the generated `.d.ts` isn't covered by `include` in users' tsconfig, it is
 * **silently ignored.**
 *
 * The file exists but autocomplete doesn't grow. Users think this tool is
 * broken rather than suspecting their `include` — the same kind of thing the
 * checker has done from the start, so it says so here too. It doesn't fix it.
 * That is someone else's build config.
 */
function tsconfigWarnings(dtsPath: string): string[] {
  const path = resolve(process.cwd(), 'tsconfig.json');
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }

  // Without include, tsc's default covers everything. With one, eyeball it —
  // there is no intent to fully interpret tsconfig here (comments, extends, glob patterns).
  if (!/"include"\s*:/.test(text)) return [];
  const name = basename(dtsPath);
  if (text.includes(name)) return [];
  return [`tsconfig.json 의 include 가 ${name} 을 안 덮는 것 같다 — 안 덮으면 조용히 무시된다. include 에 "${name}" 을 넣을 것`];
}

// Three exit codes — 0 pass, 1 the intended job failed, 2 this CLI was called wrong.
// Scripts need to tell "the target is wrong" apart from "the arguments were wrong".
const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(helpText());
  process.exit(0);
}
if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  // Only the version goes to stdout — scripts read it as is.
  console.log(yt().source.version);
  console.error(dim(`스키마  ${source()}`));
  process.exit(0);
}
if (cmd === 'types') process.exit(types(rest));

if (cmd !== 'lint' && cmd !== 'explain') {
  console.error(`모르는 명령이다: ${cmd}\n\n${helpText()}`);
  process.exit(2);
}

const text = input(rest);
if (!text) {
  console.error('검사할 명령어가 없다. 인자로 주거나 표준 입력으로 넣을 것.');
  process.exit(2);
}

const result = yt().lint(text);
if (cmd === 'explain') explain(result);
else report(result);

process.exit(result.counts.error ? 1 : 0);
