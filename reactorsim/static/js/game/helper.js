// Automatischer Helfer.
//
// Zu jeder Meldetafel-Kachel steht ein Hilfetext ("Konkret tun", siehe die
// *_help-Schluessel in den Sprachdateien). Dieses Modul fuehrt die dort
// beschriebenen Bedienhandlungen selbst aus -- ueber dieselben Stellglieder,
// die auch ein Klick auf den passenden Knopf im Leitstand anfassen -- und
// meldet, was es getan hat. Es rechnet nichts vor: eine Funktion greift den
// Zustand an, die Physik macht den Rest, genau wie eine Bedienhandlung des
// Spielers.
//
// EINE Handlung fasst der Helfer NIE an, in keinem der drei Typen: die
// Schnellabschaltung selbst (SCRAM/RESA/AZ-5). Das ist keine Vorsicht nur
// beim RBMK (siehe die ORM-Faelle unten) -- es ist dieselbe Regel, die schon
// sim/trips.js an die Spitze schreibt: "Die Schnellabschaltung bleibt allein
// Sache des Bedieners". Ein Helfer, der sie automatisch drueckt, wuerde genau
// die eine Entscheidung abnehmen, um die es in diesem Spiel geht. Wo eine
// Meldung nur mit einem SCRAM zu beheben ist (power_high, period_short, ...),
// bleibt sie deshalb 'unfixable' -- der Hilfetext daneben sagt, was zu tun
// ist, aber tun muss es der Spieler.
//
// Ein Eintrag ist fix(engine) -> { status, actions }:
//   'fixed'      mindestens eine Handlung wurde ausgefuehrt (actions nicht leer)
//   'none'       nichts zu tun -- Bedingung ist schon weg, oder das Ventil
//                schliesst ohnehin von selbst (z.B. porv_open)
//   'unfixable'  keine automatische Behebung vorgesehen: entweder braucht es
//                die Schnellabschaltung selbst (siehe oben), oder es gibt
//                sonst keinen Handgriff (ein klemmender Stab), oder die
//                Handlung ist zu riskant, um sie blind auszufuehren (siehe
//                h2_critical unten)
//
// `actions` ist eine Liste von {key, params}, uebersetzt ueber
// t(a.key, a.params) -- key ist immer 'helper_action_<name>'. Fehlt eine id
// in der Tabelle ihres Typs, gilt sie ebenfalls als nicht behebbar: eine neue
// Meldung braucht keinen Eintrag hier, um sicher zu bleiben.

import { noteAction } from './learning.js';

function act(name, params) { return { key: 'helper_action_' + name, params }; }

function fixed(actions) { return { status: actions.length ? 'fixed' : 'none', actions }; }

const UNFIXABLE = { status: 'unfixable', actions: [] };

/** Pumpen, die stehen, mit ihrer Anzeigenummer (1-basiert, wie am Knopf). */
function pumpsToStart(ctx) {
  return (ctx.pumpList || [])
    .map((p, i) => ({ p, n: i + 1 }))
    .filter((x) => x.p.state !== 'run');
}

function startPumps(ctx, actions) {
  for (const { p, n } of pumpsToStart(ctx)) { p.start(); actions.push(act('pump_start', { n })); }
}

function ensureAuto(ctl, name, actions) {
  if (ctl && !ctl.auto) { ctl.auto = true; actions.push(act(name)); }
}

/**
 * Turbinenschnellschluss: erst den Reaktorschutz zuruecksetzen (wenn er noch
 * steht und keine andere Auslösemeldung mehr ansteht -- engine.resetScram()
 * prueft das selbst), dann zuschalten. Das ist NICHT dieselbe Handlung wie
 * eine Schnellabschaltung ausloesen -- resetScram() gibt nur eine bereits
 * ausgeloeste und laengst nicht mehr noetige Verriegelung wieder frei, sie
 * greift nicht in den laufenden Reaktor ein. Typunabhaengig: engine.
 * resumeTurbine() kennt keinen Reaktortyp, siehe sim/engine.js.
 */
function fixTurbineTrip(engine) {
  const s = engine.state;
  const actions = [];
  if (s.scram.active) {
    if (!engine.resetScram()) return UNFIXABLE;
    actions.push(act('scram_reset'));
  }
  if (engine.resumeTurbine()) actions.push(act('turbine_resume'));
  return fixed(actions);
}

// ── Druckwasserreaktor ───────────────────────────────────────────────────────
//
// Handgriffe wie in trip_pzr_press_low_help & Co., abzueglich RESA (siehe
// oben): Leck stoppen (Blockventil), Druckhalterregelung wieder auf
// Automatik -- die maxt Heizung bzw. Sprühen ohnehin aus, sobald der Fehler
// gross genug ist, und behebt damit denselben Fall, den die Hilfe als "auf
// Hand schalten und hochfahren" beschreibt, ohne einen Zielwert erraten zu
// muessen.

function pwrClosePorvBlock(engine, actions) {
  const s = engine.state, ctx = engine.ctx;
  if (ctx.porvStuck && s.porvBlock !== 0) { s.porvBlock = 0; actions.push(act('porv_block_close')); }
}

const PWR_FIXES = {
  // Reine Kinetik/Reaktivitaet -- die Hilfe nennt keinen anderen Weg als RESA.
  power_high: () => UNFIXABLE,
  period_short: () => UNFIXABLE,
  dnbr_low: (e) => { const a = []; startPumps(e.ctx, a); return fixed(a); },
  rcp_lost: (e) => { const a = []; startPumps(e.ctx, a); pwrClosePorvBlock(e, a); return fixed(a); },
  subcool_low: (e) => {
    const a = [];
    pwrClosePorvBlock(e, a);
    ensureAuto(e.ctx.pzrCtl, 'pzr_auto', a);
    startPumps(e.ctx, a);
    return fixed(a);
  },
  pzr_press_low: (e) => {
    const a = [];
    pwrClosePorvBlock(e, a);
    ensureAuto(e.ctx.pzrCtl, 'pzr_auto', a);
    return fixed(a);
  },
  pzr_press_high: (e) => { const a = []; ensureAuto(e.ctx.pzrCtl, 'pzr_auto', a); return fixed(a); },
  // Fuellstand allein hat kein eigenes Stellglied (kein Volumenregelsystem
  // modelliert) -- die einzige automatisierbare Ursache ist ein klemmendes
  // Abblaseventil, siehe trip_pzr_level_low_help.
  pzr_level_low: (e) => {
    const a = [];
    pwrClosePorvBlock(e, a);
    return a.length ? fixed(a) : UNFIXABLE;
  },
  porv_stuck: (e) => {
    const a = [];
    pwrClosePorvBlock(e, a);
    ensureAuto(e.ctx.pzrCtl, 'pzr_auto', a);
    return fixed(a);
  },
  // Schliesst von selbst, sobald der Druck faellt -- klemmt es, meldet
  // porv_stuck separat (siehe oben).
  porv_open: () => ({ status: 'none', actions: [] }),
  sg_level_low: (e) => { const a = []; ensureAuto(e.ctx.fwCtl, 'fw_auto', a); return fixed(a); },
  sg_level_high: (e) => { const a = []; ensureAuto(e.ctx.fwCtl, 'fw_auto', a); return fixed(a); },
  sg_press_high: (e) => { const a = []; ensureAuto(e.ctx.govCtl, 'gov_auto', a); return fixed(a); },
  turbine_trip: fixTurbineTrip,
  // Auch hier: Kuehlung wiederherstellen ist automatisierbar, die
  // Schnellabschaltung selbst nicht.
  clad_temp: (e) => {
    const a = [];
    startPumps(e.ctx, a);
    pwrClosePorvBlock(e, a);
    ensureAuto(e.ctx.pzrCtl, 'pzr_auto', a);
    return fixed(a);
  },
  // Der Antrieb sitzt fest -- das behebt kein Knopf im Spiel, siehe
  // alarm_rod_stuck_help (Borsäure/Umwälzstrom/übrige Stäbe sind Ausweichen,
  // keine Reparatur, und zu kontextabhängig für einen einzelnen Klick).
  rod_stuck: () => UNFIXABLE,
};

// ── Siedewasserreaktor ───────────────────────────────────────────────────────

/**
 * Frischdampf-Absperrung: nur oeffnen, wenn sie NICHT klemmt (ctx.msivStuck) --
 * sonst schreibt game/events.js stepEvents() die Stellung im naechsten
 * Rechenschritt kommentarlos zurueck auf zu, und der Klick waere wirkungslos.
 * Klemmt sie, bleibt als automatisierbarer Rest nur, den Notkondensator
 * anzufordern (icDemand) -- er schaltet sich erst zu, sobald der Spieler
 * selbst SCRAM ausgeloest hat (siehe bwr.js stepLoop(), icWanted), steht dann
 * aber schon bereit.
 */
function bwrMsivFix(engine) {
  const s = engine.state, ctx = engine.ctx;
  const a = [];
  if (!ctx.msivStuck && s.msiv < 0.5) {
    s.msiv = 1;
    a.push(act('msiv_open'));
    return fixed(a);
  }
  if (ctx.msivStuck && !s.icDemand) { s.icDemand = 1; a.push(act('ic_on')); }
  return fixed(a);
}

function fixRecircUp(engine) {
  const s = engine.state, sp = engine.spec;
  const a = [];
  const target = sp.recirc.max;
  if (s.recircDmd < target - 0.001) { s.recircDmd = target; a.push(act('recirc_set', { v: Math.round(target * 100) })); }
  return fixed(a);
}

const BWR_FIXES = {
  power_high: () => UNFIXABLE,
  period_short: () => UNFIXABLE,
  oprm: () => UNFIXABLE,
  dome_press_high: (e) => {
    const s = e.state, ctx = e.ctx;
    const a = [];
    if (!ctx.msivStuck && s.msiv < 0.5) { s.msiv = 1; a.push(act('msiv_open')); }
    if (s.msiv < 0.5 && !s.icDemand) { s.icDemand = 1; a.push(act('ic_on')); }
    return fixed(a);
  },
  level_low: (e) => {
    const s = e.state, ctx = e.ctx;
    const a = [];
    if (s.acPower) ensureAuto(ctx.fwCtl, 'fw_auto', a);
    else if (!s.fireInjOn) { s.fireInjOn = true; a.push(act('fire_inj_on')); }
    return fixed(a);
  },
  level_high: (e) => { const a = []; ensureAuto(e.ctx.fwCtl, 'fw_auto', a); return fixed(a); },
  instability: fixRecircUp,
  recirc_low: fixRecircUp,
  msiv: bwrMsivFix,
  msiv_stuck: bwrMsivFix,
  srv_open: (e) => {
    if (e.state.msiv < 0.5) return bwrMsivFix(e);
    const a = [];
    ensureAuto(e.ctx.govCtl, 'gov_auto', a);
    return fixed(a);
  },
  turbine_trip: fixTurbineTrip,
  clad_temp: (e) => {
    const s = e.state, ctx = e.ctx;
    const a = [];
    startPumps(ctx, a);
    if (s.msiv < 0.5) {
      if (!ctx.msivStuck) { s.msiv = 1; a.push(act('msiv_open')); } else if (!s.icDemand) { s.icDemand = 1; a.push(act('ic_on')); }
    }
    if (!s.acPower && !s.fireInjOn) { s.fireInjOn = true; a.push(act('fire_inj_on')); }
    return fixed(a);
  },
  // Venten hilft laut Hilfetext ohnehin erst NACH dem Abschalten wirklich
  // (der Zustrom bei Volllast ist ein Vielfaches von ventCv) -- ohne
  // automatisches SCRAM bleibt hier trotzdem das Ventil selbst als Handlung,
  // schadet nicht und ist schon offen, wenn der Spieler abschaltet.
  cont_press_high: (e) => {
    const s = e.state;
    const a = [];
    if (!s.contVentOpen) { s.contVentOpen = true; a.push(act('cont_vent_open')); }
    return fixed(a);
  },
  // Severe-accident gas management requires operator judgement.
  h2_critical: () => UNFIXABLE,
  // Der Antrieb sitzt fest, siehe PWR_FIXES.rod_stuck.
  rod_stuck: () => UNFIXABLE,
};

// ── RBMK ─────────────────────────────────────────────────────────────────────
//
// Manual insertion shares the same geometric displacer effect as AZ-5.
const RBMK_FIXES = {
  power_high: () => UNFIXABLE,
  period_short: () => UNFIXABLE,
  orm_low: () => UNFIXABLE,
  orm_critical: () => UNFIXABLE,
  void_positive: () => UNFIXABLE,
  // Kein Frischdampf-/Umleitventil im Zugriff dieses Typs (uiControls() bietet
  // nur den Umwaelzstrom), und ohne RESA/AZ-5 bleibt sonst kein Hebel.
  drum_press_high: () => UNFIXABLE,
  drum_level_low: (e) => { const a = []; ensureAuto(e.ctx.fwCtl, 'fw_auto', a); return fixed(a); },
  drum_level_high: (e) => { const a = []; ensureAuto(e.ctx.fwCtl, 'fw_auto', a); return fixed(a); },
  mcp_cavitation: (e) => {
    const s = e.state;
    const a = [];
    const target = Math.max(0.4, s.mcpDmd - 0.1);
    if (target < s.mcpDmd - 0.001) { s.mcpDmd = target; a.push(act('mcp_set', { v: Math.round(target * 100) })); }
    return fixed(a);
  },
  graphite_hot: (e) => {
    const ctx = e.ctx;
    const a = [];
    ensureAuto(ctx.powerCtl, 'power_ctl_auto', a);
    const target = Math.max(0.2, ctx.powerCtl.setpoint - 0.1);
    if (target < ctx.powerCtl.setpoint - 0.001) {
      ctx.powerCtl.setpoint = target;
      a.push(act('power_setpoint', { v: Math.round(target * 100) }));
    }
    return fixed(a);
  },
  // Xenon-Schwingung ueber Stunden -- "erwarte davon wenig", siehe
  // alarm_axial_tilt_help. Kein Handgriff, der das jetzt beheben wuerde.
  axial_tilt: () => UNFIXABLE,
  turbine_trip: fixTurbineTrip,
  clad_temp: (e) => {
    const a = [];
    startPumps(e.ctx, a);
    ensureAuto(e.ctx.fwCtl, 'fw_auto', a);
    return fixed(a);
  },
  rod_stuck: () => UNFIXABLE,
};

const FIXES = { pwr: PWR_FIXES, bwr: BWR_FIXES, rbmk: RBMK_FIXES };

export function isKnownHelper(reactorId, tripId) {
  return typeof reactorId === 'string' && typeof tripId === 'string'
    && Object.hasOwn(FIXES, reactorId) && Object.hasOwn(FIXES[reactorId], tripId);
}

/**
 * @param {object} engine    wie von sim/engine.js createEngine() geliefert
 * @param {string} reactorId engine.spec.id
 * @param {string} tripId    def.id einer Meldetafel-Kachel oder eines
 *                           Protokolleintrags mit id (siehe sim/trips.js)
 * @returns {{status: 'fixed'|'none'|'unfixable', actions: object[]}}
 */
export function runHelper(engine, reactorId, tripId) {
  if (!isKnownHelper(reactorId, tripId)) return UNFIXABLE;
  if (engine.recorder) engine.recorder.record('helper', tripId);
  try {
    const result = FIXES[reactorId][tripId](engine);
    if (result.status === 'fixed') {
      for (const a of result.actions) noteAction(engine, 'helper:' + a.key, a.params);
    }
    return result;
  } catch {
    // Ein Fehler im Helfer darf die Runde nicht anhalten -- lieber "nicht
    // behebbar" melden als die Anzeige mit einer Ausnahme abreissen.
    return UNFIXABLE;
  }
}
