// Die Leitung zwischen Leitstand und Monitor.
//
// Bewusst Abholen statt Dauerverbindung: der Server laeuft unter waitress mit
// 24 Arbeitsfaeden (app.py: serve(..., threads=24)). Ein Server-Sent-Events-
// Strom belegt je Zuschauer dauerhaft einen davon -- drei Geraete fraessen ein
// Achtel des Servers, waehrend sie nichts tun als warten. Zwei kurze Anfragen
// je Sekunde kosten dagegen nichts, und ein `seq`-Vergleich schickt bei
// stehendem Bild ueberhaupt keine Daten zurueck.

import { api } from './api.js';
import { packFrame } from './monitorFrame.js';

/** Abstand zwischen zwei Bildern. 500 ms ist die Grenze, ab der ein
 *  Zeigerausschlag auf dem zweiten Schirm noch als Bewegung durchgeht und
 *  nicht als Sprung. Schneller waere fuer eine Anlage mit Zeitkonstanten von
 *  Sekunden bis Minuten Selbstzweck. */
export const FRAME_INTERVAL_MS = 500;

/** Abholtakt des Monitors. Bewusst kuerzer als der Sendetakt -- sonst
 *  addieren sich im schlechtesten Fall beide Wartezeiten zu einer ganzen
 *  Sekunde Verzug. */
export const POLL_INTERVAL_MS = 400;

/**
 * Sendet den laufenden Leitstand.
 *
 * Gehaengt wird er an den Renderlauf, nicht an einen eigenen Zeitgeber: was
 * der Spieler nicht mehr sieht, braucht der Monitor auch nicht -- und genau
 * dieser Gleichlauf macht den Hintergrund-Hinweis moeglich (siehe unten).
 */
export class MonitorSender {
  constructor() {
    this.engine = null;
    this.meta = null;
    this.seq = 0;
    this.next = 0;
    this.busy = false;
    this._wired = false;
    /** Letzter Fehlversuch. Nach einem Fehlschlag wird bewusst gebremst:
     *  ein abgestuerzter oder neu startender Server soll nicht zweimal je
     *  Sekunde dieselbe Anfrage bekommen. */
    this.backoffUntil = 0;
    this._onVisibility = () => this._sendNow({ hidden: document.hidden });
    this._onPageHide = () => this._beacon({ closed: true });
  }

  /** Einen neuen Lauf anmelden. `meta` traegt alles, was der Monitor zum
   *  Aufbau seiner eigenen Engine braucht und was nicht im Zustand steht. */
  start(engine, meta) {
    this.engine = engine;
    this.meta = meta;
    this.seq = 0;
    this.next = 0;
    if (!this._wired) {
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('pagehide', this._onPageHide);
      this._wired = true;
    }
    this._sendNow({});
  }

  /**
   * Den Lauf abmelden.
   *
   * Ohne das stuende auf dem Monitor nach dem Rundenende dasselbe Bild wie
   * bei einem abgerissenen Netz -- "keine Verbindung" fuer etwas, das ganz
   * normal zu Ende gegangen ist.
   */
  stop() {
    if (!this.engine) return;
    this._sendNow({ ended: true });
    this.engine = null;
    this.meta = null;
  }

  /** Aus dem Renderlauf, je Bild. Drosselt selbst auf FRAME_INTERVAL_MS. */
  tick(now) {
    if (!this.engine || this.busy || now < this.next || now < this.backoffUntil) return;
    this.next = now + FRAME_INTERVAL_MS;
    this._guard(() => this._post(this._frame({})));
  }

  /**
   * Nichts hier darf die Schicht anhalten.
   *
   * Dieser Sender haengt in der rAF-Kette von loop.js, und die faengt zwar
   * (onCrash), haelt danach aber die ganze Simulation an. Ein Fehler beim
   * Packen eines Bildes fuer einen zweiten Schirm ist kein Grund, dem
   * Spieler die Anlage abzustellen -- der Monitor faellt dann eben auf
   * "keine Verbindung", das ist der richtige Preis.
   */
  _guard(fn) {
    try {
      fn();
    } catch {
      this.backoffUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 30000;
    }
  }

  _frame(status) {
    this.seq += 1;
    return packFrame(this.engine, { ...this.meta, ...status }, this.seq);
  }

  _sendNow(status) {
    if (!this.engine) return;
    this.next = (typeof performance !== 'undefined' ? performance.now() : 0) + FRAME_INTERVAL_MS;
    this._guard(() => this._post(this._frame(status)));
  }

  async _post(frame) {
    this.busy = true;
    const res = await api.sendMonitor(frame);
    this.busy = false;
    // Ein Monitorbild ist Zugabe. Scheitert es, laeuft die Schicht weiter --
    // gemeldet wird nichts, der Leitstand selbst haengt daran nicht.
    if (!res.ok) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      this.backoffUntil = now + 5000;
    }
  }

  /**
   * Letztes Lebenszeichen beim Schliessen des Reiters.
   *
   * fetch() ueberlebt das Entladen der Seite nicht zuverlaessig; sendBeacon
   * schon. Der Typ am Blob muss stimmen, sonst schickt der Browser
   * text/plain und Flask sieht kein JSON.
   */
  _beacon(status) {
    if (!this.engine || typeof navigator.sendBeacon !== 'function') return;
    try {
      const body = new Blob([JSON.stringify(this._frame(status))], { type: 'application/json' });
      navigator.sendBeacon('/api/monitor', body);
    } catch {
      // Ein verpasstes Abschiedsbild kostet den Monitor nur die genaue
      // Ursache: er faellt nach zehn Sekunden auf "keine Verbindung".
    }
  }
}

/**
 * Holt Bilder ab und sagt, wie alt das gezeigte ist.
 *
 * Das Alter kommt vom SERVER (er stempelt beim Empfang), nicht aus einem
 * Vergleich zweier Uhren: Leitstand und Monitor stehen oft auf verschiedenen
 * Geraeten, und eine um Minuten falsch gehende Tablet-Uhr wuerde sonst ein
 * frisches Bild als tot melden oder ein totes als frisch.
 */
export class MonitorReceiver {
  /**
   * @param {(frame:object)=>void} onFrame Neues Bild eingetroffen.
   * @param {(status:{state:string, age:number, meta:object|null})=>void} onStatus
   */
  constructor(onFrame, onStatus) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.seq = 0;
    this.meta = null;
    /** Serverseitiges Alter des zuletzt gesehenen Bildes ... */
    this.baseAge = 0;
    /** ... und die lokale Uhr dazu. Zwischen zwei Abholungen laeuft das
     *  angezeigte Alter damit weiter, ohne dass dafuer gepollt werden muss. */
    this.baseAt = 0;
    this.state = 'wait';
    this.timer = null;
    this.busy = false;
    this._poll = this._poll.bind(this);
  }

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(this._poll, POLL_INTERVAL_MS);
    this._poll();
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Alter in Sekunden, zwischen den Abholungen lokal fortgeschrieben. */
  age() {
    if (!this.baseAt) return Infinity;
    return this.baseAge + (Date.now() - this.baseAt) / 1000;
  }

  async _poll() {
    if (this.busy) return;
    this.busy = true;
    const res = await api.readMonitor(this.seq);
    this.busy = false;
    if (!res.ok || !res.data) {
      // status 0 heisst: gar keine Antwort. Das ist der Monitor, der sein
      // Netz verloren hat -- ein anderer Fall als der Leitstand, der nichts
      // mehr schickt, und er darf nicht als "Leitstand weg" erscheinen.
      this._emit(res.status === 0 ? 'offline' : 'none');
      return;
    }
    const data = res.data;
    if (data.none) { this._emit('none'); return; }
    this.baseAge = Number.isFinite(data.age) ? data.age : 0;
    this.baseAt = Date.now();
    if (data.frame) {
      this.seq = data.frame.seq || 0;
      this.meta = data.frame.meta || null;
      this.onFrame(data.frame);
    }
    this._emit('live');
  }

  _emit(state) {
    this.state = state;
    this.onStatus({ state, age: this.age(), meta: this.meta });
  }
}
