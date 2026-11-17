// setup.js — Einrichtungsassistent beim allerersten Start („Hallo“) und das Bildschirmfoto

import { h, reducedMotion } from '../../core/util.js';
import { icon, LOGO } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { sys, settings, set, ACCENTS } from '../sys.js';
import { vfs, HOME } from '../vfs.js';

const GREETINGS = ['Hallo', 'Hello', 'Bonjour', 'Hola', 'Ciao', 'Hej', 'Olá', 'Merhaba', 'こんにちは', 'Servus'];

/**
 * Führt durch die ersten Schritte: Begrüßung, Name, Erscheinungsbild, Hinweise.
 * Löst sich auf, sobald der Assistent beendet (oder übersprungen) wurde.
 */
export function runSetup() {
  return new Promise((resolve) => {
    let step = 0;
    let timer = 0;
    const stage = h('div.su-stage');
    const dots = h('div.su-dots');
    const bBack = h('button.kit-btn.round', { type: 'button' }, 'Zurück');
    const bNext = h('button.kit-btn.primary.round.big', { type: 'button' }, 'Los geht’s');
    const bSkip = h('button.su-skip', { type: 'button' }, 'Überspringen');
    const el = h('div#setup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'fableOS einrichten' },
      bSkip, h('div.su-card', stage, h('div.su-nav', bBack, dots, bNext)));
    document.body.append(el);

    const name = h('input.su-input', { type: 'text', value: settings.user === 'Gast' ? '' : settings.user, maxLength: 24, placeholder: 'Dein Name', autocomplete: 'off', spellcheck: false, 'aria-label': 'Dein Name' });
    const saveName = () => set('user', name.value.trim() || 'Gast');

    const steps = [
      () => {
        const word = h('span.su-hello.grad-text', GREETINGS[0]);
        let i = 0;
        clearInterval(timer);
        if (!reducedMotion.matches) {
          timer = setInterval(() => {
            word.classList.add('out');
            setTimeout(() => { i = (i + 1) % GREETINGS.length; word.textContent = GREETINGS[i]; word.classList.remove('out'); }, 420);
          }, 2100);
        }
        return [h('span.su-logo', { html: LOGO }), word, h('p.su-lede', 'Willkommen bei fableOS – einem Betriebssystem, das komplett in deinem Browser läuft. In drei kurzen Schritten ist es eingerichtet.')];
      },
      () => {
        setTimeout(() => name.focus({ preventScroll: true }), 80);
        return [h('span.su-ico', { html: icon('user') }), h('h2', 'Wie heißt du?'), h('p.su-lede', 'Dein Name steht auf dem Sperrbildschirm und in Begrüßungen. Du kannst ihn jederzeit ändern.'), name];
      },
      () => {
        const themes = h('div.set-themes.su-themes', [['light', 'Hell'], ['dark', 'Dunkel'], ['auto', 'Automatisch']].map(([mode, label]) => {
          const on = mode === 'auto' ? settings.autoTheme : !settings.autoTheme && settings.theme === mode;
          return h('button', {
            type: 'button', class: `theme-card t-${mode}${on ? ' is-on' : ''}`,
            onclick: () => { if (mode === 'auto') set('autoTheme', true); else { set('autoTheme', false); set('theme', mode); } paint(); },
          }, h('span.theme-prev', h('i'), h('i'), h('i')), h('b', label));
        }));
        const swatches = h('div.set-swatches.su-swatches', ACCENTS.map(([label, col]) => h('button', {
          type: 'button', title: label, 'aria-label': label, class: settings.accent === col ? 'is-on' : '', style: { '--c': col },
          onclick: () => { set('accent', col); paint(); },
        })));
        return [h('h2', 'So soll es aussehen'), h('p.su-lede', 'Wähle Design und Akzentfarbe – die Vorschau dahinter ändert sich sofort.'), themes, swatches];
      },
      () => [
        h('span.su-ico', { html: icon('check') }), h('h2', `Alles bereit${settings.user !== 'Gast' ? `, ${settings.user}` : ''}!`),
        h('ul.su-list',
          h('li', { html: `${icon('download')}<span><b>App Store</b> Über 20 Apps warten auf dich – ein Klick auf „Laden“ genügt.</span>` }),
          h('li', { html: `${icon('search')}<span><b>Suche</b> ⌘K bzw. Strg+K findet Apps, Dateien und Einstellungen.</span>` }),
          h('li', { html: `${icon('sparkles')}<span><b>Fable</b> Das Funkeln oben rechts bedient das System auf Zuruf.</span>` }),
          h('li', { html: `${icon('lock')}<span><b>Privat</b> Alles bleibt auf diesem Gerät. Nichts wird hochgeladen.</span>` })),
      ],
    ];

    function paint() {
      stage.replaceChildren(...steps[step]());
      dots.replaceChildren(...steps.map((_, i) => h('i', { class: i === step ? 'is-on' : '' })));
      bBack.style.visibility = step ? 'visible' : 'hidden';
      bNext.textContent = step === 0 ? 'Los geht’s' : step === steps.length - 1 ? 'fableOS starten' : 'Weiter';
    }
    const finish = () => {
      clearInterval(timer);
      saveName();
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 600);
    };
    const go = (d) => {
      if (step === 1) saveName();
      if (step + d >= steps.length) { finish(); return; }
      step = Math.max(0, step + d);
      if (step !== 0) clearInterval(timer);
      stage.classList.remove('in');
      void stage.offsetWidth;
      stage.classList.add('in');
      paint();
      sfx.tick();
    };
    bNext.addEventListener('click', () => go(1));
    bBack.addEventListener('click', () => go(-1));
    bSkip.addEventListener('click', finish);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); go(1); } else if (e.key === 'Escape') finish();
    });
    paint();
    requestAnimationFrame(() => { el.classList.add('on'); bNext.focus({ preventScroll: true }); });
  });
}

/** Bildschirmfoto des Tabs → „Bilder/Bildschirmfotos“. Der Browser fragt einmal um Erlaubnis. */
export async function screenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    sys.notify({ title: 'Bildschirmfoto', body: 'Dieser Browser kann den Bildschirm nicht aufnehmen.', icon: 'close', force: true });
    return null;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
    const video = h('video', { muted: true, playsInline: true });
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 450));        // der Auswahldialog des Browsers muss erst verschwinden
    const cv = h('canvas', { width: video.videoWidth, height: video.videoHeight });
    cv.getContext('2d').drawImage(video, 0, 0);
    const data = cv.toDataURL('image/png');
    const dir = `${HOME}/Bilder/Bildschirmfotos`;
    if (!vfs.exists(dir)) vfs.mkdir(dir);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const file = vfs.unique(dir, `Bildschirmfoto ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} um ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.png`);
    const path = `${dir}/${file}`;
    vfs.write(path, data, 'image/png');
    const flash = h('div.shot-flash');
    document.body.append(flash);
    setTimeout(() => flash.remove(), 500);
    sfx.pop();
    sys.notify({ title: 'Bildschirmfoto gesichert', body: `${file} liegt in „Bilder“.`, icon: 'image', onClick: () => sys.quicklook([path]) });
    return path;
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') sys.notify({ title: 'Bildschirmfoto fehlgeschlagen', body: String(err?.message || err), icon: 'close', force: true });
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}
sys.screenshot = screenshot;
