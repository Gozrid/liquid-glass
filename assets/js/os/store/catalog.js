// catalog.js — Katalog des App Store: sammelt die Einträge aller Rubriken (store/catalog/*.js)

import alltag from './catalog/alltag.js';
import kreativ from './catalog/kreativ.js';
import spiele from './catalog/spiele.js';
import werkzeuge from './catalog/werkzeuge.js';

export const CATALOG = [...alltag, ...kreativ, ...spiele, ...werkzeuge];
export const entry = (id) => CATALOG.find((e) => e.id === id) || null;
