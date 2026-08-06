# 코드로 쓰는 yt-dlp 명령어

`ytdlp()` 빌더 — 타입이 옵션 카탈로그가 되고, 컴파일러가 검증기의 절반을 맡는다.
무엇을 만드는 도구인지는 [README](../README.md) 에 있다.

```ts
import { ytdlp } from 'ytstudio';

ytdlp('https://youtu.be/abc')
  .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
  .output(t => t`${t.title} [${t.id}].${t.ext}`)
  .paths({ home: '/dl', temp: '/tmp/yt' })
  .writeSubs().subLangs('ko,en').embedSubs()
  .mergeOutputFormat('mp4')
  .build();

// yt-dlp -f "bv[height<=1080]+ba/b" -o "%(title)s [%(id)s].%(ext)s"
//        -P /dl -P temp:/tmp/yt --write-subs --sub-langs ko,en --embed-subs
//        --merge-output-format mp4 https://youtu.be/abc
```

---

## 왜 노드 그래프가 아니라 이건가

이 저장소는 원래 옵션을 노드 그래프로 조립하는 도구였다. 그 문서에 우리가 직접
써 둔 문장이 진단이었다.

> yt-dlp 명령어는 평평한 플래그 목록이라, 엣지가 ffmpeg 필터그래프처럼 실행 의미를
> 갖지는 않는다. 강제하는 규칙은 하나다.

**엣지가 할 일이 없는 그래프**를 그리고 있었다. 노드 191개를 놓을 자리는 만들었는데
선이 의미를 안 가지니 규칙이 하나(살아 있는 경로)밖에 안 나왔다. 구조가 없는 것에
구조를 씌운 셈이라 계속 어긋났다.

메서드 체인에는 애초에 엣지가 없다. 그리고 값이 진짜로 구조를 갖는 셋은 각자 제
문법을 받는다.

| 실제 구조 | 그래프에서 | 빌더에서 |
|---|---|---|
| `-f` 우선순위 있는 **식** | 괄호를 노드로 표현해야 했다 | 메서드 체인 = 식 |
| `-o` 조각의 **수열** | 가로 위치가 순서였다 | 태그드 템플릿 |
| `-P` 키 있는 **집합** | 세로 위치가 순서였다 | 객체 |
| 나머지 188개 = **평평한 목록** | 노드 종류 188개 | 메서드 188개 |

그래프는 코드의 3/4 와 e2e 의 4/5 를 차지하고 있었다. 빌더가 그 넷을 전부 더 잘
표현하게 된 뒤에 지웠다 — 되살릴 일이 있으면 git 히스토리에 있다.

## 타입이 카탈로그다

`gen_schema.py` 가 설치된 yt-dlp 를 리플렉션해 `schema.json` 을 떨구고,
`gen_options.mjs` 가 그걸 `src/core/options.gen.ts` 로 옮긴다. **자동완성에 뜨는
옵션 = 당신이 깐 yt-dlp 의 옵션**이다.

그래서 검증기가 런타임에 하던 일의 절반이 컴파일 타임으로 올라간다.

| 예전 (`core/lint.ts`, 런타임) | 지금 (에디터) |
|---|---|
| `--write-sub 는 없는 플래그다 — --write-subs … 를 찾은 것 아닐까` | `Property 'writeSub' does not exist. Did you mean 'writeSubs'?` |
| `never\|ignore\|… 중 하나가 아니다` | `'nope' is not assignable to '"never" \| "ignore" \| …'` |
| `-f 값을 읽지 못했다` | 애초에 못 만든다 |

편집거리로 후보를 뽑던 `nearestFlags` 를 컴파일러가 공짜로 대신한다.

**옵션 191개를 어떻게 보여줄까** 라는 문제도 여기서 사라진다. 의도 16개 → 핵심 →
관련 → 단계별로 좁혀 가던 층이 `.` 한 번으로 대체된다. 도움말도 같이 나온다 —
생성기가 각 메서드에 yt-dlp 의 help 문자열을 JSDoc 으로 붙인다.

## 그래도 검증기는 남는다

타입이 못 보는 층이 있다. **조합**이다.

```ts
ytdlp(u).extractAudio().format('bv').lint();
// warn: -x 로 음원만 뽑는데 -f 가 영상 전용이다 ("bv") — …
```

둘 다 실재하는 옵션이라 타입은 통과시킨다. `.lint()` 가 `core/lint.ts` 를 그대로
돌려서 이런 것들을 잡는다. 그리고 검증기에는 빌더가 못 하는 일이 하나 더 있다 —
**어디서 왔든 문자열을 검사하는 것.** 블로그에서 주웠든 동료가 붙여넣었든.
빌더는 빌더로 쓴 것만 본다.

---

## API

### `ytdlp(...urls)`

새 명령어. URL 은 나중에 `.url()` 로 더해도 되고, 언제 넣든 **늘 맨 뒤에 나온다.**

### 옵션 188개

메서드 이름은 **긴 플래그**에서 나온다 — `--embed-subs` → `.embedSubs()`.
명령어에 찍히는 건 **짧은 게 있으면 짧은 것**이다(`-f` · `-x` · `-R`) — 사람이
손으로 쓰는 모양이 그쪽이고, `ytstudio lint` 가 뱉는 플래그와도 같아야 눈으로
대조가 된다.

```ts
.embedSubs()          // --embed-subs
.embedSubs(false)     // 안 준 것과 같다 (부정형이 없는 플래그)
.part(false)          // --no-part   (부정형이 있으면 그걸로)
.subLangs('ko,en')    // --sub-langs ko,en
.fixup('never')       // choices 는 유니온 타입이다
.matchFilters(a, b)   // repeatable 은 쌓인다
```

부정형은 제 메서드를 안 갖는다. `--no-part` 는 `.part(false)` 다 — 스키마가 그걸
`part` 의 negation 으로 들고 있으므로, 메서드를 또 만들면 같은 옵션에 이름이 둘
생긴다.

같은 옵션을 두 번 주면 **자리를 지키며 덮어쓴다.** 뒤에 붙이면 코드에서 고친
순서가 명령어 순서를 바꿔서, 한 줄 고쳤는데 diff 가 두 줄 난다.

### `-f` — 포맷 셀렉터

```ts
.format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
```

| | |
|---|---|
| `.plus()` | `+` 영상과 음성을 합친다 |
| `.or()` | `/` 앞엣것이 없으면 뒤엣것 |
| `.also()` | `,` 둘 다 받는다 |
| `.where({…})` | 식 전체에 필터 — 괄호가 자동으로 붙는다 |

셀렉터는 `b` · `bv` · `ba` · `w` … 12개. `*` 는 `Star` 로 옮긴다 (`bv*` →
`.bvStar()`) — 새 이름을 지어내면 yt-dlp 문서와 대조가 안 된다. 문법을 벗어나야
하면 `f.raw('…')`.

필터는 객체다. 값을 그냥 주면 `=`, `true`/`false` 는 있음/없음이다.

```ts
{ ext: 'mp4' }                        // [ext=mp4]
{ format_note: false }                // [!format_note]
{ height: { lte: 1080, loose: true } } // [height<=?1080]
{ vcodec: { startsWith: 'avc' } }     // [vcodec^=avc]
```

우선순위와 괄호는 `emitTree` 가 맡는다. 같은 연산자가 이어지면 눕는다 —
`a.plus(b).plus(c)` 는 `a+b+c` 지 `(a+b)+c` 가 아니다.

**빌더가 만드는 트리는 `parseFormat` 이 내놓는 트리와 글자 하나까지 같다.**
읽기와 쓰기가 한 문법을 공유한다는 뜻이라, 문자열로 받은 식과 코드로 쓴 식을 같은
자리에서 다룰 수 있다. 단위 테스트가 `deepEqual` 로 지킨다.

### `-o` — 출력 템플릿

```ts
.output(t => t`${t.title} [${t.id}].${t.ext}`)
.output('thumbnail', t => t`${t.id}.${t.ext}`)   // 종류별
.output('%(title)s.%(ext)s')                     // 문자열로 직접
```

필드 이름은 **yt-dlp 것을 그대로** 쓴다(`t.upload_date`). camelCase 로 옮기면
예뻐지지만 yt-dlp 문서에서 찾을 수 없는 이름이 된다.

```ts
t.upload_date.date('%Y-%m-%d')   // %(upload_date>%Y-%m-%d)s
t.title.or('Unknown')            // %(title|Unknown)s
t.title.trunc(40)                // %(title).40S
t.playlist_index.pad(3)          // %(playlist_index)03d
t.filesize.as('B')               // %(filesize)B
t.field('release_year')          // 카탈로그에 없는 필드
```

### `-P` — 저장 경로

```ts
.paths({ home: '/dl', temp: '/tmp/yt', thumbnail: '/dl/thumbs' })
// -P /dl -P temp:/tmp/yt -P thumbnail:/dl/thumbs
```

`home` 만 접두어 없이 나간다.

### 내보내기

| | |
|---|---|
| `.build()` | 셸에 붙여넣을 한 줄. 공백이 든 값은 따옴표로 감싼다 |
| `.toArray()` | `spawn` 에 넘길 argv. **따옴표를 안 붙인다** — 셸을 안 거치므로 붙이면 값에 남는다 |
| `.lint()` | `{ ok, issues }` — 타입이 못 보는 조합을 본다 |
| `.clone()` | 지금까지 쌓은 것을 복사. 공통 앞부분을 두고 갈라 쓸 때 |

---

## 만드는 법

```
node gen_options.mjs      # schema.json → src/core/options.gen.ts   (npm run gen:types)
npx tsc                   # src/ → lib/                             (npm run build)
npx tsc -p tsconfig.test.json   # 타입 검사                          (npm run check:types)
```

`options.gen.ts` 는 커밋한다 — 에디터가 클론 직후부터 자동완성을 줘야 한다.
`lib/` 는 커밋하지 않는다(`prepare` 가 굽는다). CI 가 **스키마를 고치고 타입을
다시 안 뽑은 경우**를 잡는다.

### 타입은 타입으로 검사한다

`tests/types/reject.ts` 는 막아야 할 줄마다 `@ts-expect-error` 를 달아 둔다.
그 지시자는 **양쪽으로 문다** — 오류가 안 나면 지시자 자체가 오류가 된다. 그래서
파일 하나를 `tsc --noEmit` 로 돌리면 "막을 건 막고, 통과시킬 건 통과시킨다"가
한 번에 검사된다.

`src/` 는 전부 TypeScript 다. 한동안 파서와 검증기는 JS 였고 `allowJs` 와
`noImplicitAny: false` 로 받아 줬는데, 그러면 손님에게 나가는 타입이 **안쪽이 any 인
껍데기**가 된다. 전부 옮기고 그 둘을 껐다 — `Filter` · `FormatNode` · `Issue` 처럼
빌더가 따로 적어 두던 타입도 이제 진짜 정의를 그대로 쓴다.
