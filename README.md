# Fable 5.2 — Liquid Glass zum Anfassen

Ein interaktiver Liquid-Glass-Showcase und ein komplettes Betriebssystem im Browser – im Geist von macOS, mit eigenem Namen, eigenem Zeichen und eigenen Symbolen.
Reines HTML, CSS und JavaScript: kein Framework, kein Build-Schritt, keine Abhängigkeiten.

**Live:** <https://gozrid.github.io/liquid-glass/> · **fableOS direkt:** <https://gozrid.github.io/liquid-glass/os.html>

Entworfen und programmiert von Claude Fable 5.2 (Anthropic) in Claude Code.

## Was drin ist

### Showcase (`index.html`)

- **Hero** – Glastropfen folgen dem Zeiger, verschmelzen miteinander und brechen die Überschrift (WebGL2-Shader mit SDF-Formen, Dispersion und Glanzlichtern).
- **Material-Labor** – ziehbare Linsen mit Reglern für Brechung, Dispersion, Frost, Glanz und Verschmelzung.
- **Komponenten** – Schalter, Regler, Segmente, Morph-Menü, Morph-Kapsel, Neigekarte, Tab-Leiste, Mitteilungen.
- **Experimente** – Partikel-Strömung, Sequencer mit synthetisierten Klängen, Stoffsimulation, Live-GLSL-Editor, Live-Diagramm, federnde Buchstaben.
- **Drumherum** – Befehlspalette (<kbd>⌘</kbd>/<kbd>Strg</kbd> + <kbd>K</kbd>), Hell/Dunkel-Wechsel, Glas-Zeiger.

### fableOS (`os.html`)

**Als App installierbar (PWA).** Menü mit dem Tropfen → „fableOS installieren …“ (oder App Store, Einstellungen, Installieren-Symbol des Browsers). Danach hat fableOS ein eigenes Fenster und Symbol, startet ohne Netz, öffnet Text- und Bilddateien deines Computers, bietet Kurzbefehle am App-Symbol und zeigt ungelesene Mitteilungen als Zähler. Ein Service Worker speichert alles für unterwegs und meldet neue Versionen unter *Einstellungen → Allgemein → Softwareupdate*.

**App Store.** 21 Apps zum Laden – jede wird beim Klick auf „Laden“ wirklich heruntergeladen, läuft danach offline und lässt sich wieder entfernen. Dazu Updates, Datenschutz-Angaben pro App und **Web-Apps**: jede Adresse wird auf Wunsch zur App mit eigenem Symbol und Fenster.

| Rubrik | Apps |
| --- | --- |
| Alltag | Kalender · Erinnerungen · Uhr (Weltuhr, Wecker, Stoppuhr, Timer) · Wetter · Karten |
| Kreativ | Fotos · Musik (generativer Player) · Kamera · Sprachmemos · Beats · Pixel |
| Spiele | Schach · Sudoku · Minenfeld · Lichtspur · Patience · Sperrzone (3D-Shooter) |
| Werkzeuge | Tafel (Kanban) · Fokus · Farben |
| Entwicklung | Code (Editor mit Ausführen in der Sandbox) |

**Sperrzone** ist ein Shooter aus der Ich-Perspektive mit eigenem WebGL2-Renderer (Schatten der Sonne, erzeugte Texturen, Figuren aus Quadern): zwei Karten, sieben Waffen, Team-Deathmatch, Frei für alle und Herrschaft, Bots mit Wegesuche in drei Stufen, Laufbahn mit Rängen – und Mehrspieler für bis zu acht Spieler, die sich über Einladungscodes direkt von Gerät zu Gerät verbinden (WebRTC, kein Server).

Fest eingebaut sind Dateien, Web, Notizen, Terminal, Rechner, Malen, Klang, Prisma (Spiel), Aktivität, Einstellungen und der App Store. Kalender, Fotos, Musik, Wetter und Uhr sind vorinstalliert.

**Schreibtisch und Fenster**

- Menüleiste mit System-, App-, Ablage-, Bearbeiten- und Fenster-Menü, Statussymbolen (Netz, Akku, „Läuft gerade“), Kontrollzentrum und Mitteilungszentrale.
- Dock mit Lupe, Umsortieren per Ziehen, Zählern und Papierkorb; **Apps** (<kbd>F4</kbd>) zeigt alle Programme als Raster mit Suche und Entfernen-Modus.
- Fenster-Manager: Ziehen, Skalieren, Einrasten an Rändern und Ecken, Kachel-Auswahl am grünen Knopf, **mehrere Schreibtische**, Übersicht (<kbd>F3</kbd>), App-Umschalter (<kbd>⌥</kbd> <kbd>Tab</kbd>), Fenster der letzten Sitzung kommen nach dem Neustart wieder.
- **Suche** (<kbd>⌘</kbd>/<kbd>Strg</kbd> + <kbd>K</kbd>): Apps, Dateien nach Name und Inhalt, Einstellungen, Store, Befehle, Rechnen, Umrechnen (`5 km in mi`), Zwischenablage.
- **Fable** (<kbd>⌥</kbd> <kbd>Leertaste</kbd>): ein Assistent, der fableOS auf Zuruf bedient – „Installiere Schach“, „Timer 5 Minuten“, „Notiz: Milch kaufen“. Getippt oder gesprochen, mit festen Mustern, komplett auf dem Gerät.
- Widgets auf dem Schreibtisch (Uhr, Kalender, Merkzettel, Speicher, Akku und die Widgets installierter Apps), acht Live-Hintergründe oder ein eigenes Bild, Bildschirmschoner, aktive Ecken, Nachtlicht, Sperrbildschirm mit optionalem Passwort.
- Einrichtungsassistent beim allerersten Start („Hallo“ – Name, Design, Akzentfarbe) und **Bildschirmfoto** (<kbd>⌃</kbd> <kbd>⌥</kbd> <kbd>S</kbd>), das als PNG in „Bilder“ landet.

**Dateien**

- Virtuelles Dateisystem in IndexedDB – genug Platz für Fotos und Aufnahmen. Nichts verlässt das Gerät.
- Dateimanager mit Symbol-, Listen- und Spaltenansicht, Mehrfachauswahl, Ziehen & Ablegen (auch auf den Papierkorb im Dock), Vorschau mit der <kbd>Leertaste</kbd>, „Öffnen mit“.
- Echte Dateien hinein und hinaus: vom Computer auf den Schreibtisch oder in ein Fenster ziehen; „Auf dieses Gerät laden“ und „Teilen …“ im Kontextmenü.
- Sicherung: alles (Dateien, Einstellungen, App-Daten) als eine Datei exportieren und wieder einspielen.

## Lokal starten

Die Seite nutzt ES-Module und braucht deshalb einen kleinen Webserver (ein Doppelklick auf `index.html` reicht nicht):

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Auf `localhost` holt der Service Worker jede Datei frisch vom Server (Änderungen sind sofort sichtbar) und nutzt den Cache nur, wenn kein Server läuft.

## Aufbau

```
index.html              Showcase
os.html                 fableOS
404.html                Fehlerseite für GitHub Pages (eigenständig, alles inline)
manifest.webmanifest    Angaben für die installierte App (Name, Symbole, Kurzbefehle, Datei-Handler)
sw.js                   Service Worker: offline nutzbar, erkennt neue Versionen
assets/css/             core.css (Tokens, Glas-Material, Bedienelemente), site.css, os.css, kit.css (Bausteine für Apps)
assets/icons/           Symbole der installierten App (die einzigen Bilddateien – der Rest ist Code)
assets/js/core/         gemeinsame Bausteine: WebGL-Bühne, Glas-Effekte, Federn, Audio, Icons, Rechen-Parser
assets/js/site/         Showcase: Hero, Labor, Komponenten, Demos, Befehlspalette
assets/js/os/           fableOS: Fenster-Manager, Dateisystem, Registry, PWA, Schreibtisch
assets/js/os/shell/     Menüleiste, Dock, Apps-Übersicht, Suche, Mitteilungen, Assistent, Bildschirmschoner
assets/js/os/apps/      fest eingebaute Apps
assets/js/os/store/     App Store: catalog/ (Einträge je Rubrik) und apps/ (ein Modul je App)
.nojekyll               GitHub Pages liefert die Dateien unverändert aus
```

## Eine App schreiben

Eine Store-App ist **eine Datei** `assets/js/os/store/apps/<id>.js` plus ein Katalogeintrag in `assets/js/os/store/catalog/<rubrik>.js`:

```js
// store/apps/hallo.js
import { h } from '../../../core/util.js';
import { style, appStore } from '../../kit.js';

style('hallo', `.hallo-box { padding: 24px; font-size: 1.4rem; }`);

export default {
  width: 420, height: 300,
  mount(win) {
    const db = appStore('hallo');                       // dauerhafter Speicher der App
    const n = db.get('besuche', 0) + 1;
    db.set('besuche', n);
    win.body.append(h('div.hallo-box', `Hallo! Besuch Nr. ${n}.`));
    return { onClose() { /* aufräumen */ } };
  },
};
```

```js
// store/catalog/werkzeuge.js – Eintrag
{ id: 'hallo', name: 'Hallo', tagline: 'Sagt freundlich Hallo', category: 'Werkzeuge', version: '1.0',
  colors: ['#62e0ff', '#2f7cf6'], icon: 'sparkles', description: '…', features: ['…'], privacy: [] }
```

`os.html?dev=hallo` startet das System und öffnet die App direkt. `kit.js` bringt Dialoge, Dateidialoge, Import/Export und Layout-Klassen mit; Apps können außerdem Widgets (`widgets`), einen Hintergrunddienst (`background`) und Dateitypen (`accepts`) anmelden.

## Veröffentlichung

GitHub Pages liefert den Branch `main` aus dem Wurzelverzeichnis aus (Settings → Pages → „Deploy from a branch“).
Alle Pfade sind relativ, ein Push auf `main` genügt für eine neue Version. Installierte Apps bemerken die neue Version beim nächsten Start und bieten einen Neustart an.

## Browser

- Entwickelt in Chrome; fableOS samt allen 21 Store-Apps ist zusätzlich automatisiert in WebKit (der Engine von Safari) und Firefox durchgespielt. Die Lichtbrechung an den Rändern von Navigation und Dock nutzt eine Chromium-Funktion; andere Browser zeigen dort Unschärfe.
- Installieren: Chrome und Edge bieten es direkt an; in Safari über *Ablage → Zum Dock hinzufügen* (Mac) bzw. *Teilen → Zum Home-Bildschirm* (iPhone/iPad). Datei-Handler, Kurzbefehle und der Zähler am Symbol sind Chromium-Funktionen.
- Die Glastropfen im Hero und im Labor brauchen WebGL2. Ohne WebGL2 erscheint ein statischer Hintergrund.
- Externe Anfragen gibt es nur auf ausdrücklichen Wunsch: Wetter lädt Daten von open-meteo.com, Karten von openstreetmap.org (Ortssuche über nominatim.openstreetmap.org), „Im Web suchen“ öffnet DuckDuckGo in einem neuen Tab, Web-Apps laden ihre jeweilige Adresse, und Sperrzone fragt beim Eröffnen oder Beitreten einer Mehrspieler-Partie stun.l.google.com, um die Geräte zusammenzubringen (die Partie selbst läuft direkt zwischen den Geräten).
