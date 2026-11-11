// icons.js — handgezeichnetes Icon-Set (24er-Raster, Strichstärke per CSS). Keine Bilddateien.

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17L17 7M8.5 7H17v8.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  command: '<path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v6m0-6h6m-6 6H6.5A2.5 2.5 0 1 0 9 17.5V15zm0 0h6m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm0 0V9m0 0h2.5A2.5 2.5 0 1 0 15 6.5V9z"/>',
  wifi: '<path d="M2.5 9.5a14 14 0 0 1 19 0M5.6 13a9.4 9.4 0 0 1 12.8 0M8.7 16.3a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none"/>',
  bluetooth: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
  battery: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.8"/><path d="M22 10.5v3"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.5 0 1 .2 1.3.6L11.5 7.5h7A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10z"/>',
  file: '<path d="M7 3h6.5L19 8.5v10a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-13A2.5 2.5 0 0 1 7 3z"/><path d="M13.5 3.5V9H19"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5"/>',
  terminal: '<path d="M5 8l4.5 4L5 16M12.5 16.5H19"/>',
  sliders: '<path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  brush: '<path d="M19.5 4.5c-3.5 1-8 5-10 8.500l2.500 2.500c3.500-2 7.500-6.500 8.500-10 .2-.7-.3-1.200-1-1z"/><path d="M9 13.500c-2.500-.300-4 1-4.200 3-.2 1.500-.8 2.500-1.800 3 3.500.8 7-.200 7.500-3.500"/>',
  music: '<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.300 5.300-5.300 2.300 2.300-5.300z"/>',
  pulse: '<path d="M2.500 12h4l2.500-6.500 4 13 2.500-6.500h6"/>',
  prism: '<path d="M12 4l8.500 15h-17z"/><path d="M2 10.500l7 2.500M15 13.500l7-2M15 15.500l7 1.500"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500"/><circle cx="12" cy="7.700" r="1" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.500" width="14" height="10" rx="2.800"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"/>',
  power: '<path d="M12 3v8.500"/><path d="M6.600 6.600a8 8 0 1 0 10.800 0"/>',
  grid: '<rect x="4" y="4" width="6.500" height="6.500" rx="1.800"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.800"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.800"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.800"/>',
  list: '<path d="M8.500 6.500H20M8.500 12H20M8.500 17.500H20"/><circle cx="4.500" cy="6.500" r="1" fill="currentColor" stroke="none"/><circle cx="4.500" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.500" cy="17.500" r="1" fill="currentColor" stroke="none"/>',
  note: '<path d="M7.500 3h9A2.500 2.500 0 0 1 19 5.500v13a2.500 2.500 0 0 1-2.500 2.500h-9A2.500 2.500 0 0 1 5 18.500v-13A2.500 2.500 0 0 1 7.500 3z"/><path d="M8.500 8h7M8.500 12h7M8.500 16h4"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.500 7.500h7"/><path d="M8.500 12h.01M12 12h.01M15.500 12h.01M8.500 16h.01M12 16h.01M15.500 16h.01" stroke-width="2.400"/>',
  image: '<rect x="3.500" y="4.500" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.800"/><path d="M4 17l5-4.500 4 3.500 3-2.500 4.500 4"/>',
  download: '<path d="M12 4v11M7 10.500l5 5 5-5M5 19.500h14"/>',
  copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="2.500"/><path d="M15.500 8.500V7A2.500 2.500 0 0 0 13 4.500H7A2.500 2.500 0 0 0 4.500 7v6A2.500 2.500 0 0 0 7 15.500h1.500"/>',
  reload: '<path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300"/><path d="M19.500 4.500v4.500H15"/>',
  undo: '<path d="M8 14.500L3.500 10 8 5.500"/><path d="M4 10h9.500a6 6 0 0 1 0 12H10"/>',
  redo: '<path d="M16 14.500l4.500-4.500L16 5.500"/><path d="M20 10h-9.500a6 6 0 0 0 0 12H14"/>',
  eraser: '<path d="M4.500 15.500l9-9.500a2 2 0 0 1 2.900 0l3.600 3.600a2 2 0 0 1 0 2.900l-6.500 6.500H8.500l-4-4a1 1 0 0 1 0-1.500z"/><path d="M9.500 10.500l5.500 5.500M13.500 19.500h7"/>',
  bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15z"/><path d="M10 20.500a2.200 2.200 0 0 0 4 0"/>',
  sparkles: '<path d="M10 4l1.600 4.400L16 10l-4.400 1.600L10 16l-1.600-4.400L4 10l4.400-1.600z"/><path d="M18 14l.8 2.200L21 17l-2.200.8L18 20l-.8-2.200L15 17l2.200-.8z"/>',
  drop: '<path d="M12 3s6.500 6.800 6.500 11.500a6.500 6.500 0 0 1-13 0C5.500 9.800 12 3 12 3z"/>',
  layers: '<path d="M12 3.500l9 5-9 5-9-5z"/><path d="M3.500 13l8.500 4.700 8.500-4.700"/>',
  cursor: '<path d="M5.500 4l13 7-5.600 1.900L11 18.500z"/>',
  code: '<path d="M8.500 7L3.500 12l5 5M15.500 7l5 5-5 5"/>',
  wave: '<path d="M2.500 12c2.400-6 4.700-6 7 0s4.700 6 7 0 3.200-4.500 5-2"/>',
  bolt: '<path d="M13 2.500L5 13.500h6l-1 8 8-11h-6z"/>',
  user: '<circle cx="12" cy="8.500" r="4"/><path d="M4.500 20.500c1-4 4-5.500 7.500-5.500s6.500 1.500 7.500 5.500"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.300l3.500 2"/>',
  external: '<path d="M10 5H6.500A2.500 2.500 0 0 0 4 7.500v10A2.500 2.500 0 0 0 6.500 20h10a2.500 2.500 0 0 0 2.500-2.500V14M14 4h6v6M20 4l-9 9"/>',
  focus: '<path d="M19.500 13.500A7.800 7.800 0 0 1 10.500 4.500a7.800 7.800 0 1 0 9 9z"/>',
  gear: '',
};

// Zahnrad wird berechnet statt gezeichnet
P.gear = (() => {
  const teeth = 8;
  const pts = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / (teeth * 4) * 1.5;
    const r = i % 4 < 2 ? 9.4 : 7.2;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}z"/><circle cx="12" cy="12" r="3"/>`;
})();

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstElementChild;
}

/** Ersetzt <i data-icon="name"></i>-Platzhalter im Markup. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.outerHTML = icon(el.dataset.icon, el.className);
  }
}

/** Das Fable-Signet: ein Tropfen mit Lichtreflex. */
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
  <defs>
    <linearGradient id="lg-logo" x1="6" y1="3" x2="26" y2="30" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffc078"/><stop offset=".42" stop-color="#ff5d6c"/><stop offset=".8" stop-color="#9a6bff"/><stop offset="1" stop-color="#45c8ff"/>
    </linearGradient>
  </defs>
  <path d="M16 2.500s10 9.800 10 17.200a10 10 0 0 1-20 0C6 12.300 16 2.500 16 2.500z" fill="url(#lg-logo)"/>
  <path d="M11 19.500a5 5 0 0 0 4.200 5" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/>
</svg>`;
