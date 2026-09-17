/**
 * Command diagnostics.
 *
 * Everything that makes this tool better than an LLM is here — it looks at the real
 * parsers and the schema reflected from the installed yt-dlp, not memory. So the
 * tests also target "plausible wrong answers a model would write".
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

// Reads the source directly. bun resolves `./x.js` to x.ts, so no build is involved.
const { lintCommand, nearestFlags, distance, scanCommand } =
  await import('../../src/index.js');

const msgs = (t: string): string => lintCommand(t).issues.map(i => i.msg).join(' | ');
const levels = (t: string): string[] => lintCommand(t).issues.map(i => i.level);

test('맞는 명령어는 조용하다', () => {
  const r = lintCommand('yt-dlp -f "bv*[height<=1080]+ba/b" --merge-output-format mp4 -o "%(title)s.%(ext)s" https://x/y');
  assert.equal(r.ok, true, msgs('...'));
  assert.equal(r.counts.error, 0);
  assert.equal(r.counts.warn, 0);
});

test('없는 플래그를 잡고 가까운 것을 제안한다', () => {
  const r = lintCommand('yt-dlp --write-sub https://x/y');
  assert.equal(r.ok, false);
  const hit = r.issues.find(i => i.flag === '--write-sub');
  assert.ok(hit, msgs('yt-dlp --write-sub https://x/y'));
  assert.ok(hit?.fixes?.includes('--write-subs'), String(hit?.fixes));
});

test('오타 제안은 길이에 비례한 문턱을 쓴다', () => {
  assert.equal(distance('abc', 'abc'), 0);
  assert.equal(distance('abc', 'abd'), 1);
  assert.deepEqual(nearestFlags(''), []);
  assert.ok(nearestFlags('--embed-subtitle').includes('--embed-subs'));
});

test('값이 필요한데 다음이 또 플래그면 잡는다', () => {
  const r = lintCommand('yt-dlp --sub-langs --embed-subs https://x/y');
  assert.ok(/--sub-langs 는 값이 필요하다/.test(msgs('yt-dlp --sub-langs --embed-subs https://x/y')), msgs(''));
  assert.equal(r.ok, false);
});

test('음수는 값으로 본다 — 플래그로 오인하지 않는다', () => {
  const r = lintCommand('yt-dlp --playlist-items -3 https://x/y');
  assert.equal(r.values['playlist-items'], '-3');
});

test('값을 안 받는 플래그에 값을 주면 잡는다', () => {
  assert.match(msgs('yt-dlp --embed-subs=yes https://x/y'), /값을 받지 않는 플래그/);
});

test('choices 를 벗어난 값을 잡는다', () => {
  assert.match(msgs('yt-dlp --fixup maybe https://x/y'), /고를 수 있는 값이 아니다/);
  assert.equal(lintCommand('yt-dlp --fixup never https://x/y').ok, true);
  // Options that take several comma-separated values are checked one by one
  assert.match(msgs('yt-dlp --concat-playlist never,nope https://x/y'), /nope/);
});

// Widening the lists makes **not flagging what is right** harder than catching what is wrong.
// Pin down forms yt-dlp actually accepts — the four below were verified with the real
// yt-dlp (they pass optparse).
test('빼기와 별칭과 all 은 멀쩡한 값이다 — 목록이 넓어져도 오탐이 안 는다', () => {
  for (const cmd of [
    'yt-dlp --compat-options youtube-dl https://x/y',      // alias
    'yt-dlp --compat-options all,-multistreams https://x/y', // enable all, then subtract
    'yt-dlp --sponsorblock-remove sponsor,intro https://x/y',
    'yt-dlp --sponsorblock-mark default https://x/y',
    'yt-dlp --convert-subs none https://x/y',              // not in the list, but the off value
  ]) {
    assert.equal(lintCommand(cmd).counts.error, 0, `${cmd}\n${msgs(cmd)}`);
  }
});

test('그래도 없는 값은 잡는다', () => {
  assert.match(msgs('yt-dlp --compat-options youtube-dll https://x/y'), /youtube-dll/);
  assert.match(msgs('yt-dlp --sponsorblock-remove sponsor,intr https://x/y'), /\bintr\b/);
  assert.match(msgs('yt-dlp --convert-subs mp4 https://x/y'), /mp4/);
  assert.match(msgs('yt-dlp --ap-mso Comcast https://x/y'), /Comcast/);
});

// Printing a 435-entry list (--ap-mso) in full makes the verdict unreadable.
test('목록이 길면 줄여서 보여 준다', () => {
  const m = msgs('yt-dlp --ap-mso Comcast https://x/y');
  assert.match(m, /… 435개/);
  assert.ok(m.length < 300, `너무 길다 (${m.length}자)`);
});

test('-f 는 진짜 파서로 본다', () => {
  assert.match(msgs('yt-dlp -f "bv*[height<=1080]+ba/" https://x/y'), /-f 값을 읽지 못했다/);
  assert.match(msgs('yt-dlp -f "bv[height<=]x" https://x/y'), /-f 값을 읽지 못했다/);
  assert.equal(lintCommand('yt-dlp -f bv+ba/b https://x/y').ok, true);
});

test('yt-dlp 가 받는 표현식에 거짓 오류를 내지 않는다', () => {
  // Filters on a group are an expression from the yt-dlp docs. Back when the parser
  // could not read them, a valid command got an error — the worst failure for a checker.
  for (const f of ['(mp4,webm)[height<480]', '(bv+ba)[height<=720]']) {
    const r = lintCommand(`yt-dlp -f "${f}" --merge-output-format mp4 https://x/y`);
    assert.equal(r.counts.error, 0, `${f}: ${r.issues.map(i => i.msg).join(' | ')}`);
  }
});

test('-o 는 문법과 확장자를 같이 본다', () => {
  assert.match(msgs('yt-dlp -o "%(title)s" https://x/y'), /%\(ext\)s 가 없다/);
  assert.match(msgs('yt-dlp -o "%(uploader)s/%(title)s" https://x/y'), /%\(ext\)s 가 없다/);
  assert.match(msgs('yt-dlp -o "%(title)s.%(ext" https://x/y'), /-o 값을 읽지 못했다/);
  assert.equal(lintCommand('yt-dlp -o "%(title)s.%(ext)s" https://x/y').ok, true);
  // An extension pulled out by walking an object is still an extension
  assert.equal(lintCommand('yt-dlp -o "%(title)s.%(requested_downloads.-1.ext)s" https://x/y').ok, true);
});

test('-P 는 같은 종류가 두 번 오면 알린다', () => {
  assert.match(msgs('yt-dlp -P home:/a -P home:/b https://x/y'), /home 가 두 번 있다/);
  assert.doesNotMatch(msgs('yt-dlp -P home:/a -P temp:/b https://x/y'), /두 번/);
});

test('URL 이 없으면 오류다 — 다만 URL 이 필요 없는 옵션은 봐준다', () => {
  assert.match(msgs('yt-dlp -f b'), /URL 이 없다/);
  assert.doesNotMatch(msgs('yt-dlp --batch-file urls.txt'), /URL 이 없다/);
  assert.doesNotMatch(msgs('yt-dlp --version'), /URL 이 없다/);
});

test('반복 안 되는 옵션을 두 번 주면 알린다', () => {
  assert.match(msgs('yt-dlp -f b -f w https://x/y'), /2번 줬다/);
  // --paths accumulates, so twice is normal
  assert.doesNotMatch(msgs('yt-dlp -P home:/a -P temp:/b https://x/y'), /2번 줬다/);
});

test('빈 값은 채우라고 말한다', () => {
  assert.match(msgs('yt-dlp --sub-langs "" https://x/y'), /값이 비어 있다/);
});

test('어긋나는 조합 — 음원만 뽑는데 -f 가 영상 전용', () => {
  assert.match(msgs('yt-dlp -x -f bv https://x/y'), /음성이 없는 포맷/);
  assert.doesNotMatch(msgs('yt-dlp -x -f bv+ba https://x/y'), /음성이 없는 포맷/);
});

test('어긋나는 조합 — 안 받으면서 저장 위치를 정했다', () => {
  assert.match(msgs('yt-dlp --simulate -o "%(title)s.%(ext)s" https://x/y'), /파일이 나오지 않는다/);
});

test('어긋나는 조합 — 자막을 안 받으면서 넣으라고 한다', () => {
  assert.match(msgs('yt-dlp --embed-subs https://x/y'), /자막을 받지 않는다/);
  assert.doesNotMatch(msgs('yt-dlp --write-subs --embed-subs https://x/y'), /자막을 받지 않는다/);
});

test('어긋나는 조합 — --audio-format 만 있고 -x 가 없다', () => {
  assert.match(msgs('yt-dlp --audio-format mp3 https://x/y'), /-x .* 와 같이 있을 때만/);
});

test('심각한 것이 먼저 나온다', () => {
  const ls = levels('yt-dlp --nope --embed-subs -o "%(title)s" https://x/y');
  assert.deepEqual([...ls].sort((a, b) => ls.indexOf(a) - ls.indexOf(b)), ls);
  assert.equal(ls[0], 'error');
});

test('진단은 명령어 앞의 yt-dlp 가 없어도 돈다', () => {
  assert.equal(lintCommand('-f b https://x/y').ok, true);
});

test('스키마가 모르는 토큰도 원문 그대로 들고 있는다', () => {
  // Do not erase what the user wrote just because we do not know it. It may be a flag
  // added in a newer yt-dlp, so say "unknown" but pass the text through untouched.
  const { items } = scanCommand('yt-dlp --future-flag --embed-subs https://x/y');
  const unknown = items.filter(i => i.kind === 'unknown');
  assert.deepEqual(unknown.map(i => i.raw), ['--future-flag']);
  assert.equal(unknown[0].why, 'no-flag');

  const { issues } = lintCommand('yt-dlp --future-flag --embed-subs https://x/y');
  assert.ok(issues.some(i => i.level === 'error' && i.flag === '--future-flag'));
});

test('scanCommand 는 순서와 원문을 지킨다', () => {
  const { head, items } = scanCommand('yt-dlp -f "bv+ba" --embed-subs https://x/y');
  assert.equal(head, 'yt-dlp');
  assert.deepEqual(items.map(i => i.kind), ['opt', 'opt', 'url']);
  // raw is not the original but re-quoted — so the round trip is stable
  assert.equal(items[0].raw, '-f bv+ba');
  assert.equal(items[1].raw, '--embed-subs');
  assert.equal(items[2].raw, 'https://x/y');
});

test('--flag=값 도 값으로 읽는다', () => {
  const r = lintCommand('yt-dlp --sub-langs=ko,en --write-subs https://x/y');
  assert.deepEqual(r.values['sub-langs'], ['ko,en']);   // repeatable — yt-dlp collects repeats
  assert.equal(r.ok, true);
});

test('부정형은 끈 것으로 읽는다', () => {
  const r = lintCommand('yt-dlp --no-embed-subs --write-subs https://x/y');
  assert.equal(r.values['embed-subs'], false);
});

// Values that are not one vocabulary word but **a grammar over a vocabulary**. Types cannot
// block these — blocking would make `aac>mp3/best` an error, so they are left open on purpose. Closing happens here.
test('[원본>]대상 을 / 로 이은 것을 읽는다', () => {
  for (const cmd of [
    'yt-dlp --audio-format mp3 https://x/y',
    'yt-dlp --audio-format best https://x/y',
    'yt-dlp --audio-format "aac>mp3/best" https://x/y',
    'yt-dlp --remux-video "mkv/mp4" https://x/y',
    'yt-dlp --recode-video "webm>mp4" https://x/y',
    'yt-dlp --convert-thumbnails none https://x/y',
    'yt-dlp --merge-output-format "mp4/mkv" https://x/y',
  ]) {
    assert.equal(lintCommand(cmd).counts.error, 0, `${cmd}\n${msgs(cmd)}`);
  }
});

test('만들 수 없는 확장자는 잡는다', () => {
  assert.match(msgs('yt-dlp --audio-format mp4 https://x/y'), /mp4 는 --audio-format/);
  assert.match(msgs('yt-dlp --audio-format "aac>mp4" https://x/y'), /mp4 는/);
  assert.match(msgs('yt-dlp --convert-thumbnails gif https://x/y'), /gif 는/);
  // Only this one rejects source> — yt-dlp's regex is just `(ext)(/(ext))*`
  assert.match(msgs('yt-dlp --merge-output-format "mp4>mkv" https://x/y'), /mp4>mkv 는/);
});

// yt-dlp **does not reject** unknown types. It treats them as not-a-type and leaves them in
// the value — `-o nope:%(id)s.%(ext)s` produces a file starting with `nope:`.
test('모르는 종류 접두어를 알려 준다 — 조용히 파일 이름이 된다', () => {
  const r = lintCommand('yt-dlp -o nope:%(title)s.%(ext)s https://x/y');
  assert.equal(r.counts.error, 0, '오류가 아니라 경고다');
  assert.match(msgs('yt-dlp -o nope:%(title)s.%(ext)s https://x/y'), /nope: 는 --output 가 아는 종류가 아니다/);
  assert.match(msgs('yt-dlp --downloader zzz:ffmpeg https://x/y'), /zzz: 는 --downloader/);
});

test('값에 그냥 든 콜론은 안 건드린다', () => {
  for (const cmd of [
    'yt-dlp -o annotation:%(title)s.%(ext)s https://x/y',   // a real type
    'yt-dlp --exec after_move:echo\\ hi https://x/y',
    'yt-dlp --exec "sed -i s/a:b/c/ %(filepath)q" https://x/y',  // does not look like a type
    'yt-dlp --retry-sleep fragment:exp=1:20 https://x/y',
    'yt-dlp --color stderr:never https://x/y',
  ]) {
    assert.deepEqual(lintCommand(cmd).issues.filter(i => i.level !== 'info'), [], cmd);
  }
});

// yt-dlp keeps these per key (-o · -P · --downloader …) or collects every value (--exec · --sub-langs).
// "Only the last one is used" about them was a false warning.
test('쌓이는 옵션을 되풀이해도 경고하지 않는다', () => {
  const quiet = [
    'yt-dlp -o "%(title)s.%(ext)s" -o "thumbnail:%(id)s" https://x/y',
    'yt-dlp --exec "echo a" --exec "after_move:echo b" https://x/y',
    'yt-dlp --sub-langs ko --sub-langs en --write-subs https://x/y',
    'yt-dlp --add-headers A:1 --add-headers B:2 https://x/y',
    // Overriding one key after a default is intended, not a mistake
    'yt-dlp --color never --color stderr:always https://x/y',
  ];
  for (const c of quiet) assert.equal(msgs(c), '', c);
});

test('같은 키를 두 번 주면 경고한다', () => {
  assert.match(msgs('yt-dlp -o "a.%(ext)s" -o "b.%(ext)s" https://x/y'), /-o 에 default 가 두 번 있다/);
  assert.match(msgs('yt-dlp --add-headers A:1 --add-headers a:2 https://x/y'), /a 가 두 번 있다/);
});

test('-o 는 템플릿마다 읽고, 확장자 경고는 본 파일에만 낸다', () => {
  assert.match(msgs('yt-dlp -o "%(title)s.%(ext)s" -o "thumbnail:%(id" https://x/y'), /-o 값을 읽지 못했다/);
  assert.match(msgs('yt-dlp -o "thumbnail:%(id" -o "%(title)s.%(ext)s" https://x/y'), /-o 값을 읽지 못했다/);
  assert.doesNotMatch(msgs('yt-dlp -o "%(title)s.%(ext)s" -o "thumbnail:%(id)s" https://x/y'), /%\(ext\)s 가 없다/);
  assert.match(msgs('yt-dlp -o "thumbnail:%(id)s.%(ext)s" -o "%(title)s" https://x/y'), /%\(ext\)s 가 없다/);
});
