/**
 * 노드 본문 템플릿.
 *
 * 노드 안쪽에 무엇이 그려지는지는 전부 여기 있다. 본문은 노드를 받아
 * lit-html 템플릿을 돌려준다 — DOM 은 만지지 않는다. 노드 하나가 통째로
 * 템플릿이라 다시 그려도 DOM 이 그대로 남고, 포커스도 캐럿도 조합 중인
 * 음절도 브라우저가 알아서 지킨다.
 *
 * 어휘·문법·컴파일러는 core/ 에서 그대로 가져다 쓴다. 앱에서 받아 오는
 * 것은 다섯 가지뿐이고, 그게 이 파일이 앱에 지는 빚 전부다 (installBodies).
 *
 *   state → S()          지금 상태. 앱이 다시 대입하므로 값이 아니라 게터로 받는다
 *   ui → UI              편집 중인 UI 상태 (열린 피커, 강조 중인 옵션)
 *   render → redraw()    값을 바꾼 뒤 부른다
 *   enterSubgraph → openSub()   옵션 행에 달리는 서브그래프 문
 *   paintLit → paintOpt()       옵션 ↔ 명령어 토큰 상호 강조 (클래스만 건드린다)
 */
import { BY_STAGE, search } from '../core/schema.js';
import { filtersOf, valuesOf } from '../core/graph.js';
import {
  EXIST_OPS, FKEYS, FKEY_TYPE, FORMAT_OPS, NUM_OPS, SELECTORS, SEL_HELP, SEL_SET,
  STR_OPS, emitTree,
} from '../core/format-grammar.js';
import { formatExpr, formatIssues, graphToTree, operands } from '../core/format-graph.js';
import {
  CONVERSIONS, FIELDS, FIELD_HELP, FIELD_SET, OUT_TYPES, STRF_PRESETS, emitPiece,
} from '../core/output-template.js';
import { outputExpr, outputIssues, outputPreview } from '../core/output-graph.js';
import { PATH_TYPES, joinEntry, pathsExpr, pathsIssues } from '../core/paths-graph.js';
import { buildTokens, urlList } from '../core/pipeline.js';
import { html, nothing, repeat } from './tpl.js';
import { blurbOf, defineBody, labelOf, tagOf, tagOfType } from './node-kinds.js';
import { subgraphFor } from './graph-kinds.js';

/* ══ 앱에서 받아 오는 것 ══════════════════════ */
// 배포 빌드는 모듈을 한 스코프로 합치므로 app.js 와 이름이 겹치면 안 된다.
// 그래서 ui·render 를 그 이름 그대로 쓰지 않는다.
let S = () => null;          // 지금 상태
let UI = {};                 // 편집 중인 UI 상태 — 열린 피커, 강조 중인 옵션
let redraw = () => {};       // 값을 바꾼 뒤 부른다
let openSub = () => {};      // 옵션 행의 서브그래프 문
let paintOpt = () => {};     // 옵션 ↔ 명령어 토큰 상호 강조

/** 앱이 호스트를 넘겨 본문을 등록한다. app.js 가 한 번 부른다. */
export function installBodies(host) {
  S = host.state;
  UI = host.ui;
  redraw = host.render;
  openSub = host.enterSubgraph;
  paintOpt = host.paintLit;
  registerBodies();
}

/* ══ 본문 템플릿 ═════════════════════════════
   본문은 전부 lit-html 템플릿을 돌려준다. 노드 하나가 통째로 템플릿이므로
   다시 그려도 DOM 이 그대로 남는다 — 포커스도, 캐럿도, 조합 중인 음절도
   브라우저가 알아서 지킨다. 손으로 포커스를 담았다 되돌리는 기구는 없다. */

/** <select> 안의 한 항목.
 *
 *  select 에 .value 를 걸면 안 된다. lit 은 자식 <option> 을 붙이기 전에
 *  프로퍼티를 커밋하므로, 첫 렌더에서 값이 늘 첫 항목으로 떨어진다.
 *  고르는 쪽을 option 의 .selected 로 뒤집으면 붙는 순서대로 맞아 들어간다. */
const opt = (v, label, cur) =>
  html`<option value=${v} .selected=${v === cur}>${label}</option>`;

/* ── 파이프라인 옵션 행 ──────────────────── */
function triControl(n, o) {
  const cur = valuesOf(n)[o.id];
  const states = o.negation
    ? [['켜기', true, o.flag], ['끄기', false, o.negation]]
    : [['켜기', true, o.flag]];
  return html`<div class="tri">${states.map(([label, val, tip]) => html`
    <button type="button" title=${tip} data-ctl=${`tri:${o.id}:${val}`}
            aria-pressed=${String(cur === val)}
            @click=${() => { valuesOf(n)[o.id] = val; redraw(); }}>${label}</button>`)}</div>`;
}

function optControl(n, o) {
  const cur = valuesOf(n)[o.id];
  if (o.kind === 'flag') return triControl(n, o);
  if (o.kind === 'choice') return html`
    <select data-ctl=${`opt:${o.id}`}
            @change=${e => { valuesOf(n)[o.id] = e.target.value; redraw(); }}>
      ${opt('', '(기본)', cur)}
      ${o.choices.map(c => opt(c, c, cur))}
    </select>`;

  const val = cur === undefined || cur === true || cur === false ? '' : cur;
  const ph = o.kind === 'repeatable'
    ? (o.metavar || 'VALUE') + ' — 한 줄에 하나'
    : (o.metavar || (o.default != null ? String(o.default) : 'VALUE'));
  const type = a => { valuesOf(n)[o.id] = a.target.value; redraw(); };
  return o.kind === 'repeatable'
    ? html`<textarea data-ctl=${`opt:${o.id}`} placeholder=${ph}
                     .value=${val} @input=${type}></textarea>`
    : html`<input type="text" data-ctl=${`opt:${o.id}`} placeholder=${ph}
                  .value=${val} @input=${type}>`;
}

function optRow(n, o) {
  // 값이 그 자체로 표현식인 옵션에는 서브그래프로 들어가는 문이 달린다.
  const sub = subgraphFor(o.id);
  return html`
    <div class="row" data-opt=${o.id}
         @mouseenter=${() => { UI.lit = o.id; paintOpt(); }}
         @mouseleave=${() => { UI.lit = null; paintOpt(); }}>
      <div class="row-top">
        <span class="row-flag">${o.flag}${o.short
          ? html` <span class="short">${o.short}</span>` : nothing}</span>
        ${sub ? html`
          <button class="row-sub" type="button" title=${sub.opensFrom.title}
                  @click=${ev => { ev.stopPropagation(); openSub(sub.id); }}
          >${sub.opensFrom.label}</button>` : nothing}
        <button class="row-x" type="button" title="이 옵션 빼기"
                @click=${() => { delete valuesOf(n)[o.id]; redraw(); }}>✕</button>
      </div>
      ${o.help ? html`<div class="row-help" title=${o.help}>${o.help}</div>` : nothing}
      <div class="row-ctl">${optControl(n, o)}</div>
    </div>`;
}

function pickerList(n, q) {
  const vals = valuesOf(n);
  const pool = BY_STAGE[n.stage].filter(o => !(o.id in vals));
  return search(q, pool) || pool;
}

function pickerTemplate(n) {
  const hits = pickerList(n, UI.picker.q);
  return html`
    <div class="picker">
      <input type="text" spellcheck="false" data-ctl="picker"
             placeholder=${labelOf(n) + ' 옵션 검색…'} .value=${UI.picker.q}
             @input=${e => { UI.picker.q = e.target.value; redraw(); }}
             @keydown=${ev => {
               if (ev.key !== 'Escape') return;
               ev.stopPropagation(); UI.picker = null; redraw();
             }}>
      <ul>
        ${hits.length ? hits.slice(0, 60).map(o => html`
          <li><button type="button" @click=${() => {
                valuesOf(n)[o.id] = o.kind === 'flag' ? true : '';
                UI.picker = null;
                redraw();
              }}>
            <div class="pf">${o.flag}${o.short
              ? html` <span class="short">${o.short}</span>` : nothing}</div>
            <div class="ph">${o.help}</div>
          </button></li>`)
        : html`<li class="none">남은 옵션이 없다.</li>`}
      </ul>
    </div>`;
}

/* ── 포맷 노드 본문 ──────────────────────── */
function filterRow(n, f, idx) {
  const type = FKEY_TYPE[f.key] || 'str';
  const exists = f.op === 'has' || f.op === 'hasnot';
  const ops = [...(type === 'num' ? NUM_OPS : STR_OPS), ...EXIST_OPS];
  return html`
    <div class="filt-row${exists ? ' exists' : ''}">
      <select data-ctl=${`filt:${idx}:key`} title="필터 필드"
              @change=${e => {
                f.key = e.target.value;
                const t = FKEY_TYPE[f.key];
                const allowed = (t === 'num' ? NUM_OPS : STR_OPS).map(o => o[0]);
                if (!allowed.includes(f.op) && !['has', 'hasnot'].includes(f.op)) f.op = allowed[0];
                redraw();
              }}>
        ${FKEYS.map(([k, ko]) => opt(k, ko, f.key))}
      </select>
      <select data-ctl=${`filt:${idx}:op`} title="비교 연산"
              @change=${e => { f.op = e.target.value; redraw(); }}>
        ${ops.map(([v, ko]) => opt(v, ko, f.op))}
      </select>
      ${exists ? nothing : html`
        <input type="text" data-ctl=${`filt:${idx}:val`} .value=${f.value || ''}
               placeholder=${type === 'num' ? '1080' : 'mp4'}
               @input=${e => { f.value = e.target.value; redraw(); }}>
        <!-- yt-dlp 의 '?' 는 필터마다 따로 붙는다 ([height<=?1080]). 노드가 아니라 행에 둔다. -->
        <label class="filt-q" title="이 필드 값을 모르는 포맷도 통과시킨다 (yt-dlp 의 ? 접미사)">
          <input type="checkbox" data-ctl=${`filt:${idx}:loose`} .checked=${!!f.loose}
                 @change=${e => { f.loose = e.target.checked; redraw(); }}>?</label>`}
      <button class="row-x" type="button" title="필터 빼기"
              @click=${() => { filtersOf(n).splice(idx, 1); redraw(); }}>✕</button>
    </div>`;
}

/**
 * 필터 상자. 스트림 노드와 연산자 노드가 같이 쓴다.
 *
 * yt-dlp 는 그룹에도 필터를 붙일 수 있다 — `(mp4,webm)[height<480]`. 그래서
 * `[+]` · `[/]` · `[,]` 노드도 이 상자를 갖는다. 필터가 있으면 컴파일러가
 * 괄호를 씌워 내보낸다.
 */
function filterBox(n) {
  const loose = filtersOf(n).some(f => !['has', 'hasnot'].includes(f.op));
  return html`
    <div class="filt">
      <div class="filt-head">
        <span>필터</span>
        <button class="row-sub" type="button" @click=${() => {
          filtersOf(n).push({ key: 'height', op: '<=', value: '1080' });
          redraw();
        }}>+ 필터</button>
      </div>
      ${filtersOf(n).map((f, i) => filterRow(n, f, i))}
      ${loose ? html`<div class="filt-loose"><b>?</b> = 이 값을 모르는 포맷도 통과</div>` : nothing}
    </div>`;
}

function streamBody(n) {
  const custom = !SEL_SET.has(n.sel);
  const cur = custom ? '__custom' : n.sel;
  return html`
    <div class="fsel">
      <select data-ctl="sel" title="셀렉터"
              @change=${e => { n.sel = e.target.value === '__custom' ? '' : e.target.value; redraw(); }}>
        ${SELECTORS.map(([g, items]) => html`
          <optgroup label=${g}>${items.map(([v]) => opt(v, v, cur))}</optgroup>`)}
        ${opt('__custom', '(직접 입력 — 포맷 ID·확장자)', cur)}
      </select>
      ${custom
        ? html`<input type="text" spellcheck="false" data-ctl="sel-custom"
                      .value=${n.sel || ''} placeholder="137 · mp4 · 248 …"
                      @input=${e => { n.sel = e.target.value.trim(); redraw(); }}>`
        : html`<div class="why">${SEL_HELP[n.sel] || ''}</div>`}
    </div>
    ${filterBox(n)}`;
}

function opBody(n) {
  const ins = operands(S().format, n.id);
  const filtered = filtersOf(n).some(f => f.key);
  return html`
    <div class="ops">
      <div>${blurbOf(n)} · 입력은 <b>세로 위치 순서</b>다.</div>
      ${!ins.length ? html`<div class="warn">이어진 입력이 없다.</div>` : html`
        <ol>${ins.map(k => html`
          <li>${emitTree(graphToTree(S().format, k.id)) || '(비어 있음)'}</li>`)}</ol>
        ${ins.length === 1 && !filtered ? html`
          <div class="warn">입력이 하나뿐이라 <code>${tagOf(n)}</code> 는 그냥 통과된다.</div>` : nothing}`}
      ${filtered ? html`
        <div class="why">필터가 붙어서 이 묶음은 괄호로 나간다.</div>` : nothing}
    </div>
    ${filterBox(n)}`;
}

/** 여러 줄짜리 진단·미리보기는 모양이 같다. */
const issueBox = (issues, id) => issues.length
  ? html`<div class="fout-issue" id=${id ?? nothing}
              style="white-space:pre-line">${'· ' + issues.join('\n· ')}</div>`
  : nothing;

function foutBody() {
  return html`
    <div class="node-note">여기 이어진 표현식이 --format 값이 된다.</div>
    <div class="fout-expr" id="fout-expr">${formatExpr(S().format)}</div>
    ${issueBox(formatIssues(S().format, tagOfType), 'fout-issue')}`;
}

/* ── 출력 템플릿 조각 본문 ───────────────── */

/** 글자 조각: 파일명에 그대로 들어가는 리터럴. */
function textBody(n) {
  return html`
    <div class="fsel">
      <input type="text" spellcheck="false" data-ctl="text" .value=${n.text ?? ''}
             placeholder="/  -  ." @input=${e => { n.text = e.target.value; redraw(); }}>
      <div class="why">구분자 · 경로 · 점.</div>
    </div>`;
}

/** 목록에 없는 값이 들어와 있으면 그 값도 항목으로 끼워 준다. */
const withCurrent = (pairs, cur) =>
  cur && !pairs.some(([v]) => v === cur) ? [...pairs, [cur, cur]] : pairs;

const tweakRow = (label, control) => html`
  <label class="ofield-row"><span>${label}</span>${control}</label>`;

/** 필드 조각: %(name>strf|fallback)fmt conv */
function fieldBody(n) {
  const custom = !FIELD_SET.has(n.name);
  const set = (k, v) => { n[k] = v; redraw(); };
  const strf = n.strf || '', conv = n.conv || 's';

  return html`
    <div class="fsel">
      <select data-ctl="field" title="어떤 값을 꺼낼지"
              @change=${e => set('name', e.target.value === '__custom' ? '' : e.target.value)}>
        ${FIELDS.map(([group, items]) => html`
          <optgroup label=${group}>
            ${items.map(([v, ko]) => opt(v, `${v} — ${ko}`, custom ? '__custom' : n.name))}
          </optgroup>`)}
        ${opt('__custom', '(직접 입력)', custom ? '__custom' : n.name)}
      </select>
      ${custom
        ? html`<input type="text" spellcheck="false" data-ctl="field-custom"
                      .value=${n.name || ''} placeholder="tags.0 · release_date,upload_date …"
                      @input=${e => set('name', e.target.value.trim())}>`
        : html`<div class="why">${FIELD_HELP[n.name] || ''}</div>`}
    </div>

    <div class="filt">
      <div class="filt-head"><span>다듬기</span></div>
      ${tweakRow('날짜 서식', html`
        <select data-ctl="strf" @change=${e => set('strf', e.target.value)}>
          ${withCurrent(STRF_PRESETS, strf).map(([v, ko]) => opt(v, ko, strf))}
        </select>`)}
      ${tweakRow('없을 때', html`
        <input type="text" spellcheck="false" data-ctl="fallback"
               .value=${n.fallback ?? ''} placeholder="(그대로 두면 NA)"
               @input=${e => set('fallback', e.target.value === '' ? null : e.target.value)}>`)}
      ${tweakRow('자릿수·자르기', html`
        <input type="text" spellcheck="false" data-ctl="fmt"
               .value=${n.fmt || ''} placeholder="03 · .40"
               title="자릿수 채우기(03) 또는 길이 자르기(.40)"
               @input=${e => set('fmt', e.target.value)}>`)}
      ${tweakRow('변환', html`
        <select data-ctl="conv" @change=${e => set('conv', e.target.value)}>
          ${withCurrent(CONVERSIONS, conv).map(([v, ko]) => opt(v, ko, conv))}
        </select>`)}
    </div>

    <div class="why" style="margin-top:6px">
      ${emitPiece({ t: 'field', name: n.name, strf: n.strf,
                    fallback: n.fallback, fmt: n.fmt, conv: n.conv })}
    </div>`;
}

/** -o 출력: TYPES 선택 + 완성된 문자열 + 미리보기. */
function ooutBody(n) {
  const cur = n.outType || '';
  return html`
    <div class="fsel">
      <select data-ctl="outtype" title="어떤 종류의 파일에 적용할지"
              @change=${e => { n.outType = e.target.value; redraw(); }}>
        ${OUT_TYPES.map(([v, ko]) => opt(v, ko, cur))}
      </select>
    </div>
    <div class="fout-expr" id="oout-expr">${outputExpr(S().output)}</div>
    <div class="node-note" style="padding-top:6px"
    >${'미리보기 ' + (outputPreview(S().output) || '(비어 있음)')}</div>
    ${issueBox(outputIssues(S().output, tagOfType))}`;
}

/** 경로 항목: TYPES 선택 + 경로. */
function pathBody(n) {
  const cur = n.pathType || '';
  return html`
    <div class="fsel">
      <select data-ctl="pathtype" title="어떤 종류의 파일을 어디에 둘지"
              @change=${e => { n.pathType = e.target.value; redraw(); }}>
        ${opt('', '(지정 안 함 = home)', cur)}
        ${PATH_TYPES.map(([v, ko]) => opt(v, ko, cur))}
      </select>
      <input type="text" spellcheck="false" data-ctl="path" .value=${n.path || ''}
             placeholder="/downloads  ·  D:/videos"
             @input=${e => { n.path = e.target.value; redraw(); }}>
      <div class="why">${joinEntry({ type: n.pathType, path: n.path }) || '(비어 있음)'}</div>
    </div>`;
}

/** -P 출력: 붙게 될 플래그들을 그대로 보여 준다. */
function poutBody() {
  const lines = pathsExpr(S().paths).split('\n').filter(Boolean).map(l => '-P ' + l).join('\n');
  return html`
    <div class="node-note">이어진 항목마다 -P 가 하나씩 붙는다.</div>
    <div class="fout-expr" style="white-space:pre-line">${lines}</div>
    ${issueBox(pathsIssues(S().paths, tagOfType))}`;
}

/* ── 노드 본문 등록 ──────────────────────── */
// 노드 종류를 추가하려면 defineKind 한 줄과 defineBody 한 줄이면 된다.
// 본문은 인자로 노드를 받아 템플릿을 돌려준다 — DOM 은 만지지 않는다.
function registerBodies() {
  defineBody('source', n => html`
    <textarea spellcheck="false" data-ctl="urls" .value=${n.urls || ''}
              placeholder="https://…  — 한 줄에 하나"
              @input=${e => { n.urls = e.target.value; redraw(); }}></textarea>
    <div class="node-note">명령어 맨 뒤에 붙는 대상 URL.</div>`);

  defineBody('sink', () => {
    const toks = buildTokens(S());
    return html`
      <div class="node-note">여기까지 이어진 노드만 아래 명령어에 들어간다.</div>
      <div class="sink-stat">
        <span>토큰 ${toks.length}</span>
        <span>단계 ${new Set(toks.map(t => t.node)).size}</span>
        <span>URL ${urlList(S()).length}</span>
      </div>`;
  });

  defineBody('stage', n => {
    const vals = valuesOf(n);
    const rows = BY_STAGE[n.stage].filter(o => o.id in vals);
    const picking = !!(UI.picker && UI.picker.node === n.id);
    return html`
      ${rows.length ? nothing : html`
        <div class="node-note">${blurbOf(n) + ' — 아직 고른 옵션이 없다.'}</div>`}
      ${repeat(rows, o => o.id, o => optRow(n, o))}
      ${picking ? pickerTemplate(n) : html`
        <button class="add" type="button"
                @click=${() => { UI.picker = { node: n.id, q: '' }; redraw(); }}>+ 옵션</button>`}`;
  });

  defineBody('stream', n => streamBody(n));
  for (const type of FORMAT_OPS) defineBody(type, n => opBody(n));
  defineBody('fout', () => foutBody());
  defineBody('text', n => textBody(n));
  defineBody('field', n => fieldBody(n));
  defineBody('oout', n => ooutBody(n));
  defineBody('path', n => pathBody(n));
  defineBody('pout', () => poutBody());
}
