/**
 * 코드로 쓰는 yt-dlp 명령어.
 *
 * 이 저장소는 입력을 세 번 바꿨다 — 노드 그래프, 프롬프트, 그리고 코드. 세 번
 * 다 살아남은 건 **리플렉션한 스키마와 진짜 파서**였고, 여기서는 그 둘을 그대로
 * 뒤집어 쓴다. 읽는 파서를 이미 갖고 있으니 쓰는 쪽은 컴파일러만 부르면 된다.
 *
 *   parseFormat   문자열 → 트리   검증기가 쓴다
 *   emitTree      트리 → 문자열   빌더가 쓴다
 *
 * 그래프가 안 맞았던 이유가 여기서 뒤집힌다. yt-dlp 명령어는 평평한 플래그
 * 목록이라 엣지가 할 일이 없었는데, 메서드 체인에는 애초에 엣지가 없다. 값이
 * 구조를 갖는 셋(`-f` 식 · `-o` 수열 · `-P` 집합)만 따로 문법을 준다.
 * 그 판단의 근거는 docs/builder.md 에 있다.
 *
 * 옵션 188개는 **스키마에서 자란다** — 손으로 적은 목록이 없다. 타입도 같은
 * 곳에서 나온다(gen_options.mjs). 그래서 사용자가 깐 yt-dlp 에 없는 옵션은
 * 자동완성에 뜨지 않고, 런타임과 타입이 어긋날 수도 없다.
 *
 * DOM 도 파일 시스템도 모른다. `initSchema` 가 먼저 불려 있어야 한다.
 */
import { BY_ID, OPTS } from './schema.js';
import { SELECTORS, emitTree } from './format-grammar.js';
import { FIELDS, emitPiece } from './output-template.js';
import { lintCommand } from './lint.js';
import { quote } from './command.js';
import type { Opt } from './schema.js';
import { methodName, selMethod } from './env-types.js';

import type { Filter, FormatNode, FormatOp } from './format-grammar.js';
import type { Piece as OutNode } from './output-template.js';
import type { Issue } from './lint.js';

import type {
  Arg, Conversion, Filters, FormatFactory as GenFactory, NumCond,
  OutFields, OutType, Options, PathMap, StrCond,
} from './options.gen.js';

export type {
  Arg, Conversion, Filters, NumCond, OutField, OutType, PathMap, Selector, StrCond, Version,
} from './options.gen.js';
export type { Filter, FormatNode } from './format-grammar.js';
export type { Issue } from './lint.js';

const SEL_NAMES = SELECTORS.flatMap(([, items]) => items.map(([k]) => k));
const FIELD_NAMES = FIELDS.flatMap(([, items]) => items.map(([k]) => k));

// 이름 규칙은 생성기와 **같아야 한다**. 여기서 런타임 메서드 이름을, 저기서
// 타입 이름을 만드는데 둘이 어긋나면 타입은 있고 메서드는 없는 칸이 생긴다.
// 그래서 규칙 자체는 env-types.ts 에 한 벌만 두고 여기서는 내보내기만 한다.
export { methodName, selMethod };

/**
 * 명령어에 실제로 찍히는 형태.
 *
 * 짧은 게 있으면 짧은 것을 쓴다 — 사람이 손으로 쓰는 모양이 그쪽이고, 검사
 * 결과에 뜨는 플래그와도 같아야 눈으로 대조가 된다. 메서드 **이름**은 긴 쪽에서
 * 나온다(`-f` 가 아니라 `.format()`) — 코드는 읽으라고 있다.
 */
const flagOf = (opt: Opt): string => opt.short || opt.flag;

const optOf = (id: string): Opt => BY_ID[id];

const COND_OPS: Record<string, string> = {
  lt: '<', lte: '<=', gt: '>', gte: '>=', eq: '=', ne: '!=',
  startsWith: '^=', endsWith: '$=', includes: '*=', matches: '~=',
  notStartsWith: '!^=', notEndsWith: '!$=', notIncludes: '!*=', notMatches: '!~=',
};

/**
 * 필터 객체 → 필터 목록.
 *
 * 값을 그냥 주면 `=` 다. 문자열 비교가 열 가지라 매번 연산자를 적게 하면
 * 제일 흔한 경우(`ext: 'mp4'`)가 제일 시끄러워진다.
 */
export function toFilters(spec?: Filters): Filter[] {
  const out: Filter[] = [];
  for (const [key, v] of Object.entries(spec || {})) {
    if (v == null) continue;
    // `loose` 를 늘 채운다 — parseFilterBody 가 그렇게 낸다. 한 칸이라도
    // 다르면 "빌더 트리 = 파서 트리"가 깨진다.
    if (v === true) { out.push({ key, op: 'has', loose: false, value: '' }); continue; }
    if (v === false) { out.push({ key, op: 'hasnot', loose: false, value: '' }); continue; }
    if (typeof v !== 'object') { out.push({ key, op: '=', loose: false, value: String(v) }); continue; }

    const { loose, ...rest } = v as NumCond & StrCond;
    for (const [name, value] of Object.entries(rest)) {
      const op = COND_OPS[name];
      if (!op) throw new TypeError(`${key} 에 모르는 비교다: ${name}`);
      out.push({ key, op, loose: !!loose, value: String(value) });
    }
  }
  return out;
}

/**
 * 식 노드 하나를 감싼 것.
 *
 * 안에 든 트리가 `parseFormat` 이 내놓는 것과 **같은 모양**이다. 그래서 빌더로
 * 쓴 식과 문자열로 받은 식을 같은 자리에서 다룰 수 있다 — 읽기와 쓰기가 한
 * 문법을 공유한다는 뜻이고, 단위 테스트가 deepEqual 로 그걸 지킨다.
 */
export class Expr {
  constructor(readonly node: FormatNode) {}

  private op(t: FormatOp, rest: Expr[]): Expr {
    const kids = [this.node, ...rest.map(r => r.node)];
    // 같은 연산자가 이어지면 한 노드로 눕힌다 — a.plus(b).plus(c) 는
    // ((a+b)+c) 가 아니라 a+b+c 로 나와야 손으로 쓴 것과 같아진다.
    // 필터가 붙은 노드는 제 괄호를 쓰고 나오므로 안 눕힌다.
    const flat = this.node.t === t && !(this.node.filters || []).length
      ? [...(this.node as { kids: FormatNode[] }).kids, ...kids.slice(1)]
      : kids;
    // 필터가 없으면 칸 자체를 안 만든다 — parseFormat 이 그렇게 낸다. 한 칸이라도
    // 다르면 "빌더 트리 = 파서 트리"가 깨진다.
    return new Expr({ t, kids: flat });
  }

  /** `+` — 영상과 음성을 합친다. */
  plus(...rest: Expr[]): Expr { return this.op('merge', rest); }
  /** `/` — 앞엣것이 없으면 뒤엣것. */
  or(...rest: Expr[]): Expr { return this.op('fallback', rest); }
  /** `,` — 둘 다 받는다. */
  also(...rest: Expr[]): Expr { return this.op('multi', rest); }

  /** 식 전체에 필터를 건다 — 괄호는 `emitTree` 가 알아서 붙인다. */
  where(spec: Filters): Expr {
    return new Expr({ ...this.node, filters: [...(this.node.filters || []), ...toFilters(spec)] });
  }

  toString(): string { return emitTree(this.node); }
}

export interface FormatFactory extends GenFactory<Expr> {}

/** 셀렉터마다 메서드 하나. 목록은 `SELECTORS` 에서 자란다. */
export function formatFactory(): FormatFactory {
  const f: Record<string, unknown> = {
    raw: (s: string) => new Expr({ t: 'sel', name: String(s), filters: [] }),
  };
  for (const name of SEL_NAMES) {
    f[selMethod(name)] = (spec?: Filters) =>
      new Expr({ t: 'sel', name, filters: toFilters(spec) });
  }
  return f as unknown as FormatFactory;
}

/** `%(upload_date>%Y-%m-%d|Unknown)s` 한 칸. `output-template.ts` 의 필드 조각이다. */
export type FieldPiece = Extract<OutNode, { t: 'field' }>;
export type { OutNode };

export class Piece {
  constructor(readonly p: FieldPiece) {}
  private with(patch: Partial<FieldPiece>): Piece { return new Piece({ ...this.p, ...patch }); }

  /** `|` — 값이 없을 때 대신 쓸 것. */
  or(fallback: string): Piece { return this.with({ fallback: String(fallback) }); }
  /** `>` — 날짜 서식 (`%Y-%m-%d`). */
  date(strf: string): Piece { return this.with({ strf: String(strf) }); }
  /** `.40S` — 자르고 파일명 안전하게. */
  trunc(n: number): Piece { return this.with({ fmt: `.${n}`, conv: 'S' }); }
  /** `%(playlist_index)03d` — 0으로 채운다. */
  pad(n: number, conv: Conversion = 'd'): Piece { return this.with({ fmt: `0${n}`, conv }); }
  /** 변환 글자를 직접. */
  as(conv: Conversion): Piece { return this.with({ conv }); }

  toString(): string { return emitPiece(this.p); }
}

const field = (name: string): Piece =>
  new Piece({ t: 'field', name, strf: '', fallback: null, fmt: '', conv: 's' });

export class Template {
  constructor(readonly pieces: OutNode[]) {}
  toString(): string { return this.pieces.map(emitPiece).join(''); }
}

/** 태그드 템플릿 + 필드 접근자. `-o` 는 원래가 템플릿이라 이게 제일 맞는다. */
export interface OutTag extends OutFields<Piece> {
  (strings: TemplateStringsArray, ...values: (Piece | string | number)[]): Template;
  /** 카탈로그에 없는 필드. */
  field(name: string): Piece;
}

export function outTag(): OutTag {
  const tag = (strings: TemplateStringsArray, ...values: (Piece | string | number)[]) => {
    const pieces: OutNode[] = [];
    strings.forEach((s, i) => {
      if (s) pieces.push({ t: 'text', text: s });
      if (i < values.length) {
        const v = values[i];
        pieces.push(v instanceof Piece ? v.p : { t: 'text', text: String(v) });
      }
    });
    return new Template(pieces);
  };
  (tag as unknown as OutTag).field = (name: string) => field(String(name));
  for (const name of FIELD_NAMES) {
    Object.defineProperty(tag, name, { get: () => field(name), enumerable: true });
  }
  return tag as unknown as OutTag;
}

interface Part { id: string; flag: string; value?: string }

// -f · -o · -P 는 값 자체가 구조라 손으로 쓴 메서드가 맡는다.
const HAND_WRITTEN = new Set(['format', 'output', 'paths']);

/**
 * 스키마에서 자란 188개 메서드가 여기 합쳐진다.
 *
 * 클래스와 인터페이스 선언 병합 — 런타임은 `grow()` 가 프로토타입에 심고,
 * 타입은 생성기가 낸다. 둘 다 스키마 한 곳에서 나오므로 어긋날 수 없다.
 */
export interface Ytdlp extends Options {}

export class Ytdlp {
  urls: string[] = [];
  parts: Part[] = [];                  // 쓴 순서 그대로 나간다

  constructor(urls: string[] = []) { this.url(...urls); }

  /** URL 을 더한다. 늘 명령어 끝에 온다. */
  url(...urls: string[]): this {
    for (const u of urls) if (u) this.urls.push(String(u));
    return this;
  }

  /**
   * 플래그 하나를 자리에 놓는다.
   *
   * 같은 옵션을 두 번 주면 **자리를 지키며 덮어쓴다.** 뒤에 붙이면 코드에서
   * 고친 순서가 명령어 순서를 바꿔서, 한 줄 고쳤는데 diff 가 두 줄 난다.
   * repeatable 만 쌓인다.
   */
  place(id: string, flag: string, value?: string): this {
    if (optOf(id).kind !== 'repeatable') {
      const at = this.parts.findIndex(p => p.id === id);
      if (at >= 0) { this.parts[at] = { id, flag, value }; return this; }
    }
    this.parts.push({ id, flag, value });
    return this;
  }

  drop(id: string): this {
    this.parts = this.parts.filter(p => p.id !== id);
    return this;
  }

  /**
   * `-f` — 포맷 셀렉터.
   *
   *     .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
   *     → -f "bv[height<=1080]+ba/b"
   */
  format(build: (f: FormatFactory) => Expr): this;
  /** `-f` 를 문자열로 직접. 문법은 `.lint()` 가 본다. */
  format(selector: string): this;
  format(arg: string | ((f: FormatFactory) => Expr)): this {
    const v = typeof arg === 'function' ? String(arg(formatFactory())) : String(arg);
    return this.place('format', flagOf(optOf('format')), v);
  }

  /**
   * `-o` — 출력 템플릿.
   *
   *     .output(t => t`${t.title} [${t.id}].${t.ext}`)
   *     → -o "%(title)s [%(id)s].%(ext)s"
   */
  output(build: (t: OutTag) => Template): this;
  /** 종류별 템플릿 (`thumbnail:…`). */
  output(type: OutType, build: (t: OutTag) => Template): this;
  /** `-o` 를 문자열로 직접. */
  output(template: string): this;
  output(a: unknown, b?: unknown): this {
    const [type, arg] = b === undefined ? ['', a] : [a as string, b];
    const body = typeof arg === 'function'
      ? (arg as (t: OutTag) => Template)(outTag()) : arg;
    const text = String(body);
    return this.place('output', flagOf(optOf('output')), type ? `${type}:${text}` : text);
  }

  /** `-P` — 종류별 저장 경로. */
  paths(map: PathMap): this {
    for (const [type, path] of Object.entries(map || {})) {
      if (path == null) continue;
      this.place('paths', flagOf(optOf('paths')), type === 'home' ? String(path) : `${type}:${path}`);
    }
    return this;
  }

  /** 지금까지 쌓은 것을 그대로 복사한다. */
  clone(): Ytdlp {
    const c = new Ytdlp();
    c.urls = [...this.urls];
    c.parts = this.parts.map(p => ({ ...p }));
    return c;
  }

  /** `spawn` 에 넘길 argv. 따옴표를 안 붙인다 — 셸을 안 거치므로 붙이면 값에 남는다. */
  toArray(): string[] {
    const out: string[] = [];
    for (const p of this.parts) {
      out.push(p.flag);
      if (p.value !== undefined) out.push(String(p.value));
    }
    return [...out, ...this.urls];
  }

  /** 셸에 붙여넣을 한 줄. 공백이 든 값은 따옴표로 감싼다. */
  build(): string {
    const toks: string[] = [];
    for (const p of this.parts) {
      toks.push(p.flag);
      if (p.value !== undefined) toks.push(quote(String(p.value)));
    }
    return ['yt-dlp', ...toks, ...this.urls].join(' ');
  }

  /**
   * 만든 명령어를 검증기에 돌린다.
   *
   * 타입이 이미 없는 플래그와 choices 를 막았으므로 여기 남는 건 **조합**이다 —
   * `-x` 인데 `-f` 가 영상 전용이라든가, `--embed-subs` 만 있고 자막은 안 받는다든가.
   * 타입이 못 보는 층이라 빌더가 있어도 검증기가 없어지지 않는다.
   */
  lint(): { ok: boolean; issues: Issue[] } {
    const { ok, issues } = lintCommand(this.build());
    return { ok, issues };
  }

  toString(): string { return this.build(); }
}

/**
 * 188개 메서드를 스키마에서 기른다.
 *
 * 손으로 적은 목록이 없다는 게 요점이다 — yt-dlp 가 옵션을 더하면
 * `gen_schema.py` 와 `gen_options.mjs` 를 다시 돌리는 것만으로 메서드와 타입이
 * 같이 생긴다.
 *
 * 첫 `ytdlp()` 때 기른다. 모듈 본문에서 하면 `initSchema` 보다 먼저 돌아서
 * 아무것도 안 생긴다 — ESM 은 본문보다 import 를 먼저 실행한다.
 */
let grown = -1;

export function grow(): void {
  if (grown === OPTS.length) return;
  const proto = Ytdlp.prototype as unknown as Record<string, unknown>;

  for (const opt of OPTS) {
    if (HAND_WRITTEN.has(opt.id)) continue;

    proto[methodName(opt.flag)] =
      opt.kind === 'flag'
        ? function (this: Ytdlp, on = true) {
          if (on) return this.place(opt.id, flagOf(opt));
          // 부정형이 있으면 명시적으로 끄고, 없으면 끄는 길이 "안 주는 것"뿐이다
          return opt.negation ? this.place(opt.id, opt.negation) : this.drop(opt.id);
        }
        : opt.kind === 'repeatable'
          ? function (this: Ytdlp, ...values: Arg[]) {
            for (const v of values) this.place(opt.id, flagOf(opt), String(v));
            return this;
          }
          : function (this: Ytdlp, value: Arg) {
            return this.place(opt.id, flagOf(opt), String(value));
          };
  }
  grown = OPTS.length;
}

/** 새 명령어를 시작한다. */
export function ytdlp(...urls: string[]): Ytdlp {
  grow();
  return new Ytdlp(urls);
}
