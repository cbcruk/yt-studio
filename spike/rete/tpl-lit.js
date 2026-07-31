/**
 * 스파이크용 tpl.js 대체.
 *
 * 본 앱의 src/ui/tpl.js 는 `lit-html` 을 집는데 rete 플러그인은 `lit` 을 쓴다.
 * 둘은 다른 패키지라 그대로 두면 TemplateResult 와 디렉티브를 서로 못 알아본다
 * ("Multiple versions of Lit loaded"). vite.config.js 가 tpl.js 를 이 파일로
 * 바꿔치기해서 한 벌로 몬다.
 *
 * → 실제로 도입한다면 tpl.js 자체를 lit-html → lit 으로 옮겨야 한다는 뜻이다.
 */
import { html as _html, render as _render, nothing as _nothing } from 'lit';
import { repeat as _repeat } from 'lit/directives/repeat.js';

export const html = _html;
export const renderTpl = _render;
export const nothing = _nothing;
export const repeat = _repeat;
