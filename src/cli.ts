#!/usr/bin/env node
/**
 * 터미널에서 명령어를 검사한다.
 *
 * 브라우저 앱이 하던 일 중 **라이브러리가 대신 못 하는 것**이 하나 있었다 —
 * 어디선가 주운 명령어를 검사하는 것. 블로그에서 봤든 동료가 붙여넣었든
 * LLM 이 줬든, 그건 문자열로 온다. 빌더는 빌더로 쓴 것만 본다.
 *
 * 그 일에는 화면이 필요 없었다. 파이프가 있으면 된다.
 *
 *     ytstudio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
 *     pbpaste | ytstudio lint
 *
 * 종료 코드로 말한다 — 오류가 있으면 1. CI 나 스크립트에 그대로 걸린다.
 */
import { readFileSync } from 'node:fs';

import {
  SCHEMA_SOURCE, YTDLP_VERSION,
  explainCommand, lintCommand, previewFilename, suggestNext,
} from './index.js';
import type { LintResult } from './index.js';

// 파이프로 넘길 때는 색을 끈다 — 색코드가 grep 에 걸리면 곤란하다.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n: number, s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

const MARK = { error: red('✗'), warn: yellow('!'), info: dim('·') };

const HELP = `ytstudio — 설치된 yt-dlp(${YTDLP_VERSION}) 에 명령어를 대조한다

  ytstudio lint <명령어>       스키마와 문법에 어긋나는 곳을 찾는다
  ytstudio explain <명령어>    토큰마다 무슨 옵션인지 말한다
  ytstudio version             지금 대조하는 스키마의 yt-dlp 버전

명령어를 인자로 주거나 표준 입력으로 흘려 넣는다.

  ytstudio lint 'yt-dlp -f bv+ba --write-sub https://youtu.be/abc'
  pbpaste | ytstudio lint

오류가 있으면 1 로 끝난다.

기본은 패키지에 실린 스키마다. 당신이 깐 yt-dlp 에 대조하려면 리플렉션한 것을
작업 디렉터리에 ytstudio.schema.json 으로 두거나 YTSTUDIO_SCHEMA 로 가리킨다.

  python3 gen_schema.py > ytstudio.schema.json`;

/** 어느 스키마를 봤는지 한 줄. 이게 없으면 판정이 무엇에 대한 판정인지 모른다. */
function source(): string {
  const where = SCHEMA_SOURCE.from === 'bundled' ? '패키지 내장' : SCHEMA_SOURCE.path;
  return `${where} ${dim(`(yt-dlp ${SCHEMA_SOURCE.version})`)}`;
}

/**
 * 인자로 줬으면 그걸, 아니면 표준 입력을 통째로.
 *
 * 파이프가 안 걸려 있으면 읽지 않는다 — 터미널에서 그냥 `ytstudio lint` 를
 * 치면 입력을 기다리며 멈춰 선다. 그건 고장으로 보인다.
 */
function input(args: string[]): string {
  if (args.length) return args.join(' ');
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8').trim(); } catch { return ''; }
}

/**
 * 검사 결과를 사람이 읽는 순서로 낸다.
 *
 * 심각한 것부터(lint.js 가 이미 그 순서로 준다), 그 다음 만들 파일명, 마지막에
 * 한 줄 판정. 오류가 있을 때는 다음 걸음을 안 권한다 — 틀린 것을 두고 더 얹으라고
 * 하면 소음이다.
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

  // 오류가 없을 때만 다음 걸음을 권한다 — 틀린 걸 두고 권하면 소음이다
  if (!error) {
    const next = suggestNext(r.values).slice(0, 4);
    if (next.length) console.log(`${dim('이어서')}    ${next.map(s => s.opt.flag).join('  ')}`);
  }
}

/** 토큰마다 무슨 옵션인지. 검사는 안 하고 읽어 주기만 한다. */
function explain(r: LintResult): void {
  for (const row of explainCommand(r.items)) {
    const where = row.stageLabel ? dim(`  [${row.stageLabel}]`) : '';
    console.log(`${bold(row.text)}${where}\n    ${row.ko}`);
  }
}

// 종료 코드가 셋이다 — 0 통과, 1 명령어에 오류, 2 이 CLI 를 잘못 불렀다.
// 스크립트가 "명령어가 틀렸다"와 "인자를 잘못 줬다"를 갈라 봐야 한다.
const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}
if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  // 버전만 표준 출력으로 낸다 — 스크립트가 이걸 그대로 읽는다.
  console.log(YTDLP_VERSION);
  console.error(dim(`스키마  ${source()}`));
  process.exit(0);
}
if (cmd !== 'lint' && cmd !== 'explain') {
  console.error(`모르는 명령이다: ${cmd}\n\n${HELP}`);
  process.exit(2);
}

const text = input(rest);
if (!text) {
  console.error('검사할 명령어가 없다. 인자로 주거나 표준 입력으로 넣을 것.');
  process.exit(2);
}

const result = lintCommand(text);
if (cmd === 'explain') explain(result);
else report(result);

process.exit(result.counts.error ? 1 : 0);
