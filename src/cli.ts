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
 *     ytstudio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
 *     pbpaste | ytstudio lint
 *
 * It speaks through the exit code — 1 if there are errors. It drops straight
 * into CI or scripts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';

import { BUNDLED, previewFilename, ytstudio } from './index.js';
import { emitEnvTypes } from './core/env-types.js';
import { parseHelp } from './core/help-schema.js';
import type { LintResult } from './index.js';

// The schema is decided once, here. What this process checks against is this one line.
const yt = ytstudio();

// Colors are off when piped — color codes getting caught by grep is a nuisance.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n: number, s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

const MARK = { error: red('✗'), warn: yellow('!'), info: dim('·') };

const HELP = `ytstudio — 설치된 yt-dlp(${yt.source.version}) 에 명령어를 대조한다

  ytstudio lint <명령어>       스키마와 문법에 어긋나는 곳을 찾는다
  ytstudio explain <명령어>    토큰마다 무슨 옵션인지 말한다
  ytstudio types               당신이 깐 yt-dlp 를 리플렉션해 스키마와 타입을 다시 뽑는다
  ytstudio version             지금 대조하는 스키마의 yt-dlp 버전

명령어를 인자로 주거나 표준 입력으로 흘려 넣는다.

  ytstudio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
  pbpaste | ytstudio lint

오류가 있으면 1 로 끝난다.

기본은 패키지에 실린 스키마다 — 이 저장소를 구울 때의 yt-dlp 이지 당신 것이
아니다. 당신 것에 맞추려면 한 번 뽑아 두면 된다.

  npx ytstudio types                    PATH 의 yt-dlp 를 읽는다
  npx ytstudio types --yt-dlp <경로>    다른 자리에 있으면

작업 디렉터리의 ytstudio.schema.json 을 검증기가 먼저 본다. YTSTUDIO_SCHEMA 로
다른 자리를 가리킬 수도 있다.`;

/** One line on which schema was used. Without it, nobody knows what the verdict is a verdict about. */
function source(): string {
  const where = yt.source.from === 'bundled' ? '패키지 내장' : yt.source.path;
  return `${where} ${dim(`(yt-dlp ${yt.source.version})`)}`;
}

/**
 * The arguments if given, otherwise all of standard input.
 *
 * Without a pipe it doesn't read — typing a bare `ytstudio lint` in a terminal
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
    console.log(`\n${dim('만들 파일')}  ${f.text}${f.dflt ? dim('  (-o 없음, yt-dlp 기본값)') : ''}`);
  }

  const { error, warn, opts, total } = r.counts;
  const verdict = error ? red(`오류 ${error}개`)
    : warn ? yellow(`경고 ${warn}개`)
      : c(32, '확인됨');
  console.log(`${dim('판정')}      ${verdict} ${dim(`· 옵션 ${opts}개를 스키마 ${total}개와 대조`)}`);
  console.log(`${dim('스키마')}    ${source()}`);

  // Suggest next steps only when there are no errors — suggesting on top of something wrong is noise
  if (!error) {
    const next = yt.suggest(r.values).slice(0, 4);
    if (next.length) console.log(`${dim('이어서')}    ${next.map(s => s.opt.flag).join('  ')}`);
  }
}

/** Which option each token is. No checking — it only reads it back. */
function explain(r: LintResult): void {
  for (const row of yt.explain(r.items)) {
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
function types(args: string[]): number {
  let bin: string;
  try {
    // Scanning arguments by hand stopped here, and only here. `indexOf('--yt-dlp')`
    // couldn't find `--yt-dlp=/path`, so it **silently dropped the path users
    // gave** and looked at PATH — exactly the kind of failure this repo keeps
    // catching. Being strict, unknown flags are caught here too.
    const { values } = parseArgs({
      args, strict: true, allowPositionals: false,
      options: { 'yt-dlp': { type: 'string' } },
    });
    bin = values['yt-dlp'] ?? 'yt-dlp';
  } catch (e) {
    console.error(`${red('✗')} ${argError(e)}`);
    console.error(dim('  쓰는 법: ytstudio types [--yt-dlp <경로>]'));
    return 2;
  }

  const ask = (flag: string): string =>
    execFileSync(bin, [flag], { encoding: 'utf8', maxBuffer: 8 << 20 });

  let help: string, version: string;
  try {
    version = ask('--version').trim().split('\n')[0]!.trim();
    help = ask('--help');
  } catch {
    // Silently falling back to the bundled one would pretend to succeed while changing nothing
    console.error(`${red('✗')} yt-dlp 를 실행하지 못했다: ${bin}`);
    console.error(dim('  PATH 에 없으면 --yt-dlp <경로> 로 가리킬 것.'));
    return 1;
  }

  const r = parseHelp(help, version, BUNDLED);

  // Help is output meant for people, so its format can change. A broken parser
  // extracts only a few and reports success — and then every one of users'
  // flags becomes a typo.
  const gone = r.removed.length / BUNDLED.options.length;
  if (gone > 0.2) {
    console.error(`${red('✗')} 도움말에서 옵션 ${r.removed.length}개가 사라졌다 (번들 ${BUNDLED.options.length}개 중) — 파서가 이 서식을 못 읽는다`);
    console.error(dim('  아무것도 쓰지 않았다. 반쯤 쓴 스키마가 제일 나쁘다.'));
    return 1;
  }

  const byFlag = new Map(BUNDLED.options.map(o => [o.flag, o]));
  const next = new Map(r.schema.options.map(o => [o.flag, o]));
  const dts = emitEnvTypes({
    version,
    added: r.added.map(f => next.get(f)!),
    removed: r.removed.map(f => byFlag.get(f)!),
  });

  const schemaPath = resolve(process.cwd(), 'ytstudio.schema.json');
  const dtsPath = resolve(process.cwd(), 'ytstudio-env.d.ts');
  writeFileSync(schemaPath, `${JSON.stringify(r.schema, null, 1)}\n`);
  writeFileSync(dtsPath, dts);

  console.log(`${dim('읽음')}      ${bin} ${dim(`(yt-dlp ${version}) · --help 파싱`)}`);
  console.log(`${dim('옵션')}      ${r.schema.options.length}개 ${dim(`· 새로 ${r.added.length} · 사라짐 ${r.removed.length} (번들 ${BUNDLED.options.length} 대비)`)}`);
  console.log(`${dim('씀')}        ${basename(schemaPath)} · ${basename(dtsPath)}`);
  if (r.added.length) console.log(`${dim('새 옵션')}   ${r.added.slice(0, 6).join('  ')}${r.added.length > 6 ? dim(` … ${r.added.length - 6}개 더`) : ''}`);
  if (r.unmappedGroups.length) {
    console.log(`${yellow('!')} 처음 보는 그룹이라 실행 단계에 뒀다: ${r.unmappedGroups.join(' · ')}`);
  }
  for (const w of tsconfigWarnings(dtsPath)) console.log(`${yellow('!')} ${w}`);
  return 0;
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
  console.log(HELP);
  process.exit(0);
}
if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  // Only the version goes to stdout — scripts read it as is.
  console.log(yt.source.version);
  console.error(dim(`스키마  ${source()}`));
  process.exit(0);
}
if (cmd === 'types') process.exit(types(rest));

if (cmd !== 'lint' && cmd !== 'explain') {
  console.error(`모르는 명령이다: ${cmd}\n\n${HELP}`);
  process.exit(2);
}

const text = input(rest);
if (!text) {
  console.error('검사할 명령어가 없다. 인자로 주거나 표준 입력으로 넣을 것.');
  process.exit(2);
}

const result = yt.lint(text);
if (cmd === 'explain') explain(result);
else report(result);

process.exit(result.counts.error ? 1 : 0);
