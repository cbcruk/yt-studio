/**
 * 프롬프트 → 명령어.
 *
 * LLM 이 하는 일은 **한국어 의도를 yt-dlp 어휘로 옮기는 것**뿐이다. 맞는지는
 * 여기서 안 따진다 — 받아 온 문자열은 core/lint.js 가 실물 스키마와 진짜
 * 파서로 검사한다. 그래서 이 파일이 틀려도 조용히 틀리지는 않는다.
 *
 * 카탈로그를 통째로 넣는다. 191개를 도움말까지 붙여도 6천 토큰 남짓이라
 * 골라 넣을 이유가 없고, 고르는 순간 "왜 그건 안 줬나"가 우리 잘못이 된다.
 * 대신 그 블록은 매번 같으므로 프롬프트 캐시를 건다.
 *
 * fetch 를 인자로 받는다 — 브라우저 없이 단위 테스트가 된다.
 */
import { catalogText } from './catalog.js';

export const ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

/**
 * 고를 수 있는 모델.
 *
 * `effort` 는 모델마다 있고 없다 — Haiku 4.5 에 주면 400 이 온다. 그래서
 * 표에 같이 적어 둔다. 값이 있는 모델에는 `medium` 을 준다: 이 일은 한국어
 * 의도를 카탈로그의 플래그로 옮기는 번역이지 깊은 추론이 아니다.
 */
export const MODELS = [
  ['claude-sonnet-5', 'Sonnet 5 — 기본', { effort: 'medium' }],
  ['claude-haiku-4-5', 'Haiku 4.5 — 빠르고 싸다', {}],
  ['claude-opus-5', 'Opus 5 — 까다로운 요구', { effort: 'medium' }],
];
export const DEFAULT_MODEL = MODELS[0][0];
export const MODEL_OPTS = Object.fromEntries(MODELS.map(([id, , o]) => [id, o]));

const RULES = `너는 yt-dlp 명령어를 만드는 도구다. 아래 옵션 카탈로그는 사용자가 실제로 설치한
yt-dlp 를 리플렉션해서 뽑은 것이다. **카탈로그에 없는 플래그는 절대 쓰지 마라.**
기억에 있는 다른 플래그가 떠올라도, 카탈로그에 없으면 존재하지 않는 것이다.

지켜야 할 것:
- 요구에 필요한 옵션만 준다. 안 물어본 것을 얹지 않는다.
- 값이 있는 옵션은 카탈로그의 metavar 와 choices 를 따른다.
- 사용자가 URL 을 줬으면 그대로 쓰고, 안 줬으면 맨 끝에 URL 한 개를 둔다.
- 공백이나 특수문자가 든 값은 큰따옴표로 감싼다.
- \`-f\` 는 포맷 셀렉터 문법을(bv*[height<=1080]+ba/b), \`-o\` 는 출력 템플릿
  문법을(%(title)s.%(ext)s) 지킨다. \`-o\` 에는 %(ext)s 를 반드시 넣는다.

답의 형식 — 이것만 낸다:

\`\`\`
yt-dlp …
\`\`\`
한국어 한 문장으로 무엇을 왜 그렇게 했는지.`;

/** 캐시가 걸리는 고정 블록(카탈로그)과 그 앞의 규칙. */
export function systemBlocks(version, stages, byStage) {
  return [
    { type: 'text', text: RULES },
    {
      type: 'text',
      text: `# yt-dlp ${version} 옵션 카탈로그\n\n${catalogText(stages, byStage)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/** 지금 명령어가 있으면 "고쳐 줘" 로, 없으면 "만들어 줘" 로 묻는다. */
export function userText(prompt, current) {
  const want = String(prompt || '').trim();
  if (!current) return want;
  return `지금 명령어:\n\`\`\`\n${current}\n\`\`\`\n\n이걸 이렇게 고쳐 줘: ${want}`;
}

/**
 * 답에서 명령어를 꺼낸다.
 *
 * 형식을 지시해도 모델은 가끔 설명을 앞에 붙인다. 코드 펜스를 먼저 보고,
 * 없으면 yt-dlp 로 시작하는 줄을 찾는다. 줄바꿈 이어쓰기(`\`)는 편다.
 */
export function extractCommand(reply) {
  const s = String(reply || '');
  const fence = s.match(/```(?:[a-z]*\n)?([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const joined = body.replace(/\\\n\s*/g, ' ');
  const line = joined.split('\n').map(t => t.trim()).find(t => /^(yt-dlp|youtube-dl)\b/.test(t));

  const note = fence
    ? s.slice(fence.index + fence[0].length).trim().split('\n').map(t => t.trim()).filter(Boolean)[0] || ''
    : '';
  return { command: line || '', note };
}

/* ── 호출 ────────────────────────────────── */
export class AskError extends Error {
  constructor(message, { status = 0, kind = 'unknown' } = {}) {
    super(message);
    this.name = 'AskError';
    this.status = status;
    this.kind = kind;
  }
}

/** 상태 코드를 사람이 다음에 할 일로 옮긴다. */
export function describeStatus(status, detail) {
  if (status === 401 || status === 403) return ['auth', 'API 키가 거부됐다 — 키를 다시 확인할 것'];
  if (status === 429) return ['rate', '요청이 너무 잦다 — 잠시 뒤에 다시'];
  if (status === 400) return ['request', `요청이 거부됐다${detail ? ' — ' + detail : ''}`];
  if (status >= 500) return ['server', 'Anthropic 쪽 오류다 — 잠시 뒤에 다시'];
  return ['unknown', detail || `요청이 실패했다 (${status})`];
}

/**
 * Anthropic Messages API 를 브라우저에서 바로 부른다.
 *
 * 서버를 두지 않으므로 키는 사용자 것이고 사용자 브라우저에만 있다.
 * 그 대가로 CORS 를 여는 헤더가 필요하다 — 이름이 말하듯 위험을 알고 켜는 것이다.
 */
export async function ask({
  key, model = DEFAULT_MODEL, system, user, maxTokens = 4096, fetchImpl,
}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new AskError('이 환경에는 fetch 가 없다', { kind: 'env' });
  if (!key) throw new AskError('API 키가 없다', { kind: 'auth' });

  // max_tokens 는 생각과 답을 **합쳐서** 재는 한도다. Sonnet 5 · Opus 5 는
  // thinking 을 안 줘도 적응형으로 생각하므로, 답이 한 줄이라고 1024 로
  // 잡으면 생각하다가 잘려 명령어가 안 나온다.
  const opts = MODEL_OPTS[model] || {};
  const body = { model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }] };
  if (opts.effort) body.output_config = { effort: opts.effort };

  let res;
  try {
    res = await f(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AskError(`네트워크가 닿지 않는다 — ${e.message}`, { kind: 'network' });
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
    const [kind, msg] = describeStatus(res.status, detail);
    throw new AskError(msg, { status: res.status, kind });
  }

  const data = await res.json();

  // 200 이라고 답이 온 건 아니다. 안전 분류기가 거절하면 content 가 비고,
  // 한도에 걸리면 잘린 채로 온다. 둘 다 "명령어를 못 찾았다"로 뭉뚱그리면
  // 사용자가 무엇을 해야 하는지 알 수 없다.
  if (data.stop_reason === 'refusal') {
    throw new AskError('모델이 이 요구를 거절했다 — 다르게 물어볼 것', { kind: 'refusal' });
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (data.stop_reason === 'max_tokens') {
    throw new AskError('답이 길어서 잘렸다 — 요구를 나눠서 물어볼 것', { kind: 'truncated' });
  }
  return { text, usage: data.usage || null, model: data.model || model };
}

/* ── 키 보관 ─────────────────────────────── */
export const KEY_STORE = 'ytstudio.apikey';
export const MODEL_STORE = 'ytstudio.model';

/** 화면에 띄울 때는 끝 네 자리만. */
export const maskKey = k =>
  !k ? '' : k.length <= 12 ? '••••' : k.slice(0, 7) + '…' + k.slice(-4);
