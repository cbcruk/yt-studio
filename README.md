# yt-dlp 스튜디오

[![테스트](https://github.com/cbcruk/yt-studio/actions/workflows/test.yml/badge.svg)](https://github.com/cbcruk/yt-studio/actions/workflows/test.yml)

**설치된 yt-dlp 를 리플렉션해서 만든 타입 빌더와 명령어 검증기.**

```
npm run build     # → lib/                            (tsc)
npm run gen:types # schema.json → src/core/options.gen.ts
npm test          # 린트 + 타입 + 단위 + CLI
```

## 왜 만드나

LLM 은 yt-dlp 명령어를 그럴듯하게 쓴다. 그리고 **틀린 줄을 모른다** — 학습 시점에
있던 플래그를 쓰고, `-f` · `-o` 값을 문법이 아니라 기억으로 만든다.

이 도구는 기억이 아니라 실물을 본다. 옵션 191개는 `gen_schema.py` 가 설치된
yt-dlp 의 optparse 트리를 리플렉션해서 뽑은 것이고, `-f` · `-o` · `-P` 는 진짜
파서가 읽는다. 그래서 아래를 답할 수 있다.

> 이 명령어, 지금 내 yt-dlp 에서 돌려도 되나? 돌리면 무슨 파일이 생기나?

같은 스키마 위에 입구가 둘이다. **코드로 만들거나**, **문자열을 검사하거나.**

## 코드로 만들기

```ts
import { ytdlp } from 'ytstudio';

ytdlp('https://youtu.be/abc')
  .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
  .output(t => t`${t.title} [${t.id}].${t.ext}`)
  .paths({ home: '/dl', temp: '/tmp/yt' })
  .writeSubs().subLangs('ko,en').embedSubs()
  .build();

// yt-dlp -f "bv[height<=1080]+ba/b" -o "%(title)s [%(id)s].%(ext)s"
//        -P /dl -P temp:/tmp/yt --write-subs --sub-langs ko,en --embed-subs
//        https://youtu.be/abc
```

메서드 188개는 **스키마에서 자란다** — 손으로 적은 목록이 없다. 타입도 같은 곳에서
나오므로 **자동완성에 뜨는 옵션 = 당신이 깐 yt-dlp 의 옵션**이다. 그래서 검증기가
하던 일의 절반이 컴파일 타임으로 올라간다.

```
ytdlp(u).writeSub()      → Property 'writeSub' does not exist. Did you mean 'writeSubs'?
ytdlp(u).fixup('nope')   → 'nope' is not assignable to '"never" | "ignore" | …'
```

편집거리로 후보를 뽑던 코드를 컴파일러가 공짜로 대신한다. `.toArray()` 는 `spawn`
에 넘길 argv 를 준다.

> 빌더 전체는 **[docs/builder.md](docs/builder.md)** 에 있다. 왜 노드 그래프가
> 아니라 이것이 맞는지도 거기 적어 뒀다.

## 문자열 검사하기

빌더는 **빌더로 쓴 것만** 본다. 블로그에서 주웠든 동료가 붙여넣었든 LLM 이 줬든,
남이 준 명령어는 문자열로 온다. 그걸 설치된 yt-dlp 에 대조하는 게 이 도구가 하는
유일무이한 일이다.

```
$ ytstudio lint 'yt-dlp -f "bv+ba/" --write-sub -o "%(title)s" https://youtu.be/abc'
✗ --write-sub 는 이 yt-dlp 버전에 없는 플래그다 — --write-subs · --write-srt · --write-link 를 찾은 것 아닐까
    → --write-subs  --write-srt  --write-link
✗ -f 값을 읽지 못했다 — 셀렉터를 찾지 못했다 (7번째 글자 근처)
! -o 에 %(ext)s 가 없다 — 확장자 없는 파일이 만들어진다

만들 파일  ‹제목›
판정      오류 2개 · 옵션 2개를 스키마 191개와 대조
```

**오류가 있으면 1 로 끝난다** — 스크립트와 CI 에 그대로 걸린다. 파이프도 된다
(`pbpaste | ytstudio lint`). 무슨 뜻인지 읽으려면 `ytstudio explain`.

코드에서는 같은 것을 함수로 부른다.

```ts
import { lintCommand, previewFilename } from 'ytstudio';

const r = lintCommand(누가준명령어);
if (!r.ok) throw new Error(r.issues.map(i => i.msg).join('\n'));
previewFilename(r.values).text;   // '/dl/‹업로더›/‹제목›.‹확장자›'
```

## 검증기가 보는 것

`src/core/lint.js` — 로컬에서, 결정적으로, 네트워크 없이 돈다.

| 보는 것 | 근거 |
|---|---|
| 이 yt-dlp 버전에 있는 플래그인가 | 리플렉션한 `schema.json` (별칭·단축·부정형까지) |
| 오타라면 무엇을 쓰려던 건가 | 편집거리 + 접두어 가중치로 후보 세 개 |
| 값이 필요한 자리에 값이 있는가 | `kind` · `metavar` |
| 고를 수 있는 값 중 하나인가 | `choices` |
| `-f` 가 포맷 셀렉터 문법에 맞는가 | `core/format-grammar.js` 파서 |
| `-o` 가 출력 템플릿 문법에 맞는가 · 확장자가 붙는가 | `core/output-template.js` 파서 |
| `-P` 에 같은 종류가 두 번 오지 않는가 | `core/paths.js` |
| 서로 어긋나는 조합인가 | `-x` 인데 `-f` 가 영상 전용, `--embed-subs` 인데 자막을 안 받음 … |

마지막 줄이 빌더가 있어도 검증기가 안 없어지는 이유다. **조합은 타입이 못 본다** —
`-x` 와 `-f bv` 는 둘 다 실재하는 옵션이라 컴파일러가 통과시킨다. 빌더에서도
`.lint()` 로 같은 검사를 돌릴 수 있다.

## 구성

```
src/core/            DOM 도 파일 시스템도 모른다. node 로 단위 테스트가 된다
  schema.js          리플렉션한 JSON → 색인
  build.ts           코드로 쓰는 명령어 — 메서드 188개가 스키마에서 자란다
  options.gen.ts     생성물: 옵션 타입 · 필터 · 필드 (gen_options.mjs 가 만든다)
  lint.js            명령어 진단 — 이 도구의 중심
  explain.js         토큰별 설명 · 파일명 미리보기 · 다음 걸음
  command.js         명령어 문자열 ↔ 항목 수열 (읽는 길은 scanCommand 하나뿐)
  format-grammar.js  -f 파서 · 컴파일러 · 셀렉터/필터 어휘
  output-template.js -o 파서 · 컴파일러 · 필드/변환 어휘
  paths.js           -P 항목 한 줄 읽기
src/index.ts         공개 API (빌더 + 검증기)
src/cli.ts           ytstudio lint · explain
gen_schema.py        yt-dlp optparse 트리를 리플렉션해 schema.json 으로
gen_options.mjs      schema.json 을 옵션 타입으로
tsconfig*.json       빌드용 · 타입 검사 전용
.github/workflows/   CI — npm test 와 같은 것 + 타입이 스키마와 맞는지
```

`options.gen.ts` 는 커밋한다 — 에디터가 클론 직후부터 자동완성을 줘야 한다.
`lib/` 는 커밋하지 않는다(`prepare` 가 굽는다).

## 스키마 다시 뽑기

yt-dlp 를 올렸으면 둘을 같이 돌린다. CI 가 **스키마만 고치고 타입을 다시 안
뽑은 경우**를 잡는다.

```
python3 gen_schema.py      # 설치된 yt-dlp → schema.json
npm run gen:types          # schema.json → src/core/options.gen.ts
```

## 손으로 채우는 층

리플렉션이 절대 못 주는 것이 둘 있고, 이 도구의 실제 부가가치가 거기 있다.

1. `core/lint.js` 의 **어긋나는 조합** 규칙 (`crossChecks`)
2. `core/format-grammar.js` · `core/output-template.js` 의 **어휘와 설명** — 필터
   필드, 출력 필드, 변환 글자. 자동완성에 뜨는 한국어 설명이 여기서 나온다

## 한계

- **타입은 이 저장소에 커밋된 yt-dlp 버전 기준이다.** "당신이 깐 버전"이 온전히
  참이 되려면 설치 시점에 로컬 yt-dlp 를 리플렉션하는 단계가 있어야 한다. 지금은
  `gen_schema.py` 를 직접 돌려야 한다.
- **검증기는 "스키마와 문법에 어긋나는 곳이 없다"까지만 말한다.** 문법이 맞아도
  의도와 다를 수 있어서 파일명 미리보기와 토큰별 설명을 같이 낸다.
- **실제로 돌려 보지는 않는다.** 이 URL 에 그 포맷이 정말 있는지는 yt-dlp 를
  실행해야 안다. 그 대가로 네트워크 없이, 결정적으로, 어제와 오늘 같은 답을 낸다.
- 빌더 쪽 결정은 [docs/builder.md](docs/builder.md) 에 있다.
