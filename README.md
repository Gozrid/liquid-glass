# Fable 5.2 — Liquid Glass zum Anfassen

Ein interaktiver Liquid-Glass-Showcase und ein kleines Betriebssystem im Browser.
Reines HTML, CSS und JavaScript: kein Framework, kein Build-Schritt, keine Bilddateien, keine Abhängigkeiten.

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

- Startsequenz, Sperrbildschirm, Menüleiste, Kontrollzentrum, Dock mit Lupe, Suche, Mitteilungen, Widgets, vier Live-Hintergründe.
- Fenster-Manager: Ziehen, Skalieren, Minimieren, Einrasten an Rändern und Ecken, Übersicht (<kbd>F3</kbd>).
- Apps: Terminal, Dateien, Notizen, Rechner, Einstellungen, Malen, Klang, Web, Prisma (Spiel), Aktivität, Über fableOS.
- Virtuelles Dateisystem und Einstellungen liegen im `localStorage` des Browsers – nichts verlässt das Gerät.

## Lokal starten

Die Seite nutzt ES-Module und braucht deshalb einen kleinen Webserver (ein Doppelklick auf `index.html` reicht nicht):

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Aufbau

```
index.html          Showcase
os.html             fableOS
404.html            Fehlerseite für GitHub Pages (eigenständig, alles inline)
assets/css/         core.css (Tokens, Glas-Material, Bedienelemente), site.css, os.css
assets/js/core/     gemeinsame Bausteine: WebGL-Bühne, Glas-Effekte, Federn, Audio, Icons, Rechen-Parser
assets/js/site/     Showcase: Hero, Labor, Komponenten, Demos, Befehlspalette
assets/js/os/       fableOS: Fenster-Manager, Shell, Dateisystem, Apps
.nojekyll           GitHub Pages liefert die Dateien unverändert aus
```

## Veröffentlichung

GitHub Pages liefert den Branch `main` aus dem Wurzelverzeichnis aus (Settings → Pages → „Deploy from a branch“).
Alle Pfade sind relativ, ein Push auf `main` genügt für eine neue Version.

## Browser

- Entwickelt und getestet in Chrome. Die Lichtbrechung an den Rändern von Navigation und Dock nutzt eine Chromium-Funktion; andere Browser zeigen dort Unschärfe.
- Die Glastropfen im Hero und im Labor brauchen WebGL2. Ohne WebGL2 erscheint ein statischer Hintergrund.
- Einzige externe Anfrage: das Lesezeichen „Karte“ in der Web-App von fableOS bettet beim Anklicken OpenStreetMap ein.
