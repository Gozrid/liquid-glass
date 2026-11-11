// game.js — „Prisma“: fang das Licht in der passenden Farbe. Ein kleines Originalspiel.

import { h, ticker, store, clamp, rand, TAU } from '../../core/util.js';
import { tone, sfx } from '../../core/audio.js';
import { sys } from '../sys.js';

const COLORS = ['#ff5d6c', '#45c8ff', '#ffb65c'];
const BEST = 'fableos.prisma.best';

export default {
  id: 'game', name: 'Prisma', icon: 'prism', colors: ['#8468ff', '#3a1fb8'], keywords: 'spiel game spielen',
  singleton: true, width: 520, height: 600, minW: 360, minH: 440,

  mount(win) {
    const cv = h('canvas.game-canvas', { tabIndex: 0, 'aria-label': 'Spielfeld von Prisma' });
    const ctx = cv.getContext('2d');
    win.body.append(h('div.game', cv));
    let W = 0, H = 0, dpr = 1;
    let state = 'title';          // title | play | over
    let orbs = [], sparks = [];
    let px = 0, target = 0, col = 0;
    let score = 0, combo = 0, lives = 3, best = store.get(BEST, 0);
    let spawn = 0, elapsed = 0, shake = 0, keyDir = 0, flash = 0;

    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    const start = () => {
      state = 'play';
      orbs = [];
      sparks = [];
      score = combo = elapsed = 0;
      lives = 3;
      spawn = 0.5;
      px = target = W / 2;
    };
    const cycle = () => { col = (col + 1) % 3; flash = 1; sfx.tick(); };
    const act = () => { if (state === 'play') cycle(); else start(); };

    cv.addEventListener('pointermove', (e) => { target = e.clientX - cv.getBoundingClientRect().left; });
    cv.addEventListener('pointerdown', (e) => { target = e.clientX - cv.getBoundingClientRect().left; act(); cv.focus({ preventScroll: true }); });
    win.el.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === 'ArrowUp' || e.key === 'Enter') { e.preventDefault(); act(); }
      else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') keyDir = -1;
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keyDir = 1;
    });
    win.el.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) keyDir = 0; });

    const burst = (x, y, c, n = 14) => {
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), s = rand(60, 300);
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.35, 0.8), c });
      }
    };

    const frame = (dt) => {
      if (win.min || !W) return;
      const paused = sys.wm.focused !== win && state === 'play';
      const PW = clamp(W * 0.24, 86, 130), PH = 16, PY = H - 46;

      if (state === 'play' && !paused) {
        elapsed += dt;
        if (keyDir) target = clamp(target + keyDir * 620 * dt, 0, W);
        px += (clamp(target, PW / 2, W - PW / 2) - px) * (1 - Math.exp(-dt * 22));
        const level = Math.min(1, elapsed / 75);
        spawn -= dt;
        if (spawn <= 0) {
          spawn = 0.95 - level * 0.55 + rand(0.15);
          orbs.push({ x: rand(26, W - 26), y: -20, vy: 150 + level * 200 + rand(50), c: (Math.random() * 3) | 0, r: 13, t: rand(TAU) });
        }
        for (const o of orbs) {
          o.y += o.vy * dt;
          o.t += dt * 3;
          if (!o.dead && o.y + o.r >= PY && o.y - o.r <= PY + PH && Math.abs(o.x - px) < PW / 2 + o.r * 0.6) {
            o.dead = true;
            if (o.c === col) {
              combo++;
              score += combo;
              burst(o.x, PY, COLORS[o.c]);
              tone({ type: 'triangle', f: 420 * 2 ** (Math.min(combo, 12) / 12), dur: 0.14, vol: sfx.enabled ? 0.12 : 0 });
            } else {
              lives--;
              combo = 0;
              shake = 0.35;
              burst(o.x, PY, '#ffffff', 22);
              sfx.error();
              if (lives <= 0) {
                state = 'over';
                if (score > best) { best = score; store.set(BEST, best); }
              }
            }
          } else if (!o.dead && o.y > H + 30) {
            o.dead = true;
            if (o.c === col) combo = 0;       // verpasst: die Serie reißt
          }
        }
        orbs = orbs.filter((o) => !o.dead);
      }
      for (const s of sparks) { s.vy += 700 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      sparks = sparks.filter((s) => s.life > 0);
      shake = Math.max(0, shake - dt);
      flash = Math.max(0, flash - dt * 4);

      // ---------- Zeichnen ----------
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(rand(-6, 6) * shake * 3, rand(-6, 6) * shake * 3);
      ctx.globalCompositeOperation = 'lighter';
      for (const o of orbs) {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 2.6);
        g.addColorStop(0, COLORS[o.c]);
        g.addColorStop(0.35, `${COLORS[o.c]}aa`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 2.6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 0.42 + Math.sin(o.t) * 1.2, 0, TAU);
        ctx.fill();
      }
      for (const s of sparks) {
        ctx.globalAlpha = clamp(s.life * 2);
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (state !== 'title') {
        // das Prisma (Schläger)
        const x = px - PW / 2;
        const g = ctx.createLinearGradient(x, PY, x, PY + PH);
        g.addColorStop(0, `${COLORS[col]}ee`);
        g.addColorStop(1, `${COLORS[col]}77`);
        ctx.shadowColor = COLORS[col];
        ctx.shadowBlur = 22 + flash * 26;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, PY, PW, PH, PH / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.beginPath();
        ctx.roundRect(x + 8, PY + 2.5, PW - 16, 3, 2);
        ctx.fill();
      }
      ctx.restore();

      // ---------- Anzeige ----------
      const fam = getComputedStyle(cv).fontFamily;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff';
      if (state === 'play') {
        ctx.textAlign = 'left';
        ctx.font = `700 26px ${fam}`;
        ctx.fillText(String(score), 20, 40);
        ctx.font = `600 12px ${fam}`;
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(combo > 1 ? `Serie ×${combo}` : `Bestwert ${best}`, 20, 58);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < lives ? '#ff5d6c' : 'rgba(255,255,255,.18)';
          ctx.beginPath();
          ctx.arc(W - 24 - i * 20, 32, 6, 0, TAU);
          ctx.fill();
        }
        if (paused) {
          ctx.fillStyle = 'rgba(5,6,15,.55)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.font = `700 22px ${fam}`;
          ctx.fillText('Pause', W / 2, H / 2);
        }
      } else {
        ctx.textAlign = 'center';
        ctx.font = `800 ${Math.min(64, W * 0.16)}px ${fam}`;
        const grad = ctx.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0);
        grad.addColorStop(0, '#ffb65c'); grad.addColorStop(0.5, '#ff5d6c'); grad.addColorStop(1, '#45c8ff');
        ctx.fillStyle = grad;
        ctx.fillText(state === 'title' ? 'Prisma' : String(score), W / 2, H * 0.4);
        ctx.fillStyle = '#fff';
        ctx.font = `600 16px ${fam}`;
        ctx.fillText(state === 'title' ? 'Fang das Licht in deiner Farbe.' : score >= best && score > 0 ? 'Neuer Bestwert!' : `Bestwert ${best}`, W / 2, H * 0.4 + 34);
        ctx.fillStyle = 'rgba(255,255,255,.62)';
        ctx.font = `500 13px ${fam}`;
        const lines = state === 'title'
          ? ['Bewegen: Maus oder ← →', 'Farbe wechseln: Klick oder Leertaste', 'Falsche Farbe kostet ein Leben.', '', 'Klick zum Starten']
          : ['Klick für eine neue Runde'];
        lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.4 + 74 + i * 21));
        COLORS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(W / 2 + (i - 1) * 30, H * 0.4 - 96, 8, 0, TAU);
          ctx.fill();
        });
      }
    };
    ticker.add(frame);
    return {
      onFocus: () => cv.focus({ preventScroll: true }),
      onClose: () => { ticker.remove(frame); ro.disconnect(); },
    };
  },
};
