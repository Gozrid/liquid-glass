// pwa.js — fableOS als installierbare App: Service Worker (offline, Updates), Installation,
// Dateien aus dem echten System öffnen, Zähler am App-Symbol

import { h, store } from '../core/util.js';
import { bus } from './bus.js';
import { sys, apps } from './sys.js';
import { vfs, HOME } from './vfs.js';
import { dialog, fsops, notes } from './ui.js';

export function initPWA() {
  const modes = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)');
  const state = {
    supported: 'serviceWorker' in navigator && location.protocol !== 'file:',
    standalone: modes.matches || navigator.standalone === true,
    canPrompt: false,
    offlineReady: false,
    updateReady: false,
    checkedAt: 0,
  };
  let deferred = null;
  let reg = null;
  let waiting = null;        // Auflösung einer laufenden Update-Suche
  let sessionOn = false;
  const queue = [];          // Dateien, die vor dem Entsperren ankamen
  const emit = () => bus.emit('pwa', state);

  // ---------- Installation ----------
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    state.canPrompt = true;
    emit();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    state.canPrompt = false;
    emit();
    navigator.storage?.persist?.().catch(() => {});
    sys.notify({ title: 'fableOS ist installiert', body: 'Die App liegt jetzt im Dock oder auf dem Home-Bildschirm deines Geräts.', icon: 'check', force: true });
  });
  modes.addEventListener('change', () => { state.standalone = modes.matches; emit(); });

  async function install() {
    if (state.standalone) {
      dialog({ icon: 'check', title: 'fableOS ist installiert', text: 'Du benutzt gerade die installierte App – mit eigenem Fenster und eigenem Symbol.' });
      return 'installed';
    }
    if (deferred) {
      const ev = deferred;
      deferred = null;
      state.canPrompt = false;
      emit();
      ev.prompt();
      const { outcome } = await ev.userChoice;
      return outcome;
    }
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    let text = 'So kommt fableOS als eigene App auf dein Gerät:';
    let steps;
    if (ios) steps = ['Tippe in Safari auf das Teilen-Symbol.', 'Wähle „Zum Home-Bildschirm“.', 'Bestätige mit „Hinzufügen“.'];
    else if (safari) steps = ['Öffne in der Menüleiste von Safari das Menü „Ablage“.', 'Wähle „Zum Dock hinzufügen …“.', 'Bestätige mit „Hinzufügen“.'];
    else if (/firefox|fxios/i.test(ua)) {
      text = 'Firefox installiert Websites auf dem Computer nicht als App. Öffne fableOS in Chrome, Edge oder Safari – dort genügt ein Klick. Auf Android geht es auch mit Firefox:';
      steps = ['Öffne das Menü (⋮).', 'Wähle „Installieren“ bzw. „Zum Startbildschirm hinzufügen“.'];
    } else {
      steps = ['Klicke rechts in der Adressleiste auf das Installieren-Symbol (Bildschirm mit Pfeil).', 'Oder öffne das Browser-Menü (⋮) → „Streamen, speichern und teilen“ → „Seite als App installieren …“.', 'Erscheint nichts davon, ist fableOS in diesem Browser schon installiert.'];
    }
    dialog({ icon: 'download', title: 'fableOS installieren', text, body: h('ol.sysdlg-steps', steps.map((s) => h('li', s))), buttons: [{ label: 'Verstanden', value: true, primary: true }] });
    return 'manual';
  }

  // ---------- Service Worker ----------
  if (state.supported) {
    navigator.serviceWorker.register('sw.js').then((r) => { reg = r; }).catch((err) => console.warn('Service Worker lässt sich nicht registrieren.', err));
    navigator.serviceWorker.ready.then((r) => { reg = r; state.offlineReady = true; emit(); }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      const type = e.data?.type;
      if (type === 'update-ready') {
        const first = !state.updateReady;
        state.updateReady = true;
        state.checkedAt = Date.now();
        emit();
        waiting?.('update');
        if (first) {
          sys.notify({ title: 'Update bereit', body: 'Eine neue Version von fableOS ist geladen. Neu starten, um sie zu nutzen.', icon: 'reload', force: true, ttl: 9000, onClick: () => sys.power.restart() });
        }
      } else if (type === 'up-to-date') {
        state.checkedAt = Date.now();
        emit();
        waiting?.('current');
      } else if (type === 'offline-ready') {
        state.offlineReady = true;
        emit();
        if (!store.get('fableos.offlineNoted', false)) {
          store.set('fableos.offlineNoted', true);
          sys.notify({ title: 'Bereit für unterwegs', body: 'fableOS ist jetzt gespeichert und startet auch ohne Netz.', icon: 'wifi' });
        }
      }
    });
  }
  /** Sucht nach einer neuen Version → 'update' | 'current' | 'error' */
  function check() {
    const sw = reg?.active || navigator.serviceWorker?.controller;
    if (!sw) return Promise.resolve('error');
    reg?.update().catch(() => {});
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiting = null; resolve('error'); }, 25000);
      waiting = (res) => { clearTimeout(timer); waiting = null; resolve(res); };
      sw.postMessage({ type: 'check' });
    });
  }
  const statusText = () => {
    if (!state.supported) return 'Dieser Browser unterstützt keinen Offline-Modus.';
    if (state.updateReady) return 'Ein Update ist geladen – nach einem Neustart ist es aktiv.';
    if (!state.offlineReady) return 'fableOS wird gerade für die Nutzung ohne Netz gespeichert …';
    return `Auf dem neuesten Stand · offline nutzbar${state.checkedAt ? ` · geprüft um ${new Date(state.checkedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  };

  // ---------- Dateien und Kurzbefehle, mit denen die installierte App gestartet wird ----------
  async function consume(item) {
    if (item.open && apps.has(item.open)) sys.open(item.open);
    if (!item.files?.length) return;
    const dir = `${HOME}/Downloads`;
    const list = [];
    for (const handle of item.files) {
      try { list.push(await handle.getFile()); } catch { /* kein Zugriff */ }
    }
    if (!list.length) return;
    const known = new Set(vfs.list(dir).map((st) => st.path));
    const n = await fsops.importHost(dir, list);
    if (!n) return;
    const added = vfs.list(dir).filter((st) => !known.has(st.path));
    sys.notify({ title: `${n} ${n === 1 ? 'Datei' : 'Dateien'} übernommen`, body: `${added.slice(0, 2).map((st) => st.name).join(', ')} – abgelegt in „Downloads“.`, app: 'files', onClick: () => sys.open('files', { path: dir }) });
    if (added.length === 1) sys.openPath(added[0].path); else sys.open('files', { path: dir });
  }
  window.launchQueue?.setConsumer((params) => {
    let open = null;
    try { open = params.targetURL ? new URL(params.targetURL).searchParams.get('open') : null; } catch { /* keine Adresse */ }
    const item = { files: params.files ? [...params.files] : [], open: sessionOn ? open : null };
    if (sessionOn) consume(item); else queue.push(item);
  });

  // ---------- Zähler am App-Symbol ----------
  bus.on('notes', () => {
    if (!navigator.setAppBadge) return;
    if (notes.unread) navigator.setAppBadge(notes.unread).catch(() => {}); else navigator.clearAppBadge?.().catch(() => {});
  });

  sys.pwa = {
    state, install, check, statusText,
    canOffer: () => !state.standalone,
    /** main.js ruft das nach dem ersten Entsperren: Wartendes abarbeiten, Installation einmal vorschlagen */
    started() {
      sessionOn = true;
      for (const item of queue.splice(0)) consume(item);
      if (state.standalone) { navigator.storage?.persist?.().catch(() => {}); return; }
      setTimeout(() => {
        if (!state.canPrompt || state.standalone || store.get('fableos.installHint', false)) return;
        store.set('fableos.installHint', true);
        sys.notify({ title: 'fableOS als App?', body: 'Mit eigenem Fenster und Symbol – klick hier zum Installieren.', icon: 'download', ttl: 9000, onClick: () => install() });
      }, 45000);
    },
  };
  return sys.pwa;
}
