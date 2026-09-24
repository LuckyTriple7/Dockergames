// Anlagenfließbild.
//
// Das SVG wird einmal aus einer Beschreibung gebaut. Im Renderlauf werden
// ausschließlich CSS-Custom-Properties auf dem Wurzelknoten gesetzt und ein
// paar data-Attribute an Pumpen und Ventilen -- Farbe nach Temperatur,
// Fließgeschwindigkeit, Drehen der Pumpenräder macht CSS.
//
// Das ist der Grund, warum das Fließbild auf einem schwachen Handy nicht
// bremst: pro Takt sind es rund zehn Schreibvorgänge, nicht hunderte
// DOM-Zugriffe.

import { svg, setAttr, setVar, setText } from './dom.js';
import { t, num } from './i18n.js';

/** Temperatur auf 0..1 abbilden -- daraus mischt CSS die Rohrfarbe. */
const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/** Sichtbarkeitsuntergrenze für die Fluss-Animation in den Rohren. Ihre
 *  Opazität skaliert in CSS direkt mit --rs-w (siehe mimic.css) -- bei
 *  echtem, aber sehr kleinem Durchsatz (Regelventil fast zu) wäre sie sonst
 *  faktisch unsichtbar, und hinter dem Reaktor sähe es aus, als fördere die
 *  Anlage gar nichts mehr. Nur wirklich kein Fluss (Ventil ganz zu) bleibt
 *  unsichtbar. */
const flowVis = (w) => (w > 0.005 ? Math.max(w, 0.22) : 0);

/**
 * Buendelt Bauteil-Grafik und seine Beschriftung/Anzeige zu EINEM Hover-Ziel.
 * Der Name (.rs-label) steht nie im Bild selbst -- er ist reiner Textinhalt,
 * den wireHoverTooltips() abliest und als Tooltip neben dem Mauszeiger zeigt
 * (siehe .rs-label in mimic.css). Messwerte (.rs-read) bleiben immer
 * sichtbar, die Warte braucht sie ohne Maus. Vorher standen beide dauerhaft
 * an einer festen Bildposition und liefen sich bei drei eng gepackten
 * Fließbildern gegenseitig ins Gehege -- ein Tooltip an der Mausposition
 * kann mit nichts mehr kollidieren.
 */
function hoverGroup(nodes) {
  return svg('g', { class: 'rs-hover' }, nodes);
}

// ── Namens-Tooltip ───────────────────────────────────────────────────────
//
// EIN HTML-Element fuer alle drei Fließbilder (lazy gebaut, nie mehr als
// eines gleichzeitig sichtbar) statt SVG-Text an fester Position -- folgt
// dem Mauszeiger in Bildschirm-Pixeln, unabhaengig davon, wie das SVG per
// viewBox skaliert im Container sitzt.
let tipEl = null;
function tipNode() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'rs-mimic-tip';
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}

/** Setzt jedes .rs-hover-Bauteil im uebergebenen SVG als Ausloeser fuer den
 *  Tooltip -- EIN Listener-Paar auf der Wurzel statt eines je Bauteil,
 *  gleiche Schreib-Sparsamkeit wie beim Rest der Datei. */
function wireHoverTooltips(root) {
  root.addEventListener('pointermove', (ev) => {
    const group = ev.target.closest('.rs-hover');
    const label = group && group.querySelector('.rs-label');
    const tip = tipNode();
    if (!label) { tip.hidden = true; return; }
    tip.textContent = label.textContent;
    tip.hidden = false;
    // 14px Versatz nach rechts/unten, damit der Zeiger selbst den Text
    // nicht verdeckt -- an den beiden Raendern, an denen das Fließbild
    // typischerweise klebt (rechter/unterer Fensterrand, siehe z.B. den
    // Generator ganz rechts im Bild), auf die andere Seite des Zeigers
    // klappen, statt ueber den sichtbaren Bereich hinauszuragen.
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = ev.clientX + 14 + w > window.innerWidth ? ev.clientX - 14 - w : ev.clientX + 14;
    const top = ev.clientY + 14 + h > window.innerHeight ? ev.clientY - 14 - h : ev.clientY + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
  });
  root.addEventListener('pointerleave', () => { tipNode().hidden = true; });
}

/** Pumpensymbol: Kreis mit rotierendem Flügel. */
function pump(x, y, id, label) {
  const body = svg('circle', { class: 'rs-comp', cx: x, cy: y, r: 11, 'data-mimic': id });
  const vane = svg('path', {
    class: 'rs-spin',
    d: `M ${x - 7} ${y} L ${x + 7} ${y} M ${x} ${y - 7} L ${x} ${y + 7}`,
    stroke: '#7fa6c4', 'stroke-width': 1.6, fill: 'none',
  });
  return hoverGroup([
    body, vane,
    svg('text', { class: 'rs-label', x, y: y + 22, 'text-anchor': 'middle' }, [label]),
  ]);
}

/** Ventilsymbol: zwei Dreiecke, Zustand über data-state.
 *
 * `pctId` ist optional: nur die Farbe (offen/zu) reichte in der Praxis
 * nicht, um auf einen Blick zu sagen, WIE weit ein Regelventil offen steht --
 * bei kleiner, aber echter Öffnung sieht "offen" fast so aus wie "zu". Mit
 * `pctId` bekommt das Symbol zusätzlich eine Prozentzahl direkt darunter
 * (siehe update() der drei Fließbilder, die sie aus s.gov/s.bypass füllen).
 */
function valve(x, y, id, label, side = 'right', pctId) {
  const labelX = side === 'left' ? x - 14 : x + 14;
  const anchor = side === 'left' ? 'end' : 'start';
  const nodes = [
    svg('path', {
      class: 'rs-comp', 'data-mimic': id,
      d: `M ${x - 9} ${y - 7} L ${x - 9} ${y + 7} L ${x} ${y} Z M ${x + 9} ${y - 7} L ${x + 9} ${y + 7} L ${x} ${y} Z`,
    }),
    // Beschriftung seitlich, nicht darueber: ueber dem Ventil laeuft die
    // Rohrleitung, und Text auf einer Leitung ist auf dem Handy unlesbar.
    svg('text', { class: 'rs-label', x: labelX, y: y + 4, 'text-anchor': anchor }, [label]),
  ];
  if (pctId) nodes.push(readout(labelX, y + 15, pctId, anchor));
  return hoverGroup(nodes);
}

/**
 * Steuerstab: eine Linie, die zwischen Wurzel (fest) und Spitze (Einfahrtiefe)
 * wandert -- ein Kanal stellvertretend für die ganze Gruppe, wie die
 * Rohrleitungen auch nur einen Strang zeichnen. Zwei Linien je Kern (Regel-
 * und Abschaltgruppe) zeigen dabei mehr als eine gemittelte Fläche: bleibt
 * eine stehen, während die andere fährt, sieht man eine klemmende Gruppe
 * (alarm_rod_stuck) im Bild, nicht nur auf der Meldetafel.
 *
 * y1 bleibt auf der Wurzel stehen, y2 setzt update() jeden Takt neu -- fromTop
 * legt fest, ob der Stab von oben (DWR/RBMK) oder von unten (SWR, siehe
 * bwr.js) einfährt.
 */
function rodLine(x, yTop, yBottom, bank, fromTop, bankId) {
  const anchor = fromTop ? yTop : yBottom;
  // Die Richtung steht an der Linie, nicht nur am Tracker: der RBMK hat seit
  // 0.6.11 BEIDES im selben Bild -- die Regel- und Abschaltgruppe faehrt von
  // oben ein, die 24 verkuerzten Staebe fahren von unten ein (rbmk.js
  // rodBanks: usp).
  const line = svg('line', { class: 'rs-rod', x1: x, x2: x, y1: anchor, y2: anchor,
    'data-rod': bank, 'data-rod-dir': fromTop ? 'top' : 'bottom' });
  if (!bankId) return line;
  // Eigene Hover-Gruppe je Linie: ohne sie greift die des Kerns, und die
  // sagt "Kanaele" -- die Linie, die als einzige von unten kommt, blieb
  // damit unerklaert. .rs-label steht nie im Bild (siehe hoverGroup oben),
  // der Tooltip liest nur ihren Text.
  return hoverGroup([line, svg('text', { class: 'rs-label', x, y: anchor },
    [`${t('ctl_rod_bank_' + bankId)} — ${t(fromTop ? 'mimic_rod_top' : 'mimic_rod_bottom')}`])]);
}

/** Sammelt die von rodLine() gebauten Linien und liefert eine update()-
 *  Funktion, die sie nach s.rod[bank] ausrichtet -- dieselbe Rechnung für
 *  alle drei Typen, hier nur einmal. */
function rodTracker(root, yTop, yBottom, fromTop) {
  const lines = [...root.querySelectorAll('.rs-rod')].map((line) => ({
    line, bank: Number(line.dataset.rod), lastFrac: null, moveUntil: 0,
    // Ohne eigene Angabe gilt die Richtung des Trackers -- so bleiben die
    // Bilder gueltig, die nur eine Richtung kennen (DWR, SWR).
    fromTop: line.dataset.rodDir ? line.dataset.rodDir === 'top' : fromTop,
  }));
  return (s, nowMs) => {
    for (const r of lines) {
      const frac = Math.max(0, Math.min(1, (s.rod && s.rod[r.bank]) || 0));
      const tip = r.fromTop ? yTop + frac * (yBottom - yTop) : yBottom - frac * (yBottom - yTop);
      setAttr(r.line, 'y2', tip.toFixed(1));
      // Kurz aufblinken, wenn sich die Stellung gerade ändert -- sonst geht
      // eine Stabbewegung im ohnehin vollen Bild leicht unter. moveUntil haelt
      // das Blinken bei durchgehender Fahrt (Automatik, Xenon-Ausgleich) auch
      // durchgehend an, statt bei jedem Bild einzeln an- und auszugehen.
      if (r.lastFrac !== null && Math.abs(frac - r.lastFrac) > 1e-5) {
        r.moveUntil = nowMs + 400;
      }
      r.lastFrac = frac;
      setAttr(r.line, 'data-moving', nowMs < r.moveUntil ? '1' : '0');
    }
  };
}

function pipe(d, kind, flowId) {
  const nodes = [svg('path', { class: `rs-pipe rs-pipe-${kind}`, d })];
  if (flowId) {
    // Dunkle Kontur UNTER der hellen gestrichelten Linie: ohne sie verschwand
    // der Fluss auf einem ohnehin hellen Dampfrohr (hoher Druck faerbt es fast
    // weiss) praktisch komplett -- Rohr- und Flussfarbe lagen im selben
    // blassen Ton. `--rs-w` steht auf der GRUPPE, nicht auf den einzelnen
    // Strichen: beide erben ihn per CSS-Vererbung, ein Schreibvorgang je Takt
    // reicht weiterhin fuer beide (siehe Dateikopf zur Schreib-Sparsamkeit).
    nodes.push(svg('path', { class: 'rs-flow-halo', d }));
    nodes.push(svg('path', { class: 'rs-flow', d }));
  }
  return svg('g', flowId ? { 'data-flow': flowId } : null, nodes);
}

function readout(x, y, id, anchor = 'start') {
  return svg('text', { class: 'rs-read', x, y, 'text-anchor': anchor, 'data-read': id }, ['—']);
}

/**
 * Fließbild eines Druckwasserreaktors.
 * Ein Strang stellvertretend für vier -- vier gezeichnete Schleifen wären auf
 * einem Handy im Hochformat nicht mehr lesbar, und sie zeigen ohnehin dasselbe.
 */
export function buildPwrMimic(container) {
  const root = svg('svg', {
    viewBox: '0 0 520 268',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': t('panel_mimic'),
  });

  const g = [];

  // Rohrleitungen zuerst, damit die Bauteile darüber liegen.
  // Heißer Strang: Reaktor oben raus zum Dampferzeuger.
  g.push(pipe('M 92 92 L 92 62 L 224 62', 'hot', 'prim'));
  // Kalter Strang: Dampferzeuger unten zurück über die Pumpe in den Reaktor.
  g.push(pipe('M 224 168 L 172 168 L 172 208 L 92 208 L 92 188', 'cold', 'prim'));
  // Druckhalter am heißen Strang.
  g.push(pipe('M 150 62 L 150 40', 'hot', null));
  // Frischdampf zum Regelventil und zur Turbine.
  g.push(pipe('M 246 52 L 330 52 L 330 76', 'steam', 'steam'));
  g.push(pipe('M 330 100 L 330 118 L 372 118', 'steam', 'steam'));
  // Umleitstation zum Kondensator.
  g.push(pipe('M 300 52 L 300 214 L 372 214', 'steam', 'bypass'));
  // Abdampf zur Kondensation.
  g.push(pipe('M 432 140 L 452 140 L 452 196 L 432 196', 'steam', 'steam'));
  // Speisewasser zurück zum Dampferzeuger.
  g.push(pipe('M 372 232 L 268 232 L 268 168', 'feed', 'feed'));

  // Reaktordruckbehälter -- Gehäuse, Kern, Stäbe, Name/Leistung UND die
  // Strangtemperaturen (thot/tcold) in EINEM Hover-Ziel: das sind die
  // Messwerte DIESES Bauteils, nicht der duennen Rohrleitung, auf der sie
  // vorher lose herumstanden.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'core', x: 64, y: 92, width: 56, height: 96, rx: 22 }),
    svg('rect', { class: 'rs-core', x: 76, y: 112, width: 32, height: 56, rx: 4 }),
    // Steuerstäbe: Regel- und Abschaltgruppe (rodBanks[0]/[1] in pwr.js),
    // fahren von oben ein.
    rodLine(86, 112, 168, 0, true, 'ctrl'),
    rodLine(98, 112, 168, 1, true, 'sd'),
    svg('text', { class: 'rs-label', x: 92, y: 252, 'text-anchor': 'middle' }, [t('mimic_core')]),
    readout(92, 106, 'power', 'middle'),
    readout(100, 54, 'thot'),
    readout(100, 202, 'tcold'),
  ]));

  // Druckhalter.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'pzr', x: 136, y: 8, width: 28, height: 34, rx: 12 }),
    svg('rect', { class: 'rs-pzr-level', x: 138, y: 10, width: 24, height: 30, rx: 10 }),
    svg('text', { class: 'rs-label', x: 180, y: 14, 'text-anchor': 'start' }, [t('mimic_pzr')]),
    readout(170, 26, 'pzr'),
  ]));

  // Hauptkühlmittelpumpe.
  g.push(pump(172, 208, 'rcp', t('mimic_rcp')));

  // Dampferzeuger: Gehäuse, Trennlinie, Rohrbündel (Primärseite) und
  // Füllstand (Sekundärseite) -- alles EIN Hover-Ziel, auch wenn nur der
  // Name und der Sekundärdruck eine Zahl zeigen.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'sg', x: 218, y: 46, width: 56, height: 130, rx: 22 }),
    // Trennlinie bei x=240: links davon liegen die Anschluesse des
    // Primaerstrangs (heiss bei x=224/y=62, kalt bei x=224/y=168, siehe
    // oben), rechts davon die des Sekundaerkreises (Frischdampf bei x=246,
    // Speisewasser bei x=268) -- Fuellstand und Rohrbuendel bleiben dadurch
    // strikt auf ihrer Seite, niemand kann das Bild so lesen, als
    // mischten sich beide Wasser.
    svg('line', { class: 'rs-sg-divider', x1: 240, y1: 50, x2: 240, y2: 172 }),
    // Füllstandsbalken im Dampferzeuger -- NUR die Sekundaerseite rechts
    // der Trennlinie, siehe oben.
    svg('rect', { class: 'rs-sg-level', x: 244, y: 60, width: 26, height: 112, rx: 10 }),
    // Rohrbuendel: das Primaerwasser laeuft durch diese Rohre und wird vom
    // Sekundaerwasser nur von AUSSEN umspuelt, nie vermischt -- derselbe
    // Punkt, den die Ruecksprache zum Fließbild ausdruecklich vermisst
    // hat. Eigene data-Kennung braucht es nicht: --rs-t-hot/--rs-t-cold
    // sitzen schon auf der Wurzel (siehe update()) und faerben es wie die
    // Straenge selbst automatisch mit; 'prim' als Fluss-Kennung laesst
    // zusaetzlich denselben Fluss-Strich durchlaufen wie auf dem
    // Heiss-/Kaltstrang.
    pipe('M 228 58 L 228 150', 'hot', 'prim'),
    pipe('M 228 150 L 236 150', 'cold', null),
    pipe('M 236 150 L 236 58', 'cold', 'prim'),
    // Beschriftung tief unter dem Behaelter: das Speisewasserrohr faellt
    // bei x=268 -- innerhalb der Behälterbreite -- senkrecht bis y=232
    // zum Speisewasserkopf durch, jede Position naeher am Behaelter liegt
    // auf dieser Leitung.
    svg('text', { class: 'rs-label', x: 246, y: 246, 'text-anchor': 'middle' }, [t('mimic_sg')]),
    readout(246, 120, 'sg', 'middle'),
  ]));

  // Regelventil und Umleitstation. Beschriftung des Regelventils rechts (zur
  // Turbine hin): links davon laeuft die Umleitung auf einer eigenen,
  // parallelen Steigleitung -- genau da, wo die Beschriftung sonst hinreicht.
  g.push(valve(330, 88, 'gov', t('mimic_gov'), 'right', 'gov'));
  g.push(valve(300, 140, 'bypass', t('mimic_bypass'), 'right', 'bypass'));

  // Turbine -- rein dekorativ, keine eigene Beschriftung/Anzeige.
  g.push(svg('path', { class: 'rs-vessel', d: 'M 372 100 L 432 84 L 432 156 L 372 136 Z' }));

  // Generator.
  g.push(hoverGroup([
    svg('circle', { class: 'rs-comp', cx: 452, cy: 118, r: 14, 'data-mimic': 'gen' }),
    // Beschriftung seitlich am Generator, nicht darüber/darunter: dort
    // liegen Turbinenkontur (bis x=432) und das Abdampfrohr (senkrecht bei
    // x=452). Rechtsbündig und mit Rand vor dem viewBox-Rand bei 520:
    // "Generator" reicht linksbündig ab x=470 sonst über den Rand hinaus --
    // unsichtbar, solange der Container breiter als das Seitenverhältnis
    // war und die SVG links/rechts Rand ließ, sichtbar abgeschnitten,
    // sobald sie exakt in der Breite sitzt.
    svg('text', { class: 'rs-label', x: 516, y: 96, 'text-anchor': 'end' }, [t('mimic_gen')]),
    readout(516, 142, 'gen', 'end'),
  ]));

  // Kondensator.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', x: 372, y: 196, width: 60, height: 36, rx: 8 }),
    svg('text', { class: 'rs-label', x: 402, y: 248, 'text-anchor': 'middle' }, [t('mimic_cond')]),
    readout(402, 218, 'cond', 'middle'),
  ]));

  // Speisewasserpumpe: sitzt an der Ecke der Speisewasserleitung, wo sie vom
  // Kondensator kommend nach oben zum Dampferzeuger abbiegt (wie die
  // Hauptkühlmittelpumpe an ihrer Ecke) -- ohne sie floss das Speisewasser im
  // Bild scheinbar von allein bergauf, das hat die Rückmeldung zum Fließbild
  // zu Recht bemängelt.
  g.push(pump(268, 232, 'fw', t('mimic_fw')));

  for (const node of g) root.append(node);
  container.replaceChildren(root);
  wireHoverTooltips(root);

  const reads = new Map();
  for (const node of root.querySelectorAll('[data-read]')) reads.set(node.dataset.read, node);
  const comps = new Map();
  for (const node of root.querySelectorAll('[data-mimic]')) comps.set(node.dataset.mimic, node);
  const flows = new Map();
  for (const node of root.querySelectorAll('[data-flow]')) {
    const id = node.dataset.flow;
    const list = flows.get(id);
    if (list) list.push(node); else flows.set(id, [node]);
  }
  const sgLevel = root.querySelector('.rs-sg-level');
  const pzrLevel = root.querySelector('.rs-pzr-level');
  const trackRods = rodTracker(root, 112, 168, true);

  return {
    root,
    update(s, d, sp, alarms, nowMs) {
      // Farben: kalt 250 °C, heiß 340 °C.
      setVar(root, '--rs-t-hot', norm(s.T_co - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-t-cold', norm(s.T_ci - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-n', Math.max(0, Math.min(1, s.n)).toFixed(3));
      // Kernzerstoerung sah man im Fließbild bisher gar nicht -- die Anzeige
      // "Anlage verloren" lief nur ueber das Auswertungsfenster (main.js
      // showDestroyed()), das Bild selbst zeigte weiter normale Werte.
      // data-destroyed auf der Wurzel faerbt .rs-core per CSS dauerhaft um
      // (mimic.css), unabhaengig davon, ob dieses Fenster gerade offen ist.
      setAttr(root, 'data-destroyed', s.destroyed ? '1' : '0');
      setVar(root, '--rs-steam-l', norm(s.p_sg, 20, 80).toFixed(3));
      trackRods(s, nowMs);
      // Welches Bauteil eine anstehende Meldung betrifft, steht in der
      // Meldetafel schon -- hier nur noch dasselbe am Bild zeigen, damit man
      // es nicht erst im Alarme-Reiter suchen muss.
      if (alarms) for (const [key, node] of comps) setAttr(node, 'data-alarm', alarms.get(key) || 0);

      const fPrim = Math.max(0, Math.min(1.1, s.W_core / sp.coolant.W0));
      for (const n of flows.get('prim') || []) setVar(n, '--rs-w', flowVis(fPrim).toFixed(3));
      const fSteam = Math.max(0, Math.min(1.2, s.W_steam / sp.sg.W_steam0));
      for (const n of flows.get('steam') || []) setVar(n, '--rs-w', flowVis(fSteam).toFixed(3));
      const fFeed = Math.max(0, Math.min(1.2, s.W_fw / sp.sg.W_steam0));
      for (const n of flows.get('feed') || []) setVar(n, '--rs-w', flowVis(fFeed).toFixed(3));
      for (const n of flows.get('bypass') || []) setVar(n, '--rs-w', flowVis(s.bypass || 0).toFixed(3));

      const rcp = comps.get('rcp');
      if (rcp) {
        const anyTripped = (d.pumpStates || []).some((x) => x === 'tripped');
        setAttr(rcp, 'data-state', fPrim > 0.2 ? 'run' : (anyTripped ? 'tripped' : 'stopped'));
        setVar(rcp.parentNode, '--rs-w', fPrim.toFixed(3));
      }
      const fw = comps.get('fw');
      if (fw) {
        setAttr(fw, 'data-state', fFeed > 0.05 ? 'run' : 'stopped');
        setVar(fw.parentNode, '--rs-w', fFeed.toFixed(3));
      }
      setAttr(comps.get('gov'), 'data-state', s.gov > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('bypass'), 'data-state', s.bypass > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('gen'), 'data-state',
        s.turbineTripped ? 'tripped' : (s.breaker ? 'run' : 'stopped'));

      // Füllstände als Höhe des gefüllten Teils.
      if (sgLevel) {
        const h = Math.max(2, 112 * Math.max(0, Math.min(1, s.L_sg)));
        setAttr(sgLevel, 'y', String(60 + 112 - h));
        setAttr(sgLevel, 'height', String(h));
      }
      if (pzrLevel) {
        const h = Math.max(2, 30 * Math.max(0, Math.min(1, s.pzr_L)));
        setAttr(pzrLevel, 'y', String(10 + 30 - h));
        setAttr(pzrLevel, 'height', String(h));
      }

      setText(reads.get('power'), num(d.power_th_pct, 0) + ' %');
      setText(reads.get('thot'), num(s.T_co - 273.15, 1) + ' °C');
      setText(reads.get('tcold'), num(s.T_ci - 273.15, 1) + ' °C');
      setText(reads.get('pzr'), num(s.pzr_p, 1) + ' bar');
      setText(reads.get('sg'), num(s.p_sg, 1) + ' bar');
      setText(reads.get('gov'), num(s.gov * 100, 0) + ' %');
      setText(reads.get('bypass'), num((s.bypass || 0) * 100, 0) + ' %');
      setText(reads.get('gen'), num(s.P_e, 0) + ' MW');
      setText(reads.get('cond'), num(s.p_cond, 3) + ' bar');
    },
  };
}


/**
 * Fließbild eines Siedewasserreaktors.
 *
 * Ein Kreislauf statt zwei: der Dampf entsteht im Druckbehälter, wird oben
 * abgeschieden und geht direkt zur Turbine. Deshalb fehlt der Dampferzeuger,
 * und deshalb steht die Umwälzpumpe INNEN, im Ringraum zwischen Kernmantel
 * und Behälterwand -- sie treibt nicht den Weg zur Turbine an, sondern den
 * Weg durch den Kern.
 */
export function buildBwrMimic(container) {
  const root = svg('svg', {
    // 40px mehr Luft nach oben fuers Sicherheitsventil (siehe unten) -- sonst
    // sass sein Label direkt auf dem des Notkondensators, beide quetschten
    // sich in denselben schmalen Streifen ueber dem Frischdampf.
    viewBox: '0 -40 520 308',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': t('panel_mimic'),
  });
  const g = [];

  // Frischdampf vom Behälterkopf zum Regelventil und zur Turbine.
  g.push(pipe('M 150 46 L 330 46 L 330 76', 'steam', 'steam'));
  g.push(pipe('M 330 100 L 330 118 L 372 118', 'steam', 'steam'));
  // Umleitung direkt in den Kondensator.
  g.push(pipe('M 296 46 L 296 214 L 372 214', 'steam', 'bypass'));
  // Abdampf.
  g.push(pipe('M 432 140 L 452 140 L 452 196 L 432 196', 'steam', 'steam'));

  // Sicherheitsventil: zweigt vom Frischdampf ab und blaest nach oben ins
  // Freie (kein Torus im Bild) -- rein automatisch, kein Bedienelement, nur
  // sichtbar wenn es gerade wirklich blaest (siehe update()).
  g.push(pipe('M 280 46 L 280 -12', 'steam', 'srv'));
  g.push(valve(280, -24, 'srv', t('mimic_srv')));
  // Speisewasser zurück in den Behälter.
  g.push(pipe('M 372 232 L 212 232 L 212 150 L 180 150', 'feed', 'feed'));
  // Umwälzschleife außen am Behälter entlang.
  g.push(pipe('M 118 150 L 74 150 L 74 206 L 150 206', 'cold', 'prim'));

  // Notkondensator: eigene Naturumlaufschleife oben am Behälterkopf, unabhängig
  // vom Frischdampf zur Turbine. Zweigt von derselben Dampfleitung ab wie die
  // Umleitung (Punkt auf der durchgehenden Linie, kein eigener Anschluss),
  // Kondensat läuft eine Etage tiefer per Schwerkraft in den Behälter zurück.
  // Ventil sitzt bewusst hoch (Kästchen ganz oben im negativen Raum) -- so
  // bleiben zwischen ihm und dem Frischdampf unten 17px Luft statt der alten
  // 6px, in die weder Ventilbeschriftung noch "bar"-Anzeige mehr passten.
  g.push(pipe('M 220 8 L 220 15', 'steam', 'ic'));
  g.push(pipe('M 220 29 L 220 46', 'steam', 'ic'));
  // Kondensatrücklauf zapft rechts am Kästchen ab, nicht mittig -- eine
  // mittige Leitung liefe direkt durch die (jetzt links stehende)
  // Ventilbeschriftung.
  g.push(pipe('M 245 8 L 245 40 L 130 40', 'feed', 'ic'));

  // Druckbehälter mit Abscheider oben und Kern unten. Ein Bauteil im Bild,
  // deshalb auch eine gemeinsame Kennung -- der Siedewasserreaktor zeichnet
  // Kern, Fallraum und Dampfraum nicht getrennt wie der Druckwasserreaktor.
  // Alles inklusive Abscheider (sep) und Domdruck (dome) EIN Hover-Ziel:
  // beides gehoert sichtbar zu diesem einen Bauteil.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'rpv', x: 106, y: 40, width: 76, height: 180, rx: 34 }),
    svg('rect', { class: 'rs-sg-level', x: 110, y: 96, width: 68, height: 120, rx: 30 }),
    svg('rect', { class: 'rs-core', x: 124, y: 150, width: 40, height: 56, rx: 4 }),
    // Steuerstäbe fahren beim SWR von UNTEN ein (siehe Dateikopf bwr.js) --
    // fromTop=false, die Wurzel sitzt unten am Kernboden.
    rodLine(136, 150, 206, 0, false, 'ctrl'),
    rodLine(152, 150, 206, 1, false, 'sd'),
    svg('path', { class: 'rs-comp', 'data-mimic': 'sep', d: 'M 122 64 L 166 64 L 158 86 L 130 86 Z' }),
    svg('text', { class: 'rs-label', x: 144, y: 236, 'text-anchor': 'middle' }, [t('mimic_rpv')]),
    readout(144, 140, 'power', 'middle'),
    readout(190, 66, 'dome'),
  ]));

  // Notkondensator-Wärmetauscher: statisches Kästchen, Füllstand direkt
  // darüber -- eigenes kleines Hover-Ziel, getrennt vom Isolierventil
  // davor (das traegt den Namen "Notkondensator" schon selbst, siehe
  // valve() unten). Sitzt im negativen Raum oben (siehe viewBox) -- dort
  // ist Platz, seit das Ventil hochgerutscht ist.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', x: 188, y: -10, width: 64, height: 18, rx: 3 }),
    // Fuellstand ueber dem Kaestchen statt daneben: daneben laeuft das
    // Sicherheitsventil-Steigrohr (x=280) mitten durch die Zahl.
    readout(220, -16, 'icwater', 'middle'),
  ]));
  // Beschriftung links vom Ventil: rechts davon laeuft bis zur Turbine
  // dieselbe Steigleitung, durch die sonst "Notkondensator" liefe.
  g.push(valve(220, 22, 'ic', t('mimic_ic'), 'left'));

  // Umwälzpumpe in der äußeren Schleife. Sitzt an der unteren Ecke der
  // Schleife (wie bei PWR/RBMK), nicht mehr mittig auf der geraden Leitung --
  // sonst lief die Beschriftung darunter auf demselben Rohr weiter.
  g.push(pump(74, 206, 'rcp', t('mimic_recirc')));

  // Regelventil und Umleitung.
  g.push(valve(330, 88, 'gov', t('mimic_gov'), 'right', 'gov'));
  g.push(valve(296, 140, 'bypass', t('mimic_bypass'), 'right', 'bypass'));

  // Turbine -- rein dekorativ, keine eigene Beschriftung/Anzeige.
  g.push(svg('path', { class: 'rs-vessel', d: 'M 372 100 L 432 84 L 432 156 L 372 136 Z' }));

  // Generator.
  g.push(hoverGroup([
    svg('circle', { class: 'rs-comp', cx: 452, cy: 118, r: 14, 'data-mimic': 'gen' }),
    // Beschriftung seitlich am Generator, nicht darüber/darunter: dort
    // liegen Turbinenkontur (bis x=432) und das Abdampfrohr (senkrecht bei
    // x=452). Rechtsbündig und mit Rand vor dem viewBox-Rand bei 520:
    // "Generator" reicht linksbündig ab x=470 sonst über den Rand hinaus --
    // unsichtbar, solange der Container breiter als das Seitenverhältnis
    // war und die SVG links/rechts Rand ließ, sichtbar abgeschnitten,
    // sobald sie exakt in der Breite sitzt.
    svg('text', { class: 'rs-label', x: 516, y: 96, 'text-anchor': 'end' }, [t('mimic_gen')]),
    readout(516, 142, 'gen', 'end'),
  ]));

  // Kondensator.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', x: 372, y: 196, width: 60, height: 36, rx: 8 }),
    svg('text', { class: 'rs-label', x: 402, y: 248, 'text-anchor': 'middle' }, [t('mimic_cond')]),
    readout(402, 218, 'cond', 'middle'),
  ]));

  // Speisewasserpumpe: sitzt an der Ecke der Speisewasserleitung, wo sie vom
  // Kondensator kommend nach oben zum Behaelter abbiegt -- wie beim DWR
  // (siehe buildPwrMimic()), aus demselben Grund: ohne sie floss das
  // Speisewasser im Bild scheinbar von allein zurueck.
  g.push(pump(212, 232, 'fw', t('mimic_fw')));

  for (const node of g) root.append(node);
  container.replaceChildren(root);
  wireHoverTooltips(root);

  const reads = new Map();
  for (const n of root.querySelectorAll('[data-read]')) reads.set(n.dataset.read, n);
  const comps = new Map();
  for (const n of root.querySelectorAll('[data-mimic]')) comps.set(n.dataset.mimic, n);
  const flows = new Map();
  for (const n of root.querySelectorAll('[data-flow]')) {
    const id = n.dataset.flow;
    const list = flows.get(id);
    if (list) list.push(n); else flows.set(id, [n]);
  }
  const level = root.querySelector('.rs-sg-level');
  const trackRods = rodTracker(root, 150, 206, false);

  return {
    root,
    update(s, d, sp, alarms, nowMs) {
      setVar(root, '--rs-t-hot', norm(s.T_co - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-t-cold', norm(s.T_ci - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-n', Math.max(0, Math.min(1, s.n)).toFixed(3));
      setAttr(root, 'data-destroyed', s.destroyed ? '1' : '0');
      setVar(root, '--rs-steam-l', norm(s.p_dome, 20, 85).toFixed(3));
      trackRods(s, nowMs);
      if (alarms) for (const [key, node] of comps) setAttr(node, 'data-alarm', alarms.get(key) || 0);

      const fRec = Math.max(0, Math.min(1.2, s.W_core / sp.recirc.W0));
      for (const n of flows.get('prim') || []) setVar(n, '--rs-w', flowVis(fRec).toFixed(3));
      const fSteam = Math.max(0, Math.min(1.2, s.W_steam / sp.vessel.W_steam0));
      for (const n of flows.get('steam') || []) setVar(n, '--rs-w', flowVis(fSteam).toFixed(3));
      const fFeed = Math.max(0, Math.min(1.2, s.W_fw / sp.vessel.W_steam0));
      for (const n of flows.get('feed') || []) setVar(n, '--rs-w', flowVis(fFeed).toFixed(3));
      for (const n of flows.get('bypass') || []) setVar(n, '--rs-w', flowVis(s.bypass || 0).toFixed(3));
      for (const n of flows.get('ic') || []) setVar(n, '--rs-w', s.icOpen ? '1.000' : '0.000');
      for (const n of flows.get('srv') || []) setVar(n, '--rs-w', flowVis(s.srv || 0).toFixed(3));

      const rcp = comps.get('rcp');
      if (rcp) {
        setAttr(rcp, 'data-state', (d.pumpStates && d.pumpStates[0]) || 'stopped');
        setVar(rcp.parentNode, '--rs-w', fRec.toFixed(3));
      }
      const fw = comps.get('fw');
      if (fw) {
        // Ohne Wechselstrom stehen die Speisewasserpumpen still, egal wie
        // weit der Regler aufreissen wuerde (siehe s.acPower in bwr.js) --
        // "tripped" zeigt das, statt es wie ein einfach zugedrehtes Ventil
        // aussehen zu lassen.
        setAttr(fw, 'data-state', !s.acPower ? 'tripped' : (fFeed > 0.05 ? 'run' : 'stopped'));
        setVar(fw.parentNode, '--rs-w', fFeed.toFixed(3));
      }
      setAttr(comps.get('gov'), 'data-state', s.gov > 0.02 && s.msiv > 0.5 ? 'run' : 'stopped');
      setAttr(comps.get('bypass'), 'data-state', s.bypass > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('srv'), 'data-state', s.srv > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('sep'), 'data-state', s.x_e > 0.01 ? 'run' : 'stopped');
      setAttr(comps.get('ic'), 'data-state', s.icOpen ? 'run' : 'stopped');
      setAttr(comps.get('gen'), 'data-state',
        s.turbineTripped ? 'tripped' : (s.breaker ? 'run' : 'stopped'));

      if (level) {
        // d.L_sg statt s.L_rpv: friert wie die Warten-Anzeige ein, sobald der
        // Gleichstrom fehlt (siehe derived() in bwr.js) -- das Bild soll
        // genau das zeigen, was die Warte glaubt, nicht die Physik dahinter.
        const h = Math.max(2, 120 * Math.max(0, Math.min(1, d.L_sg)));
        setAttr(level, 'y', String(96 + 120 - h));
        setAttr(level, 'height', String(h));
      }

      setText(reads.get('power'), num(d.power_th_pct, 0) + ' %');
      setText(reads.get('dome'), num(s.p_dome, 1) + ' bar');
      setText(reads.get('gov'), num(s.gov * 100, 0) + ' %');
      setText(reads.get('bypass'), num((s.bypass || 0) * 100, 0) + ' %');
      setText(reads.get('gen'), num(s.P_e, 0) + ' MW');
      setText(reads.get('cond'), num(s.p_cond, 3) + ' bar');
      setText(reads.get('icwater'), num(s.icWater * 100, 0) + ' %');
    },
  };
}


/**
 * Fließbild eines RBMK.
 *
 * Kein Druckbehälter: 1661 einzelne Druckröhren stecken in einem Graphitblock,
 * das Dampf-Wasser-Gemisch geht in die Trommelabscheider, der Dampf von dort zu
 * den Turbinen, das Wasser über die Hauptumwälzpumpen zurück in die Röhren.
 * Gezeichnet ist eine Hälfte -- die zweite ist spiegelbildlich und zeigt
 * dasselbe.
 */
export function buildRbmkMimic(container) {
  const root = svg('svg', {
    viewBox: '0 0 520 268',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': t('panel_mimic'),
  });
  const g = [];

  // Steigleitungen vom Kern in die Trommel, Fallleitungen zurück.
  g.push(pipe('M 118 78 L 118 52 L 196 52', 'hot', 'prim'));
  g.push(pipe('M 190 102 L 182 102 L 182 214 L 118 214', 'cold', 'prim'));
  // Frischdampf aus der Trommel.
  g.push(pipe('M 236 48 L 330 48 L 330 76', 'steam', 'steam'));
  g.push(pipe('M 330 100 L 330 118 L 372 118', 'steam', 'steam'));
  g.push(pipe('M 298 48 L 298 214 L 372 214', 'steam', 'bypass'));
  g.push(pipe('M 432 140 L 452 140 L 452 196 L 432 196', 'steam', 'steam'));
  // Speisewasser in die Trommel.
  g.push(pipe('M 372 232 L 216 232 L 216 104', 'feed', 'feed'));

  // Graphitblock mit Druckröhren -- inklusive Abschaltreserve (ORM), auch
  // wenn die Beschriftung selbst schon "ORM …" traegt (siehe Kommentar
  // unten): sie gehoert inhaltlich zu diesem Bauteil, nicht zu irgendeinem
  // anderen Hover-Ziel in der Naehe.
  const coreNodes = [
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'core', x: 72, y: 78, width: 92, height: 136, rx: 6 }),
    svg('rect', { class: 'rs-core', x: 80, y: 92, width: 76, height: 108, rx: 3 }),
  ];
  for (let i = 0; i < 7; i++) {
    const x = 86 + i * 11;
    coreNodes.push(svg('line', { class: 'rs-tube', x1: x, y1: 92, x2: x, y2: 200 }));
  }
  // Steuerstäbe: Regel- und Abschaltgruppe (rodBanksMoveTogether -- fahren im
  // Normalbetrieb zusammen, siehe rbmk.js -- aber eine klemmende Gruppe
  // (alarm_rod_stuck) bleibt hier trotzdem einzeln sichtbar). Fahren von
  // oben ein, in zwei der sieben Kanäle oben gezeichnet.
  coreNodes.push(rodLine(97, 92, 200, 0, true, 'ctrl'));
  coreNodes.push(rodLine(141, 92, 200, 1, true, 'sd'));
  // Die dritte Gruppe seit 0.6.11: 24 verkürzte Absorberstäbe, die von UNTEN
  // einfahren (rbmk.js rodBanks: usp). Dass sie von der anderen Seite kommen,
  // ist kein Detail -- ihnen fehlt die Graphitspitze, die den anderen
  // Gruppen beim Einfahren zuerst Reaktivität hinzufügt. Deshalb stehen sie
  // hier auch sichtbar andersherum.
  coreNodes.push(rodLine(119, 92, 200, 2, false, 'usp'));
  coreNodes.push(svg('text', { class: 'rs-label', x: 72, y: 230, 'text-anchor': 'start' }, [t('mimic_channels')]));
  // y=94 statt 86: die Steigleitung faellt bei x=118 -- derselben Mitte --
  // bis y=78 herunter, 86 sass ihr noch im Weg. Tiefer stehen ein paar
  // Kanalstriche im Weg statt der Leitung, das stoert beim Lesen nicht.
  coreNodes.push(readout(118, 94, 'power', 'middle'));
  // Die Abschaltreserve ist bei diesem Typ die eigentliche Sicherheitsgröße
  // (siehe ORM im Grundlagen-Glossar), nicht die traege Graphittemperatur --
  // die stand hier frueher als blosse Zahl und ist bei 35 Minuten
  // Zeitkonstante ueber eine ganze Schicht praktisch unbewegt. Der Text ist
  // bewusst selbst beschriftet ("ORM …"), nicht nur eine nackte Zahl.
  coreNodes.push(readout(60, 246, 'orm'));
  // Der obere biologische Schild -- rund 2000 t auf 17 m. Er steht hier nicht
  // als Schmuck: aus seinem Gewicht und seiner Flaeche rechnet der Nachlauf
  // den Ueberdruck aus, ab dem er abhebt (rbmk.js: sp.aftermath, engine.js:
  // startAftermath). Ein Bauteil, das im Bild fehlt, kann am Ende auch nicht
  // abheben.
  g.push(hoverGroup(coreNodes));
  // Eigene Hover-Gruppe, nicht in die des Kerns: der Tooltip nimmt das ERSTE
  // .rs-label seiner Gruppe (siehe wireHoverTooltips) -- im Kern waere das
  // "Reaktorkern", und der Schild haette nie einen Namen.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-lid', 'data-mimic': 'lid', x: 68, y: 68, width: 100, height: 9, rx: 2 }),
    svg('text', { class: 'rs-label', x: 168, y: 62, 'text-anchor': 'end' }, [t('mimic_lid')]),
  ]));

  // Was nach dem Abheben zu sehen ist: offener Schacht, Dampf- und
  // Truemmerfahne. Liegt immer im Bild und ist per CSS unsichtbar, solange
  // die Wurzel nicht data-aftermath="lid" traegt (siehe update() unten) --
  // so muss im Ereignisfall nichts nachgebaut werden, es wird nur sichtbar.
  const plume = [
    svg('path', { class: 'rs-plume rs-plume-a', d: 'M 96 70 L 88 18 L 106 42 L 112 6 L 124 44 L 140 16 L 136 70 Z' }),
    svg('path', { class: 'rs-plume rs-plume-b', d: 'M 104 70 L 100 34 L 118 52 L 122 24 L 130 70 Z' }),
    svg('path', { class: 'rs-breach', d: 'M 80 92 L 92 84 L 104 92 L 118 82 L 132 92 L 144 85 L 156 92 Z' }),
  ];
  for (const node of plume) g.push(node);

  // Trommelabscheider.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', 'data-mimic': 'drum', x: 186, y: 30, width: 60, height: 76, rx: 28 }),
    svg('rect', { class: 'rs-sg-level', x: 190, y: 62, width: 52, height: 40, rx: 20 }),
    svg('text', { class: 'rs-label', x: 252, y: 36, 'text-anchor': 'start' }, [t('mimic_drum')]),
    readout(216, 74, 'drum', 'middle'),
  ]));

  // Hauptumwälzpumpen. Sitzt an der unteren Ecke der Schleife (wie bei
  // PWR/BWR), nicht mehr mittig auf der geraden Leitung -- sonst lief die
  // Beschriftung darunter auf demselben Rohr weiter.
  g.push(pump(182, 214, 'rcp', t('mimic_recirc')));

  // Regelventil und Umleitung.
  g.push(valve(330, 88, 'gov', t('mimic_gov'), 'right', 'gov'));
  g.push(valve(298, 140, 'bypass', t('mimic_bypass'), 'right', 'bypass'));

  // Turbine -- rein dekorativ, keine eigene Beschriftung/Anzeige.
  g.push(svg('path', { class: 'rs-vessel', d: 'M 372 100 L 432 84 L 432 156 L 372 136 Z' }));

  // Generator.
  g.push(hoverGroup([
    svg('circle', { class: 'rs-comp', cx: 452, cy: 118, r: 14, 'data-mimic': 'gen' }),
    // Beschriftung seitlich am Generator, nicht darüber/darunter: dort
    // liegen Turbinenkontur (bis x=432) und das Abdampfrohr (senkrecht bei
    // x=452). Rechtsbündig und mit Rand vor dem viewBox-Rand bei 520:
    // "Generator" reicht linksbündig ab x=470 sonst über den Rand hinaus --
    // unsichtbar, solange der Container breiter als das Seitenverhältnis
    // war und die SVG links/rechts Rand ließ, sichtbar abgeschnitten,
    // sobald sie exakt in der Breite sitzt.
    svg('text', { class: 'rs-label', x: 516, y: 96, 'text-anchor': 'end' }, [t('mimic_gen')]),
    readout(516, 142, 'gen', 'end'),
  ]));

  // Kondensator.
  g.push(hoverGroup([
    svg('rect', { class: 'rs-vessel', x: 372, y: 196, width: 60, height: 36, rx: 8 }),
    svg('text', { class: 'rs-label', x: 402, y: 248, 'text-anchor': 'middle' }, [t('mimic_cond')]),
    readout(402, 218, 'cond', 'middle'),
  ]));

  // Speisewasserpumpe: sitzt an der Ecke der Speisewasserleitung, wo sie vom
  // Kondensator kommend nach oben zur Trommel abbiegt -- wie bei DWR/SWR
  // (siehe buildPwrMimic()/buildBwrMimic()), aus demselben Grund: ohne sie
  // floss das Speisewasser im Bild scheinbar von allein zurueck.
  g.push(pump(216, 232, 'fw', t('mimic_fw')));

  for (const node of g) root.append(node);
  container.replaceChildren(root);
  wireHoverTooltips(root);

  const reads = new Map();
  for (const n of root.querySelectorAll('[data-read]')) reads.set(n.dataset.read, n);
  const comps = new Map();
  for (const n of root.querySelectorAll('[data-mimic]')) comps.set(n.dataset.mimic, n);
  const flows = new Map();
  for (const n of root.querySelectorAll('[data-flow]')) {
    const id = n.dataset.flow;
    const list = flows.get(id);
    if (list) list.push(n); else flows.set(id, [n]);
  }
  const level = root.querySelector('.rs-sg-level');
  const trackRods = rodTracker(root, 92, 200, true);

  return {
    root,
    update(s, d, sp, alarms, nowMs) {
      setVar(root, '--rs-t-hot', norm(s.T_co - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-t-cold', norm(s.T_ci - 273.15, 250, 340).toFixed(3));
      setVar(root, '--rs-n', Math.max(0, Math.min(1, s.n)).toFixed(3));
      setAttr(root, 'data-destroyed', s.destroyed ? '1' : '0');
      // Der Nachlauf (engine.js: startAftermath): erst wenn er durch ist UND
      // der Deckel wirklich abgehoben hat, oeffnet sich das Bild. Vorher
      // bleibt es bei der verkohlten Zone -- zwei Sekunden lang ist die
      // Anlage zerstoert, aber noch zu.
      setAttr(root, 'data-aftermath', s.aftermath?.done && s.aftermath.lid ? 'lid' : '');
      setVar(root, '--rs-steam-l', norm(s.p_drum, 20, 85).toFixed(3));
      // Der Graphitblock glüht eigenständig -- er hängt an seiner eigenen,
      // sehr langen Zeitkonstante und nicht an der Leistung von eben.
      setVar(root, '--rs-gr', norm(s.T_gr - 273.15, 300, 800).toFixed(3));
      trackRods(s, nowMs);
      if (alarms) for (const [key, node] of comps) setAttr(node, 'data-alarm', alarms.get(key) || 0);

      const fPrim = Math.max(0, Math.min(1.2, s.W_core / sp.mcp.W0));
      for (const n of flows.get('prim') || []) setVar(n, '--rs-w', flowVis(fPrim).toFixed(3));
      const fSteam = Math.max(0, Math.min(1.2, s.W_steam / sp.drum.W_steam0));
      for (const n of flows.get('steam') || []) setVar(n, '--rs-w', flowVis(fSteam).toFixed(3));
      const fFeed = Math.max(0, Math.min(1.2, s.W_fw / sp.drum.W_steam0));
      for (const n of flows.get('feed') || []) setVar(n, '--rs-w', flowVis(fFeed).toFixed(3));
      for (const n of flows.get('bypass') || []) setVar(n, '--rs-w', flowVis(s.bypass || 0).toFixed(3));

      const rcp = comps.get('rcp');
      if (rcp) {
        const states = d.pumpStates || [];
        const running = states.filter((x) => x === 'run').length;
        setAttr(rcp, 'data-state',
          running > 0 ? 'run' : (states.some((x) => x === 'tripped') ? 'tripped' : 'stopped'));
        setVar(rcp.parentNode, '--rs-w', fPrim.toFixed(3));
      }
      const fw = comps.get('fw');
      if (fw) {
        setAttr(fw, 'data-state', fFeed > 0.05 ? 'run' : 'stopped');
        setVar(fw.parentNode, '--rs-w', fFeed.toFixed(3));
      }
      setAttr(comps.get('gov'), 'data-state', s.gov > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('bypass'), 'data-state', s.bypass > 0.02 ? 'run' : 'stopped');
      setAttr(comps.get('gen'), 'data-state',
        s.turbineTripped ? 'tripped' : (s.breaker ? 'run' : 'stopped'));

      if (level) {
        const h = Math.max(2, 40 * Math.max(0, Math.min(1, s.L_drum)) * 2);
        setAttr(level, 'y', String(62 + 40 - Math.min(h, 40)));
        setAttr(level, 'height', String(Math.min(h, 40)));
      }

      setText(reads.get('power'), num(d.power_th_pct, 0) + ' %');
      setText(reads.get('drum'), num(s.p_drum, 1) + ' bar');
      setText(reads.get('orm'), t('val_orm') + ' ' + num(d.orm, 0));
      setAttr(reads.get('orm'), 'data-sev', d.orm < 15 ? '3' : (d.orm < 30 ? '1' : '0'));
      setText(reads.get('gov'), num(s.gov * 100, 0) + ' %');
      setText(reads.get('bypass'), num((s.bypass || 0) * 100, 0) + ' %');
      setText(reads.get('gen'), num(s.P_e, 0) + ' MW');
      setText(reads.get('cond'), num(s.p_cond, 3) + ' bar');
    },
  };
}

export const MIMICS = {
  'mimic-pwr': buildPwrMimic,
  'mimic-bwr': buildBwrMimic,
  'mimic-rbmk': buildRbmkMimic,
};
