// Untersuchung, keine Zusicherung: welche Stabstellung ergibt welche
// Abschaltreserve, und wo liegt sie relativ zur Graphitspitzen-Spanne?
//
// Hintergrund: BACKLOG.md, "ORM-Anzeige passt nicht zur Historie". Waehrend
// 'recover' zeigt die Uebung ~77 Stabaequivalente, in der Endphase 0,0 --
// dokumentiert sind fuer die Nacht des 26. April 6 bis 8.
//
// Aufruf: node tests/tools/chernobyl_orm.mjs

import { createEngine } from '../../static/js/sim/engine.js';
import * as rbmk from '../../static/js/plants/rbmk.js';

const engine = createEngine(rbmk, { seed: 26041986 });
const s = engine.state;
const sp = engine.spec;

const span = sp.tip.span;
console.log(`tip.span    = ${span.toFixed(5)}  (Scheitel der Spitzenkurve bei span/2 = ${(span / 2).toFixed(5)})`);
console.log(`tip.outThreshold = ${sp.tip.outThreshold}`);
console.log(`orm.nominal = ${sp.orm.nominal}, min = ${sp.orm.min}, alarm = ${sp.orm.alarm}`);
console.log('');
console.log('   h      ORM     rho(pcm)   Spitze?');

for (const h of [0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.089,
                 0.10, 0.12, 0.15, 0.1786, 0.22, 0.30, 0.44, 0.60, 1.0]) {
  s.rod[0] = s.rod[1] = s.rodDmd[0] = s.rodDmd[1] = h;
  const d = engine.derive();
  const onRise = h > sp.tip.outThreshold * 0 && h < span / 2 ? 'steigend' : (h < span ? 'fallend' : '-');
  console.log(`${h.toFixed(4)}  ${d.orm.toFixed(2).padStart(7)}  ${d.rho_pcm.toFixed(1).padStart(9)}   ${onRise}`);
}

console.log('');
console.log('Feinsuche: welche Stellung ergibt ORM 6..8?');
for (let h = 0.0; h <= 0.06; h += 0.0025) {
  s.rod[0] = s.rod[1] = s.rodDmd[0] = s.rodDmd[1] = h;
  const d = engine.derive();
  if (d.orm >= 4 && d.orm <= 12) {
    console.log(`  h=${h.toFixed(4)}  ORM=${d.orm.toFixed(2)}  (span/2=${(span / 2).toFixed(4)})`);
  }
}
