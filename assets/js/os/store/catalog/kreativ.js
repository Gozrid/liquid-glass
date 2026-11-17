// kreativ.js — Store-Katalog, Rubrik „kreativ“. Einträge: siehe README, Abschnitt „Eine App schreiben“.

const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export default [
  {
    id: 'photos',
    name: 'Fotos',
    tagline: 'Deine Bilder ansehen und veredeln',
    category: 'Kreativ',
    version: '1.0',
    colors: ['#ffb347', '#f0477e'],
    // Blüte: sechs Blätter um eine Mitte
    glyph: ico(`${[0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="12" cy="6.600" rx="2.500" ry="3.900" transform="rotate(${a} 12 12)"/>`).join('')}<circle cx="12" cy="12" r="1.500" fill="currentColor" stroke="none"/>`),
    keywords: 'bilder galerie mediathek diashow bearbeiten filter album foto',
    description: 'Fotos sammelt alle Bilder aus deinem Ordner „Bilder“ in einer Mediathek mit Alben und Favoriten. Im Betrachter blätterst, zoomst und startest du eine Diashow. Mit Reglern und Filtern gibst du jedem Bild den letzten Schliff – und machst es mit einem Klick zum Hintergrund.',
    features: [
      'Mediathek mit Alben, Favoriten und stufenloser Rastergröße',
      'Betrachter mit Zoom, Infos und sanfter Diashow',
      'Bearbeiten: fünf Regler, sieben Filter, Drehen und Spiegeln',
      'Import vom Gerät (auch per Drag & Drop) und Export',
      'Jedes Foto als Schreibtisch-Hintergrund',
    ],
    privacy: [],
    accepts: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    widgets: [{ id: 'pick', name: 'Foto', size: 's' }],
  },
  {
    id: 'music',
    name: 'Musik',
    tagline: 'Acht Stücke, live komponiert',
    category: 'Kreativ',
    version: '1.0',
    colors: ['#c06bff', '#5438e8'],
    // Schallplatte mit Lichtreflex
    glyph: ico('<circle cx="12" cy="12" r="8.600"/><circle cx="12" cy="12" r="2.500"/><path d="M6.900 10.300A5.400 5.400 0 0 1 10.300 6.900M17.100 13.700a5.400 5.400 0 0 1-3.400 3.400"/>'),
    keywords: 'musik player hören ambient lofi synthwave chiptune generativ playlist',
    description: 'Musik spielt acht eigene Stücke, die nicht aus Dateien kommen: Flächen, Bässe, Melodien und Schlagzeug entstehen beim Hören im Synthesizer deines Browsers. Fünf Stimmungen von Ambient bis Chiptune, mit Wiedergabeliste, Warteschlange und einem Visualizer, der zum Klang tanzt.',
    features: [
      'Acht generative Stücke in fünf Stimmungen',
      'Zufall, Wiederholen, Warteschlange und eigene Wiedergabeliste',
      'Live-Visualizer und gerechnete Cover',
      'Spielt weiter, wenn das Fenster im Dock liegt',
      'Widget mit Play/Pause für den Schreibtisch',
    ],
    privacy: [],
    widgets: [{ id: 'now', name: 'Läuft gerade', size: 's' }],
  },
];
