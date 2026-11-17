// assistant.js — „Fable“: ein Assistent, der fableOS auf Zuruf bedient (getippt oder gesprochen).
// Alles läuft lokal über Muster-Erkennung – kein Sprachmodell, kein Server.

import { $, h, pick } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { evaluate, formatNumber, looksLikeMath } from '../../core/calc.js';
import { sys, settings, set, apps, ACCENTS, WALLPAPERS } from '../sys.js';
import { registry } from '../registry.js';
import { vfs, HOME } from '../vfs.js';

const norm = (s) => s.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').replace(/[?!.]+$/g, '').trim();
const JOKES = [
  'Warum sind Glasfenster so ehrlich? Weil man sie sofort durchschaut.',
  'Ich wollte einen Witz über den Papierkorb machen – aber der war Müll.',
  'Was macht ein Fenster im Fitnessstudio? Es maximiert sich.',
  'Mein Lieblingsort? Das Dock. Da ist immer was los, und alle springen vor Freude.',
  'Ein Byte geht in eine Bar. Der Wirt: „Alles in Ordnung?“ – „Nur ein bisschen daneben.“',
];
const HELP = ['Öffne das Terminal', 'Dunkles Design', 'Timer 5 Minuten', 'Notiz: Milch kaufen', 'Was ist 12 × 7?', 'Installiere Schach', 'Wie spät ist es?', 'Erzähl einen Witz'];

function findApp(name) {
  const q = norm(name).replace(/^(die|das|den|der)\s+/, '').replace(/\s+app$/, '');
  if (!q) return null;
  const list = [...apps.values()];
  return list.find((a) => norm(a.name) === q || a.id === q)
    || list.find((a) => norm(a.name).startsWith(q) || q.startsWith(norm(a.name)))
    || list.find((a) => norm(a.keywords || '').split(/\s+/).includes(q)) || null;
}
const findStore = (name) => {
  const q = norm(name).replace(/^(die|das|den|der)\s+/, '').replace(/\s+app$/, '');
  return registry.catalog.find((e) => norm(e.name) === q || e.id === q) || registry.catalog.find((e) => norm(e.name).startsWith(q) || norm(e.keywords || '').split(/\s+/).includes(q)) || null;
};
const minutes = (n, unit) => Number(String(n).replace(',', '.')) * (/^s/.test(unit) ? 1 / 60 : /^(h|st)/.test(unit) ? 60 : 1);
const span = (min) => (min < 1 ? `${Math.round(min * 60)} Sekunden` : min === 1 ? '1 Minute' : min < 60 ? `${formatNumber(min)} Minuten` : `${formatNumber(min / 60)} Stunden`);

export function initAssistant(power) {
  const log = h('div.fa-log.scroll', { 'aria-live': 'polite' });
  const input = h('input.fa-input', { type: 'text', placeholder: 'Frag Fable …', autocomplete: 'off', spellcheck: false, 'aria-label': 'Frage an Fable' });
  const mic = h('button.tool.fa-mic', { type: 'button', 'aria-label': 'Sprechen', title: 'Sprechen', html: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/></svg>' });
  const orb = h('span.fa-orb', { 'aria-hidden': 'true' });
  const chips = h('div.fa-chips');
  const el = h('section#assistant.glass.thick', { hidden: true, 'aria-label': 'Fable' },
    h('header.fa-head', orb, h('b', 'Fable'), h('span', 'bedient fableOS für dich'), h('button.tool', { type: 'button', 'aria-label': 'Schließen', html: icon('close'), onclick: () => close() })),
    log, chips, h('div.fa-field', input, mic));
  $('#overlays').append(el);
  let open = false;
  const timers = new Set();

  const say = (text, who = 'fable') => {
    const row = h(`div.fa-msg.is-${who}`, text);
    log.append(row);
    while (log.children.length > 30) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (who === 'fable' && settings.voice && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
    return row;
  };
  const setChips = (list) => chips.replaceChildren(...list.map((t) => h('button.kit-chip', { type: 'button', onclick: () => ask(t) }, t)));
  const remind = (min, text) => {
    const id = setTimeout(() => {
      timers.delete(id);
      sfx.chime();
      sys.notify({ title: text ? 'Erinnerung' : 'Timer abgelaufen', body: text || `${span(min)} sind um.`, icon: 'clock', force: true, ttl: 12000 });
    }, min * 60000);
    timers.add(id);
  };

  // ---------- Absichten: erstes passendes Muster gewinnt ----------
  const intents = [
    [/^(hallo|hi|hey|moin|servus|guten (tag|morgen|abend))\b/, () => pick([`Hallo ${settings.user}! Was darf ich für dich tun?`, 'Hi! Sag einfach, was ich öffnen, einstellen oder ausrechnen soll.'])],
    [/^(was kannst du|hilfe|help|was geht)/, () => 'Ich öffne und installiere Apps, stelle Design, Hintergrund und Lautstärke ein, rechne, stelle Timer, schreibe Notizen und finde Dateien. Probier einen der Vorschläge unten.'],
    [/^(wer bist du|wie heisst du)/, () => 'Ich bin Fable, der Assistent von fableOS. Ich verstehe feste Befehle und arbeite komplett auf diesem Gerät – nichts wird irgendwohin geschickt.'],
    [/\b(wie spat|wieviel uhr|wie viel uhr|uhrzeit)\b/, () => `Es ist ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`],
    [/\b(welcher tag|welches datum|datum|wochentag|den wievielten)\b/, () => `Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`],
    [/^(?:installiere|lade|hol(?: mir)?)\s+(.+)$/, (m) => {
      const e = findStore(m[1]);
      if (!e) return `„${m[1]}“ finde ich im App Store nicht. Ich öffne ihn, dann kannst du stöbern.` && (sys.open('store', { q: m[1] }), `„${m[1]}“ finde ich nicht direkt – ich habe den App Store mit dieser Suche geöffnet.`);
      if (registry.isInstalled(e.id)) { sys.open(e.id); return `${e.name} ist schon installiert – ich öffne die App.`; }
      registry.install(e.id).then(() => { say(`${e.name} ist installiert.`); sys.notify({ title: `${e.name} ist installiert`, body: 'Aus dem App Store geladen.', app: e.id }); })
        .catch((err) => say(`Das Laden hat nicht geklappt: ${err.message}`));
      return `Ich lade ${e.name} aus dem App Store …`;
    }],
    [/^(?:deinstalliere|entferne|losche)\s+(?:die app\s+)?(.+)$/, (m) => {
      const a = findApp(m[1]);
      if (!a || !registry.isRemovable(a.id)) return a ? `${a.name} gehört fest zu fableOS und lässt sich nicht entfernen.` : `Eine App namens „${m[1]}“ ist nicht installiert.`;
      registry.uninstall(a.id);
      return `${a.name} ist entfernt.`;
    }],
    [/^(?:schliesse|schliess|beende|quit)\s+(.+)$/, (m) => {
      if (/^alle(s| fenster)?$/.test(m[1])) { sys.wm.closeAll(); return 'Alle Fenster sind geschlossen.'; }
      const a = findApp(m[1]);
      if (!a || !sys.wm.byApp(a.id).length) return `${a ? a.name : `„${m[1]}“`} läuft gerade nicht.`;
      sys.wm.quitApp(a.id);
      return `${a.name} ist beendet.`;
    }],
    [/^(?:offne|starte|start|zeig(?:e)?(?: mir)?|open|gehe zu)\s+(.+)$/, (m) => {
      const t = m[1];
      if (/einstellungen/.test(t)) { sys.open('settings'); return 'Die Systemeinstellungen sind offen.'; }
      if (/^(alle )?(apps|programme)$/.test(t)) { sys.launchpad?.open(); return 'Hier sind alle Apps.'; }
      if (/ubersicht|alle fenster/.test(t)) { sys.wm.toggleOverview(true); return 'Die Übersicht ist offen.'; }
      if (/mitteilungen/.test(t)) { sys.center?.open(); return 'Die Mitteilungszentrale ist offen.'; }
      const a = findApp(t);
      if (a) { sys.open(a.id); return `${a.name} ist offen.`; }
      const e = findStore(t);
      if (e) { sys.open('store', { app: e.id }); return `${e.name} ist noch nicht installiert – ich zeige dir die App im Store.`; }
      const files = vfs.find(t, HOME);
      if (files.length) { sys.openPath(files[0]); return `Ich öffne „${files[0].split('/').pop()}“.`; }
      return `„${t}“ kenne ich weder als App noch als Datei.`;
    }],
    [/\b(dunkel|dunkles|dark|nachtmodus)\b/, () => { set('autoTheme', false); set('theme', 'dark'); return 'Dunkles Design ist an.'; }],
    [/\b(hell|helles|light|tagmodus)\b/, () => { set('autoTheme', false); set('theme', 'light'); return 'Helles Design ist an.'; }],
    [/\bakzent(?:farbe)?\s+(?:auf\s+)?(\S+)/, (m) => {
      const hit = ACCENTS.find(([n]) => norm(n) === m[1]);
      if (!hit) return `Diese Farbe kenne ich nicht. Zur Wahl stehen: ${ACCENTS.map(([n]) => n).join(', ')}.`;
      set('accent', hit[1]);
      return `Akzentfarbe ist jetzt ${hit[0]}.`;
    }],
    [/\b(hintergrund|wallpaper)\b(?:.*?\b(?:auf|zu)\s+(\S+))?/, (m) => {
      const keys = Object.keys(WALLPAPERS);
      const k = m[2] ? keys.find((x) => x === m[2] || norm(WALLPAPERS[x].name) === m[2]) : keys[(keys.indexOf(settings.wallpaper) + 1) % keys.length];
      if (!k) return `Diesen Hintergrund gibt es nicht. Zur Wahl stehen: ${keys.map((x) => WALLPAPERS[x].name).join(', ')}.`;
      set('wallImage', '');
      set('wallpaper', k);
      return `Der Hintergrund ist jetzt „${WALLPAPERS[k].name}“.`;
    }],
    [/\blautstarke\b.*?(\d{1,3})/, (m) => { set('volume', Math.min(100, Number(m[1])) / 100); return `Lautstärke steht auf ${Math.min(100, Number(m[1]))} %.`; }],
    [/\b(lauter|leiser)\b/, (m) => { set('volume', Math.max(0, Math.min(1, settings.volume + (m[1] === 'lauter' ? 0.15 : -0.15)))); return `Lautstärke: ${Math.round(settings.volume * 100)} %.`; }],
    [/\b(stumm|ton aus|tone aus)\b/, () => { set('sounds', false); return 'Systemtöne sind aus.'; }],
    [/\b(ton an|tone an)\b/, () => { set('sounds', true); return 'Systemtöne sind an.'; }],
    [/\bhelligkeit\b.*?(\d{1,3})/, (m) => { set('brightness', Math.max(35, Math.min(100, Number(m[1]))) / 100); return `Helligkeit steht auf ${Math.round(settings.brightness * 100)} %.`; }],
    [/\b(heller|dunkler)\b/, (m) => { set('brightness', Math.max(0.35, Math.min(1, settings.brightness + (m[1] === 'heller' ? 0.15 : -0.15)))); return `Helligkeit: ${Math.round(settings.brightness * 100)} %.`; }],
    [/\bnicht storen\b/, () => { set('dnd', !settings.dnd); return settings.dnd ? '„Nicht stören“ ist an. Mitteilungen sammle ich still.' : '„Nicht stören“ ist aus.'; }],
    [/\bnachtlicht\b/, () => { set('nightShift', !settings.nightShift); return settings.nightShift ? 'Nachtlicht ist an – wärmere Farben.' : 'Nachtlicht ist aus.'; }],
    [/\bvollbild\b/, () => { sys.toggleFullscreen(); return 'Vollbild umgeschaltet.'; }],
    [/^(?:timer|wecke mich in|stell(?:e)? (?:einen )?timer (?:auf|fur))\s*(?:auf|fur|in)?\s*([\d,.]+)\s*(sekunden?|sek|s|minuten?|min|m|stunden?|std|h)\b/, (m) => {
      const min = minutes(m[1], m[2]);
      if (!(min > 0) || min > 24 * 60) return 'Timer gehen von einer Sekunde bis 24 Stunden.';
      remind(min, '');
      return `Timer läuft: ${span(min)}. Ich melde mich.`;
    }],
    [/^erinner(?:e|n)? mich in\s+([\d,.]+)\s*(sekunden?|sek|s|minuten?|min|m|stunden?|std|h)\s+(?:an|daran,?)\s+(.+)$/, (m, raw) => {
      const min = minutes(m[1], m[2]);
      const text = raw.slice(raw.toLowerCase().search(/\b(an|daran)\b/)).replace(/^(an|daran,?)\s+/i, '');
      remind(min, text);
      return `Mach ich – in ${span(min)} erinnere ich dich an „${text}“.`;
    }],
    [/^(?:notiz|notiere|schreib(?:e)?(?: eine)? notiz|merk(?:e)? dir)\s*[:,]?\s*(.+)$/, (m, raw) => {
      const text = raw.replace(/^[^:,]*?(notiz|notiere|merke? dir)\s*[:,]?\s*/i, '').trim() || m[1];
      const dir = `${HOME}/Dokumente/Notizen`;
      try {
        if (!vfs.exists(dir)) vfs.mkdir(dir);
        const path = `${dir}/${vfs.unique(dir, `${text.slice(0, 28).replace(/[/\\:]/g, ' ').trim() || 'Notiz'}.txt`)}`;
        vfs.write(path, `${text}\n`);
        sys.openPath(path);
        return 'Notiert – die Notiz ist offen.';
      } catch (err) { return `Das Speichern hat nicht geklappt: ${err.message}`; }
    }],
    [/^(?:suche?|finde?)\s+(?:nach\s+)?(.+)$/, (m) => { close(); sys.search(m[1]); return `Ich suche nach „${m[1]}“.`; }],
    [/\b(pause|pausiere|stopp die musik|musik aus)\b/, () => { const p = sys.nowPlaying; if (p?.playing) { p.toggle(); return 'Pausiert.'; } return 'Gerade läuft nichts.'; }],
    [/\b(weiter|nachster? (titel|song)|skip)\b/, () => { const p = sys.nowPlaying; if (p?.next) { p.next(); return 'Nächster Titel.'; } return 'Gerade läuft nichts, das ich weiterschalten könnte.'; }],
    [/\b(spiel(?:e)?|musik)\b/, () => {
      const p = sys.nowPlaying;
      if (p && !p.playing) { p.toggle(); return 'Die Wiedergabe läuft.'; }
      if (apps.has('music')) { sys.open('music'); return 'Ich öffne Musik – drück auf Play.'; }
      sys.open('synth');
      return 'Musik ist nicht installiert. Ich öffne solange das Klang-Studio.';
    }],
    [/\bwetter\b/, () => { if (apps.has('weather')) { sys.open('weather'); return 'Hier ist das Wetter.'; } sys.open('store', { app: 'weather' }); return 'Die Wetter-App ist nicht installiert – ich zeige sie dir im Store.'; }],
    [/\b(sperr(?:e|en)?|bildschirm sperren)\b/, () => { setTimeout(() => { close(); power.lock(); }, 500); return 'Ich sperre den Bildschirm.'; }],
    [/\b(neu ?start(?:e|en)?|reboot)\b/, () => { setTimeout(power.restart, 900); return 'fableOS startet neu …'; }],
    [/\b(bildschirmschoner|ruhezustand)\b/, () => { setTimeout(() => sys.saver?.start(), 500); return 'Gute Erholung.'; }],
    [/\bpapierkorb\b.*\bleer/, () => { sys.emptyTrash(); return 'Ich frage kurz nach, dann ist der Papierkorb leer.'; }],
    [/\b(neuer schreibtisch|schreibtisch hinzufugen)\b/, () => { sys.wm.addSpace(); sys.wm.setSpace(sys.wm.spaceCount - 1); return `Schreibtisch ${sys.wm.spaceCount} ist bereit.`; }],
    [/\b(witz|bring mich zum lachen)\b/, () => pick(JOKES)],
    [/\b(danke|merci|super|top)\b/, () => pick(['Gern!', 'Immer wieder gern.', 'Dafür bin ich da.'])],
  ];

  function answer(raw) {
    const q = norm(raw);
    if (!q) return null;
    const math = raw.replace(/^(was ist|wieviel ist|wie viel ist|rechne|berechne)\s+/i, '').replace(/\?+$/, '').replace(/\bmal\b/gi, '×').replace(/\bgeteilt durch\b/gi, '÷').replace(/\bplus\b/gi, '+').replace(/\bminus\b/gi, '−');
    if (looksLikeMath(math)) {
      try { return `${math.trim()} = ${formatNumber(evaluate(math))}`; } catch { /* doch keine Rechnung */ }
    }
    for (const [re, fn] of intents) {
      const m = re.exec(q);
      if (m) { try { return fn(m, raw.trim()); } catch (err) { return `Dabei ist etwas schiefgegangen: ${err.message}`; } }
    }
    const a = findApp(q);
    if (a) { sys.open(a.id); return `${a.name} ist offen.`; }
    return 'Das habe ich nicht verstanden. Ich kenne feste Befehle – ein paar Beispiele stehen unten.';
  }
  function ask(text) {
    if (!text?.trim()) return;
    show();
    say(text.trim(), 'you');
    input.value = '';
    orb.classList.add('is-busy');
    setTimeout(() => {
      orb.classList.remove('is-busy');
      const reply = answer(text);
      if (reply) say(reply);
      setChips(HELP.filter((x) => x !== text).sort(() => Math.random() - 0.5).slice(0, 4));
      // Befehle öffnen oder schließen Fenster – der Fokus gehört danach wieder ins Eingabefeld
      if (open) setTimeout(() => { if (open) input.focus({ preventScroll: true }); }, 80);
    }, 260);
  }

  // ---------- Spracheingabe (Web Speech API, wo vorhanden) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  mic.hidden = !SR;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = 'de-DE';
      rec.interimResults = true;
      rec.onresult = (e) => {
        const r = e.results[e.results.length - 1];
        input.value = r[0].transcript;
        if (r.isFinal) ask(r[0].transcript);
      };
      rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') say(e.error === 'not-allowed' ? 'Ich darf das Mikrofon nicht benutzen – erlaube es in deinem Browser.' : 'Die Spracherkennung ist gerade nicht verfügbar.'); };
      rec.onend = () => { rec = null; mic.classList.remove('is-on'); orb.classList.remove('is-listening'); };
      rec.start();
      mic.classList.add('is-on');
      orb.classList.add('is-listening');
    } catch { rec = null; say('Die Spracherkennung ist gerade nicht verfügbar.'); }
  });

  function close() {
    if (!open) return;
    open = false;
    rec?.stop();
    el.classList.remove('on');
    setTimeout(() => { if (!open) el.hidden = true; }, 300);
  }
  function show() {
    if (open) return;
    open = true;
    el.hidden = false;
    if (!log.children.length) { say(`Hallo ${settings.user}, ich bin Fable. Was soll ich tun?`); setChips(HELP.slice(0, 4)); }
    requestAnimationFrame(() => { el.classList.add('on'); input.focus({ preventScroll: true }); });
    sfx.tick();
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') ask(input.value);
    else if (e.key === 'Escape') close();
  });
  document.addEventListener('pointerdown', (e) => { if (open && !el.contains(e.target) && !e.target.closest('.mb-fable')) close(); }, true);
  addEventListener('keydown', (e) => { if (open && e.key === 'Escape') close(); });
  sys.assistant = { open: show, close, toggle: () => (open ? close() : show()), ask, answer, get isOpen() { return open; } };
  return sys.assistant;
}
