import { StartupTutorial } from './tutorial.js';

export const RBMK_STARTUP_TUTORIAL = 'rbmk_startup';

// Only preparation sets initial conditions. Training never changes plant
// coefficients, bypasses trips or operates equipment during the run.
export class RbmkStartupTutorial extends StartupTutorial {
  get prefix() { return 'tut_rbmk_'; }
  get demand() { return this.index >= 2 ? 300 : 0; }

  prepare() {
    const { state: s, ctx: c } = this.engine;
    c.powerCtl.auto = false;
    c.govCtl.auto = false;
    c.govCtl.manual = 0;
    c.govValve.pos = c.govValve.demand = s.gov = 0;
    c.fwCtl.rate.v = 0;
    s.W_fw = s.W_fwDemand = s.W_fwMain = 0;
    s.W_steam = s.P_e = s.P_demand = 0;
    s.W_core = c.mcp.reduce((sum, p) => sum + p.flow(0.06), 0);
  }

  conditions() {
    const { state: s, ctx: c, spec: sp } = this.engine;
    const d = this.engine.derive();
    const intact = !s.destroyed && !s.fault && !s.scram.active;
    const pressure = s.p_drum >= 65 && s.p_drum <= 73;
    const reserve = d.orm >= sp.orm.min;
    const pumps = c.mcp.every(p => p.running && p.speed >= 0.9) && s.W_core >= 9450;
    const level = s.L_drum >= 0.35 && s.L_drum <= 0.65;
    const base = intact && pressure && reserve && level;
    const power = base && pumps && s.n >= 0.28 && s.n <= 0.32
      && c.govCtl.auto && c.fwCtl.auto && !(d.period > 0 && d.period < 20);
    const load = power && c.powerCtl.auto && s.P_e >= 280 && s.P_e <= 320
      && s.P_th >= 0.28 * sp.P0_th && s.P_th <= 0.32 * sp.P0_th && d.dnbr >= 1.3;
    return [
      base && s.n < 0.001 && d.rho_pcm < 0 && d.T_avg >= 543.15 && d.T_avg <= 568.15,
      base && pumps,
      power,
      load,
      load && Math.abs(d.rho_pcm) <= 30 && !(d.period > 0 && d.period < 60),
    ];
  }

  hint() {
    const { state: s, ctx: c, spec: sp } = this.engine;
    const d = this.engine.derive();
    if (d.orm < sp.orm.min) return 'tut_rbmk_hint_orm';
    if (s.p_drum < 65 || s.p_drum > 73) return 'tut_rbmk_hint_pressure';
    if (s.L_drum < 0.35 || s.L_drum > 0.65) return 'tut_rbmk_hint_level';
    if (this.index >= 2 && !c.mcp.every(p => p.running && p.speed >= 0.9)) return 'tut_rbmk_hint_pumps';
    if (this.index === 2) {
      if (!c.govCtl.auto || !c.fwCtl.auto) return 'tut_rbmk_hint_steam';
      if (d.rho_pcm > 150 || (s.n > 0.001 && d.period > 0 && d.period < 20)) return 'tut_hint_fast';
      if (s.n >= 0.28) return 'tut_rbmk_hint_capture';
      if (s.rod.some((v, i) => Math.abs(v - s.rodDmd[i]) > 0.01)) return 'tut_hint_travel';
      if (d.rho_pcm < 50) return 'tut_hint_pull';
      if (d.rho_pcm > 100) return 'tut_hint_insert';
      return 'tut_hint_wait';
    }
    if (this.index >= 3) {
      if (!c.powerCtl.auto || !c.govCtl.auto || !c.fwCtl.auto) return 'tut_rbmk_hint_auto';
      return 'tut_hint_settle';
    }
    return this.index === 1 ? 'tut_rbmk_hint_pumps' : 'tut_hint_inspect';
  }

  snapshot() { return { ...super.snapshot(), reactor: 'rbmk' }; }

  view() {
    const view = super.view();
    const { state: s, ctx: c } = this.engine;
    return { ...view, values: { ...view.values, pressure: s.p_drum,
      level: s.L_drum * 100, orm: this.engine.derive().orm,
      pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length } };
  }
}
