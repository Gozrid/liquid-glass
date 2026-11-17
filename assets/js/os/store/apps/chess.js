// chess.js — Schach: vollständiges Regelwerk, Computergegner in drei Stärken oder zwei Spieler an einem Gerät

import { h } from '../../../core/util.js';
import { initControls } from '../../../core/controls.js';
import { tone, sfx, audioReady } from '../../../core/audio.js';
import { style, appStore, toolBtn, sheet } from '../../kit.js';

// ==========================================================================
// Spiellogik — eine in sich geschlossene Funktion ohne DOM und ohne Verweise nach außen.
// So läuft derselbe Code im Fenster und (als Text übergeben) im Web Worker der Suche.
// Brett: 0x88 (Feld = Reihe * 16 + Linie, a1 = 0). Figur = Art | Farbe << 3 (Weiß 0, Schwarz 8).
// Zug = von | nach << 7 | Umwandlung << 14 | Merkmal << 17.
// ==========================================================================
export function chessCore() {
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const F_DP = 1, F_EP = 2, F_CK = 3, F_CQ = 4;       // Doppelschritt, en passant, kurze/lange Rochade
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
  const DIAG = [-17, -15, 15, 17];
  const ORTH = [-16, -1, 1, 16];
  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const PHASE = [0, 0, 1, 1, 2, 4, 0];
  const LETTER = ' pnbrqk';
  const SAN = ['', '', 'S', 'L', 'T', 'D', 'K'];      // deutsche Figurenbuchstaben
  const MATE = 30000, INF = 32000, MAXPLY = 80;

  // Rochaderechte: 1 = Weiß kurz, 2 = Weiß lang, 4 = Schwarz kurz, 8 = Schwarz lang
  const CMASK = new Uint8Array(128).fill(15);
  CMASK[0] = 13; CMASK[4] = 12; CMASK[7] = 14; CMASK[112] = 7; CMASK[116] = 3; CMASK[119] = 11;

  // Zobrist-Schlüssel (zweimal 32 Bit), fester Startwert
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const fill = (n) => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = rnd(); return a; };
  const ZL = fill(16 * 128), ZH = fill(16 * 128), ZCL = fill(16), ZCH = fill(16), ZEL = fill(128), ZEH = fill(128);
  const ZSL = rnd(), ZSH = rnd();

  // Figuren-Feld-Tabellen aus einfachen Formeln (Zentrum, Vorrücken, Königssicherheit) – aus Sicht von Weiß
  const MG = [], EG = [];
  for (let t = 0; t <= 6; t++) { MG.push(new Int16Array(64)); EG.push(new Int16Array(64)); }
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const i = r * 8 + f;
      const cd = Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)) - 0.5;    // 0 = Zentrum … 3 = Rand
      const cf = Math.abs(f - 3.5) - 0.5;                                  // 0 = d/e-Linie … 3 = a/h-Linie
      MG[P][i] = [0, 0, 3, 8, 16, 28, 46, 0][r] + (cf === 0 ? [0, -14, 6, 18, 10, 4, 0, 0][r] : cf === 1 ? [0, 0, 2, 6, 4, 2, 0, 0][r] : 0);
      EG[P][i] = [0, 2, 6, 14, 28, 52, 88, 0][r];
      MG[N][i] = 18 - 13 * cd - (r === 0 ? 10 : 0);
      EG[N][i] = 12 - 9 * cd;
      MG[B][i] = 10 - 6 * cd - (r === 0 ? 10 : 0) + (f === r || f === 7 - r ? 4 : 0);
      EG[B][i] = 7 - 5 * cd;
      MG[R][i] = (cf === 0 ? 6 : cf === 1 ? 3 : 0) + (r === 6 ? 14 : 0);
      EG[R][i] = r === 6 ? 8 : 0;
      MG[Q][i] = 3 - 3 * cd;
      EG[Q][i] = 8 - 6 * cd;
      MG[K][i] = r === 0 ? [16, 26, 10, -10, -6, -4, 28, 18][f] : r === 1 ? [-6, 0, -14, -30, -30, -18, 2, -4][f] : -40 - 8 * r;
      EG[K][i] = 20 - 13 * cd;
    }
  }

  // Suchspeicher – wird erst bei der ersten Suche angelegt und von allen Stellungen geteilt
  const TT_MASK = (1 << 17) - 1;
  let ttLo = null, ttHi, ttMove, ttScore, ttDepth, ttFlag;
  const LISTS = [], SCORES = [];
  for (let i = 0; i <= MAXPLY + 1; i++) { LISTS.push(new Int32Array(256)); SCORES.push(new Int32Array(256)); }
  const killers = new Int32Array((MAXPLY + 2) * 2);
  const history = new Int32Array(2 * 128 * 128);

  const sqName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
  const uci = (m) => sqName(m & 127) + sqName((m >> 7) & 127) + ((m >> 14) & 7 ? LETTER[(m >> 14) & 7] : '');

  function create(fen = START) {
    const board = new Uint8Array(128);
    const king = [0, 0];
    let side = 0, castle = 0, ep = -1, half = 0, full = 1, hl = 0, hh = 0;
    const undo = [];      // flacher Stapel je Zug: Zug, Schlagfigur, Rochade, e.p., Halbzüge, Hash (lo, hi)
    const hist = [];      // Hash jeder früheren Stellung (lo, hi) – für Stellungswiederholung in der Suche
    let nodes = 0, deadline = 0, stop = false;

    function load(str) {
      board.fill(0);
      undo.length = 0;
      hist.length = 0;
      const [place, stm = 'w', cr = '-', eps = '-', hm = '0', fm = '1'] = String(str).trim().split(/\s+/);
      let r = 7, f = 0;
      for (const ch of place) {
        if (ch === '/') { r--; f = 0; continue; }
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const t = LETTER.indexOf(ch.toLowerCase());
        if (t > 0 && r >= 0 && f < 8) {
          const c = ch === ch.toLowerCase() ? 8 : 0;
          board[r * 16 + f] = t | c;
          if (t === K) king[c >> 3] = r * 16 + f;
        }
        f++;
      }
      side = stm === 'b' ? 1 : 0;
      castle = (cr.includes('K') ? 1 : 0) | (cr.includes('Q') ? 2 : 0) | (cr.includes('k') ? 4 : 0) | (cr.includes('q') ? 8 : 0);
      if (board[4] !== K) castle &= ~3;
      if (board[7] !== R) castle &= ~1;
      if (board[0] !== R) castle &= ~2;
      if (board[116] !== (K | 8)) castle &= ~12;
      if (board[119] !== (R | 8)) castle &= ~4;
      if (board[112] !== (R | 8)) castle &= ~8;
      ep = /^[a-h][36]$/.test(eps) ? (eps.charCodeAt(1) - 49) * 16 + (eps.charCodeAt(0) - 97) : -1;
      half = +hm || 0;
      full = +fm || 1;
      hl = ZCL[castle]; hh = ZCH[castle];
      if (side) { hl ^= ZSL; hh ^= ZSH; }
      if (ep >= 0) { hl ^= ZEL[ep]; hh ^= ZEH[ep]; }
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        if (board[sq]) { hl ^= ZL[board[sq] * 128 + sq]; hh ^= ZH[board[sq] * 128 + sq]; }
      }
    }

    function fenOf() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let gap = 0;
        for (let f = 0; f < 8; f++) {
          const pc = board[r * 16 + f];
          if (!pc) { gap++; continue; }
          if (gap) { s += gap; gap = 0; }
          const ch = LETTER[pc & 7];
          s += pc & 8 ? ch : ch.toUpperCase();
        }
        if (gap) s += gap;
        if (r) s += '/';
      }
      const cr = (castle & 1 ? 'K' : '') + (castle & 2 ? 'Q' : '') + (castle & 4 ? 'k' : '') + (castle & 8 ? 'q' : '');
      return `${s} ${side ? 'b' : 'w'} ${cr || '-'} ${ep >= 0 ? sqName(ep) : '-'} ${half} ${full}`;
    }

    /** Wird das Feld von der Farbe `by` angegriffen? */
    function attacked(sq, by) {
      const c = by << 3;
      let t = by ? sq + 15 : sq - 15;
      if (!(t & 0x88) && board[t] === (P | c)) return true;
      t = by ? sq + 17 : sq - 17;
      if (!(t & 0x88) && board[t] === (P | c)) return true;
      for (let i = 0; i < 8; i++) {
        t = sq + KNIGHT[i];
        if (!(t & 0x88) && board[t] === (N | c)) return true;
        t = sq + KING[i];
        if (!(t & 0x88) && board[t] === (K | c)) return true;
      }
      for (let i = 0; i < 4; i++) {
        let d = DIAG[i];
        t = sq + d;
        while (!(t & 0x88)) {
          const p = board[t];
          if (p) { if (p === (B | c) || p === (Q | c)) return true; break; }
          t += d;
        }
        d = ORTH[i];
        t = sq + d;
        while (!(t & 0x88)) {
          const p = board[t];
          if (p) { if (p === (R | c) || p === (Q | c)) return true; break; }
          t += d;
        }
      }
      return false;
    }
    const inCheck = () => attacked(king[side], side ^ 1);

    /** Pseudo-legale Züge (König darf danach noch im Schach stehen). capsOnly: nur Schlagzüge und Damenumwandlungen. */
    function gen(list, capsOnly) {
      let n = 0;
      const us = side << 3, fwd = side ? -16 : 16, startRank = side ? 6 : 1, lastRank = side ? 0 : 7;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const pc = board[sq];
        if (!pc || (pc & 8) !== us) continue;
        const t = pc & 7;
        if (t === P) {
          let to = sq + fwd;
          if (!board[to]) {
            if ((to >> 4) === lastRank) {
              list[n++] = sq | to << 7 | Q << 14;
              if (!capsOnly) { list[n++] = sq | to << 7 | R << 14; list[n++] = sq | to << 7 | B << 14; list[n++] = sq | to << 7 | N << 14; }
            } else if (!capsOnly) {
              list[n++] = sq | to << 7;
              if ((sq >> 4) === startRank && !board[to + fwd]) list[n++] = sq | (to + fwd) << 7 | F_DP << 17;
            }
          }
          for (let d = -1; d <= 1; d += 2) {
            to = sq + fwd + d;
            if (to & 0x88) continue;
            const tp = board[to];
            if (tp) {
              if ((tp & 8) === us) continue;
              if ((to >> 4) === lastRank) {
                list[n++] = sq | to << 7 | Q << 14; list[n++] = sq | to << 7 | R << 14;
                list[n++] = sq | to << 7 | B << 14; list[n++] = sq | to << 7 | N << 14;
              } else list[n++] = sq | to << 7;
            } else if (to === ep) list[n++] = sq | to << 7 | F_EP << 17;
          }
        } else if (t === N || t === K) {
          const dirs = t === N ? KNIGHT : KING;
          for (let i = 0; i < 8; i++) {
            const to = sq + dirs[i];
            if (to & 0x88) continue;
            const tp = board[to];
            if (tp ? (tp & 8) !== us : !capsOnly) list[n++] = sq | to << 7;
          }
        } else {
          const dirs = t === B ? DIAG : t === R ? ORTH : KING;
          for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            let to = sq + d;
            while (!(to & 0x88)) {
              const tp = board[to];
              if (tp) { if ((tp & 8) !== us) list[n++] = sq | to << 7; break; }
              if (!capsOnly) list[n++] = sq | to << 7;
              to += d;
            }
          }
        }
      }
      if (!capsOnly) {
        // Rochade: Recht vorhanden, Felder dazwischen frei, König steht nicht im Schach und überquert kein bedrohtes Feld
        const k = king[side], them = side ^ 1;
        if (castle & (side ? 4 : 1) && !board[k + 1] && !board[k + 2]
          && !attacked(k, them) && !attacked(k + 1, them) && !attacked(k + 2, them)) list[n++] = k | (k + 2) << 7 | F_CK << 17;
        if (castle & (side ? 8 : 2) && !board[k - 1] && !board[k - 2] && !board[k - 3]
          && !attacked(k, them) && !attacked(k - 1, them) && !attacked(k - 2, them)) list[n++] = k | (k - 2) << 7 | F_CQ << 17;
      }
      return n;
    }

    function make(m) {
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
      const pc = board[from], cap = board[to];
      undo.push(m, cap, castle, ep, half, hl, hh);
      hist.push(hl, hh);
      hl ^= ZCL[castle]; hh ^= ZCH[castle];
      if (ep >= 0) { hl ^= ZEL[ep]; hh ^= ZEH[ep]; }
      board[from] = 0;
      hl ^= ZL[pc * 128 + from]; hh ^= ZH[pc * 128 + from];
      if (cap) { hl ^= ZL[cap * 128 + to]; hh ^= ZH[cap * 128 + to]; }
      const put = promo ? promo | (side << 3) : pc;
      board[to] = put;
      hl ^= ZL[put * 128 + to]; hh ^= ZH[put * 128 + to];
      if (flag === F_EP) {
        const cs = to + (side ? 16 : -16);
        hl ^= ZL[board[cs] * 128 + cs]; hh ^= ZH[board[cs] * 128 + cs];
        board[cs] = 0;
      } else if (flag === F_CK || flag === F_CQ) {
        const rf = flag === F_CK ? from + 3 : from - 4, rt = flag === F_CK ? from + 1 : from - 1;
        const rk = board[rf];
        board[rf] = 0; board[rt] = rk;
        hl ^= ZL[rk * 128 + rf] ^ ZL[rk * 128 + rt]; hh ^= ZH[rk * 128 + rf] ^ ZH[rk * 128 + rt];
      }
      if ((pc & 7) === K) king[side] = to;
      ep = flag === F_DP ? (from + to) >> 1 : -1;
      castle &= CMASK[from] & CMASK[to];
      half = (pc & 7) === P || cap ? 0 : half + 1;
      if (side) full++;
      side ^= 1;
      hl ^= ZSL ^ ZCL[castle]; hh ^= ZSH ^ ZCH[castle];
      if (ep >= 0) { hl ^= ZEL[ep]; hh ^= ZEH[ep]; }
    }

    function unmake() {
      hh = undo.pop(); hl = undo.pop(); half = undo.pop(); ep = undo.pop(); castle = undo.pop();
      const cap = undo.pop(), m = undo.pop();
      hist.length -= 2;
      side ^= 1;
      if (side) full--;
      const from = m & 127, to = (m >> 7) & 127, flag = m >> 17;
      const pc = (m >> 14) & 7 ? P | (side << 3) : board[to];
      board[from] = pc;
      board[to] = cap;
      if (flag === F_EP) board[to + (side ? 16 : -16)] = P | ((side ^ 1) << 3);
      else if (flag === F_CK) { board[from + 3] = board[from + 1]; board[from + 1] = 0; }
      else if (flag === F_CQ) { board[from - 4] = board[from - 1]; board[from - 1] = 0; }
      if ((pc & 7) === K) king[side] = from;
    }

    /** Alle regelgerechten Züge der Seite am Zug. */
    function legal() {
      const list = new Int32Array(256), out = [];
      const n = gen(list, false);
      for (let i = 0; i < n; i++) {
        make(list[i]);
        if (!attacked(king[side ^ 1], side)) out.push(list[i]);
        unmake();
      }
      return out;
    }

    function perft(depth) {
      if (depth <= 0) return 1;
      const list = LISTS[depth];
      const n = gen(list, false);
      let total = 0;
      for (let i = 0; i < n; i++) {
        make(list[i]);
        if (!attacked(king[side ^ 1], side)) total += depth === 1 ? 1 : perft(depth - 1);
        unmake();
      }
      return total;
    }

    /** Algebraische Notation mit deutschen Figurenbuchstaben; `moves` = alle legalen Züge der Stellung. */
    function san(m, moves = legal()) {
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
      const t = board[from] & 7;
      let s;
      if (flag === F_CK) s = '0-0';
      else if (flag === F_CQ) s = '0-0-0';
      else {
        const capture = !!board[to] || flag === F_EP;
        s = SAN[t];
        if (t === P) { if (capture) s += 'abcdefgh'[from & 7]; }
        else {
          const twins = moves.filter((o) => o !== m && ((o >> 7) & 127) === to && (board[o & 127] & 7) === t && (o & 127) !== from);
          if (twins.length) {
            if (!twins.some((o) => (o & 7) === (from & 7))) s += 'abcdefgh'[from & 7];
            else if (!twins.some((o) => ((o & 127) >> 4) === (from >> 4))) s += (from >> 4) + 1;
            else s += sqName(from);
          }
        }
        s += (capture ? 'x' : '') + sqName(to) + (promo ? SAN[promo] : '') + (flag === F_EP ? ' e.p.' : '');
      }
      make(m);
      if (inCheck()) s += legal().length ? '+' : '#';
      unmake();
      return s;
    }

    /** Remis, weil kein Matt mehr möglich ist: König gegen König, eine Leichtfigur, nur gleichfarbige Läufer. */
    function insufficient() {
      let minors = 0, knights = 0, light = 0, dark = 0;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = board[sq] & 7;
        if (t === P || t === R || t === Q) return false;
        if (t === N) { knights++; minors++; }
        if (t === B) { minors++; if (((sq >> 4) + (sq & 7)) & 1) light++; else dark++; }
      }
      if (minors <= 1) return true;
      return knights === 0 && (light === 0 || dark === 0);
    }

    /** Schlüssel für die dreifache Stellungswiederholung: Figuren, Zugrecht, Rochaderechte, schlagbares e.p.-Feld. */
    function key() {
      let s = '';
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        s += String.fromCharCode(65 + board[sq]);
      }
      const epLive = ep >= 0 && legal().some((m) => (m >> 17) === F_EP);
      return `${s}${side}${castle}${epLive ? ep : ''}`;
    }

    // ---------- Bewertung ----------
    function evaluate() {
      let mg = 0, eg = 0, phase = 0, wb = 0, bb = 0;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const pc = board[sq];
        if (!pc) continue;
        const t = pc & 7;
        phase += PHASE[t];
        if (pc < 8) {
          const i = (sq >> 4) * 8 + (sq & 7);
          mg += VAL[t] + MG[t][i]; eg += VAL[t] + EG[t][i];
          if (t === B) wb++;
        } else {
          const i = (7 - (sq >> 4)) * 8 + (sq & 7);
          mg -= VAL[t] + MG[t][i]; eg -= VAL[t] + EG[t][i];
          if (t === B) bb++;
        }
      }
      if (wb >= 2) { mg += 30; eg += 40; }
      if (bb >= 2) { mg -= 30; eg -= 40; }
      if (phase > 24) phase = 24;
      let s = ((mg * phase + eg * (24 - phase)) / 24) | 0;
      if (phase <= 8 && (eg >= 400 || eg <= -400)) {
        // Mattführung: den schwächeren König an den Rand drängen, den eigenen heranführen
        const w = eg > 0 ? 0 : 1, lk = king[w ^ 1], wk = king[w];
        const edge = Math.max(Math.abs((lk & 7) - 3.5), Math.abs((lk >> 4) - 3.5));
        const dist = Math.abs((lk & 7) - (wk & 7)) + Math.abs((lk >> 4) - (wk >> 4));
        const bonus = (edge * 16 + (14 - dist) * 5) | 0;
        s += w ? -bonus : bonus;
      }
      return side ? -s : s;
    }

    // ---------- Suche: Alpha-Beta mit Zugsortierung, Ruhesuche, Nullzug und Hash-Tabelle ----------
    function repeated() {
      const n = hist.length;
      for (let i = n - 4, back = 2; i >= 0 && back <= half; i -= 4, back += 2) {
        if (hist[i] === hl && hist[i + 1] === hh) return true;
      }
      return false;
    }
    function hasPieces() {
      const us = side << 3;
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const pc = board[sq];
        if (pc && (pc & 8) === us && (pc & 7) > P && (pc & 7) < K) return true;
      }
      return false;
    }
    function scoreMoves(list, sc, n, ttm, ply) {
      const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1], hb = side * 16384;
      for (let i = 0; i < n; i++) {
        const m = list[i], cap = board[(m >> 7) & 127];
        if (m === ttm) sc[i] = 10000000;
        else if (cap) sc[i] = 1000000 + (cap & 7) * 16 - (board[m & 127] & 7);
        else if ((m >> 17) === F_EP) sc[i] = 1000010;
        else if ((m >> 14) & 7) sc[i] = 900000 + ((m >> 14) & 7);
        else if (m === k1) sc[i] = 800000;
        else if (m === k2) sc[i] = 790000;
        else sc[i] = history[hb + (m & 16383)];
      }
    }
    function pickNext(list, sc, i, n) {
      let bi = i;
      for (let j = i + 1; j < n; j++) if (sc[j] > sc[bi]) bi = j;
      const m = list[bi], s = sc[bi];
      list[bi] = list[i]; sc[bi] = sc[i];
      list[i] = m; sc[i] = s;
      return m;
    }

    function quiesce(alpha, beta, ply) {
      if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
      const stand = evaluate();
      if (stop || ply >= MAXPLY) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const list = LISTS[ply], sc = SCORES[ply];
      const n = gen(list, true);
      scoreMoves(list, sc, n, 0, ply);
      for (let i = 0; i < n; i++) {
        const m = pickNext(list, sc, i, n);
        const cap = board[(m >> 7) & 127] & 7;
        if (!((m >> 14) & 7) && stand + VAL[cap || P] + 200 < alpha) continue;     // lohnt nicht mehr
        make(m);
        if (attacked(king[side ^ 1], side)) { unmake(); continue; }
        const s = -quiesce(-beta, -alpha, ply + 1);
        unmake();
        if (s > alpha) {
          alpha = s;
          if (s >= beta) return s;
        }
      }
      return alpha;
    }

    function negamax(depth, alpha, beta, ply, nullOk) {
      if (half >= 100 || repeated()) return 0;
      const check = inCheck();
      if (check) depth++;
      if (depth <= 0) return quiesce(alpha, beta, ply);
      if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
      if (stop) return 0;
      if (ply >= MAXPLY) return evaluate();

      const idx = hl & TT_MASK;
      let ttm = 0;
      if (ttLo[idx] === hl && ttHi[idx] === hh) {
        ttm = ttMove[idx];
        if (ttDepth[idx] >= depth) {
          let s = ttScore[idx];
          if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
          const f = ttFlag[idx];
          if (f === 0 || (f === 1 && s >= beta) || (f === 2 && s <= alpha)) return s;
        }
      }

      if (nullOk && !check && depth >= 3 && beta < MATE - 200 && beta > -MATE + 200 && hasPieces()) {
        // Nullzug: wer selbst nach einem geschenkten Zug noch über beta liegt, steht gut genug
        undo.push(ep, half, hl, hh);
        hist.push(hl, hh);
        if (ep >= 0) { hl ^= ZEL[ep]; hh ^= ZEH[ep]; }
        ep = -1; half = 0; side ^= 1; hl ^= ZSL; hh ^= ZSH;
        const s = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
        side ^= 1; hist.length -= 2;
        hh = undo.pop(); hl = undo.pop(); half = undo.pop(); ep = undo.pop();
        if (stop) return 0;
        if (s >= beta) return beta;
      }

      const list = LISTS[ply], sc = SCORES[ply];
      const n = gen(list, false);
      scoreMoves(list, sc, n, ttm, ply);
      let best = -INF, bestMove = 0, flag = 2, count = 0;
      for (let i = 0; i < n; i++) {
        const m = pickNext(list, sc, i, n);
        const quiet = sc[i] < 900000;
        make(m);
        if (attacked(king[side ^ 1], side)) { unmake(); continue; }
        count++;
        let s;
        if (count === 1) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        else {
          const red = depth >= 3 && count > 4 && quiet && !check ? (count > 12 ? 2 : 1) : 0;
          s = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && red) s = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && s < beta) s = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
        unmake();
        if (stop) return 0;
        if (s > best) {
          best = s;
          bestMove = m;
          if (s > alpha) {
            alpha = s;
            flag = 0;
            if (s >= beta) {
              flag = 1;
              if (quiet) {
                if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
                const hi = side * 16384 + (m & 16383);
                if (history[hi] < 500000) history[hi] += depth * depth;
              }
              break;
            }
          }
        }
      }
      if (!count) return check ? -MATE + ply : 0;
      ttLo[idx] = hl; ttHi[idx] = hh; ttMove[idx] = bestMove; ttDepth[idx] = depth; ttFlag[idx] = flag;
      ttScore[idx] = best > MATE - 200 ? best + ply : best < -MATE + 200 ? best - ply : best;
      return best;
    }

    /**
     * Sucht den besten Zug. depth = größte Tiefe, time = Rechenzeit in ms,
     * margin = Züge bis zu so vielen Hundertstel-Bauern unter dem besten gelten als gleich gut (Zufallsauswahl),
     * wild = Wahrscheinlichkeit, stattdessen bis wildMargin danebenzugreifen (schwache Stufe).
     */
    function search({ depth = 4, time = 800, margin = 0, wild = 0, wildMargin = 0 } = {}) {
      if (!ttLo) {
        const size = TT_MASK + 1;
        ttLo = new Int32Array(size); ttHi = new Int32Array(size); ttMove = new Int32Array(size);
        ttScore = new Int16Array(size); ttDepth = new Int8Array(size); ttFlag = new Uint8Array(size);
      }
      killers.fill(0);
      history.fill(0);
      nodes = 0;
      stop = false;
      deadline = Date.now() + time;
      const t0 = Date.now();
      let order = legal();
      if (!order.length) return null;
      const span = Math.max(margin, wild > 0 ? wildMargin : 0);
      let best = order[0], bestScore = 0, reached = 0, table = [[order[0], 0]];
      for (let d = 1; d <= depth && order.length > 1; d++) {
        let top = -INF;
        const scored = [];
        for (const m of order) {
          make(m);
          const lo = span ? Math.max(-INF, top - span - 1) : top;
          const s = -negamax(d - 1, -INF, -lo, 1, true);
          unmake();
          if (stop) break;
          scored.push([m, s]);
          if (s > top) top = s;
        }
        if (stop) break;                         // angefangene Tiefe verwerfen
        scored.sort((a, b) => b[1] - a[1]);
        order = scored.map((x) => x[0]);
        table = scored;
        best = order[0];
        bestScore = top;
        reached = d;
        if (top > MATE - 200 || top < -MATE + 200 || Date.now() - t0 > time * 0.55) break;
      }
      let move = best;
      if (span) {
        const lim = Math.random() < wild ? wildMargin : margin;
        const pool = table.filter(([, s]) => s >= bestScore - lim);
        if (pool.length) move = pool[(Math.random() * pool.length) | 0][0];
      }
      return { move, score: bestScore, depth: reached, nodes };
    }

    load(fen);
    return {
      board, load, make, unmake, legal, perft, san, insufficient, key, inCheck, attacked, search, evaluate,
      fen: fenOf,
      find: (str) => legal().find((m) => uci(m) === str) || 0,
      get side() { return side; },
      get half() { return half; },
      get full() { return full; },
      get ply() { return undo.length / 7; },
      kingOf: (c) => king[c],
    };
  }

  return { create, uci, sqName, START, VAL };
}

/** Läuft im Worker: baut die Stellung aus FEN + Zügen nach und sucht. */
function chessWorker(coreFactory) {
  const core = coreFactory();
  self.onmessage = (e) => {
    const { id, fen, moves, opts } = e.data;
    let move = 0;
    try {
      const pos = core.create(fen);
      for (const m of moves) pos.make(m);
      const res = pos.search(opts);
      move = res ? res.move : 0;
    } catch { /* Zug 0 = kein Ergebnis, das Fenster rechnet dann selbst */ }
    self.postMessage({ id, move });
  };
}
let workerUrl = null;
const makeWorker = () => {
  workerUrl ||= URL.createObjectURL(new Blob([`(${chessWorker})(${chessCore})`], { type: 'text/javascript' }));
  return new Worker(workerUrl);
};

// ==========================================================================
// Oberfläche
// ==========================================================================
const LEVELS = [
  { name: 'Leicht', depth: 2, time: 300, margin: 50, wild: 0.3, wildMargin: 240 },
  { name: 'Mittel', depth: 4, time: 800, margin: 16 },
  { name: 'Schwer', depth: 24, time: 1900, margin: 0 },
];
const NAME = ['', 'Bauer', 'Springer', 'Läufer', 'Turm', 'Dame', 'König'];
const WORTH = [0, 1, 3, 3, 5, 9, 0];

// Eigene Figuren: schlichte Silhouetten auf einem 48er-Raster. .b = Körper, .d = Zierlinie, .f = Zierfläche
const BASE = '<rect class="b" x="11.5" y="35.5" width="25" height="6.5" rx="2.8"/>';
const SHAPES = [
  '',
  `<path class="b" d="M21 21.5h6c.5 6 4.300 8 4.800 14.500H16.200c.5-6.500 4.300-8.500 4.800-14.500z"/><circle class="b" cx="24" cy="15.500" r="6.300"/>${BASE}`,
  `<path class="b" d="M33.200 36c1.200-9.500.6-19-5.700-24.300l-.3-4.700-4.200 3.300c-4.800 1-8.300 5-10.600 10.500-1 2.300-.2 4.500 2 5.100 2.600.6 4.600-1.600 7.700-2.500-1.200 4.600-4.900 7-5.900 12.600z"/><circle class="f" cx="20.300" cy="16.800" r="1.300"/><path class="d" d="M29.300 15.500c2.200 4.200 2.700 9.700 2.300 15"/>${BASE}`,
  `<path class="b" d="M24 10.300c6 4.700 8.500 10.200 6.600 15.700-1 2.900-3.900 4.500-6.600 4.500s-5.600-1.600-6.600-4.500c-1.900-5.500.6-11 6.600-15.700z"/><circle class="b" cx="24" cy="7.800" r="2.600"/><path class="d" d="M26.800 15.800l-4.600 6.200"/><rect class="b" x="17.200" y="29.800" width="13.600" height="3.400" rx="1.700"/><path class="b" d="M20.300 33.200h7.400l2.300 3h-12z"/>${BASE}`,
  `<path class="b" d="M13.500 8.500h5.200v3.300h3V8.500h4.600v3.300h3V8.500h5.200v8.700h-21z"/><path class="b" d="M16.800 17.200h14.400l1.300 18.500h-17z"/><path class="d" d="M17.300 21.500h13.400"/>${BASE}`,
  `<path class="b" d="M11.500 14.500l5 13.500h15l5-13.500-6.300 6.500L24 11l-6.200 10z"/><circle class="b" cx="11.300" cy="13" r="2.400"/><circle class="b" cx="24" cy="9.300" r="2.400"/><circle class="b" cx="36.700" cy="13" r="2.400"/><path class="b" d="M16.800 28h14.400l1.300 8h-17z"/><rect class="b" x="15" y="26.300" width="18" height="3.400" rx="1.700"/>${BASE}`,
  `<path class="b" d="M22.500 3.800h3v3h3v3h-3v4h-3v-4h-3v-3h3z"/><path class="b" d="M24 13.300c7 0 12.300 4.300 12.300 9.500 0 3.300-2 5.800-4 7.200h-16.600c-2-1.400-4-3.900-4-7.200 0-5.200 5.300-9.500 12.300-9.500z"/><path class="d" d="M24 14.500v14.500M17.500 28c-2.300-3-2.200-7.500.5-10.800M30.500 28c2.300-3 2.200-7.500-.5-10.800"/><path class="b" d="M16.800 30h14.400l1.300 6h-17z"/><rect class="b" x="15" y="28.300" width="18" height="3.400" rx="1.700"/>${BASE}`,
];
const pieceSvg = (code) => `<svg viewBox="0 0 48 48" aria-hidden="true">${SHAPES[code & 7]}</svg>`;

style('chess', `
.chess { display: flex; flex: 1; min-height: 0; --sq-l: color-mix(in srgb, var(--accent) 12%, #ece7dc); --sq-d: color-mix(in srgb, var(--accent) 42%, #6f7396); --mark: rgba(12, 14, 40, .3); }
[data-theme="dark"] .chess { --sq-l: color-mix(in srgb, var(--accent) 14%, #d9d5d0); --sq-d: color-mix(in srgb, var(--accent) 38%, #565b82); }
.chess-stage { display: grid; place-items: center; flex: 1; min-width: 0; min-height: 0; padding: 16px; container-type: size; }
.chess-wrap { position: relative; width: min(100cqw, 100cqh); aspect-ratio: 1; border-radius: 12px; touch-action: none; box-shadow: 0 18px 40px -18px rgba(0, 0, 14, .6), 0 0 0 4px var(--raise), 0 0 0 4.5px var(--line); }
.chess-board { position: absolute; inset: 0; display: grid; grid-template: repeat(8, 1fr) / repeat(8, 1fr); border-radius: inherit; overflow: hidden; outline: 0; }
.chess-sq { position: relative; }
.chess-sq.l { background: var(--sq-l); color: var(--sq-d); }
.chess-sq.d { background: var(--sq-d); color: var(--sq-l); }
.chess-sq::before, .chess-sq::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .16s; }
.chess-sq.is-last::before { opacity: 1; background: color-mix(in srgb, var(--c-amber) 52%, transparent); }
.chess-sq.is-sel::before { opacity: 1; background: color-mix(in srgb, var(--accent) 58%, transparent); }
.chess-sq.is-check::before { opacity: 1; background: radial-gradient(circle, rgba(255, 44, 72, 1) 0%, rgba(255, 44, 72, .72) 45%, rgba(255, 44, 72, 0) 76%); }
.chess-sq.is-target::after { opacity: 1; inset: 35%; border-radius: 50%; background: var(--mark); }
.chess-sq.is-capture::after { opacity: 1; inset: 5%; border-radius: 50%; background: radial-gradient(circle, transparent 0 57%, var(--mark) 59% 69%, transparent 71%); }
.chess-sq.is-over { box-shadow: inset 0 0 0 4px rgba(255, 255, 255, .8); }
.chess-sq.is-cursor { box-shadow: inset 0 0 0 3px #fff, inset 0 0 0 5.5px var(--accent); z-index: 1; }
.chess-sq i { position: absolute; font: 700 10px/1 var(--font-round); font-style: normal; opacity: .8; pointer-events: none; }
.chess-sq i.f { right: 4px; bottom: 3px; }
.chess-sq i.r { left: 4px; top: 3px; }
.chess-pieces { position: absolute; inset: 0; pointer-events: none; }
.chess-pc { position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%; transition: transform .28s var(--ease-out), opacity .22s; will-change: transform; }
.chess-pc svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 2px 1.500px rgba(0, 0, 20, .32)); transition: transform .35s var(--spring); }
.chess .cw { --pf: #fffdf6; --ps: #25273f; --pd: #25273f; }
.chess .cb { --pf: #2a2d4a; --ps: #090a16; --pd: rgba(255, 255, 255, .66); }
.chess svg .b { fill: var(--pf); stroke: var(--ps); stroke-width: 1.500; stroke-linejoin: round; }
.chess svg .d { fill: none; stroke: var(--pd); stroke-width: 1.500; stroke-linecap: round; }
.chess svg .f { fill: var(--pd); }
.chess-pc.is-drag { transition: none; z-index: 6; }
.chess-pc.is-drag svg { transform: scale(1.2); filter: drop-shadow(0 8px 6px rgba(0, 0, 20, .4)); }
.chess-pc.is-out { opacity: 0; }
.chess-pc.is-out svg { transform: scale(.4); }
.chess-pc.is-ghost { opacity: 0; }
.chess-pc.is-in { animation: chess-in .32s var(--ease-out) both; }
@keyframes chess-in { from { opacity: 0; } }
.chess-promo { position: absolute; z-index: 8; display: flex; flex-direction: column; width: 12.5%; border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--solid) 88%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 14px 34px -8px rgba(0, 0, 14, .7), inset 0 0 0 .5px var(--glass-edge); animation: chess-pop .3s var(--spring-soft) both; }
@keyframes chess-pop { from { opacity: 0; scale: .8; } }
.chess-promo button { display: grid; aspect-ratio: 1; padding: 6%; border: 0; background: none; }
.chess-promo button:hover, .chess-promo button:focus-visible { background: var(--accent); outline: 0; }
.chess-promo svg { width: 100%; height: 100%; }
.chess-side { display: flex; flex-direction: column; gap: 10px; flex: none; width: 232px; min-height: 0; padding: 16px 16px 16px 2px; }
.chess-player { display: flex; align-items: center; gap: 8px; flex: none; min-height: 44px; padding: 7px 11px; border-radius: 13px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); transition: box-shadow .25s, background-color .25s; }
.chess-player.is-turn { background: var(--raise-2); box-shadow: inset 0 0 0 1.500px var(--accent); }
.chess-swatch { flex: none; width: 14px; height: 14px; border-radius: 50%; background: #fffdf6; box-shadow: inset 0 0 0 1px rgba(0, 0, 20, .35); }
.chess-swatch.b { background: #2a2d4a; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .4); }
.chess-who { display: grid; flex: 1; min-width: 0; }
.chess-who b { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chess-caps { display: flex; flex-wrap: wrap; align-items: center; min-height: 17px; font-size: 11px; font-weight: 700; color: var(--fg-3); }
.chess-cap { width: 17px; height: 17px; margin-right: -5px; }
.chess-cap svg { width: 100%; height: 100%; }
.chess-adv { margin-left: 9px; font-variant-numeric: tabular-nums; }
.chess-dots { display: inline-flex; gap: 3px; flex: none; }
.chess-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); animation: chess-dot 1s infinite both; }
.chess-dots i:nth-child(2) { animation-delay: .15s; }
.chess-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes chess-dot { 0%, 60%, 100% { opacity: .25; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }
.chess-status { flex: none; padding: 0 3px; font-size: 13px; font-weight: 650; color: var(--fg-2); text-wrap: balance; }
.chess-status.is-check { color: var(--c-coral); }
.chess-status.is-over { color: var(--fg); font-size: 14px; }
.chess-moves { flex: 1; min-height: 0; padding: 6px; border-radius: 13px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.chess-moves ol { display: grid; grid-template-columns: 30px 1fr 1fr; align-content: start; gap: 1px 2px; }
.chess-moves li { display: contents; }
.chess-moves .n { padding: 3px 4px 3px 0; text-align: right; color: var(--fg-3); }
.chess-moves .m { padding: 3px 6px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
.chess-moves .m.is-cur { background: var(--accent); color: #fff; }
.chess-moves p { padding: 8px; color: var(--fg-3); text-align: center; }
.chess-again { flex: none; }
.chess-opts { display: grid; gap: 12px; }
.chess-opt { display: grid; gap: 5px; transition: opacity .2s; }
.chess-opt.is-off { opacity: .35; pointer-events: none; }
.chess-opt .gseg { display: flex; }
@container win (max-width: 620px) {
  .chess { flex-direction: column; }
  .chess-stage { padding: 12px 12px 8px; }
  .chess-side { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; width: auto; padding: 0 12px 12px; }
  .chess-status { grid-column: 1 / -1; grid-row: 1; text-align: center; }
  .chess-moves { display: none; }
  .chess-again { grid-column: 1 / -1; }
  .chess-player { min-height: 40px; padding: 5px 10px; }
}
`);

const db = appStore('chess');
const soundOn = () => sfx.enabled && audioReady();

export default {
  singleton: true,
  width: 860, height: 640, minW: 380, minH: 500,

  mount(win) {
    const core = chessCore();
    const pos = core.create();
    const saved = db.get('game', null);
    const game = { mode: 'cpu', level: 1, human: 0, ...db.get('prefs', {}) };
    let moves = [], sans = [], keys = [pos.key()];
    let legalNow = pos.legal();
    let flip = false, sel = -1, cursor = -1, showCursor = false, result = null, thinking = false;
    let dragging = null, promo = null;
    let worker = null, job = 0, thinkTimer = 0;

    // ---------- Aufbau ----------
    const boardEl = h('div.chess-board', { role: 'application', 'aria-label': 'Schachbrett', tabIndex: 0 });
    const piecesEl = h('div.chess-pieces');
    const wrap = h('div.chess-wrap', boardEl, piecesEl);
    const sqEls = new Map();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) sqEls.set(r * 16 + f, h(`div.chess-sq.${(r + f) & 1 ? 'l' : 'd'}`));
    const pcs = new Map();       // Feld → {el, code}

    const mkPlayer = () => {
      const el = h('div.chess-player');
      el.sw = h('span.chess-swatch');
      el.nm = h('b');
      el.caps = h('span.chess-caps');
      el.dots = h('span.chess-dots', { hidden: true }, h('i'), h('i'), h('i'));
      el.append(el.sw, h('span.chess-who', el.nm, el.caps), el.dots);
      return el;
    };
    const pTop = mkPlayer(), pBot = mkPlayer();
    const statusEl = h('div.chess-status', { role: 'status', 'aria-live': 'polite' });
    const movesOl = h('ol');
    const movesEl = h('div.chess-moves.scroll', { 'aria-label': 'Zugliste' }, movesOl);
    const refocus = () => boardEl.focus({ preventScroll: true });     // Pfeile und Enter gehören danach wieder dem Brett
    const bUndo = toolBtn('undo', 'Zug zurück (Z)', () => { undoMove(); refocus(); });
    const bFlip = toolBtn('reload', 'Brett drehen (D)', () => { setFlip(!flip); refocus(); });
    const bNew = toolBtn('plus', 'Neue Partie (N)', () => newGameSheet());
    const bAgain = h('button.kit-btn.primary.chess-again', { type: 'button', hidden: true, onclick: () => newGameSheet() }, 'Neue Partie');
    win.tools.append(bUndo, bFlip, bNew);
    win.body.append(h('div.chess', h('div.chess-stage', wrap), h('aside.chess-side', pTop, statusEl, movesEl, pBot, bAgain)));

    // ---------- Brett und Figuren ----------
    const xy = (sq) => [flip ? 7 - (sq & 7) : sq & 7, flip ? sq >> 4 : 7 - (sq >> 4)];
    const place = (el, sq) => { const [x, y] = xy(sq); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; };

    function layoutBoard() {
      const order = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sq = flip ? y * 16 + (7 - x) : (7 - y) * 16 + x;
          const el = sqEls.get(sq);
          el.textContent = '';
          if (y === 7) el.append(h('i.f', 'abcdefgh'[sq & 7]));
          if (x === 0) el.append(h('i.r', String((sq >> 4) + 1)));
          order.push(el);
        }
      }
      boardEl.replaceChildren(...order);
    }

    const pcClass = (code) => `chess-pc ${code & 8 ? 'cb' : 'cw'}`;
    function vanish(p) {
      p.el.classList.add('is-out');
      setTimeout(() => p.el.remove(), 240);
    }
    /** Gleicht die Figuren-Elemente mit der Stellung ab; `hint` bewegt gezielt das Element des gespielten Zugs. */
    function syncPieces(hint) {
      if (hint && pcs.has(hint.from)) {
        const p = pcs.get(hint.from);
        pcs.delete(hint.from);
        if (pcs.has(hint.to)) vanish(pcs.get(hint.to));
        pcs.set(hint.to, p);
        const code = pos.board[hint.to];
        if (code !== p.code) { p.code = code; p.el.className = pcClass(code); p.el.innerHTML = pieceSvg(code); }
      }
      const spare = [];
      for (const [sq, p] of pcs) if (pos.board[sq] !== p.code) spare.push([sq, p]);
      for (const [sq] of spare) pcs.delete(sq);
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const code = pos.board[sq];
        if (!code || pcs.has(sq)) continue;
        let bi = -1, bd = 1e9;
        spare.forEach(([from, p], i) => {
          const d = Math.abs((from & 7) - (sq & 7)) + Math.abs((from >> 4) - (sq >> 4));
          if (p && p.code === code && d < bd) { bd = d; bi = i; }
        });
        let p;
        if (bi >= 0) { p = spare[bi][1]; spare[bi][1] = null; }
        else {
          p = { code, el: h('div', { class: `${pcClass(code)} is-in`, html: pieceSvg(code) }) };
          place(p.el, sq);
          piecesEl.append(p.el);
        }
        pcs.set(sq, p);
      }
      for (const [, p] of spare) if (p) vanish(p);
      for (const [sq, p] of pcs) { p.el.classList.remove('is-drag', 'is-ghost'); place(p.el, sq); }
    }

    // ---------- Stand der Partie ----------
    const humanTurn = () => !result && !thinking && (game.mode === 'two' || pos.side === game.human);
    const movesFrom = (sq) => legalNow.filter((m) => (m & 127) === sq);

    function outcome() {
      if (!legalNow.length) return pos.inCheck() ? { type: 'mate', winner: pos.side ^ 1 } : { type: 'draw', why: 'Patt' };
      if (pos.insufficient()) return { type: 'draw', why: 'zu wenig Material' };
      if (pos.half >= 100) return { type: 'draw', why: '50-Züge-Regel' };
      const k = keys[keys.length - 1];
      if (keys.filter((x) => x === k).length >= 3) return { type: 'draw', why: 'dreifache Stellungswiederholung' };
      return null;
    }

    const colorName = (c) => (c ? 'Schwarz' : 'Weiß');
    function statusText() {
      if (result) {
        if (result.type === 'draw') return `Remis – ${result.why}`;
        if (game.mode === 'cpu') return result.winner === game.human ? 'Schachmatt – du gewinnst!' : 'Schachmatt – der Computer gewinnt.';
        return `Schachmatt – ${colorName(result.winner)} gewinnt!`;
      }
      const chk = pos.inCheck() ? 'Schach! ' : '';
      if (game.mode === 'cpu') return chk + (pos.side === game.human ? 'Du bist am Zug.' : 'Der Computer denkt …');
      return `${chk}${colorName(pos.side)} ist am Zug.`;
    }

    function paintPlayer(el, color) {
      el.sw.className = `chess-swatch ${color ? 'b' : 'w'}`;
      el.nm.textContent = game.mode === 'two' ? colorName(color) : color === game.human ? `Du · ${colorName(color)}` : `Computer · ${LEVELS[game.level].name}`;
      el.classList.toggle('is-turn', !result && pos.side === color);
      el.dots.hidden = !(thinking && pos.side === color);
      // geschlagene Figuren des Gegners und Materialvorsprung
      const have = [new Array(7).fill(0), new Array(7).fill(0)];
      for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const pc = pos.board[sq];
        if (pc) have[pc >> 3][pc & 7]++;
      }
      const foe = color ^ 1, start = [0, 8, 2, 2, 2, 1, 1];
      const promoted = [2, 3, 4, 5].reduce((n, t) => n + Math.max(0, have[foe][t] - start[t]), 0);
      const kids = [];
      for (const t of [5, 4, 3, 2, 1]) {
        const lost = t === 1 ? 8 - have[foe][1] - promoted : Math.max(0, start[t] - have[foe][t]);
        for (let i = 0; i < lost; i++) kids.push(h('span', { class: `chess-cap ${foe ? 'cb' : 'cw'}`, title: NAME[t], html: pieceSvg(t) }));
      }
      const worth = (c) => have[c].reduce((n, cnt, t) => n + cnt * WORTH[t], 0);
      const adv = worth(color) - worth(foe);
      if (adv > 0) kids.push(h('span.chess-adv', `+${adv}`));
      el.caps.replaceChildren(...kids);
    }

    function render() {
      const last = moves[moves.length - 1];
      const targets = sel >= 0 ? movesFrom(sel) : [];
      const chk = pos.inCheck() ? pos.kingOf(pos.side) : -1;
      for (const [sq, el] of sqEls) {
        const tg = targets.some((m) => ((m >> 7) & 127) === sq);
        const occupied = pos.board[sq] || (tg && targets.some((m) => ((m >> 7) & 127) === sq && (m >> 17) === 2));
        el.classList.toggle('is-last', last != null && ((last & 127) === sq || ((last >> 7) & 127) === sq));
        el.classList.toggle('is-sel', sq === sel);
        el.classList.toggle('is-check', sq === chk);
        el.classList.toggle('is-target', tg && !occupied);
        el.classList.toggle('is-capture', tg && !!occupied);
        el.classList.toggle('is-cursor', showCursor && sq === cursor);
        el.classList.toggle('is-over', !!dragging?.moved && sq === dragging.over && tg);
      }
      const topColor = flip ? 0 : 1;
      paintPlayer(pTop, topColor);
      paintPlayer(pBot, topColor ^ 1);
      statusEl.textContent = statusText();
      statusEl.classList.toggle('is-over', !!result);
      statusEl.classList.toggle('is-check', !result && chk >= 0);
      const rows = [];
      for (let i = 0; i < sans.length; i += 2) {
        rows.push(h('li',
          h('span.n', `${i / 2 + 1}.`),
          h('span', { class: `m${i === sans.length - 1 ? ' is-cur' : ''}` }, sans[i]),
          sans[i + 1] ? h('span', { class: `m${i + 1 === sans.length - 1 ? ' is-cur' : ''}` }, sans[i + 1]) : h('span')));
      }
      movesOl.replaceChildren(...rows);
      movesEl.querySelector('p')?.remove();
      if (!rows.length) movesEl.append(h('p', 'Noch kein Zug gespielt.'));
      movesEl.scrollTop = movesEl.scrollHeight;
      bUndo.disabled = !canUndo();
      bAgain.hidden = !result;
    }

    function save() {
      db.set('game', { v: 1, mode: game.mode, level: game.level, human: game.human, flip, moves: moves.map(core.uci) });
    }

    // ---------- Töne ----------
    function sound(kind) {
      if (!soundOn()) return;
      if (kind === 'move') tone({ type: 'triangle', f: 310, f2: 180, dur: 0.075, vol: 0.13 });
      else if (kind === 'capture') { tone({ type: 'triangle', f: 230, f2: 110, dur: 0.11, vol: 0.16 }); tone({ type: 'square', f: 1100, f2: 500, dur: 0.03, vol: 0.02 }); }
      else if (kind === 'check') { tone({ type: 'triangle', f: 310, f2: 180, dur: 0.075, vol: 0.13 }); tone({ f: 740, dur: 0.1, vol: 0.06, when: 0.06 }); tone({ f: 988, dur: 0.16, vol: 0.06, when: 0.15 }); }
      else if (kind === 'win') sfx.chime();
      else if (kind === 'lose') [392, 330, 262].forEach((f, i) => tone({ f, dur: 0.4, vol: 0.07, attack: 0.02, when: i * 0.16 }));
      else if (kind === 'draw') sfx.notify();
    }

    // ---------- Ziehen ----------
    function play(m) {
      const from = m & 127, to = (m >> 7) & 127;
      const capture = !!pos.board[to] || (m >> 17) === 2;
      closePromo();
      sans.push(pos.san(m, legalNow));
      pos.make(m);
      moves.push(m);
      keys.push(pos.key());
      legalNow = pos.legal();
      result = outcome();
      sel = -1;
      syncPieces({ from, to });
      if (result) sound(result.type === 'draw' ? 'draw' : game.mode === 'cpu' && result.winner !== game.human ? 'lose' : 'win');
      else sound(pos.inCheck() ? 'check' : capture ? 'capture' : 'move');
      save();
      render();
      if (!result && game.mode === 'cpu' && pos.side !== game.human) think();
    }

    function tryMove(from, to) {
      const ms = legalNow.filter((m) => (m & 127) === from && ((m >> 7) & 127) === to);
      if (!ms.length) return false;
      if (ms.length > 1) askPromo(ms, from, to); else play(ms[0]);
      return true;
    }

    function closePromo() {
      if (!promo) return;
      promo.el.remove();
      promo = null;
      for (const [sq, p] of pcs) { p.el.classList.remove('is-ghost'); place(p.el, sq); }
    }
    /** Umwandlung: Auswahl direkt über dem Zielfeld. */
    function askPromo(ms, from, to) {
      closePromo();
      const [x, y] = xy(to);
      const color = pos.side << 3;
      const el = h('div.chess-promo', { role: 'menu', 'aria-label': 'Umwandeln in', style: { left: `${x * 12.5}%`, [y === 0 ? 'top' : 'bottom']: '0', flexDirection: y === 0 ? 'column' : 'column-reverse' } },
        [5, 4, 3, 2].map((t) => h('button', {
          type: 'button', role: 'menuitem', class: color ? 'cb' : 'cw', 'aria-label': NAME[t], title: NAME[t], html: pieceSvg(t),
          onclick: () => play(ms.find((m) => ((m >> 14) & 7) === t)),
        })));
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('keydown', (e) => {
        const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        const b = [...el.children];
        b[(b.indexOf(document.activeElement) + d + b.length) % b.length].focus();
      });
      promo = { el };
      pcs.get(to)?.el.classList.add('is-ghost');
      if (pcs.has(from)) place(pcs.get(from).el, to);
      wrap.append(el);
      // erst nach dem laufenden Klick fokussieren – sonst holt sich das Brett den Fokus zurück
      requestAnimationFrame(() => { if (promo?.el === el) el.firstChild.focus({ preventScroll: true }); });
    }

    /** Ein Feld wurde gewählt (Klick oder Enter). */
    function activate(sq) {
      if (!humanTurn() || sq < 0) return;
      if (promo) { closePromo(); render(); return; }
      if (sel >= 0 && sel !== sq && tryMove(sel, sq)) return;
      const pc = pos.board[sq];
      sel = pc && (pc >> 3) === pos.side && sq !== sel ? sq : -1;
      render();
    }

    const sqAt = (e) => {
      const r = wrap.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * 8), y = Math.floor(((e.clientY - r.top) / r.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
      return flip ? y * 16 + (7 - x) : (7 - y) * 16 + x;
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button && e.pointerType === 'mouse') return;
      showCursor = false;
      const sq = sqAt(e);
      if (promo) { closePromo(); render(); return; }
      if (!humanTurn() || sq < 0) return;
      cursor = sq;
      const pc = pos.board[sq];
      const own = pc && (pc >> 3) === pos.side;
      if (sel >= 0 && sel !== sq && tryMove(sel, sq)) return;
      if (!own) { sel = -1; render(); return; }
      dragging = { sq, was: sel === sq, moved: false, x0: e.clientX, y0: e.clientY, over: -1, id: e.pointerId };
      sel = sq;
      try { wrap.setPointerCapture(e.pointerId); } catch { /* egal */ }
      render();
    });
    wrap.addEventListener('pointermove', (e) => {
      const d = dragging;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      const p = pcs.get(d.sq);
      if (!p) return;
      const r = wrap.getBoundingClientRect(), size = r.width / 8;
      if (!d.moved) { d.moved = true; p.el.classList.add('is-drag'); }
      p.el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
      const over = sqAt(e);
      if (over !== d.over) { d.over = over; render(); }
    });
    const endDrag = (e) => {
      const d = dragging;
      if (!d || e.pointerId !== d.id) return;
      dragging = null;
      const p = pcs.get(d.sq);
      p?.el.classList.remove('is-drag');
      if (d.moved) {
        const to = e.type === 'pointerup' ? sqAt(e) : -1;
        if (to >= 0 && to !== d.sq && tryMove(d.sq, to)) return;
        if (p) place(p.el, d.sq);
      } else if (d.was) sel = -1;
      render();
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    // ---------- Computer ----------
    function cancelThink() {
      job++;
      clearTimeout(thinkTimer);
      thinking = false;
      if (worker) { worker.terminate(); worker = null; }
    }
    function think() {
      const id = ++job, t0 = performance.now();
      const lv = LEVELS[game.level];
      const opts = { depth: lv.depth, time: lv.time, margin: lv.margin || (pos.full <= 5 ? 14 : 0), wild: lv.wild || 0, wildMargin: lv.wildMargin || 0 };
      thinking = true;
      render();
      const answer = (m) => {
        if (id !== job) return;
        // nicht schneller als ein Wimpernschlag antworten – das wirkt sonst hektisch
        thinkTimer = setTimeout(() => {
          if (id !== job) return;
          thinking = false;
          const mv = legalNow.includes(m) ? m : legalNow[0];
          if (mv) play(mv); else render();
        }, Math.max(0, 420 - (performance.now() - t0)));
      };
      const local = () => {
        if (worker) { worker.terminate(); worker = null; }
        thinkTimer = setTimeout(() => {
          if (id !== job) return;
          let m = 0;
          try { m = pos.search({ ...opts, time: Math.min(opts.time, 350) })?.move || 0; } catch { /* dann der erste legale Zug */ }
          answer(m);
        }, 30);
      };
      try {
        if (!worker) worker = makeWorker();
        worker.onmessage = (e) => { if (e.data.id === id) { if (e.data.move) answer(e.data.move); else local(); } };
        worker.onerror = (e) => { e.preventDefault?.(); if (id === job) local(); };
        worker.postMessage({ id, fen: core.START, moves, opts });
      } catch { local(); }
    }

    // ---------- Partie-Befehle ----------
    const undoCount = () => (game.mode === 'two' ? 1 : pos.side === game.human ? 2 : 1);
    const canUndo = () => moves.length >= undoCount();
    function undoMove() {
      if (!canUndo()) return;
      const n = undoCount();
      cancelThink();
      closePromo();
      for (let i = 0; i < n; i++) { pos.unmake(); moves.pop(); sans.pop(); keys.pop(); }
      legalNow = pos.legal();
      result = null;
      sel = -1;
      syncPieces();
      if (soundOn()) sfx.tick();
      save();
      render();
    }
    function setFlip(v) {
      flip = v;
      closePromo();
      layoutBoard();
      syncPieces();
      save();
      render();
    }
    function start(opts) {
      cancelThink();
      closePromo();
      Object.assign(game, opts);
      db.set('prefs', { mode: game.mode, level: game.level, human: game.human });
      pos.load(core.START);
      moves = []; sans = []; keys = [pos.key()];
      legalNow = pos.legal();
      result = null;
      sel = -1;
      flip = game.mode === 'cpu' && game.human === 1;
      layoutBoard();
      syncPieces();
      save();
      render();
      if (game.mode === 'cpu' && pos.side !== game.human) think();
    }
    function newGameSheet() {
      const pick = { mode: game.mode, level: game.level, color: db.get('color', 'w') };
      const seg = (label, opts, cur, on) => {
        const g = h('div.gseg', { 'aria-label': label }, opts.map(([v, text]) => h('button', { type: 'button', dataset: { value: v }, 'aria-selected': String(String(v) === String(cur)) }, text)));
        g.addEventListener('change', (e) => on(e.detail.value));
        return h('div.chess-opt', h('span.kit-label', label), g);
      };
      const sLevel = seg('Stärke', LEVELS.map((l, i) => [i, l.name]), pick.level, (v) => { pick.level = +v; });
      const sColor = seg('Du spielst', [['w', 'Weiß'], ['b', 'Schwarz'], ['r', 'Zufall']], pick.color, (v) => { pick.color = v; });
      const dim = () => { for (const el of [sLevel, sColor]) el.classList.toggle('is-off', pick.mode === 'two'); };
      const sMode = seg('Gegner', [['cpu', 'Computer'], ['two', 'Zwei Spieler']], pick.mode, (v) => { pick.mode = v; dim(); });
      const body = h('div.chess-opts', sMode, sLevel, sColor);
      initControls(body);
      dim();
      sheet(win, {
        title: 'Neue Partie', body, cancelValue: false,
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Partie starten', value: true, primary: true }],
      }).then((ok) => {
        if (!ok) return;
        db.set('color', pick.color);
        start({ mode: pick.mode, level: pick.level, human: pick.color === 'r' ? (Math.random() < 0.5 ? 0 : 1) : pick.color === 'b' ? 1 : 0 });
      });
    }

    // ---------- Tastatur ----------
    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, .kit-sheet-wrap') || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (key === 'z') { e.preventDefault(); undoMove(); }
        return;
      }
      const dir = { arrowup: [0, 1], arrowdown: [0, -1], arrowleft: [-1, 0], arrowright: [1, 0] }[key];
      if (dir) {
        if (promo) return;
        e.preventDefault();
        if (cursor < 0) cursor = sel >= 0 ? sel : game.mode === 'cpu' && game.human ? 100 : 20;
        else if (showCursor) {
          const s = flip ? -1 : 1;
          const f = Math.min(7, Math.max(0, (cursor & 7) + dir[0] * s)), r = Math.min(7, Math.max(0, (cursor >> 4) + dir[1] * s));
          cursor = r * 16 + f;
        }
        showCursor = true;
        render();
      } else if (key === 'enter' || key === ' ') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        if (showCursor && cursor >= 0) activate(cursor);
      } else if (key === 'escape') {
        if (promo || sel >= 0) { e.preventDefault(); closePromo(); sel = -1; render(); }
      } else if (key === 'z' || key === 'backspace') { e.preventDefault(); undoMove(); }
      else if (key === 'd') setFlip(!flip);
      else if (key === 'n') newGameSheet();
    });

    // ---------- Start: gespeicherte Partie fortsetzen ----------
    if (saved && Array.isArray(saved.moves)) {
      game.mode = saved.mode === 'two' ? 'two' : 'cpu';
      game.level = [0, 1, 2].includes(saved.level) ? saved.level : 1;
      game.human = saved.human === 1 ? 1 : 0;
      flip = !!saved.flip;
      for (const str of saved.moves) {
        const m = pos.find(str);
        if (!m) break;
        sans.push(pos.san(m));
        pos.make(m);
        moves.push(m);
        keys.push(pos.key());
      }
      legalNow = pos.legal();
      result = outcome();
    } else flip = game.mode === 'cpu' && game.human === 1;
    layoutBoard();
    syncPieces();
    render();
    if (!result && game.mode === 'cpu' && pos.side !== game.human) think();

    return {
      onFocus: () => { if (!win.el.contains(document.activeElement) || document.activeElement === win.el) boardEl.focus({ preventScroll: true }); },
      onClose: () => { cancelThink(); },
      menus: () => [{
        label: 'Partie',
        items: [
          { label: 'Neue Partie …', icon: 'plus', hint: 'N', run: newGameSheet },
          { label: 'Zug zurück', icon: 'undo', hint: 'Z', disabled: !canUndo(), run: undoMove },
          '-',
          { label: 'Brett drehen', icon: 'reload', hint: 'D', run: () => setFlip(!flip) },
        ],
      }],
    };
  },
};
