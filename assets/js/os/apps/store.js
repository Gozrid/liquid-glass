// store.js — App Store: Katalog durchstöbern, Apps laden (echter Download mit Fortschritt), aktualisieren,
// entfernen – und beliebige Websites als Web-App hinzufügen

import { h, ticker, escapeHtml } from '../../core/util.js';
import { icon, LOGO } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, apps, appIcon } from '../sys.js';
import { registry } from '../registry.js';
import { formatSize } from '../vfs.js';
import { toast, emptyState, timeAgo } from '../kit.js';
import { removeApp } from '../shell/launchpad.js';

const CATS = [
  ['Alltag', 'clock'], ['Kreativ', 'brush'], ['Spiele', 'prism'], ['Werkzeuge', 'sliders'], ['Entwicklung', 'code'],
];
const WEB_COLORS = [['#62e0ff', '#2f7cf6'], ['#ff8a5c', '#ff3d81'], ['#45e3b4', '#0c9a78'], ['#ffd96b', '#ff9f1a'], ['#b18cff', '#5b3fd6'], ['#9aa3c2', '#4a516e']];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const moduleUrl = (id) => new URL(`../store/apps/${id}.js`, import.meta.url).href;

// ---------- laufende Downloads: gelten für alle Store-Fenster ----------
const jobs = new Map();       // id → {real, shown, done}
const sizes = new Map();      // id → Bytes (aus dem Katalog-Server)
const MIN_MS = 1100;          // so lange dauert die Animation mindestens – die Module sind klein

function install(id) {
  if (jobs.has(id) || registry.isInstalled(id)) return;
  const job = { real: 0, shown: 0, started: performance.now(), done: false, error: null };
  jobs.set(id, job);
  const frame = () => {
    const t = Math.min(1, (performance.now() - job.started) / MIN_MS);
    job.shown = Math.min(job.real, t);
    bus.emit('store:progress', id);
    if ((job.done && t >= 1) || job.error) {
      ticker.remove(frame);
      jobs.delete(id);
      bus.emit('store:progress', id);
      if (job.error) {
        sfx.error();
        sys.notify({ title: 'Laden fehlgeschlagen', body: job.error.message, icon: 'close', force: true });
      } else {
        sfx.chime();
        const e = registry.entry(id);
        sys.notify({ title: `${e.name} ist installiert`, body: 'Öffnen – die App liegt jetzt bei „Apps“.', app: id, onClick: () => sys.open(id) });
      }
    }
  };
  ticker.add(frame);
  registry.install(id, (p) => { job.real = p; }).then((bytes) => { sizes.set(id, bytes); job.real = 1; job.done = true; }, (err) => { job.error = err; });
}

async function sizeOf(id) {
  if (sizes.has(id)) return sizes.get(id);
  const known = registry.info(id)?.size;
  if (known) { sizes.set(id, known); return known; }
  try {
    const res = await fetch(moduleUrl(id), { method: 'HEAD' });
    const n = Number(res.headers.get('content-length'));
    if (res.ok && n) { sizes.set(id, n); return n; }
  } catch { /* offline */ }
  return 0;
}

export default {
  id: 'store', name: 'App Store', icon: 'download', colors: ['#3ea1ff', '#1a5cf0'], keywords: 'apps laden installieren programme shop',
  glyph: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.500 8.500h13l-1 11.500h-11z"/><path d="M9 8.500V7a3 3 0 0 1 6 0v1.500"/><path d="M12 11.500v5M9.800 14.300l2.200 2.200 2.200-2.200"/></svg>',
  singleton: true, width: 940, height: 620, minW: 520, minH: 400,

  mount(win, args) {
    let view = 'discover';
    let query = '';
    let stack = [];        // für „Zurück“
    const nav = h('nav.kit-side.scroll');
    const main = h('div.store-main.scroll');
    const search = h('input.kit-field', { type: 'text', placeholder: 'Suchen', spellcheck: false, autocomplete: 'off', 'aria-label': 'Im App Store suchen' });
    const side = h('div.store-side', h('label.kit-search.store-search', { html: icon('search') }, search), nav);
    const bBack = h('button.tool', { type: 'button', 'aria-label': 'Zurück', title: 'Zurück', html: icon('chevronLeft'), disabled: true });
    win.tools.append(bBack);
    win.body.append(h('div.kit-split.store', side, main));
    const catalog = registry.catalog;
    const entry = (id) => registry.entry(id);

    // ---------- Laden / Öffnen ----------
    const paintGet = (b) => {
      const id = b.dataset.app;
      const job = jobs.get(id);
      const installed = registry.isInstalled(id);
      b.classList.toggle('is-busy', !!job);
      b.classList.toggle('is-open', installed && !job);
      b.style.setProperty('--p', job ? job.shown.toFixed(3) : 0);
      const label = job ? `${Math.round(job.shown * 100)} %` : installed ? 'Öffnen' : 'Laden';
      if (b.firstChild.textContent !== label) b.firstChild.textContent = label;
      b.setAttribute('aria-label', `${entry(id)?.name}: ${job ? 'wird geladen' : installed ? 'öffnen' : 'laden'}`);
    };
    const getBtn = (e, big = false) => {
      const b = h(`button.store-get${big ? '.big' : ''}`, { type: 'button', dataset: { app: e.id } }, h('span', 'Laden'), h('i'));
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (jobs.has(e.id)) return;
        if (registry.isInstalled(e.id)) sys.open(e.id); else { install(e.id); sfx.tick(); }
      });
      paintGet(b);
      return b;
    };
    const paintAll = () => { for (const b of main.querySelectorAll('.store-get')) paintGet(b); };

    const card = (e) => {
      const el = h('div.store-card', { role: 'button', tabIndex: 0, dataset: { id: e.id } },
        appIcon(e), h('div.store-card-txt', h('b', e.name), h('span', e.tagline || e.category || '')), getBtn(e));
      el.addEventListener('click', () => go(`app:${e.id}`));
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === el) go(`app:${e.id}`); });
      return el;
    };
    const section = (title, list, more) => (list.length ? h('section.store-sec',
      h('header', h('h3', title), more ? h('button.kit-chip', { type: 'button', onclick: more }, 'Alle zeigen') : null),
      h('div.store-grid', list.map(card))) : null);

    // ---------- Ansichten ----------
    const views = {
      discover() {
        const feat = catalog.length ? catalog[Math.floor(Date.now() / 864e5) % catalog.length] : null;
        const fresh = catalog.filter((e) => !registry.isInstalled(e.id));
        return [
          sys.pwa?.canOffer() ? h('div.store-pwa', h('span.store-pwa-logo', { html: LOGO }),
            h('div', h('b', 'fableOS als App installieren'), h('span', 'Eigenes Fenster, eigenes Symbol, startet auch ohne Netz.')),
            h('button.kit-btn.primary.round', { type: 'button', onclick: () => sys.pwa.install() }, 'Installieren')) : null,
          feat ? h('div.store-hero', { style: { '--c1': feat.colors?.[0], '--c2': feat.colors?.[1] }, role: 'button', tabIndex: 0, onclick: (ev) => { if (!ev.target.closest('.store-get')) go(`app:${feat.id}`); } },
            h('div.store-hero-txt', h('small', 'App des Tages'), h('h2', feat.name), h('p', feat.description || feat.tagline || ''), getBtn(feat, true)),
            h('div.store-hero-art', appIcon(feat))) : emptyState('download', 'Der Katalog ist leer', 'Im Moment gibt es keine Apps zum Laden.'),
          section('Neu für dich', fresh.slice(0, 6), fresh.length > 6 ? () => go('all') : null),
          ...CATS.map(([cat]) => section(cat, catalog.filter((e) => e.category === cat).slice(0, 6), () => go(`cat:${cat}`))),
          catalog.length ? h('p.store-foot', `${catalog.length} Apps · alle kostenlos, ohne Konto, ohne Werbung. Jede App wird beim Laden wirklich heruntergeladen und funktioniert danach auch offline.`) : null,
        ];
      },
      all: () => [h('h2.store-title', 'Alle Apps'), h('div.store-grid', catalog.map(card))],
      cat(name) {
        const list = catalog.filter((e) => e.category === name);
        return [h('h2.store-title', name), list.length ? h('div.store-grid', list.map(card)) : emptyState('folder', 'Noch nichts in dieser Rubrik')];
      },
      search() {
        const q = norm(query.trim());
        const list = catalog.filter((e) => [e.name, e.tagline, e.keywords, e.category, e.description].some((t) => norm(t).includes(q)));
        return [h('h2.store-title', `Ergebnisse für „${query.trim()}“`), list.length ? h('div.store-grid', list.map(card)) : emptyState('search', 'Nichts gefunden', 'Versuch es mit einem anderen Begriff – oder füge eine Website als Web-App hinzu.')];
      },
      installed() {
        const list = [...apps.values()].filter((a) => registry.isRemovable(a.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return [
          h('h2.store-title', 'Installiert'),
          list.length ? h('div.store-list', list.map((a) => {
            const inf = registry.info(a.id);
            return h('div.store-row', appIcon(a, 'sm'),
              h('div.store-row-txt', { role: a.webApp ? null : 'button', onclick: () => { if (!a.webApp) go(`app:${a.id}`); } }, h('b', a.name),
                h('span', a.webApp ? `Web-App · ${a.tagline}` : `Version ${inf?.v || '1.0'}${inf?.size ? ` · ${formatSize(inf.size)}` : ''} · ${inf?.pre ? 'mitgeliefert' : `geladen ${timeAgo(inf?.at || Date.now())}`}`)),
              h('button.kit-btn.round', { type: 'button', onclick: () => sys.open(a.id) }, 'Öffnen'),
              h('button.tool', { type: 'button', 'aria-label': `${a.name} entfernen`, title: 'Entfernen', html: icon('trash'), onclick: () => removeApp(a.id) }));
          })) : emptyState('download', 'Noch nichts installiert', 'Stöbere unter „Entdecken“ – ein Klick auf „Laden“ genügt.'),
        ];
      },
      updates() {
        const ups = registry.updates();
        const pwa = sys.pwa;
        const status = h('span', pwa?.statusText() || 'Dieser Browser unterstützt keinen Offline-Modus.');
        const bCheck = h('button.kit-btn.round', { type: 'button', disabled: !pwa?.state.supported }, pwa?.state.updateReady ? 'Neu starten' : 'Suchen');
        bCheck.addEventListener('click', async () => {
          if (pwa.state.updateReady) { sys.power.restart(); return; }
          bCheck.disabled = true;
          status.textContent = 'Suche nach Updates …';
          const res = await pwa.check();
          bCheck.disabled = false;
          status.textContent = pwa.statusText();
          if (res === 'update') bCheck.textContent = 'Neu starten';
          else toast(win, res === 'current' ? 'fableOS ist auf dem neuesten Stand' : 'Die Suche war gerade nicht möglich');
        });
        const updateAll = async (ids) => {
          for (const id of ids) {
            try { await registry.update(id); } catch (err) { sys.notify({ title: 'Update fehlgeschlagen', body: err.message, icon: 'close', force: true }); return; }
          }
          sfx.chime();
          toast(win, 'Aktualisiert – wirkt nach dem nächsten Neustart');
          render();
        };
        return [
          h('h2.store-title', 'Updates'),
          h('div.store-row.is-sys', h('span.store-sys', { html: icon('drop') }), h('div.store-row-txt', h('b', `fableOS ${sys.version}`), status), bCheck),
          h('header.store-sub', h('h3', ups.length ? `${ups.length} ${ups.length === 1 ? 'App-Update' : 'App-Updates'}` : 'Apps'),
            ups.length > 1 ? h('button.kit-chip', { type: 'button', onclick: () => updateAll(ups) }, 'Alle aktualisieren') : null),
          ups.length ? h('div.store-list', ups.map((id) => {
            const e = entry(id);
            return h('div.store-row', appIcon(e, 'sm'), h('div.store-row-txt', h('b', e.name), h('span', `Version ${registry.info(id).v} → ${e.version}`)),
              h('button.kit-btn.round.primary', { type: 'button', onclick: () => updateAll([id]) }, 'Aktualisieren'));
          })) : h('p.store-foot', 'Alle installierten Apps sind aktuell.'),
        ];
      },
      web() {
        let colors = WEB_COLORS[0];
        const name = h('input.kit-field', { type: 'text', placeholder: 'Name', maxLength: 28, 'aria-label': 'Name der Web-App' });
        const url = h('input.kit-field', { type: 'text', placeholder: 'https://…', spellcheck: false, autocomplete: 'off', 'aria-label': 'Adresse' });
        const sw = h('div.store-swatches', WEB_COLORS.map((c, i) => {
          const b = h('button', { type: 'button', class: i === 0 ? 'is-on' : '', 'aria-label': `Farbe ${i + 1}`, style: { '--c1': c[0], '--c2': c[1] } });
          b.addEventListener('click', () => { colors = c; for (const x of sw.children) x.classList.toggle('is-on', x === b); });
          return b;
        }));
        const add = () => {
          let u = url.value.trim();
          if (!u) { url.focus(); return; }
          if (!/^[a-z]+:\/\//i.test(u) && !/^[\w./-]+\.html?$/i.test(u)) u = `https://${u}`;
          if (/^(javascript|data|file|blob):/i.test(u)) { toast(win, 'Diese Adresse lässt sich nicht hinzufügen'); return; }
          const n = name.value.trim() || u.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
          const id = registry.addWeb({ name: n, url: u, colors });
          sfx.chime();
          sys.notify({ title: `${n} hinzugefügt`, body: 'Die Web-App liegt jetzt bei „Apps“.', app: id, onClick: () => sys.open(id) });
          render();
        };
        for (const f of [name, url]) f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') add(); });
        const mine = registry.state.web;
        return [
          h('h2.store-title', 'Web-Apps'),
          h('p.store-lede', 'Mach aus jeder Website eine App mit eigenem Symbol, eigenem Fenster und Platz im Dock.'),
          h('div.store-form.kit-card', h('div.store-form-row', name, url), h('div.store-form-row', h('span.kit-label', 'Farbe'), sw, h('span.sp'),
            h('button.kit-btn.primary.round', { type: 'button', onclick: add }, 'Hinzufügen'))),
          h('p.store-foot', 'Hinweis: Viele große Websites verbieten das Einbetten in andere Seiten – bleibt das Fenster leer, öffne die Seite über das Pfeilsymbol im Browser. Web-Apps laden ihre Inhalte direkt von der jeweiligen Adresse.'),
          mine.length ? h('div.store-list', mine.map((w) => {
            const a = apps.get(w.id);
            return h('div.store-row', appIcon(a, 'sm'), h('div.store-row-txt', h('b', w.name), h('span', w.url)),
              h('button.kit-btn.round', { type: 'button', onclick: () => sys.open(w.id) }, 'Öffnen'),
              h('button.tool', { type: 'button', 'aria-label': `${w.name} entfernen`, title: 'Entfernen', html: icon('trash'), onclick: () => removeApp(w.id) }));
          })) : null,
          h('header.store-sub', h('h3', 'Vorschlag')),
          h('div.store-list', h('div.store-row', h('span.store-sys', { html: icon('drop') }), h('div.store-row-txt', h('b', 'Liquid-Glass-Showcase'), h('span', 'Die Website, zu der fableOS gehört – als eigene App.')),
            h('button.kit-btn.round', { type: 'button', onclick: () => { registry.addWeb({ name: 'Showcase', url: 'index.html', colors: WEB_COLORS[1] }); sfx.chime(); render(); } }, 'Hinzufügen'))),
        ];
      },
      app(id) {
        const e = entry(id);
        if (!e) return [emptyState('close', 'Diese App gibt es nicht mehr')];
        const size = h('b', '…');
        sizeOf(id).then((n) => { size.textContent = n ? formatSize(n) : '–'; });
        const fact = (label, value) => h('div.store-fact', h('small', label), typeof value === 'string' ? h('b', value) : value);
        const installed = registry.isInstalled(id);
        const more = catalog.filter((x) => x.category === e.category && x.id !== id).slice(0, 4);
        return [
          h('div.store-detail', appIcon(e, 'xl'),
            h('div.store-detail-txt', h('h2', e.name), h('p', e.tagline || ''), h('div.store-detail-act', getBtn(e, true),
              installed && !jobs.has(id) ? h('button.kit-btn.round', { type: 'button', onclick: async () => { if (await removeApp(id)) render(); } }, 'Entfernen') : null))),
          h('div.store-facts', fact('Kategorie', e.category || '–'), fact('Version', e.version || '1.0'), fact('Größe', size), fact('Offline', 'Ja'), fact('Preis', 'Kostenlos')),
          e.description ? h('p.store-desc', e.description) : null,
          e.features?.length ? h('section.store-block', h('h3', 'Das kann die App'), h('ul.store-feats', e.features.map((f) => h('li', { html: `${icon('check')}<span>${escapeHtml(f)}</span>` })))) : null,
          h('section.store-block', h('h3', 'Datenschutz'),
            e.privacy?.length
              ? h('ul.store-priv', e.privacy.map((p) => h('li', { html: `${icon('info')}<span>${escapeHtml(p)}</span>` })))
              : h('p.store-ok', { html: `${icon('lock')}<span>Braucht weder Netz noch Berechtigungen – alle Daten bleiben auf diesem Gerät.</span>` })),
          (e.widgets?.length || e.accepts?.length || e.background) ? h('section.store-block', h('h3', 'Integration'), h('div.store-chips',
            ...(e.widgets || []).map((w) => h('span.kit-chip', `Widget: ${w.name}`)),
            e.accepts?.length ? h('span.kit-chip', `Öffnet ${e.accepts.map((x) => `.${x}`).join(' ')}`) : null,
            e.background ? h('span.kit-chip', 'Meldet sich auch ohne offenes Fenster') : null)) : null,
          section(`Mehr aus „${e.category}“`, more),
        ];
      },
    };

    function render() {
      const [kind, arg] = view.includes(':') ? [view.slice(0, view.indexOf(':')), view.slice(view.indexOf(':') + 1)] : [view, null];
      const ups = registry.updates().length;
      const item = (id, label, ic, count) => h('button', { type: 'button', class: view === id ? 'is-on' : '', html: icon(ic), onclick: () => go(id, true) }, h('span', label), count ? h('span.kit-count', String(count)) : null);
      nav.replaceChildren(
        item('discover', 'Entdecken', 'sparkles'),
        h('div.kit-head', 'Kategorien'),
        ...CATS.map(([cat, ic]) => item(`cat:${cat}`, cat, ic, catalog.filter((e) => e.category === cat).length)),
        h('div.kit-head', 'Mediathek'),
        item('web', 'Web-Apps', 'compass', registry.state.web.length),
        item('updates', 'Updates', 'reload', ups),
        item('installed', 'Installiert', 'check', [...apps.values()].filter((a) => registry.isRemovable(a.id)).length));
      const build = views[kind] || views.discover;
      main.replaceChildren(...build(arg).flat().filter(Boolean));
      bBack.disabled = !stack.length;
      win.setTitle(kind === 'app' && entry(arg) ? `${entry(arg).name} – App Store` : 'App Store');
      sys.badge('store', ups);
    }
    function go(next, reset = false) {
      if (next === view) return;
      if (reset) stack = []; else stack.push(view);
      view = next;
      if (!next.startsWith('search')) { query = ''; search.value = ''; }
      render();
      main.scrollTop = 0;
    }
    bBack.addEventListener('click', () => { if (stack.length) { view = stack.pop(); render(); } });
    search.addEventListener('input', () => {
      query = search.value;
      if (query.trim()) { if (view !== 'search') { stack.push(view); view = 'search'; } render(); }
      else if (view === 'search') { view = stack.pop() || 'discover'; render(); }
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());

    const offProg = bus.on('store:progress', (id) => { paintAll(); if (!jobs.has(id) && view === `app:${id}`) render(); });
    const offApps = bus.on('apps', () => { if (!main.querySelector('.store-form input:focus')) render(); });
    const offPwa = bus.on('pwa', () => { if (view === 'discover' || view === 'updates') render(); });
    const apply = (a) => {
      if (a.app && entry(a.app)) { stack = ['discover']; view = `app:${a.app}`; }
      else if (a.view && views[a.view]) { stack = []; view = a.view; }
      else if (a.q) { stack = ['discover']; view = 'search'; query = a.q; search.value = a.q; }
    };
    apply(args);
    render();
    return {
      onClose: () => { offProg(); offApps(); offPwa(); },
      onArgs: (a) => { apply(a); render(); main.scrollTop = 0; },
      menus: [{
        label: 'Store',
        items: [
          { label: 'Entdecken', icon: 'sparkles', run: () => go('discover', true) },
          { label: 'Updates', icon: 'reload', run: () => go('updates', true) },
          { label: 'Installiert', icon: 'check', run: () => go('installed', true) },
          '-',
          { label: 'Web-App hinzufügen …', icon: 'compass', run: () => go('web', true) },
        ],
      }],
    };
  },
};
