/**
 * 예제.
 *
 * 고르는 기준은 "이 라이브러리가 아니면 못 하는 것"이다. 옵션 하나를 붙이는
 * 건 어느 빌더나 한다. `-f` 문법과 `-o` 템플릿이 **타입이 붙은 식**이 되는 것,
 * 그리고 남이 준 명령어를 **검사**하는 것 — 그 둘이 이 저장소의 이유다.
 */
export interface Example { name: string; note: string; code: string }

export const EXAMPLES: Example[] = [
  {
    name: '기본',
    note: '점을 찍으면 옵션 191개가 뜬다. 이름은 스키마에서 자란 것이라 오타가 안 난다.',
    code: `import { ytdlp } from 'ytstudio';

export default ytdlp('https://youtu.be/dQw4w9WgXcQ')
  .extractAudio()
  .audioFormat('mp3')
  .embedThumbnail();
`,
  },
  {
    name: '포맷 식',
    note: '-f 는 문자열이 아니라 식이다. bv[height<=1080]+ba/b 를 손으로 안 적는다.',
    code: `import { ytdlp } from 'ytstudio';

// bv[height<=1080]+ba/b
export default ytdlp('https://youtu.be/dQw4w9WgXcQ')
  .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
  .mergeOutputFormat('mp4');
`,
  },
  {
    name: '출력 템플릿',
    note: '-o 도 식이다. %(title)s 를 외우는 대신 t.title 을 쓴다 — 필드가 자동완성된다.',
    code: `import { ytdlp } from 'ytstudio';

export default ytdlp('https://youtu.be/dQw4w9WgXcQ')
  .output(t => t\`\${t.uploader}/\${t.title} [\${t.id}].\${t.ext}\`)
  .paths({ home: '~/Videos' })
  .writeSubs()
  .subLangs('ko,en');
`,
  },
  {
    name: '값 목록',
    note: '옵션 이름만이 아니라 값도 목록이 있다. 따옴표 안에서 Ctrl+Space — yt-dlp 가 정한 것이라 오타가 안 난다.',
    code: `import { ytdlp } from 'ytstudio';

export default ytdlp('https://youtu.be/dQw4w9WgXcQ')
  // 자막 포맷은 네 가지뿐이다 (+ 끄는 값 'none')
  .convertSubs('srt')
  // 여러 개를 주고, '-' 로 뺄 수도 있다
  .sponsorblockRemove('sponsor', 'intro', 'selfpromo')
  .compatOptions('all', '-multistreams');
`,
  },
  {
    name: '검사',
    note: '빌더로 안 쓴 명령어도 본다 — 블로그·동료·LLM 이 준 문자열이 이 모양으로 온다.',
    code: `// 남이 준 명령어를 그대로 붙여 넣는다. 아래 '검사' 칸이 대신 읽어 준다.
// 없는 플래그 하나(오타)와, 따로 보면 멀쩡한데 같이 쓰면 안 되는 조합 둘.
export default 'yt-dlp -x -f bv --audio-fromat mp3 --embed-subs https://youtu.be/abc';
`,
  },
];
