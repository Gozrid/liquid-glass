// catalog.js — Katalog des App Store: sammelt die Einträge aller Rubriken (store/catalog/*.js)

const PARTS = ['alltag', 'kreativ', 'spiele', 'werkzeuge'];

const lists = await Promise.all(PARTS.map((part) => import(`./catalog/${part}.js`).then(
  (m) => m.default,
  (err) => { console.warn(`[store] Rubrik „${part}“ fehlt`, err); return []; },
)));

export const CATALOG = lists.flat();
export const entry = (id) => CATALOG.find((e) => e.id === id) || null;
