// Aufzeichnung eines Laufs.
//
// Jede Bedienhandlung wird mit der Anzahl der bis dahin abgeschlossenen
// Rechenschritte vermerkt, nicht mit einer Uhrzeit -- die serverseitige
// Nachrechnung (siehe replay.js) kennt kein performance.now(), wohl aber
// dieselbe Schrittzahl bei denselben Eingaben (fester Zeitschritt DT, siehe
// loop.js). Das Protokoll allein plus Reaktortyp, Szenario und Startwert
// (kommt aus der Szenariodatei, die der Server ohnehin kennt) reicht, um den
// ganzen Lauf woanders bitgleich noch einmal zu rechnen.
//
// attachRecorder() ersetzt engine.step() durch eine Fassung, die zusätzlich
// mitzählt -- EINE Stelle statt zwei: die normale Spielschleife (loop.js)
// UND der Xenon-Zeitraffer (main.js fastForwardXenon()) rufen beide
// engine.step() direkt auf, und beide sollen mitgezählt werden, ohne dass
// main.js an zwei Stellen daran denken muss.

export class Recorder {
  constructor() {
    this.log = [];
    this.stepCount = 0;
  }

  /**
   * @param {string} id     z.B. 'rod_jog', 'write:ctl_pzr_heater' -- siehe
   *                        game/coreActions.js (typunabhängige Handlungen)
   *                        und game/replayKit.js (typspezifische, über
   *                        hooks.uiControls())
   * @param {*} value
   */
  record(id, value) {
    this.log.push({ n: this.stepCount, id, value });
  }

  serialize() { return this.log; }
}

/** @param {object} engine  wie von sim/engine.js createEngine() geliefert
 *  @returns {Recorder} */
export function attachRecorder(engine) {
  const recorder = new Recorder();
  const rawStep = engine.step;
  engine.step = (dt) => {
    rawStep(dt);
    recorder.stepCount++;
  };
  engine.recorder = recorder;
  return recorder;
}
