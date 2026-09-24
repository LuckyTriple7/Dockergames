// Meldetafel und Ereignisprotokoll.
//
// Die Kacheln werden einmal gebaut, danach wird nur data-st gesetzt -- Farbe,
// Blinken und Hupe entstehen daraus in CSS.

import { el, setAttr, setText } from './dom.js';
import { t, clock } from './i18n.js';
import { playClip, MusicLoop } from './music.js';

export class Annunciator {
  constructor(container, logNode, defs, onSelect) {
    this.container = container;
    this.logNode = logNode;
    this.onSelect = onSelect;
    this.tiles = new Map();
    container.replaceChildren();
    for (const d of defs) {
      const node = el('div.rs-tile', {
        'data-sev': d.severity,
        'data-st': 'normal',
        title: t(d.key),
        role: onSelect ? 'button' : null,
        tabindex: onSelect ? '0' : null,
      }, [t(d.key)]);
      // Eine Meldung erklärt sich nicht selbst -- Klick (oder Enter/Leertaste
      // an der Tastatur) zeigt, was sie bedeutet und was zu tun ist.
      if (onSelect) {
        node.addEventListener('click', () => onSelect(d));
        node.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(d); }
        });
      }
      this.tiles.set(d.id, node);
      container.append(node);
    }
    this.logNode.replaceChildren();
    this.logCount = 0;
  }

  update(tiles) {
    for (const tile of tiles) {
      const node = this.tiles.get(tile.id);
      if (node) setAttr(node, 'data-st', tile.tile);
    }
  }

  /** Protokolleinträge anhängen. Neueste oben, Länge begrenzt. */
  log(entries) {
    for (const e of entries) {
      const li = el('li', {
        'data-sev': e.severity || 1,
        role: this.onSelect ? 'button' : null,
        tabindex: this.onSelect ? '0' : null,
      }, [
        el('time', { text: clock(e.t) }),
        el('span', {
          // e.params: fuer Eintraege, deren Text einen Platzhalter braucht
          // (z.B. der Helfer, siehe game/helper.js) -- t() ignoriert ein
          // fehlendes zweites Argument, jeder bisherige Aufrufer bleibt also
          // unveraendert.
          text: t(e.key, e.params) + (e.kind ? ' — ' + t('event_' + e.kind) : '')
                + (e.cause ? ' (' + t(e.cause === 'manual' ? 'state_manual' : e.cause) + ')' : ''),
        }),
      ]);
      // Derselbe Klick-für-Erklärung wie bei den Meldetafel-Kacheln -- ein
      // Protokolleintrag ist nur eine Zeitleiste, kein Nachschlagewerk.
      if (this.onSelect) {
        li.addEventListener('click', () => this.onSelect(e));
        li.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.onSelect(e); }
        });
      }
      this.logNode.prepend(li);
      this.logCount++;
    }
    while (this.logCount > 120) {
      this.logNode.removeChild(this.logNode.lastChild);
      this.logCount--;
    }
  }
}

/**
 * Anlagengeräusche über feste Aufnahmen (static/audio/*.mp3, siehe music.js).
 * Bis Version 0.0.47 synthetisiert über die Web Audio API -- jetzt echte
 * Klangeffekte, weil ein Spieler welche gefunden hat, die besser klingen.
 */
/** Dateiname des Explosionsklangs -- die EINE Stelle, die zu ändern ist,
 *  sobald der eigene Clip vorliegt. Bis dahin derselbe wie bei der
 *  Kernzerstörung, damit der Vorgang überhaupt hörbar ist. */
const EXPLOSION_CLIP = 'game_over.mp3';

export class Horn {
  constructor() {
    this._enabled = true;
    // Zweistufig: die Sirene laeuft EINMAL durch (kein Loop), danach uebernimmt
    // der Dauerton, bis quittiert wird -- ein einzelner Sirenen-Clip in Dauer-
    // schleife wuerde sich bei jedem Taktschlag der blinkenden Kachel selbst
    // ueberlagern, und die Sirene allein in Dauerschleife wurde als nervig
    // empfunden. _playing haelt fest, ob diese Episode schon begonnen hat --
    // alarm() darf sie nicht neu antriggern, waehrend Sirene ODER Dauerton
    // schon laeuft, silence() setzt sie fuer die naechste Meldung zurueck.
    this._siren = new MusicLoop('alarm_sirene.mp3', 0.35);
    this._siren.audio.loop = false;
    this._attention = new MusicLoop('game_attention.mp3', 0.35);
    this._playing = false;
  }

  // main.js weist `app.horn.enabled = ...` direkt zu (Stats-Dialog) -- der
  // Setter muss deshalb beide laufenden Toene mit abstellen, nicht nur das
  // Flag umlegen, sonst spielt einer nach dem Abschalten einfach weiter.
  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = v;
    this._siren.setEnabled(v);
    this._attention.setEnabled(v);
  }

  /**
   * Meldehupe. Wird im Takt der blinkenden Kachel gerufen (siehe panels.js).
   * Der eigentliche Start passiert nur beim ERSTEN Aufruf einer Episode
   * (_playing noch false) -- danach laeuft die Sirene bzw. der Dauerton von
   * selbst weiter, ein erneuter Aufruf soll nichts neu antriggern.
   * TRIP-Meldungen (severity >= 3) bekommen eine dringlichere, leicht
   * höhere Stimme -- ohne zweite Datei über die Wiedergabegeschwindigkeit.
   */
  alarm(severity = 2) {
    if (!this.enabled) return;
    const rate = severity >= 3 ? 1.15 : 1.0;
    this._siren.audio.playbackRate = rate;
    this._attention.audio.playbackRate = rate;
    if (!this._playing) {
      this._playing = true;
      this._siren.start();
      return;
    }
    // Sirene ist einmal durchgelaufen (kein Loop, siehe Konstruktor) -- jetzt
    // der Dauerton, bis quittiert wird. Abfrage statt 'ended'-Ereignis: alarm()
    // wird ohnehin einmal je Sekunde gerufen (siehe panels.js hornNext), das
    // ist robuster als ein Ereignis, das bei jedem Aufruf neu genau einmal
    // richtig verdrahtet sein müsste -- und start() selbst ist idempotent,
    // ein wiederholter Aufruf hier tut also nichts, sobald der Dauerton läuft.
    if (this._siren.audio.ended) this._attention.start();
  }

  /** Sirene und Dauerton abstellen, sobald keine Meldung mehr unquittiert ist. */
  silence() {
    this._playing = false;
    this._siren.stop();
    this._attention.stop();
  }

  /**
   * Bestätigung beim Quittieren: der Dauerton (game_attention.mp3) spielt
   * einmal komplett durch als eigener, einmaliger Klang -- unabhängig davon,
   * ob die Sirene selbst je durchgelaufen ist. Wird VOR silence() gerufen
   * (siehe panels.js '#rs-ack'), deshalb noch mit dem alten _playing-Stand:
   * ohne anstehende Meldung (z.B. Doppelklick auf Quittieren) bleibt es
   * stumm, statt grundlos zu spielen.
   */
  ack() {
    if (this._playing && this.enabled) playClip('game_attention.mp3', 0.35);
  }

  /** Schnellabschaltung -- einmaliger Clip, kein Loop. */
  scram() {
    if (this.enabled) playClip('game_scram.mp3');
  }

  /** Kernzerstörung -- einmaliger Clip, kein Loop. */
  meltdown() {
    if (this.enabled) playClip('game_over.mp3');
  }

  /** Explosion -- oberer Schild hebt ab (RBMK) oder Wasserstoff zündet
   *  (SWR). Einmaliger Clip, kein Loop.
   *
   *  Vorläufig derselbe Clip wie die Kernzerstörung: ein eigener kommt noch.
   *  Er ist deshalb schon hier von meltdown() getrennt -- wenn die Datei da
   *  ist, wird EXPLOSION_CLIP umgesetzt und sonst nichts. */
  explosion() {
    if (this.enabled) playClip(EXPLOSION_CLIP);
  }

  /**
   * Muss aus einer Benutzergeste heraus laufen, sonst bleibt der Ton stumm.
   * NUR die Sirene anspielen, nicht den Dauerton: unlock() wird von Ack- und
   * SCRAM-Knopf gerufen -- genau den Knoepfen, auf die ein Spieler klickt,
   * WAEHREND eine Meldung laeuft. War hier `_attention.audio.play()` mit
   * dabei, setzte das dessen `paused` sofort auf false (synchron, noch vor
   * der Promise-Aufloesung); traf das mit dem Moment zusammen, in dem
   * alarm() den Dauerton nach Sirenenende ECHT starten wollte, sah start()
   * "laeuft schon" und tat nichts -- unlock()s eigenes .then(stop()) legte
   * ihn gleich darauf wieder still. Der Dauerton kam dadurch nie hoerbar an,
   * ganz ohne Fehler. Die Sirene braucht die eigene Freischaltung hier
   * trotzdem (erster Ton der Episode, kommt sonst evtl. zu spaet), der
   * Dauerton nicht: er startet ohnehin nur aus alarm() heraus, genau wie
   * die Sirene selbst auch nie eigens freigeschaltet werden musste.
   */
  unlock() {
    this._siren.audio.play().then(() => this._siren.stop()).catch(() => {});
  }
}
