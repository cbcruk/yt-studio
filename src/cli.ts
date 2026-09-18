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
 *
 * Commands, flags, `--help` and `--version` come from `effect/unstable/cli` (#35).
 * Every way a command can end is a tagged failure, and {@linkcode exitOf} is the
 * one place those become exit codes — `process.exit` appears once, at the bottom.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Console, Data, Effect, FileSystem, Layer, Option, Path, Result, Stdio, Terminal } from 'effect';
import { Argument, CliConfig, CliError, CliOutput, Command, Flag, GlobalFlag } from 'effect/unstable/cli';
import { ChildProcessSpawner } from 'effect/unstable/process';

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

/** The schema couldn't be read — a broken `YT_STUDIO_SCHEMA` or local schema file. */
class SchemaUnreadable extends Data.TaggedError('SchemaUnreadable')<{ readonly reason: string }> {}

/**
 * Where the schema comes from — looked up once, kept as a value.
 *
 * It used to be decided at the top of the module as a throw, so a bad
 * `YT_STUDIO_SCHEMA` or a broken local schema printed a stack trace even for
 * `--help`, and blocked `yt-studio types` — the command that rewrites that very
 * file. Now a failure is only a value until a command that needs the schema asks.
 *
 * Only the failures {@linkcode resolveWith} declares become exit 2. A bug in the
 * reader still surfaces as a defect instead of looking like a broken schema file.
 */
const resolved = Effect.runSync(Effect.result(resolveWith({})));

let handle: Ytstudio | undefined;

/** The checker for this process. Fails when the schema can't be read. */
const yt: Effect.Effect<Ytstudio, SchemaUnreadable> = Effect.suspend(() => {
  if (handle) return Effect.succeed(handle);
  if (Result.isFailure(resolved)) return Effect.fail(new SchemaUnreadable({ reason: resolved.failure.message }));
  const { raw, source } = resolved.success;
  return Effect.succeed(handle = studio(raw, source));
});

/** One line on which schema was used. Without it, nobody knows what the verdict is a verdict about. */
function source(s: Ytstudio): string {
  const { from, path, version } = s.source;
  return `${from === 'bundled' ? '패키지 내장' : path} ${dim(`(yt-dlp ${version})`)}`;
}

/** Nothing to check — no arguments and nothing piped in. */
class NoCommand extends Data.TaggedError('NoCommand') {}
/** Standard input was there but couldn't be read. */
class StdinUnreadable extends Data.TaggedError('StdinUnreadable')<{ readonly cause: unknown }> {}

/**
 * The arguments if given, otherwise all of standard input.
 *
 * Without a pipe it doesn't read — typing a bare `yt-studio lint` in a terminal
 * would stall waiting for input. That looks broken.
 *
 * A failed read used to come back as `''` and be reported as "nothing to check",
 * hiding the cause. Now it is its own failure.
 */
const input = (args: readonly string[]): Effect.Effect<string, NoCommand | StdinUnreadable> => Effect.gen(function* () {
  const text = args.length ? args.join(' ')
    : process.stdin.isTTY ? ''
      : yield* Effect.try({ try: () => readFileSync(0, 'utf8').trim(), catch: cause => new StdinUnreadable({ cause }) });
  if (!text) return yield* new NoCommand();
  return text;
});

/**
 * Prints the check result in the order a person reads it.
 *
 * Most severe first (lint.js already returns them in that order), then the
 * filename it will produce, and a one-line verdict last. With errors present it
 * doesn't suggest next steps — telling someone to pile more onto something
 * wrong is noise.
 */
function report(s: Ytstudio, r: LintResult): void {
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
  console.log(`${dim('스키마')}    ${source(s)}`);

  // Suggest next steps only when there are no errors — suggesting on top of something wrong is noise
  if (!error) {
    const next = s.suggest(r.values).slice(0, 4);
    if (next.length) console.log(`${dim('이어서')}    ${next.map(s => s.opt.flag).join('  ')}`);
  }
}

/** Which option each token is. No checking — it only reads it back. */
function explain(s: Ytstudio, r: LintResult): void {
  for (const row of s.explain(r.items)) {
    const where = row.stageLabel ? dim(`  [${row.stageLabel}]`) : '';
    console.log(`${bold(row.text)}${where}\n    ${row.ko}`);
  }
}

/** The yt-dlp binary couldn't be run. */
class YtdlpFailed extends Data.TaggedError('YtdlpFailed')<{ readonly bin: string }> {}
/** The help parser lost too many options — its format has changed. */
class HelpUnreadable extends Data.TaggedError('HelpUnreadable')<{ readonly removed: number; readonly total: number }> {}
/** A generated file couldn't be written. */
class WriteFailed extends Data.TaggedError('WriteFailed')<{ readonly path: string; readonly cause: unknown }> {}

type TypesError = YtdlpFailed | HelpUnreadable | WriteFailed;

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
const typesWith = (bin: string): Effect.Effect<void, TypesError> => Effect.gen(function* () {
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
  try { text = readFileSync(path, 'utf8'); }
  catch (e) {
    // No tsconfig means nothing to warn about; one we can't read means we didn't check.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [`tsconfig.json 을 읽지 못해 include 를 확인하지 못했다 (${(e as Error).message})`];
  }

  // Without include, tsc's default covers everything. With one, eyeball it —
  // there is no intent to fully interpret tsconfig here (comments, extends, glob patterns).
  if (!/"include"\s*:/.test(text)) return [];
  const name = basename(dtsPath);
  if (text.includes(name)) return [];
  return [`tsconfig.json 의 include 가 ${name} 을 안 덮는 것 같다 — 안 덮으면 조용히 무시된다. include 에 "${name}" 을 넣을 것`];
}

/** `lint` · `explain` found errors. They are already printed — this only carries the exit code. */
class TargetInvalid extends Data.TaggedError('TargetInvalid')<{ readonly errors: number }> {}

type Failure = CliError.CliError | SchemaUnreadable | NoCommand | StdinUnreadable | TargetInvalid | TypesError;

/**
 * The one place a failure becomes an exit code and the lines explaining it.
 *
 * Three exit codes — 0 pass, 1 the intended job failed, 2 this CLI was called
 * wrong. Scripts need to tell "the target is wrong" apart from "the arguments
 * were wrong". That promise used to live in a comment above five scattered
 * `process.exit` calls; now the switch is exhaustive, so a new failure doesn't
 * compile until it has a code.
 */
function exitOf(e: Failure): { code: 0 | 1 | 2; lines: string[] } {
  // effect/cli has already printed help and the parse errors by the time it fails.
  // Help that was asked for is a success; help shown because of a mistake is not.
  if (CliError.isCliError(e)) return { code: e._tag === 'ShowHelp' && e.errors.length === 0 ? 0 : 2, lines: [] };
  switch (e._tag) {
    case 'SchemaUnreadable':
      return { code: 2, lines: [
        `${red('✗')} ${e.reason}`,
        dim('  YT_STUDIO_SCHEMA 나 작업 디렉터리의 yt-studio.schema.json 을 고치거나 지울 것 — yt-studio types 로 다시 뽑을 수 있다.'),
      ] };
    case 'NoCommand':
      return { code: 2, lines: ['검사할 명령어가 없다. 인자로 주거나 표준 입력으로 넣을 것.'] };
    case 'StdinUnreadable':
      return { code: 2, lines: [`${red('✗')} 표준 입력을 읽지 못했다 (${(e.cause as Error).message})`] };
    case 'TargetInvalid':
      return { code: 1, lines: [] };
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
 * effect/cli's parse errors, in Korean.
 *
 * This CLI's output is all Korean, yet the library's messages are English.
 * Split them by tag, and pass the rest through verbatim — better than making
 * something up.
 */
function errorKo(e: CliError.CliError): string {
  switch (e._tag) {
    case 'UnknownSubcommand': return `모르는 명령이다: ${e.subcommand}`;
    case 'UnrecognizedOption': return `모르는 옵션이다: ${e.option}`;
    case 'UnexpectedArgument': return `${e.arguments.join(' ')} — 이 명령은 인자를 안 받는다.`;
    case 'InvalidValue': return `--${e.option} 의 값이 없거나 틀렸다.`;
    default: return e.message;
  }
}

const formatter: CliOutput.Formatter = {
  ...CliOutput.defaultFormatter(),
  formatErrors: errors => errors.map(e => `${red('✗')} ${errorKo(e)}`).join('\n'),
};

/** Shows the root help and ends with 0 — for a bare `yt-studio` and `yt-studio help`. */
const showRootHelp = Effect.suspend(() => Effect.fail(new CliError.ShowHelp({ commandPath: ['yt-studio'], errors: [] })));

/** `lint` · `explain` read the rest of the line as one yt-dlp command. */
const commandText = Argument.String('명령어').pipe(
  Argument.variadic(),
  Argument.withDescription('검사할 yt-dlp 명령어. 없으면 표준 입력을 읽는다'),
);

/** Runs the checker, prints with `show`, and fails with {@linkcode TargetInvalid} if it found errors. */
const check = (show: (s: Ytstudio, r: LintResult) => void) =>
  ({ command }: { readonly command: readonly string[] }) => Effect.gen(function* () {
    const text = yield* input(command);
    const s = yield* yt;
    const r = s.lint(text);
    show(s, r);
    if (r.counts.error) return yield* new TargetInvalid({ errors: r.counts.error });
  });

const lint = Command.make('lint', { command: commandText }, check(report)).pipe(
  Command.withDescription('스키마와 문법에 어긋나는 곳을 찾는다. 오류가 있으면 1 로 끝난다'),
);

const explainCmd = Command.make('explain', { command: commandText }, check(explain)).pipe(
  Command.withDescription('토큰마다 무슨 옵션인지 말한다'),
);

const types = Command.make('types', {
  // Scanning arguments by hand used `indexOf('--yt-dlp')`, which couldn't find
  // `--yt-dlp=/path`, so it **silently dropped the path users gave** and looked
  // at PATH. The flag parser reads both forms and rejects unknown flags.
  bin: Flag.String('yt-dlp').pipe(
    Flag.optional,
    Flag.withMetavar('경로'),
    Flag.withDescription('PATH 가 아닌 자리의 yt-dlp'),
  ),
}, ({ bin }) => typesWith(Option.getOrElse(bin, () => 'yt-dlp'))).pipe(
  Command.withDescription('당신이 깐 yt-dlp 를 리플렉션해 스키마와 타입을 다시 뽑는다'),
);

const version = Command.make('version', {}, () => Effect.gen(function* () {
  const s = yield* yt;
  // Only the version goes to stdout — scripts read it as is.
  yield* Console.log(s.source.version);
  yield* Console.error(dim(`스키마  ${source(s)}`));
})).pipe(Command.withDescription('지금 대조하는 스키마의 yt-dlp 버전'));

const help = Command.make('help', {}, () => showRootHelp).pipe(Command.withDescription('이 도움말'));

// A schema that can't be read shows as `?` here; the command that needs it reports why.
const schemaVersion = Result.isSuccess(resolved) ? resolved.success.raw.ytdlp_version : '?';

const root = Command.make('yt-studio', {}, () => showRootHelp).pipe(
  // The formatter indents only the first line, so the rest carry their own two spaces.
  Command.withDescription([
    `설치된 yt-dlp(${schemaVersion}) 에 명령어를 대조한다.`,
    '',
    '명령어를 인자로 주거나 표준 입력으로 흘려 넣는다.',
    '',
    '기본은 패키지에 실린 스키마다 — 이 저장소를 구울 때의 yt-dlp 이지 당신 것이',
    '아니다. 당신 것에 맞추려면 yt-studio types 로 한 번 뽑아 두면 된다.',
    '작업 디렉터리의 yt-studio.schema.json 을 검증기가 먼저 본다. YT_STUDIO_SCHEMA 로',
    '다른 자리를 가리킬 수도 있다.',
  ].join('\n  ')),
  Command.withExamples([
    { command: "yt-studio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'", description: '명령어를 검사한다' },
    { command: 'pbpaste | yt-studio lint', description: '표준 입력으로 넣는다' },
    { command: 'yt-studio types --yt-dlp <경로>', description: '당신의 yt-dlp 로 스키마를 다시 뽑는다' },
  ]),
  Command.withSubcommands([lint, explainCmd, types, version, help]),
);

/**
 * What `lint` and `explain` see is the rest of the line, verbatim.
 *
 * `yt-studio lint yt-dlp -x https://…` without quotes used to work — the
 * arguments were joined. A flag parser would read `-x` as its own and fail, so a
 * `--` goes in after the command name. A lone `--help` still reaches the parser.
 */
function verbatim(argv: readonly string[]): readonly string[] {
  const [cmd, ...rest] = argv;
  if (cmd !== 'lint' && cmd !== 'explain') return argv;
  if (rest[0] === '--' || (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h'))) return argv;
  return [cmd, '--', ...rest];
}

const unused = (what: string) => Effect.die(`effect/cli 가 ${what} 를 쓰려 했다 — 이 CLI 는 그걸 주지 않는다`);

/**
 * The services effect/cli asks for, without `@effect/platform-node`.
 *
 * `Command.runWith` needs a file system, paths, a terminal, a process spawner
 * and stdio. This CLI uses none of them through Effect — it reads files with
 * `node:fs`, gets its arguments passed in, and never prompts (`--wizard` is off
 * for that reason). The real implementations live in another package with its
 * own dependencies; these stand-ins die if something ever reaches for them.
 */
const Services = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal, Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: unused('터미널 입력'),
    readLine: unused('터미널 입력'),
    display: () => unused('터미널 출력'),
  })),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => unused('자식 프로세스'))),
  CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions] }),
  CliOutput.layer(formatter),
);

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** The whole CLI as one program: arguments in, exit code out. Defects are not caught — they print as themselves. */
const main = (argv: readonly string[]): Effect.Effect<number> =>
  Command.runWith(root, { version: PACKAGE_VERSION })(verbatim(argv)).pipe(
    Effect.match({
      onSuccess: () => 0,
      onFailure: e => {
        const { code, lines } = exitOf(e);
        for (const line of lines) console.error(line);
        return code;
      },
    }),
    Effect.provide(Services),
  );

process.exit(Effect.runSync(main(process.argv.slice(2))));
