// calc.js — sicherer Ausdrucks-Parser (rekursiver Abstieg, kein eval)
// Unterstützt + − × ÷ ^ %, Klammern, Fakultät, Konstanten und gängige Funktionen.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, wurzel: Math.sqrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, exp: Math.exp,
  round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function factorial(n) {
  if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error('Fakultät nur für ganze Zahlen 0…170');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function evaluate(input) {
  const s = String(input)
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[×·]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .toLowerCase();
  if (!s) throw new Error('Leerer Ausdruck');
  let i = 0;

  const expr = () => {
    let v = term();
    for (;;) {
      if (s[i] === '+') { i++; v += term(); }
      else if (s[i] === '-') { i++; v -= term(); }
      else return v;
    }
  };
  const term = () => {
    let v = factor();
    for (;;) {
      if (s[i] === '*') { i++; v *= factor(); }
      else if (s[i] === '/') { i++; v /= factor(); }
      else if (s[i] === '%') { i++; v %= factor(); }
      else if (s[i] === '(' || /[a-z]/.test(s[i] || '')) v *= factor(); // implizite Multiplikation: 2pi, 3(4+1)
      else return v;
    }
  };
  const factor = () => {
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    const base = postfix();
    if (s[i] === '^') { i++; return Math.pow(base, factor()); }
    return base;
  };
  const postfix = () => {
    let v = primary();
    for (;;) {
      if (s[i] === '!') { i++; v = factorial(v); }
      else if (s[i] === '%' && (i + 1 >= s.length || '+-*/^)'.includes(s[i + 1]))) { i++; v /= 100; }
      else return v;
    }
  };
  const primary = () => {
    if (s[i] === '(') {
      i++;
      const v = expr();
      if (s[i] !== ')') throw new Error('Klammer fehlt');
      i++;
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[a-z]+/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0];
      if (s[i] === '(' && FUNCS[name]) {
        i++;
        const arg = expr();
        if (s[i] !== ')') throw new Error('Klammer fehlt');
        i++;
        return FUNCS[name](arg);
      }
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`Unbekannt: ${name}`);
    }
    throw new Error(i >= s.length ? 'Unvollständig' : `Unerwartet: ${s[i]}`);
  };

  const v = expr();
  if (i < s.length) throw new Error(`Unerwartet: ${s[i]}`);
  if (Number.isNaN(v)) throw new Error('Nicht definiert');
  return v;
}

export function formatNumber(v) {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const r = parseFloat(v.toPrecision(12));
  if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-9 && r !== 0)) return r.toExponential(6).replace('.', ',');
  return r.toLocaleString('de-DE', { maximumFractionDigits: 10 });
}

/** Wirkt die Eingabe wie eine Rechnung (und nicht bloß wie eine Zahl oder ein Wort)? */
export const looksLikeMath = (s) => /[\d)π]/.test(s) && /[-+*/^%×÷!(]|sqrt|sin|cos|tan|log|ln|pi/i.test(s);
