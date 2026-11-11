// paint.js — Malen: Pinsel, Marker, Radierer, Spiegel- und Regenbogenmodus, Speichern ins Dateisystem

import { h } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sys } from '../sys.js';
import { vfs, HOME, basename } from '../vfs.js';

const W = 1200, H = 760;
const SWATCHES = ['#0b1030', '#ffffff', '#ff5d6c', '#ff6a3d', '#ffb65c', '#3fe0b0', '#45c8ff', '#2f6bff', '#a06bff', '#ff8ad1'];

export default {
  id: 'paint', name: 'Malen', icon: 'brush', colors: ['#ff8ad1', '#a94bff'], keywords: 'zeichnen bild pinsel',
  width: 860, height: 580, minW: 520, minH: 380,

  mount(win, args) {
    const cv = h('canvas.paint-canvas', { width: W, height: H, 'aria-label': 'Zeichenfläche' });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    let tool = 'brush';
    let color = '#ff5d6c';
    let size = 10;
    let mirror = false;
    let rainbow = false;
    let hue = 0;
    let undo = [];
    let redo = [];
    let path = null;

    const blank = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); };
    blank();
    const snap = () => { undo.push(ctx.getImageData(0, 0, W, H)); if (undo.length > 14) undo.shift(); redo = []; paintBtns(); };

    // ---------- Werkzeugleiste ----------
    const tools = [['brush', 'Pinsel', 'brush'], ['marker', 'Marker', 'drop'], ['eraser', 'Radierer', 'eraser']];
    const toolBox = h('div.paint-group');
    const swBox = h('div.paint-swatches');
    const custom = h('input', { type: 'color', value: color, 'aria-label': 'Eigene Farbe' });
    const sizeSl = h('div.gslider', { dataset: { min: 2, max: 60, step: 1, value: size }, 'aria-label': 'Pinselgröße' });
    const dot = h('i.paint-dot');
    const toggle = (label, ic, get, setv) => {
      const b = h('button.tool', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false', html: icon(ic) });
      b.addEventListener('click', () => { setv(!get()); b.setAttribute('aria-pressed', String(get())); b.classList.toggle('is-on', get()); });
      return b;
    };
    const bUndo = h('button.tool', { type: 'button', title: 'Rückgängig', 'aria-label': 'Rückgängig', html: icon('undo') });
    const bRedo = h('button.tool', { type: 'button', title: 'Wiederholen', 'aria-label': 'Wiederholen', html: icon('redo') });
    const bClear = h('button.tool', { type: 'button', title: 'Alles löschen', 'aria-label': 'Alles löschen', html: icon('trash') });
    const bSave = h('button.btn.small.primary', { type: 'button', html: `${icon('download')} Sichern` });
    const bar = h('div.paint-bar',
      toolBox,
      h('div.paint-group', toggle('Spiegeln', 'layers', () => mirror, (v) => { mirror = v; }), toggle('Regenbogen', 'sparkles', () => rainbow, (v) => { rainbow = v; })),
      swBox,
      h('div.paint-size', dot, sizeSl),
      h('div.paint-group', bUndo, bRedo, bClear),
      bSave);
    const stage = h('div.paint-stage', cv);
    win.body.append(h('div.paint', bar, stage));
    initControls(bar);

    const paintBtns = () => {
      toolBox.replaceChildren(...tools.map(([id, name, ic]) =>
        h('button.tool', { type: 'button', title: name, 'aria-label': name, class: tool === id ? 'is-on' : '', html: icon(ic), onclick: () => { tool = id; paintBtns(); } })));
      swBox.replaceChildren(
        ...SWATCHES.map((c) => h('button', { type: 'button', 'aria-label': `Farbe ${c}`, class: c === color ? 'is-on' : '', style: { '--c': c }, onclick: () => { color = c; custom.value = c; paintBtns(); } })),
        h('label.paint-custom', custom));
      bUndo.disabled = !undo.length;
      bRedo.disabled = !redo.length;
      dot.style.setProperty('--d', `${Math.max(4, Math.min(26, size))}px`);
      dot.style.setProperty('--c', tool === 'eraser' ? '#fff' : color);
    };
    custom.addEventListener('input', () => { color = custom.value; paintBtns(); });
    sizeSl.addEventListener('input', (e) => { size = e.detail.value; paintBtns(); });
    bUndo.addEventListener('click', () => { if (!undo.length) return; redo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(undo.pop(), 0, 0); paintBtns(); });
    bRedo.addEventListener('click', () => { if (!redo.length) return; undo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(redo.pop(), 0, 0); paintBtns(); });
    bClear.addEventListener('click', () => { snap(); blank(); });

    // ---------- Zeichnen ----------
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };
    const stroke = (x0, y0, cx, cy, x1, y1, w) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = w;
      ctx.globalAlpha = tool === 'marker' ? 0.28 : 1;
      ctx.strokeStyle = tool === 'eraser' ? '#fff' : rainbow ? `hsl(${hue}, 95%, 58%)` : color;
      const seg = (a, b, c, d, e, f) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.quadraticCurveTo(c, d, e, f); ctx.stroke(); };
      seg(x0, y0, cx, cy, x1, y1);
      if (mirror) seg(W - x0, y0, W - cx, cy, W - x1, y1);
      ctx.globalAlpha = 1;
    };
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      cv.setPointerCapture(e.pointerId);
      snap();
      const [x, y] = pos(e);
      last = { x, y, mx: x, my: y };
      stroke(x, y, x, y, x + 0.01, y + 0.01, width(e));
    });
    const width = (e) => (tool === 'marker' ? size * 2.2 : size) * (e.pointerType === 'pen' ? 0.4 + e.pressure * 1.2 : 1);
    cv.addEventListener('pointermove', (e) => {
      if (!last) return;
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const [x, y] = pos(ev);
        const mx = (last.x + x) / 2, my = (last.y + y) / 2;
        hue = (hue + 1.6) % 360;
        stroke(last.mx, last.my, last.x, last.y, mx, my, width(ev));
        last = { x, y, mx, my };
      }
    });
    const end = () => { last = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    // ---------- Laden & Sichern ----------
    const load = (p) => {
      const data = vfs.read(p);
      if (!data.startsWith('data:image/')) return;
      const img = new Image();
      img.onload = () => {
        blank();
        const s = Math.min(W / img.width, H / img.height);
        ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
        undo = [];
        redo = [];
        paintBtns();
      };
      img.src = data;
      path = p;
      win.setTitle(`${basename(p)} – Malen`);
    };
    const save = () => {
      const dir = `${HOME}/Bilder`;
      try {
        if (!vfs.exists(dir)) vfs.mkdir(dir);
        const target = path && !path.startsWith('/System') ? path : `${dir}/${vfs.unique(dir, 'Bild.jpg')}`;
        vfs.write(target, cv.toDataURL('image/jpeg', 0.86), 'image/jpeg');
        path = target;
        win.setTitle(`${basename(target)} – Malen`);
        sys.notify({ title: 'Bild gesichert', body: `${basename(target)} liegt in „Bilder“.`, app: 'paint', onClick: () => sys.open('files', { path: dir }) });
      } catch (err) {
        sys.notify({ title: 'Sichern fehlgeschlagen', body: err.message, icon: 'close', force: true });
      }
    };
    const download = () => {
      const a = h('a', { href: cv.toDataURL('image/png'), download: (path ? basename(path).replace(/\.\w+$/, '') : 'fableos-bild') + '.png' });
      a.click();
    };
    bSave.addEventListener('click', save);
    win.el.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? bRedo : bUndo).click(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });

    paintBtns();
    if (args.path) load(args.path);
    return {
      onArgs: (a) => { if (a.path) load(a.path); },
      menus: [{
        label: 'Bild',
        items: [
          { label: 'In „Bilder“ sichern', icon: 'download', hint: '⌘S', run: save },
          { label: 'Als PNG herunterladen', icon: 'external', run: download },
          '-',
          { label: 'Neues leeres Bild', icon: 'file', run: () => { snap(); blank(); path = null; win.setTitle('Malen'); } },
        ],
      }],
    };
  },
};
