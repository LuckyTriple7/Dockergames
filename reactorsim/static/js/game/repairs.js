// Instandhaltungstrupp: Stoerungen abarbeiten statt sie nur zu ertragen.
//
// Bis 0.6.17 war eine Zufallsstoerung im freien Spiel endgueltig. stepEvents()
// (game/events.js) schreibt ihre Wirkung jeden Rechenschritt neu, und keine
// Stelle im ganzen Programm hat je einen ihrer Merker wieder geloescht: ein
// klemmender Pumpenschalter blieb geklemmt, bis die Runde endete. Auf der
// Stufe "hart" (eine Stoerung alle 10 bis 20 Minuten, siehe FAULT_LEVELS)
// sammelte eine lange Schicht damit Defekte an, ohne dass je einer verschwand
// -- nicht schwer, sondern nur zermuerbend.
//
// ── Warum die Tabelle hier am ZUSTAND haengt und nicht am Ereignis ──────────
//
// Der naheliegende Aufbau waere, jeder Stoerung in events.js neben apply()
// ein clear() zu geben. Das waere falsch herum: dieselbe Wirkung kann aus
// zwei verschiedenen Ereignissen kommen. ctx.recircPumpStuck setzt sowohl
// rcp_trip (Motorschutz hat ausgeloest, der Elektriker stellt ihn zurueck)
// als auch station_blackout (kein Motorstrom, da gibt es nichts
// zurueckzustellen). Ein clear() an rcp_trip haette im zweiten Fall eine
// Pumpe freigegeben, die gar keinen Strom hat.
//
// Deshalb steht hier NICHT "welches Ereignis laesst sich zuruecknehmen",
// sondern "welcher Anlagenzustand laesst sich im Betrieb beheben, und was
// muss dafuer erfuellt sein". Das ueberlebt auch das Laden eines
// Spielstands, in dem nur noch die Merker stehen und niemand mehr weiss,
// welches Ereignis sie gesetzt hat.
//
// ── Warum nur vier Arbeiten ────────────────────────────────────────────────
//
// Was ein Trupp im laufenden Betrieb erreicht, ist wenig. Ein Motorschutz im
// Schaltraum, eine Absperrung an der Zuspeisung, ein Ventilantrieb -- das
// sind Handgriffe. Ein klemmender Steuerstab sitzt im Kern, ein
// Dampferzeuger-Rohrleck ist nur ueber das Abfahren zu erreichen, das
// Abblaseventil des Druckhalters ebenso. Die bleiben, und das ist die
// Aussage: der Trupp nimmt der Schicht die Aufschaukelung, nicht die Folgen.

/**
 * Die Stufen, die der Spieler vor dem Start waehlt -- eigenes Auswahlfeld wie
 * Stoerungen und Netzauftraege, aus demselben Grund: wer mit vielen
 * Stoerungen UND ohne Trupp spielen will, soll das koennen, und wer die
 * Stoerungen abschaltet, verliert nicht stillschweigend auch den Trupp.
 *
 * `factor` streckt jede Dauer. Mehr Stellschrauben braucht es nicht: was eine
 * Arbeit kostet, steht an der Arbeit (JOBS), die Stufe sagt nur, wie viele
 * Leute gerade im Haus sind.
 */
export const REPAIR_LEVELS = {
  off: null,
  normal: { factor: 1 },
  slow: { factor: 2 },
};

export const REPAIR_LEVEL_IDS = Object.keys(REPAIR_LEVELS);

/**
 * Die Arbeiten. `minutes` ist Simulationszeit, nicht Zeit am Schirm -- im
 * 60-fachen Zeitraffer ist ein Motorschutz in zwoelf Sekunden zurueckgestellt,
 * bei 1x dauert er zwoelf Minuten. Genau so soll es sein: wer gerade eine
 * Transiente faehrt, kann den Zeitraffer nicht hochdrehen, und fuer ihn ist
 * die Reparatur lang.
 *
 * `ready(engine)` ist die Voraussetzung. Sie wird bei der Vergabe geprueft
 * UND waehrend der Arbeit: faellt sie weg, bricht der Trupp ab. Ein
 * Elektriker, dem mitten im Handgriff der Strom ausgeht, ist nicht fertig.
 *
 * `clear(engine, n)` loescht den MERKER auf ctx, nicht den Zustand dahinter.
 * Das ist der ganze Punkt: solange der Merker steht, schreibt stepEvents()
 * die Wirkung jeden Schritt neu, und jede Bedienhandlung am Knopf waere
 * innerhalb eines Takts wieder ueberschrieben. Anwerfen bzw. oeffnen muss
 * danach der Bediener selbst -- der Trupp gibt das Stellteil frei, er
 * bedient es nicht.
 */
const JOBS = {
  pump: {
    key: 'repair_job_pump',
    minutes: 12,
    ready: (e) => e.state.acPower !== false,
    blockKey: 'repair_block_power',
    clear(e, n) {
      e.ctx.pumpsStuck?.delete(n);
      if (e.ctx.pumpsStuck && e.ctx.pumpsStuck.size === 0) e.ctx.pumpsStuck = null;
    },
  },
  recirc: {
    // NETZstrom, nicht nur Strom: eine Hauptumwaelzpumpe haengt nie an einem
    // Notstromdiesel, der ist fuer Nachzerfallswaerme ausgelegt und nicht
    // fuer ein paar Megawatt Pumpenleistung (siehe spec.diesel in
    // plants/bwr.js). Der Elektriker koennte den Motorschutz zwar auch mit
    // Dieselstrom zuruecksetzen -- nur liefe die Pumpe danach trotzdem nicht
    // an, und ein Knopf, der ein totes Stellteil freigibt, waere eine Luege.
    key: 'repair_job_recirc',
    minutes: 15,
    ready: (e) => e.state.gridPower !== false && e.state.acPower !== false,
    // Eigener Grund: "kein Motorstrom" waere am Notstromdiesel schlicht
    // falsch -- Strom ist da, er traegt diese Pumpe nur nicht.
    blockKey: 'repair_block_grid',
    clear(e) { e.ctx.recircPumpStuck = false; },
  },
  msiv: {
    // Der Antrieb der Frischdampf-Absperrung, nicht die Absperrung selbst:
    // danach laesst sie sich wieder oeffnen, offen ist sie deswegen nicht.
    // Lang, weil die Armatur draussen im Ringraum sitzt und niemand dort
    // waehrend einer Transiente schnell arbeitet.
    key: 'repair_job_msiv',
    minutes: 40,
    ready: () => true,
    blockKey: null,
    clear(e) { e.ctx.msivStuck = false; },
  },
  boron: {
    // Die Zuspeisung wird abgesperrt -- ein Ventil, kein Rohrbruch. Deshalb
    // die kuerzeste Arbeit von allen.
    key: 'repair_job_boron',
    minutes: 6,
    ready: () => true,
    blockKey: null,
    clear(e) {
      e.ctx.boronRunaway = false;
      // Der Stellwert selbst bleibt sonst auf "verduennen" stehen (siehe
      // stepEvents()) und der naechste Rechenschritt verduennte weiter, ohne
      // dass noch eine Stoerung anlaege. Abgesperrt heisst: kein Zulauf.
      if (e.state.boronFlow !== undefined && e.state.boronFlow < 0) e.state.boronFlow = 0;
    },
  },
};

/** Gibt es die Stufe? Alles andere gilt als "aus" -- ein unbekannter Wert aus
 *  einer alten Einstellung soll das freie Spiel nicht verweigern. Gleiche
 *  Regel wie faultLevel() und dispatchLevel(). */
export function repairLevel(id) {
  return Object.hasOwn(REPAIR_LEVELS, id) ? REPAIR_LEVELS[id] : null;
}

/** Auftragskennung in Art und Nummer zerlegen. `pump:2` ist die dritte Pumpe
 *  (null-basiert wie ctx.pumpsStuck), alles andere traegt keine Nummer. */
function parseId(id) {
  if (typeof id !== 'string') return null;
  const [kind, rest] = id.split(':');
  if (!Object.hasOwn(JOBS, kind)) return null;
  if (rest === undefined) return { kind, n: null };
  const n = Number(rest);
  return Number.isInteger(n) && n >= 0 ? { kind, n } : null;
}

/**
 * Welche Arbeiten stehen gerade an? Aus dem Anlagenzustand abgeleitet, nicht
 * mitgefuehrt -- damit kann die Liste nach dem Laden eines Spielstands gar
 * nicht falsch sein, und eine Stoerung, die auf einem zweiten Weg
 * verschwindet, verschwindet auch hier.
 *
 * @returns {Array<{id:string, key:string, params:object, minutes:number,
 *   ready:boolean, blockKey:?string}>}
 */
export function openRepairs(engine, factor = 1) {
  const { state: s, ctx } = engine;
  const out = [];
  const push = (kind, n, params) => {
    const job = JOBS[kind];
    out.push({
      id: n === null ? kind : `${kind}:${n}`,
      key: job.key,
      params: params || {},
      minutes: job.minutes * factor,
      ready: job.ready(engine),
      blockKey: job.blockKey,
    });
  };
  if (ctx.pumpsStuck && ctx.pumpsStuck.size) {
    const pumps = ctx.pumpList || ctx.pumps || ctx.mcp || [];
    // Sortiert, damit die Liste nicht in der Reihenfolge des Ausfalls
    // springt: eine Anzeige, deren Zeilen die Plaetze tauschen, liest
    // niemand zweimal.
    for (const i of [...ctx.pumpsStuck].sort((a, b) => a - b)) {
      if (pumps[i]) push('pump', i, { n: i + 1 });
    }
  }
  if (ctx.recircPumpStuck && ctx.recircPump) push('recirc', null);
  if (ctx.msivStuck && s.msiv !== undefined) push('msiv', null);
  if (ctx.boronRunaway && s.C_B_cmd !== undefined) push('boron', null);
  return out;
}

export class Repairs {
  /**
   * @param {object} engine
   * @param {string} levelId  Schluessel aus REPAIR_LEVELS
   *
   * Kein Wuerfel, anders als FreeFaults und Dispatch: eine Reparaturdauer,
   * die sich verwuerfelt, waere fuer den Spieler nicht planbar und fuer den
   * Test nicht nachrechenbar -- und gewonnen waere nichts. Der Trupp braucht,
   * was er braucht.
   */
  constructor(engine, levelId) {
    this.engine = engine;
    this.levelId = Object.hasOwn(REPAIR_LEVELS, levelId) ? levelId : 'off';
    this.level = REPAIR_LEVELS[this.levelId] || null;
    /** @type {?{id:string, kind:string, n:?number, key:string, params:object,
     *   startT:number, endT:number}} genau EIN Trupp. Zwei gleichzeitige
     *  Stoerungen heissen deshalb: entscheiden, welche zuerst. */
    this.job = null;
    this.done = 0;
  }

  get active() { return !!this.level; }

  get factor() { return this.level ? this.level.factor : 1; }

  /** Wie FreeFaults.begin()/Dispatch.begin(): die Sitzung weiss erst in
   *  start(), ob sie ueberhaupt laeuft. Hier gibt es keinen ersten Zeitpunkt
   *  zu ziehen -- der Trupp kommt auf Anforderung, nicht von selbst. */
  begin() { this.job = null; }

  /** Offene Arbeiten, fuer die Anzeige. Leer, wenn die Stufe aus ist: ohne
   *  Trupp gibt es nichts anzufordern, und eine Liste, an der kein Knopf
   *  haengt, waere nur eine zweite Meldetafel. */
  jobs() { return this.active ? openRepairs(this.engine, this.factor) : []; }

  /**
   * Trupp anfordern.
   * @returns {'ordered'|'busy'|'unknown'|'blocked'} warum nicht, wenn nicht
   */
  order(id) {
    if (!this.active) return 'unknown';
    if (this.job) return 'busy';
    const parsed = parseId(id);
    if (!parsed) return 'unknown';
    const open = this.jobs().find((j) => j.id === id);
    if (!open) return 'unknown';
    if (!open.ready) return 'blocked';
    const t = this.engine.state.t_sim;
    const seconds = open.minutes * 60;
    this.job = {
      id, kind: parsed.kind, n: parsed.n, key: open.key, params: open.params,
      startT: t, endT: t + seconds,
    };
    // Wie jede andere Bedienhandlung: ins Protokoll, in die Zeitleiste und in
    // die Wiedergabe. Ein Trupp, der lautlos loslaeuft, waere im Nachhinein
    // nicht von einer Stoerung zu unterscheiden, die von selbst aufhoert.
    if (this.engine.recorder) this.engine.recorder.record('repair', id);
    this._log('repair_ordered', open.key, open.params);
    return 'ordered';
  }

  /** Trupp zurueckrufen. Der Fortschritt ist weg -- wer zurueckgerufen wird,
   *  faengt beim naechsten Mal von vorne an. */
  cancel() {
    if (!this.job) return false;
    this._log('repair_cancelled', this.job.key, this.job.params);
    this.job = null;
    return true;
  }

  /** Ein Rechenschritt. Aus Session.step() gerufen, nach faults.step(). */
  step() {
    if (!this.active || !this.job) return;
    const s = this.engine.state;
    const job = JOBS[this.job.kind];
    // Die Voraussetzung gilt fuer die ganze Dauer, nicht nur fuer den
    // Augenblick der Vergabe -- siehe Kopfkommentar an JOBS.
    if (s.destroyed || !job.ready(this.engine)) {
      this._log('repair_aborted', this.job.key, this.job.params);
      this.job = null;
      return;
    }
    // Die Stoerung kann auf einem anderen Weg verschwunden sein (ein
    // Spielstand aus einer Runde ohne diesen Defekt, ein Ereignis, das den
    // Merker mit umgesetzt hat). Dann ist nichts mehr zu tun, und ein Trupp,
    // der trotzdem weiterarbeitet, quittierte am Ende eine Stoerung, die es
    // nicht gibt.
    if (!this.jobs().some((j) => j.id === this.job.id)) {
      this.job = null;
      return;
    }
    if (s.t_sim < this.job.endT) return;
    job.clear(this.engine, this.job.n);
    this.done++;
    this._log('repair_done', this.job.key, this.job.params);
    this.job = null;
  }

  /** Was die Anzeige braucht. null, wenn gerade kein Trupp unterwegs ist. */
  view() {
    const j = this.job;
    if (!j) return null;
    const t = this.engine.state.t_sim;
    const total = j.endT - j.startT;
    return {
      id: j.id, key: j.key, params: j.params,
      remainS: Math.max(0, j.endT - t),
      totalS: total,
      frac: total > 0 ? Math.min(1, Math.max(0, (t - j.startT) / total)) : 1,
    };
  }

  /**
   * Protokolleintrag. Der Schluessel ist die ARBEIT, der Vorgang steht in
   * `kind` -- annunciator.js haengt daran von sich aus ein uebersetztes
   * "— <Vorgang>" (siehe dort, dieselbe Mechanik wie bei kind 'on'/'off' einer
   * Meldung). Andersherum haette jeder Satz den Namen der Arbeit als
   * Platzhalter gebraucht, und den kann die Spielschicht gar nicht liefern:
   * sie kennt die Oberflaeche nicht und uebersetzt nichts.
   */
  _log(kind, jobKey, params) {
    this.engine.ctx.log.push({
      t: this.engine.state.t_sim, key: jobKey, severity: 1,
      params: { ...params }, kind,
    });
  }

  snapshot() {
    return {
      level: this.levelId, done: this.done,
      job: this.job ? { ...this.job } : null,
    };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    // Die Stufe kommt NICHT aus dem Spielstand zurueck -- sie wurde beim
    // Start dieser Runde gewaehlt, und wer einen Stand mit einer anderen
    // Einstellung fortsetzt, meint die neue. Gleiche Regel wie bei
    // FreeFaults.restore() und Dispatch.restore().
    if (Number.isFinite(data.done) && data.done >= 0) this.done = data.done;
    this.job = this._restoreJob(data.job);
  }

  /** Ein Trupp aus dem Spielstand muss vollstaendig und schluessig sein. Ein
   *  halb gelesener Auftrag waere schlimmer als keiner: er loescht am Ende
   *  einen Stoerungsmerker. */
  _restoreJob(d) {
    if (!this.active || !d || typeof d !== 'object') return null;
    const parsed = parseId(d.id);
    if (!parsed || parsed.kind !== d.kind) return null;
    if (!Number.isFinite(d.startT) || !Number.isFinite(d.endT)) return null;
    if (d.startT < 0 || d.endT <= d.startT) return null;
    if (typeof d.key !== 'string') return null;
    return {
      id: d.id, kind: parsed.kind, n: parsed.n, key: d.key,
      params: d.params && typeof d.params === 'object' && !Array.isArray(d.params)
        ? { ...d.params } : {},
      startT: d.startT, endT: d.endT,
    };
  }
}
