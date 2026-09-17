/**
 * `yt-dlp --help` parser.
 *
 * This test has a property no other test has — **there is an answer key.**
 * `ytstudio.schema.json` reflects the same yt-dlp (2026.07.04) through optparse,
 * and the fixture help is that release's actual output. So "how much can be
 * recovered from help alone" can be measured **field by field**, not estimated.
 *
 * There is one bar: for known options **not a single character may differ.** The
 * loss must remain only on newly added options.
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

/** A copy of the help with one line removed. Simulates a removed option. */
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

// optparse does not wrap only at word boundaries. It also wraps at hyphens, and cuts a
// word longer than the width. Joining lines naively puts a space in the middle of a
// flag name — this repo actually stepped on that.
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
  // Help leaks only one (Alias: --convert-subtitles), but the bundle has two
  assert.deepEqual(o.aliases, ['--convert-sub', '--convert-subtitles']);
});

test('부정형을 컨트롤 하나로 접는다', () => {
  const r = parseHelp(HELP, BASE.ytdlp_version, BASE);
  const part = r.schema.options.find(o => o.flag === '--part')!;
  assert.equal(part.negation, '--no-part');
  // --no-part has no entry of its own — if it did, one option would get two names
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
  // The group follows the preceding header; the stage comes from the bundle's stages[].groups
  assert.equal(o.group, 'Verbosity and Simulation Options');
  assert.equal(o.stage, 'report');
});

test('사라진 옵션을 집어낸다', () => {
  const r = parseHelp(without('--sub-langs'), '2099.01.01', BASE);
  assert.deepEqual(r.removed, ['--sub-langs']);
  assert.equal(r.schema.options.length, BASE.options.length - 1);
});

// Worst case: the format changes and the parser extracts only a few yet reports success.
// No judgement here, only the list of what vanished — cutting off is the caller's job.
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
