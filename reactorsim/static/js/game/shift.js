// Schichtbericht: alle acht Stunden Simulationszeit eine Bilanz.
//
// Das freie Spiel hatte bis hierher gar keine Rückmeldung. Ein Szenario endet
// nach zwanzig Minuten mit einer Auswertung; das freie Spiel endet nie, und
// deshalb erfuhr der Spieler nie, ob die letzte Nacht gut oder schlecht war.
// Gerechnet wurde alles Nötige längst (siehe RunState in game/scenario.js) --
// es wurde nur nirgends abgelesen.
//
// Warum acht Stunden und nicht eine: das ist die Schicht, nach der sich die
// ganze Anlage benennt, und bei 60-fachem Zeitraffer sind es acht Minuten
// echter Zeit. Eine stündliche Bilanz wäre alle sechzig Sekunden ein
// Protokolleintrag und damit Lärm; eine tägliche käme so selten, dass
// zwischen Ursache und Zahl keine Verbindung mehr entsteht.
//
// Warum Differenzen und keine Summen: eine Summe seit Rundenbeginn wird mit
// jeder Schicht träger und sagt irgendwann nur noch, wie lange gespielt
// wurde. Die Frage lautet "war DIESE Schicht besser als die davor", und die
// beantwortet nur ein Zuwachs.
//
// Der Bericht ist bewusst kein Dialog: er wandert als Protokolleintrag in
// dieselbe Zeitleiste wie Störungen und Meldungen (siehe ui/annunciator.js).
// Ein Kasten, der alle acht Minuten die Anlage verdeckt, wäre nach der
// dritten Schicht ein Gegner.

export const SHIFT_SECONDS = 8 * 3600;

export class ShiftLog {
  /**
   * @param {object} run  RunState, dessen Kennzahlen bilanziert werden
   * @param {?object} repairs  Repairs der Runde, oder null ohne Trupp (jedes
   *   Szenario, und das freie Spiel auf Stufe "aus"). Als Verweis, nicht als
   *   Zahl: der Trupp fuehrt seinen Zaehler bereits im Spielstand
   *   (Repairs.done), und eine zweite Kopie in der RunState waere dieselbe
   *   Groesse an zwei Stellen -- die eine davon frueher oder spaeter falsch.
   *   Deshalb auch anders als bei den Netzauftraegen: die haben ausser dem
   *   Bericht keinen eigenen Spielstand, an dem sie haengen koennten (siehe
   *   ordersMet in game/scenario.js).
   */
  constructor(run, repairs = null) {
    this.run = run;
    this.repairs = repairs;
    this.count = 0;
    this.nextAt = SHIFT_SECONDS;
    this.base = this._mark();
    this.last = null;
    /** @type {?function(object):void} wird je fertiger Schicht gerufen */
    this.onReport = null;
  }

  /** Stand der bilanzierten Größen in diesem Augenblick. */
  _mark() {
    const r = this.run;
    const v = r.violationSeconds;
    return {
      delivered: r.energyDelivered,
      demanded: r.energyDemanded,
      deviation: r.deviationMWh,
      // Alarmzeit ist die Zeit, in der ueberhaupt eine Kachel stand -- die
      // drei Stufen sind untereinander ausschliessend (siehe accumulate()),
      // ihre Summe zaehlt deshalb keine Sekunde doppelt.
      alarm: v[1] + v[2] + v[3],
      scram: r.scramCount,
      ordersMet: r.ordersMet || 0,
      ordersFailed: r.ordersFailed || 0,
      repairs: this.repairs ? this.repairs.done : 0,
    };
  }

  /**
   * Simulationszeit weiterdrehen und fällige Schichten abschließen.
   *
   * Schleife statt einzelner Prüfung: der Xenon-Vorlauf (siehe main.js)
   * springt in sehr großen Schritten durch die Zeit, und eine übersprungene
   * Schicht darf nicht verschwinden, sie ist ja tatsächlich vergangen.
   *
   * @param {number} tSim  Simulationszeit in Sekunden
   */
  step(tSim) {
    while (Number.isFinite(tSim) && tSim >= this.nextAt) {
      const at = this.nextAt;
      this.nextAt += SHIFT_SECONDS;
      this.count++;
      const now = this._mark();
      const report = {
        n: this.count,
        t: at,
        delivered_mwh: now.delivered - this.base.delivered,
        demanded_mwh: now.demanded - this.base.demanded,
        deviation_mwh: now.deviation - this.base.deviation,
        alarm_seconds: now.alarm - this.base.alarm,
        scram_count: now.scram - this.base.scram,
        orders_met: now.ordersMet - this.base.ordersMet,
        orders_total: (now.ordersMet - this.base.ordersMet)
          + (now.ordersFailed - this.base.ordersFailed),
        repairs_done: now.repairs - this.base.repairs,
      };
      this.base = now;
      this.last = report;
      if (this.onReport) this.onReport(report);
    }
  }

  /** Protokollzeile zum Bericht -- Zahlen ganzzahlig, wie bei jedem anderen
   *  Eintrag mit Platzhaltern (siehe game/helper.js): die Sprachdatei kennt
   *  kein Zahlenformat, und ui/i18n.js formatiert nur, was es selbst
   *  gerechnet hat. */
  static logEntry(report) {
    const params = {
      n: report.n,
      mwh: Math.round(report.delivered_mwh),
      dev: Math.round(report.deviation_mwh),
      min: Math.round(report.alarm_seconds / 60),
      scram: report.scram_count,
    };
    // Zwei Schluessel statt eines mit "Auftraege 0/0": wer ohne Netzauftraege
    // spielt (Stufe aus, siehe game/dispatch.js), soll in jeder Schicht keine
    // Zahl lesen muessen, die immer dieselbe ist.
    if (report.orders_total > 0) {
      return {
        t: report.t,
        key: 'log_shift_report_orders',
        severity: 1,
        params: { ...params, met: report.orders_met, total: report.orders_total },
      };
    }
    return { t: report.t, key: 'log_shift_report', severity: 1, params };
  }

  /**
   * Zweite Zeile fuer den Instandhaltungstrupp, oder null, wenn er in dieser
   * Schicht nichts fertig hatte.
   *
   * Eigene Zeile und nicht ein weiterer Platzhalter in logEntry(): die
   * Auftraege haben dort schon zwei Textfassungen (mit und ohne), und ein
   * zweiter solcher Zweig haette vier gebraucht, je einen Satz fuer jede
   * Kombination aus Auftraegen und Trupp. Getrennt bleibt es bei zwei
   * unabhaengigen Entscheidungen -- und wer ohne Trupp spielt oder eine
   * stoerungsfreie Schicht hatte, liest gar keine Zahl statt immer derselben
   * Null.
   */
  static repairLogEntry(report) {
    if (!report.repairs_done) return null;
    return {
      t: report.t,
      key: 'log_shift_repairs',
      severity: 1,
      params: { n: report.n, done: report.repairs_done },
    };
  }

  snapshot() {
    return { count: this.count, nextAt: this.nextAt, base: { ...this.base } };
  }

  restore(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.count) && d.count >= 0) this.count = d.count;
    if (Number.isFinite(d.nextAt) && d.nextAt > 0) this.nextAt = d.nextAt;
    // Die Bezugslinie NICHT auf den frisch gebauten Stand stehen lassen: der
    // wurde gebildet, bevor persist.js die RunState des Spielstands
    // eingespielt hat, und ist deshalb null. Ohne diesen Zweig zaehlte die
    // erste Schicht nach dem Laden die gesamte bisherige Runde noch einmal.
    if (d.base && typeof d.base === 'object') {
      // Was der Stand nicht kennt, bekommt den JETZIGEN Wert und nicht die
      // Null aus dem Rundenbau: ein Stand von vor dieser Groesse (die
      // Reparaturen, seit 0.6.21) hat zu ihr keine Bezugslinie, und eine
      // Bezugslinie bei null schriebe der ersten Schicht nach dem Laden alles
      // gut, was vor dem Speichern schon fertig war.
      const now = this._mark();
      for (const k of Object.keys(this.base)) {
        this.base[k] = Number.isFinite(d.base[k]) ? d.base[k] : now[k];
      }
    }
  }
}
