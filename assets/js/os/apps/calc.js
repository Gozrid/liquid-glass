// calc.js — Rechner mit Live-Ergebnis (nutzt den sicheren Parser aus core/calc.js)

import { h } from '../../core/util.js';
import { evaluate, formatNumber } from '../../core/calc.js';
import { sfx } from '../../core/audio.js';

const KEYS = [
  ['AC', 'fn'], ['( )', 'fn'], ['%', 'fn'], ['÷', 'op'],
  ['7'], ['8'], ['9'], ['×', 'op'],
  ['4'], ['5'], ['6'], ['−', 'op'],
  ['1'], ['2'], ['3'], ['+', 'op'],
  ['0'], [','], ['⌫', 'fn'], ['=', 'eq'],
];

export default {
  id: 'calc', name: 'Rechner', icon: 'calc', colors: ['#9aa3c2', '#4a516e'], keywords: 'taschenrechner mathe',
  width: 300, height: 470, minW: 260, minH: 400,

  mount(win) {
    let expr = '';
    let fresh = false;      // nach „=“ beginnt eine Ziffer eine neue Rechnung

    const hist = h('div.calc-hist');
    const line = h('div.calc-expr', '0');
    const live = h('div.calc-live');
    const pad = h('div.calc-keys');
    win.body.append(h('div.calc', h('div.calc-screen', hist, line, live), pad));

    const paint = () => {
      line.textContent = expr || '0';
      line.style.setProperty('--len', Math.max(8, (expr || '0').length));
      let preview = '';
      if (expr && /[^\d,]/.test(expr)) {
        try { preview = `= ${formatNumber(evaluate(expr))}`; } catch { preview = ''; }
      }
      live.textContent = preview;
    };
    const press = (k) => {
      sfx.tick();
      if (k === 'AC') { expr = ''; hist.textContent = ''; fresh = false; }
      else if (k === '⌫') { expr = fresh ? '' : expr.slice(0, -1); fresh = false; }
      else if (k === '=') {
        if (!expr) return;
        try {
          const v = formatNumber(evaluate(expr));
          hist.textContent = `${expr} =`;
          expr = v.replace(/\./g, '');      // Tausenderpunkte raus, Komma bleibt Dezimalzeichen
          fresh = true;
        } catch (err) {
          live.textContent = err.message;
          sfx.error();
          return;
        }
      } else if (k === '( )') {
        const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
        expr = (fresh ? '' : expr) + (open > 0 && /[\d,)%]$/.test(expr) ? ')' : '(');
        fresh = false;
      } else {
        const isOp = '÷×−+%^'.includes(k);
        if (fresh && !isOp) expr = '';
        fresh = false;
        if (isOp && k !== '%' && /[÷×−+^]$/.test(expr)) expr = expr.slice(0, -1);
        expr += k;
      }
      paint();
    };

    for (const [k, kind] of KEYS) {
      pad.append(h('button', { type: 'button', class: kind || '', 'aria-label': { 'AC': 'Alles löschen', '⌫': 'Zeichen löschen', '÷': 'geteilt', '×': 'mal', '−': 'minus', '=': 'gleich' }[k] || k, onclick: () => press(k) }, k));
    }
    win.el.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map = { '/': '÷', '*': '×', '-': '−', '+': '+', '.': ',', ',': ',', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'AC', '%': '%', '^': '^', '(': '(', ')': ')' };
      const k = /^\d$/.test(e.key) ? e.key : map[e.key];
      if (!k) return;
      e.preventDefault();
      if (k === '(' || k === ')') { expr = (fresh ? '' : expr) + k; fresh = false; paint(); }
      else press(k);
    });
    paint();
    return { onFocus: () => win.el.focus({ preventScroll: true }) };
  },
};
