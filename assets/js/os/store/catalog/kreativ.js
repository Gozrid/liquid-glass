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
];
