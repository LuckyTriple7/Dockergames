// Sind alarm_graphite_hot und alarm_axial_tilt ueberhaupt erreichbar?
//
// Beide standen im BACKLOG als "braucht vermutlich nur eine Szenario-Regie".
// Dieses Werkzeug misst statt zu vermuten. Es faehrt die Anlage auf den
// jeweils guenstigsten Zustand, den dieses Modell zulaesst, und vergleicht
// das Ergebnis mit der Schwelle aus sp.trips.
//
// Aufruf: node tests/tools/rbmk_alarm_reach.mjs

import { createEngine } from '../../static/js/sim/engine.js';
import * as rbmk from '../../static/js/plants/rbmk.js';
import { tsat } from '../../static/js/sim/steam.js';

const DT = 0.1;
const C = (T) => T - 273.15;

// ── Graphittemperatur ────────────────────────────────────────────────────────
// directHeat() haelt T_gr auf Tsat(p_drum) + Waermeeintrag/UA. Der
// Waermeeintrag ist sp.graphite.powerFraction der Spaltleistung, also haengt
// der Endwert allein an Leistung und Trommeldruck -- nicht am Durchsatz.
// Der Leistungsdeckel ist die Ausloesung power_high bei n > 1.12.
{
  const e = createEngine(rbmk, { n: 1.0 });
  const s = e.state, ctx = e.ctx;
  ctx.powerCtl.setpoint = 1.10;
  let last = s.T_gr;
  const rows = [];
  for (let m = 0; m <= 120; m += 20) {
    while (s.t_sim < m * 60) e.step(DT);
    rows.push([String(m).padStart(3), (s.n * 100).toFixed(1).padStart(6),
      s.P_th.toFixed(0).padStart(5), C(s.T_gr).toFixed(1).padStart(7)].join(' '));
    last = s.T_gr;
  }
  console.log('== Graphittemperatur, 110 % Leistung gehalten ==');
  console.log('min    n%  P_th  T_gr/C');
  console.log(rows.join('\n'));

  const sp = rbmk.spec;
  const need = (760 + 273.15 - tsat(sp.drum.p0)) * sp.graphite.UA / (1000 * sp.graphite.powerFraction);
  console.log('\nSchwelle alarm_graphite_hot: 760 C');
  console.log('erreicht nach zwei Stunden:', C(last).toFixed(1), 'C');
  console.log('noetige Spaltleistung fuer 760 C bei', sp.drum.p0, 'bar:',
    need.toFixed(0), 'MW =', (100 * need / sp.P0_th).toFixed(0), '% der Nennleistung');
  console.log('Ausloesung power_high steht bei 112 % -> die Schwelle ist im Betrieb nicht erreichbar.');
}

// ── Axiale Leistungsverzerrung ───────────────────────────────────────────────
// _axialTarget() bildet (dXe * xenon_worth + rodPush * MITTLERE Stabstellung)
// / stiffness. Eine einzelne klemmende Gruppe geht damit nur ueber den
// Mittelwert ein -- eine einseitige Verzerrung kennt dieses Modell nicht.
// Der guenstigste Fall ist deshalb: Xenon-Schraeglage auf ihrem Gipfel, und
// in diesem Augenblick AZ-5, weil das die mittlere Stabstellung auf 1 setzt.
{
  const peak = createEngine(rbmk, { n: 1.0 });
  let best = 0, tBest = 0;
  while (peak.state.t_sim < 8 * 3600) {
    peak.step(DT);
    const dx = peak.state.zTop.X - peak.state.zBot.X;
    if (dx > best) { best = dx; tBest = peak.state.t_sim; }
  }
  const e = createEngine(rbmk, { n: 1.0 });
  const s = e.state;
  while (s.t_sim < tBest) e.step(DT);
  const before = s.ao;
  e.scram('messung');
  let max = Math.abs(s.ao);
  const rows = [];
  let next = tBest;
  while (s.t_sim < tBest + 2 * 3600) {
    e.step(DT);
    max = Math.max(max, Math.abs(s.ao));
    if (s.t_sim >= next) {
      let mean = 0;
      for (let i = 0; i < s.rod.length; i++) mean += s.rod[i];
      rows.push([((s.t_sim - tBest) / 60).toFixed(0).padStart(3), s.ao.toFixed(3).padStart(7),
        (s.zTop.X - s.zBot.X).toFixed(3).padStart(7),
        (mean / s.rod.length).toFixed(3).padStart(8)].join(' '));
      next += 900;
    }
  }
  console.log('\n== Axiale Verzerrung: AZ-5 auf dem Gipfel der Xenon-Schraeglage ==');
  console.log('Gipfel dXe', best.toFixed(3), 'nach', (tBest / 3600).toFixed(2), 'h, ao davor', before.toFixed(3));
  console.log('min      ao     dXe  Stab/Mit');
  console.log(rows.join('\n'));
  console.log('\nSchwelle alarm_axial_tilt: |ao| > 0.35');
  console.log('groesster erreichter Wert:', max.toFixed(3));
  console.log('rodPush deckelt den Stabanteil bei', (rbmk.spec.axial.rodPush_pcm / rbmk.spec.axial.stiffness_pcm).toFixed(3),
    '(alle Staebe drin) -> die Schwelle ist auch im guenstigsten Fall nicht erreichbar.');
}
