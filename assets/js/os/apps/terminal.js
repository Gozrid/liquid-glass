// terminal.js — fsh, die fableOS-Shell: echte Befehle auf dem virtuellen Dateisystem

import { h, store, escapeHtml as esc, ticker, rand } from '../../core/util.js';
import { evaluate, formatNumber, looksLikeMath } from '../../core/calc.js';
import { sys, settings, set, apps, WALLPAPERS, ACCENTS, isImage } from '../sys.js';
import { vfs, HOME, normalize, pretty, formatSize } from '../vfs.js';

const HIST = 'fableos.term.history';
const pad = (s, n) => String(s).padEnd(n);
const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
const duration = (sec) => (sec < 60 ? `${sec} s` : sec < 3600 ? `${Math.floor(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`);

function browserName() {
  const ua = navigator.userAgent;
  const m = /(Edg|Firefox|Chrome)\/([\d]+)/.exec(ua) || /Version\/([\d]+).*(Safari)/.exec(ua);
  if (!m) return 'Browser';
  return m[1] === 'Edg' ? `Edge ${m[2]}` : m[2] === 'Safari' ? `Safari ${m[1]}` : `${m[1]} ${m[2]}`;
}

export default {
  id: 'terminal', name: 'Terminal', icon: 'terminal', colors: ['#4a5178', '#14162b'], keywords: 'konsole shell fsh cli',
  width: 720, height: 460, minW: 400, minH: 240,

  mount(win, args) {
    let cwd = args.path && vfs.isDir(args.path) ? args.path : HOME;
    let history = store.get(HIST, []);
    let hi = history.length;
    let capture = null;        // sammelt Ausgabe für Umleitungen (>, >>)
    let busy = null;           // laufender Vollbild-Effekt (matrix)

    const out = h('div.term-out');
    const prompt = h('span.term-prompt');
    const input = h('input.term-input', { type: 'text', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Befehl' });
    const pane = h('div.term.scroll.mono', out, h('div.term-line', prompt, input));
    win.body.append(pane);

    const paintPrompt = () => { prompt.innerHTML = `${span('t-ok', 'gast@fableos')} ${span('t-dir', pretty(cwd))} ›`; };
    const print = (html = '') => {
      if (capture) { capture.push(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")); return; }
      out.append(h('div', { html: html || '&nbsp;' }));
    };
    const text = (s = '', cls = '') => print(cls ? span(cls, s) : esc(s));
    const bottom = () => { pane.scrollTop = pane.scrollHeight; };
    const abs = (p) => normalize(p, cwd);
    const need = (v, usage) => { if (!v) throw new Error(`Aufruf: ${usage}`); return v; };

    // ---------- Befehle ----------
    const C = {
      hilfe: {
        d: 'Diese Übersicht',
        run() {
          const groups = [
            ['Dateien', ['ls', 'cd', 'pwd', 'cat', 'echo', 'touch', 'mkdir', 'rm', 'mv', 'cp', 'tree', 'find', 'grep']],
            ['System', ['open', 'apps', 'ps', 'kill', 'neofetch', 'uname', 'uptime', 'date', 'whoami', 'history', 'clear']],
            ['Aussehen', ['theme', 'wallpaper', 'akzent']],
            ['Sonstiges', ['calc', 'notify', 'say', 'matrix', 'fable', 'exit', 'reboot', 'shutdown']],
          ];
          for (const [title, names] of groups) {
            print(span('t-acc', title));
            for (const n of names) print(`  ${span('t-b', pad(n, 10))} ${span('t-dim', C[n].d)}`);
          }
          print(span('t-dim', 'Tab vervollständigt · ↑/↓ blättert im Verlauf · „befehl > datei“ leitet um'));
        },
      },
      ls: {
        d: 'Ordnerinhalt anzeigen (-l für Details)',
        run(a) {
          const long = a.includes('-l') || a.includes('-la');
          const target = abs(a.find((x) => !x.startsWith('-')) || '.');
          const st = vfs.stat(target);
          if (!st) throw new Error(`ls: ${target}: Nicht gefunden`);
          const list = st.type === 'dir' ? vfs.list(target) : [st];
          if (!list.length) { text('(leer)', 't-dim'); return; }
          if (long) {
            for (const s of list) {
              const date = new Date(s.mtime).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              print(`${span('t-dim', s.type === 'dir' ? 'd' : '-')} ${span('t-dim', formatSize(s.size).padStart(9))}  ${span('t-dim', date)}  ${s.type === 'dir' ? span('t-dir', `${s.name}/`) : esc(s.name)}`);
            }
          } else print(list.map((s) => (s.type === 'dir' ? span('t-dir', `${s.name}/`) : esc(s.name))).join('   '));
        },
      },
      cd: {
        d: 'Ordner wechseln',
        run(a) {
          const target = abs(a[0] || '~');
          if (!vfs.exists(target)) throw new Error(`cd: ${a[0]}: Nicht gefunden`);
          if (!vfs.isDir(target)) throw new Error(`cd: ${a[0]}: Kein Ordner`);
          cwd = target;
        },
      },
      pwd: { d: 'Aktuellen Pfad ausgeben', run() { text(cwd); } },
      cat: {
        d: 'Dateiinhalt ausgeben',
        run(a) {
          for (const f of a.length ? a : [need('', 'cat <datei>')]) {
            const p = abs(f);
            if (isImage(p, vfs.stat(p)?.mime)) { text(`[Bilddatei – ansehen mit: open ${f}]`, 't-dim'); continue; }
            for (const line of vfs.read(p).replace(/\n$/, '').split('\n')) text(line);
          }
        },
      },
      echo: { d: 'Text ausgeben', run(a) { text(a.join(' ')); } },
      touch: {
        d: 'Leere Datei anlegen',
        run(a) { for (const f of a.length ? a : [need('', 'touch <datei>')]) if (!vfs.exists(abs(f))) vfs.write(abs(f), ''); },
      },
      mkdir: { d: 'Ordner anlegen', run(a) { for (const f of a.length ? a : [need('', 'mkdir <ordner>')]) vfs.mkdir(abs(f)); } },
      rm: {
        d: 'Löschen (-r für Ordner)',
        run(a) {
          const rec = a.some((x) => /^-\w*r/.test(x));
          const targets = a.filter((x) => !x.startsWith('-'));
          need(targets[0], 'rm [-r] <pfad>');
          for (const f of targets) {
            const p = abs(f);
            if (p === '/') {
              document.body.classList.add('quake');
              setTimeout(() => document.body.classList.remove('quake'), 900);
              throw new Error('rm: Netter Versuch. Die Wurzel bleibt.');
            }
            if (vfs.isDir(p) && !rec) throw new Error(`rm: ${f}: Ist ein Ordner (nutze -r)`);
            vfs.remove(p);
          }
        },
      },
      mv: { d: 'Verschieben oder umbenennen', run(a) { need(a[1], 'mv <quelle> <ziel>'); vfs.move(abs(a[0]), abs(a[1])); } },
      cp: { d: 'Kopieren', run(a) { need(a[1], 'cp <quelle> <ziel>'); vfs.copy(abs(a[0]), abs(a[1])); } },
      tree: {
        d: 'Ordnerbaum zeichnen',
        run(a) {
          const start = abs(a[0] || '.');
          if (!vfs.isDir(start)) throw new Error(`tree: ${a[0]}: Kein Ordner`);
          print(span('t-dir', pretty(start)));
          let count = 0;
          const walk = (path, prefix, depth) => {
            const list = vfs.list(path);
            list.forEach((s, i) => {
              if (++count > 200) return;
              const last = i === list.length - 1;
              print(`${span('t-dim', prefix + (last ? '└── ' : '├── '))}${s.type === 'dir' ? span('t-dir', s.name) : esc(s.name)}`);
              if (s.type === 'dir' && depth < 5) walk(s.path, prefix + (last ? '    ' : '│   '), depth + 1);
            });
          };
          walk(start, '', 0);
        },
      },
      find: {
        d: 'Dateien nach Namen suchen',
        run(a) {
          const res = vfs.find(need(a[0], 'find <suchtext>'), cwd);
          if (!res.length) text('Nichts gefunden.', 't-dim');
          for (const p of res) text(pretty(p));
        },
      },
      grep: {
        d: 'Zeilen suchen: grep <muster> <datei>',
        run(a) {
          need(a[1], 'grep <muster> <datei>');
          const q = a[0].toLowerCase();
          let hits = 0;
          vfs.read(abs(a[1])).split('\n').forEach((line, i) => {
            const at = line.toLowerCase().indexOf(q);
            if (at < 0) return;
            hits++;
            print(`${span('t-dim', `${i + 1}:`)} ${esc(line.slice(0, at))}${span('t-acc', line.slice(at, at + q.length))}${esc(line.slice(at + q.length))}`);
          });
          if (!hits) text('Keine Treffer.', 't-dim');
        },
      },
      open: {
        d: 'App oder Datei öffnen',
        run(a) {
          const t = need(a.join(' '), 'open <app|datei>');
          const app = [...apps.values()].find((x) => x.id === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase());
          if (app) { sys.open(app.id); return; }
          if (!vfs.exists(abs(t))) throw new Error(`open: ${t}: Weder App noch Datei`);
          sys.openPath(abs(t));
        },
      },
      apps: { d: 'Installierte Apps auflisten', run() { for (const a of apps.values()) print(`${span('t-b', pad(a.id, 10))} ${esc(a.name)}`); } },
      ps: {
        d: 'Laufende Fenster',
        run() {
          print(span('t-dim', `${pad('PID', 6)}${pad('APP', 14)}${pad('LAUFZEIT', 11)}TITEL`));
          for (const w of sys.wm.wins) print(`${pad(w.id, 6)}${pad(w.app.name, 14)}${pad(duration(Math.round((Date.now() - w.started) / 1000)), 11)}${esc(w.title)}`);
        },
      },
      kill: {
        d: 'Fenster beenden: kill <pid|app>',
        run(a) {
          const t = need(a[0], 'kill <pid|app>').toLowerCase();
          const hit = sys.wm.wins.filter((w) => String(w.id) === t || w.app.id === t);
          if (!hit.length) throw new Error(`kill: ${t}: Kein solcher Prozess`);
          hit.forEach((w) => w.close());
          text(`${hit.length} Fenster beendet.`, 't-dim');
        },
      },
      clear: { d: 'Bildschirm leeren', run() { out.replaceChildren(); } },
      history: { d: 'Befehlsverlauf', run() { history.forEach((c, i) => print(`${span('t-dim', String(i + 1).padStart(4))}  ${esc(c)}`)); } },
      date: { d: 'Datum und Uhrzeit', run() { text(new Date().toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'medium' })); } },
      whoami: { d: 'Wer bin ich?', run() { text('gast'); } },
      uname: { d: 'Systemname', run(a) { text(a.includes('-a') ? `fableOS 5.2 LiquidGlass ${browserName()} ${navigator.language}` : 'fableOS'); } },
      uptime: { d: 'Laufzeit seit dem Start', run() { text(`Läuft seit ${duration(sys.uptime())}, ${sys.wm.wins.length} Fenster offen.`); } },
      neofetch: {
        d: 'Systemübersicht',
        run() {
          const art = ['      ▟▙      ', '     ▟██▙     ', '    ▟████▙    ', '   ▟██████▙   ', '   ████████   ', '   ▜██████▛   ', '    ▜████▛    ', '      ▀▀      '];
          const tones = ['#ffc078', '#ffa46f', '#ff7d6b', '#ff5d6c', '#d75fb0', '#a06bff', '#6f9bff', '#45c8ff'];
          const accent = ACCENTS.find(([, c]) => c === settings.accent)?.[0] || settings.accent;
          const info = [
            `${span('t-ok', 'gast')}@${span('t-ok', 'fableos')}`,
            span('t-dim', '────────────'),
            `${span('t-acc', 'System  ')} fableOS 5.2 „Liquid Glass“`,
            `${span('t-acc', 'Kernel  ')} ${esc(browserName())}`,
            `${span('t-acc', 'Shell   ')} fsh 1.0`,
            `${span('t-acc', 'Anzeige ')} ${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
            `${span('t-acc', 'Speicher')} ${formatSize(vfs.usage())} belegt`,
            `${span('t-acc', 'Design  ')} ${settings.theme === 'dark' ? 'Dunkel' : 'Hell'} · ${esc(accent)}`,
          ];
          art.forEach((line, i) => print(`<span style="color:${tones[i]}">${line}</span>  ${info[i] || ''}`));
        },
      },
      theme: {
        d: 'Design: theme hell|dunkel',
        run(a) {
          const m = { hell: 'light', light: 'light', dunkel: 'dark', dark: 'dark' }[(a[0] || '').toLowerCase()];
          if (!m) throw new Error('Aufruf: theme hell|dunkel');
          set('theme', m);
        },
      },
      wallpaper: {
        d: 'Hintergrund wechseln',
        run(a) {
          const keys = Object.keys(WALLPAPERS);
          const k = keys.find((x) => x === (a[0] || '').toLowerCase() || WALLPAPERS[x].name.toLowerCase() === (a[0] || '').toLowerCase());
          if (!k) { text(`Verfügbar: ${keys.join(', ')}`); return; }
          set('wallpaper', k);
        },
      },
      akzent: {
        d: 'Akzentfarbe: akzent <name|#hex>',
        run(a) {
          const v = (a[0] || '').toLowerCase();
          const hit = ACCENTS.find(([n]) => n.toLowerCase() === v);
          if (hit) set('accent', hit[1]);
          else if (/^#[0-9a-f]{6}$/.test(v)) set('accent', v);
          else text(`Verfügbar: ${ACCENTS.map(([n]) => n.toLowerCase()).join(', ')} – oder #rrggbb`);
        },
      },
      calc: { d: 'Rechnen: calc 2^10 + sqrt(2)', run(a) { text(`= ${formatNumber(evaluate(need(a.join(' '), 'calc <ausdruck>')))}`); } },
      notify: { d: 'Mitteilung senden', run(a) { sys.notify({ title: 'Terminal', body: need(a.join(' '), 'notify <text>'), app: 'terminal', force: true }); } },
      say: {
        d: 'Text vorlesen lassen',
        run(a) {
          const t = need(a.join(' '), 'say <text>');
          if (!('speechSynthesis' in window)) throw new Error('say: Sprachausgabe wird von diesem Browser nicht unterstützt');
          const u = new SpeechSynthesisUtterance(t);
          u.lang = 'de-DE';
          speechSynthesis.speak(u);
        },
      },
      matrix: { d: 'Digitaler Regen (beliebige Taste beendet)', run() { matrix(); } },
      fable: {
        d: 'Wer hat das hier gebaut?',
        run() {
          text('Claude Fable 5.2 von Anthropic.', 't-acc');
          text('Dieses System, jede App darin und die Shell, in der du gerade tippst,');
          text('sind in einer einzigen Sitzung in Claude Code entstanden – als Code, ohne Bilder.');
        },
      },
      sudo: { d: '', run() { text('In fableOS sind alle gleich – und alle Gast.', 't-dim'); } },
      exit: { d: 'Terminal schließen', run() { win.close(); } },
      reboot: { d: 'Neu starten', run() { location.reload(); } },
      shutdown: { d: 'Ausschalten (zurück zur Website)', run() { location.href = 'index.html'; } },
    };
    C.help = C.hilfe;

    // ---------- Digitaler Regen ----------
    function matrix() {
      const cv = h('canvas.term-fx');
      win.body.append(cv);
      const ctx = cv.getContext('2d');
      const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789';
      let cols = [];
      const size = () => {
        cv.width = win.body.clientWidth;
        cv.height = win.body.clientHeight;
        cols = Array.from({ length: Math.ceil(cv.width / 14) }, () => rand(-40, 0));
        ctx.fillStyle = '#04060f';
        ctx.fillRect(0, 0, cv.width, cv.height);
      };
      size();
      let acc = 0;
      const frame = (dt) => {
        acc += dt;
        if (acc < 0.045) return;
        acc = 0;
        if (cv.width !== win.body.clientWidth) size();
        ctx.fillStyle = 'rgba(4,6,15,.14)';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.font = '14px ui-monospace, Menlo, monospace';
        cols.forEach((y, i) => {
          ctx.fillStyle = Math.random() < 0.08 ? '#eafff6' : '#3fe0b0';
          ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * 14, y * 16);
          cols[i] = y * 16 > cv.height && Math.random() > 0.975 ? 0 : y + 1;
        });
      };
      ticker.add(frame);
      busy = () => {
        ticker.remove(frame);
        cv.remove();
        busy = null;
        text('Der Regen hört auf.', 't-dim');
        bottom();
        input.focus();
      };
    }

    // ---------- Ausführen ----------
    const exec = (line) => {
      print(`${prompt.innerHTML} ${esc(line)}`);
      const raw = line.trim();
      if (!raw) return;
      if (history[history.length - 1] !== raw) history.push(raw);
      history = history.slice(-120);
      store.set(HIST, history);
      hi = history.length;

      const tokens = (raw.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => (/^(["']).*\1$/.test(t) ? t.slice(1, -1) : t));
      let redirect = null;
      const ri = tokens.findIndex((t) => t === '>' || t === '>>');
      if (ri >= 0) {
        redirect = { append: tokens[ri] === '>>', file: tokens[ri + 1] };
        tokens.length = ri;
      }
      const [name, ...rest] = tokens;
      const cmd = Object.hasOwn(C, name.toLowerCase()) ? C[name.toLowerCase()] : null;
      try {
        if (redirect) {
          if (!redirect.file) throw new Error('Umleitung: Zieldatei fehlt');
          capture = [];
        }
        if (cmd) cmd.run(rest);
        else if (looksLikeMath(raw)) text(`= ${formatNumber(evaluate(raw))}`);
        else throw new Error(`fsh: Befehl nicht gefunden: ${name} – tippe „hilfe“`);
        if (redirect) {
          const data = `${capture.join('\n')}\n`;
          const target = abs(redirect.file);
          capture = null;
          vfs.write(target, redirect.append && vfs.exists(target) ? vfs.read(target) + data : data);
        }
      } catch (err) {
        capture = null;
        text(err.message, 't-err');
      }
      capture = null;
      paintPrompt();
    };

    // ---------- Tab-Vervollständigung ----------
    const complete = () => {
      const v = input.value;
      const m = /("[^"]*|\S*)$/.exec(v);
      const quoted = m[1].startsWith('"');
      const frag = quoted ? m[1].slice(1) : m[1];
      const head = v.slice(0, v.length - m[1].length);
      let cands;
      let dirPart = '';
      if (!head.trim()) cands = Object.keys(C).filter((c) => c.startsWith(frag.toLowerCase()) && C[c].d).map((c) => ({ name: c, dir: false }));
      else {
        const slash = frag.lastIndexOf('/');
        dirPart = slash >= 0 ? frag.slice(0, slash + 1) : '';
        const part = frag.slice(slash + 1).toLowerCase();
        try {
          cands = vfs.list(abs(dirPart || '.')).filter((s) => s.name.toLowerCase().startsWith(part)).map((s) => ({ name: s.name, dir: s.type === 'dir' }));
        } catch { return; }
      }
      if (!cands.length) return;
      const wrap = (s, done) => (s.includes(' ') || quoted ? `"${s}${done ? '"' : ''}` : s);
      if (cands.length === 1) {
        const c = cands[0];
        input.value = head + (c.dir ? wrap(`${dirPart}${c.name}/`, false) : `${wrap(dirPart + c.name, true)} `);
        return;
      }
      let common = cands[0].name;
      for (const c of cands) while (!c.name.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
      if (common.length > frag.length - dirPart.length) input.value = head + wrap(dirPart + common, false);
      print(`${prompt.innerHTML} ${esc(v)}`);
      print(cands.map((c) => (c.dir ? span('t-dir', `${c.name}/`) : esc(c.name))).join('   '));
      bottom();
    };

    input.addEventListener('keydown', (e) => {
      if (busy) { e.preventDefault(); busy(); return; }
      if (e.key === 'Enter') {
        const line = input.value;
        input.value = '';
        exec(line);
        bottom();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (hi > 0) input.value = history[--hi];
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        hi = Math.min(history.length, hi + 1);
        input.value = history[hi] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        complete();
      } else if (e.key.toLowerCase() === 'l' && e.ctrlKey) {
        e.preventDefault();
        out.replaceChildren();
      } else if (e.key.toLowerCase() === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
        print(`${prompt.innerHTML} ${esc(input.value)}^C`);
        input.value = '';
        bottom();
      }
    });
    pane.addEventListener('pointerup', () => {
      if (busy) { busy(); return; }
      if (!window.getSelection()?.toString()) input.focus({ preventScroll: true });
    });

    paintPrompt();
    print(`${span('t-acc', 'fableOS Terminal')} ${span('t-dim', '· fsh 1.0')}`);
    print(span('t-dim', 'Tippe „hilfe“ für alle Befehle, „neofetch“ für den Überblick.'));
    print();
    if (args.cmd) { exec(args.cmd); bottom(); }
    setTimeout(() => input.focus({ preventScroll: true }), 60);

    return {
      onFocus: () => { if (!busy) input.focus({ preventScroll: true }); },
      onClose: () => busy?.(),
      menus: [{
        label: 'Shell',
        items: [
          { label: 'Leeren', hint: '⌃L', run: () => out.replaceChildren() },
          { label: 'Systemübersicht', run: () => { exec('neofetch'); bottom(); } },
          { label: 'Hilfe anzeigen', run: () => { exec('hilfe'); bottom(); } },
        ],
      }],
    };
  },
};
