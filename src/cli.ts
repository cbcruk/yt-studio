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
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  BUNDLED, SCHEMA_SOURCE, YTDLP_VERSION,
  explainCommand, lintCommand, previewFilename, suggestNext,
} from './index.js';
import { emitEnvTypes } from './core/env-types.js';
import { parseHelp } from './core/help-schema.js';
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

/**
 * 손님이 깐 yt-dlp 를 리플렉션해 스키마와 타입을 다시 뽑는다.
 *
 * 패키지에 실려 나가는 스키마는 **이 저장소를 구울 때의** yt-dlp 다. 손님 것이
 * 더 새로우면 새 플래그를 없는 것으로 잡고 exit 1 을 낸다 — CI 에 걸어 뒀으면
 * 남의 빌드를 깬다. 이 명령이 그걸 없앤다.
 *
 * 파이썬 리플렉션(`gen_schema.py`)을 안 쓰는 이유는 손님 환경에서 대체로 못
 * 돌기 때문이다. `brew` 도 독립 바이너리도 pipx 도 `import yt_dlp` 가 실패한다.
 */
function types(args: string[]): number {
  const i = args.indexOf('--yt-dlp');
  if (i >= 0 && !args[i + 1]) {
    console.error('--yt-dlp 뒤에 경로가 없다.');
    return 2;
  }
  const bin = i >= 0 ? args[i + 1]! : 'yt-dlp';

  const ask = (flag: string): string =>
    execFileSync(bin, [flag], { encoding: 'utf8', maxBuffer: 8 << 20 });

  let help: string, version: string;
  try {
    version = ask('--version').trim().split('\n')[0]!.trim();
    help = ask('--help');
  } catch {
    // 조용히 번들로 떨어지면 성공한 척하면서 아무것도 안 바꾼 게 된다
    console.error(`${red('✗')} yt-dlp 를 실행하지 못했다: ${bin}`);
    console.error(dim('  PATH 에 없으면 --yt-dlp <경로> 로 가리킬 것.'));
    return 1;
  }

  const r = parseHelp(help, version, BUNDLED);

  // 도움말은 사람용 출력이라 서식이 바뀔 수 있다. 파서가 깨지면 몇 개만 뽑고
  // 성공했다고 말하는데, 그러면 손님의 모든 플래그가 오탈자가 된다.
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
 * 만든 `.d.ts` 가 손님 tsconfig 의 `include` 에 안 걸리면 **조용히 무시된다.**
 *
 * 파일은 생겼는데 자동완성이 안 늘어난다. 손님은 이 도구가 고장 났다고 생각하지
 * 자기 `include` 를 의심하지 않는다 — 검증기가 처음부터 하던 일과 같은 종류라
 * 여기서도 말해 준다. 고쳐 주지는 않는다. 남의 빌드 설정이다.
 */
function tsconfigWarnings(dtsPath: string): string[] {
  const path = resolve(process.cwd(), 'tsconfig.json');
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }

  // include 가 없으면 tsc 의 기본값이 전부라 덮인다. 있으면 눈으로 본다 —
  // 여기서 tsconfig 를 온전히 해석할 생각은 없다(주석·extends·확장 패턴).
  if (!/"include"\s*:/.test(text)) return [];
  const name = basename(dtsPath);
  if (text.includes(name)) return [];
  return [`tsconfig.json 의 include 가 ${name} 을 안 덮는 것 같다 — 안 덮으면 조용히 무시된다. include 에 "${name}" 을 넣을 것`];
}

// 종료 코드가 셋이다 — 0 통과, 1 하려던 일이 안 됨, 2 이 CLI 를 잘못 불렀다.
// 스크립트가 "대상이 틀렸다"와 "인자를 잘못 줬다"를 갈라 봐야 한다.
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

const result = lintCommand(text);
if (cmd === 'explain') explain(result);
else report(result);

process.exit(result.counts.error ? 1 : 0);
