/**
 * yt-dlp 옵션 스키마 파생.
 *
 * `gen_schema.py` 가 떨군 raw JSON 하나에서 색인들을 만든다.
 * `initSchema` 를 부르기 전에는 어떤 바인딩도 유효하지 않다.
 */

/** 옵션 하나. `gen_schema.py` 가 optparse 트리에서 뽑은 그대로다. */
export interface Opt {
  id: string;
  /** 긴 플래그. 메서드 이름이 여기서 나온다. */
  flag: string;
  /** 짧은 플래그. 명령어에 찍히는 건 있으면 이쪽이다. */
  short: string | null;
  aliases: string[];
  /** 생애주기 단계 — `source` · `format` · `store` … */
  stage: string;
  /** yt-dlp `--help` 의 묶음 이름. */
  group: string;
  dest: string | null;
  kind: OptKind;
  metavar: string | null;
  choices: string[] | null;
  default: unknown;
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

/** 생애주기 단계. 사람이 읽을 이름을 붙이려고 손으로 채운 층이다. */
export interface Stage {
  id: string;
  label: string;
  blurb: string;
  groups: string[];
}

/** 플래그 문자열 하나가 가리키는 것. 부정형이면 `negated` 가 참이다. */
export interface FlagHit {
  opt: Opt;
  negated: boolean;
}

/** `gen_schema.py` 가 내놓는 JSON 그대로. */
export interface RawSchema {
  ytdlp_version: string;
  stages: Stage[];
  options: Opt[];
}

export let OPTS: Opt[] = [];
export let BY_ID: Record<string, Opt> = {};
export let STAGE: Record<string, Stage> = {};
/** 별칭·단축·부정형까지 전부. 검증기가 문자열을 되읽을 때 쓴다. */
export let BY_FLAG: Record<string, FlagHit> = {};
export let VERSION = '';

export function initSchema(raw: RawSchema): void {
  VERSION = raw.ytdlp_version;
  OPTS = raw.options;
  BY_ID = Object.fromEntries(OPTS.map(o => [o.id, o]));
  STAGE = Object.fromEntries(raw.stages.map(s => [s.id, s]));

  BY_FLAG = {};
  for (const o of OPTS) {
    BY_FLAG[o.flag] = { opt: o, negated: false };
    if (o.short) BY_FLAG[o.short] = { opt: o, negated: false };
    for (const a of o.aliases) BY_FLAG[a] = { opt: o, negated: false };
    if (o.negation) BY_FLAG[o.negation] = { opt: o, negated: true };
  }
}
