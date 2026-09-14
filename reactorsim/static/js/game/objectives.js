// State-based incident goals. Neither controller mode nor SCRAM proves recovery.
const EPS = 1e-8;

export class ScenarioObjectives {
  constructor(engine, scenario) {
    this.engine = engine;
    this.scenario = scenario;
    this.defs = scenario.def.objectives;
    this.restore(null);
  }

  _empty(id) {
    return { id, held: 0, activatedAt: null, startedAt: null,
      levelMin: null, levelMax: null, tempBaseline: null, achievedAt: null };
  }

  _condition(def, d) {
    const { state: s, spec, ctx } = this.engine;
    const finite = ['W_fw', 'W_steam', 'M_sg', 'L_sg', 'pzr_L', 'pzr_p',
      'p_sg', 'W_core', 'T_cl', 'P_th', 'T_ci', 'T_co'].every((k) => Number.isFinite(s[k]));
    const intact = finite && Number.isFinite(d.dnbr) && Number.isFinite(d.subcooling)
      && !s.destroyed && !s.fault && s.pzr_L >= 0.17 && s.pzr_L <= 1
      && s.pzr_p >= 140 && s.pzr_p <= 164 && s.p_sg > 0 && s.p_sg < 84
      && s.W_core >= 18000 && d.dnbr >= 1.3 && d.subcooling >= 10
      && s.T_cl > 0 && s.T_cl < 700 && s.P_th >= 0
      && s.T_ci > 0 && s.T_co > 0;
    if (!intact || (def.max_power_fraction !== undefined
      && !(s.P_th <= def.max_power_fraction * spec.P0_th))) return false;
    if (def.type === 'pwr_power_limited') return true;
    const supply = s.W_fw > 1 && s.W_steam > 1 && s.M_sg >= 0.8 * spec.sg.mass
      && s.L_sg >= 0.4 && s.L_sg <= 0.6;
    if (def.type === 'pwr_feedwater') return supply;
    if (def.type !== 'pwr_heat_removal') return false;
    const leak = ctx.sgLeak === undefined ? 0 : ctx.sgLeak;
    return supply && Number.isFinite(leak) && leak >= 0
      && Math.abs(s.W_fw + leak - s.W_steam) <= Math.max(5, 0.1 * s.W_steam);
  }

  step(dt) {
    const s = this.engine.state;
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(s.t_sim)) return;
    const elapsed = s.t_sim - this.lastT;
    if (elapsed <= 0) return;
    this.lastT = s.t_sim;
    const d = this.engine.derive();
    for (const [i, def] of this.defs.entries()) {
      const entry = this.state[i];
      if (entry.activatedAt === null) {
        if (def.after_events.every((id) => this.scenario.events.some((ev) => ev.id === id && ev.fired))) {
          entry.activatedAt = s.t_sim;
        }
        continue;
      }
      if (s.t_sim <= entry.activatedAt) continue;
      const heat = def.type === 'pwr_heat_removal';
      const temperature = (s.T_ci + s.T_co) / 2;
      const low = entry.levelMin === null ? s.L_sg : Math.min(entry.levelMin, s.L_sg);
      const high = entry.levelMax === null ? s.L_sg : Math.max(entry.levelMax, s.L_sg);
      const baseline = entry.tempBaseline ?? temperature;
      if (!this._condition(def, d) || (heat && (high - low > 0.02 + EPS
        || temperature - baseline > 1 + EPS))) {
        // Keep the first achievement for reporting, but revoke current success.
        Object.assign(entry, this._empty(def.id), {
          activatedAt: entry.activatedAt, achievedAt: entry.achievedAt,
        });
        continue;
      }
      if (entry.startedAt === null) entry.startedAt = Math.max(entry.activatedAt, s.t_sim - dt);
      if (heat) Object.assign(entry, { levelMin: low, levelMax: high, tempBaseline: baseline });
      entry.held = Math.min(def.hold_s, entry.held + Math.min(dt, elapsed, s.t_sim - entry.activatedAt));
      if (entry.held >= def.hold_s - EPS) {
        entry.held = def.hold_s;
        if (entry.achievedAt === null) entry.achievedAt = s.t_sim;
      }
    }
  }

  get done() { return this.state.every((entry, i) => entry.held >= this.defs[i].hold_s); }

  view() {
    return this.state.map((entry, i) => ({ id: entry.id, type: this.defs[i].type,
      held: entry.held, required: this.defs[i].hold_s,
      active: entry.activatedAt !== null && this.engine.state.t_sim > entry.activatedAt,
      met: entry.held >= this.defs[i].hold_s, achievedAt: entry.achievedAt }));
  }

  snapshot() {
    return { version: 1, scenario: this.scenario.id, state: this.state.map((entry) => ({ ...entry })) };
  }

  restore(data) {
    this.state = this.defs.map((def) => this._empty(def.id));
    this.lastT = this.engine.state.t_sim;
    if (!data || data.version !== 1 || data.scenario !== this.scenario.id
      || !Array.isArray(data.state) || data.state.length !== this.defs.length) return;
    const s = this.engine.state;
    if (!Number.isFinite(s.t_sim) || s.t_sim < 0) return;
    const d = this.engine.derive();
    const valid = this.defs.every((def, i) => {
      const entry = data.state[i];
      if (!entry || entry.id !== def.id || !Number.isFinite(entry.held)
        || entry.held < 0 || entry.held > def.hold_s) return false;
      const events = def.after_events.map((id) => this.scenario.events.find((ev) => ev.id === id));
      if (events.some((ev) => !ev || !Number.isFinite(ev.t))) return false;
      const after = Math.max(...events.map((ev) => ev.t));
      const time = (t, min) => Number.isFinite(t) && t >= min - EPS && t <= s.t_sim + EPS;
      if (entry.activatedAt !== null && !time(entry.activatedAt, after)) return false;
      if (entry.achievedAt !== null && (entry.activatedAt === null
        || !time(entry.achievedAt, entry.activatedAt + def.hold_s))) return false;
      if (entry.held === 0) {
        return entry.startedAt === null && entry.levelMin === null
          && entry.levelMax === null && entry.tempBaseline === null;
      }
      if (entry.activatedAt === null || !time(entry.startedAt, entry.activatedAt)
        || s.t_sim <= entry.activatedAt || entry.held > s.t_sim - entry.startedAt + EPS
        || (entry.held === def.hold_s && entry.achievedAt === null)
        || !this._condition(def, d)) return false;
      // Held time is capped: a completed goal may remain valid for the whole run.
      if (def.type !== 'pwr_heat_removal') {
        return entry.levelMin === null && entry.levelMax === null && entry.tempBaseline === null;
      }
      return [entry.levelMin, entry.levelMax, entry.tempBaseline].every(Number.isFinite)
        && entry.levelMin >= 0.4 && entry.levelMax <= 0.6
        && entry.levelMin <= s.L_sg && entry.levelMax >= s.L_sg
        && entry.levelMax - entry.levelMin <= 0.02 + EPS
        && entry.tempBaseline > 0 && entry.tempBaseline < 700
        && (s.T_ci + s.T_co) / 2 <= entry.tempBaseline + 1 + EPS;
    });
    // Reject a bad block atomically, rather than retain a convenient subset.
    if (valid) this.state = data.state.map((entry, i) => Object.fromEntries(
      Object.keys(this._empty(this.defs[i].id)).map((key) => [key, entry[key]])));
  }
}
