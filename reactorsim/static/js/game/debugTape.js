// Debug-Protokoll einer Schicht.
//
// Zweck: die Frage "was hast du eigentlich gemacht, und was hat die Anlage
// dabei getan" beantwortbar machen, ohne sie nachzustellen. Bis 0.6.12 gab
// es dafuer nur den Bericht des Spielers und meine Testlaeufe -- und die
// laufen auf einer anderen Maschine, mit einer anderen Bildrate, oft mit
// einem anderen Stand.
//
// Was hier NICHT noetig ist: der Lauf selbst. Der ist laengst reproduzierbar
// -- game/recorder.js schreibt jede Bedienhandlung mit Schrittzahl mit, und
// game/replay.js rechnet daraus denselben Lauf unter Node bitgleich nach
// (siehe verify_run.mjs). Dieses Protokoll sammelt deshalb zwei Dinge: das,
// was zum Nachrechnen fehlt (Kopfdaten, Spur, Spielstand bei fortgesetzten
// Runden), und das, was beim Nachrechnen NICHT herauskommt -- Bildrate,
// verworfener Rueckstand, Zeitrafferwechsel. Genau diese letzte Gruppe
// unterscheidet "bei mir explodiert es, bei dir nicht" von Ratespielen.
//
// Format ist NDJSON: eine Zeile je Datensatz, erstes Feld `k` der Typ. Kein
// Einruecken, keine Kopfzeile, kein CSV -- lesbar muss es nicht sein,
// durchsuchbar (`zcat … | grep '"k":"event"'`) schon.
//
// Kein DOM hier: das Einpacken und Herunterladen steht in ui/download.js,
// damit diese Datei unter Node testbar bleibt.

import { numbers, numberLabels, hash } from '../sim/state.js';

/** Abtastung der vollen Zahlenliste: jeder 20. Schritt, also 1 Hz bei
 *  DT = 0,05 s. In den interessanten Abschnitten wird dichter abgetastet,
 *  siehe DENSE unten. */
const SAMPLE_EVERY = 20;
/** Zustandshash: alle 10 s. Er macht aus "die Nachrechnung sieht anders aus"
 *  ein "sie laeuft ab Schritt N auseinander". */
const HASH_EVERY = 200;
/** Signifikante Stellen je Messwert. Neun reichen, um eine Abweichung zu
 *  sehen, und sparen gegenueber der vollen Doppelgenauigkeit rund die
 *  Haelfte der Datei. Der HASH bleibt davon unberuehrt -- der rechnet ueber
 *  die Rohwerte. */
const DIGITS = 9;
/** Harte Obergrenze. Eine Sechs-Stunden-Runde bei dichter Abtastung koennte
 *  sonst den Speicher des Browsers fuellen; lieber ein abgeschnittenes
 *  Protokoll mit Vermerk als ein haengender Reiter. */
const MAX_ROWS = 400000;

/** Millisekunden je Sammelkorb der Bildraten-Statistik. */
const FRAME_BUCKET_MS = 1000;

const round = (x) => (Number.isFinite(x) ? Number(x.toPrecision(DIGITS)) : null);

export class DebugTape {
  /** @param {object} meta Kopfdaten: Version, Reaktortyp, Szenario, Seed, ... */
  constructor(meta = {}) {
    this.meta = { ...meta, started: new Date().toISOString() };
    this.rows = [];
    this.truncated = false;
    this.n = 0;
    this.labels = null;
    this._logSeen = 0;
    this._journalSeen = 0;
    this._speed = null;
    this._bucket = null;
  }

  _push(row) {
    if (this.rows.length >= MAX_ROWS) { this.truncated = true; return; }
    this.rows.push(row);
  }

  /** Freier Eintrag -- fuer alles, was die Oberflaeche selbst weiss. */
  note(what, data) { this._push({ k: 'note', n: this.n, what, d: data ?? null }); }

  /**
   * Ein Simulationsschritt. Wird aus derselben Stelle gerufen wie
   * session.step() (main.js: loop.afterStep), sieht also jeden Schritt --
   * auch die des Xenon-Zeitsprungs.
   */
  step(engine, session) {
    const s = engine.state;
    this.n++;
    if (!this.labels) {
      this.labels = numberLabels(s);
      this._push({ k: 'fields', v: this.labels });
    }
    // Dichter abtasten, sobald es darauf ankommt: nach AZ-5/RESA und nach
    // der Zerstoerung entscheidet sich alles in wenigen Sekunden, und eine
    // Abtastung je Sekunde zeigt davon genau nichts.
    const dense = !!(s.scram && s.scram.active) || !!s.destroyed;
    if (dense || this.n % SAMPLE_EVERY === 0) {
      this._push({ k: 'sample', n: this.n, v: numbers(s).map(round) });
    }
    if (this.n % HASH_EVERY === 0) this._push({ k: 'hash', n: this.n, h: hash(s) });
    this._drainEvents(engine);
    const phase = session && session.phase;
    if (phase && phase !== this._phase) {
      this._phase = phase;
      this._push({ k: 'phase', n: this.n, t: round(s.t_sim), v: phase });
    }
  }

  /** Neue Zeitleisten- und Lernprotokolleintraege seit dem letzten Schritt. */
  _drainEvents(engine) {
    const log = engine.ctx.log || [];
    for (; this._logSeen < log.length; this._logSeen++) {
      const e = log[this._logSeen];
      this._push({ k: 'event', n: this.n, t: round(e.t), src: 'log',
        key: e.key ?? null, sev: e.severity ?? null, kind: e.kind ?? null });
    }
    const j = engine.ctx.learning && engine.ctx.learning.entries;
    if (!Array.isArray(j)) return;
    // Das Lernprotokoll wirft alte Eintraege weg, wenn es voll ist (CAP in
    // learning.js). Dann ist der Index kein Fortschritt mehr, sondern eine
    // Verschiebung -- in dem Fall lieber von vorn zaehlen als Eintraege
    // doppelt oder gar nicht mitzuschreiben.
    if (this._journalSeen > j.length) this._journalSeen = 0;
    for (; this._journalSeen < j.length; this._journalSeen++) {
      const e = j[this._journalSeen];
      this._push({ k: 'event', n: this.n, t: round(e.t), src: 'journal',
        kind: e.kind ?? null, id: e.id ?? null, key: e.key ?? null,
        value: e.value ?? null });
    }
  }

  /**
   * Ein Bild der Darstellung. Gesammelt wird je Realsekunde, nicht je Bild
   * -- sechzig Zeilen je Sekunde waeren der groesste Posten der Datei und
   * der unwichtigste.
   *
   * @param {number} nowMs     performance.now() dieses Bildes
   * @param {object} info      {steps, slip, speed} aus loop.js
   */
  frame(nowMs, info) {
    const b = this._bucket;
    if (!b || nowMs - b.t0 >= FRAME_BUCKET_MS) {
      if (b) {
        this._push({ k: 'frame', n: this.n, t0: Math.round(b.t0),
          frames: b.frames, steps: b.steps, slip: b.slip,
          minMs: round(b.minMs), maxMs: round(b.maxMs), speed: b.speed });
      }
      this._bucket = { t0: nowMs, last: nowMs, frames: 0, steps: 0, slip: 0,
        minMs: Infinity, maxMs: 0, speed: info.speed };
    }
    const cur = this._bucket;
    const dt = nowMs - cur.last;
    cur.last = nowMs;
    cur.frames++;
    cur.steps += info.steps || 0;
    if (info.slip) cur.slip++;
    if (cur.frames > 1) {
      cur.minMs = Math.min(cur.minMs, dt);
      cur.maxMs = Math.max(cur.maxMs, dt);
    }
    cur.speed = info.speed;
  }

  /** Umschaltung des Zeitraffers -- von der Uebung oder vom Spieler. */
  speed(v, source) {
    if (v === this._speed) return;
    this._speed = v;
    this._push({ k: 'speed', n: this.n, v, src: source || null });
  }

  /**
   * Abschluss. `extra` traegt, was nur die Oberflaeche kennt: die Spur des
   * Recorders, den Trend-Schnappschuss, den Zustandsabzug und den Befund.
   */
  finish(extra = {}) {
    if (this._bucket) {
      const b = this._bucket;
      this._bucket = null;
      this._push({ k: 'frame', n: this.n, t0: Math.round(b.t0), frames: b.frames,
        steps: b.steps, slip: b.slip, minMs: round(b.minMs), maxMs: round(b.maxMs),
        speed: b.speed });
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      this._push({ k: key, d: value });
    }
    this.meta.ended = new Date().toISOString();
    this.meta.steps = this.n;
  }

  /** Das ganze Protokoll als NDJSON. Erste Zeile ist immer der Kopf. */
  toNdjson() {
    const head = { k: 'meta', ...this.meta, rows: this.rows.length,
      truncated: this.truncated, sampleEvery: SAMPLE_EVERY, hashEvery: HASH_EVERY };
    const out = [JSON.stringify(head)];
    for (const row of this.rows) out.push(JSON.stringify(row));
    return out.join('\n') + '\n';
  }
}
