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
      levelMin: null, levelMax: null, tempBaseline: null, achievedAt: null,
      ...(this.defs.some((def) => def.id === id && def.type === 'rbmk_heat_removal')
        ? { graphiteBaseline: null } : {}) };
  }

  _condition(def, d) {
    const { state: s, spec, ctx } = this.engine;
    if (def.type === 'rbmk_inventory' || def.type === 'rbmk_heat_removal') {
      const finite = ['W_fw', 'W_fwMain', 'W_fwAux', 'W_steam', 'fwSupplyMax',
        'M_drum', 'L_drum', 'p_drum', 'W_core', 'T_cl', 'T_gr', 'T_ci', 'T_co',
        'P_th', 'n', 'coolantHeatMW', 'auxWaterKg'].every((k) => Number.isFinite(s[k]));
      const intact = spec.id === 'rbmk' && s.reactor === 'rbmk' && finite
        && !s.destroyed && !s.fault && s.scram?.active === true
        && s.rod instanceof Float64Array && s.rod.length === spec.rodBanks.length
        && s.rod.every((v) => Number.isFinite(v) && v >= 0.99 && v <= 1)
        && s.n >= 0 && s.n <= 0.01 && s.P_th >= 0
        && s.W_core >= 5000 && s.p_drum >= 55 && s.p_drum <= 75
        && s.T_cl > 0 && s.T_cl < 700 && s.T_gr > 0 && s.T_gr <= 900
        && s.T_ci > 0 && s.T_ci < 700 && s.T_co > 0 && s.T_co < 700 && s.coolantHeatMW > 0
        && s.M_drum >= 0.9 * spec.drum.mass && s.M_drum <= 1.1 * spec.drum.mass
        && s.L_drum >= 0.35 && s.L_drum <= 0.7
        && s.W_fw > 1 && s.W_steam > 1 && s.W_fwMain >= 0 && s.W_fwAux >= 0
        && s.fwSupplyMax >= 0 && s.fwSupplyMax <= 1.3 * spec.drum.W_steam0
        && s.W_fwMain <= s.fwSupplyMax + EPS
        && s.W_fwAux <= spec.auxFeed.maxFlow && s.auxWaterKg >= 0
        && s.auxWaterKg <= spec.auxFeed.capacityKg
        && Math.abs(s.W_fw - s.W_fwMain - s.W_fwAux) <= EPS
        && (s.W_fwAux <= 1 || (s.auxFeedInstalled === true && s.auxFeedAvailable === true));
      if (!intact || (def.max_power_fraction !== undefined
        && (!Number.isFinite(def.max_power_fraction) || def.max_power_fraction < 0
          || def.max_power_fraction > 0.1 || s.P_th > def.max_power_fraction * spec.P0_th))) return false;
      const tolerance = Math.max(5, 0.1 * s.W_steam);
      if (s.W_fw < s.W_steam - tolerance) return false;
      if (def.type === 'rbmk_inventory') return true;
      return Math.abs(s.W_fw - s.W_steam) <= tolerance
        && s.auxWaterKg >= Math.max(10000, s.W_fwAux * 300);
    }
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
      const heldBefore = entry.held;
      const metBefore = heldBefore >= def.hold_s;
      const key = `obj_${def.type}_title`;
      const rbmkHeat = def.type === 'rbmk_heat_removal';
      const heat = def.type === 'pwr_heat_removal' || rbmkHeat;
      const temperature = (s.T_ci + s.T_co) / 2;
      const level = rbmkHeat || def.type === 'rbmk_inventory' ? s.L_drum : s.L_sg;
      const low = entry.levelMin === null ? level : Math.min(entry.levelMin, level);
      const high = entry.levelMax === null ? level : Math.max(entry.levelMax, level);
      const baseline = entry.tempBaseline ?? temperature;
      if (!this._condition(def, d) || (heat && (high - low > 0.02 + EPS
        || temperature - baseline > 1 + EPS))
        || (rbmkHeat && s.T_gr - (entry.graphiteBaseline ?? s.T_gr) > 1 + EPS)) {
        // Keep the first achievement for reporting, but revoke current success.
        Object.assign(entry, this._empty(def.id), {
          activatedAt: entry.activatedAt, achievedAt: entry.achievedAt,
        });
        if (heldBefore > 0) this.engine.ctx.trends?.mark({ t: s.t_sim,
          kind: metBefore ? 'goal_lost' : 'goal_reset', key, id: def.id });
        continue;
      }
      if (entry.startedAt === null) entry.startedAt = Math.max(entry.activatedAt, s.t_sim - dt);
      if (heat) Object.assign(entry, { levelMin: low, levelMax: high, tempBaseline: baseline });
      if (rbmkHeat && entry.graphiteBaseline === null) entry.graphiteBaseline = s.T_gr;
      entry.held = Math.min(def.hold_s, entry.held + Math.min(dt, elapsed, s.t_sim - entry.activatedAt));
      if (heldBefore === 0 && entry.held > 0) this.engine.ctx.trends?.mark({
        t: s.t_sim, kind: 'goal_start', key, id: def.id });
      if (entry.held >= def.hold_s - EPS) {
        entry.held = def.hold_s;
        if (entry.achievedAt === null) entry.achievedAt = s.t_sim;
        if (!metBefore) this.engine.ctx.trends?.mark({ t: s.t_sim, kind: 'goal_met', key, id: def.id });
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
          && entry.levelMax === null && entry.tempBaseline === null
          && (def.type !== 'rbmk_heat_removal' || entry.graphiteBaseline === null);
      }
      if (entry.activatedAt === null || !time(entry.startedAt, entry.activatedAt)
        || s.t_sim <= entry.activatedAt || entry.held > s.t_sim - entry.startedAt + EPS
        || (entry.held === def.hold_s && entry.achievedAt === null)
        || !this._condition(def, d)) return false;
      // Held time is capped: a completed goal may remain valid for the whole run.
      if (def.type === 'rbmk_heat_removal') {
        return [entry.levelMin, entry.levelMax, entry.tempBaseline, entry.graphiteBaseline].every(Number.isFinite)
          && entry.levelMin >= 0.35 && entry.levelMax <= 0.7
          && entry.levelMin <= s.L_drum && entry.levelMax >= s.L_drum
          && entry.levelMax - entry.levelMin <= 0.02 + EPS
          && entry.tempBaseline > 0 && entry.tempBaseline < 700
          && (s.T_ci + s.T_co) / 2 <= entry.tempBaseline + 1 + EPS
          && entry.graphiteBaseline > 0 && entry.graphiteBaseline <= 900
          && s.T_gr <= entry.graphiteBaseline + 1 + EPS;
      }
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
