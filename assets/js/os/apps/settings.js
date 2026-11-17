// settings.js — Systemeinstellungen: Allgemein, Erscheinungsbild, Hintergrund, Schreibtisch & Dock,
// Bildschirmschoner, Mitteilungen & Ton, Sperrbildschirm, Apps, Fable

import { h } from '../../core/util.js';
import { icon, LOGO } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, settings, set, apps, appIcon, isImage, WALLPAPERS, ACCENTS, DEFAULTS } from '../sys.js';
import { registry } from '../registry.js';
import { vfs, HOME, formatSize, basename } from '../vfs.js';
import { sheet, confirmSheet, openDialog, importFiles, download, toast } from '../kit.js';
import { CORNER_ACTIONS } from '../shell/saver.js';
import { removeApp } from '../shell/launchpad.js';

/** [id, Name, Symbol, Suchbegriffe] – die Suche (Spotlight) springt direkt in diese Bereiche. */
export const PANES = [
  ['general', 'Allgemein', 'gear', 'über version update softwareupdate speicher sicherung backup zurücksetzen installieren app pwa offline'],
  ['look', 'Erscheinungsbild', 'sun', 'design dunkel hell automatisch akzent farbe nachtlicht'],
  ['wall', 'Hintergrund', 'image', 'wallpaper bild live eigenes foto'],
  ['desk', 'Schreibtisch & Dock', 'layers', 'dock lupe glas unschärfe deckkraft aktive ecken widgets'],
  ['saver', 'Bildschirmschoner', 'moon', 'ruhezustand leerlauf strömung'],
  ['notify', 'Mitteilungen & Ton', 'bell', 'nicht stören lautstärke töne systemton fokus'],
  ['lock', 'Sperrbildschirm', 'lock', 'passwort benutzer name anmeldung sperren'],
  ['apps', 'Apps', 'grid', 'installiert entfernen öffnen mit standard store'],
  ['fable', 'Fable', 'sparkles', 'assistent sprache stimme vorlesen'],
];

function browserName() {
  const ua = navigator.userAgent;
  const m = /(Edg|Firefox|Chrome)\/([\d]+)/.exec(ua) || /Version\/([\d]+).*(Safari)/.exec(ua);
  if (!m) return 'Browser';
  return m[1] === 'Edg' ? `Edge ${m[2]}` : m[2] === 'Safari' ? `Safari ${m[1]}` : `${m[1]} ${m[2]}`;
}

export default {
  id: 'settings', name: 'Einstellungen', icon: 'gear', colors: ['#b1b9cf', '#596280'], keywords: 'einstellungen optionen design hintergrund system',
  singleton: true, width: 780, height: 540, minW: 520, minH: 380,

  mount(win, args) {
    let tab = PANES.some(([id]) => id === args.tab) ? args.tab : 'general';
    const side = h('nav.set-side.scroll');
    const panel = h('div.set-panel.scroll');
    win.body.append(h('div.set', side, panel));

    const row = (label, sub, control) => h('div.set-row', h('div', h('b', label), sub ? h('small', sub) : null), control);
    const sw = (key, onChange) => {
      const b = h('button.gswitch', { type: 'button', 'aria-checked': String(!!settings[key]), 'aria-label': key });
      b.addEventListener('change', (e) => { set(key, e.detail.checked); onChange?.(e.detail.checked); });
      return b;
    };
    const slider = (key, min, max, step, fmt) => {
      const out = h('output', fmt(settings[key]));
      const s = h('div.gslider', { dataset: { min, max, step, value: settings[key] }, 'aria-label': key });
      s.addEventListener('input', (e) => { set(key, e.detail.value); out.textContent = fmt(e.detail.value); });
      return h('div.set-slider', s, out);
    };
    const select = (value, options, onChange, label) => {
      const s = h('select.kit-field', { 'aria-label': label }, options.map(([v, name]) => h('option', { value: v, selected: String(v) === String(value) }, name)));
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const button = (label, fn, cls = '') => h(`button.kit-btn${cls}`, { type: 'button', onclick: fn }, label);
    const danger = (label, confirm, fn) => {
      const b = h('button.kit-btn', { type: 'button' }, label);
      let armed = false;
      b.addEventListener('click', () => {
        if (!armed) { armed = true; b.textContent = confirm; b.classList.add('danger'); setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('danger'); }, 3000); return; }
        fn();
      });
      return b;
    };

    // ---------- Sicherung ----------
    const exportBackup = () => {
      const local = {};
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('fableos.')) local[k] = localStorage.getItem(k); } catch { /* ohne localStorage */ }
      const data = { app: 'fableOS', version: sys.version, date: new Date().toISOString(), fs: vfs.dump(), local };
      download(`fableOS-Sicherung-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
      toast(win, 'Sicherung wurde geladen');
    };
    const importBackup = async () => {
      const [file] = await importFiles({ accept: '.json,application/json', as: 'text' });
      if (!file) return;
      let data;
      try { data = JSON.parse(file.data); } catch { data = null; }
      if (data?.app !== 'fableOS' || data.fs?.t !== 'd') { sys.notify({ title: 'Keine fableOS-Sicherung', body: file.name, icon: 'close', force: true }); return; }
      const yes = await confirmSheet(win, {
        title: 'Sicherung einspielen?', ok: 'Einspielen', danger: true,
        text: `Stand vom ${new Date(data.date).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })}. Alle jetzigen Dateien, Einstellungen und App-Daten werden ersetzt; danach startet fableOS neu.`,
      });
      if (!yes) return;
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('fableos.')) localStorage.removeItem(k);
        for (const [k, v] of Object.entries(data.local || {})) if (k.startsWith('fableos.') && typeof v === 'string') localStorage.setItem(k, v);
      } catch { /* ohne localStorage */ }
      await vfs.restore(data.fs);
      setTimeout(() => location.reload(), 300);
    };
    const wipe = async () => {
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('fableos.')) localStorage.removeItem(k); } catch { /* egal */ }
      sys.wm.ready = false;        // die Sitzung nicht noch einmal sichern
      await vfs.destroy();
      try { sessionStorage.clear(); } catch { /* egal */ }
      location.replace(location.pathname);
    };

    // ---------- Passwort ----------
    const setPassword = async () => {
      const a = h('input.kit-field', { type: 'password', placeholder: 'Neues Passwort', autocomplete: 'new-password', 'aria-label': 'Neues Passwort', 'data-autofocus': '' });
      const b = h('input.kit-field', { type: 'password', placeholder: 'Wiederholen', autocomplete: 'new-password', 'aria-label': 'Passwort wiederholen' });
      const note = h('p.kit-sheet-text', 'Schützt vor neugierigen Blicken. Die Daten selbst werden dadurch nicht verschlüsselt.');
      const ok = await sheet(win, {
        title: settings.pass ? 'Passwort ändern' : 'Passwort festlegen', body: h('div', { style: { display: 'grid', gap: '8px' } }, a, b, note),
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Sichern', value: () => (a.value && a.value === b.value ? a.value : ''), primary: true }],
      });
      if (ok === false || ok === null) return;
      if (!ok) { toast(win, 'Die Passwörter stimmen nicht überein'); return; }
      set('pass', await sys.passHash(ok));
      toast(win, 'Passwort ist gesetzt');
      render();
    };

    const panels = {
      general: () => {
        const pwa = sys.pwa;
        const used = vfs.usage();
        const meter = h('div.set-meter', h('i', { style: { width: '2%' } }));
        const quotaTxt = h('small', `${formatSize(used)} in Dateien belegt.`);
        navigator.storage?.estimate?.().then((e) => {
          if (!e?.quota) return;
          quotaTxt.textContent = `${formatSize(used)} in Dateien belegt · der Browser stellt rund ${formatSize(e.quota)} bereit.`;
          meter.firstChild.style.width = `${Math.max(2, Math.min(100, ((e.usage || used) / e.quota) * 100)).toFixed(1)}%`;
        }).catch(() => {});
        const persistBtn = button('Dauerhaft sichern', async () => {
          const ok = await navigator.storage?.persist?.();
          toast(win, ok ? 'Der Browser bewahrt die Daten dauerhaft auf' : 'Der Browser hat das abgelehnt – als installierte App klappt es meist');
        });
        const upd = h('small', pwa?.statusText() || 'Offline-Modus wird in diesem Browser nicht unterstützt.');
        const bCheck = button(pwa?.state.updateReady ? 'Jetzt neu starten' : 'Nach Updates suchen', async () => {
          if (pwa?.state.updateReady) { sys.power.restart(); return; }
          bCheck.disabled = true;
          upd.textContent = 'Suche nach Updates …';
          const res = await pwa?.check();
          bCheck.disabled = false;
          upd.textContent = pwa?.statusText() || '';
          if (res === 'update') { bCheck.textContent = 'Jetzt neu starten'; bCheck.classList.add('primary'); }
          else toast(win, res === 'current' ? 'fableOS ist auf dem neuesten Stand' : 'Die Suche war gerade nicht möglich');
        }, pwa?.state.updateReady ? '.primary' : '');
        bCheck.disabled = !pwa?.state.supported;
        return [
          h('div.set-hero', h('span.set-logo', { html: LOGO }),
            h('div', h('h2', 'fableOS'), h('p', `Version ${sys.version} „Liquid Glass“ · Build ${sys.build}`), h('p', `${browserName()} · ${innerWidth} × ${innerHeight} @${devicePixelRatio}x · ${navigator.language}`))),
          row('Als App installieren', pwa?.state.standalone ? 'fableOS läuft gerade als installierte App – mit eigenem Fenster und Symbol.' : 'Eigenes Fenster, eigenes Symbol im Dock oder auf dem Home-Bildschirm, startet auch ohne Netz.',
            pwa?.state.standalone ? h('span.kit-chip.is-on', 'Installiert') : button('Installieren …', () => pwa?.install(), '.primary')),
          h('div.set-row', h('div', h('b', 'Softwareupdate'), upd), bCheck),
          h('div.set-row', h('div', h('b', 'Speicher'), quotaTxt), h('div.set-stack', meter, persistBtn)),
          row('Sicherung', 'Dateien, Einstellungen und App-Daten als eine Datei auf dieses Gerät laden – oder eine Sicherung einspielen.',
            h('div.set-stack', button('Exportieren', exportBackup), button('Einspielen …', importBackup))),
          row('Fenster wiederherstellen', 'Beim nächsten Start öffnen sich die Fenster der letzten Sitzung.', sw('restore')),
          h('h3', 'Zurücksetzen'),
          row('Dateisystem zurücksetzen', 'Stellt die ursprünglichen Dateien wieder her. Eigene Dateien gehen verloren.',
            danger('Zurücksetzen', 'Wirklich löschen?', () => { vfs.reset(); sys.notify({ title: 'Dateisystem zurückgesetzt', body: 'Alles ist wieder wie am ersten Tag.', app: 'settings', force: true }); render(); })),
          row('Einstellungen zurücksetzen', 'Design, Hintergrund und Regler auf Werkseinstellung.',
            danger('Zurücksetzen', 'Wirklich zurücksetzen?', () => { for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'firstRun' && k !== 'pass') set(k, v); render(); })),
          row('Alle Inhalte & Einstellungen löschen', 'Dateien, Apps, Einstellungen – alles weg, fableOS startet wie neu.',
            danger('Alles löschen', 'Endgültig löschen?', wipe)),
          h('p.set-note', 'Gespeichert wird ausschließlich in diesem Browser (IndexedDB und localStorage) – nichts verlässt dein Gerät.'),
        ];
      },

      look: () => [
        h('h2', 'Erscheinungsbild'),
        h('div.set-themes', ...[['light', 'Hell'], ['dark', 'Dunkel'], ['auto', 'Automatisch']].map(([mode, name]) => {
          const on = mode === 'auto' ? settings.autoTheme : !settings.autoTheme && settings.theme === mode;
          return h('button', {
            type: 'button', class: `theme-card t-${mode}${on ? ' is-on' : ''}`,
            onclick: () => { if (mode === 'auto') set('autoTheme', true); else { set('autoTheme', false); set('theme', mode); } render(); },
          }, h('span.theme-prev', h('i'), h('i'), h('i')), h('b', name));
        })),
        h('p.set-note', '„Automatisch“ folgt deinem Gerät: hell am Tag, dunkel in der Nacht.'),
        h('h3', 'Akzentfarbe'),
        h('div.set-swatches',
          ...ACCENTS.map(([name, col]) => h('button', {
            type: 'button', title: name, 'aria-label': name, class: settings.accent === col ? 'is-on' : '',
            style: { '--c': col }, onclick: () => set('accent', col),
          })),
          h('label.set-custom', { title: 'Eigene Farbe' }, h('input', { type: 'color', value: settings.accent, oninput: (e) => set('accent', e.target.value) }))),
        row('Nachtlicht', 'Wärmere Farben am Abend – angenehmer für die Augen.', sw('nightShift')),
        row('Helligkeit', null, slider('brightness', 0.35, 1, 0.01, (v) => `${Math.round(v * 100)} %`)),
      ],

      wall: () => {
        const own = settings.wallImage && vfs.exists(settings.wallImage) ? settings.wallImage : '';
        const pick = async () => {
          const p = await openDialog(win, { title: 'Hintergrundbild wählen', dir: `${HOME}/Bilder`, filter: (st) => isImage(st.path, st.mime), ok: 'Verwenden' });
          if (p) { sys.setWallpaperImage(p); render(); }
        };
        const fromDevice = async () => {
          const [img] = await importFiles({ accept: 'image/*' });
          if (!img) return;
          try {
            const dir = `${HOME}/Bilder`;
            const path = `${dir}/${vfs.unique(dir, img.name.replace(/[/\\]/g, '-').slice(0, 80))}`;
            vfs.write(path, img.data, img.type || 'image/jpeg');
            sys.setWallpaperImage(path);
            render();
          } catch (err) { sys.notify({ title: 'Das hat nicht geklappt', body: err.message, icon: 'close', force: true }); }
        };
        return [
          h('h2', 'Hintergrund'),
          h('div.set-walls', ...Object.entries(WALLPAPERS).map(([key, w]) =>
            h('button', { type: 'button', class: !own && settings.wallpaper === key ? 'is-on' : '', onclick: () => { set('wallImage', ''); set('wallpaper', key); render(); } },
              h('span', { style: { background: w.css } }), h('b', w.name)))),
          row('Eigenes Bild', own ? `Aktiv: ${basename(own)}` : 'Ein Foto aus „Bilder“ oder von diesem Gerät als Hintergrund.',
            h('div.set-stack', button('Aus Bilder …', pick), button('Vom Gerät …', fromDevice), own ? button('Entfernen', () => { set('wallImage', ''); render(); }) : null)),
          row('Live-Hintergrund', 'Der Hintergrund wird als Shader berechnet und bewegt sich langsam. Aus spart Energie.', sw('animate')),
        ];
      },

      desk: () => [
        h('h2', 'Schreibtisch & Dock'),
        h('h3', 'Dock'),
        row('Größe', null, slider('dockSize', 38, 72, 1, (v) => `${v} px`)),
        row('Lupe', 'Vergrößerung der Symbole unter dem Zeiger.', slider('dockMag', 1, 2.1, 0.01, (v) => `${v.toFixed(2)}×`)),
        row('Symbole im Dock', 'Zieh Symbole im Dock, um sie zu ordnen – nach oben herausgezogen verschwinden sie.', button('Standard wiederherstellen', () => { registry.resetPins(); toast(win, 'Dock ist wieder wie am Anfang'); })),
        h('h3', 'Glas'),
        row('Unschärfe', 'Wie stark das Glas den Hintergrund weichzeichnet.', slider('blur', 0, 44, 1, (v) => `${v} px`)),
        row('Fensterdeckkraft', 'Niedrig = durchsichtiger, hoch = besser lesbar.', slider('opacity', 0.2, 0.95, 0.01, (v) => `${Math.round(v * 100)} %`)),
        h('h3', 'Aktive Ecken'),
        h('div.set-corners', ...[['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts']].map(([k, name]) =>
          h('label', h('span', name), select(settings.corners[k], CORNER_ACTIONS, (v) => set('corners', { ...settings.corners, [k]: v }), name)))),
        h('p.set-note', 'Fährt der Zeiger in eine Ecke des Bildschirms, löst fableOS die gewählte Aktion aus.'),
        h('h3', 'Widgets'),
        row('Widgets auf dem Schreibtisch', `${settings.widgets.length} aktiv – System und installierte Apps bringen eigene mit.`, button('Bearbeiten …', () => sys.editWidgets())),
      ],

      saver: () => [
        h('h2', 'Bildschirmschoner'),
        h('div.set-saver', h('span'), h('b', 'Strömung'), h('small', 'Leuchtende Bahnen folgen einem unsichtbaren Feld – dazu Uhrzeit und Datum.')),
        row('Starten nach', 'Leerlauf ohne Maus und Tastatur. Läuft Musik, bleibt der Bildschirm wach.',
          select(settings.saverAfter, [[0, 'Nie'], [1, '1 Minute'], [2, '2 Minuten'], [5, '5 Minuten'], [10, '10 Minuten'], [30, '30 Minuten']], (v) => set('saverAfter', Number(v)), 'Starten nach')),
        row('Beim Aufwachen sperren', settings.pass ? 'Nach dem Bildschirmschoner ist das Passwort nötig.' : 'Lege zuerst unter „Sperrbildschirm“ ein Passwort fest.', sw('saverLock')),
        row('Ausprobieren', null, button('Vorschau', () => sys.saver?.start())),
      ],

      notify: () => [
        h('h2', 'Mitteilungen & Ton'),
        row('Nicht stören', 'Mitteilungen werden gesammelt, aber nicht eingeblendet.', sw('dnd')),
        row('Auch als System-Mitteilung', 'Ist fableOS im Hintergrund, erscheinen Mitteilungen zusätzlich über dein Betriebssystem.',
          sw('sysNotes', async (on) => {
            if (!on) return;
            const perm = window.Notification ? await Notification.requestPermission() : 'denied';
            if (perm !== 'granted') { set('sysNotes', false); toast(win, 'Der Browser erlaubt keine System-Mitteilungen'); render(); }
          })),
        row('Ausprobieren', null, button('Mitteilung senden', () => sys.notify({ title: 'Testmitteilung', body: 'So klingt und so sieht das aus.', app: 'settings', force: true }))),
        h('h3', 'Ton'),
        row('Systemtöne', 'Leise, synthetisierte Klänge für Fenster und Mitteilungen.', sw('sounds', () => sfx.pop())),
        row('Startklang', 'Der Akkord beim Entsperren.', sw('startSound')),
        row('Lautstärke', null, slider('volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`)),
      ],

      lock: () => {
        const name = h('input.set-input', { type: 'text', value: settings.user, maxLength: 24, 'aria-label': 'Benutzername' });
        name.addEventListener('change', () => set('user', name.value.trim() || 'Gast'));
        const note = h('input.set-input', { type: 'text', value: settings.lockNote, maxLength: 80, placeholder: 'z. B. „Gehört Fable“', 'aria-label': 'Hinweis auf dem Sperrbildschirm' });
        note.addEventListener('change', () => set('lockNote', note.value.trim()));
        return [
          h('h2', 'Sperrbildschirm'),
          row('Benutzername', 'Erscheint auf dem Sperrbildschirm und in Begrüßungen.', name),
          row('Passwort', settings.pass ? 'Zum Entsperren ist ein Passwort nötig.' : 'Ohne Passwort entsperrt ein Klick oder Tastendruck.',
            h('div.set-stack', button(settings.pass ? 'Ändern …' : 'Festlegen …', setPassword),
              settings.pass ? button('Entfernen', () => { set('pass', ''); set('saverLock', false); render(); }) : null)),
          row('Hinweis', 'Eine Zeile Text unter der Uhr.', note),
          row('Jetzt sperren', 'Kürzel: ⌃⌥L', button('Sperren', () => sys.power.lock())),
        ];
      },

      apps: () => {
        const installed = [...apps.values()].filter((a) => registry.isRemovable(a.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
        const openWith = Object.entries(settings.openWith || {}).filter(([, id]) => apps.has(id));
        return [
          h('h2', 'Apps'),
          row('App Store', `${registry.catalog.length} Apps im Katalog, ${installed.length} davon installiert.`, button('App Store öffnen', () => sys.open('store'), '.primary')),
          h('h3', 'Installiert'),
          installed.length ? h('div.set-apps', installed.map((a) => {
            const inf = registry.info(a.id);
            return h('div.set-app', appIcon(a, 'sm'),
              h('div', h('b', a.name), h('small', a.webApp ? a.tagline : `Version ${inf?.v || a.version || '1.0'}${inf?.size ? ` · ${formatSize(inf.size)}` : ''}${inf?.pre ? ' · mitgeliefert' : ''}`)),
              button('Öffnen', () => sys.open(a.id)), button('Entfernen', async () => { if (await removeApp(a.id)) render(); }));
          })) : h('p.set-note', 'Noch keine Apps aus dem Store installiert.'),
          h('h3', 'Standard-Apps'),
          openWith.length ? h('div.set-apps', openWith.map(([ext, id]) => h('div.set-app', appIcon(apps.get(id), 'sm'), h('div', h('b', `.${ext}`), h('small', `öffnet mit ${apps.get(id).name}`)),
            button('Zurücksetzen', () => { const next = { ...settings.openWith }; delete next[ext]; set('openWith', next); render(); }))))
            : h('p.set-note', 'Bilder öffnen in Fotos, Texte in Notizen, Quelltext in Code – sofern installiert. Über „Öffnen mit“ im Kontextmenü einer Datei geht jede passende App.'),
        ];
      },

      fable: () => [
        h('h2', 'Fable'),
        h('p.set-note', 'Fable ist der Assistent von fableOS: Er öffnet und installiert Apps, stellt Design und Lautstärke ein, rechnet, stellt Timer und schreibt Notizen. Er versteht feste Befehle und arbeitet komplett auf diesem Gerät.'),
        row('Antworten vorlesen', 'Nutzt die Sprachausgabe deines Browsers.', sw('voice')),
        row('Fable öffnen', 'Kürzel: ⌥ Leertaste – oder das Funkeln oben rechts.', button('Fragen …', () => sys.assistant?.open(), '.primary')),
        h('h3', 'Das versteht Fable zum Beispiel'),
        h('ul.set-list', ['„Öffne das Terminal“', '„Installiere Schach“', '„Dunkles Design“ · „Akzentfarbe Violett“', '„Timer 5 Minuten“ · „Erinnere mich in 10 Minuten an den Tee“', '„Notiz: Milch kaufen“', '„Was ist 12 × 7?“ · „Wie spät ist es?“', '„Lautstärke 40“ · „Heller“ · „Nicht stören“'].map((t) => h('li', t))),
      ],
    };

    function render() {
      side.replaceChildren(...PANES.map(([id, name, ic]) =>
        h('button', { type: 'button', class: id === tab ? 'is-on' : '', html: icon(ic), onclick: () => { tab = id; render(); panel.scrollTop = 0; } }, h('span', name))));
      panel.replaceChildren(...panels[tab]().filter(Boolean));
      initControls(panel);
      win.setTitle(PANES.find(([id]) => id === tab)[1]);
    }
    render();
    // Änderungen von außen (Kontrollzentrum, Terminal) spiegeln – aber nicht mitten im Ziehen eines Reglers
    const off = bus.on('setting', (key) => {
      if (panel.querySelector('.gslider.is-drag') || ['color', 'text', 'password'].includes(document.activeElement?.type)) return;
      if (['theme', 'autoTheme', 'accent', 'wallpaper', 'wallImage', 'animate', 'sounds', 'dnd', 'nightShift', 'widgets', 'pass', 'brightness', 'volume'].includes(key)) render();
    });
    const offApps = bus.on('apps', () => { if (tab === 'apps') render(); });
    const offPwa = bus.on('pwa', () => { if (tab === 'general') render(); });
    return {
      onClose: () => { off(); offApps(); offPwa(); },
      onArgs: (a) => { if (PANES.some(([id]) => id === a.tab)) { tab = a.tab; render(); } },
      state: () => ({ tab }),
    };
  },
};
