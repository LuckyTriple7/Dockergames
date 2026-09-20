// State-based training objectives. This module never drives the plant after
// initial preparation; every operating action uses the normal controls.
export const STARTUP_TUTORIAL = 'pwr_startup';
// Historical fixed 5-step startup sequence, shared by PWR/BWR/RBMK anfahren
// (their subclasses override conditions()/hint()/prepare(), not the steps
// themselves). A tutorial for a DIFFERENT kind of walkthrough -- e.g. an
// incident replay with its own chapters -- overrides the `steps`/
// `holdSeconds` getters below instead of these module constants, so it
// cannot affect the three existing subclasses that don't.
export const TUTORIAL_STEPS = ['inspect', 'pumps', 'power', 'load', 'stable'];
const HOLD_SECONDS = [5, 3, 2, 15, 120];

export class StartupTutorial {
  constructor(engine) {
    this.engine = engine;
    this.index = 0;
    this.held = 0;
    this.elapsed = 0;
    this.completed = [];
  }

  /** Overridable per subclass. Defaults keep the historical PWR sequence. */
  get steps() { return TUTORIAL_STEPS; }
  get holdSeconds() { return HOLD_SECONDS; }
  // Indices that need an explicit confirm button instead of auto-advancing
  // once held long enough -- see confirmInspect()/step() below. Only step 0
  // in the three original startup tutorials; the Chernobyl replay overrides
  // this to add its narrative-only 'dip' step.
  get confirmIndices() { return [0]; }
  // Indices whose compact status line should show hint() live instead of a
  // held/required countdown -- for a step whose holdSeconds is a tiny
  // internal debounce (not a real wait a player should watch tick down), a
  // "0/0.2s" readout is actively misleading (looks like "almost done" while
  // the real wait is tens of seconds, driven by an external condition, not
  // by holding still). Empty by default; the Chernobyl replay overrides this
  // for its 'window'/'az5' steps (see chernobylTutorial.js).
  get liveStatusIndices() { return []; }
  // Vorfuehrmodus: true heisst, die Uebung fuehrt die Anlage selbst und die
  // Stellteile bleiben gesperrt (siehe ui/controls.js: setControlsLocked).
  // Die drei Anfahrtutorials sind das Gegenteil davon -- dort IST das
  // Bedienen die Uebung; nur der Chernobyl-Nachbau ueberschreibt das.
  get locked() { return false; }
  // Wunschgeschwindigkeit der Uebung, oder null fuer "der Spieler
  // entscheidet". Gedacht fuer Abschnitte, die bei 1x schlicht zu schnell
  // vorbei sind, um etwas zu zeigen -- der Chernobyl-Nachbau nutzt das fuer
  // die Sekunden um AZ-5 (siehe chernobylTutorial.js). Die drei
  // Anfahrtutorials haben keinen solchen Abschnitt.
  get speedHint() { return null; }

  prepare() {
    const { state: s, ctx: c, spec: sp, reactivity } = this.engine;
    // Prepared hot restart: shutdown bank withdrawn, control bank inserted.
    // Boron is an initial condition, calibrated with the existing reactivity
    // model to -500 pcm. Subsequent dilution/mixing remains ordinary physics.
    c.rodCtl.auto = false;
    s.rod[1] = s.rodDmd[1] = 0;
    for (let i = 0; i < 8; i++) {
      const rho = reactivity.compute(s, sp);
      s.C_B += (rho + 0.005) / (sp.feedback.boron_pcm_per_ppm * 1e-5);
    }
    s.C_B_cmd = s.C_B;
    c.boronMix.set(s.C_B);
    reactivity.compute(s, sp);
    c.govCtl.auto = false;
    c.govCtl.manual = 0;
    c.govValve.pos = c.govValve.demand = s.gov = 0;
    c.fwCtl.rate.v = 0;
    s.W_fw = 0;
    s.W_core = c.pumps.reduce((sum, p) => sum + p.flow(0.04), 0);
    s.P_demand = 0;
  }

  get done() { return this.index === this.steps.length; }
  get prefix() { return 'tut_'; }
  get demand() { return this.index >= 3 ? 150 : 0; }

  get inspectReady() {
    return this.confirmIndices.includes(this.index) && this.held + 1e-8 >= this.holdSeconds[this.index]
      && this.conditions()[this.index];
  }

  confirmInspect() {
    if (!this.confirmIndices.includes(this.index)) return false;
    // Recheck even while paused: a stale button must not confirm a lost hold.
    this.step(0);
    if (!this.inspectReady) return false;
    this.completeStep();
    return true;
  }

  conditions() {
    const { state: s, ctx: c } = this.engine;
    const d = this.engine.derive();
    const intact = !s.destroyed && !s.fault && !s.scram.active;
    const pressure = s.p_prim >= 140 && s.p_prim <= 164;
    const pumps = c.pumps.every(p => p.running && p.speed >= 0.9) && s.W_core >= 18000;
    const load = intact && pressure && pumps && c.rodCtl.auto && c.govCtl.auto && c.fwCtl.auto
      && s.P_e >= 140 && s.P_e <= 160 && s.P_th >= 0.1 * this.engine.spec.P0_th
      && s.P_th <= 0.2 * this.engine.spec.P0_th && s.L_sg >= 0.35 && s.L_sg <= 0.65
      && d.dnbr >= 1.3;
    return [
      intact && pressure && s.n < 0.001 && d.rho_pcm < 0 && d.T_avg >= 543.15 && d.T_avg <= 578.15,
      intact && pressure && pumps,
      intact && pressure && pumps && s.n >= 0.02 && s.n <= 0.2
        && !(d.period > 0 && d.period < 10),
      load,
      load && Math.abs(d.rho_pcm) <= 30 && !(d.period > 0 && d.period < 60),
    ];
  }

  step(dt) {
    if (this.done) return;
    this.elapsed += dt;
    const heldBefore = this.held;
    const key = `${this.prefix}${this.steps[this.index]}_title`;
    this.held = this.conditions()[this.index] ? Math.min(this.held + dt, this.holdSeconds[this.index]) : 0;
    if (heldBefore === 0 && this.held > 0) this.engine.ctx.trends?.mark({
      t: this.engine.state.t_sim, kind: 'goal_start', key });
    if (heldBefore > 0 && this.held === 0) this.engine.ctx.trends?.mark({
      t: this.engine.state.t_sim, kind: 'goal_reset', key });
    if (!this.confirmIndices.includes(this.index) && this.held + 1e-8 >= this.holdSeconds[this.index]) this.completeStep();
  }

  completeStep() {
    const id = this.steps[this.index];
    this.completed.push({ id, t: this.engine.state.t_sim });
    this.engine.ctx.trends?.mark({ t: this.engine.state.t_sim, kind: 'goal_met', key: `${this.prefix}${id}_title` });
    this.index++;
    this.held = 0;
    this.elapsed = 0;
  }

  hint() {
    const { state: s, ctx: c } = this.engine;
    if (s.p_prim < 140 || s.p_prim > 164) return 'tut_hint_pressure';
    if (this.index >= 2 && !c.pumps.every(p => p.running && p.speed >= 0.9)) return 'tut_hint_pumps';
    if (this.index === 2) {
      const d = this.engine.derive();
      if (d.rho_pcm > 150 || (s.n > 0.001 && d.period > 0 && d.period < 20)) return 'tut_hint_fast';
      if (Math.abs(s.rodDmd[0] - s.rod[0]) > 0.01) return 'tut_hint_travel';
      if (d.rho_pcm < 50) return 'tut_hint_pull';
      if (d.rho_pcm > 100) return 'tut_hint_insert';
      return 'tut_hint_wait';
    }
    if (this.index >= 3) {
      if (!c.rodCtl.auto || !c.govCtl.auto || !c.fwCtl.auto) return 'tut_hint_auto';
      if (s.L_sg < 0.35 || s.L_sg > 0.65) return 'tut_hint_level';
      return 'tut_hint_settle';
    }
    return this.index === 1 ? 'tut_hint_pumps' : 'tut_hint_inspect';
  }

  snapshot() {
    // Bewusst OHNE `steps` -- das ist das Speicherformat (siehe
    // net/persist.js), und das darf sich nicht aendern. Fuer die
    // Debrief-Anzeige nach einem ANDEREN Tutorial als den fuenf Anfahrschritten
    // haengt session.js die Schrittliste separat an result.tutorial an.
    return { index: this.index, held: this.held, elapsed: this.elapsed,
      completed: this.completed.map(e => ({ ...e })) };
  }

  restore(data) {
    const steps = this.steps;
    if (!data || !Number.isInteger(data.index) || data.index < 0 || data.index > steps.length) return;
    const entries = data.completed;
    if (!Array.isArray(entries) || entries.length !== data.index
      || entries.some((e, i) => e?.id !== steps[i] || !Number.isFinite(e.t)
        || e.t < 0 || e.t > this.engine.state.t_sim)) return;
    this.index = data.index;
    this.completed = entries.map(e => ({ ...e }));
    this.held = Number.isFinite(data.held) ? Math.max(0, Math.min(data.held, this.holdSeconds[this.index] || 0)) : 0;
    this.elapsed = Number.isFinite(data.elapsed) ? Math.max(0, data.elapsed) : 0;
  }

  view() {
    const s = this.engine.state;
    const d = this.engine.derive();
    return { ...this.snapshot(), id: this.steps[this.index], done: this.done,
      inspectReady: this.inspectReady, inspectValid: this.index === 0 && this.conditions()[0],
      inspectIntact: !s.destroyed && !s.fault && !s.scram.active,
      required: this.holdSeconds[this.index] || 0, hint: this.hint(),
      values: { pressure: s.p_prim, temperature: d.T_avg - 273.15, flow: s.W_core,
        neutron: s.n * 100, power: d.power_th_pct, electric: s.P_e, level: s.L_sg * 100,
        rho: d.rho_pcm, pumps: this.engine.ctx.pumpList.filter(p => p.running && p.speed >= 0.9).length } };
  }
}
