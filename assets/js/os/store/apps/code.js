// code.js — Code: Editor mit Reitern, Syntaxhervorhebung, Suchen & Ersetzen, JavaScript-Sandbox und Live-Vorschau

import { h, clamp, debounce, drag } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { sys } from '../../sys.js';
import { bus } from '../../bus.js';
import { vfs, HOME, basename, dirname, extname, normalize, pretty, formatSize } from '../../vfs.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, toast, sheet, promptSheet, openDialog, saveDialog } from '../../kit.js';

const DIR = `${HOME}/Dokumente/Code`;
const MAX_FILE = 1024 * 1024;        // größere Dateien öffnet der Editor nicht
const SVG = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I_SAVE = SVG('<path d="M5 6.500A2.500 2.500 0 0 1 7.500 4h8L19 7.500v9a2.500 2.500 0 0 1-2.500 2.500h-9A2.500 2.500 0 0 1 5 16.500z" transform="translate(0 .5)"/><path d="M8.500 4.500v4h6v-4M8.500 19.500v-5.500h7v5.500"/>');
const I_SPLIT = SVG('<rect x="3.500" y="5" width="17" height="14" rx="3"/><path d="M12 5v14"/>');
const I_WRAP = SVG('<path d="M4 6.500h16M4 12h12.500a3 3 0 0 1 0 6H12M4 17.500h4"/><path d="M14 15.500l-2.500 2.500 2.500 2.500"/>');

style('code', `
.code { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; --code-fs: 13px; --code-lh: 20px;
  --t-kw: var(--c-violet); --t-str: var(--c-mint); --t-num: var(--c-amber); --t-fn: var(--c-cyan); --t-tag: var(--c-coral);
  --t-prop: color-mix(in srgb, var(--c-cyan) 50%, var(--fg)); --t-com: var(--fg-3); --t-pun: var(--fg-2); }
[data-theme="light"] .code {
  --t-kw: color-mix(in srgb, var(--c-violet) 72%, var(--fg)); --t-str: color-mix(in srgb, var(--c-mint) 46%, var(--fg));
  --t-num: color-mix(in srgb, var(--c-amber) 50%, var(--fg)); --t-fn: color-mix(in srgb, var(--c-cyan) 52%, var(--fg));
  --t-tag: color-mix(in srgb, var(--c-coral) 70%, var(--fg)); --t-prop: color-mix(in srgb, var(--c-cyan) 34%, var(--fg)); }

/* Reiter */
.code-tabs { display: flex; align-items: flex-end; gap: 4px; flex: none; height: 36px; padding: 0 8px; border-bottom: .5px solid var(--line); }
.code-tablist { display: flex; align-items: flex-end; gap: 2px; min-width: 0; height: 100%; overflow-x: auto; scrollbar-width: none; }
.code-tablist::-webkit-scrollbar { display: none; }
.code-tab { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; max-width: 200px; height: 30px; padding: 0 5px 0 10px; border-radius: 9px 9px 0 0; color: var(--fg-3); font-size: 12.5px; font-weight: 550; cursor: default; outline-offset: -2px; transition: background-color .15s, color .15s; }
.code-tab:hover { background: var(--raise); color: var(--fg-2); }
.code-tab.is-on { background: var(--well); color: var(--fg); box-shadow: inset 0 .5px 0 var(--line), inset .5px 0 0 var(--line), inset -.5px 0 0 var(--line); }
.code-tab-ext { flex: none; font: 700 9.5px/1 var(--mono); letter-spacing: .02em; color: var(--tc, var(--fg-3)); }
.code-tab-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-tab-x { position: relative; display: grid; place-items: center; flex: none; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--fg-3); }
.code-tab-x:hover { background: var(--raise-2); color: var(--fg); }
.code-tab-x .ico { width: 11px; height: 11px; stroke-width: 2.4; opacity: 0; transition: opacity .12s; }
.code-tab:hover .code-tab-x .ico, .code-tab.is-on .code-tab-x .ico, .code-tab-x:focus-visible .ico { opacity: 1; }
.code-tab-x i { position: absolute; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); scale: 0; transition: scale .35s var(--spring); }
.code-tab.is-dirty .code-tab-x i { scale: 1; }
.code-tab.is-dirty .code-tab-x .ico { opacity: 0; }
.code-tab.is-dirty .code-tab-x:hover i { scale: 0; }
.code-tab.is-dirty .code-tab-x:hover .ico { opacity: 1; }
.code-tabs > .tool { align-self: center; width: 24px; height: 24px; }

/* Suchen & Ersetzen */
.code-find { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 6px; flex: none; padding: 6px 8px; border-bottom: .5px solid var(--line); }
.code-find-row { display: flex; align-items: center; gap: 4px; flex: 1 1 250px; min-width: 0; }
.code-find .kit-field { flex: 1; min-width: 60px; padding: 4px 9px; font: 12.5px var(--mono); }
.code-find .kit-field.is-bad { box-shadow: inset 0 0 0 1.5px var(--c-coral); }
.code-find .kit-btn { padding: 4px 9px; font-size: 12px; }
.code-find .tool { width: 24px; height: 24px; }
.code-find .tool.txt { width: auto; padding: 0 6px; font: 700 11px var(--mono); }
.code-find-n { flex: none; min-width: 58px; font-size: 11.5px; text-align: center; color: var(--fg-3); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Arbeitsfläche: Editor | Vorschau */
.code-work { display: flex; flex: 1 1 0; min-width: 0; min-height: 64px; overflow: hidden; --code-split: 46%; }
.code-eds { position: relative; display: flex; flex: 1 1 0; min-width: 0; min-height: 0; background: var(--well); }
.code-ed { display: flex; flex: 1; min-width: 0; min-height: 0; font: var(--code-fs)/var(--code-lh) var(--mono); font-variant-ligatures: none; font-kerning: none; tab-size: 2; --code-gut: calc(var(--code-digits, 3) * 1ch + 24px); }
.code-gutter { flex: none; width: var(--code-gut); min-height: 0; padding-top: 10px; overflow: hidden; text-align: right; color: var(--fg-4); font-variant-numeric: tabular-nums; }
.code-gutter::after { content: ""; display: block; height: 80px; }
.code-gutter div { height: var(--code-lh); padding-right: 12px; }
.code-gutter div.is-cur { color: var(--fg-2); }
.code-stage { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.code-hl { position: absolute; inset: 0; overflow: hidden; pointer-events: none; color: var(--fg); }
.code-lines { width: max-content; min-width: 100%; padding: 10px 0 80px; }
.code-cl { min-height: var(--code-lh); padding: 0 80px 0 4px; white-space: pre; }
.code-cl.is-cur { background: var(--raise); }
.code-ta { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 10px 14px 10px 4px; border: 0; outline: 0; border-radius: 0; resize: none; background: none; color: transparent; caret-color: var(--fg); font: inherit; font-variant-ligatures: none; font-kerning: none; tab-size: 2; white-space: pre; overflow-wrap: normal; overflow: auto; }
.code-ta::selection { background: color-mix(in srgb, var(--accent) 36%, transparent); color: transparent; }
.code-ta::placeholder { color: var(--fg-4); }
.code-ed.is-wrap .code-gutter { display: none; }
.code-ed.is-wrap .code-lines { min-width: 0; counter-reset: cl; }
.code-ed.is-wrap .code-cl { position: relative; padding: 0 14px 0 calc(var(--code-gut) + 4px); white-space: pre-wrap; overflow-wrap: break-word; counter-increment: cl; }
.code-ed.is-wrap .code-cl::before { content: counter(cl); position: absolute; left: 0; top: 0; width: calc(var(--code-gut) - 12px); text-align: right; color: var(--fg-4); font-variant-numeric: tabular-nums; }
.code-ed.is-wrap .code-cl.is-cur::before { color: var(--fg-2); }
.code-ed.is-wrap .code-ta { padding-left: calc(var(--code-gut) + 4px); white-space: pre-wrap; overflow-wrap: break-word; }
.code-tok .k { color: var(--t-kw); } .code-tok .s { color: var(--t-str); } .code-tok .n, .code-tok .l { color: var(--t-num); }
.code-tok .c { color: var(--t-com); } .code-tok .f { color: var(--t-fn); } .code-tok .t, .code-tok .r { color: var(--t-tag); }
.code-tok .p { color: var(--t-prop); } .code-tok .o { color: var(--t-pun); }
.code-hl mark { border-radius: 3px; background: color-mix(in srgb, var(--c-amber) 34%, transparent); color: inherit; }
.code-hl mark.cur { background: color-mix(in srgb, var(--c-amber) 62%, transparent); box-shadow: 0 0 0 1.5px var(--c-amber); }

.code-split { position: relative; flex: none; width: 9px; margin: 0 -4px; z-index: 2; cursor: col-resize; touch-action: none; }
.code-split::after { content: ""; position: absolute; inset: 0 4px; background: var(--line); transition: background-color .15s, inset .15s; }
.code-split:hover::after, .code-split.is-drag::after { inset: 0 3px; background: var(--accent); }
.code-prev { display: flex; flex-direction: column; flex: 0 0 var(--code-split); min-width: 0; min-height: 0; }
.code-phead { display: flex; align-items: center; gap: 4px; flex: none; height: 28px; padding: 0 6px 0 12px; border-bottom: .5px solid var(--line); font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.code-phead .sp { flex: 1; }
.code-phead .tool, .code-chead .tool { width: 22px; height: 22px; }
.code-phead .tool .ico, .code-chead .tool .ico { width: 14px; height: 14px; }
.code-pbody { position: relative; display: flex; flex: 1; min-height: 0; }
.code-pbody iframe { flex: 1; width: 100%; min-height: 0; border: 0; background: #fff; }
.code.is-drag iframe { pointer-events: none; }
.code-md { flex: 1; min-width: 0; padding: 18px 22px 30px; font-size: 14px; line-height: 1.62; user-select: text; -webkit-user-select: text; overflow-wrap: break-word; }
.code-md > :first-child { margin-top: 0; }
.code-md h1 { margin: 1em 0 .5em; font-size: 1.65em; letter-spacing: -.02em; line-height: 1.2; }
.code-md h2 { margin: 1.2em 0 .45em; padding-bottom: .25em; border-bottom: .5px solid var(--line); font-size: 1.3em; line-height: 1.25; }
.code-md h3 { margin: 1.1em 0 .35em; font-size: 1.1em; } .code-md h4, .code-md h5, .code-md h6 { margin: 1em 0 .3em; font-size: 1em; color: var(--fg-2); }
.code-md p, .code-md ul, .code-md ol, .code-md blockquote, .code-md pre, .code-md table { margin: 0 0 .85em; }
.code-md ul, .code-md ol { padding-left: 1.5em; } .code-md ul { list-style: disc; } .code-md ol { list-style: decimal; }
.code-md li > ul, .code-md li > ol { margin: .2em 0; }
.code-md li.task { list-style: none; margin-left: -1.3em; } .code-md li.task input { margin: 0 .5em 0 0; accent-color: var(--accent); }
.code-md blockquote { padding: 4px 14px; border-left: 3px solid var(--accent); color: var(--fg-2); } .code-md blockquote > :last-child { margin-bottom: 0; }
.code-md code { padding: 1px 5px; border-radius: 5px; background: var(--well); font: .88em var(--mono); }
.code-md pre { padding: 10px 12px; border-radius: 10px; background: var(--well); overflow-x: auto; font: 12.5px/1.5 var(--mono); }
.code-md pre code { padding: 0; background: none; font: inherit; }
.code-md a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.code-md hr { height: 1px; margin: 1.2em 0; border: 0; background: var(--line); }
.code-md table { border-collapse: collapse; font-size: .94em; } .code-md th, .code-md td { padding: 4px 10px; border: .5px solid var(--line); text-align: left; } .code-md th { background: var(--raise); }
.code-md .dim { color: var(--fg-3); }

/* Konsole */
.code-con { position: relative; display: flex; flex-direction: column; flex: 0 1 var(--code-con, 150px); min-height: 56px; max-height: 72%; border-top: .5px solid var(--line); }
.code-cgrip { position: absolute; left: 0; right: 0; top: -5px; height: 9px; z-index: 2; cursor: row-resize; touch-action: none; }
.code-chead { display: flex; align-items: center; gap: 4px; flex: none; height: 28px; padding: 0 6px 0 12px; }
.code-chead b { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.code-chead .sp { flex: 1; }
.code-cstate { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; font-size: 11.5px; color: var(--fg-3); white-space: nowrap; }
.code-cstate i { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-4); }
.code-cstate.is-run i { background: var(--c-mint); animation: code-pulse .8s ease-in-out infinite alternate; }
@keyframes code-pulse { to { opacity: .25; scale: .7; } }
.code-cout { flex: 1; min-height: 0; padding-bottom: 6px; font: 12px/1.55 var(--mono); user-select: text; -webkit-user-select: text; }
.code-msg { display: flex; align-items: flex-start; gap: 8px; padding: 2px 12px; border-top: .5px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
.code-msg > span:first-of-type { flex: 1; min-width: 0; }
.code-msg.info { color: var(--t-fn); }
.code-msg.warn { background: color-mix(in srgb, var(--c-amber) 11%, transparent); color: var(--t-num); }
.code-msg.error { background: color-mix(in srgb, var(--c-coral) 13%, transparent); color: var(--t-tag); }
.code-msg.sys { color: var(--fg-3); }
.code-msg .v-n { color: var(--t-num); } .code-msg .v-k { color: var(--t-kw); } .code-msg .v-f { color: var(--t-fn); } .code-msg.log .v-o { color: var(--fg-2); }
.code-msg-n { flex: none; min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--raise-2); color: var(--fg-2); font: 700 10.5px/17px var(--font); text-align: center; }
.code-msg-at { flex: none; padding: 0 6px; border: 0; border-radius: 6px; background: none; color: inherit; font: 600 11px/18px var(--font); opacity: .8; text-decoration: underline; text-underline-offset: 2px; }
.code-msg-at:hover { opacity: 1; background: var(--raise); }
.code-cnone { padding: 14px 12px; font: 12.5px var(--font); color: var(--fg-3); }

/* Statusleiste */
.code-foot { gap: 2px; padding: 3px 8px; white-space: nowrap; }
.code-stat { display: inline-flex; align-items: center; gap: 5px; flex: none; height: 22px; padding: 0 7px; border: 0; border-radius: 6px; background: none; color: var(--fg-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
button.code-stat:hover { background: var(--raise); color: var(--fg); }
.code-stat.is-on { color: var(--accent); }
.code-stat .ico { width: 14px; height: 14px; }
.code-stat em { min-width: 16px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: #fff; font: 700 10px/15px var(--font); text-align: center; }
.code-stat em.is-err { background: var(--c-coral); }
.code-run { color: var(--c-mint); } .code-run.is-stop { color: var(--c-coral); }
[data-theme="light"] .code-run { color: color-mix(in srgb, var(--c-mint) 62%, var(--fg)); }
.code-none { display: grid; place-content: center; justify-items: center; gap: 12px; flex: 1; }
.code-none .kit-empty { flex: none; padding-bottom: 4px; }
.code-none div:last-child { display: flex; gap: 8px; }

/* Dialoge (Öffnen, Sichern) bleiben auch im kleinsten Fenster vollständig sichtbar */
.win[data-app="code"] > .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); }
.win[data-app="code"] > .kit-sheet-wrap > .kit-sheet { align-self: start; min-height: 0; }

@container win (max-width: 600px) {
  .code-work { flex-direction: column; }
  .code-split { width: auto; height: 9px; margin: -4px 0; cursor: row-resize; }
  .code-split::after { inset: 4px 0; } .code-split:hover::after, .code-split.is-drag::after { inset: 3px 0; }
  .code-hide-s { display: none; }
}
@container win (max-width: 470px) { .code-hide-xs { display: none; } }
`);

// ==========================================================================
// Sprachen und Tokenizer. Jeder Tokenizer arbeitet zeilenweise: tok(zeile, zustand) → [token, zustand].
// token ist eine flache Liste [klasse, text, klasse, text, …]; der Zustand (String) trägt offene
// Kommentare, Template-Strings usw. in die nächste Zeile. So lässt sich nach einer Eingabe nur das
// neu einfärben, was sich wirklich geändert hat.
// ==========================================================================
const LANGS = {
  js: { name: 'JavaScript', tag: 'JS', tint: '--t-num' },
  json: { name: 'JSON', tag: '{}', tint: '--t-num' },
  html: { name: 'HTML', tag: '<>', tint: '--t-tag' },
  css: { name: 'CSS', tag: '#', tint: '--t-fn' },
  md: { name: 'Markdown', tag: 'MD', tint: '--t-kw' },
  text: { name: 'Text', tag: 'TXT', tint: '--fg-3' },
};
const EXT_LANG = { js: 'js', mjs: 'js', json: 'json', html: 'html', htm: 'html', svg: 'html', css: 'css', md: 'md' };
const langOf = (name) => EXT_LANG[extname(name)] || 'text';
const COMMENT = { js: ['// ', ''], css: ['/* ', ' */'], html: ['<!-- ', ' -->'] };

const push = (out, cls, text) => {
  if (!text) return;
  const n = out.length;
  if (n && out[n - 2] === cls) out[n - 1] += text; else out.push(cls, text);
};
const at = (re, line, i) => { re.lastIndex = i; return re.exec(line); };
const quoted = (line, i) => {
  const q = line[i];
  let j = i + 1;
  while (j < line.length && line[j] !== q) j += line[j] === '\\' ? 2 : 1;
  return Math.min(line.length, j + 1);
};
const nextChar = (line, i) => { while (line[i] === ' ' || line[i] === '\t') i++; return line[i] || ''; };

const R_SPACE = /\s+/y;
const R_IDENT = /[A-Za-z_$À-￿][\w$À-￿]*/y;
const R_NUM = /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/y;
const JS_KW = new Set('async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static switch throw try typeof var void while with yield'.split(' '));
const JS_LIT = new Set('true false null undefined NaN Infinity this super arguments'.split(' '));

function tokJs(line, state) {
  const out = [];
  const st = state ? state.split(',') : [];   // Stapel: c = Blockkommentar, t = Template-Text, eN = Ausdruck in ${…}
  const n = line.length;
  let i = 0;
  let val = false;      // steht davor ein Wert? Dann ist „/“ eine Division, sonst beginnt ein regulärer Ausdruck
  let dot = false;
  let m;
  while (i < n) {
    const top = st[st.length - 1];
    if (top === 'c') {
      const e = line.indexOf('*/', i);
      if (e < 0) { push(out, 'c', line.slice(i)); i = n; } else { push(out, 'c', line.slice(i, e + 2)); i = e + 2; st.pop(); }
      continue;
    }
    if (top === 't') {
      let j = i;
      while (j < n && line[j] !== '`' && !(line[j] === '$' && line[j + 1] === '{')) j += line[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      push(out, 's', line.slice(i, j));
      if (j >= n) { i = n; continue; }
      if (line[j] === '`') { push(out, 's', '`'); st.pop(); i = j + 1; val = true; } else { push(out, 'o', '${'); st.push('e0'); i = j + 2; val = false; }
      continue;
    }
    const ch = line[i];
    if ((m = at(R_SPACE, line, i))) { push(out, '', m[0]); i += m[0].length; continue; }
    if (ch === '/' && line[i + 1] === '/') { push(out, 'c', line.slice(i)); i = n; continue; }
    if (ch === '/' && line[i + 1] === '*') { st.push('c'); push(out, 'c', '/*'); i += 2; continue; }
    if (ch === '"' || ch === "'") { const j = quoted(line, i); push(out, 's', line.slice(i, j)); i = j; val = true; dot = false; continue; }
    if (ch === '`') { push(out, 's', '`'); st.push('t'); i++; dot = false; continue; }
    if (((ch >= '0' && ch <= '9') || (ch === '.' && line[i + 1] >= '0' && line[i + 1] <= '9')) && (m = at(R_NUM, line, i))) {
      push(out, 'n', m[0]); i += m[0].length; val = true; dot = false; continue;
    }
    if ((m = at(R_IDENT, line, i))) {
      const w = m[0];
      i += w.length;
      const call = nextChar(line, i) === '(';
      const cls = dot ? (call ? 'f' : 'p') : JS_KW.has(w) ? 'k' : JS_LIT.has(w) ? 'l' : call ? 'f' : w[0] >= 'A' && w[0] <= 'Z' ? 't' : '';
      push(out, cls, w);
      val = cls !== 'k';
      dot = false;
      continue;
    }
    if (ch === '/' && !val) {
      let j = i + 1, set = false, ok = false;
      while (j < n) {
        const c = line[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') set = true; else if (c === ']') set = false; else if (c === '/' && !set) { ok = true; break; }
        j++;
      }
      if (ok) {
        j++;
        while (j < n && line[j] >= 'a' && line[j] <= 'z') j++;
        push(out, 'r', line.slice(i, j)); i = j; val = true; continue;
      }
    }
    if (top && top[0] === 'e') {
      const d = +top.slice(1);
      if (ch === '{') st[st.length - 1] = `e${d + 1}`;
      else if (ch === '}') {
        if (!d) { st.pop(); push(out, 'o', '}'); i++; val = false; continue; }
        st[st.length - 1] = `e${d - 1}`;
      }
    }
    push(out, 'o', ch);
    i++;
    dot = ch === '.' && line[i - 2] !== '.';
    val = ch === ')' || ch === ']';
  }
  return [out, st.join(',')];
}

const R_JNUM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const R_JLIT = /true|false|null/y;
function tokJson(line) {
  const out = [];
  const n = line.length;
  let i = 0;
  let m;
  while (i < n) {
    if (line[i] === '"') {
      const j = quoted(line, i);
      push(out, nextChar(line, j) === ':' ? 'p' : 's', line.slice(i, j));
      i = j;
    } else if ((m = at(R_SPACE, line, i))) { push(out, '', m[0]); i += m[0].length; }
    else if ((m = at(R_JNUM, line, i))) { push(out, 'n', m[0]); i += m[0].length; }
    else if ((m = at(R_JLIT, line, i))) { push(out, 'l', m[0]); i += m[0].length; }
    else { push(out, 'o', line[i]); i++; }
  }
  return [out, ''];
}

const R_CSS_AT = /@[\w-]+/y;
const R_CSS_HEX = /#[\da-fA-F]{3,8}\b/y;
const R_CSS_NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z]+|%)?/y;
const R_CSS_IMP = /!important/y;
const R_CSS_VAR = /--[\w-]+/y;
const R_CSS_ID = /-?[a-zA-Z_][\w-]*/y;
const R_CSS_CLS = /[.#][\w-]+/y;
const R_CSS_PSEUDO = /::?[\w-]+/y;
const R_CSS_ATTR = /\[[^\]]*\]/y;
function tokCss(line, state) {
  const out = [];
  const n = line.length;
  let depth = parseInt(state, 10) || 0;
  let inVal = state.includes('v');
  let inCom = state.includes('c');
  let sel = null;     // null = noch offen, true = Selektor, false = Deklaration
  let i = 0;
  let m;
  while (i < n) {
    if (inCom) {
      const e = line.indexOf('*/', i);
      if (e < 0) { push(out, 'c', line.slice(i)); i = n; } else { push(out, 'c', line.slice(i, e + 2)); i = e + 2; inCom = false; }
      continue;
    }
    const ch = line[i];
    if ((m = at(R_SPACE, line, i))) { push(out, '', m[0]); i += m[0].length; continue; }
    if (ch === '/' && line[i + 1] === '*') { inCom = true; push(out, 'c', '/*'); i += 2; continue; }
    if (ch === '"' || ch === "'") { const j = quoted(line, i); push(out, 's', line.slice(i, j)); i = j; continue; }
    if (ch === '{' || ch === '}' || ch === ';') {
      if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1);
      inVal = false; sel = null;
      push(out, 'o', ch); i++; continue;
    }
    if (ch === '@' && (m = at(R_CSS_AT, line, i))) { push(out, 'k', m[0]); i += m[0].length; inVal = true; continue; }
    if (inVal) {
      if ((m = at(R_CSS_HEX, line, i)) || (m = at(R_CSS_NUM, line, i))) push(out, 'n', m[0]);
      else if ((m = at(R_CSS_IMP, line, i))) push(out, 'k', m[0]);
      else if ((m = at(R_CSS_VAR, line, i))) push(out, 'p', m[0]);
      else if ((m = at(R_CSS_ID, line, i))) push(out, line[i + m[0].length] === '(' ? 'f' : '', m[0]);
      else { push(out, 'o', ch); i++; continue; }
      i += m[0].length;
      continue;
    }
    if (sel === null) {
      if (!depth) sel = true;
      else {
        const rest = line.slice(i);
        const b = rest.search(/[{;}]/);
        sel = b >= 0 ? rest[b] === '{' : !/^-{0,2}[\w-]+\s*:/.test(rest);
      }
    }
    if (sel) {
      if ((m = at(R_CSS_CLS, line, i))) push(out, 'f', m[0]);
      else if ((m = at(R_CSS_PSEUDO, line, i))) push(out, 'k', m[0]);
      else if ((m = at(R_CSS_ATTR, line, i))) push(out, 'p', m[0]);
      else if ((m = at(R_CSS_NUM, line, i))) push(out, 'n', m[0]);
      else if ((m = at(R_CSS_ID, line, i))) push(out, 't', m[0]);
      else { push(out, 'o', ch); i++; continue; }
      i += m[0].length;
    } else if ((m = at(R_CSS_VAR, line, i)) || (m = at(R_CSS_ID, line, i))) { push(out, 'p', m[0]); i += m[0].length; }
    else { if (ch === ':') inVal = true; push(out, 'o', ch); i++; }
  }
  return [out, depth || inVal || inCom ? `${depth}${inVal ? 'v' : ''}${inCom ? 'c' : ''}` : ''];
}

const R_ENT = /&#?\w+;/g;
const R_TAG = /<\/?[a-zA-Z][\w:-]*/y;
const R_ATTR = /[^\s=>/"']+/y;
const R_BARE = /[^\s>]+/y;
function tokHtml(line, state) {
  const out = [];
  const n = line.length;
  const low = line.toLowerCase();
  let mode = state ? state[0] : '';      // '' Text · c Kommentar · t im Tag · q im Attributwert · s <script> · y <style>
  let arg = state.slice(2);
  let i = 0;
  let m;
  let eq = false;
  while (i < n) {
    if (mode === 's' || mode === 'y') {
      const end = low.indexOf(mode === 's' ? '</script' : '</style', i);
      const [toks, st] = (mode === 's' ? tokJs : tokCss)(line.slice(i, end < 0 ? n : end), arg);
      for (let k = 0; k < toks.length; k += 2) push(out, toks[k], toks[k + 1]);
      if (end < 0) { arg = st; i = n; } else { mode = ''; arg = ''; i = end; }
    } else if (mode === 'c') {
      const e = line.indexOf('-->', i);
      if (e < 0) { push(out, 'c', line.slice(i)); i = n; } else { push(out, 'c', line.slice(i, e + 3)); i = e + 3; mode = ''; }
    } else if (mode === 'q') {
      const e = line.indexOf(arg[0], i);
      if (e < 0) { push(out, 's', line.slice(i)); i = n; } else { push(out, 's', line.slice(i, e + 1)); i = e + 1; mode = 't'; arg = arg.slice(1); }
    } else if (mode === 't') {
      const ch = line[i];
      if ((m = at(R_SPACE, line, i))) { push(out, '', m[0]); i += m[0].length; }
      else if (ch === '>' || (ch === '/' && line[i + 1] === '>')) {
        const len = ch === '>' ? 1 : 2;
        push(out, 'o', line.slice(i, i + len)); i += len;
        mode = len === 1 && arg === 'script' ? 's' : len === 1 && arg === 'style' ? 'y' : '';
        arg = ''; eq = false;
      } else if (ch === '=') { push(out, 'o', ch); i++; eq = true; }
      else if (ch === '"' || ch === "'") {
        const e = line.indexOf(ch, i + 1);
        if (e < 0) { push(out, 's', line.slice(i)); i = n; mode = 'q'; arg = ch + arg; } else { push(out, 's', line.slice(i, e + 1)); i = e + 1; }
        eq = false;
      } else if (eq && (m = at(R_BARE, line, i))) { push(out, 's', m[0]); i += m[0].length; eq = false; }
      else if ((m = at(R_ATTR, line, i))) { push(out, 'p', m[0]); i += m[0].length; }
      else { push(out, 'o', ch); i++; }
    } else {
      let lt = line.indexOf('<', i);
      if (lt < 0) lt = n;
      if (lt > i) {
        const text = line.slice(i, lt);
        let last = 0;
        R_ENT.lastIndex = 0;
        while ((m = R_ENT.exec(text))) { push(out, '', text.slice(last, m.index)); push(out, 'l', m[0]); last = R_ENT.lastIndex; }
        push(out, '', text.slice(last));
        i = lt;
        continue;
      }
      if (line.startsWith('<!--', i)) { mode = 'c'; push(out, 'c', '<!--'); i += 4; }
      else if (line[i + 1] === '!' || line[i + 1] === '?') {
        const e = line.indexOf('>', i);
        push(out, 'k', line.slice(i, e < 0 ? n : e + 1)); i = e < 0 ? n : e + 1;
      } else if ((m = at(R_TAG, line, i))) {
        const close = m[0][1] === '/';
        push(out, 'o', close ? '</' : '<');
        push(out, 't', m[0].slice(close ? 2 : 1));
        i += m[0].length;
        mode = 't';
        arg = close ? '/' : m[0].slice(1).toLowerCase();
        eq = false;
      } else { push(out, '', '<'); i++; }
    }
  }
  return [out, mode ? `${mode}:${arg}` : ''];
}

const R_MD_INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|((?<![\w*])\*[^*\s][^*]*\*|(?<![\w_])_[^_\s][^_]*_(?!\w))|(!?\[[^\]]*\]\([^)]*\))|(<\/?[a-zA-Z][^>]*>)/g;
function tokMd(line, state) {
  const out = [];
  if (/^\s*(```|~~~)/.test(line)) { push(out, 's', line); return [out, state === 'f' ? '' : 'f']; }
  if (state === 'f') { push(out, 's', line); return [out, 'f']; }
  if (/^#{1,6}\s/.test(line)) { push(out, 'k', line); return [out, '']; }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { push(out, 'c', line); return [out, '']; }
  let i = 0;
  let m;
  if ((m = /^\s*>+\s?/.exec(line))) { push(out, 'c', m[0]); i = m[0].length; }
  else if ((m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(line))) { push(out, 't', m[0]); i = m[0].length; }
  R_MD_INLINE.lastIndex = i;
  let last = i;
  while ((m = R_MD_INLINE.exec(line))) {
    push(out, '', line.slice(last, m.index));
    push(out, m[1] ? 's' : m[2] ? 'n' : m[3] ? 'f' : m[4] ? 'p' : 't', m[0]);
    last = R_MD_INLINE.lastIndex;
  }
  push(out, '', line.slice(last));
  return [out, ''];
}

const TOK = { js: tokJs, json: tokJson, css: tokCss, html: tokHtml, md: tokMd, text: (line) => [line ? ['', line] : [], ''] };
/** Sehr lange Zeilen (z. B. minifizierte Dateien) bleiben ungefärbt – sonst kostet jeder Tastendruck zu viel. */
const tokenize = (lang, line, state) => (line.length > 12000 ? [['', line], state] : TOK[lang](line, state));

const escT = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const escA = (s) => escT(String(s)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** HTML einer Zeile aus ihren Token; marks = [[von, bis, aktuell], …] hebt Suchtreffer hervor. */
function lineHtml(tok, marks) {
  let html = '';
  if (!marks) {
    for (let i = 0; i < tok.length; i += 2) html += tok[i] ? `<span class="${tok[i]}">${escT(tok[i + 1])}</span>` : escT(tok[i + 1]);
    return html;
  }
  let pos = 0;
  let k = 0;
  for (let i = 0; i < tok.length; i += 2) {
    const text = tok[i + 1];
    const end = pos + text.length;
    let inner = '';
    let p = pos;
    while (k < marks.length && marks[k][0] < end) {
      const [a, b, cur] = marks[k];
      const s = Math.max(a, p);
      const e = Math.min(b, end);
      inner += `${escT(text.slice(p - pos, s - pos))}<mark${cur ? ' class="cur"' : ''}>${escT(text.slice(s - pos, e - pos))}</mark>`;
      p = e;
      if (b > end) break;
      k++;
    }
    inner += escT(text.slice(p - pos));
    html += tok[i] ? `<span class="${tok[i]}">${inner}</span>` : inner;
    pos = end;
  }
  return html;
}

// ==========================================================================
// Markdown-Vorschau: kleiner Renderer. Jeder Text wird escaped, bevor Auszeichnung dazukommt.
// ==========================================================================
const mdInline = (src) => src.split(/(`[^`\n]+`)/).map((part, i) => (i % 2
  ? `<code>${escT(part.slice(1, -1))}</code>`
  : escA(part)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt) => `<span class="dim">[Bild: ${alt || 'ohne Titel'}]</span>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => (/^(https?:|mailto:)/i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text))
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(?<![\w*])\*([^*\s][^*]*)\*|(?<![\w_])_([^_\s][^_]*)_(?!\w)/g, (m, a, b) => `<em>${a || b}</em>`)
    .replace(/~~([^~]+)~~/g, '<del>$1</del>'))).join('');

const MD_LANG = { js: 'js', javascript: 'js', mjs: 'js', json: 'json', html: 'html', xml: 'html', svg: 'html', css: 'css', md: 'md', markdown: 'md' };

function renderMd(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  const lists = [];      // offene Listen: {indent, tag}
  let para = [];
  let blank = false;
  const flush = () => { if (para.length) { out.push(`<p>${para.join('\n')}</p>`); para = []; } };
  const closeLists = (indent = -1) => { while (lists.length && lists[lists.length - 1].indent > indent) out.push(`</li></${lists.pop().tag}>`); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wasBlank = blank;
    blank = false;
    let m;
    if ((m = /^\s*(```|~~~)\s*([\w-]*)/.exec(line))) {
      flush(); closeLists();
      const lang = MD_LANG[m[2].toLowerCase()] || 'text';
      const body = [];
      let st = '';
      for (i++; i < lines.length && !lines[i].trim().startsWith(m[1]); i++) {
        const [tok, next] = tokenize(lang, lines[i], st);
        st = next;
        body.push(lineHtml(tok));
      }
      out.push(`<pre class="code-tok"><code>${body.join('\n')}</code></pre>`);
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush(); closeLists();
      out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush(); closeLists();
      out.push('<hr>');
    } else if (/^\s*>/.test(line)) {
      flush(); closeLists();
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderMd(body.join('\n'))}</blockquote>`);
    } else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flush();
      const indent = m[1].replace(/\t/g, '  ').length;
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = lists[lists.length - 1];
      if (!top || top.indent < indent) { out.push(`<${tag}>`); lists.push({ indent, tag }); }
      else {
        out.push('</li>');
        if (top.tag !== tag) { out.push(`</${top.tag}><${tag}>`); top.tag = tag; }
      }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      out.push(task ? `<li class="task"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}>${mdInline(task[2])}` : `<li>${mdInline(m[3])}`);
    } else if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush(); closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(c.trim()));
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (!line.trim()) {
      flush();
      blank = true;
    } else if (lists.length && (!wasBlank || /^(\s{2,}|\t)/.test(line))) {
      out.push(`${wasBlank ? '<br>' : ' '}${mdInline(line.trim())}`);      // Fortsetzung eines Listenpunkts
    } else {
      closeLists();
      para.push(mdInline(line.replace(/\\$/, '').trim()) + (/( {2,}|\\)$/.test(line) ? '<br>' : ''));
    }
  }
  flush();
  closeLists();
  return out.join('\n');
}

// ==========================================================================
// JSON prüfen: eigener kleiner Parser, damit die Fehlermeldung deutsch ist und eine genaue Stelle hat.
// Liefert null (gültig) oder {pos, msg}.
// ==========================================================================
function jsonCheck(src) {
  const n = src.length;
  let i = 0;
  const fail = (msg, pos = i) => { throw Object.assign(new Error(msg), { pos: Math.min(pos, n) }); };
  const ws = () => { while (i < n && (src[i] === ' ' || src[i] === '\n' || src[i] === '\t' || src[i] === '\r')) i++; };
  const string = () => {
    const start = i++;
    while (i < n) {
      const c = src[i];
      if (c === '"') { i++; return; }
      if (c === '\n') break;
      if (c === '\\') {
        const d = src[i + 1];
        if (d === 'u' && /^[\da-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) i += 6;
        else if (d && '"\\/bfnrt'.includes(d)) i += 2;
        else fail('Ungültige Escape-Sequenz in der Zeichenkette');
      } else if (c < ' ') fail('Steuerzeichen (z. B. Tabulator) sind in Zeichenketten nicht erlaubt');
      else i++;
    }
    fail('Die Zeichenkette ist nicht geschlossen – es fehlt ein „"“', start);
  };
  const list = (close, item, name) => {
    i++;
    ws();
    if (src[i] === close) { i++; return; }
    for (;;) {
      item();
      ws();
      if (src[i] === ',') {
        const comma = i++;
        ws();
        if (src[i] === close) fail(`Ein Komma vor „${close}“ ist in JSON nicht erlaubt`, comma);
      } else if (src[i] === close) { i++; return; }
      else fail(i >= n ? `Unerwartetes Ende – ${name} ist nicht geschlossen („${close}“ fehlt)` : `Hier fehlt ein Komma oder „${close}“`);
    }
  };
  const value = () => {
    ws();
    if (i >= n) fail('Unerwartetes Ende – hier fehlt ein Wert');
    const ch = src[i];
    if (ch === '{') {
      list('}', () => {
        ws();
        if (src[i] !== '"') fail(i >= n ? 'Unerwartetes Ende – das Objekt ist nicht geschlossen („}“ fehlt)' : 'Schlüssel müssen in doppelten Anführungszeichen stehen');
        string();
        ws();
        if (src[i] !== ':') fail('Nach dem Schlüssel fehlt ein Doppelpunkt');
        i++;
        value();
      }, 'das Objekt');
    } else if (ch === '[') list(']', value, 'die Liste');
    else if (ch === '"') string();
    else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const m = at(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y, src, i);
      if (!m) fail('Ungültige Zahl');
      i += m[0].length;
      if (/[\w.]/.test(src[i] || '')) fail('Ungültige Zahl');
    } else {
      const lit = ['true', 'false', 'null'].find((w) => src.startsWith(w, i));
      if (!lit) fail(ch === "'" ? 'Zeichenketten brauchen doppelte Anführungszeichen' : `Unerwartetes Zeichen „${ch}“`);
      i += lit.length;
    }
  };
  try {
    value();
    ws();
    if (i < n) fail('Nach dem Wert steht noch etwas, das nicht dazugehört');
    return null;
  } catch (err) {
    if (err.pos == null) throw err;
    return { pos: err.pos, msg: err.message };
  }
}

// ==========================================================================
// Sandbox: Diese Funktion läuft IM iframe (als Text eingebettet, daher ohne Zeilenkommentare und in sich
// geschlossen). Sie leitet console.* und Fehler per postMessage an den Editor und zählt laufende Timer.
// ==========================================================================
function bridge(T, MAX) {
  var sent = 0, pend = 0, timers = {}, marks = {}, counts = {};
  var con = window.console, st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval;
  var say = function (m) { m.__code = T; try { parent.postMessage(m, '*'); } catch (e) { /* nicht übertragbar */ } };
  var str = function (v) { try { return String(v); } catch (e) { return '[Objekt]'; } };
  var box = function (open, close, items, depth) {
    if (!items.length) { return open + close; }
    var one = items.join(', '), sp = open.slice(-1) === '{' ? ' ' : '';
    if (one.length <= 76 && one.indexOf('\n') < 0) { return open + sp + one + sp + close; }
    var pad = new Array(depth + 2).join('  ');
    return open + '\n' + pad + items.join(',\n' + pad) + '\n' + new Array(depth + 1).join('  ') + close;
  };
  var fmt = function (v, depth, seen) {
    var t = typeof v, items = [], i, keys, name;
    if (v === null) { return 'null'; }
    if (t === 'undefined') { return 'undefined'; }
    if (t === 'string') { return depth ? JSON.stringify(v) : v; }
    if (t === 'number' || t === 'boolean') { return String(v); }
    if (t === 'bigint') { return v + 'n'; }
    if (t === 'symbol') { return str(v); }
    if (t === 'function') { return 'ƒ ' + (v.name || 'anonym') + '()'; }
    if (v instanceof Error) { return (v.name || 'Error') + ': ' + v.message; }
    if (v instanceof Date) { return isNaN(v) ? 'Ungültiges Datum' : v.toISOString(); }
    if (v instanceof RegExp) { return str(v); }
    if (typeof Node !== 'undefined' && v instanceof Node) { return v.nodeType === 1 ? '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>' : v.nodeName; }
    if (seen.indexOf(v) >= 0) { return '[Zirkulär]'; }
    if (depth > 3) { return Array.isArray(v) ? '[…]' : '{…}'; }
    seen = seen.concat([v]);
    try {
      if (Array.isArray(v) || (ArrayBuffer.isView(v) && v.length !== undefined)) {
        for (i = 0; i < v.length && i < 100; i++) { items.push(fmt(v[i], depth + 1, seen)); }
        if (v.length > 100) { items.push('… ' + (v.length - 100) + ' weitere'); }
        return box(Array.isArray(v) ? '[' : v.constructor.name + ' [', ']', items, depth);
      }
      if (v instanceof Map) {
        v.forEach(function (val, key) { if (items.length < 50) { items.push(fmt(key, depth + 1, seen) + ' => ' + fmt(val, depth + 1, seen)); } });
        return box('Map(' + v.size + ') {', '}', items, depth);
      }
      if (v instanceof Set) {
        v.forEach(function (val) { if (items.length < 50) { items.push(fmt(val, depth + 1, seen)); } });
        return box('Set(' + v.size + ') {', '}', items, depth);
      }
      keys = Object.keys(v);
      for (i = 0; i < keys.length && i < 50; i++) { items.push((/^[A-Za-z_$][\w$]*$/.test(keys[i]) ? keys[i] : JSON.stringify(keys[i])) + ': ' + fmt(v[keys[i]], depth + 1, seen)); }
      if (keys.length > 50) { items.push('… ' + (keys.length - 50) + ' weitere'); }
      name = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
      return box(name + '{', '}', items, depth);
    } catch (e) { return str(v); }
  };
  var kind = function (v) {
    var t = typeof v;
    return t === 'number' || t === 'bigint' ? 'n' : v === null || t === 'undefined' || t === 'boolean' ? 'k' : t === 'function' ? 'f' : t === 'string' ? '' : 'o';
  };
  var emit = function (type, args) {
    var parts = [], i = 0, first = args[0];
    if (sent > MAX) { return; }
    if (++sent > MAX) { say({ type: 'warn', parts: [{ k: '', s: 'Zu viele Ausgaben – alles Weitere wird nicht mehr angezeigt.' }] }); return; }
    if (typeof first === 'string' && args.length > 1 && /%[sdifoOc]/.test(first)) {
      i = 1;
      first = first.replace(/%([sdifoOc])/g, function (m, c) {
        if (i >= args.length) { return m; }
        var a = args[i++];
        return c === 'c' ? '' : c === 'd' || c === 'i' ? String(parseInt(a, 10)) : c === 'f' ? String(parseFloat(a)) : fmt(a, c === 's' ? 0 : 1, []);
      });
      parts.push({ k: '', s: first });
    }
    for (; i < args.length; i++) { parts.push({ k: kind(args[i]), s: fmt(args[i], 0, []) }); }
    say({ type: type, parts: parts });
  };
  var busy = function () { say({ type: 'busy', n: pend }); };
  var drop = function (id) { if (timers[id]) { delete timers[id]; pend--; if (!pend) { busy(); } } };
  var keep = function (id) { timers[id] = 1; pend++; if (pend === 1) { busy(); } return id; };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) { con[m] = function () { emit(m === 'debug' ? 'log' : m, [].slice.call(arguments)); }; });
  con.table = con.dir = con.trace = con.group = con.groupCollapsed = con.log;
  con.groupEnd = function () {};
  con.clear = function () { say({ type: 'clear' }); };
  con.assert = function (ok) { if (!ok) { emit('error', ['Zusicherung fehlgeschlagen:'].concat([].slice.call(arguments, 1))); } };
  con.time = function (l) { marks[l || 'default'] = performance.now(); };
  con.timeEnd = function (l) {
    l = l || 'default';
    if (marks[l] !== undefined) { emit('log', [l + ': ' + (performance.now() - marks[l]).toFixed(1) + ' ms']); delete marks[l]; }
  };
  con.count = function (l) { l = l || 'default'; counts[l] = (counts[l] || 0) + 1; emit('log', [l + ': ' + counts[l]]); };
  window.setTimeout = function (fn, ms) {
    var a = [].slice.call(arguments, 2);
    var id = st(function () {
      if (timers[id]) { delete timers[id]; pend--; }
      try { if (typeof fn === 'function') { fn.apply(window, a); } else { (0, eval)(String(fn)); } } finally { if (!pend) { busy(); } }
    }, ms);
    return keep(id);
  };
  window.setInterval = function () { return keep(si.apply(window, arguments)); };
  window.clearTimeout = window.clearInterval = function (id) { drop(id); ct(id); };
  window.addEventListener('error', function (e) {
    var err = e.error;
    e.preventDefault();
    say({ type: 'error', parts: [{ k: '', s: err && err.name ? err.name + ': ' + err.message : e.message || 'Unbekannter Fehler' }], line: e.lineno || 0, col: e.colno || 0 });
  });
  window.addEventListener('unhandledrejection', function (e) {
    e.preventDefault();
    say({ type: 'error', parts: [{ k: '', s: 'Unbehandelte Ablehnung (Promise): ' + fmt(e.reason, 0, []) }] });
  });
}
const BRIDGE_SRC = bridge.toString().replace(/\n\s*/g, ' ');
// Die Sandbox bekommt kein Netz: nur Inline-Inhalte und data:/blob:-Adressen sind erlaubt.
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'unsafe-inline\' \'unsafe-eval\' data: blob:">';
const bridgeTag = (token) => `${CSP}<script>(${BRIDGE_SRC})(${JSON.stringify(token)}, 1500)</script>`;
const noClose = (code, tag) => code.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');

/** Dokument für „Ausführen“: Brücke in Zeile 1, der Code beginnt in Zeile 2 (für Zeilenangaben in Fehlern). */
function runDoc(code, token, module) {
  const type = module ? ' type="module"' : '';
  return `<!doctype html><meta charset="utf-8">${bridgeTag(token)}<script${type}>\n${noClose(code, 'script')}\n</script><script${type}>parent.postMessage({ __code: ${JSON.stringify(token)}, type: 'done' }, '*')</script>`;
}

/** Dokument für die HTML-Vorschau: Brücke direkt hinter dem Doctype, ohne Zeilen zu verschieben. */
function previewDoc(html, token, svg) {
  if (svg) return `<!doctype html><meta charset="utf-8">${bridgeTag(token)}<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fff}svg{max-width:96vw;max-height:96vh}</style>${html}`;
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  return m ? m[0] + bridgeTag(token) + html.slice(m[0].length) : bridgeTag(token) + html;
}

/** Bindet Stylesheets, Skripte und Bilder aus dem virtuellen Dateisystem direkt in die Seite ein. */
function inlineAssets(html, dir, read) {
  const local = (ref) => (!ref || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(ref) ? null : normalize(ref.split(/[?#]/)[0], dir));
  const attr = (tag, name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return m ? m[1] ?? m[2] ?? m[3] : null;
  };
  return html
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/stylesheet/i.test(attr(tag, 'rel') || '')) return tag;
      const css = read(local(attr(tag, 'href')));
      return css == null ? tag : `<style>${noClose(css, 'style')}</style>`;
    })
    .replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
      const js = read(local(attr(`<script${attrs}>`, 'src')));
      return js == null ? tag : `<script${attrs.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')}>${noClose(js, 'script')}</script>`;
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attr(tag, 'src');
      const data = read(local(src));
      return data && data.startsWith('data:image/') ? tag.replace(src, () => data) : tag;
    });
}

// ==========================================================================
// Beispielprojekt für den ersten Start
// ==========================================================================
const SAMPLES = {
  'hallo.js': `// hallo.js — drücke ⌘/Strg + Enter, um das Skript auszuführen.
// Es läuft in einer abgeschotteten Sandbox; die Ausgabe erscheint unten in der Konsole.

const namen = ['Ada', 'Grace', 'Linus'];

function begruesse(name) {
  return \`Hallo, \${name}!\`;
}

for (const name of namen) {
  console.log(begruesse(name));
}

const quadrate = Array.from({ length: 6 }, (_, i) => i * i);
console.info('Quadratzahlen:', quadrate);

console.log({
  summe: quadrate.reduce((a, b) => a + b, 0),
  gerade: quadrate.filter((n) => n % 2 === 0),
});

console.warn('So sieht eine Warnung aus.');

setTimeout(() => console.log('… und das hier kommt eine Sekunde später.'), 1000);
`,
  'seite.html': `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Meine Seite</title>
  <link rel="stylesheet" href="stil.css">
</head>
<body>
  <main class="karte">
    <h1>Hallo, Web!</h1>
    <p>Ändere diesen Text – die Vorschau folgt beim Tippen.</p>
    <button id="knopf">Klick mich</button>
    <p id="zaehler">Noch nicht geklickt.</p>
  </main>

  <script>
    const knopf = document.getElementById('knopf');
    const zaehler = document.getElementById('zaehler');
    let klicks = 0;

    knopf.addEventListener('click', () => {
      klicks += 1;
      zaehler.textContent = klicks === 1 ? 'Einmal geklickt.' : \`\${klicks}-mal geklickt.\`;
      console.log('Klick Nummer', klicks);
    });
  </script>
</body>
</html>
`,
  'stil.css': `/* stil.css — gehört zu seite.html. Deren Vorschau übernimmt Änderungen von hier, auch ungesicherte. */
:root {
  --akzent: #5b6cff;
  --papier: #f3f5fc;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--papier);
  font-family: system-ui, sans-serif;
  color: #1d2033;
}

.karte {
  width: min(340px, 84vw);
  padding: 28px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 18px 50px -20px rgba(40, 50, 120, 0.45);
  text-align: center;
}

h1 {
  margin: 0 0 8px;
  color: var(--akzent);
}

button {
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--akzent);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s;
}

button:hover {
  transform: scale(1.05);
}
`,
};

// ==========================================================================
// Editor: eine durchsichtige textarea liegt exakt über den eingefärbten Zeilen (gleiche Schrift, gleiche
// Zeilenhöhe, Scrollen synchron). Jede Zeile ist ein eigenes Element – nach einer Eingabe werden nur die
// geänderten Zeilen neu gefärbt; ändert sich der Zustand (z. B. offener Kommentar), läuft der Rest
// entprellt in Häppchen nach. So bleiben auch große Dateien flüssig.
// ==========================================================================
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = ')]}';
const VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createEditor({ text = '', lang = 'text', wrap = false, readOnly = false, onChange, onCaret }) {
  const gutter = h('div.code-gutter', { 'aria-hidden': 'true' });
  const linesEl = h('div.code-lines');
  const hl = h('div.code-hl.code-tok', { 'aria-hidden': 'true' }, linesEl);
  const ta = h('textarea.code-ta.scroll', { spellcheck: false, autocomplete: 'off', wrap: 'off', readOnly, 'aria-label': 'Quelltext' });
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocorrect', 'off');
  const el = h('div.code-ed', { class: wrap ? 'is-wrap' : '' }, gutter, h('div.code-stage', hl, ta));

  let lines = [''];
  let toks = [[]];
  let states = ['', ''];       // states[i] = Zustand am Anfang von Zeile i; states[n] = Zustand am Ende
  let els = [];
  let starts = [0];
  const marks = new Map();     // Zeilen-Element → {arr, sig}
  let curEl = null, curG = null;
  let dirtyFrom = -1, dirtyTo = -1;
  let timer = 0, raf = 0, dead = false;
  let keep = null;             // gemerkte Scrollposition, solange der Reiter verborgen ist

  const html = (i) => lineHtml(toks[i], marks.get(els[i])?.arr);
  const lineAt = (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const reindex = () => {
    starts = new Array(lines.length);
    for (let i = 0, p = 0; i < lines.length; i++) { starts[i] = p; p += lines[i].length + 1; }
  };
  const paintGutter = () => {
    const n = lines.length;
    const have = gutter.childElementCount;
    if (n > have) {
      let s = '';
      for (let i = have + 1; i <= n; i++) s += `<div>${i}</div>`;
      gutter.insertAdjacentHTML('beforeend', s);
    } else for (let i = have; i > n; i--) gutter.lastElementChild.remove();
    el.style.setProperty('--code-digits', Math.max(3, String(n).length));
  };
  const fit = () => { linesEl.style.width = wrap && ta.clientWidth ? `${ta.clientWidth}px` : ''; };
  const scrollSync = () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; };

  /** Alles neu aufbauen (Laden, Sprachwechsel, sehr große Änderungen). */
  const build = () => {
    lines = ta.value.split('\n');
    const n = lines.length;
    toks = new Array(n);
    states = new Array(n + 1);
    let st = '';
    let s = '';
    for (let i = 0; i < n; i++) {
      states[i] = st;
      const r = tokenize(lang, lines[i], st);
      toks[i] = r[0];
      st = r[1];
      s += `<div class="code-cl">${lineHtml(r[0])}</div>`;
    }
    states[n] = st;
    linesEl.innerHTML = s;
    els = [...linesEl.children];
    marks.clear();
    curEl = null;
    dirtyFrom = dirtyTo = -1;
    clearTimeout(timer);
    reindex();
    paintGutter();
  };

  /** Färbt ab dirtyFrom weiter, bis der Zustand wieder zum gespeicherten passt. */
  const propagate = (budget, delay) => {
    let i = dirtyFrom;
    if (i < 0) return;
    const n = lines.length;
    while (i < n && budget-- > 0) {
      const r = tokenize(lang, lines[i], states[i]);
      toks[i] = r[0];
      els[i].innerHTML = html(i);
      i++;
      if (r[1] !== states[i]) states[i] = r[1];
      else if (i > dirtyTo) { dirtyFrom = dirtyTo = -1; return; }
    }
    if (i >= n) { dirtyFrom = dirtyTo = -1; return; }
    dirtyFrom = i;
    dirtyTo = Math.max(dirtyTo, i);
    clearTimeout(timer);
    timer = setTimeout(() => { if (!dead) propagate(1500, 16); }, delay);
  };

  /** Gleicht die Zeilen mit dem Text der textarea ab und färbt nur das Geänderte neu. */
  const sync = () => {
    const next = ta.value.split('\n');
    const old = lines;
    const max = Math.min(old.length, next.length);
    let a = 0;
    while (a < max && old[a] === next[a]) a++;
    let b = 0;
    while (b < max - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    const del = old.length - a - b;
    const add = next.length - a - b;
    if (!del && !add) return;
    if (del > 4000 || add > 4000) { build(); return; }
    const reuse = Math.min(del, add);
    const nt = [], ns = [], ne = [];
    let st = states[a];
    for (let k = 0; k < add; k++) {
      const r = tokenize(lang, next[a + k], st);
      nt.push(r[0]);
      ns.push(st);
      st = r[1];
      let node = k < reuse ? els[a + k] : null;
      if (node) marks.delete(node); else { node = document.createElement('div'); node.className = 'code-cl'; }
      node.innerHTML = lineHtml(r[0]);
      ne.push(node);
    }
    for (let k = reuse; k < del; k++) { marks.delete(els[a + k]); els[a + k].remove(); }
    if (add > reuse) {
      const frag = document.createDocumentFragment();
      for (let k = reuse; k < add; k++) frag.append(ne[k]);
      linesEl.insertBefore(frag, els[a + del] || null);
    }
    lines = next;
    toks.splice(a, del, ...nt);
    states.splice(a, del, ...ns);
    els.splice(a, del, ...ne);
    const after = a + add;
    if (dirtyFrom >= 0) {
      const mv = (x) => (x >= a + del ? x + add - del : Math.min(x, after));
      dirtyFrom = mv(dirtyFrom);
      dirtyTo = mv(dirtyTo);
    }
    if (states[after] !== st) {
      states[after] = st;
      dirtyFrom = dirtyFrom < 0 ? after : Math.min(dirtyFrom, after);
      dirtyTo = Math.max(dirtyTo, after);
    }
    reindex();
    if (add !== del) paintGutter();
    propagate(300, 140);
  };

  const caret = () => {
    raf = 0;
    if (dead) return;
    const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const li = lineAt(pos);
    const node = els[li] || null;
    if (node !== curEl) { curEl?.classList.remove('is-cur'); curEl = node; node?.classList.add('is-cur'); }
    const g = gutter.children[li] || null;
    if (g !== curG) { curG?.classList.remove('is-cur'); curG = g; g?.classList.add('is-cur'); }
    onCaret?.({ line: li + 1, col: pos - starts[li] + 1, sel: ta.selectionEnd - ta.selectionStart });
  };
  const caretSoon = () => { if (!raf) raf = requestAnimationFrame(caret); };

  /** Text ersetzen – über execCommand, damit ⌘Z des Browsers weiter funktioniert. */
  const insert = (text, from = ta.selectionStart, to = ta.selectionEnd, selFrom = null, selTo = selFrom) => {
    if (ta.readOnly) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(from, to);
    let ok = false;
    if (text.length < 100000) {
      try { ok = text ? document.execCommand('insertText', false, text) : from === to || document.execCommand('delete'); } catch { ok = false; }
    }
    if (!ok) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (selFrom != null) ta.setSelectionRange(selFrom, selTo);
    caretSoon();
  };

  /** Bereich der ganzen Zeilen, die die Auswahl berührt. */
  const block = () => {
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', en > s && v[en - 1] === '\n' ? en - 1 : en);
    if (le < 0) le = v.length;
    return { s, en, v, ls, le, rows: v.slice(ls, le).split('\n') };
  };

  const toggleComment = () => {
    const c = COMMENT[lang];
    if (!c || ta.readOnly) return false;
    const { s, en, ls, le, rows } = block();
    const a = c[0].trim(), z = c[1].trim();
    const live = rows.filter((l) => l.trim());
    if (!live.length) return true;
    const on = live.every((l) => l.trim().startsWith(a) && l.trim().endsWith(z));
    const indent = Math.min(...live.map((l) => /^\s*/.exec(l)[0].length));
    let d0 = 0;
    const out = rows.map((l, i) => {
      if (!l.trim()) return l;
      let res;
      if (on) {
        const p = l.indexOf(a);
        let rest = l.slice(p + a.length);
        if (rest.startsWith(' ')) rest = rest.slice(1);
        if (z) rest = rest.replace(new RegExp(`\\s?${escRe(z)}\\s*$`), '');
        res = l.slice(0, p) + rest;
        if (!i) d0 = -(l.length - res.length - (z ? l.length - l.lastIndexOf(z) + 1 : 0));
      } else {
        res = l.slice(0, indent) + c[0] + l.slice(indent) + c[1];
        if (!i) d0 = c[0].length;
      }
      return res;
    });
    const res = out.join('\n');
    if (s === en) insert(res, ls, le, clamp(s + d0, ls, ls + out[0].length));
    else insert(res, ls, le, ls, ls + res.length);
    return true;
  };

  const onKey = (e) => {
    if (e.isComposing || ta.readOnly) return;
    const mod = e.metaKey || e.ctrlKey;
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (!e.shiftKey && !v.slice(s, en).includes('\n')) {
        const col = s - (v.lastIndexOf('\n', s - 1) + 1);
        insert(' '.repeat(2 - (col % 2)), s, en);
        return;
      }
      const { ls, le, rows } = block();
      let first = 0, all = 0;
      const out = rows.map((l, i) => {
        let d = 0, res = l;
        if (!e.shiftKey) { if (l || rows.length === 1) { res = `  ${l}`; d = 2; } }
        else { const m = /^(\t| {1,2})/.exec(l); if (m) { res = l.slice(m[0].length); d = -m[0].length; } }
        if (!i) first = d;
        all += d;
        return res;
      });
      if (all) insert(out.join('\n'), ls, le, Math.max(ls, s + first), Math.max(ls, en + all));
    } else if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const before = v.slice(ls, s);
      const indent = /^[ \t]*/.exec(before)[0];
      const closer = { '{': '}', '[': ']', '(': ')' }[v[s - 1]];
      const tag = lang === 'html' ? /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?>$/.exec(before) : null;
      const open = closer || (tag && !VOID_TAGS.test(tag[1]) && !before.endsWith('/>'));
      if (!open) { insert(`\n${indent}`, s, en); return; }
      const split = closer ? v[en] === closer : v.startsWith('</', en);
      insert(`\n${indent}  ${split ? `\n${indent}` : ''}`, s, en, s + indent.length + 3);
    } else if (e.key === 'Backspace' && !mod && !e.altKey && s === en && s > 0 && v[s] && PAIRS[v[s - 1]] === v[s]) {
      e.preventDefault();
      insert('', s - 1, s + 1);
    } else if (mod && !e.altKey && e.key === '/') {
      if (toggleComment()) e.preventDefault();
    } else if (e.key.length === 1 && !e.metaKey && !(e.ctrlKey && !e.altKey)) {
      const k = e.key;
      const close = PAIRS[k];
      const quote = close === k;
      if (s === en && v[s] === k && (quote || CLOSERS.includes(k))) {      // schon da: nur darüber hinweg
        e.preventDefault();
        ta.setSelectionRange(s + 1, s + 1);
        caretSoon();
        return;
      }
      const pairs = lang === 'text' ? '([{'.includes(k) : lang === 'md' ? k !== "'" : true;
      if (close && pairs) {
        if (s !== en) { e.preventDefault(); insert(k + v.slice(s, en) + close, s, en, s + 1, en + 1); return; }
        const nx = v[s] || '', pv = v[s - 1] || '';
        if ((!nx || /[\s)\]}>,;:]/.test(nx)) && (!quote || !/[\w$\\'"`]/.test(pv))) { e.preventDefault(); insert(k + close, s, en, s + 1); return; }
      }
      if (CLOSERS.includes(k) && s === en && lang !== 'text' && lang !== 'md') {      // schließende Klammer rückt eine Stufe aus
        const before = v.slice(v.lastIndexOf('\n', s - 1) + 1, s);
        if (before.length >= 2 && !before.trim()) { e.preventDefault(); insert(k, s - 2, s); }
      }
    }
  };

  ta.addEventListener('input', () => { sync(); if (wrap) fit(); caretSoon(); onChange?.(); });
  ta.addEventListener('keydown', (e) => { onKey(e); caretSoon(); });
  ta.addEventListener('scroll', scrollSync, { passive: true });
  for (const evt of ['keyup', 'pointerdown', 'pointerup', 'focus', 'select', 'selectionchange']) ta.addEventListener(evt, caretSoon);
  ta.addEventListener('pointermove', (e) => { if (e.buttons) caretSoon(); });
  const ro = new ResizeObserver(() => { fit(); scrollSync(); });
  ro.observe(ta);

  ta.value = text;
  build();

  const api = {
    el, ta,
    get value() { return ta.value; },
    get lineCount() { return lines.length; },
    get lang() { return lang; },
    get readOnly() { return ta.readOnly; },
    /** Inhalt ersetzen, ohne Rückgängig-Verlauf (Laden, von außen geändert). */
    setValue(v) { ta.value = v; build(); fit(); caret(); },
    replace: insert,
    setLang(l) { lang = l; build(); caret(); },
    setWrap(w) {
      wrap = w;
      el.classList.toggle('is-wrap', w);
      ta.wrap = w ? 'soft' : 'off';
      fit();
      scrollSync();
    },
    show(on) {
      if (!on && !el.hidden) keep = [ta.scrollTop, ta.scrollLeft];
      el.hidden = !on;
      if (on) {
        fit();
        if (keep) { ta.scrollTop = keep[0]; ta.scrollLeft = keep[1]; keep = null; }
        scrollSync();
      }
    },
    /** Suchtreffer hervorheben: ranges = [[von, bis], …] als Textpositionen, cur = Index des aktuellen. */
    setMarks(ranges, cur = -1) {
      const next = new Map();
      ranges.forEach(([from, to], k) => {
        let li = lineAt(from);
        let pos = from;
        while (pos < to && li < lines.length) {
          const a = pos - starts[li];
          const b = Math.min(to - starts[li], lines[li].length);
          if (b > a) {
            const node = els[li];
            if (!next.has(node)) next.set(node, []);
            next.get(node).push([a, b, k === cur]);
          }
          li++;
          pos = starts[li] ?? to;
        }
      });
      if (!marks.size && !next.size) return;
      els.forEach((node, i) => {
        const had = marks.get(node);
        const arr = next.get(node);
        if (!had && !arr) return;
        const sig = arr ? arr.join(';') : '';
        if ((had?.sig || '') === sig) return;
        if (arr) marks.set(node, { arr, sig }); else marks.delete(node);
        node.innerHTML = html(i);
      });
    },
    reveal(pos) {
      const li = lineAt(pos);
      const node = els[li];
      if (!node || el.hidden) return;
      const top = node.offsetTop, hgt = node.offsetHeight, vh = ta.clientHeight;
      if (top < ta.scrollTop + 4 || top + hgt > ta.scrollTop + vh - 4) ta.scrollTop = Math.max(0, top - (vh - hgt) / 2);
      if (!wrap) {
        const probe = h('span', { style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' } }, 'x'.repeat(40));
        hl.append(probe);
        const x = (pos - starts[li]) * (probe.getBoundingClientRect().width / 40);
        probe.remove();
        if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 60) ta.scrollLeft = Math.max(0, x - ta.clientWidth / 2);
      }
      scrollSync();
    },
    select(from, to = from, focus = true) {
      if (focus) ta.focus({ preventScroll: true });
      ta.setSelectionRange(from, to);
      api.reveal(from);
      caretSoon();
    },
    gotoLine(n, col = 1) {
      const li = clamp(Math.round(n) || 1, 1, lines.length) - 1;
      api.select(starts[li] + clamp((Math.round(col) || 1) - 1, 0, lines[li].length));
    },
    caret: () => {
      const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
      const li = lineAt(pos);
      return { pos, line: li + 1, col: pos - starts[li] + 1 };
    },
    posToLine: (pos) => lineAt(pos) + 1,
    toggleComment,
    focus() { ta.focus({ preventScroll: true }); },
    layout() { fit(); scrollSync(); },
    destroy() { dead = true; clearTimeout(timer); cancelAnimationFrame(raf); ro.disconnect(); },
  };
  return api;
}

// ==========================================================================
// Die App
// ==========================================================================
const store = appStore('code');
const PREFS = { fs: 13, wrap: false, conH: 150, split: 46 };
const textFile = (st) => !/^(image|audio|video)\//.test(st.mime) && !/\.(png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm)$/i.test(st.name);
const hasPreview = (d) => d.lang === 'html' || d.lang === 'md';
const newToken = () => `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export default {
  singleton: true,
  width: 900, height: 620, minW: 420, minH: 320,

  mount(win, args) {
    const prefs = { ...PREFS, ...store.get('prefs', {}) };
    const savePrefs = () => store.set('prefs', prefs);
    const docs = [];             // {id, path, name, lang, saved, dirty, readOnly, preview, ed, tab}
    let cur = null;
    let closed = false;
    let title = '';
    const offs = [];

    // ---------- Gerüst ----------
    const tablist = h('div.code-tablist', { role: 'tablist', 'aria-label': 'Geöffnete Dateien' });
    const findBar = h('div.code-find', { hidden: true });
    const none = h('div.code-none', { hidden: true },
      emptyState('code', 'Keine Datei geöffnet', 'Lege eine neue Datei an oder öffne eine aus deinen Dokumenten.'),
      h('div', h('button.kit-btn', { type: 'button', onclick: () => newDoc() }, 'Neue Datei'), h('button.kit-btn.primary', { type: 'button', onclick: () => open() }, 'Öffnen …')));
    const eds = h('div.code-eds', none);
    const splitEl = h('div.code-split', { hidden: true, role: 'separator', 'aria-label': 'Größe der Vorschau' });
    const pBody = h('div.code-pbody');
    const prev = h('div.code-prev', { hidden: true },
      h('div.code-phead', h('span', 'Vorschau'), h('span.sp'),
        toolBtn('reload', 'Vorschau neu laden', () => renderPreview()),
        toolBtn('close', 'Vorschau schließen', () => setPreview(false))),
      pBody);
    const work = h('div.code-work', { style: { '--code-split': `${prefs.split}%` } }, eds, splitEl, prev);
    const cOut = h('div.code-cout.scroll', { role: 'log', tabIndex: 0, 'aria-label': 'Ausgabe der Konsole' });
    const cState = h('span.code-cstate', h('i'), h('span', 'Bereit'));
    const bStop = toolBtn('stop', 'Ausführung abbrechen', () => stopRun(true));
    const grip = h('div.code-cgrip');
    const con = h('div.code-con', { hidden: true }, grip,
      h('div.code-chead', h('b', 'Konsole'), cState, h('span.sp'), bStop,
        toolBtn('trash', 'Konsole leeren', () => clearCon()),
        toolBtn('chevronDown', 'Konsole schließen', () => setCon(false))),
      cOut);
    const sPos = h('button.code-stat', { type: 'button', title: 'Gehe zu Zeile … (⌘L)', onclick: () => gotoLine() });
    const sSel = h('span.code-stat.code-hide-s', { hidden: true });
    const sLang = h('button.code-stat', { type: 'button', title: 'Sprache der Datei', onclick: () => langMenu() });
    const sLen = h('span.code-stat.code-hide-s');
    const sFs = h('span.code-stat.code-hide-xs', { title: 'Schriftgröße' });
    const sWrap = h('button.code-stat', { type: 'button', 'aria-label': 'Zeilenumbruch', title: 'Zeilenumbruch', html: I_WRAP, onclick: () => setWrap(!prefs.wrap) });
    const sBadge = h('em', { hidden: true });
    const sCon = h('button.code-stat', { type: 'button', title: 'Konsole ein- oder ausblenden', onclick: () => setCon(con.hidden) }, 'Konsole', sBadge);
    const foot = h('div.kit-foot.code-foot', sPos, sSel, h('span.sp'), sLang, sLen,
      h('button.code-stat.code-hide-xs', { type: 'button', 'aria-label': 'Schrift kleiner', title: 'Schrift kleiner (⌘−)', html: icon('minus'), onclick: () => setFs(-1) }), sFs,
      h('button.code-stat.code-hide-xs', { type: 'button', 'aria-label': 'Schrift größer', title: 'Schrift größer (⌘+)', html: icon('plus'), onclick: () => setFs(1) }),
      sWrap, sCon);
    const root = h('div.code', h('div.code-tabs', tablist, toolBtn('plus', 'Neue Datei', () => newDoc())), findBar, work, con, foot);
    win.body.append(root);

    const bSave = h('button.tool', { type: 'button', 'aria-label': 'Sichern', title: 'Sichern (⌘S)', html: I_SAVE, onclick: () => save() });
    const bPrev = h('button.tool', { type: 'button', 'aria-label': 'Vorschau', title: 'Vorschau ein- oder ausblenden', html: I_SPLIT, onclick: () => setPreview(!cur?.preview) });
    const bRun = h('button.tool.code-run', { type: 'button', onclick: () => (running() ? stopRun(true) : run()) });
    win.tools.append(toolBtn('folder', 'Öffnen … (⌘O)', () => open()), bSave, toolBtn('search', 'Suchen & Ersetzen (⌘F)', () => openFind()), bPrev, bRun);
    win.tools.style.minWidth = 'max-content';      // im schmalen Fenster weicht der Titel aus, nicht die Knöpfe

    // ---------- Anzeige ----------
    const paintTab = (doc) => {
      const L = LANGS[doc.lang];
      const [ext, name, x] = doc.tab.children;
      ext.textContent = L.tag;
      ext.style.setProperty('--tc', `var(${L.tint})`);
      name.textContent = doc.name;
      doc.tab.title = doc.path ? pretty(doc.path) : 'Noch nicht gesichert';
      doc.tab.classList.toggle('is-dirty', doc.dirty);
      doc.tab.classList.toggle('is-on', doc === cur);
      doc.tab.setAttribute('aria-selected', String(doc === cur));
      x.setAttribute('aria-label', `${doc.name} schließen`);
    };
    const paintTitle = () => {
      const t = cur ? `${cur.name}${cur.dirty ? ' – bearbeitet' : ''} – Code` : 'Code';
      if (t !== title) { title = t; win.setTitle(t); }
    };
    const paintLen = () => { sLen.textContent = cur ? `${cur.ed.value.length.toLocaleString('de-DE')} Zeichen` : ''; };
    const paintCaret = (c) => {
      sPos.textContent = `Zeile ${c.line.toLocaleString('de-DE')}, Spalte ${c.col}`;
      sSel.hidden = !c.sel;
      sSel.textContent = c.sel ? `${c.sel.toLocaleString('de-DE')} ausgewählt` : '';
    };
    const paintRun = () => {
      const on = running();
      const lang = cur?.lang;
      const label = on ? 'Abbrechen' : lang === 'json' ? 'JSON formatieren (⌘↩)' : lang === 'html' || lang === 'md' ? 'Vorschau aktualisieren (⌘↩)' : lang === 'js' ? 'Ausführen (⌘↩)' : 'Diese Datei lässt sich nicht ausführen';
      const ico = on ? 'stop' : lang === 'json' ? 'sparkles' : 'play';
      if (bRun.dataset.ico !== ico) { bRun.dataset.ico = ico; bRun.innerHTML = icon(ico); }
      bRun.title = label;
      bRun.setAttribute('aria-label', label);
      bRun.classList.toggle('is-stop', on);
      bRun.disabled = !on && (!cur || lang === 'css' || lang === 'text');
      bStop.hidden = !on;
      cState.classList.toggle('is-run', on);
      cState.lastChild.textContent = on ? (job.done ? 'Wartet auf Timer …' : 'Läuft …') : job ? 'Beendet' : 'Bereit';
    };
    const paintChrome = () => {
      paintTitle();
      paintLen();
      paintRun();
      for (const el of [sPos, sLang, sLen]) el.hidden = !cur;
      if (cur) { sLang.textContent = LANGS[cur.lang].name; paintCaret({ ...cur.ed.caret(), sel: 0 }); } else sSel.hidden = true;
      bSave.disabled = !cur;
      bPrev.disabled = !cur || !hasPreview(cur);
      sFs.textContent = `${prefs.fs} px`;
      sWrap.classList.toggle('is-on', prefs.wrap);
    };
    const applyFont = () => {
      root.style.setProperty('--code-fs', `${prefs.fs}px`);
      root.style.setProperty('--code-lh', `${Math.round(prefs.fs * 1.55)}px`);
    };
    const setFs = (d) => {
      prefs.fs = clamp(prefs.fs + d, 10, 22);
      applyFont();
      savePrefs();
      sFs.textContent = `${prefs.fs} px`;
      cur?.ed.layout();
    };
    const setWrap = (on) => {
      prefs.wrap = on;
      savePrefs();
      for (const d of docs) d.ed.setWrap(on);
      sWrap.classList.toggle('is-on', on);
    };
    const fail = (head, text) => sheet(win, { title: head, text });

    // ---------- Dokumente und Reiter ----------
    const isDirty = (doc) => { const v = doc.ed.value; return v.length !== doc.saved.length || v !== doc.saved; };
    const makeTab = (doc) => {
      const x = h('button.code-tab-x', { type: 'button', tabIndex: -1, html: icon('close') }, h('i'));
      const tab = h('div.code-tab', { role: 'tab', tabIndex: 0 }, h('span.code-tab-ext'), h('span.code-tab-name'), x);
      x.addEventListener('click', (e) => { e.stopPropagation(); closeDoc(doc); });
      tab.addEventListener('click', () => activate(doc));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeDoc(doc); } });
      tab.addEventListener('keydown', (e) => {
        if (e.target !== tab || e.metaKey || e.ctrlKey || e.altKey) return;
        const next = docs[docs.indexOf(doc) + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0)];
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(doc); }
        else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && next) { e.preventDefault(); activate(next, false); next.tab.focus(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); closeDoc(doc); }
      });
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu([
          { label: 'Sichern', disabled: doc.readOnly && !!doc.path, run: () => save(doc) },
          { label: 'Sichern unter …', run: () => saveAs(doc) },
          doc.path ? { label: 'Im Ordner zeigen', icon: 'folder', run: () => sys.open('files', { path: dirname(doc.path) }) } : null,
          '-',
          { label: 'Schließen', icon: 'close', run: () => closeDoc(doc) },
          { label: 'Andere schließen', disabled: docs.length < 2, run: async () => { for (const d of [...docs]) if (d !== doc && !(await closeDoc(d))) break; } },
        ], { x: e.clientX, y: e.clientY });
      });
      return tab;
    };
    const addDoc = ({ path = null, name = '', text = '', saved = null, lang = null, preview = null }) => {
      const doc = { path, name: name || (path ? basename(path) : 'Unbenannt.js'), saved: saved ?? (path ? text : ''), readOnly: !!path && path.startsWith('/System/'), dirty: false, gone: false };
      doc.lang = LANGS[lang] ? lang : langOf(doc.name);
      doc.preview = hasPreview(doc) && (preview ?? win.rect.w >= 640);
      doc.ed = createEditor({
        text, lang: doc.lang, wrap: prefs.wrap, readOnly: doc.readOnly,
        onChange: () => changed(doc),
        onCaret: (c) => { if (doc === cur) paintCaret(c); },
      });
      doc.ed.el.hidden = true;
      doc.tab = makeTab(doc);
      doc.dirty = isDirty(doc);
      eds.append(doc.ed.el);
      tablist.append(doc.tab);
      docs.push(doc);
      paintTab(doc);
      return doc;
    };
    const activate = (doc, focus = true) => {
      doc = doc || null;
      if (doc !== cur) {
        const old = cur;
        cur = doc;
        if (old) { old.ed.setMarks([]); old.ed.show(false); if (docs.includes(old)) paintTab(old); }
        none.hidden = !!doc;
        if (doc) {
          doc.ed.show(true);
          paintTab(doc);
          const t = doc.tab;
          if (t.offsetLeft < tablist.scrollLeft) tablist.scrollLeft = t.offsetLeft;
          else if (t.offsetLeft + t.offsetWidth > tablist.scrollLeft + tablist.clientWidth) tablist.scrollLeft = t.offsetLeft + t.offsetWidth - tablist.clientWidth;
        }
        paintChrome();
        layoutPreview();
        if (find.open) runFind();
        persist();
      }
      if (doc && focus) doc.ed.focus();
    };
    const changed = (doc) => {
      const dirty = doc.gone || isDirty(doc);
      if (dirty !== doc.dirty) { doc.dirty = dirty; paintTab(doc); }
      if (doc === cur) { paintLen(); paintTitle(); if (find.open) findSoon(); }
      previewSoon(doc);
      persist();
    };
    const dropDoc = (doc) => {
      const i = docs.indexOf(doc);
      if (i < 0) return;
      docs.splice(i, 1);
      doc.ed.destroy();
      doc.ed.el.remove();
      doc.tab.remove();
      if (cur === doc) activate(docs[Math.min(i, docs.length - 1)], !win.el.querySelector('.kit-sheet-wrap'));
      persist();
    };
    const closeDoc = async (doc) => {
      if (!doc || !docs.includes(doc)) return false;
      if (doc.dirty) {
        activate(doc, false);
        const ans = await sheet(win, {
          title: `Änderungen an „${doc.name}“ sichern?`,
          text: 'Wenn du nicht sicherst, gehen deine Änderungen verloren.',
          cancelValue: 'cancel',
          buttons: [{ label: 'Nicht sichern', value: 'drop' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Sichern', value: 'save', primary: true }],
        });
        if (ans === 'cancel' || closed) return false;
        if (ans === 'save' && !(await save(doc))) return false;
      }
      dropDoc(doc);
      return true;
    };
    const newDoc = () => {
      const names = new Set(docs.map((d) => d.name));
      let name = 'Unbenannt.js';
      for (let n = 2; names.has(name); n++) name = `Unbenannt ${n}.js`;
      activate(addDoc({ name }));
    };

    // ---------- Dateien ----------
    const readText = (path) => {
      const st = vfs.stat(path);
      if (!st || st.type !== 'file') throw new Error('Die Datei wurde nicht gefunden.');
      if (st.size > MAX_FILE) throw new Error(`Mit ${formatSize(st.size)} ist die Datei zu groß für den Editor (höchstens ${formatSize(MAX_FILE)}).`);
      const data = vfs.read(path);
      if (!textFile(st) || /^data:[\w/+.-]+;base64,/.test(data)) throw new Error('Das ist keine Textdatei. Bilder und Töne öffnest du mit einer anderen App.');
      return data;
    };
    const openPath = (path) => {
      path = normalize(path);
      const ex = docs.find((d) => d.path === path);
      if (ex) { activate(ex); return ex; }
      try {
        const blank = docs.length === 1 && !docs[0].path && !docs[0].ed.value ? docs[0] : null;     // unberührtes „Unbenannt“ ersetzen
        const doc = addDoc({ path, text: readText(path) });
        activate(doc);
        if (blank) dropDoc(blank);
        return doc;
      } catch (err) {
        fail(`„${basename(path)}“ lässt sich nicht öffnen`, err.message);
        return null;
      }
    };
    const workDir = () => {
      if (cur?.path && vfs.isDir(dirname(cur.path)) && !cur.readOnly) return dirname(cur.path);
      try {
        if (!vfs.isDir(DIR)) vfs.mkdir(DIR);
        return DIR;
      } catch { return `${HOME}/Dokumente`; }
    };
    const open = async () => {
      const p = await openDialog(win, { title: 'Datei öffnen', dir: workDir(), filter: textFile });
      if (p && !closed) openPath(p);
    };
    const write = (doc, path) => {
      const text = doc.ed.value;
      try { vfs.write(path, text); } catch (err) { fail('Sichern hat nicht geklappt', err.message); return false; }
      doc.saved = text;
      doc.dirty = doc.gone = false;
      if (path !== doc.path || doc.readOnly) {
        doc.path = path;
        doc.name = basename(path);
        doc.readOnly = false;
        doc.ed.ta.readOnly = false;
        const lang = langOf(doc.name);
        if (lang !== doc.lang) { doc.lang = lang; doc.ed.setLang(lang); if (!hasPreview(doc)) doc.preview = false; }
      }
      paintTab(doc);
      if (doc === cur) { paintChrome(); layoutPreview(); }
      persist();
      toast(win, `„${doc.name}“ gesichert`);
      return true;
    };
    const saveAs = async (doc = cur) => {
      if (!doc) return false;
      const p = await saveDialog(win, { title: 'Sichern unter', dir: doc.path && !doc.readOnly ? dirname(doc.path) : workDir(), name: doc.name });
      if (!p || closed || !docs.includes(doc)) return false;
      if (docs.some((d) => d !== doc && d.path === p)) { fail('Diese Datei ist gerade geöffnet', 'Schließe zuerst den anderen Reiter oder wähle einen anderen Namen.'); return false; }
      return write(doc, p);
    };
    const save = (doc = cur) => {
      if (!doc) return false;
      return doc.path && !doc.readOnly ? write(doc, doc.path) : saveAs(doc);
    };
    const langMenu = () => {
      if (!cur) return;
      const r = sLang.getBoundingClientRect();
      openMenu(Object.entries(LANGS).map(([id, L]) => ({
        label: L.name, checked: cur.lang === id,
        run: () => {
          if (!cur || cur.lang === id) return;
          cur.lang = id;
          cur.ed.setLang(id);
          if (!hasPreview(cur)) cur.preview = false;
          paintTab(cur);
          paintChrome();
          layoutPreview();
          if (find.open) runFind();
          persist();
        },
      })), { x: r.left, y: r.top - 196 });
    };
    const gotoLine = async () => {
      if (!cur) return;
      const doc = cur;
      const v = await promptSheet(win, { title: 'Gehe zu Zeile', text: `Zeile 1 bis ${doc.ed.lineCount.toLocaleString('de-DE')} – wahlweise mit Spalte, z. B. 12:5.`, value: String(doc.ed.caret().line), ok: 'Gehe zu' });
      if (!v || closed || doc !== cur) return;
      const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(v);
      if (m) doc.ed.gotoLine(+m[1], m[2] ? +m[2] : 1); else toast(win, 'Bitte eine Zeilennummer eingeben.');
    };

    // ---------- Suchen & Ersetzen ----------
    const find = { open: false, matches: [], idx: -1, cs: false, re: false, bad: false, more: false };
    const fIn = h('input.kit-field', { type: 'text', placeholder: 'Suchen', spellcheck: false, autocomplete: 'off', 'aria-label': 'Suchen' });
    const rIn = h('input.kit-field', { type: 'text', placeholder: 'Ersetzen durch', spellcheck: false, autocomplete: 'off', 'aria-label': 'Ersetzen durch' });
    const fN = h('span.code-find-n', { 'aria-live': 'polite' });
    const bCase = h('button.tool.txt', { type: 'button', 'aria-label': 'Groß- und Kleinschreibung beachten', title: 'Groß- und Kleinschreibung beachten' }, 'Aa');
    const bRe = h('button.tool.txt', { type: 'button', 'aria-label': 'Regulärer Ausdruck', title: 'Regulärer Ausdruck' }, '.*');
    const findRegex = () => {
      if (!fIn.value) return null;
      try { return new RegExp(find.re ? fIn.value : escRe(fIn.value), `g${find.cs ? '' : 'i'}${find.re ? 'm' : ''}`); } catch { return false; }
    };
    const paintFind = (reveal = false) => {
      const on = find.open && cur;
      if (cur) cur.ed.setMarks(on ? find.matches : [], find.idx);
      fIn.classList.toggle('is-bad', find.bad);
      const n = find.matches.length;
      fN.textContent = find.bad ? 'Ungültig' : !fIn.value ? '' : n ? `${find.idx + 1} von ${n.toLocaleString('de-DE')}${find.more ? '+' : ''}` : 'Keine Treffer';
      if (on && reveal && find.idx >= 0) cur.ed.reveal(find.matches[find.idx][0]);
    };
    const runFind = (reveal = false) => {
      const re = find.open && cur ? findRegex() : null;
      const out = [];
      find.more = false;
      find.bad = re === false;
      if (re) {
        const text = cur.ed.value;
        let m;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          out.push([m.index, m.index + m[0].length]);
          if (out.length >= 5000) { find.more = true; break; }
        }
      }
      find.matches = out;
      const pos = cur ? cur.ed.ta.selectionStart : 0;
      find.idx = out.length ? Math.max(0, out.findIndex(([a]) => a >= pos)) : -1;
      paintFind(reveal);
    };
    const findSoon = debounce(() => { if (!closed && find.open) runFind(); }, 160);
    const findGo = (dir) => {
      if (!find.open) { openFind(); return; }
      const n = find.matches.length;
      if (!n || !cur) return;
      find.idx = (find.idx + dir + n) % n;
      const [a, b] = find.matches[find.idx];
      cur.ed.ta.setSelectionRange(a, b);
      paintFind(true);
    };
    function openFind() {
      if (!cur) return;
      const { selectionStart: s, selectionEnd: e, value } = cur.ed.ta;
      const sel = value.slice(s, e);
      if (sel && sel.length <= 200 && !sel.includes('\n')) fIn.value = sel;
      find.open = true;
      findBar.hidden = false;
      fIn.focus();
      fIn.select();
      runFind(true);
    }
    const closeFind = () => {
      if (!find.open) return;
      const m = find.matches[find.idx];
      find.open = false;
      findBar.hidden = true;
      find.matches = [];
      find.idx = -1;
      paintFind();
      if (cur) { if (m) cur.ed.select(m[0], m[1]); else cur.ed.focus(); }
    };
    const replaceOne = () => {
      const re = findRegex();
      if (!cur || !re || find.idx < 0) return;
      if (cur.readOnly) { toast(win, 'Diese Datei ist schreibgeschützt.'); return; }
      const back = document.activeElement;
      const [a, b] = find.matches[find.idx];
      const text = cur.ed.value;
      let rep = rIn.value;
      if (find.re) {      // Gruppen ($1 …) auflösen – am Originaltext, damit auch Lookarounds stimmen
        const one = new RegExp(re.source, `${re.flags.replace('g', '')}y`);
        one.lastIndex = a;
        const out = text.replace(one, rIn.value);
        rep = out.slice(a, a + out.length - text.length + (b - a));
      }
      cur.ed.replace(rep, a, b, a + rep.length);
      runFind(true);
      if (back && findBar.contains(back)) back.focus();
    };
    const replaceAll = () => {
      const re = findRegex();
      if (!cur || !re || !find.matches.length) return;
      if (cur.readOnly) { toast(win, 'Diese Datei ist schreibgeschützt.'); return; }
      const back = document.activeElement;
      const text = cur.ed.value;
      let n = 0;
      const out = find.re ? text.replace(re, (...a) => { n++; return a[0]; }) && text.replace(re, rIn.value) : text.replace(re, () => { n++; return rIn.value; });
      if (out !== text) cur.ed.replace(out, 0, text.length, Math.min(cur.ed.ta.selectionStart, out.length));
      runFind();
      toast(win, n === 1 ? '1 Stelle ersetzt' : `${n.toLocaleString('de-DE')} Stellen ersetzt`);
      if (back && findBar.contains(back)) back.focus();
    };
    bCase.addEventListener('click', () => { find.cs = !find.cs; bCase.classList.toggle('is-on', find.cs); runFind(true); });
    bRe.addEventListener('click', () => { find.re = !find.re; bRe.classList.toggle('is-on', find.re); runFind(true); });
    fIn.addEventListener('input', () => runFind(true));
    for (const inp of [fIn, rIn]) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (inp === rIn && !e.shiftKey) replaceOne(); else findGo(e.shiftKey ? -1 : 1); }
      });
    }
    findBar.append(
      h('div.code-find-row', fIn, fN, toolBtn('chevronLeft', 'Vorheriger Treffer (⇧↩)', () => findGo(-1)), toolBtn('chevronRight', 'Nächster Treffer (↩)', () => findGo(1)), bCase, bRe),
      h('div.code-find-row', rIn,
        h('button.kit-btn', { type: 'button', onclick: replaceOne }, 'Ersetzen'),
        h('button.kit-btn', { type: 'button', onclick: replaceAll }, 'Alle'),
        toolBtn('close', 'Suche schließen (esc)', closeFind)));

    // ---------- Konsole ----------
    const msgs = [];             // {sig, n, el, badge, src}
    let queue = [];
    let qRaf = 0;
    let unseen = 0, unseenErr = false;
    const hint = h('div.code-cnone', 'Noch keine Ausgabe. ⌘/Strg + Enter führt die aktuelle JavaScript-Datei aus.');
    cOut.append(hint);
    const paintBadge = () => {
      sBadge.hidden = !unseen;
      sBadge.textContent = unseen > 99 ? '99+' : String(unseen);
      sBadge.classList.toggle('is-err', unseenErr);
    };
    const flush = () => {
      qRaf = 0;
      if (closed || !queue.length) return;
      const stick = con.hidden || cOut.scrollTop + cOut.clientHeight >= cOut.scrollHeight - 24;
      hint.remove();
      for (const { type, parts, src, line, doc } of queue) {
        const sig = `${type}|${src}|${line}|${parts.map((p) => p.s).join('\u0001')}`;
        const last = msgs[msgs.length - 1];
        if (last && last.sig === sig) {
          last.badge.hidden = false;
          last.badge.textContent = String(++last.n);
        } else {
          const badge = h('span.code-msg-n', { hidden: true });
          const at = line > 0 && doc ? h('button.code-msg-at', { type: 'button', onclick: () => { if (docs.includes(doc)) { activate(doc); doc.ed.gotoLine(line); } } }, `Zeile ${line}`) : null;
          const el = h(`div.code-msg.${type}`, h('span', parts.flatMap((p, i) => [i ? ' ' : null, p.k ? h(`span.v-${p.k}`, p.s) : p.s])), badge, at);
          msgs.push({ sig, n: 1, el, badge, src });
          cOut.append(el);
          if (msgs.length > 600) msgs.shift().el.remove();
        }
        if (con.hidden && type !== 'sys') { unseen++; if (type === 'error') unseenErr = true; }
      }
      queue = [];
      if (stick) cOut.scrollTop = cOut.scrollHeight;
      paintBadge();
    };
    const addMsg = (type, parts, { src = 'run', line = 0, doc = null } = {}) => {
      queue.push({ type, parts: typeof parts === 'string' ? [{ k: '', s: parts }] : parts, src, line, doc });
      if (!qRaf) qRaf = requestAnimationFrame(flush);
    };
    const clearCon = (src = null) => {
      queue = queue.filter((q) => src && q.src !== src);
      for (let i = msgs.length - 1; i >= 0; i--) if (!src || msgs[i].src === src) msgs.splice(i, 1)[0].el.remove();
      if (!msgs.length && !queue.length) cOut.append(hint);
      if (!src) { unseen = 0; unseenErr = false; paintBadge(); }
    };
    const setCon = (on) => {
      con.hidden = !on;
      sCon.classList.toggle('is-on', on);
      if (on) { unseen = 0; unseenErr = false; paintBadge(); cOut.scrollTop = cOut.scrollHeight; }
    };
    root.style.setProperty('--code-con', `${prefs.conH}px`);
    let h0 = 0;
    drag(grip, {
      start: () => { h0 = con.offsetHeight; root.classList.add('is-drag'); },
      move: (e, c) => { prefs.conH = Math.round(clamp(h0 - c.dy, 70, root.clientHeight * 0.72)); root.style.setProperty('--code-con', `${prefs.conH}px`); },
      end: () => { root.classList.remove('is-drag'); savePrefs(); },
    });
    drag(splitEl, {
      start: () => { root.classList.add('is-drag'); splitEl.classList.add('is-drag'); },
      move: (e) => {
        const r = work.getBoundingClientRect();
        const frac = getComputedStyle(work).flexDirection === 'column' ? (r.bottom - e.clientY) / r.height : (r.right - e.clientX) / r.width;
        prefs.split = Math.round(clamp(frac, 0.2, 0.8) * 100);
        work.style.setProperty('--code-split', `${prefs.split}%`);
      },
      end: () => { root.classList.remove('is-drag'); splitEl.classList.remove('is-drag'); savePrefs(); },
    });

    // ---------- Ausführen (Sandbox) und Vorschau ----------
    const frames = new Map();    // Kennung → {kind: 'run' | 'prev', frame, doc, off, shifted}
    let job = null;              // laufendes Skript: {token, frame, doc, done, pend}
    let pToken = null;
    let pTimer = 0;
    const running = () => !!job && (!job.done || job.pend > 0);
    const mkFrame = (srcdoc, label) => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');      // ohne allow-same-origin: kein Zugriff auf fableOS, Speicher oder Dateien
      f.title = label;
      f.srcdoc = srcdoc;
      return f;
    };
    function stopRun(say) {
      if (!job) return;
      const was = job;
      job = null;
      frames.delete(was.token);
      was.frame.remove();        // entfernt den iframe samt allem, was darin noch läuft – auch Endlosschleifen
      if (say && (!was.done || was.pend > 0)) addMsg('sys', 'Abgebrochen.');
      paintRun();
    }
    const runJs = (doc) => {
      stopRun(false);
      clearCon('run');
      const token = newToken();
      const code = doc.ed.value;
      const module = extname(doc.name) === 'mjs' || /^\s*(import\s*[\w{*'"]|export\s)/m.test(code);
      const frame = mkFrame(runDoc(code, token, module), 'Sandbox');
      frame.className = 'code-sandbox';
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      job = { token, frame, doc, done: false, pend: 0 };
      frames.set(token, { kind: 'run', frame, doc, off: 1, shifted: false });
      addMsg('sys', `${doc.name} · ${new Date().toLocaleTimeString('de-DE')}`);
      setCon(true);
      root.append(frame);
      paintRun();
    };
    const formatJson = (doc) => {
      const src = doc.ed.value;
      const bad = jsonCheck(src);
      clearCon('run');
      if (bad) {
        const line = doc.ed.posToLine(bad.pos);
        doc.ed.select(bad.pos, Math.min(src.length, bad.pos + 1));
        addMsg('error', `JSON-Fehler in Zeile ${line}: ${bad.msg}`, { line, doc });
        setCon(true);
        toast(win, `JSON-Fehler in Zeile ${line}`);
        return;
      }
      let out = src;
      try { out = `${JSON.stringify(JSON.parse(src), null, 2)}\n`; } catch (err) { addMsg('error', `JSON-Fehler: ${err.message}`); setCon(true); return; }
      if (out === src || doc.readOnly) { toast(win, out === src ? 'Gültiges JSON – bereits formatiert.' : 'Gültiges JSON.'); return; }
      doc.ed.replace(out, 0, src.length, 0);
      toast(win, 'JSON formatiert');
    };
    const readAsset = (path) => {
      if (!path) return null;
      const d = docs.find((x) => x.path === path);
      if (d) return d.ed.value;
      try {
        const st = vfs.stat(path);
        return st && st.type === 'file' && st.size <= MAX_FILE ? vfs.read(path) : null;
      } catch { return null; }
    };
    const dropPreview = () => {
      clearTimeout(pTimer);
      if (pToken) frames.delete(pToken);
      pToken = null;
      pBody.replaceChildren();
    };
    function renderPreview() {
      clearTimeout(pTimer);
      if (closed || !cur || !cur.preview || !hasPreview(cur)) return;
      const doc = cur;
      const src = doc.ed.value;
      if (pToken) frames.delete(pToken);
      pToken = null;
      if (doc.lang === 'md') {
        let view = pBody.firstElementChild;
        if (!view || !view.classList.contains('code-md') || pBody.childElementCount > 1) { view = h('div.code-md.scroll'); pBody.replaceChildren(view); }
        const top = view.scrollTop;
        view.innerHTML = renderMd(src) || '<p class="dim">Noch nichts zu sehen.</p>';
        view.scrollTop = top;
        return;
      }
      const svg = extname(doc.name) === 'svg';
      const html = svg ? src : inlineAssets(src, doc.path ? dirname(doc.path) : DIR, readAsset);
      const token = newToken();
      const frame = mkFrame(previewDoc(html, token, svg), 'Vorschau');
      clearCon('prev');
      frames.set(token, { kind: 'prev', frame, doc, off: 0, shifted: svg || html !== src });
      pToken = token;
      // die neue Seite erst zeigen, wenn sie geladen ist – so flackert die Vorschau beim Tippen nicht
      const first = !pBody.querySelector('iframe');
      if (!first) frame.style.cssText = 'position:absolute;inset:0;height:100%;opacity:0';
      const swap = () => {
        if (pToken !== token) return;
        for (const c of [...pBody.children]) if (c !== frame) c.remove();
        frame.style.cssText = '';
      };
      if (first) pBody.replaceChildren(frame);
      else { pBody.append(frame); frame.addEventListener('load', swap, { once: true }); setTimeout(swap, 700); }
    }
    function layoutPreview() {
      const on = !!cur && cur.preview && hasPreview(cur);
      prev.hidden = splitEl.hidden = !on;
      bPrev.classList.toggle('is-on', on);
      if (on) renderPreview(); else dropPreview();
    }
    function previewSoon(doc) {
      if (!cur || !cur.preview || !hasPreview(cur) || (cur.lang === 'md' && doc !== cur)) return;
      clearTimeout(pTimer);
      pTimer = setTimeout(renderPreview, cur.lang === 'md' ? 140 : 380);
    }
    const setPreview = (on, doc = cur) => {
      if (!doc || !hasPreview(doc)) return;
      doc.preview = on;
      if (doc === cur) layoutPreview();
      persist();
    };
    const run = () => {
      if (!cur) return;
      if (cur.lang === 'js') runJs(cur);
      else if (cur.lang === 'json') formatJson(cur);
      else if (hasPreview(cur)) { if (cur.preview) renderPreview(); else setPreview(true); }
      else toast(win, `${LANGS[cur.lang].name} lässt sich nicht ausführen.`);
    };
    const onMessage = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.__code !== 'string') return;
      const f = frames.get(d.__code);
      if (!f || e.source !== f.frame.contentWindow) return;
      const mine = job && job.token === d.__code;
      if (d.type === 'done') { if (mine) { job.done = true; paintRun(); } }
      else if (d.type === 'busy') { if (mine) { job.pend = +d.n || 0; paintRun(); } }
      else if (d.type === 'clear') clearCon(f.kind);
      else if (['log', 'info', 'warn', 'error'].includes(d.type) && Array.isArray(d.parts)) {
        const parts = d.parts.slice(0, 40).map((p) => ({ k: ['n', 'k', 'f', 'o'].includes(p?.k) ? p.k : '', s: String(p?.s ?? '').slice(0, 20000) }));
        addMsg(d.type, parts, { src: f.kind, doc: f.doc, line: f.shifted ? 0 : Math.max(0, (+d.line || 0) - f.off) });
      }
    };
    window.addEventListener('message', onMessage);
    offs.push(() => window.removeEventListener('message', onMessage));

    // ---------- Sitzung: offene Reiter samt ungesicherter Änderungen überleben Schließen und Neuladen ----------
    const saveSession = () => {
      const tabs = docs.map((d) => ({
        path: d.path, name: d.name, preview: d.preview,
        lang: d.lang !== langOf(d.name) ? d.lang : undefined,
        text: (d.dirty || !d.path) && d.ed.value.length <= 300000 ? d.ed.value : undefined,
      }));
      const active = docs.indexOf(cur);
      if (!store.set('session', { tabs, active })) store.set('session', { tabs: tabs.map((t) => ({ ...t, text: undefined })), active });
    };
    const persist = debounce(() => { if (!closed) saveSession(); }, 500);
    const restore = () => {
      const s = store.get('session', null);
      if (!s || !Array.isArray(s.tabs)) return;
      for (const t of s.tabs) {
        if (!t || typeof t !== 'object') continue;
        try {
          const own = typeof t.text === 'string' ? t.text : null;
          if (typeof t.path === 'string' && vfs.exists(t.path) && !vfs.isDir(t.path)) {
            const saved = readText(t.path);
            addDoc({ path: t.path, text: own ?? saved, saved, lang: t.lang, preview: t.preview });
          } else if (own != null && (own || !t.path)) addDoc({ name: String(t.name || ''), text: own, lang: t.lang, preview: t.preview });
        } catch { /* Datei nicht mehr lesbar – diesen Reiter auslassen */ }
      }
      activate(docs[s.active] || docs[0], false);
    };
    const seed = () => {
      if (store.get('seeded', false)) return null;
      store.set('seeded', true);
      try {
        if (!vfs.isDir(`${HOME}/Dokumente`)) vfs.mkdir(`${HOME}/Dokumente`);
        if (!vfs.isDir(DIR)) vfs.mkdir(DIR);
        for (const [name, text] of Object.entries(SAMPLES)) if (!vfs.exists(`${DIR}/${name}`)) vfs.write(`${DIR}/${name}`, text);
        return `${DIR}/hallo.js`;
      } catch { return null; }
    };

    // ---------- Tastatur ----------
    const onKey = (e) => {
      if (e.key === 'Escape' && find.open) { e.preventDefault(); closeFind(); return; }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const act = e.key === 'Enter' ? run
        : k === 's' ? () => (e.shiftKey ? saveAs() : save())
        : k === 'f' ? openFind
        : k === 'g' ? () => findGo(e.shiftKey ? -1 : 1)
        : k === 'l' ? gotoLine
        : k === 'o' ? open
        : k === '+' || k === '=' ? () => setFs(1)
        : k === '-' ? () => setFs(-1)
        : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    win.el.addEventListener('keydown', onKey);
    offs.push(() => win.el.removeEventListener('keydown', onKey));

    // Änderungen im Dateisystem: unberührte Reiter folgen der Datei, bearbeitete behalten ihren Text
    offs.push(bus.on('fs', (p) => {
      for (const d of docs) {
        if (!d.path || (p !== '/' && p !== d.path && !d.path.startsWith(`${p}/`))) continue;
        if (!vfs.exists(d.path) || vfs.isDir(d.path)) {
          if (!d.gone) { d.gone = d.dirty = true; paintTab(d); if (d === cur) paintTitle(); }
          continue;
        }
        let disk;
        try { disk = vfs.read(d.path); } catch { continue; }
        if (disk === d.saved && !d.gone) continue;
        const clean = !d.dirty;
        d.saved = disk;
        d.gone = false;
        if (clean) { d.ed.setValue(disk); if (d === cur) { paintLen(); if (find.open) runFind(); } }
        else { d.dirty = isDirty(d); paintTab(d); if (d === cur) paintTitle(); }
      }
      previewSoon(null);
    }));

    // ---------- Start ----------
    applyFont();
    const first = seed();
    restore();
    if (first) openPath(first);
    if (args?.path) openPath(args.path);
    if (!docs.length && !store.get('session', null)) newDoc();
    none.hidden = docs.length > 0;
    paintChrome();
    layoutPreview();

    return {
      onClose() {
        saveSession();
        closed = true;
        clearTimeout(pTimer);
        cancelAnimationFrame(qRaf);
        stopRun(false);
        dropPreview();
        for (const off of offs) off();
        for (const d of docs) d.ed.destroy();
      },
      onArgs: (a) => { if (a?.path) openPath(a.path); },
      onFocus: () => {
        const act = document.activeElement;
        if (cur && !win.el.querySelector('.kit-sheet-wrap') && (!act || act === document.body || act === win.el || !win.el.contains(act))) cur.ed.focus();
      },
      menus: [
        { label: 'Dokument', items: () => [
          { label: 'Neue Datei', icon: 'plus', run: newDoc },
          { label: 'Öffnen …', icon: 'folder', hint: '⌘O', run: open },
          '-',
          { label: 'Sichern', hint: '⌘S', disabled: !cur, run: () => save() },
          { label: 'Sichern unter …', hint: '⇧⌘S', disabled: !cur, run: () => saveAs() },
          '-',
          { label: 'Reiter schließen', icon: 'close', disabled: !cur, run: () => closeDoc(cur) },
        ] },
        { label: 'Bearbeiten', items: () => [
          { label: 'Suchen & Ersetzen', icon: 'search', hint: '⌘F', disabled: !cur, run: openFind },
          { label: 'Weitersuchen', hint: '⌘G', disabled: !cur, run: () => findGo(1) },
          { label: 'Gehe zu Zeile …', hint: '⌘L', disabled: !cur, run: gotoLine },
          '-',
          { label: 'Kommentar umschalten', hint: '⌘/', disabled: !cur || !COMMENT[cur.lang] || cur.readOnly, run: () => cur.ed.toggleComment() },
          { label: 'JSON formatieren', icon: 'sparkles', disabled: cur?.lang !== 'json', run },
        ] },
        { label: 'Ansicht', items: () => [
          { label: 'Schrift größer', icon: 'plus', hint: '⌘+', run: () => setFs(1) },
          { label: 'Schrift kleiner', icon: 'minus', hint: '⌘−', run: () => setFs(-1) },
          '-',
          { label: 'Zeilenumbruch', checked: prefs.wrap, run: () => setWrap(!prefs.wrap) },
          { label: 'Vorschau', checked: !!cur?.preview, disabled: !cur || !hasPreview(cur), run: () => setPreview(!cur.preview) },
          { label: 'Konsole', checked: !con.hidden, run: () => setCon(con.hidden) },
        ] },
        { label: 'Ausführen', items: () => [
          { label: cur?.lang === 'json' ? 'JSON prüfen und formatieren' : cur && hasPreview(cur) ? 'Vorschau aktualisieren' : 'Ausführen', icon: 'play', hint: '⌘↩', disabled: !cur || cur.lang === 'css' || cur.lang === 'text', run },
          { label: 'Abbrechen', icon: 'stop', disabled: !running(), run: () => stopRun(true) },
          '-',
          { label: 'Konsole leeren', icon: 'trash', run: () => clearCon() },
        ] },
      ],
    };
  },
};

