// Was macht der SWR, wenn die Umwaelzpumpe ganz ausfaellt?
//
// Im BACKLOG stand der Umwaelzpumpen-Trip als Szenario, das nur noch
// verpackt werden muesse -- das Ereignis rcp_trip faellt bei diesem Typ
// ohnehin auf ctx.recircPump zurueck. Dieses Werkzeug misst, was dabei
// herauskommt, und landet mitten in dem Modellfehler, den BACKLOG.md unter
// "SWR: der Betriebspunkt unter 48 % Umwaelzstrom" beschreibt.
//
// Aufruf: node tests/tools/bwr_recirc_trip.mjs

import { createEngine } from '../../static/js/sim/engine.js';
import { getPlant } from '../../static/js/plants/index.js';
import { getEvent, stepEvents } from '../../static/js/game/events.js';

const DT = 0.05;
const T_EVENT = 300;

function run(label, scramAfter) {
  const e = createEngine(getPlant('bwr'), { seed: 1 });
  const plain = e.step.bind(e);
  e.step = (dt) => { plain(dt); stepEvents(e, dt); };
  const s = e.state;
  let fired = false, scrammed = false, maxN = 0, minCpr = 99;
  const rows = [];
  let next = T_EVENT - 5;
  while (s.t_sim < T_EVENT + 600 && !s.destroyed && !s.fault) {
    if (!fired && s.t_sim >= T_EVENT) { getEvent('rcp_trip').apply(e, {}); fired = true; }
    if (fired && !scrammed && scramAfter !== null && s.t_sim >= T_EVENT + scramAfter) {
      e.scram('messung'); scrammed = true;
    }
    e.step(DT);
    const d = e.derive();
    if (s.t_sim > T_EVENT) { maxN = Math.max(maxN, s.n); minCpr = Math.min(minCpr, d.dnbr); }
    if (s.t_sim >= next) {
      rows.push([(s.t_sim - T_EVENT).toFixed(1).padStart(6), (s.n * 100).toFixed(1).padStart(7),
        s.W_core.toFixed(0).padStart(6), s.x_e.toFixed(3).padStart(6),
        s.alphaBar.toFixed(3).padStart(6), d.dnbr.toFixed(2).padStart(6)].join(' '));
      next += (s.t_sim < T_EVENT + 12 ? 1 : 60);
    }
  }
  console.log('== ' + label + ' ==');
  console.log('  t-t0      n%  W_core    x_e  Blase    CPR');
  console.log(rows.join('\n'));
  console.log('Spitze', (maxN * 100).toFixed(0), '% der Nennleistung, kleinster CPR', minCpr.toFixed(2), '--',
    s.destroyed ? 'Brennstoff zerstoert bei t-t0 = ' + (s.t_sim - T_EVENT).toFixed(1) + ' s'
      : (s.fault || 'kein Verlust'));
  console.log('');
}

console.log('Der Schieber laesst den Spieler nur bis',
  (100 * getPlant('bwr').spec.recirc.min).toFixed(0), '% Umwaelzstrom herunter.');
console.log('Ein Pumpenausfall geht darunter: uebrig bleibt der Naturumlauf.\n');
run('ohne Bedienung', null);
run('RESA 5 s nach dem Ausfall', 5);
run('RESA 30 s nach dem Ausfall', 30);
