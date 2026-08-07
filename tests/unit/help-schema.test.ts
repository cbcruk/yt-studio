/**
 * `yt-dlp --help` 파서.
 *
 * 이 검사에는 다른 검사에 없는 성질이 하나 있다 — **정답지가 있다.**
 * `ytstudio.schema.json` 은 같은 yt-dlp(2026.07.04)를 optparse 로 리플렉션한
 * 것이고, 붙박이 도움말은 그 판의 실제 출력이다. 그래서 "도움말만 보고 얼마나
 * 복원되나"를 어림이 아니라 **필드 단위로** 잴 수 있다.
 *
 * 기준은 하나다: 아는 옵션에 대해서는 **한 글자도 달라선 안 된다.** 손해는
 * 새로 생긴 옵션에만 남아야 한다.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { Opt, RawSchema } from '../../src/core/schema.js';

const { parseHelp } = await import('../../src/core/help-schema.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): string => readFileSync(path.join(ROOT, p), 'utf8');

const BASE: RawSchema = JSON.parse(read('ytstudio.schema.json'));
const HELP = read('tests/fixtures/yt-dlp-2026.07.04.help.txt');

/** 도움말 한 줄을 지운 판. 옵션이 사라진 상황을 만든다. */
const without = (flag: string): string =>
  HELP.split('\n').filter(l => !l.startsWith(`    ${flag} `) && l !== `    ${flag}`).join('\n');

test('같은 버전이면 optparse 판을 그대로 복원한다', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  assert.equal(r.schema.options.length, BASE.options.length);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.unmappedGroups, []);
});

test('필드까지 같다 — 도움말이 못 주는 것은 번들에서 물려받는다', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  const by = new Map(BASE.options.map(o => [o.flag, o]));
  const keys: Array<keyof Opt> =
    ['id', 'short', 'aliases', 'stage', 'group', 'kind', 'metavar', 'choices', 'negation', 'help'];

  for (const o of r.schema.options) {
    const want = by.get(o.flag)!;
    for (const k of keys) {
      assert.deepEqual(o[k], want[k], `${o.flag} 의 ${k}`);
    }
  }
});

// optparse 는 낱말 경계에서만 접지 않는다. 하이픈에서도 접고, 낱말 하나가
// 폭보다 길면 그것도 자른다. 그냥 이어 붙이면 플래그 이름 한가운데 공백이
// 생긴다 — 이 저장소가 실제로 밟은 자리다.
test('접힌 설명을 되편다 — 하이픈과 잘린 낱말', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  const help = (flag: string): string => r.schema.options.find(o => o.flag === flag)!.help;

  assert.match(help('--convert-subs'), /\(Alias: --convert-subtitles\)/);
  assert.match(help('--sub-langs'), /--sub-langs all,-live_chat/);
  assert.match(help('--sponsorblock-mark'), /sponsor\.ajay\.app\/w\/Segment_Categories/);
});

test('별칭은 어느 쪽도 안 버린다 — 도움말과 번들의 합집합', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  const o = r.schema.options.find(x => x.flag === '--convert-subs')!;
  // 도움말은 (Alias: --convert-subtitles) 하나만 흘리는데 번들에는 둘이 있다
  assert.deepEqual(o.aliases, ['--convert-sub', '--convert-subtitles']);
});

test('부정형을 컨트롤 하나로 접는다', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  const part = r.schema.options.find(o => o.flag === '--part')!;
  assert.equal(part.negation, '--no-part');
  // --no-part 는 제 항목을 안 갖는다 — 가지면 같은 옵션에 이름이 둘 생긴다
  assert.equal(r.schema.options.some(o => o.flag === '--no-part'), false);
});

test('새 옵션은 도움말이 준 것만으로 선다', () => {
  const help = HELP.replace('    -v, --verbose',
    '    --brand-new NAME                Something new\n    -v, --verbose');
  const r = parseHelp(help, '2099.01.01', BASE);

  assert.deepEqual(r.added, ['--brand-new']);
  const o = r.schema.options.find(x => x.flag === '--brand-new')!;
  assert.equal(o.kind, 'value');
  assert.equal(o.metavar, 'NAME');
  assert.equal(o.help, 'Something new');
  // 그룹은 앞선 헤더에서 따라오고, 단계는 번들의 stages[].groups 가 준다
  assert.equal(o.group, 'Verbosity and Simulation Options');
  assert.equal(o.stage, 'report');
});

test('사라진 옵션을 집어낸다', () => {
  const r = parseHelp(without('--sub-langs'), '2099.01.01', BASE);
  assert.deepEqual(r.removed, ['--sub-langs']);
  assert.equal(r.schema.options.length, BASE.options.length - 1);
});

// 서식이 바뀌어 파서가 몇 개만 뽑아 놓고 성공했다고 말하는 게 제일 나쁘다.
// 여기서 판단하지는 않고 사라진 목록을 준다 — 자르는 건 부르는 쪽 몫이다.
test('서식이 깨지면 사라진 목록이 커진다', () => {
  const r = parseHelp('Usage: yt-dlp\n\nOptions:\n', '2099.01.01', BASE);
  assert.equal(r.schema.options.length, 0);
  assert.equal(r.removed.length, BASE.options.length);
});

test('source 를 help 로 박는다 — 번들보다 덜 충실하다는 표시다', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  assert.equal(r.schema.source, 'help');
  assert.equal(BASE.source ?? 'optparse', 'optparse');
});
