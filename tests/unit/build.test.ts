/**
 * 코드로 쓰는 명령어.
 *
 * 소스를 직접 검사한다 — bun 이 .ts 를 그대로 읽으므로 빌드를 안 거친다.
 * 컴파일 결과(`lib/`)는 CLI 검사가 진짜 프로세스로 exercise 한다.
 * 타입이 막는 것들은 여기 없다 — `tests/types/reject.ts` 가 `tsc` 로 검사한다.
 *
 * 여기서 보는 건 셋이다.
 *   · 문자열이 맞게 나오는가
 *   · **파서와 같은 트리를 만드는가** — 읽기와 쓰기가 한 문법을 공유해야 한다
 *   · 검증기가 여전히 제 일을 하는가 — 타입이 못 보는 조합이 있다
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

// 공개 입구에서 꺼내는 건 손님이 쓰는 것뿐이다. 나머지 넷은 내부라서 코어에서
// 직접 가져온다 — 공개 표면에 두면 배포 뒤에 빼는 게 breaking 이 된다.
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
 * 타입을 벗기고 런타임 표면만 본다.
 *
 * 메서드는 스키마에서 **자라므로** 타입에 있다고 런타임에도 있는 건 아니다.
 * 그 둘이 짝이 맞는지가 이 파일이 볼 것이라, 여기서만 의도적으로 벗긴다.
 * 타입이 무엇을 막는지는 tests/types/reject.ts 가 따로 본다.
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
  // 부정형은 제 메서드를 안 갖는다 — `--no-part` 는 `.part(false)` 다.
  // 스키마가 그걸 `part` 의 negation 으로 들고 있으므로 메서드를 또 만들면
  // 같은 옵션에 이름이 둘 생긴다.
  assert.equal(c.noPart, undefined, '부정형이 제 메서드를 가졌다');
  assert.match(ytdlp(U).part(false).build(), /--no-part/);
});

test('플래그는 켜고 끈다 — 부정형이 있으면 부정형으로', () => {
  assert.match(ytdlp(U).embedSubs().build(), /--embed-subs/);
  assert.match(ytdlp(U).abortOnError(false).build(), /--no-abort-on-error/);
  // 부정형이 없는 플래그를 끄는 길은 "안 주는 것"뿐이다
  const off = ytdlp(U).extractAudio().extractAudio(false).build();
  assert.equal(off, `yt-dlp ${U}`);
});

test('값이 있는 옵션 · choices · repeatable', () => {
  assert.match(ytdlp(U).subLangs('ko,en').build(), /--sub-langs ko,en/);
  assert.match(ytdlp(U).fixup('never').build(), /--fixup never/);
  assert.match(ytdlp(U).retries(10).build(), /-R 10/);   // 짧은 게 있으면 짧은 것

  const rep = ytdlp(U).matchFilters('duration > 60', 'view_count > 100').build();
  assert.equal((rep.match(/--match-filters/g) || []).length, 2, rep);
});

test('같은 옵션을 두 번 주면 자리를 지키며 덮어쓴다', () => {
  const c = ytdlp(U).subLangs('ko').embedSubs().subLangs('en');
  assert.equal(c.build(), `yt-dlp --sub-langs en --embed-subs ${U}`);
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
  // 타입은 이미 막는다(reject.ts). 여기서 보는 건 타입을 우회해서 들어왔을 때
  // 런타임이 조용히 넘기지 않고 멈추는가다 — 라이브러리는 JS 에서도 불린다.
  // @ts-expect-error 없는 비교를 일부러 준다
  assert.throws(() => f.bv({ height: { roughly: 1080 } }), /모르는 비교/);
});

test('빌더가 만든 트리는 파서가 낸 트리와 같다', () => {
  const f = formatFactory();
  for (const e of [
    f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()),
    f.raw('mp4').also(f.raw('webm')).where({ height: { lt: 480 } }),
    f.bvStar({ ext: 'mp4' }).plus(f.baStar()).or(f.raw('b')),
  ]) {
    // 이게 참이라야 읽기(parseFormat)와 쓰기(빌더)가 한 문법이라고 말할 수 있다
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
  // 타입으로는 아무 문제 없다 — 둘 다 실재하는 옵션이다
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

// 이 저장소가 스스로에게 물어야 하는 질문 — **내가 낸 것을 내가 읽는가.**
// `-` 로 시작하는 값을 떼어 놓으면 optparse 는 받지만(다음 토큰을 그냥
// 값으로 삼는다) 읽는 쪽에서는 플래그와 구분이 안 된다. 실제로 검증기가
// `-multistreams` 를 "없는 플래그"로 잡았다.
test('- 로 시작하는 값은 붙여서 낸다 — 빌더가 낸 것을 검증기가 거부하면 안 된다', () => {
  const c = ytdlp(U).compatOptions('all', '-multistreams').sponsorblockRemove('sponsor', '-intro');

  assert.match(c.build(), /--compat-options=-multistreams/);
  assert.match(c.build(), /--sponsorblock-remove=-intro/);
  // 안 빼는 쪽은 그대로 떼어 놓는다 — 붙이면 읽기 나빠진다
  assert.match(c.build(), /--compat-options all\b/);

  const r = c.lint();
  assert.deepEqual(r.issues.filter(i => i.level !== 'info'), []);

  // argv 쪽도 같아야 한다. 셸을 안 거치므로 따옴표만 안 붙을 뿐이다.
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
  // 목록이 있으면 종류가 그걸 따라간다 — 여러 개면 repeatable
  assert.equal(schema.byId['compat-options']!.kind, 'repeatable');
  assert.equal(schema.byId['convert-subs']!.kind, 'choice');
});

// 손으로 적은 어휘 층(output-template.ts)과 리플렉션한 스키마가 갈리면
// **멀쩡한 값이 타입 오류가 되거나, 안 되는 값이 통과한다.** 실제로 둘 다
// 있었다 — `annotation` 이 빠져 있었고, yt-dlp 가 종류로 안 읽는 `default` 가
// 들어 있었다(`-o default:%(id)s` 는 `default:` 로 시작하는 파일을 만든다).
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
