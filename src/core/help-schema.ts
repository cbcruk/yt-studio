/**
 * `yt-dlp --help` → 스키마.
 *
 * `gen_schema.py` 는 yt-dlp 를 **파이썬 모듈로 불러** optparse 트리를 읽는다.
 * 그게 더 정확하지만 손님 환경에서는 대체로 못 돈다 — `brew install yt-dlp` 도,
 * 독립 실행 바이너리도, pipx 도 `import yt_dlp` 가 실패한다. 그래서 손님 쪽은
 * 어떤 설치 형태에서도 되는 길을 쓴다: 바이너리에게 도움말을 물어보는 것.
 *
 * 도움말은 사람용 출력이라 안정성 보장이 없다. 그래서 이 파서는 두 가지로
 * 자신을 지킨다.
 *
 *   · **번들 스키마를 기준선으로 삼는다.** 이름이 같은 옵션은 도움말이 못 주는
 *     것(`choices` · 나머지 별칭 · `dest` · `repeatable` 여부)을 거기서 물려받는다.
 *     그래서 손해는 **새로 생긴 옵션에만** 남는다.
 *   · **너무 많이 사라지면 거부한다.** 서식이 바뀌어 파서가 세 개만 뽑아 놓고
 *     성공했다고 말하는 게 제일 나쁘다 — 손님의 모든 플래그가 오탈자가 된다.
 *     판단은 부르는 쪽이 하고, 여기서는 사라진 목록을 준다.
 */
import type { Opt, OptKind, RawSchema, Stage } from './schema.js';

/**
 * 도움말의 줄 종류.
 *
 * 2026.07.04 기준으로 그룹은 2칸, 옵션은 4칸, 설명이 이어지는 줄은 36칸
 * 들여쓰기다. 설명 시작 칼럼(36)에 기대지 않으려고 이어지는 줄은 "많이 들여쓴
 * 줄"로만 본다 — optparse 가 칼럼을 옮겨도 견딘다.
 */
const GROUP = /^ {2}(\S.*?):\s*$/;
const OPTION = /^ {4}(-{1,2}\S(?:\S|[ ](?![ ]))*)(?:\s{2,}(.*))?\s*$/;
const CONT = /^ {8,}(\S.*?)\s*$/;

/** `-I, --playlist-items ITEM_SPEC` 한 줄. 긴 플래그가 없는 옵션은 안 받는다. */
const DECL = /^(?:(-[^-,\s]),\s*)?(--[\w-]+)(?:[ =](.+))?$/;

/** 도움말 본문 끝의 `(Alias: --a, --b)`. 도움말이 별칭을 흘리는 유일한 자리다. */
const ALIAS = /\(Alias:\s*([^)]+)\)/;

/** 도움말에서 바로 읽어낸 것. 아직 스키마가 아니다. */
interface Parsed {
  flag: string;
  short: string | null;
  metavar: string | null;
  group: string;
  help: string;
  aliases: string[];
}

/**
 * 접힌 설명을 원래 한 줄로 되편다.
 *
 * optparse 는 textwrap 으로 설명을 접는데, **낱말 경계에서만 접지 않는다.**
 * 하이픈에서도 접고(`--convert-` / `subtitles)`), 낱말 하나가 폭보다 길면
 * 그 낱말을 잘라서라도 접는다(`…sponsor.ajay.a` / `pp/w/…`). 그냥 공백으로
 * 이어 붙이면 플래그 이름과 URL 한가운데에 공백이 생긴다.
 *
 * 그래서 두 자리에서만 공백 없이 붙인다.
 *
 *   · 앞 줄이 하이픈으로 끝난다 — 하이픈에서 접은 것이다
 *   · 앞 줄이 폭을 꽉 채웠고, 앞뒤 토막을 이으면 폭보다 길다 — 낱말이 잘린 것이다
 *
 * 둘째 조건에 "폭보다 길다"가 붙는 이유는, 폭을 꽉 채운 줄 대부분은 그냥 낱말
 * 단위로 넘어간 것이기 때문이다(이 판에서 65줄 중 64줄).
 */
function glued(prev: string, cur: string, width: number): boolean {
  if (prev.endsWith('-')) return true;
  if (prev.length < width) return false;
  const tail = prev.slice(prev.lastIndexOf(' ') + 1);
  const head = cur.split(' ')[0] ?? '';
  return tail.length + head.length > width;
}

/** 접힌 줄들을 한 줄로. `width` 는 도움말 전체에서 잰 본문 폭이다. */
function unwrap(parts: string[], width: number): string {
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!, cur = parts[i]!;
    out += (glued(prev, cur, width) ? '' : ' ') + cur;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `--no-foo` · `--yes-foo` → `['foo', 'no' | 'yes']`. `gen_schema.py` 와 같은 규칙. */
function baseName(flag: string): [string, 'no' | 'yes' | null] {
  const n = flag.replace(/^-+/, '');
  if (n.startsWith('no-')) return [n.slice(3), 'no'];
  if (n.startsWith('yes-')) return [n.slice(4), 'yes'];
  return [n, null];
}

/** 도움말 줄을 훑어 옵션 선언을 모은다. */
function scan(help: string, width: number): Parsed[] {
  const out: Parsed[] = [];
  let group = '';
  let cur: { p: Parsed; lines: string[] } | null = null;

  const flush = (): void => {
    if (!cur) return;
    const text = unwrap(cur.lines, width);
    const m = ALIAS.exec(text);
    if (m) cur.p.aliases = m[1]!.split(/,\s*/).map(s => s.trim()).filter(s => s.startsWith('--'));
    cur.p.help = text;
    out.push(cur.p);
    cur = null;
  };

  for (const line of help.split('\n')) {
    const c = CONT.exec(line);
    if (c && cur) { cur.lines.push(c[1]!); continue; }

    const o = OPTION.exec(line);
    if (o) {
      flush();
      const d = DECL.exec(o[1]!.trim());
      // 긴 플래그가 없는 줄은 건너뛴다 — gen_schema.py 도 그렇게 한다
      if (!d) continue;
      cur = {
        p: {
          flag: d[2]!, short: d[1] ?? null, metavar: d[3]?.trim() ?? null,
          group, help: '', aliases: [],
        },
        lines: o[2] ? [o[2]] : [],
      };
      continue;
    }

    const g = GROUP.exec(line);
    if (g) { flush(); group = g[1]!; }
  }
  flush();
  return out;
}

/**
 * `--foo` 와 `--no-foo` 를 컨트롤 하나로 접는다.
 *
 * 빌더에 `.noPart()` 가 따로 없는 이유가 이것이다 — 스키마가 `--no-part` 를
 * `part` 의 negation 으로 들고 있으므로 `.part(false)` 하나면 된다. 메서드를
 * 또 만들면 같은 옵션에 이름이 둘 생긴다.
 */
function fold(list: Parsed[]): Array<Parsed & { negation: string | null }> {
  const byBase = new Map<string, Array<[Parsed, 'no' | 'yes' | null]>>();
  for (const p of list) {
    const [base, pol] = baseName(p.flag);
    const arr = byBase.get(base) ?? [];
    arr.push([p, pol]);
    byBase.set(base, arr);
  }

  const out: Array<Parsed & { negation: string | null }> = [];
  for (const arr of byBase.values()) {
    const pos = arr.filter(([, p]) => p === null).map(([o]) => o);
    const neg = arr.filter(([, p]) => p === 'no').map(([o]) => o);
    const yes = arr.filter(([, p]) => p === 'yes').map(([o]) => o);

    if (pos.length && (neg.length || yes.length)) {
      out.push({ ...pos[0]!, negation: (neg[0] ?? yes[0])!.flag });
    } else if (neg.length && yes.length) {
      // --no-playlist / --yes-playlist 처럼 양쪽 다 부정형인 경우
      out.push({ ...neg[0]!, negation: yes[0]!.flag });
    } else {
      for (const o of arr) out.push({ ...o[0], negation: null });
    }
  }
  return out;
}

/** 그룹 이름 → 단계. 매핑은 번들 스키마가 `stages[].groups` 로 이미 들고 있다. */
function stageOf(stages: Stage[], group: string): string | null {
  for (const s of stages) if (s.groups.includes(group)) return s.id;
  return null;
}

/** 도움말이 준 것만으로 정한 종류. 값을 받으면 `value`, 아니면 `flag`. */
function kindOf(metavar: string | null): OptKind {
  return metavar ? 'value' : 'flag';
}

export interface HelpResult {
  schema: RawSchema;
  /** 번들에 없던 플래그. */
  added: string[];
  /** 번들에 있었는데 도움말에 없는 플래그. 여기가 크면 파서가 깨진 것이다. */
  removed: string[];
  /** 어느 단계에도 안 걸린 그룹 이름. 새 그룹이 생기면 여기 뜬다. */
  unmappedGroups: string[];
}

/**
 * 도움말 한 판을 스키마로.
 *
 * `base` 는 패키지에 실려 온 스키마다. 단계 매핑과, 도움말이 못 주는 값들을
 * 거기서 가져온다 — 사본을 만들지 않으려고 그렇게 한다.
 */
export function parseHelp(help: string, version: string, base: RawSchema): HelpResult {
  const known = new Map(base.options.map(o => [o.flag, o]));
  const unmapped = new Set<string>();

  // 본문 폭은 optparse 가 정한다. 한 판을 통째로 재서 쓰면 서식이 바뀌어도 따라간다.
  let width = 0;
  for (const line of help.split('\n')) {
    const c = CONT.exec(line);
    if (c) width = Math.max(width, c[1]!.length);
  }

  const options: Opt[] = fold(scan(help, width)).map(p => {
    const prev = known.get(p.flag);
    const stage = prev?.stage ?? stageOf(base.stages, p.group);
    if (!stage) unmapped.add(p.group);

    const kind = kindOf(p.metavar);
    // 도움말은 choices 도, "여러 번 줄 수 있다"도 제대로 안 흘린다. 값을 받는
    // 옵션이라는 것까지만 맞으면 더 자세한 쪽(번들)을 믿는다.
    const richer = prev && kind !== 'flag' && prev.kind !== 'flag' ? prev.kind : kind;

    return {
      id: p.flag.replace(/^-+/, ''),
      flag: p.flag,
      short: p.short ?? prev?.short ?? null,
      // 도움말은 별칭 28개 중 19개만 (Alias: …) 로 흘린다. 그나마도 일부만
      // 적힌 것이 있어서(--convert-subs) 합집합을 쓴다 — 어느 쪽도 안 버린다.
      aliases: [...new Set([...(prev?.aliases ?? []), ...p.aliases])],
      // 새 그룹이면 갈 곳이 없다. 버리는 것보다 실행 단계에 두고 알리는 게 낫다
      stage: stage ?? base.stages[0]!.id,
      group: p.group,
      dest: prev?.dest ?? null,
      kind: richer,
      // 값을 안 받는 옵션인데 optparse 에는 metavar 가 달린 경우가 있다
      // (--format-sort-force). 도움말에는 안 나오므로 번들에서 물려받는다.
      metavar: p.metavar ?? prev?.metavar ?? null,
      // 고를 수 있는 값은 도움말에 사람 말로만 있다 — `(currently supported:
      // best (default), aac, …)` 처럼 괄호가 겹쳐서 캐면 부서진다. 값을 받는
      // 옵션이라는 것까지만 맞으면 번들의 목록을 그대로 쓴다.
      choices: prev && richer !== 'flag' ? prev.choices : null,
      keys: prev && richer !== 'flag' ? prev.keys : null,
      rule: prev && richer !== 'flag' ? prev.rule : null,
      vocabs: prev && richer !== 'flag' ? prev.vocabs : null,
      default: prev?.default ?? null,
      help: p.help,
      negation: p.negation,
    };
  });

  const order = base.stages.map(s => s.id);
  options.sort((a, b) =>
    order.indexOf(a.stage) - order.indexOf(b.stage) || a.id.localeCompare(b.id));

  const now = new Set(options.map(o => o.flag));
  return {
    schema: { ytdlp_version: version, source: 'help', stages: base.stages, options },
    added: options.filter(o => !known.has(o.flag)).map(o => o.flag),
    removed: base.options.filter(o => !now.has(o.flag)).map(o => o.flag),
    unmappedGroups: [...unmapped],
  };
}
