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
 *
 * Exit codes: 0 pass · 1 the target is wrong · 2 this CLI was called wrong ·
 * 70 a bug in yt-studio itself (`EX_SOFTWARE`).
 *
 * **Nothing here writes to the screen directly.** Commands return the lines they
 * want said, and {@linkcode main} says them through Effect's `Console` — a service,
 * so a test can swap it and read what this CLI said without starting a process.
 * `src/cli.ts` is the executable: it runs {@linkcode main} and exits with its code.
 */
import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Config, Console, Context, Data, Duration, Effect, FileSystem, Layer, Option, Path, Stdio, Terminal } from 'effect';
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

/**
 * Says a block of lines on stdout, or nothing at all when there are none.
 *
 * One call per block rather than one per line — `Console` is a service, and a test
 * reading it back sees the same text either way, but the block keeps the lines
 * together when two commands say something at once.
 */
const say = (lines: readonly string[]): Effect.Effect<void> =>
  lines.length ? Console.log(lines.join('\n')) : Effect.void;

/** Same, on stderr. */
const complain = (lines: readonly string[]): Effect.Effect<void> =>
  lines.length ? Console.error(lines.join('\n')) : Effect.void;

/** The schema couldn't be read — a broken `YT_STUDIO_SCHEMA` or local schema file. */
class SchemaUnreadable extends Data.TaggedError('SchemaUnreadable')<{ readonly reason: string }> {}

/** The checker the commands check against. */
class Studio extends Context.Service<Studio, Ytstudio>()('yt-studio/cli/Studio') {}

/**
 * Finds the schema and builds the checker — only for commands that ask for it.
 *
 * It used to be decided at the top of the module, so a bad `YT_STUDIO_SCHEMA` or a
 * broken local schema took down `--help` and `yt-studio types` — the command that
 * rewrites that very file. As a layer given only to `lint` · `explain` · `version`
 * ({@linkcode Command.provide}), it is built when one of those runs and never otherwise.
 *
 * Only the failures {@linkcode resolveWith} declares become exit 2. A bug in the
 * reader still surfaces as a defect instead of looking like a broken schema file.
 */
const StudioLive = Layer.effect(Studio, resolveWith({}).pipe(
  Effect.map(({ raw, source }) => studio(raw, source)),
  Effect.mapError(e => new SchemaUnreadable({ reason: e.message })),
));

/** An error's message, for a thrown value we know nothing about. */
const reasonOf = (u: unknown): string => (u instanceof Error ? u.message : String(u));

/** One line on which schema was used. Without it, nobody knows what the verdict is a verdict about. */
function source(s: Ytstudio): string {
  const { from, path, version } = s.source;
  return `${from === 'bundled' ? '패키지 내장' : path} ${dim(`(yt-dlp ${version})`)}`;
}

/** Nothing to check — no arguments and nothing piped in. */
class NoCommand extends Data.TaggedError('NoCommand') {}
/** Standard input was there but couldn't be read. */
class StdinUnreadable extends Data.TaggedError('StdinUnreadable')<{ readonly reason: string }> {}

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
      : yield* Effect.try({ try: () => readFileSync(0, 'utf8').trim(), catch: e => new StdinUnreadable({ reason: reasonOf(e) }) });
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
function report(s: Ytstudio, r: LintResult): string[] {
  const lines: string[] = [];
  for (const i of r.issues) {
    lines.push(`${MARK[i.level]} ${i.msg}`);
    if (i.fixes?.length) lines.push(dim(`    → ${i.fixes.join('  ')}`));
  }

  const f = previewFilename(r.values);
  if (r.urls.length || Object.keys(r.values).length) {
    lines.push(`\n${dim('만들 파일')}  ${f.text}${f.dflt ? dim('  (종류 없는 -o 없음, yt-dlp 기본값)') : ''}`);
  }

  const { error, warn, opts, total } = r.counts;
  const verdict = error ? red(`오류 ${error}개`)
    : warn ? yellow(`경고 ${warn}개`)
      : c(32, '확인됨');
  lines.push(`${dim('판정')}      ${verdict} ${dim(`· 옵션 ${opts}개를 스키마 ${total}개와 대조`)}`);
  lines.push(`${dim('스키마')}    ${source(s)}`);

  // Suggest next steps only when there are no errors — suggesting on top of something wrong is noise
  if (!error) {
    const next = s.suggest(r.values).slice(0, 4);
    if (next.length) lines.push(`${dim('이어서')}    ${next.map(s => s.opt.flag).join('  ')}`);
  }
  return lines;
}

/** Which option each token is. No checking — it only reads it back. */
function explain(s: Ytstudio, r: LintResult): string[] {
  return s.explain(r.items).map(row => {
    const where = row.stageLabel ? dim(`  [${row.stageLabel}]`) : '';
    return `${bold(row.text)}${where}\n    ${row.ko}`;
  });
}

/** The yt-dlp binary couldn't be started — not on PATH, not executable, or `--yt-dlp` points at nothing. */
class YtdlpNotRunnable extends Data.TaggedError('YtdlpNotRunnable')<{ readonly bin: string }> {}
/** yt-dlp started but exited with an error — a broken Python install is the usual one. */
class YtdlpFailed extends Data.TaggedError('YtdlpFailed')<{ readonly bin: string; readonly stderr: string }> {}
/** yt-dlp didn't answer within {@linkcode askTimeout}. */
class YtdlpTimeout extends Data.TaggedError('YtdlpTimeout')<{ readonly bin: string; readonly flag: string; readonly after: Duration.Duration }> {}
/** An environment variable this CLI reads has a value it can't use. */
class BadEnv extends Data.TaggedError('BadEnv')<{ readonly name: string; readonly reason: string }> {}
/** The help parser lost too many options — its format has changed. */
class HelpUnreadable extends Data.TaggedError('HelpUnreadable')<{ readonly removed: number; readonly total: number }> {}
/** A generated file couldn't be written. */
class WriteFailed extends Data.TaggedError('WriteFailed')<{ readonly path: string; readonly reason: string }> {}

type TypesError = YtdlpNotRunnable | YtdlpFailed | YtdlpTimeout | HelpUnreadable | WriteFailed | BadEnv;

/**
 * How long one `yt-dlp --version` / `--help` may take — `YT_STUDIO_YTDLP_TIMEOUT`, 60 seconds by default.
 *
 * Both answer in well under a second, but a standalone (PyInstaller) binary
 * unpacks itself on a cold start. A hung one used to block `types` forever.
 * The variable exists mostly so the timeout can be tested without waiting a minute.
 */
const askTimeout: Effect.Effect<Duration.Duration, BadEnv> = Config.Duration('YT_STUDIO_YTDLP_TIMEOUT').pipe(
  Config.withDefault(Duration.seconds(60)),
  // The ConfigError text is a schema dump; what the user needs is the expected shape.
  Effect.mapError(() => new BadEnv({ name: 'YT_STUDIO_YTDLP_TIMEOUT', reason: '"30 seconds" · "500 millis" 같은 길이여야 한다' })),
);

/**
 * Runs `yt-dlp <flag>` and returns its stdout.
 *
 * Every failure used to collapse into "couldn't run yt-dlp — point at it with
 * --yt-dlp", even when yt-dlp was right there and its Python was what broke.
 * Now "not there", "ran and failed" and "didn't answer" are three failures, and
 * the second one shows what yt-dlp said.
 */
const ask = (bin: string, flag: string, after: Duration.Duration): Effect.Effect<string, YtdlpNotRunnable | YtdlpFailed | YtdlpTimeout> =>
  Effect.callback<string, YtdlpNotRunnable | YtdlpFailed>(resume => {
    const child = execFile(bin, [flag], { encoding: 'utf8', maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (!err) return resume(Effect.succeed(stdout));
      // A string code is a spawn failure (ENOENT, EACCES); a number is yt-dlp's own exit code.
      resume(Effect.fail(typeof err.code === 'string'
        ? new YtdlpNotRunnable({ bin })
        : new YtdlpFailed({ bin, stderr })));
    });
    // Interrupted — the timeout below — so don't leave the process behind. This
    // reaches only the process we started: if `--yt-dlp` points at a wrapper script,
    // whatever the script started keeps running until it finishes on its own.
    return Effect.sync(() => { child.kill(); });
  }).pipe(Effect.timeoutOrElse({
    duration: after,
    orElse: () => Effect.fail(new YtdlpTimeout({ bin, flag, after })),
  }));

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
  const after = yield* askTimeout;
  const version = (yield* ask(bin, '--version', after)).trim().split('\n')[0]!.trim();   // split always returns at least one
  const help = yield* ask(bin, '--help', after);

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
    catch: e => new WriteFailed({ path, reason: reasonOf(e) }),
  });
  yield* put(schemaPath, `${JSON.stringify(r.schema, null, 1)}\n`);
  yield* put(dtsPath, dts);

  const lines = [
    `${dim('읽음')}      ${bin} ${dim(`(yt-dlp ${version}) · --help 파싱`)}`,
    `${dim('옵션')}      ${r.schema.options.length}개 ${dim(`· 새로 ${r.added.length} · 사라짐 ${r.removed.length} (번들 ${bundled.options.length} 대비)`)}`,
    `${dim('씀')}        ${basename(schemaPath)} · ${basename(dtsPath)}`,
  ];
  if (r.added.length) lines.push(`${dim('새 옵션')}   ${r.added.slice(0, 6).join('  ')}${r.added.length > 6 ? dim(` … ${r.added.length - 6}개 더`) : ''}`);
  if (r.unmappedGroups.length) {
    lines.push(`${yellow('!')} 처음 보는 그룹이라 실행 단계에 뒀다: ${r.unmappedGroups.join(' · ')}`);
  }
  for (const w of tsconfigWarnings(dtsPath)) lines.push(`${yellow('!')} ${w}`);
  yield* say(lines);
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
    return [`tsconfig.json 을 읽지 못해 include 를 확인하지 못했다 (${reasonOf(e)})`];
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
 * Three exit codes for failures — 0 pass, 1 the intended job failed, 2 this CLI
 * was called wrong. (Defects are not failures; {@linkcode main} gives them 70.) Scripts need to tell "the target is wrong" apart from "the arguments
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
      return { code: 2, lines: [`${red('✗')} 표준 입력을 읽지 못했다 (${e.reason})`] };
    case 'TargetInvalid':
      return { code: 1, lines: [] };
    // Silently falling back to the bundled one would pretend to succeed while changing nothing
    case 'YtdlpNotRunnable':
      return { code: 1, lines: [`${red('✗')} yt-dlp 를 실행하지 못했다: ${e.bin}`, dim('  PATH 에 없으면 --yt-dlp <경로> 로 가리킬 것.')] };
    case 'YtdlpFailed': {
      const said = e.stderr.trim().split('\n').filter(Boolean).slice(-3);
      return { code: 1, lines: [`${red('✗')} yt-dlp 가 실패했다: ${e.bin}`, ...said.map(l => dim(`  ${l}`))] };
    }
    case 'YtdlpTimeout':
      return { code: 1, lines: [`${red('✗')} yt-dlp 가 ${Duration.format(e.after)} 안에 답하지 않았다: ${e.bin} ${e.flag}`] };
    case 'BadEnv':
      return { code: 2, lines: [`${red('✗')} ${e.name} 의 값을 쓸 수 없다 (${e.reason})`] };
    case 'HelpUnreadable':
      return { code: 1, lines: [
        `${red('✗')} 도움말에서 옵션 ${e.removed}개가 사라졌다 (번들 ${e.total}개 중) — 파서가 이 서식을 못 읽는다`,
        dim('  아무것도 쓰지 않았다. 반쯤 쓴 스키마가 제일 나쁘다.'),
      ] };
    case 'WriteFailed':
      return { code: 1, lines: [`${red('✗')} ${e.path} 에 쓰지 못했다 (${e.reason})`] };
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

/** Runs the checker, says what `show` made of the result, and fails with {@linkcode TargetInvalid} if it found errors. */
const check = (show: (s: Ytstudio, r: LintResult) => string[]) =>
  ({ command }: { readonly command: readonly string[] }) => Effect.gen(function* () {
    const text = yield* input(command);
    const s = yield* Studio;
    const r = s.lint(text);
    yield* say(show(s, r));
    if (r.counts.error) return yield* new TargetInvalid({ errors: r.counts.error });
  });

const lint = Command.make('lint', { command: commandText }, check(report)).pipe(
  Command.withDescription('스키마와 문법에 어긋나는 곳을 찾는다. 오류가 있으면 1 로 끝난다'),
  Command.provide(StudioLive),
);

const explainCmd = Command.make('explain', { command: commandText }, check(explain)).pipe(
  Command.withDescription('토큰마다 무슨 옵션인지 말한다'),
  Command.provide(StudioLive),
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
  const s = yield* Studio;
  // Only the version goes to stdout — scripts read it as is.
  yield* Console.log(s.source.version);
  yield* Console.error(dim(`스키마  ${source(s)}`));
})).pipe(
  Command.withDescription('지금 대조하는 스키마의 yt-dlp 버전'),
  Command.provide(StudioLive),
);

const help = Command.make('help', {}, () => showRootHelp).pipe(Command.withDescription('이 도움말'));

const root = Command.make('yt-studio', {}, () => showRootHelp).pipe(
  // The formatter indents only the first line, so the rest carry their own two spaces.
  Command.withDescription([
    // No version here — finding the schema for help would put its failures back on --help.
    '설치된 yt-dlp 의 스키마에 명령어를 대조한다. 어느 버전인지는 yt-studio version 이 말한다.',
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

const { version: PACKAGE_VERSION, bugs: pkgBugs } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; bugs: string };

/**
 * The whole CLI as one program: arguments in, exit code out.
 *
 * A defect — a bug in yt-studio, not in the command or the arguments — used to
 * escape as an uncaught exception, and node exits those with 1. Scripts read 1 as
 * "the command is wrong", so a crash looked like a verdict. It gets 70 now, with
 * the stack, since that is what a bug report needs.
 */
export const main = (argv: readonly string[]): Effect.Effect<number> =>
  Command.runWith(root, { version: PACKAGE_VERSION })(verbatim(argv)).pipe(
    Effect.match({
      onSuccess: (): number => 0,
      onFailure: e => e,
    }),
    Effect.flatMap(e => {
      if (typeof e === 'number') return Effect.succeed(e);
      const { code, lines } = exitOf(e);
      return complain(lines).pipe(Effect.as(code));
    }),
    Effect.provide(Services),
    Effect.catchDefect(defect => complain([
      `${red('✗')} yt-studio 의 버그다 — ${pkgBugs} 에 알려 주면 고친다.`,
      dim(defect instanceof Error ? defect.stack ?? defect.message : String(defect)),
    ]).pipe(Effect.as(70))),
  );
