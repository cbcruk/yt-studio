/**
 * yt-dlp 옵션 스키마.
 *
 * 리플렉션한 raw JSON 하나에서 색인들을 만든다. **결과는 값이다** —
 * `buildSchema` 는 순수 함수이고 이 모듈에는 가변 상태가 없다.
 *
 * 한동안은 반대였다. `export let OPTS/BY_ID/…` 다섯에 `initSchema` 가 값을
 * 채워 넣는 모양이었는데, 그러면 호출자가 알아야 할 것이 시그니처에 안 적힌다.
 *
 *   · `initSchema` 를 먼저 불러야 나머지가 유효하다
 *   · 두 번 부르면 **프로세스 안 모든 모듈**의 것이 다시 쓰인다
 *   · 스키마 둘을 동시에 들 방법이 없다
 *
 * 마지막이 실제로 물었다. 가짜 스키마를 한 번 더 로드하면 앞서 로드한 쪽의
 * `lintCommand` 가 조용히 새 스키마를 보는데 `VERSION` 은 안 바뀐다 —
 * **모듈이 자기 상태에 대해 거짓말을 한다.** 그리고 검사가 그걸 우회하려고
 * 경우마다 프로세스를 새로 띄워야 했다. 이음매가 프로세스 시작에 있었다는 뜻이다.
 *
 * 지금은 값이라 이음매가 인자다. 스키마 둘을 나란히 들 수 있다.
 */

/** 옵션 하나. `gen_schema.py` 가 optparse 트리에서 뽑은 그대로다. */
export interface Opt {
  /** 긴 플래그에서 `--` 를 뗀 것 (`write-subs`). 이 저장소에서 옵션을 가리키는 이름이다. */
  id: string;
  /** 긴 플래그. 메서드 이름이 여기서 나온다. */
  flag: string;
  /** 짧은 플래그. 명령어에 찍히는 건 있으면 이쪽이다. */
  short: string | null;
  /** 같은 옵션의 다른 긴 플래그 (`--ies` → `use-extractors`). */
  aliases: string[];
  /** 생애주기 단계 — `source` · `format` · `store` … */
  stage: string;
  /** yt-dlp `--help` 의 묶음 이름. */
  group: string;
  /** optparse 가 값을 담는 속성 이름. 값을 안 담는 옵션이면 `null`. */
  dest: string | null;
  /** 값을 받는 방식. */
  kind: OptKind;
  /** 도움말에 찍히는 값 자리 이름 (`FORMAT` · `FILE`). 값을 안 받으면 `null`. */
  metavar: string | null;
  /** 값 전체가 이 중 하나여야 한다. `--fixup never` */
  choices: string[] | null;
  /**
   * 값 **앞에** 붙는 종류의 목록. `-o thumbnail:%(id)s` 의 `thumbnail`.
   *
   * 값 자체는 자유 문자열(경로 · 템플릿 · 명령어)이라 `choices` 가 아니다.
   * 앞머리만 닫혀 있다.
   */
  keys: string[] | null;
  /**
   * 값이 **어휘 위의 작은 문법**인 것. `--recode-video "aac>mp3/mkv"`
   *
   * `choices` 로 쓰면 `aac>mp3` 가 오류로 잡힌다. 어휘는 자동완성이 쓰고,
   * 문법은 검증기가 본다.
   */
  rule: OptRule | null;
  /**
   * 값이 **자리 여럿인 구조**일 때, 자리마다의 어휘.
   *
   * `--cookies-from-browser BROWSER[+KEYRING][:PROFILE][::CONTAINER]` 하나뿐이다.
   * 문법은 `core/cookies.ts` 가 갖고 여기는 어휘만 온다.
   */
  vocabs: Record<string, string[]> | null;
  /**
   * optparse 가 값을 무엇으로 읽나 — `'string'` · `'int'` · `'float'` · `'choice'`.
   *
   * 값을 안 받는 옵션은 `null`. `int`·`float` 는 진짜 수라서 타입도 `number` 가
   * 된다. `string` 은 명령줄이 원래 다 문자열이라 별 뜻이 없다 —
   * `--audio-quality 0` 도 `string` 이다.
   */
  valueType: 'string' | 'int' | 'float' | 'choice' | null;
  /** optparse 의 기본값. 옵션마다 모양이 달라서 좁히지 않는다. */
  default: unknown;
  /** yt-dlp `--help` 의 설명 한 단락. `%default` 는 이미 채워져 있다. */
  help: string;
  /** `--no-part` 처럼 끄는 형태가 따로 있으면 그 플래그. */
  negation: string | null;
}

/**
 * 옵션이 값을 받는 방식.
 *
 * `flag` 는 값 없음, `value` 는 값 하나, `choice` 는 정해진 값 중 하나,
 * `repeatable` 은 여러 번 줄 수 있다.
 */
export type OptKind = 'flag' | 'value' | 'choice' | 'repeatable';

/**
 * `[원본>]대상(/[원본>]대상)*` — yt-dlp 의 `FFmpeg*PP.FORMAT_RE` 를 옮긴 것.
 *
 * `/` 로 이은 것은 선호 순서다(앞엣것부터). `원본>` 은 "이 확장자일 때만"이라
 * 어휘가 아니라 아무 확장자나 온다.
 */
export interface OptRule {
  /** 대상으로 쓸 수 있는 확장자. */
  vocab: string[];
  /** `원본>대상` 형태를 받나. `--merge-output-format` 만 안 받는다. */
  from: boolean;
}

/** 생애주기 단계. 사람이 읽을 이름을 붙이려고 손으로 채운 층이다. */
export interface Stage {
  /** 단계 이름 (`run` · `format` …). {@linkcode Opt.stage} 가 이걸 가리킨다. */
  id: string;
  /** 짧은 한국어 이름 (`실행`). */
  label: string;
  /** 이 단계가 정하는 것 한 줄 (`한 번의 실행 전체가 어떻게 동작할지`). */
  blurb: string;
  /** 이 단계에 드는 yt-dlp `--help` 묶음 이름들. */
  groups: string[];
}

/** 플래그 문자열 하나가 가리키는 것. 부정형이면 `negated` 가 참이다. */
export interface FlagHit {
  opt: Opt;
  negated: boolean;
}

/**
 * 스키마가 어떤 리플렉션에서 나왔나.
 *
 * `optparse` 는 `gen_schema.py` 가 yt-dlp 를 파이썬 모듈로 불러 옵션 객체를 직접
 * 읽은 것이고, `help` 는 `yt-dlp --help` 출력을 파싱한 것이다. 뒤엣것이 덜
 * 충실하다 — 별칭 일부와 `choices` 는 도움말에 글자로 안 나온다. 대신 어떤
 * 설치 형태에서도 된다.
 */
export type SchemaFrom = 'optparse' | 'help';

/** `gen_schema.py` 가 내놓는 JSON 그대로. */
export interface RawSchema {
  /** 리플렉션한 yt-dlp 의 버전 (`2026.07.04`). */
  ytdlp_version: string;
  /** 없으면 `optparse` 다 — 이 필드가 생기기 전 스키마가 그것뿐이었다. */
  source?: SchemaFrom;
  /** 생애주기 단계. 순서가 명령어가 처리되는 순서다. */
  stages: Stage[];
  /** 옵션 전부. `--help` 에서 숨긴 것은 없다. */
  options: Opt[];
}

/**
 * 색인까지 붙은 스키마 하나. 이 저장소에서 "스키마"는 이 값을 말한다.
 *
 * 읽기 전용으로 쓴다 — 만든 뒤에는 아무도 안 고친다. 그래서 여러 곳이 같은
 * 값을 나눠 가져도 서로를 오염시키지 않는다.
 */
export interface Schema {
  /** 이 스키마가 나온 yt-dlp 버전. */
  version: string;
  /** 어떤 리플렉션에서 나왔나. */
  from: SchemaFrom;
  /** 옵션 전부. {@linkcode RawSchema.options} 와 같은 순서다. */
  opts: readonly Opt[];
  /** 옵션 id → 옵션. */
  byId: Readonly<Record<string, Opt>>;
  /** 단계 id → 단계. */
  stage: Readonly<Record<string, Stage>>;
  /** 별칭·단축·부정형까지 전부. 검증기가 문자열을 되읽을 때 쓴다. */
  byFlag: Readonly<Record<string, FlagHit>>;
  /** 만들 때 받은 원본. `ytstudio types` 가 다시 써야 할 때 쓴다. */
  raw: RawSchema;
}

/** raw JSON → 색인 붙은 스키마. 순수 함수다. */
export function buildSchema(raw: RawSchema): Schema {
  const opts = raw.options;
  const byFlag: Record<string, FlagHit> = {};

  for (const o of opts) {
    byFlag[o.flag] = { opt: o, negated: false };
    if (o.short) byFlag[o.short] = { opt: o, negated: false };
    for (const a of o.aliases) byFlag[a] = { opt: o, negated: false };
    if (o.negation) byFlag[o.negation] = { opt: o, negated: true };
  }

  return {
    version: raw.ytdlp_version,
    from: raw.source ?? 'optparse',
    opts,
    byId: Object.fromEntries(opts.map(o => [o.id, o])),
    stage: Object.fromEntries(raw.stages.map(s => [s.id, s])),
    byFlag,
    raw,
  };
}
