import { StartupTutorial } from './tutorial.js';
import { equilibriumPoisons } from '../sim/poisons.js';

export const BWR_STARTUP_TUTORIAL = 'bwr_startup';

export class BwrStartupTutorial extends StartupTutorial {
  get prefix() { return 'tut_bwr_'; }
  get demand() { return this.index >= 2 ? 300 : 0; }
  get rhoTarget() { return Math.max(-30, Math.min(80, (0.225 - this.engine.state.n) * 1500)); }

  prepare() {
    const { state: s, ctx: c, spec: sp, reactivity } = this.engine;
    // Synthetic hot restart, not a reconstructed shutdown history. Start with
    // low-power poisons and no steam voids; the normal model evolves both.
    Object.assign(s, equilibriumPoisons(0.2));
    c.rodCtl.auto = false;
    s.alphaBar = s.x_e = 0;
    c.voidLag.set(0);
    s.rod[0] = s.rodDmd[0] = 1;
    // Only the control bank is available to the operator. Prepare the shutdown
    // bank once for -500 pcm, leaving control-bank travel for the later rise.
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      s.rod[1] = (lo + hi) / 2;
      if (reactivity.compute(s, sp) > -0.005) lo = s.rod[1];
      else hi = s.rod[1];
    }
    s.rod[1] = s.rodDmd[1] = (lo + hi) / 2;
    reactivity.compute(s, sp);
    c.govCtl.auto = false;
    c.govCtl.manual = 0;
    c.govCtl.pi.preset(0);
    c.govValve.pos = c.govValve.demand = s.gov = 0;
    c.fwCtl.auto = true;
    c.fwCtl.manual = 0;
    c.fwCtl.pi.preset(0);
    c.fwCtl.rate.v = 0;
    s.W_fw = s.W_steam = s.P_e = s.P_demand = 0;
    s.W_core = s.W_rec = c.recircPump.flow(0.12);
  }

  conditions() {
    const { state: s, ctx: c, spec: sp } = this.engine;
    const d = this.engine.derive();
    const intact = !s.destroyed && !s.fault && !s.scram.active && s.acPower && s.dcPower;
    const pressure = s.p_dome >= 67 && s.p_dome <= 73;
    const level = s.L_rpv >= 0.35 && s.L_rpv <= 0.65;
    const pumps = c.recircPump.running && c.recircPump.speed >= 0.9 && s.W_core >= 11000;
    const base = intact && pressure && level;
    const power = base && pumps && s.n >= 0.2 && s.n <= 0.25
      && c.govCtl.auto && c.fwCtl.auto && s.msiv >= 0.99 && s.breaker && !s.turbineTripped
      && d.decayRatio <= 0.8 && !(d.period > 0 && d.period < 20);
    const load = power && s.P_e >= 280 && s.P_e <= 320
      && s.P_th >= 0.2 * sp.P0_th && s.P_th <= 0.25 * sp.P0_th && d.dnbr >= 1.3;
    return [
      base && s.n < 0.001 && d.rho_pcm < 0 && d.T_avg >= 543.15 && d.T_avg <= 568.15,
      base && pumps,
      power,
      load,
      load && Math.abs(d.rho_pcm) <= 30 && !(d.period > 0 && d.period < 60),
    ];
  }

  hint() {
    const { state: s, ctx: c } = this.engine;
    const d = this.engine.derive();
    if (!s.acPower || !s.dcPower) return 'tut_bwr_hint_supply';
    if (s.p_dome < 67 || s.p_dome > 73) return 'tut_bwr_hint_pressure';
    if (s.L_rpv < 0.35 || s.L_rpv > 0.65) return 'tut_bwr_hint_level';
    if (this.index === 0) return 'tut_hint_inspect';
    if (this.index === 1 || !c.recircPump.running || c.recircPump.speed < 0.9 || s.W_core < 11000)
      return 'tut_bwr_hint_pumps';
    if (!c.govCtl.auto || !c.fwCtl.auto || s.msiv < 0.99 || !s.breaker || s.turbineTripped)
      return 'tut_bwr_hint_steam';
    if (d.decayRatio > 0.8) return 'tut_bwr_hint_stability';
    if (d.rho_pcm > 150 || (s.n > 0.001 && d.period > 0 && d.period < 20)) return 'tut_hint_fast';
    if (Math.abs(s.rodDmd[0] - s.rod[0]) >= 0.001) return 'tut_hint_travel';
    if (d.rho_pcm < this.rhoTarget - 10) return 'tut_bwr_hint_pull';
    if (d.rho_pcm > this.rhoTarget + 10) return 'tut_bwr_hint_insert';
    return this.index === 2 ? 'tut_bwr_hint_wait' : 'tut_hint_settle';
  }

  snapshot() { return { ...super.snapshot(), reactor: 'bwr' }; }

  view() {
    const view = super.view();
    const { state: s } = this.engine;
    const d = this.engine.derive();
    return { ...view, values: { ...view.values, pressure: s.p_dome, level: s.L_rpv * 100,
      recirc: s.recircDmd * 100, void: s.alphaBar * 100, stability: d.decayRatio,
      margin: d.dnbr, rhoLow: this.rhoTarget - 10, rhoHigh: this.rhoTarget + 10 } };
  }
}
