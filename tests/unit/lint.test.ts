/**
 * 명령어 진단.
 *
 * 이 도구가 LLM 보다 나은 이유가 전부 여기 있다 — 기억이 아니라 설치된
 * yt-dlp 를 리플렉션한 스키마와 진짜 파서를 본다. 그래서 검사도 "모델이
 * 만들 법한 그럴듯한 오답"을 상대로 한다.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

// 소스를 직접 본다. bun 이 `./x.js` 를 x.ts 로 풀어 주므로 빌드를 안 거친다.
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
  // 쉼표로 여러 개를 주는 옵션도 하나씩 본다
  assert.match(msgs('yt-dlp --concat-playlist never,nope https://x/y'), /nope/);
});

test('-f 는 진짜 파서로 본다', () => {
  assert.match(msgs('yt-dlp -f "bv*[height<=1080]+ba/" https://x/y'), /-f 값을 읽지 못했다/);
  assert.match(msgs('yt-dlp -f "bv[height<=]x" https://x/y'), /-f 값을 읽지 못했다/);
  assert.equal(lintCommand('yt-dlp -f bv+ba/b https://x/y').ok, true);
});

test('yt-dlp 가 받는 표현식에 거짓 오류를 내지 않는다', () => {
  // 그룹에 붙은 필터는 yt-dlp 문서에 나오는 표현이다. 파서가 못 읽던 시절엔
  // 멀쩡한 명령어에 오류가 떴다 — 검증기에서 이게 제일 나쁜 실패다.
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
  // 객체 순회로 꺼낸 확장자도 확장자다
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
  // --paths 는 누적 옵션이라 두 번이 정상이다
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
  // 우리가 모른다고 사용자가 쓴 것을 지우지 않는다. 새 yt-dlp 에서 생긴
  // 플래그일 수도 있으므로 "모르겠다"고 말하되 글자는 그대로 넘긴다.
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
  // raw 는 원문이 아니라 다시 인용한 것이다 — 왕복이 안정되게
  assert.equal(items[0].raw, '-f bv+ba');
  assert.equal(items[1].raw, '--embed-subs');
  assert.equal(items[2].raw, 'https://x/y');
});

test('--flag=값 도 값으로 읽는다', () => {
  const r = lintCommand('yt-dlp --sub-langs=ko,en --write-subs https://x/y');
  assert.equal(r.values['sub-langs'], 'ko,en');
  assert.equal(r.ok, true);
});

test('부정형은 끈 것으로 읽는다', () => {
  const r = lintCommand('yt-dlp --no-embed-subs --write-subs https://x/y');
  assert.equal(r.values['embed-subs'], false);
});
