/**
 * Commands written in code.
 *
 * Tests the source directly — bun reads .ts as-is, so no build is involved.
 * The compiled output (`lib/`) is exercised by the CLI tests as a real process.
 * What the types block is not here — `tests/types/reject.ts` checks that with `tsc`.
 *
 * Three things are checked here.
 *   - Does the string come out right?
 *   - **Does it build the same tree as the parser?** — reading and writing must share one grammar
 *   - Does the checker still do its job? — there are combinations the types cannot see
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

// Only what users use is taken from the public entry point. The other four are internal, so
// they come straight from core — putting them on the public surface would make removing them breaking after release.
const { ytdlp, ytstudio } = await import('../../src/index.js');
const { formatFactory, outTag, methodName, selMethod } =
  await import('../../src/core/build.js');
const { parseFormat } = await import('../../src/core/format-grammar.js');
const { parseTemplate } = await import('../../src/core/output-template.js');
const { scanCommand } = await import('../../src/core/command.js');
const yt = ytstudio();
const { schema } = yt;

const U = 'https://youtu.be/abc';

/**
 * Strips the types and looks only at the runtime surface.
 *
 * Methods **grow** from the schema, so being in the types does not mean being there at
 * runtime. Whether the two match is what this file checks, so only here are types
 * stripped on purpose. What the types block is checked separately by tests/types/reject.ts.
 */
const raw = (c: unknown): Record<string, unknown> => c as Record<string, unknown>;

test('메서드 이름은 긴 플래그에서 나온다', () => {
  assert.equal(methodName('--embed-subs'), 'embedSubs');
  assert.equal(methodName('--no-part'), 'noPart');
  assert.equal(methodName('--sponsorblock-remove'), 'sponsorblockRemove');
  assert.equal(selMethod('bv*'), 'bvStar');
  assert.equal(selMethod('b'), 'b');
});

test('손잡이가 자기가 대조하는 버전을 말한다', () => {
  assert.match(yt.source.version, /^\d{4}\.\d{2}\.\d{2}$/);
});

test('URL 만 주면 URL 만 나온다', () => {
  assert.equal(ytdlp(U).build(), `yt-dlp ${U}`);
  assert.equal(ytdlp().url(U).url('https://b').build(), `yt-dlp ${U} https://b`);
});

test('URL 은 늘 맨 뒤다 — 옵션을 나중에 줘도', () => {
  const c = ytdlp(U).embedSubs().writeSubs();
  assert.match(c.build(), /--embed-subs --write-subs https:\/\/youtu\.be\/abc$/);
});

test('짧은 플래그가 있으면 짧은 것을 쓴다 — 검사 결과와 눈으로 대조된다', () => {
  const c = ytdlp(U).format('b').output('%(title)s.%(ext)s').paths({ home: '/dl' }).extractAudio();
  const s = c.build();
  for (const t of ['-f b', '-o "%(title)s.%(ext)s"', '-P /dl', '-x']) {
    assert.ok(s.includes(t), `${t} 가 없다: ${s}`);
  }
  assert.ok(!s.includes('--format'), s);
});

test('스키마에서 자란다 — 손으로 적은 목록이 없다', () => {
  const c = raw(ytdlp(U));
  for (const m of ['embedSubs', 'writeSubs', 'subLangs', 'fixup', 'matchFilters', 'part']) {
    assert.equal(typeof c[m], 'function', `${m} 가 없다`);
  }
  assert.equal(c.writeSub, undefined, '없는 플래그가 생겼다');
  // Negated forms get no method of their own — `--no-part` is `.part(false)`.
  // The schema holds it as the negation of `part`, so another method would give
  // one option two names.
  assert.equal(c.noPart, undefined, '부정형이 제 메서드를 가졌다');
  assert.match(ytdlp(U).part(false).build(), /--no-part/);
});

test('플래그는 켜고 끈다 — 부정형이 있으면 부정형으로', () => {
  assert.match(ytdlp(U).embedSubs().build(), /--embed-subs/);
  assert.match(ytdlp(U).abortOnError(false).build(), /--no-abort-on-error/);
  // The only way to turn off a flag without a negated form is "not passing it"
  const off = ytdlp(U).extractAudio().extractAudio(false).build();
  assert.equal(off, `yt-dlp ${U}`);
});

test('값이 있는 옵션 · choices · repeatable', () => {
  assert.match(ytdlp(U).subLangs('ko,en').build(), /--sub-langs ko,en/);
  assert.match(ytdlp(U).fixup('never').build(), /--fixup never/);
  assert.match(ytdlp(U).retries(10).build(), /-R 10/);   // the short one, if there is one

  const rep = ytdlp(U).matchFilters('duration > 60', 'view_count > 100').build();
  assert.equal((rep.match(/--match-filters/g) || []).length, 2, rep);
});

test('같은 옵션을 두 번 주면 자리를 지키며 덮어쓴다', () => {
  const c = ytdlp(U).retries(3).embedSubs().retries(10);
  assert.equal(c.build(), `yt-dlp -R 10 --embed-subs ${U}`);
});

test('공백이 든 값은 따옴표로 감싸고, argv 에는 안 감싼다', () => {
  const c = ytdlp(U).output('%(title)s - %(uploader)s.%(ext)s');
  assert.ok(c.build().includes('"%(title)s - %(uploader)s.%(ext)s"'), c.build());
  assert.ok(c.toArray().includes('%(title)s - %(uploader)s.%(ext)s'), 'argv 에 따옴표가 남았다');
  assert.equal(c.toArray().at(-1), U);
});

test('식이 문자열이 된다', () => {
  const c = ytdlp(U).format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()));
  assert.ok(c.build().includes('-f "bv[height<=1080]+ba/b"'), c.build());
});

test('같은 연산자가 이어지면 눕는다 — a+b+c 지 (a+b)+c 가 아니다', () => {
  const f = formatFactory();
  assert.equal(String(f.bv().plus(f.ba()).plus(f.raw('sub'))), 'bv+ba+sub');
  assert.equal(String(f.bv().or(f.ba()).or(f.b())), 'bv/ba/b');
});

test('우선순위가 낮은 자식에는 괄호가 붙는다', () => {
  const f = formatFactory();
  assert.equal(String(f.bv().or(f.raw('wv')).plus(f.ba())), '(bv/wv)+ba');
});

test('식 전체에 필터를 걸면 괄호가 생긴다', () => {
  const f = formatFactory();
  assert.equal(String(f.raw('mp4').also(f.raw('webm')).where({ height: { lt: 480 } })),
    '(mp4,webm)[height<480]');
});

test('필터 — 그냥 준 값은 =, 참/거짓은 있음/없음, loose 는 ?', () => {
  const f = formatFactory();
  assert.equal(String(f.bv({ ext: 'mp4' })), 'bv[ext=mp4]');
  assert.equal(String(f.bv({ format_note: true })), 'bv[format_note]');
  assert.equal(String(f.bv({ format_note: false })), 'bv[!format_note]');
  assert.equal(String(f.bv({ height: { lte: 1080, loose: true } })), 'bv[height<=?1080]');
  assert.equal(String(f.bv({ vcodec: { startsWith: 'avc' } })), 'bv[vcodec^=avc]');
});

test('모르는 비교를 주면 거기서 멈춘다', () => {
  const f = formatFactory();
  // The types already block this (reject.ts). What is checked here is whether the runtime
  // stops instead of passing silently when it gets in around the types — the library is called from JS too.
  // @ts-expect-error deliberately pass an unknown comparison
  assert.throws(() => f.bv({ height: { roughly: 1080 } }), /모르는 비교/);
});

test('빌더가 만든 트리는 파서가 낸 트리와 같다', () => {
  const f = formatFactory();
  for (const e of [
    f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()),
    f.raw('mp4').also(f.raw('webm')).where({ height: { lt: 480 } }),
    f.bvStar({ ext: 'mp4' }).plus(f.baStar()).or(f.raw('b')),
  ]) {
    // This must hold to say reading (parseFormat) and writing (the builder) share one grammar
    assert.deepEqual(e.node, parseFormat(String(e)), String(e));
  }
});

test('태그드 템플릿이 출력 템플릿이 된다', () => {
  const c = ytdlp(U).output(t => t`${t.title} [${t.id}].${t.ext}`);
  assert.ok(c.build().includes('-o "%(title)s [%(id)s].%(ext)s"'), c.build());
});

test('필드 다듬기 — 없을 때 값 · 날짜 서식 · 자르기 · 0 채우기', () => {
  const t = outTag();
  assert.equal(String(t.upload_date.date('%Y-%m-%d')), '%(upload_date>%Y-%m-%d)s');
  assert.equal(String(t.title.or('Unknown')), '%(title|Unknown)s');
  assert.equal(String(t.title.trunc(40)), '%(title).40S');
  assert.equal(String(t.playlist_index.pad(3)), '%(playlist_index)03d');
  assert.equal(String(t.filesize.as('B')), '%(filesize)B');
});

test('카탈로그에 없는 필드는 field() 로', () => {
  assert.equal(String(outTag().field('release_year')), '%(release_year)s');
});

test('빌더가 만든 템플릿은 파서가 읽는다', () => {
  const c = ytdlp(U).output(t => t`${t.uploader}/${t.upload_date.date('%Y')}/${t.title}.${t.ext}`);
  const tpl = c.toArray()[c.toArray().indexOf('-o') + 1];
  assert.deepEqual(parseTemplate(tpl).map(p => p.t),
    ['field', 'text', 'field', 'text', 'field', 'text', 'field']);
});

test('종류별 템플릿은 접두어가 붙는다', () => {
  assert.ok(ytdlp(U).output('thumbnail', t => t`${t.id}.${t.ext}`).build()
    .includes('-o "thumbnail:%(id)s.%(ext)s"'));
});

test('home 은 접두어 없이, 나머지는 종류를 붙여서', () => {
  const c = ytdlp(U).paths({ home: '/dl', temp: '/tmp/yt', thumbnail: '/dl/thumbs' });
  const s = c.build();
  assert.ok(s.includes('-P /dl'), s);
  assert.ok(s.includes('-P temp:/tmp/yt'), s);
  assert.ok(s.includes('-P thumbnail:/dl/thumbs'), s);
});

test('clone 은 독립이다', () => {
  const base = ytdlp(U).format('b');
  const a = base.clone().embedSubs();
  const b = base.clone().extractAudio();
  assert.ok(!a.build().includes('-x'), a.build());
  assert.ok(!b.build().includes('--embed-subs'), b.build());
  assert.equal(base.build(), `yt-dlp -f b ${U}`);
});

test('타입이 통과시킨 조합을 검증기가 잡는다', () => {
  // Nothing wrong type-wise — both are real options
  const bad = ytdlp(U).extractAudio().format('bv');
  const r = bad.lint();
  assert.equal(r.ok, true, '오류는 아니다');
  assert.ok(r.issues.some(i => i.level === 'warn' && /영상 전용/.test(i.msg)),
    JSON.stringify(r.issues));

  const subs = ytdlp(U).embedSubs().lint();
  assert.ok(subs.issues.some(i => /자막을 받지 않는다/.test(i.msg)), JSON.stringify(subs.issues));
});

test('제대로 만든 것은 검증기도 조용하다', () => {
  const r = ytdlp(U)
    .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
    .mergeOutputFormat('mp4')
    .output(t => t`${t.title} [${t.id}].${t.ext}`)
    .writeSubs().subLangs('ko').embedSubs()
    .lint();
  assert.deepEqual(r.issues.filter(i => i.level !== 'info'), []);
  assert.equal(r.ok, true);
});

test('URL 을 안 주면 검증기가 잡는다 — 빌더도 그건 못 막는다', () => {
  assert.ok(ytdlp().embedSubs().lint().issues.some(i => /URL 이 없다/.test(i.msg)));
});

test('빌더가 낸 명령어를 스캐너가 그대로 읽는다', () => {
  const c = ytdlp(U)
    .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()))
    .output(t => t`${t.title}.${t.ext}`)
    .writeSubs().subLangs('ko,en').mergeOutputFormat('mp4');

  const { items } = scanCommand(schema, c.build());
  assert.equal(items.filter(i => i.kind === 'unknown').length, 0,
    JSON.stringify(items.filter(i => i.kind === 'unknown')));
  assert.deepEqual(items.filter(i => i.kind === 'opt').map(i => i.opt.id),
    ['format', 'output', 'write-subs', 'sub-langs', 'merge-output-format']);
  assert.deepEqual(items.filter(i => i.kind === 'url').map(i => i.raw), [U]);
});

// The question this repo must ask itself — **do I read what I emit?**
// If a value starting with `-` is kept separate, optparse accepts it (it just takes the
// next token as the value), but a reader cannot tell it from a flag. The checker actually
// flagged `-multistreams` as "an unknown flag".
test('- 로 시작하는 값은 붙여서 낸다 — 빌더가 낸 것을 검증기가 거부하면 안 된다', () => {
  const c = ytdlp(U).compatOptions('all', '-multistreams').sponsorblockRemove('sponsor', '-intro');

  assert.match(c.build(), /--compat-options=-multistreams/);
  assert.match(c.build(), /--sponsorblock-remove=-intro/);
  // The non-subtracting side stays separate — attaching it hurts readability
  assert.match(c.build(), /--compat-options all\b/);

  const r = c.lint();
  assert.deepEqual(r.issues.filter(i => i.level !== 'info'), []);

  // argv must match too. It skips the shell, so the only difference is no quotes.
  assert.ok(c.toArray().includes('--compat-options=-multistreams'), c.toArray().join(' '));
});

test('yt-dlp 가 정한 값 목록이 실려 있다', () => {
  const has = (id: string, ...vals: string[]): void => {
    const o = schema.byId[id]!;
    assert.ok(o.choices?.length, `${id} 에 목록이 없다 — gen_schema.py 의 리플렉션이 빈 것 아닌가`);
    for (const v of vals) assert.ok(o.choices!.includes(v), `${id} 목록에 ${v} 가 없다`);
  };
  has('convert-subs', 'srt', 'none');
  has('ap-mso', 'Comcast_SSO');
  has('compat-options', 'multistreams', 'youtube-dl', 'all');
  has('sponsorblock-remove', 'sponsor', 'default', 'all');
  has('sponsorblock-mark', 'poi_highlight');
  // With a list, the kind follows it — repeatable if several
  assert.equal(schema.byId['compat-options']!.kind, 'repeatable');
  assert.equal(schema.byId['convert-subs']!.kind, 'choice');
});

// If the hand-written vocabulary layer (output-template.ts) and the reflected schema diverge,
// **valid values become type errors, or invalid values pass.** Both actually happened —
// `annotation` was missing, and it contained `default`, which yt-dlp does not read as a type
// (`-o default:%(id)s` produces a file starting with `default:`).
test('손으로 적은 -o 종류가 스키마와 같다', async () => {
  const { OUT_TYPES } = await import('../../src/core/output-template.js');
  const ours = OUT_TYPES.map(([v]) => v).filter(Boolean);
  const theirs = schema.byId['output']!.keys!;
  assert.ok(theirs?.length, '스키마에 --output 의 종류가 없다');
  assert.deepEqual([...ours].sort(), [...theirs].sort());
});

test('-P 종류는 -o 것에 home·temp 를 더한 것이다', async () => {
  const { OUT_TYPES } = await import('../../src/core/output-template.js');
  const ours = new Set([...OUT_TYPES.map(([v]) => v).filter(Boolean), 'home', 'temp']);
  assert.deepEqual([...ours].sort(), [...schema.byId['paths']!.keys!].sort());
});

// A hand-written layer outliving the real thing — this repo stepped on it twice today
// (`default` lingered in the `-o` types and `annotation` was missing).
// `arg-types.ts` narrows values by metavar, so the same path is open.
test('값 타입 표가 스키마에 없는 metavar 를 가리키지 않는다', async () => {
  const { KNOWN_METAVARS } = await import('../../src/core/arg-types.js');
  const live = new Set(schema.opts.map(o => o.metavar).filter(Boolean));
  const stale = KNOWN_METAVARS.filter(m => !live.has(m));
  assert.deepEqual(stale, [], `이 metavar 는 이제 yt-dlp 에 없다 — arg-types.ts 에서 뺄 것`);
});

// Narrowing that produces false positives is worse than missing things. Check that values
// verified with yt-dlp's parse_bytes go out as-is — types are checked separately by tests/types/reject.ts.
test('좁힌 값이 명령어로는 그대로 나간다', () => {
  assert.match(ytdlp(U).maxFilesize('44.6M').build(), /--max-filesize 44\.6M/);
  assert.match(ytdlp(U).maxFilesize(1024).build(), /--max-filesize 1024/);
  // Use the short flag if there is one — --retries is -R
  assert.match(ytdlp(U).retries('infinite').build(), /-R infinite/);
  assert.match(ytdlp(U).socketTimeout(5.5).build(), /--socket-timeout 5\.5/);
});

// Types can be narrowed only if the schema carries what optparse reads a value as.
test('optparse 의 값 종류가 실려 있다', () => {
  assert.equal(schema.byId['socket-timeout']!.valueType, 'float');
  assert.equal(schema.byId['max-downloads']!.valueType, 'int');
  assert.equal(schema.byId['cookies']!.valueType, 'string');
  assert.equal(schema.byId['embed-subs']!.valueType, null, '값을 안 받는 옵션이다');
});

// A description that outlives its option becomes a lie from then on. And one written on a
// hand-written signature (-f · -o · -P · --cookies-from-browser) **shows up nowhere** —
// it never goes through the generator, so it dies silently.
test('설명 오버레이가 갈 곳 없는 옵션을 가리키지 않는다', async () => {
  const { ANNOTATED } = await import('../../src/core/option-notes.js');
  const { HAND_WRITTEN } = await import('../../src/core/env-types.js');

  const missing = ANNOTATED.filter(id => !schema.byId[id]);
  assert.deepEqual(missing, [], 'yt-dlp 에 없는 옵션이다 — option-notes.ts 에서 뺄 것');

  const dead = ANNOTATED.filter(id => HAND_WRITTEN.has(id));
  assert.deepEqual(dead, [], '손으로 쓴 시그니처라 안 뜬다 — build.ts 의 JSDoc 에 적을 것');
});

test('설명을 단 옵션은 우리 설명이 먼저 뜬다', async () => {
  const { optionMethod } = await import('../../src/core/env-types.js');
  const out = optionMethod(schema.byId['extract-audio']!);
  const lines = out.split('\n').map(l => l.trim());
  assert.match(lines[1]!, /Drops the video and keeps only the audio/);
  assert.ok(lines.some(l => /Convert video files to audio-only/.test(l)), '원문도 남아야 한다');

  // Those without one show only the original, as before
  const plain = optionMethod(schema.byId['no-warnings']!);
  assert.match(plain.split('\n')[1]!, /Ignore warnings/);
});

// --match-filters has **the operators of -f filters and the fields of -o templates** —
// yt-dlp defines it that way. So toFilters is reused as-is. The strings below were passed
// through the real yt-dlp's match_str and parse_options to confirm they pass.
test('--match-filters 를 필터 객체로 쓴다', () => {
  const c = (x: { build(): string }): string =>
    x.build().replace('yt-dlp ', '').replace(` ${U}`, '');

  assert.equal(c(ytdlp(U).matchFilters({ duration: { gt: 120 }, is_live: false })),
    '--match-filters "duration>120 & !is_live"');
  assert.equal(c(ytdlp(U).matchFilters({ title: { includes: 'live' }, view_count: { gte: 1000 } })),
    '--match-filters "title*=live & view_count>=1000"');

  // Several strings mean OR — repeatable, so each goes out once
  assert.equal((c(ytdlp(U).matchFilters('duration > 60', 'view_count > 100'))
    .match(/--match-filters/g) || []).length, 2);

  assert.equal(c(ytdlp(U).breakMatchFilters({ availability: 'public' })),
    '--break-match-filters availability=public');
});

// An object is a time range, a string is a chapter regex — the meanings are entirely
// different, so the asterisk is not left to be added by hand. Forget `*` and yt-dlp reads it as a regex.
test('--download-sections 는 구간과 챕터를 갈라 받는다', () => {
  const c = (x: { build(): string }): string =>
    x.build().replace('yt-dlp ', '').replace(` ${U}`, '');

  assert.equal(c(ytdlp(U).downloadSections({ from: 60, to: '2:30' })), '--download-sections "*60-2:30"');
  assert.equal(c(ytdlp(U).downloadSections({ from: 60 })), '--download-sections "*60-inf"');
  assert.equal(c(ytdlp(U).downloadSections({ to: 90 })), '--download-sections "*0-90"');
  assert.equal(c(ytdlp(U).downloadSections('intro')), '--download-sections intro');
});

// yt-dlp stores -o · -P per type and replaces only the same type:
//   -o a -o thumbnail:b → {'default': a, 'thumbnail': b}. The builder used to keep only the last.
test('종류가 다른 -o · -P 는 둘 다 남고, 같은 종류는 자리를 지키며 덮어쓴다', () => {
  const both = ytdlp(U).output(t => t`${t.title}.${t.ext}`).output('thumbnail', t => t`${t.id}`).build();
  assert.equal(both, `yt-dlp -o "%(title)s.%(ext)s" -o "thumbnail:%(id)s" ${U}`);

  const again = ytdlp(U).output('a.%(ext)s').writeSubs().output('b.%(ext)s').build();
  assert.equal(again, `yt-dlp -o "b.%(ext)s" --write-subs ${U}`);

  const paths = ytdlp(U).paths({ home: '/a', temp: '/t' }).paths({ home: '/b' }).build();
  assert.equal(paths, `yt-dlp -P /b -P temp:/t ${U}`);
});

test('쌓이는 옵션은 되풀이해도 전부 남는다', () => {
  assert.equal(ytdlp(U).exec('echo a').exec('echo b').build(), `yt-dlp --exec "echo a" --exec "echo b" ${U}`);
  assert.equal(ytdlp(U).subLangs('ko').subLangs('en').build(), `yt-dlp --sub-langs ko --sub-langs en ${U}`);
  // Different header names are different keys; the same name (case-insensitive) replaces
  assert.equal(ytdlp(U).addHeaders('A:1').addHeaders('B:2').addHeaders('a:3').build(),
    `yt-dlp --add-headers a:3 --add-headers B:2 ${U}`);
});

// Every allowed_keys regex is copied from Python. Die here if one stops being valid JavaScript.
test('keyed 의 키 패턴은 전부 자바스크립트 정규식으로 읽힌다', () => {
  const keyed = schema.opts.filter(o => o.keyed);
  assert.ok(keyed.length >= 10, String(keyed.length));
  for (const o of keyed) assert.doesNotThrow(() => new RegExp(o.keyed!.pattern), o.flag);
  for (const o of keyed) assert.equal(o.kind, 'repeatable', o.flag);
});
