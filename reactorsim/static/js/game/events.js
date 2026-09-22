// Störungsbibliothek.
//
// Eine Störung ist eine Funktion, die den Zustand anfasst -- und sonst nichts.
// Sie rechnet nicht selbst weiter; was danach passiert, ergibt sich aus der
// Physik. Deshalb steht hier auch kein "und dann fällt die Leistung um X":
// eine ausgefallene Pumpe ist eine ausgefallene Pumpe, der Rest folgt.
//
// Jede Störung trägt ihren Übersetzungsschlüssel selbst, damit das
// Ereignisprotokoll sie benennen kann.

const EVENTS = {
  // ── Für alle Typen ───────────────────────────────────────────────────────
  rod_stuck: {
    key: 'ev_rod_stuck',
    severity: 2,
    apply(e, args) {
      // Eine Stabgruppe klemmt: der Sollwert wird ignoriert.
      const i = args && args.bank !== undefined ? args.bank : 0;
      e.ctx.stuckRods = e.ctx.stuckRods || {};
      e.ctx.stuckRods[i] = e.state.rod[i];
    },
  },

  demand_step: {
    key: 'ev_demand_step',
    severity: 1,
    apply(e, args) {
      e.state.P_demand = Math.max(0, (args && args.mw) || e.state.P_demand);
    },
  },

  // ── Druckwasserreaktor ───────────────────────────────────────────────────
  rcp_trip: {
    key: 'ev_rcp_trip',
    severity: 3,
    apply(e, args) {
      const i = (args && args.loop) || 0;
      const pumps = e.ctx.pumps || e.ctx.mcp;
      if (pumps && pumps[i]) {
        pumps[i].trip();
        // Ohne das liess sich die "ausgefallene" Pumpe ueber denselben
        // Knopf, der sie auch im Normalbetrieb ein-/ausschaltet, sofort
        // wieder anwerfen -- siehe stepEvents() unten, gleiches Prinzip
        // wie ctx.stuckRods bei einer klemmenden Stabgruppe.
        e.ctx.pumpsStuck = e.ctx.pumpsStuck || new Set();
        e.ctx.pumpsStuck.add(i);
      } else if (e.ctx.recircPump) {
        e.ctx.recircPump.trip();
        e.ctx.recircPumpStuck = true;
      }
    },
  },

  porv_stuck: {
    key: 'ev_porv_stuck',
    severity: 3,
    apply(e) {
      // Das Abblaseventil schließt nicht mehr -- der Primärkreis verliert
      // Druck, obwohl die Anzeige "zu" meldet. Genau die Störung von TMI-2.
      e.ctx.porvStuck = true;
    },
  },

  feedwater_loss: {
    key: 'ev_feedwater_loss',
    severity: 3,
    apply(e) {
      if (e.ctx.fwCtl) { e.ctx.fwCtl.auto = false; e.ctx.fwCtl.manual = 0; }
    },
  },

  boron_dilution: {
    key: 'ev_boron_dilution',
    severity: 2,
    apply(e) {
      // Unkontrollierte Verdünnung: der Kern bekommt Reaktivität, langsam und
      // ohne dass jemand etwas bedient hat.
      if (e.state.boronFlow !== undefined) e.state.boronFlow = -1;
      e.ctx.boronRunaway = true;
    },
  },

  sg_tube_leak: {
    key: 'ev_sg_tube_leak',
    severity: 3,
    apply(e, args) {
      e.ctx.sgLeak = (args && args.kgs) || 12;
    },
  },

  // ── Siedewasserreaktor ───────────────────────────────────────────────────
  msiv_close: {
    key: 'ev_msiv_close',
    severity: 3,
    // Bleibt zu, wie ein klemmender Stab (ctx.stuckRods) -- sonst waere die
    // ganze Stoerung ein einziger Klick auf "offen" rueckgaengig zu machen.
    apply(e) {
      if (e.state.msiv === undefined) return;
      e.state.msiv = 0;
      e.ctx.msivStuck = true;
    },
  },

  recirc_runback: {
    key: 'ev_recirc_runback',
    severity: 2,
    apply(e, args) {
      if (e.state.recircDmd === undefined) return;
      const to = (args && args.to) || 0.5;
      // Ohne over_s bleibt es beim sofortigen Sollwert wie bisher (siehe
      // bwr_flow_control.json) -- dort ist es eine geplante Lastfuehrung,
      // kein Defekt. MIT over_s (siehe bwr_instability.json) sinkt der
      // Durchsatz stattdessen schleichend ueber die angegebene Zeit: das
      // gibt dem Spieler Gelegenheit, die gefaehrliche Kombination aus
      // hoher Leistung und niedrigem Durchsatz selbst zu verursachen (oder
      // rechtzeitig gegenzusteuern), statt von einem abrupten Sprung
      // ueberrumpelt zu werden. Weitergefuehrt in stepEvents() unten.
      if (args && args.over_s) {
        e.ctx.recircRunback = { from: e.state.recircDmd, to, t0: e.state.t_sim, dur: args.over_s };
      } else {
        e.state.recircDmd = to;
      }
    },
  },

  earthquake_scram: {
    key: 'ev_earthquake_scram',
    severity: 3,
    apply(e) {
      // Seismischer Trip: Schnellabschaltung UND Isolierung im selben
      // Augenblick -- beides zusammen ist die Bedingung, unter der sich der
      // Notkondensator automatisch zuschaltet (siehe bwr.js stepLoop()).
      e.scram('earthquake');
      if (e.state.msiv !== undefined) e.state.msiv = 0;
    },
  },

  station_blackout: {
    key: 'ev_station_blackout',
    severity: 3,
    apply(e) {
      // Wechsel- UND Gleichstrom weg. Die Umwaelzpumpe faellt mit --
      // niemand fährt sie wieder hoch, dafür fehlt der Motorstrom. Deshalb
      // recircPumpStuck genau wie bei rcp_trip: sonst liesse sich die
      // Pumpe ueber denselben Knopf wie sonst auch wieder anwerfen, obwohl
      // gar kein Motorstrom mehr da ist.
      // gridPower ist die Quelle, acPower die Folge (siehe stepDiesel() in
      // plants/bwr.js). Nur acPower zu nehmen haette der naechste
      // Rechenschritt sofort zurueckgesetzt -- das Netz stuende ja noch.
      e.state.gridPower = false;
      e.state.acPower = false;
      e.state.dcPower = false;
      if (e.ctx.recircPump) { e.ctx.recircPump.trip(); e.ctx.recircPumpStuck = true; }
    },
  },

  // ── RBMK ─────────────────────────────────────────────────────────────────
  rbmk_feed_supply_limit: {
    key: 'ev_rbmk_feed_supply_limit',
    severity: 2,
    apply(e, args) {
      if (e.state.reactor !== 'rbmk' || !args || typeof args !== 'object' || Array.isArray(args)
        || !Object.hasOwn(args, 'max_kgs') || !Number.isFinite(args.max_kgs) || args.max_kgs < 0) return;
      e.state.fwSupplyMax = Math.min(args.max_kgs, 1.3 * e.spec.drum.W_steam0);
    },
  },

  rbmk_aux_feed_ready: {
    key: 'ev_rbmk_aux_feed_ready',
    severity: 1,
    apply(e, args) {
      // Availability neither starts the pump nor refills the finite tank.
      if (e.state.reactor !== 'rbmk' || e.state.auxFeedInstalled !== true) return;
      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).length !== 0)) return;
      e.state.auxFeedAvailable = true;
    },
  },

  mcp_trip: {
    key: 'ev_mcp_trip',
    severity: 2,
    apply(e, args) {
      const n = (args && args.count) || 2;
      if (!e.ctx.mcp) return;
      // pumpsStuck wie bei rcp_trip: sonst liessen sich die "ausgefallenen"
      // Pumpen ueber denselben Knopf, der sie im Normalbetrieb auch
      // ein-/ausschaltet, im naechsten Augenblick wieder anwerfen.
      e.ctx.pumpsStuck = e.ctx.pumpsStuck || new Set();
      for (let i = 0; i < n && i < e.ctx.mcp.length; i++) {
        e.ctx.mcp[i].trip();
        e.ctx.pumpsStuck.add(i);
      }
    },
  },

  power_regulator_off: {
    key: 'ev_power_regulator_off',
    severity: 2,
    apply(e) { if (e.ctx.powerCtl) e.ctx.powerCtl.auto = false; },
  },

  rbmk_mcp_runback: {
    key: 'ev_rbmk_mcp_runback',
    severity: 2,
    apply(e, args) {
      // Wie recirc_runback beim SWR: der Durchsatz sinkt ueber die
      // angegebene Zeit, nicht in einem Schritt -- Naeherung an den
      // Turbinenauslauf, der die vom Turbogenerator mitversorgten
      // Hauptumwaelzpumpen langsam auslaufen liess. Keine eigene
      // Rotordrehzahl-Zustandsgroesse, bewusst geskriptet (siehe BACKLOG).
      if (e.state.reactor !== 'rbmk' || e.state.mcpDmd === undefined) return;
      // Seit 0.6.1 kein Drehbuch mehr: das Ereignis trennt den Generator vom
      // Netz, alles Weitere macht die Physik (rbmk.js stepLoop, sp.turbogen).
      // Der Pumpen-Sollwert des Spielers bleibt dabei unangetastet -- vorher
      // schob ihn das Ereignis selbst auf null, was auf dem Schirm aussah wie
      // eine Bedienhandlung, die niemand vorgenommen hatte.
      e.state.tgCoasting = true;
    },
  },

  // ── Netz ─────────────────────────────────────────────────────────────────
  turbine_trip: {
    key: 'ev_turbine_trip',
    severity: 3,
    apply(e) {
      e.state.turbineTripped = true;
      e.state.breaker = false;
      if (e.ctx.govCtl) e.ctx.govCtl.trip();
    },
  },

  loss_of_load: {
    key: 'ev_loss_of_load',
    severity: 3,
    apply(e) { e.state.breaker = false; },
  },
};

export function getEvent(id) { return EVENTS[id] || null; }
export function eventKey(id) { const e = EVENTS[id]; return e ? e.key : id; }
export function eventSeverity(id) { const e = EVENTS[id]; return e ? e.severity : 1; }

/**
 * Laufende Wirkungen, die sich nicht in einem Augenblick erschöpfen: ein
 * klemmendes Ventil bleibt offen, ein Leck leckt weiter, ein klemmender Stab
 * bleibt stehen. Wird jeden Rechenschritt gerufen.
 */
export function stepEvents(e, dt) {
  const s = e.state;
  const ctx = e.ctx;

  if (ctx.stuckRods) {
    for (const [i, pos] of Object.entries(ctx.stuckRods)) {
      // Auch die Schnellabschaltung bekommt ihn nicht herunter -- das ist der
      // Punkt an einem klemmenden Stab.
      s.rod[i] = pos;
    }
  }

  if (ctx.msivStuck && s.msiv !== undefined) {
    s.msiv = 0;
  }

  // Ausgefallene Pumpe(n) bleiben ausgefallen -- auch gegen einen Klick auf
  // denselben Knopf, der sie im Normalbetrieb wieder anwerfen wuerde (siehe
  // rcp_trip/mcp_trip/station_blackout oben). trip() jeden Schritt erneut
  // aufzurufen ist billig (setzt nur drei Felder) und idempotent, solange
  // niemand start() dazwischenruft -- genau das verhindert diese Zeile.
  if (ctx.pumpsStuck) {
    const pumps = ctx.pumps || ctx.mcp;
    if (pumps) for (const i of ctx.pumpsStuck) { if (pumps[i]) pumps[i].trip(); }
  }
  if (ctx.recircPumpStuck && ctx.recircPump) ctx.recircPump.trip();

  // Schleichender Umwaelzstrom-Abfall (siehe recirc_runback oben mit
  // over_s) -- laeuft ueber mehrere Minuten statt in einem Schritt.
  // Danach (frac >= 1) wird recircDmd ein letztes Mal gesetzt und die
  // Rampe geloescht: ab da hat der Spieler wieder die volle Handregelung,
  // genau wie beim sofortigen Sollwert ohne over_s.
  if (ctx.recircRunback && s.recircDmd !== undefined) {
    const rb = ctx.recircRunback;
    const frac = (s.t_sim - rb.t0) / rb.dur;
    if (frac >= 1) {
      s.recircDmd = rb.to;
      ctx.recircRunback = null;
    } else if (frac > 0) {
      s.recircDmd = rb.from + (rb.to - rb.from) * frac;
    }
  }

  // Das Abblaseventil klemmt offen -- aber das Blockventil davor sperrt es
  // ab, wenn der Bediener es schliesst. Ohne diese Bedingung lief der
  // Primaerkreis auch dann weiter leer, wenn er alles richtig gemacht hatte,
  // und das Szenario war nicht zu gewinnen.
  if (ctx.porvStuck && s.porv !== undefined && s.porvBlock !== 0) {
    s.porv = 1;
    // Ein offenes Abblaseventil entleert den Druckhalter stetig.
    s.pzr_p = Math.max(s.pzr_p - 0.35 * dt, 1);
    s.pzr_L = Math.max(s.pzr_L - 0.0009 * dt, 0);
  }

  if (ctx.sgLeak && s.M_sg !== undefined) {
    // Primärwasser tritt in den Dampferzeuger über: die Sekundärseite bekommt
    // Masse, der Druckhalter verliert Füllstand.
    s.M_sg += ctx.sgLeak * dt;
    s.pzr_L = Math.max(s.pzr_L - (ctx.sgLeak * 1.2e-5) * dt, 0);
  }

  if (ctx.boronRunaway && s.C_B_cmd !== undefined) {
    s.boronFlow = -1;
  }

}
