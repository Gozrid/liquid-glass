// alltag.js — Store-Katalog, Rubrik „alltag“. Einträge: siehe README, Abschnitt „Eine App schreiben“.

const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export default [
  {
    id: 'calendar',
    name: 'Kalender',
    tagline: 'Termine im Blick, Monat für Monat',
    category: 'Alltag',
    version: '1.0',
    colors: ['#ff8a7a', '#e23a4e'],
    glyph: svg('<rect x="3.5" y="5" width="17" height="15.500" rx="3.600"/><path d="M3.500 10h17M8 3v3.500M16 3v3.500"/><circle cx="12" cy="15.200" r="1.900" fill="currentColor" stroke="none"/>'),
    keywords: 'termin datum woche monat erinnerung planer agenda',
    description: 'Plane deine Tage in einer ruhigen Monats- oder Wochenansicht. Mehrere farbige Kalender halten Privates, Arbeit und Familie auseinander, und auf Wunsch erinnert dich fableOS rechtzeitig an jeden Termin.',
    features: [
      'Monats- und Wochenansicht mit Stundenraster',
      'Beliebig viele farbige Kalender, einzeln ausblendbar',
      'Erinnerungen als Mitteilung – auch bei geschlossenem Fenster',
      'Tastatur: ← → blättern, T heute, M/W Ansicht, N neuer Termin',
    ],
    privacy: [],
    background: true,
    widgets: [{ id: 'today', name: 'Heute', size: 's' }],
  },
  {
    id: 'reminders',
    name: 'Erinnerungen',
    tagline: 'Aufgaben abhaken, nichts vergessen',
    category: 'Alltag',
    version: '1.0',
    colors: ['#8f9dff', '#5148e0'],
    glyph: svg('<circle cx="6.200" cy="6.500" r="2.300"/><path d="M11.500 6.500H20"/><circle cx="6.200" cy="12" r="2.300" fill="currentColor"/><path d="M11.500 12H20"/><circle cx="6.200" cy="17.500" r="2.300"/><path d="M11.500 17.500H17"/>'),
    keywords: 'aufgaben todo liste erledigen einkauf fällig abhaken',
    description: 'Sammle alles, was du nicht vergessen willst, in farbigen Listen. Erinnerungen bekommen auf Wunsch Datum, Uhrzeit, Priorität und Notiz – ist es so weit, meldet sich fableOS. Die intelligenten Listen zeigen auf einen Blick, was heute ansteht.',
    features: [
      'Schnelle Eingabe: tippen, Enter, weiter',
      'Heute, Geplant, Alle und Erledigt als intelligente Listen',
      'Fälligkeit mit Uhrzeit, Priorität, Notiz und Markierung',
      'Mitteilung zur fälligen Zeit – auch bei geschlossenem Fenster',
    ],
    privacy: [],
    background: true,
    widgets: [{ id: 'today', name: 'Heute fällig', size: 's' }],
  },
];
