/**
 * 실물 yt-dlp 와 벌어졌는지 본다.
 *
 * 나머지 검사는 전부 **2026.07.04 스냅샷 안에서** 돈다 — 커밋된 스키마,
 * 커밋된 도움말, 그 도움말을 `cat` 하는 껍데기 yt-dlp. 그래서 결정적이고,
 * 내 변경이 뭘 깼는지 정확히 말한다. 대신 **바깥에서 오는 변화는 못 본다.**
 *
 * 이 저장소가 내건 문장이 "기억이 아니라 실물을 본다"인데 검사가 기억만 보고
 * 있으면 앞뒤가 안 맞는다. 여기서 진짜 yt-dlp 를 깔고 묻는다.
 *
 *   · 도움말 파서가 **지금** yt-dlp 의 서식을 읽는가
 *   · `gen_schema.py` 가 **지금** yt-dlp 에서 도는가
 *   · `ytstudio types` 가 실물을 상대로 끝까지 가는가
 *
 * PR 마다 돌리지 않는다. yt-dlp 릴리스 때문에 남의 PR 이 빨개지면 그건
 * 알림이 아니라 방해다. 정기 잡에서 돌아 **우리에게** 알린다.
 *
 * 커밋된 스키마가 최신보다 낡은 것 자체는 실패가 아니다 — 그건 늘 그렇다.
 * 실패는 **기계가 고장 났을 때**뿐이다.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

import { parseHelp } from '../src/core/help-schema.js';
import type { Opt, RawSchema } from '../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'lib', 'cli.js');
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const PYTHON = process.env.PYTHON_BIN || 'python3';

const BASE: RawSchema = JSON.parse(readFileSync(path.join(ROOT, 'ytstudio.schema.json'), 'utf8'));

let fail = 0;
const bad = (msg: string): void => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${msg}`); };
const ok = (msg: string): void => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const note = (msg: string): void => console.log(`  \x1b[2m·\x1b[0m ${msg}`);

console.log('\n\x1b[1m▸ 실물 yt-dlp 와 대조\x1b[0m');

// ── 실물에서 두 가지를 얻는다: 도움말과, 파이썬으로 리플렉션한 정답지 ──
let version: string, help: string, live: RawSchema;
try {
  version = execFileSync(YTDLP, ['--version'], { encoding: 'utf8' }).trim().split('\n')[0]!.trim();
  help = execFileSync(YTDLP, ['--help'], { encoding: 'utf8', maxBuffer: 8 << 20 });
} catch (e) {
  console.log(`  \x1b[31m✗\x1b[0m yt-dlp 를 실행하지 못했다: ${YTDLP}`);
  console.log(`    ${(e as Error).message.split('\n')[0]}`);
  process.exit(1);
}

try {
  live = JSON.parse(execFileSync(PYTHON, [path.join(ROOT, 'gen_schema.py')],
    { encoding: 'utf8', maxBuffer: 32 << 20 }));
} catch (e) {
  // 이게 깨지면 저장소가 다음 릴리스에 스키마를 못 뽑는다는 뜻이다
  bad(`gen_schema.py 가 yt-dlp ${version} 에서 안 돈다 — 리플렉션이 깨졌다`);
  console.log(`    ${(e as Error).message.split('\n').slice(0, 3).join('\n    ')}`);
  process.exit(1);
}
ok(`yt-dlp ${version} · optparse 리플렉션 ${live.options.length}개`);

// ── 도움말 파서가 지금 서식을 읽는가 ──
const parsed = parseHelp(help, version, BASE);
const liveBy = new Map(live.options.map(o => [o.flag, o]));
const baseBy = new Map(BASE.options.map(o => [o.flag, o]));

if (parsed.schema.options.length !== live.options.length) {
  bad(`도움말에서 ${parsed.schema.options.length}개를 읽었는데 optparse 는 ${live.options.length}개다`);
} else {
  ok(`도움말 파서가 같은 개수를 읽는다 — ${parsed.schema.options.length}개`);
}

// 아는 옵션은 한 글자도 달라선 안 된다. 새 옵션은 도움말이 못 주는 것
// (choices · 숨은 별칭 · repeatable 여부)을 물려받을 데가 없으므로 뺀다.
const FULL: Array<keyof Opt> =
  ['id', 'short', 'aliases', 'stage', 'group', 'kind', 'metavar', 'choices', 'negation', 'help'];
const HELP_ONLY: Array<keyof Opt> = ['id', 'short', 'group', 'metavar', 'negation', 'help'];

const mismatches: string[] = [];
for (const o of parsed.schema.options) {
  const want = liveBy.get(o.flag);
  if (!want) { mismatches.push(`${o.flag}: optparse 에 없는데 도움말에서 읽혔다`); continue; }
  const keys = baseBy.has(o.flag) ? FULL : HELP_ONLY;
  for (const k of keys) {
    if (JSON.stringify(o[k]) !== JSON.stringify(want[k])) {
      mismatches.push(`${o.flag} [${k}]\n      파서 ${JSON.stringify(o[k])}\n      실물 ${JSON.stringify(want[k])}`);
    }
  }
}

if (mismatches.length) {
  bad(`도움말 파서가 optparse 와 어긋난다 — ${mismatches.length}건`);
  for (const m of mismatches.slice(0, 10)) console.log(`    ${m}`);
  if (mismatches.length > 10) console.log(`    … ${mismatches.length - 10}건 더`);
} else {
  ok('필드까지 같다 — 아는 옵션은 완전 일치, 새 옵션은 도움말이 주는 만큼');
}

// ── ytstudio types 가 실물을 상대로 끝까지 가는가 ──
const dir = mkdtempSync(path.join(os.tmpdir(), 'ytstudio-drift-'));
writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
try {
  const out = execFileSync('node', [CLI, 'types', '--yt-dlp', YTDLP], {
    cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NO_COLOR: '1' },
  });
  ok('ytstudio types 가 실물로 끝까지 간다');
  for (const line of out.trimEnd().split('\n')) console.log(`      ${line}`);
} catch (e) {
  const err = e as { stdout?: string; stderr?: string };
  bad('ytstudio types 가 실물에서 실패했다');
  console.log(`    ${((err.stdout || '') + (err.stderr || '')).trim().split('\n').join('\n    ')}`);
}

// ── 커밋된 스키마가 얼마나 뒤처졌나 (알림이지 실패가 아니다) ──
const added = live.options.filter(o => !baseBy.has(o.flag)).map(o => o.flag);
const removed = BASE.options.filter(o => !liveBy.has(o.flag)).map(o => o.flag);
console.log();
if (BASE.ytdlp_version === version && !added.length && !removed.length) {
  note(`커밋된 스키마가 최신이다 (${version})`);
} else {
  note(`커밋된 스키마 ${BASE.ytdlp_version} · 실물 ${version} — 새로 ${added.length} · 사라짐 ${removed.length}`);
  if (added.length) note(`  새 옵션: ${added.join(' ')}`);
  if (removed.length) note(`  사라진 옵션: ${removed.join(' ')}`);
  note('  다시 뽑으려면: python3 gen_schema.py > ytstudio.schema.json && bun run gen:types');
}

console.log(`\n  ${fail ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m 실물 대조: ${fail ? `${fail}건 실패` : '이상 없음'}\n`);
process.exit(fail ? 1 : 0);
