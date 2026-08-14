/**
 * 옵션 설명 한 줄 — 리플렉션 위에 얹는 덧칠.
 *
 * 자동완성에 뜨는 것이 여태 yt-dlp 의 영어 도움말 그대로였다. 대부분은 짧아서
 * 그대로 쓸 만한데(중앙값 84자), 몇 개는 툴팁으로 못 읽는다 —
 * `--postprocessor-args` 는 968자다.
 *
 * 여기 적은 것은 **원문을 대신하지 않는다.** 한국어 한 줄이 앞에 오고 yt-dlp 의
 * 말이 뒤에 온다. 원문이 곧 진실이고 이건 길잡이라서다.
 *
 * **커버리지가 부분이어도 된다.** 목록은 스키마가 정하고 여기는 아는 것만
 * 적는다 — 안 적힌 옵션은 지금까지처럼 영어가 뜬다. 손님 yt-dlp 에만 있는
 * 새 옵션도 마찬가지고, 그게 맞다. 우리가 본 적 없는 옵션이니까.
 *
 * `-f` · `-o` · `-P` · `--cookies-from-browser` 는 여기 적어도 안 뜬다 —
 * 시그니처를 `build.ts` 가 손으로 쓰므로 생성기를 안 거친다. 그쪽 설명은
 * 거기 JSDoc 에 직접 적는다. 검사가 그것도 본다.
 *
 * 없는 옵션 id 에 적으면 검사가 잡는다. 설명이 옵션보다 오래 살아남으면
 * 그때부터 거짓말이 된다 — 이 저장소가 `-o` 종류 표에서 한 번 밟은 길이다.
 */

/** 옵션 id → 한국어 한 줄. `--` 를 뗀 긴 플래그가 키다. */
export const NOTES: Record<string, string> = {
  // ── 툴팁으로 못 읽던 것들 ──
  'postprocessor-args': '후처리기에 넘길 ffmpeg 인자. `ffmpeg:-vcodec libx265` 처럼 `이름:인자` 로 준다.',
  'use-postprocessor': '플러그인 후처리기를 켠다. `이름[+언제][:인자]` — 언제는 `--exec` 의 WHEN 과 같다.',
  alias: '옵션 묶음에 새 이름을 붙인다. `--alias mp3 "-x --audio-format mp3"`.',
  'js-runtimes': '자바스크립트가 필요한 추출기가 쓸 런타임. `deno` · `node` 등.',
  'sub-langs': '받을 자막 언어. `ko,en` 처럼 쉼표로, `all` 이면 전부, `-live_chat` 로 뺀다.',
  'playlist-items': '재생목록에서 몇 번째를 받을지. `1,3,5-7` · `::2`(홀수) · `-1`(마지막).',

  // ── 자주 쓰는데 원문이 짧아 뜻이 안 보이던 것들 ──
  'extract-audio': '영상을 버리고 음성만 남긴다. ffmpeg 이 있어야 한다.',
  simulate: '받는 척만 한다 — 파일도 로그도 안 남는다. 명령어를 시험할 때.',
  'no-playlist': 'URL 이 재생목록을 가리켜도 영상 하나만 받는다.',
  'download-archive': '여기 적힌 것은 건너뛴다. 받은 것은 여기 적는다 — 이어받기용.',
  'concurrent-fragments': '조각을 몇 개씩 동시에 받을지. DASH · HLS 에서만 먹는다.',
  'limit-rate': '초당 받을 최대 바이트. `50K` · `4.2M`.',
  'embed-subs': '자막을 영상 파일 안에 넣는다. **받기까지 하지는 않는다** — `--write-subs` 가 따로 있어야 한다.',
  'embed-thumbnail': '썸네일을 커버 아트로 넣는다.',
  'embed-metadata': '제목 · 업로더 같은 정보를 파일에 넣는다. 챕터도 같이.',
  'sponsorblock-remove': 'SponsorBlock 이 표시한 구간을 파일에서 잘라낸다. `sponsor,intro` 처럼 여러 개.',
};

/** 설명이 붙은 옵션 id 전부. 검사가 스키마와 대조한다. */
export const ANNOTATED: string[] = Object.keys(NOTES);
