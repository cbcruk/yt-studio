/**
 * 템플릿 엔진 어댑터.
 *
 * lit 을 여기 한 곳에서만 import 한다. 앱에도 render 가 있으므로 이름을
 * 갈라 둔다(renderTpl).
 */
import { html as _html, nothing as _nothing, render as _render } from 'lit';
import { repeat as _repeat } from 'lit/directives/repeat.js';

export const html = _html;
export const renderTpl = _render;
export const nothing = _nothing;
export const repeat = _repeat;
