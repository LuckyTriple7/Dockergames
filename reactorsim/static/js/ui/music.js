// Musik & aufgenommene Klangeffekte.
//
// Anders als Horn (annunciator.js) -- die Klaenge dort synthetisiert der
// Browser selbst per WebAudio-Oszillatoren -- sind das hier echte Aufnahmen
// (static/audio/*.mp3, Pixabay-Lizenz, siehe LICENSE.md). Einfaches
// <audio>-Element statt AudioContext/decodeAudioData: fuer feste Dateien
// reicht das, und Lautstaerke/Loop/Pause kommen dann geschenkt.
//
// Wie bei Horn gilt: der erste play()-Aufruf muss aus einer echten
// Nutzergeste kommen, sonst verweigert der Browser jeden Ton.

const BASE = (window.RS_CFG ? `/s/${window.RS_CFG.version}` : '') + '/audio/';

// Hauptschalter fuer playClip() -- main.js ruft setMuted() aus
// applyAudioPrefs() (der EINEN Stelle fuer den Tonzustand, siehe dort).
// Ohne das ignorierten Schalterklicks (controls.js) und der Geigerzaehler-
// Alarm (main.js onAlert) den Mute-Knopf komplett: sie riefen playClip()
// direkt auf, ohne je einen enabled-Zustand zu pruefen -- anders als Horn
// (annunciator.js), das schon vorher sein eigenes `enabled` abfragte. Ein
// zentraler Schalter HIER statt an jeder Aufrufstelle, aus demselben Grund
// wie beim Klick-Sound selbst: eine vergessene Pruefung ist sonst nur eine
// Frage der Zeit.
let muted = false;
export function setMuted(v) { muted = !!v; }

/**
 * Einmaliger Clip, feuert und vergisst -- fuer SCRAM, Kernschmelze und die
 * akustische Vorwarnung vor einem geplanten Ereignis. Eigenes Audio-Objekt
 * je Aufruf: zwei schnell hintereinander kommende Klaenge sollen sich nicht
 * gegenseitig abschneiden.
 */
export function playClip(name, volume = 1) {
  if (muted) return;
  try {
    const a = new Audio(BASE + name);
    a.volume = volume;
    a.play().catch(() => { /* kein Autoplay-Recht -- naechstes Mal vielleicht */ });
  } catch { /* kein Audio in dieser Umgebung, kein Absturz deshalb */ }
}

/**
 * Schleife, die nur laeuft, solange sie regelmaessig "angestossen" wird --
 * fuer die Stabfahrt: ein einzelner Klick/Tastendruck soll kurz zu hoeren
 * sein, ein gehaltener Knopf (oder eine gehaltene Pfeiltaste) soll
 * durchlaufen, bis losgelassen wird. pulse() haelt sie am Laufen; bleibt er
 * laenger als idleMs aus, stoppt sie von selbst -- kein explizites "Taste
 * losgelassen"-Ereignis noetig (jogButtons' Timer und die Tastatur-Wieder-
 * holung liefern beide unterschiedlich getaktete Pulse).
 */
export class PulseLoop {
  constructor(name, volume = 0.5, idleMs = 200) {
    this.audio = new Audio(BASE + name);
    this.audio.loop = true;
    this.audio.volume = volume;
    this.idleMs = idleMs;
    this.timer = 0;
    this.enabled = true;
  }

  pulse() {
    if (!this.enabled) return;
    if (this.audio.paused) this.audio.play().catch(() => { /* kein Autoplay-Recht */ });
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.stop(), this.idleMs);
  }

  stop() {
    window.clearTimeout(this.timer);
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.stop();
  }
}

/**
 * Eine Dauerschleife -- Intro- oder Hintergrundmusik, oder (bei der Hupe)
 * die Sirene, die laeuft, solange eine Meldung unquittiert ist. start() ist
 * idempotent: erneuter Aufruf waehrend sie schon laeuft, tut nichts.
 */
export class MusicLoop {
  constructor(name, volume = 0.5) {
    this.audio = new Audio(BASE + name);
    this.audio.loop = true;
    this.audio.volume = volume;
    this.enabled = true;
  }

  start() {
    if (!this.enabled || !this.audio.paused) return;
    this.audio.play().catch(() => {
      // Browser verweigert Autoplay ohne Geste -- beim naechsten Klick
      // irgendwo auf der Seite einmalig nachholen.
      const retry = () => { this.audio.play().catch(() => {}); };
      document.addEventListener('click', retry, { once: true });
    });
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.stop();
  }
}
