// RBMK-1000.
//
// 3200 MWth / 1000 MWe (zwei Turbosätze à 500), graphitmoderiert, Druckröhren,
// siedendes Leichtwasser, keine Volldruck-Sicherheitshülle.
//
// Die drei Eigenheiten, um die es in diesem Spiel geht:
//
// 1. POSITIVER DAMPFBLASENKOEFFIZIENT. Moderiert wird mit Graphit, nicht mit
//    Wasser. Das Wasser ist netto ein Absorber. Verschwindet es als Dampf,
//    steigt die Reaktivität -- mehr Leistung, mehr Dampf, noch mehr Leistung.
//    Wie stark, hängt davon ab, wie viele Absorberstäbe im Kern stecken: je
//    weniger, desto positiver.
//
// 2. ORM, die Abschaltreserve in Stabäquivalenten. Sie ist kein Kennwert für
//    die Statistik, sondern der Parameter, der den Blasenkoeffizienten
//    einstellt. Unter 30 Stäben ist der Betrieb verboten. Bei sechs ist der
//    Reaktor ein anderes Gerät.
//
// 3. AZ-5 MIT GRAPHITSPITZEN. Unter jedem Absorber hängt ein 4,5 m langer
//    Graphitverdränger, und über und unter dem 7-m-Kern steht je eine
//    1,25-m-Wassersäule. Fährt ein ganz gezogener Stab ein, schiebt sich
//    zuerst der Graphit in die untere Wassersäule: Absorber raus, Moderator
//    rein, und zwar genau dort, wo bei bodennahem Flussprofil die meiste
//    Leistung entsteht. Die Schnellabschaltung fügt in den ersten Sekunden
//    POSITIVE Reaktivität ein. Erst danach greift der Absorber -- nach
//    achtzehn Sekunden, mit einem Antrieb von 0,4 m/s.
//
// Keiner dieser drei Punkte ist nachträglich angeflanscht. Sie fallen aus
// denselben Gleichungen wie bei den anderen beiden Reaktortypen; nur die
// Vorzeichen und Kennwerte sind andere.

import { Pump, Valve, Lag, coldStopPumps } from '../sim/components.js';
import {
  FeedwaterController, GovernorController, RodController, PowerController,
} from '../sim/controllers.js';
import { tsat, psat, hg, hf, hfg, rhog, averageVoid } from '../sim/steam.js';
import { rodWorthCurve } from '../sim/reactivity.js';
import { clamp, toK, relax, LAMBDA_I135, LAMBDA_XE } from '../sim/constants.js';
import { stepPoisons, equilibriumPoisons } from '../sim/poisons.js';
import { availableSteam, saturatedPressure, coverage, transferFraction } from '../sim/thermal.js';
import { SEVERITY } from '../sim/trips.js';

const P0_DRUM = 69;
const T_FW = toK(165);
const H_FW = 4.2 * 165;

export const spec = {
  id: 'rbmk',
  P0_th: 3200,
  P0_e: 1000,
  cycleEFPD: 1100,          // wird im Betrieb nachgeladen, daher lang

  beta: { boc: 0.0048, eoc: 0.0045 },
  // Graphit bremst langsamer als Wasser: die prompte Lebensdauer ist fünfzig
  // Mal länger als im Druckwasserreaktor. Deshalb läuft eine Exkursion hier
  // über Sekunden statt über Mikrosekunden -- und deshalb ist sie überhaupt
  // darstellbar.
  Lambda: 1e-3,

  fuel: {
    mass_t: 192,
    cp: 300,
    tau: 7.0,
    // Ein guter Teil der Energie landet direkt im Graphit, nicht im Brennstoff.
    depositFraction: 0.94,
    T_melt: 3120,
  },
  clad: { C_frac: 0.14, tau: 0.05, T_fail: 1477 },

  coolant: {
    W0: 10500,
    cp: 4.9,
    T_in: tsat(P0_DRUM) - 26,
    T_out: tsat(P0_DRUM),
    p0: P0_DRUM,
    mass: 24000,
    flowArea_m2: 9.0,
  },

  graphite: {
    mass_t: 1700,
    cp: 700,              // J/kgK
    powerFraction: 0.05,  // Anteil der Spaltenergie, der im Graphit landet
    UA: 560,              // kW/K zu den Druckröhren
    T0: toK(600),
  },

  // 'rods' fehlt bewusst hier -- die generische Stabwirksamkeitskurve setzt
  // Absorberwirkung ab h=0 an, ohne die 1,25-m-Wassersaeule/Graphitspitze
  // vor dem eigentlichen Absorber zu kennen. Fuer diesen Typ ersetzt
  // hooks.reactivity() den Beitrag durch eine Kurve, die genau diese
  // Vorlaufstrecke ausspart (siehe dort).
  feedbacks: ['doppler', 'xenon', 'samarium', 'graphite', 'excess'],

  feedback: {
    // Der Doppler ist bei diesem Typ der einzige kräftige negative Beitrag im
    // Leistungskoeffizienten -- Graphit und Dampfblasen ziehen beide nach oben.
    // Mit -1,2 pcm/K blieb netto fast nichts übrig (-54 pcm je Einheit
    // Leistung), und die Anlage driftete allein durch den Xenon-Abbrand binnen
    // drei Stunden über die Leistungsauslösung. Auch -2,0 reichte noch nicht:
    // der Xenon-Abbrand liefert auf seiner eigenen Zeitskala rund +420 pcm je
    // Einheit, und dagegen muss der Leistungskoeffizient deutlich stehen.
    // -2,6 pcm/K ergibt netto etwa -730 pcm je Einheit. Bei Volllast ist die
    // Anlage damit ruhig -- und trotzdem weit weniger gutmütig als die beiden
    // Leichtwasserreaktoren. Ihre Gefahr liegt ohnehin nicht hier oben,
    // sondern bei kleiner Leistung: dort ist der Brennstoff kalt, der Doppler
    // schwach und der Dampfblasenkoeffizient wirksam.
    doppler_pcm_per_K: -2.6,
    doppler_T_ref: 1050,

    graphite_pcm_per_K: 0.5,
    graphite_T_ref: toK(600),

    xenon_worth_pcm: 3000,
    samarium_worth_pcm: 500,

    excess_pcm: 3700,

    // Der Blasenbeitrag steht NICHT in dieser Liste -- er kommt aus dem Haken,
    // weil sein Kennwert von der Abschaltreserve abhängt.
    void_ref: 0.25,
    void_pcm_per_pct_nominal: 20,   // bei ORM = 45
    void_pcm_per_pct_depleted: 62,  // bei ORM = 0
  },

  // Zwei Gruppen stellvertretend für 211 Stäbe. Die Stabzahl je Gruppe geht in
  // die Abschaltreserve ein -- sie wird in Stabäquivalenten gezählt, nicht in
  // pcm, weil der Betrieb sie so zählt.
  //
  // worth UNVERAENDERT gelassen (siehe audit/ fuer den verworfenen Versuch,
  // sie um 0.541 herunterzuskalieren): das haette die Nennbetrieb-ORM zwar
  // auf 46 zurueckgeholt, aber gleichzeitig die Staebe insgesamt schwaecher
  // gemacht -- beim Fahren auf Teillast (wo MEHR Einfahrtiefe noetig ist, um
  // das aufkommende Xenon zu haltenden) rutscht die Anlage dann durch genau
  // die Randzone knapp oberhalb von tip.span, in der die Kurve nach der
  // Trennung von Absorber und Spitze am steilsten/empfindlichsten ist -- und
  // kollabiert schon beim Fahren von 50% auf 30%, weit vor den historischen
  // 7%. Die jetzt korrekte Kurve (Absorber erst ab tip.span wirksam) braucht
  // mit UNVERAENDERTER Wirksamkeit bei Nennbetrieb rechnerisch ORM=85 statt
  // 46 -- das ist der Preis der Korrektur, nicht rueckgaengig zu machen ohne
  // die Teillastfahrt wieder zu zerstoeren. sp.orm.nominal bleibt bei 46:
  // der Blasenkoeffizient klemmt oberhalb davon ohnehin auf seinem besten
  // Wert (siehe _voidCoeff), 85 statt 46 aendert daran nichts.
  rodBanks: [
    { id: 'ctrl', worth: 2400, speed: 0.0056, initial: 0.22, rods: 120 },
    { id: 'sd', worth: 3200, speed: 0.0056, initial: 0.22, rods: 91 },
  ],
  // Motorantrieb, 0,4 m/s über sieben Meter Kern plus Wassersäulen.
  // Der Knopf heißt hier nicht SCRAM und auch nicht RESA, sondern AZ-5 --
  // Notschutz fünfter Kategorie. Der Name gehört zur Anlage wie die
  // Graphitspitzen, die ihn in den ersten Sekunden zum Gegenteil machen.
  scram: { timeS: 18, labelKey: 'btn_scram_az5', titleKey: 'btn_scram_az5_title' },

  orm: { total: 211, nominal: 46, min: 30, alarm: 15 },

  // Turbogenerator als Schwungmasse.
  //
  // Bis 0.6.0 war der Auslaufversuch ein Drehbuch: ein Ereignis fuhr den
  // Pumpen-SOLLWERT linear auf null, ueber dreissig Sekunden. Das hatte zwei
  // Fehler. Erstens bewegte es den Schieber des Spielers, ohne dass jemand
  // ihn angefasst haette. Zweitens war der Endwert null -- historisch hingen
  // aber nur VIER der acht Hauptumwaelzpumpen am auslaufenden Generator, die
  // anderen vier blieben am Netz.
  //
  // Jetzt ist die Drehzahl eine echte Zustandsgroesse (s.tgSpeed). Der Rotor
  // bremst gegen die Pumpenlast, und eine Kreiselpumpe zieht Leistung
  // proportional zur dritten Potenz der Drehzahl (Aehnlichkeitsgesetze). Aus
  //     J w dw/dt = -P0 (w/w0)^3
  // wird dw/dt = -w^2/tau, und das hat die geschlossene Loesung
  //     w(t) = w0 / (1 + w0 t/tau).
  // Der Schritt unten ist dafuer exakt, nicht genaehert -- der Zeitschritt
  // faellt heraus. tau ist die Zeit bis zur halben Drehzahl; 15 s bildet den
  // dokumentierten Auslauf ab (Durchsatz spuerbar weg nach rund einer halben
  // Minute), ohne eine Rotortraegheit zu erfinden, die niemand nachschlagen
  // kann.
  //
  // Nachgemessen (tests/tools/chernobyl_coastdown.mjs): mit dieser Kurve UND
  // dem historischen Endwert -- vier Pumpen bleiben am Netz -- zerstoert AZ-5
  // den Kern weiterhin. Mit der alten LINEAREN Rampe auf denselben Endwert
  // nicht: der Rotor faellt anfangs schneller, und genau die ersten Sekunden
  // entscheiden.
  turbogen: { coastdownPumps: 4, tau_s: 15 },

  // Der Nachlauf nach dem Brennstoffversagen (siehe engine.js:
  // startAftermath). Bisher nur bei diesem Typ -- die anderen beiden stehen
  // im BACKLOG.
  //
  // Der obere biologische Schild, in den Unterlagen "Schema J"/Deckel des
  // Reaktorschachts, wiegt rund 2000 t bei etwa 17 m Durchmesser. Aus diesen
  // beiden nachschlagbaren Zahlen folgt ohne weitere Annahme der statische
  // Ueberdruck, ab dem er abhebt: 2000 t mal g durch 227 m^2 -- rund 0,86 bar.
  // Das ist die zweite Zahl, die der Nachlauf nennt.
  //
  // `lift_m` und `conversion` sind dagegen GESETZT, und zwar sichtbar: zehn
  // Meter Hub sind eine Groessenordnung (der Schild wurde angehoben und fiel
  // schraeg zurueck), und der Umsetzungsgrad einer Dampfexplosion liegt in
  // Versuchen bei wenigen Prozent der thermischen Energie. Beide sind so
  // gewaehlt, dass sie die Aussage eher schwaechen als staerken: mit 2 %
  // braucht der Hub rund ein Prozent der im Brennstoff ueber Saettigung
  // gespeicherten Energie -- mehr als genug, aber eben gerechnet und nicht
  // behauptet.
  //
  // `lid_delay_s` ist keine Physik, sondern Anzeige: zwei Sekunden, damit der
  // Ausschlag auf den Instrumenten noch zu sehen ist, bevor das Bild
  // umschlaegt. Historisch lagen zwischen den beiden Schlaegen der Nacht
  // ebenfalls wenige Sekunden.
  aftermath: {
    lid: { mass_t: 2000, diameter_m: 17, lift_m: 10 },
    conversion: 0.02,
    lid_delay_s: 2,
  },

  // Graphitverdränger unter dem Absorber.
  tip: {
    // Phenomenological worth per bank, not a reconstructed accident curve.
    worth_pcm: 320,
    // Nur Stäbe, die weit draußen stehen, schieben Graphit in die untere
    // Wassersäule. Wer schon halb drin steckt, hat dort längst Absorber.
    outThreshold: 0.12,
    // Über diesen Teil des Fahrwegs wirkt die Spitze, danach kommt der
    // Absorber.
    span: 1.25 / 7,
  },

  axial: {
    // Steifigkeit des Flussprofils: wie viel Reaktivitätsunterschied zwischen
    // oben und unten nötig ist, um die Verteilung ganz zu verschieben.
    //
    // Der Wert entscheidet über die Schleifenverstärkung der axialen
    // Xenon-Rückkopplung: mehr Fluss unten heißt dort zunächst WENIGER Xenon
    // (Abbrand ist schneller als der Jod-Nachschub), und das kippt das Profil
    // weiter. Mit 1400 pcm lag die Verstärkung über eins -- das Profil kippte
    // binnen zwei Stunden ganz nach unten und blieb dort. Mit 2500 bleibt die
    // Rückkopplung darunter: das Profil wandert sichtbar, läuft aber nicht weg.
    // Mit 1400 lag die Schleifenverstaerkung ueber eins und das Profil kippte
    // binnen zwei Stunden ganz nach unten; mit 2500 dauerte es sechs Stunden.
    // 4200 fasst zusammen, was dagegen haelt: die Geometrie des Kerns und vor
    // allem der oertliche Doppler -- die Zone mit mehr Fluss hat heisseren
    // Brennstoff und draengt den Fluss von selbst zurueck. Ein RBMK brauchte
    // dafuer im Original eine eigene Regelung der oertlichen
    // Leistungsverteilung; hier steckt sie in dieser einen Zahl.
    stiffness_pcm: 4200,
    tau: 300,            // s, das Profil folgt träge
    rodPush_pcm: 900,    // Stäbe fahren von oben ein und drücken den Fluss nach unten
  },

  drum: {
    p0: P0_DRUM,
    mass: 160000,
    cp: 5.2,
    level0: 0.5,
    massSpan: 36000,
    shrinkSwell: 1.2,
    voidCollapse: 0.014,
    T_fw: T_FW,
    W_steam0: 1538,
    subcool0: 26,
  },

  mcp: { count: 8, W0: 10500, coastTau: 8, rampTau: 5 },

  // Scenario equipment in the reduced model, not a historical plant claim.
  auxFeed: { maxFlow: 220, capacityKg: 160000 },

  // workFactor so gewaehlt, dass 3200 MWth die 1000 MWe der beiden Turbosaetze
  // ergeben -- 31 % Gesamtwirkungsgrad, der niedrigste der drei Typen.
  turbine: { Cv: 44, strokeS: 3, workFactor: 0.2467, bypassCv: 22, bypassStrokeS: 1.0 },
  condenser: { T_cw: toK(15), pinch: 6, rise: 12, p0: 0.05 },

  // Wie beim Siedewasserreaktor: CPR, nicht DNBR.
  marginKey: 'val_cpr',

  // Trommeldruck-Rundinstrument. Nennwert 69 bar, Auslösung bei 76 -- eigene
  // Skala statt der DWR-Vorgabe (100-180 bar), sonst stünde die Nadel im
  // sauberen Volllastbetrieb dauerhaft unten im roten Bereich.
  pressureGauge: { min: 40, max: 85, bands: [[40, 55, 'warn'], [55, 73, 'ok'], [73, 85, 'danger']] },

  // Welches Fließbild-Bauteil zu welcher Meldung gehört.
  alarmComponents: {
    power_high: 'core', period_short: 'core', orm_low: 'core', orm_critical: 'core',
    void_positive: 'core', graphite_hot: 'core', axial_tilt: 'core', clad_temp: 'core',
    drum_press_high: 'drum', drum_level_low: 'drum', drum_level_high: 'drum',
    rbmk_feed_limited: 'drum', rbmk_aux_ready: 'drum',
    rbmk_aux_low: 'drum', rbmk_aux_empty: 'drum',
    mcp_cavitation: 'rcp', mcp_stuck: 'rcp',
    turbine_trip: 'gen', grid_deviation_warn: 'gen', grid_deviation_trip: 'gen',
  },

  // Der Schalter im Kern-Panel heisst hier nach dem, was er wirklich regelt.
  rodAutoKey: 'ctl_power_ctl',
  // Beide Gruppen fahren gemeinsam -- so bleibt die Abschaltreserve ein
  // sinnvoller Mittelwert und kein Zufallsprodukt zweier Einzelstellungen.
  rodBanksMoveTogether: true,

  mimic: 'mimic-rbmk',

  trips: [
    { id: 'power_high', key: 'trip_power_high', severity: SEVERITY.TRIP,
      test: (s) => s.n > 1.12, delay_s: 0.3, action: 'scram' },
    { id: 'period_short', key: 'trip_period_short', severity: SEVERITY.TRIP,
      test: (s, d) => s.n > 1e-3 && d.period > 0 && d.period < 10,
      delay_s: 1.0, action: 'scram' },
    // s.promptCritical kommt fertig aus der Kinetik (sim/kinetics.js: rho > beta).
    { id: 'prompt_critical', key: 'trip_prompt_critical', severity: SEVERITY.TRIP,
      test: (s) => s.promptCritical, delay_s: 0, action: 'scram' },
    { id: 'orm_low', key: 'alarm_orm_low', severity: SEVERITY.WARN,
      test: (s, d) => d.orm < 30, delay_s: 1.0 },
    { id: 'orm_critical', key: 'alarm_orm_critical', severity: SEVERITY.TRIP,
      test: (s, d) => d.orm < 15, delay_s: 1.0 },
    { id: 'void_positive', key: 'alarm_void_positive', severity: SEVERITY.WARN,
      test: (s, d) => d.voidCoeff > 45, delay_s: 2.0 },
    { id: 'drum_press_high', key: 'trip_dome_press_high', severity: SEVERITY.TRIP,
      test: (s) => s.p_drum > 76, delay_s: 0.5, action: 'scram' },
    { id: 'drum_level_low', key: 'trip_level_low', severity: SEVERITY.TRIP,
      test: (s) => s.L_drum < 0.25, delay_s: 1.5, action: 'scram' },
    { id: 'drum_level_high', key: 'alarm_level_high', severity: SEVERITY.WARN,
      test: (s) => s.L_drum > 0.78, delay_s: 2.0 },
    { id: 'mcp_cavitation', key: 'alarm_mcp_cavitation', severity: SEVERITY.WARN,
      test: (s, d) => d.subcooling < 4 && s.W_core > 0.9 * 10500, delay_s: 1.0 },
    { id: 'graphite_hot', key: 'alarm_graphite_hot', severity: SEVERITY.WARN,
      test: (s) => s.T_gr > toK(760), delay_s: 5 },
    { id: 'axial_tilt', key: 'alarm_axial_tilt', severity: SEVERITY.WARN,
      test: (s, d) => Math.abs(d.axialOffset) > 0.35, delay_s: 5 },
    { id: 'turbine_trip', key: 'alarm_turbine_trip', severity: SEVERITY.WARN,
      test: (s) => s.turbineTripped, delay_s: 0 },
    { id: 'clad_temp', key: 'trip_clad_temp', severity: SEVERITY.TRIP,
      test: (s) => s.T_cl > 1477, delay_s: 0, action: 'scram' },
    // Eine klemmende Stabgruppe war vorher nur eine Zeile im Protokoll. Der
    // Sollwert liess sich weiter verstellen, die Stellung folgte nicht, und
    // nichts sagte warum -- auch die Schnellabschaltung bekommt sie nicht
    // herunter. Das gehoert auf die Meldetafel, nicht ins Protokoll.
    { id: 'rod_stuck', key: 'alarm_rod_stuck', severity: SEVERITY.WARN,
      test: (s, d) => !!d.rodStuck, delay_s: 0, hold_s: 0 },
    // Dieselbe Luecke bei einer ausgefallenen Pumpe (mcp_trip): vorher nur
    // eine Protokollzeile beim Ausfall selbst, danach nichts mehr auf der
    // Meldetafel -- und der "Ein"-Knopf liess sich anklicken, als waere
    // nichts gewesen (siehe pumpsStuck-Fix in game/events.js).
    { id: 'mcp_stuck', key: 'alarm_mcp_stuck', severity: SEVERITY.WARN,
      test: (s, d) => !!d.pumpStuck, delay_s: 0, hold_s: 0 },
    { id: 'rbmk_feed_limited', key: 'alarm_rbmk_feed_limited', severity: SEVERITY.WARN,
      test: (s) => s.auxFeedInstalled && s.fwSupplyMax < 1.3 * spec.drum.W_steam0,
      delay_s: 0, hold_s: 0 },
    { id: 'rbmk_aux_ready', key: 'alarm_rbmk_aux_ready', severity: SEVERITY.INFO,
      test: (s) => s.auxFeedInstalled && s.auxFeedAvailable && !s.auxFeedOn,
      delay_s: 0, hold_s: 0 },
    { id: 'rbmk_aux_low', key: 'alarm_rbmk_aux_low', severity: SEVERITY.WARN,
      test: (s) => s.auxFeedInstalled && s.auxFeedAvailable && s.auxWaterKg < 0.15 * spec.auxFeed.capacityKg,
      delay_s: 0, hold_s: 0 },
    { id: 'rbmk_aux_empty', key: 'alarm_rbmk_aux_empty', severity: SEVERITY.WARN,
      test: (s) => s.auxFeedInstalled && s.auxFeedAvailable && s.auxWaterKg <= 0,
      delay_s: 0, hold_s: 0 },
  ],
};

export const hooks = {
  extraState(s, sp, ctx) {
    s.p_drum = sp.drum.p0;
    s.L_drum = sp.drum.level0;
    s.M_drum = sp.drum.mass;
    s.x_e = 0;
    s.alphaBar = sp.feedback.void_ref;
    s.dTsub = sp.drum.subcool0;
    s.W_steam = sp.drum.W_steam0;
    s.W_fw = sp.drum.W_steam0;
    s.W_fwDemand = s.W_fw;
    s.W_fwMain = s.W_fw;
    s.W_fwAux = 0;
    s.fwSupplyMax = 1.3 * sp.drum.W_steam0;
    s.auxFeedInstalled = false;
    s.auxFeedAvailable = false;
    s.auxFeedOn = false;
    s.auxFeedDmd = 0;
    s.auxWaterKg = sp.auxFeed.capacityKg;
    s.coolantHeatMW = 0;
    s.gov = 0.8;
    s.bypass = 0;
    s.p_cond = sp.condenser.p0;
    s.turbineTripped = false;
    s.breaker = true;
    s.p_prim = sp.drum.p0;
    s.P_demand = sp.P0_e;
    s.mcpDmd = 1.0;
    // Am Netz gehalten: volle Drehzahl, kein Auslauf (siehe sp.turbogen).
    s.tgSpeed = 1;
    s.tgCoasting = false;
    s.T_gr = sp.graphite.T0;

    // Axiales Flussprofil. ao > 0 heißt bodennah -- genau der Zustand, in dem
    // die Graphitspitzen am gefährlichsten sind.
    s.ao = 0;

    // Zonenweises Xenon. Die Zonen sehen unterschiedliche Leistung, also baut
    // sich die Vergiftung oben und unten unterschiedlich auf, und daraus
    // entstehen axiale Xenon-Schwingungen von selbst.
    const eq = equilibriumPoisons(s.n);
    s.zTop = { I: eq.I, X: eq.X, Pm: eq.Pm, Sm: eq.Sm };
    s.zBot = { I: eq.I, X: eq.X, Pm: eq.Pm, Sm: eq.Sm };

    // Stellung der Stäbe beim Auslösen der Schnellabschaltung -- nur wer weit
    // draußen stand, schiebt Graphit in die untere Wassersäule.
    s.tipArmed = [0, 0];
    s.az5 = { armed: false, t: 0 };
    s.srv = 0;

    ctx.mcp = [];
    for (let i = 0; i < sp.mcp.count; i++) {
      ctx.mcp.push(new Pump({
        W0: sp.mcp.W0 / sp.mcp.count, coastTau: sp.mcp.coastTau, rampTau: sp.mcp.rampTau,
      }));
    }
    // Einheitliche Liste fuer typunabhaengigen Code (Spielstand) -- siehe
    // net/persist.js, das den Betriebszustand jeder Pumpe mitsichert.
    ctx.pumpList = ctx.mcp;
    // Kaltstart: Hauptumwaelzpumpen stehen, der Spieler schaltet sie selbst
    // zu -- genauso wie er selbst die Staebe zieht. Nur Naturumlauf bis dahin.
    if (ctx.cold) coldStopPumps(ctx.mcp);
    ctx.govValve = new Valve(sp.turbine.strokeS, 0.8);
    ctx.bypassValve = new Valve(sp.turbine.bypassStrokeS, 0);
    ctx.voidLag = new Lag(1.0, sp.feedback.void_ref);
    ctx.dpLag = new Lag(0.3, 0);
    ctx.pPrev = sp.drum.p0;
    ctx.aoLag = new Lag(sp.axial.tau, 0);

    // Der Stabregler dieses Typs geht auf die Leistung, nicht auf eine
    // Temperatur -- die liegt durch den Trommeldruck fest.
    ctx.rodCtl = new RodController({
      tAvgLow: tsat(sp.drum.p0), tAvgHigh: tsat(sp.drum.p0), deadbandK: 99, bank: 0,
    });
    ctx.rodCtl.auto = false;
    ctx.powerCtl = new PowerController({
      setpoint: s.n, deadband: 0.004, speed: sp.rodBanks[0].speed,
    });
    // Diesen Regler meint der Schalter im Kern-Panel -- nicht ctx.rodCtl, der
    // hier gar nichts tut. Ihn abzuschalten ist der erste Schritt in die
    // Nachtschicht vom 26. April.
    ctx.rodAutoCtl = ctx.powerCtl;

    ctx.fwCtl = new FeedwaterController({
      levelSet: sp.drum.level0, W0: sp.drum.W_steam0, kp: 2.0, ki: 0.04,
    });
    ctx.govCtl = new GovernorController({
      mode: 'pressure', pSet: sp.drum.p0, P0: sp.P0_e, posNominal: 0.8,
      kp: 0.9, ki: 0.35, trim: 0.5,
    });

    // Was net/persist.js in den Spielstand mitpackt und beim Laden
    // zurueckschreibt. ctx.rodCtl fehlt bewusst -- der ist hier inaktiv
    // (auto immer false), der Leistungsregler ist ctx.powerCtl.
    ctx.saveable = {
      pumps: ctx.pumpList,
      govValve: ctx.govValve,
      bypassValve: ctx.bypassValve,
      voidLag: ctx.voidLag,
      dpLag: ctx.dpLag,
      aoLag: ctx.aoLag,
      powerCtl: ctx.powerCtl,
      fwCtl: ctx.fwCtl,
      govCtl: ctx.govCtl,
    };
  },

  /** Der Blasenbeitrag hängt von der Abschaltreserve ab -- deshalb ein Haken. */
  reactivity(sp) {
    return [
      {
        id: 'rods',
        fn: (s) => _rodReactivity(s, sp),
      },
      {
        id: 'void',
        fn: (s) => {
          const a = _voidCoeff(s, sp) * 1e-5;     // pcm/%Blasen → Δk/k
          return a * (s.alphaBar - sp.feedback.void_ref) * 100;
        },
      },
      {
        id: 'tip',
        fn: (s) => _tipReactivity(s, sp),
      },
    ];
  },

  trim(s, sp, ctx, rx) {
    const n = s.n;
    const P = sp.P0_th * n;
    s.W_core = sp.mcp.W0;
    s.p_drum = sp.drum.p0;
    s.p_prim = sp.drum.p0;

    const Tsat = tsat(s.p_drum);
    s.W_steam = (P * 1000) / (hg(s.p_drum) - H_FW);
    s.W_fw = s.W_steam;
    s.W_fwDemand = s.W_fw;
    s.W_fwMain = s.W_fw;
    s.W_fwAux = 0;
    s.dTsub = _subcooling(s, sp);
    s.T_ci = Tsat - s.dTsub;
    s.T_co = Tsat;
    s.T_mod = Tsat;
    s.x_e = clamp(s.W_steam / s.W_core, 0, 1);
    s.P_th = P;
    s.alphaBar = _void(s, sp);
    ctx.voidLag.set(s.alphaBar);

    // Graphit im Gleichgewicht: was hineingeht, geht auch wieder heraus.
    s.T_gr = Tsat + (P * 1000 * sp.graphite.powerFraction) / sp.graphite.UA;

    // Bezugstemperatur der Brennstoffkette ist die MITTLERE Kuehlmittel-
    // temperatur, so wie die Engine sie im Rechenschritt bildet -- nicht die
    // Saettigungstemperatur. Der Unterschied betraegt nur die halbe
    // Unterkuehlung, aber er landet unverduennt in der Doppler-Rueckkopplung,
    // und beim RBMK mit seinem fast neutralen Leistungskoeffizienten wurden
    // daraus fuenf Prozent Leistungssprung in der ersten Minute.
    const Tbase = Tsat - 0.5 * s.dTsub;
    s.T_cl = Tbase + (P * 1000 * sp.fuel.depositFraction) / ctx.UA_cc;
    s.T_f = s.T_cl + (P * 1000 * sp.fuel.depositFraction) / ctx.UA_fc;

    if (ctx.cold) {
      // Kaltstart: alle Staebe drin stehen lassen statt auf Kritikalitaet zu
      // suchen -- volle Abschaltreserve, der Spieler zieht selbst.
      for (let i = 0; i < s.rod.length; i++) { s.rod[i] = 1; s.rodDmd[i] = 1; }
      rx.compute(s, sp);
    } else {
      // Kritisch über die Stabstellung. Beide Gruppen werden gemeinsam
      // gefahren, damit die Abschaltreserve ein sinnvoller Mittelwert bleibt.
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        s.rod[0] = mid; s.rod[1] = mid;
        if (rx.compute(s, sp) > 0) lo = mid; else hi = mid;
      }
      const h = 0.5 * (lo + hi);
      s.rod[0] = h; s.rod[1] = h;
      s.rodDmd[0] = h; s.rodDmd[1] = h;
    }

    ctx.powerCtl.setpoint = n;

    // Axiales Profil ins Gleichgewicht setzen.
    s.ao = _axialTarget(s, sp);
    ctx.aoLag.set(s.ao);
    rx.compute(s, sp);

    s.P_e = (s.W_steam * (hg(s.p_drum) - hf(s.p_cond)) * sp.turbine.workFactor) / 1000;
    s.P_demand = s.P_e;
    ctx.fwCtl.pi.preset(0);
  },

  /** Siedender Kanal wie beim Siedewasserreaktor, plus der Graphitknoten. */
  coreCoolant(s, sp, ctx, qCoolKW, h) {
    const Tsat = tsat(s.p_drum);
    s.T_co = Tsat;
    s.T_mod = Tsat;
    s.T_ci = relax(s.T_ci, Tsat - s.dTsub, h, 4.0);

    const W = Math.max(s.W_core, 1);
    const qSub = W * sp.coolant.cp * Math.max(Tsat - s.T_ci, 0);
    const qBoil = Math.max(qCoolKW - qSub, 0);
    s.x_e = clamp(qBoil / (W * hfg(s.p_drum)), 0, 1);

    const collapse = sp.drum.voidCollapse * ctx.dpLag.v;
    s.alphaBar = ctx.voidLag.step(clamp(_void(s, sp) - collapse, 0, 0.95), h);

  },

  directHeat(s, sp, ctx, deposited, h) {
    // Store the non-fuel deposit in graphite; only its released heat reaches
    // the coolant. Do not count the same energy twice.
    const Tsat = tsat(s.p_drum);
    const C_gr = (sp.graphite.mass_t * 1000 * sp.graphite.cp) / 1000;   // kJ/K
    const before = s.T_gr;
    const graphiteDeposit = Math.min(deposited, s.P_th * 1000 * sp.graphite.powerFraction);
    s.T_gr = relax(before, Tsat + graphiteDeposit / sp.graphite.UA, h, C_gr / sp.graphite.UA);
    return deposited - C_gr * (s.T_gr - before) / h;
  },

  heatTransfer(s, sp) {
    return transferFraction(_cpr(s, sp, { load: s.P_th / sp.P0_th }),
      coverage(s.M_drum, sp.drum.mass * 0.55, 20000));
  },

  stepLoop(s, sp, ctx, dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // ── Turbogenerator-Auslauf ──────────────────────────────────────────────
    // Geschlossene Loesung von dw/dt = -w^2/tau, siehe sp.turbogen. Laeuft
    // nur waehrend eines Auslaufversuchs; sonst haelt das Netz die Drehzahl.
    if (s.tgCoasting) {
      const tau = sp.turbogen.tau_s;
      s.tgSpeed = s.tgSpeed / (1 + (dt * s.tgSpeed) / tau);
    } else {
      s.tgSpeed = 1;
    }

    // ── Hauptumwälzpumpen ───────────────────────────────────────────────────
    // Die letzten `coastdownPumps` haengen am Turbogenerator und verlieren mit
    // ihm die Drehzahl; die uebrigen bleiben am Netz. Die beiden, die vor dem
    // Versuch stillstehen, sind bewusst die ERSTEN (siehe
    // chernobylTutorial.js prepare()) -- die beiden zusaetzlich zugeschalteten
    // gehoeren damit zum Netzteil, so wie die vier Testpumpen historisch
    // eigens fuer den Versuch ausgewaehlt waren.
    const onRotor = ctx.mcp.length - sp.turbogen.coastdownPumps;
    let W = 0;
    for (let i = 0; i < ctx.mcp.length; i++) {
      const p = ctx.mcp[i];
      p.demand = clamp(s.mcpDmd * (i >= onRotor ? s.tgSpeed : 1), 0, 1.1);
      // Helpers and direct replay calls must not restart a failed pump for a tick.
      if (ctx.pumpsStuck?.has(i)) p.trip();
      p.step(dt);
      W += p.flow(0.06);
    }
    s.W_core = W;

    if (s.auxFeedInstalled || s.fwSupplyMax < 1.3 * sp.drum.W_steam0) {
      s.W_fwMain = Math.min(s.W_fwDemand, s.fwSupplyMax);
      s.W_fwAux = s.auxFeedInstalled && s.auxFeedAvailable && s.auxFeedOn
        ? Math.min(s.auxFeedDmd * sp.auxFeed.maxFlow, s.auxWaterKg / dt) : 0;
      // On the last partial step avoid a rounding residue from (water / dt) * dt.
      s.auxWaterKg = s.W_fwAux === s.auxWaterKg / dt ? 0
        : Math.max(0, s.auxWaterKg - s.W_fwAux * dt);
      // Both supplies use H_FW (165 C): a deliberate common-enthalpy abstraction.
      s.W_fw = s.W_fwMain + s.W_fwAux;
    } else {
      // Preserve the legacy W_fw alias and controller timing when inactive.
      s.W_fwDemand = s.W_fw;
      s.W_fwMain = s.W_fw;
      s.W_fwAux = 0;
    }
    s.coolantHeatMW = s.coolantHeatKJ / dt / 1000;

    // ── Dampfabgabe ─────────────────────────────────────────────────────────
    ctx.govValve.demand = s.turbineTripped ? 0 : s.gov;
    ctx.govValve.step(dt);
    ctx.bypassValve.demand = s.bypass;
    ctx.bypassValve.step(dt);

    const dp = Math.max(s.p_drum - s.p_cond, 0);
    const rhoS = rhog(s.p_drum);
    let W_t = ctx.govValve.flow(sp.turbine.Cv, rhoS, dp);
    let W_bp = ctx.bypassValve.flow(sp.turbine.bypassCv, rhoS, dp);
    s.srv = s.p_drum > 75 ? clamp((s.p_drum - 75) / 3, 0, 1) : 0;
    const requested = W_t + W_bp + s.srv * 700;
    s.W_steam = availableSteam({ mass: s.M_drum, feed: s.W_fw, requested, dt,
      pressure: s.p_drum, cp: sp.drum.cp, metalCapacity: sp.drum.mass * sp.drum.cp * 0.05,
      heat: s.coolantHeatKJ / dt, feedEnthalpy: H_FW });
    const scale = requested > 0 ? s.W_steam / requested : 0;
    W_t *= scale; W_bp *= scale;

    // ── Trommeldruck ────────────────────────────────────────────────────────
    const balance = saturatedPressure({ pressure: s.p_drum, mass: s.M_drum,
      cp: sp.drum.cp, metalCapacity: sp.drum.mass * sp.drum.cp * 0.05,
      heat: s.coolantHeatKJ / dt, feed: s.W_fw, feedEnthalpy: H_FW,
      steam: s.W_steam, dt });
    const pNew = balance.pressure;
    s.pressureClipKJ = balance.rejectedKJ;
    ctx.dpLag.step((pNew - ctx.pPrev) / dt, dt);
    ctx.pPrev = pNew;
    s.p_drum = pNew;
    s.p_prim = s.p_drum;

    // ── Trommelfüllstand ────────────────────────────────────────────────────
    s.M_drum = Math.max(s.M_drum + (s.W_fw - s.W_steam) * dt, 0);
    const Ltrue = clamp(0.5 + (s.M_drum - sp.drum.mass) / sp.drum.massSpan, 0, 1);
    s.L_drum = clamp(Ltrue + coverage(s.M_drum, sp.drum.mass) * sp.drum.shrinkSwell * (sp.drum.p0 - s.p_drum) / sp.drum.p0, 0, 1);

    s.dTsub = _subcooling(s, sp);

    // ── Axiales Flussprofil und zonenweise Vergiftung ───────────────────────
    // Die Zonen sehen unterschiedliche Leistung. Daraus wächst die Vergiftung
    // ungleich, daraus kippt das Profil, und daraus entstehen die axialen
    // Xenon-Schwingungen, für die dieser Reaktortyp bekannt ist.
    const fBot = 1 + s.ao;
    const fTop = 1 - s.ao;
    stepPoisons(s.zTop, s.n * fTop, dt);
    stepPoisons(s.zBot, s.n * fBot, dt);
    s.ao = ctx.aoLag.step(_axialTarget(s, sp), dt);

    // ── Turbine und Netz ────────────────────────────────────────────────────
    s.p_cond = clamp(psat(sp.condenser.T_cw + sp.condenser.pinch
      + (sp.condenser.rise || 12) * clamp(s.W_steam / sp.drum.W_steam0, 0, 1.2)), 0.02, 1.5);
    const wSpec = (hg(s.p_drum) - hf(s.p_cond)) * sp.turbine.workFactor;
    s.P_e = s.breaker && !s.turbineTripped ? (W_t * wSpec) / 1000 : 0;
  },

  stepControls(s, sp, ctx, dt) {
    if (!s.scram.active) {
      const d = ctx.powerCtl.step(s.n, dt);
      if (d !== 0) {
        s.rodDmd[0] = clamp(s.rodDmd[0] + d, 0, 1);
        s.rodDmd[1] = clamp(s.rodDmd[1] + d, 0, 1);
      }
    }
    s.W_fwDemand = ctx.fwCtl.step(s.L_drum, s.W_steam, dt);
    if (!s.auxFeedInstalled && s.fwSupplyMax >= 1.3 * sp.drum.W_steam0) s.W_fw = s.W_fwDemand;
    s.gov = ctx.govCtl.step(s.P_e, s.P_demand, s.p_drum, dt);
    s.bypass = s.p_drum > sp.drum.p0 + 4 ? clamp((s.p_drum - sp.drum.p0 - 4) / 6, 0, 1) : 0;
  },

  /** Retain history for old saves; worth uses current geometry. */
  onScram(s, sp, ctx) {
    for (let i = 0; i < s.rod.length; i++) {
      s.tipArmed[i] = s.rod[i] < sp.tip.outThreshold ? 1 : 0;
    }
    s.az5 = { armed: true, t: s.t_sim };
    s.turbineTripped = true;
    ctx.govCtl.trip();
    s.gov = 0;
    s.breaker = false;
  },

  uiControls(s, sp, ctx, kit) {
    const mcp = kit.slider({
      labelKey: 'ctl_mcp', min: 40, max: 110, step: 1,
      value: Math.round(s.mcpDmd * 100), digits: 0, unitKey: 'unit_percent',
      onInput: (v) => { s.mcpDmd = v / 100; },
    });
    // Always register callbacks: replay builds its kit before Session.start().
    const auxFeed = kit.buttonGroup('ctl_rbmk_aux_feed', [
      { key: 'state_off', value: '0' }, { key: 'state_on', value: '1' },
    ], s.auxFeedOn ? '1' : '0', (v) => {
      if (v !== '0' && v !== '1' && v !== 0 && v !== 1) return;
      if (!s.auxFeedInstalled) return;
      if (v === '0' || v === 0) s.auxFeedOn = false;
      else if (s.auxFeedAvailable) s.auxFeedOn = true;
    });
    const auxFlow = kit.slider({
      labelKey: 'ctl_rbmk_aux_flow', min: 0, max: 100, step: 1,
      value: Math.round(s.auxFeedDmd * 100), digits: 0, unitKey: 'unit_percent',
      onInput: (v) => {
        if (s.auxFeedInstalled && Number.isFinite(v) && v >= 0 && v <= 100) s.auxFeedDmd = v / 100;
      },
    });
    return [
      { mount: 'primary', node: mcp.node, set: (st) => mcp.set(Math.round(st.mcpDmd * 100)) },
      ...(s.auxFeedInstalled ? [
        { mount: 'safety', node: auxFeed.node, set: (st) => auxFeed.set(st.auxFeedOn ? '1' : '0') },
        { mount: 'secondary', node: auxFlow.node, set: (st) => auxFlow.set(Math.round(st.auxFeedDmd * 100)) },
      ] : []),
    ];
  },

  togglePump(s, sp, ctx, i) {
    const p = ctx.mcp[i];
    if (!p) return;
    if (ctx.pumpsStuck?.has(i)) { p.trip(); return; }
    if (p.state === 'run') p.trip(); else p.start();
  },

  derived(s, sp, ctx, base) {
    return {
      p_sg: s.p_drum,
      L_sg: s.L_drum,
      W_steam: s.W_steam,
      W_fw: s.W_fw,
      W_fwDemand: s.W_fwDemand,
      W_fwMain: s.W_fwMain,
      W_fwAux: s.W_fwAux,
      fwSupplyMax: s.fwSupplyMax,
      auxWaterKg: s.auxWaterKg,
      auxFeedAvailable: s.auxFeedAvailable,
      inventoryRateKgS: s.W_fwMain + s.W_fwAux - s.W_steam,
      graphiteHeatMW: sp.graphite.UA * (s.T_gr - tsat(s.p_drum)) / 1000,
      coolantHeatMW: s.coolantHeatMW,
      gov: s.gov,
      bypass: s.bypass,
      p_cond: s.p_cond,
      voidFrac: s.alphaBar,
      quality: s.x_e,
      subcooling: s.dTsub,
      orm: _orm(s, sp),
      voidCoeff: _voidCoeff(s, sp),
      axialOffset: s.ao,
      T_gr: s.T_gr,
      tip_pcm: _tipReactivity(s, sp) * 1e5,
      dnbr: _cpr(s, sp, base),
      shutdownMargin: sp.rodBanks.reduce((a, b, i) => a + b.worth * (1 - s.rod[i]), 0),
      pumpStates: ctx.mcp.map((p) => p.state),
      // Siehe pwr.js: unterscheidet ausgefallen (Ereignis, Knopf gesperrt)
      // von selbst abgeschaltet (Spieler, Knopf bleibt bedienbar).
      pumpStuckList: ctx.mcp.map((_, i) => !!(ctx.pumpsStuck && ctx.pumpsStuck.has(i))),
    };
  },
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/**
 * Abschaltreserve in Stabäquivalenten.
 *
 * Der Betrieb zählt sie in Stäben, nicht in pcm -- und genau deshalb steht sie
 * hier auch so. Nominal 46 von 211, betriebliches Minimum 30. In der Nacht des
 * 26. April 1986 waren es sechs bis acht.
 *
 * Gezählt wird über die volle Wirksamkeitskurve (rodWorthCurve, h=0..1), NICHT
 * über die um tip.span verschobene Absorberkurve aus _rodReactivity: die
 * Betriebskennzahl OZR ist eine physikalisch berechnete, glatte Groesse ueber
 * den gesamten Fahrweg -- kein Vorlauf-Nullbereich wie die Graphitspitze ihn
 * fuer die MOMENTANE Reaktivitaet erzwingt. Mit der um tip.span verschobenen
 * Kurve waere jede Stabstellung innerhalb der Spitzenspanne ORM=0, ganz gleich
 * ob h=0,02 oder h=0,17 -- der Blasenkoeffizient stuende dort ausnahmslos auf
 * seinem schlimmsten Wert, und die historische ORM=6-8 (die echte Reaktoren
 * bei WEIT, aber nicht ganz gezogenen Staeben erreichten) waere in diesem
 * Modell gar nicht erreichbar, ohne die Anlage sofort instabil zu machen.
 */
function _orm(s, sp) {
  let sum = 0;
  for (let i = 0; i < sp.rodBanks.length; i++) {
    sum += (sp.rodBanks[i].rods || 0) * rodWorthCurve(clamp(s.rod[i], 0, 1));
  }
  return sum;
}

/**
 * Dampfblasenkoeffizient in pcm je Prozentpunkt Blasenanteil.
 *
 * Er ist immer positiv und wird mit sinkender Abschaltreserve schlimmer: jeder
 * gezogene Absorberstab ist ein Stück Absorber weniger, das den Effekt des
 * verschwindenden Wassers dämpft. Bei nominal 46 Stäben sind es 20 pcm je
 * Prozentpunkt, bei leerem Kern über 60.
 */
function _voidCoeff(s, sp) {
  const orm = _orm(s, sp);
  // Oberhalb der nominalen Abschaltreserve wird der Koeffizient nicht weiter
  // besser -- ohne diese Begrenzung waere er bei vollstaendig eingefahrenen
  // Staeben rechnerisch negativ, und der gefaehrlichste Kennwert dieses
  // Reaktortyps haette sich stillschweigend in eine Sicherheit verwandelt.
  const f = clamp(orm / sp.orm.nominal, 0, 1);
  const a0 = sp.feedback.void_pcm_per_pct_nominal;
  const a1 = sp.feedback.void_pcm_per_pct_depleted;
  return a1 + (a0 - a1) * f;
}

/**
 * Absorberwirksamkeit der Stäbe -- anders als die generische Kurve (siehe
 * reactivity.js: rodWorthCurve) NICHT ab h=0 wirksam.
 *
 * Der Absorber (Bor) sitzt hinter 4,5 m Graphitverdränger. Solange ein
 * gezogener Stab noch im ersten Stück seines Fahrwegs steckt (0 bis
 * `tip.span`, dieselbe Wassersäule wie in _tipReactivity), schiebt er dort
 * NUR Graphit -- kein Absorber erreicht in dieser Phase den Kern. Erst
 * danach beginnt die eigentliche Abschaltwirkung, und zwar über den
 * VERBLEIBENDEN Fahrweg (span bis 1), nicht ueber die volle Strecke.
 *
 * Ohne diese Trennung faengt rodWorthCurve(h) schon ab h=0 an, Reaktivitaet
 * abzuziehen (kleine, aber nicht null Steigung dort) -- das hebt einen
 * grossen Teil dessen wieder auf, was _tipReactivity in genau diesem
 * Fahrwegabschnitt hinzufuegt, und der positive Schnellabschalteffekt bleibt
 * ein Rechenartefakt statt sich wie in der Literatur beschrieben (INSAG-7)
 * als klar positiver Nettoeffekt in den ersten Sekunden zu zeigen.
 */
function _rodReactivity(s, sp) {
  const span = sp.tip.span;
  const banks = sp.rodBanks;
  let r = 0;
  for (let i = 0; i < banks.length; i++) {
    const h = s.rod[i];
    const x = h <= span ? 0 : (h - span) / (1 - span);
    r -= banks[i].worth * 1e-5 * rodWorthCurve(x);
  }
  return r;
}

/** Reduced displacer worth over the initial 1.25 m of a 7 m core. */
function _tipReactivity(s, sp) {
  // Reduced geometric shape: identical positions/profile have identical worth,
  // whether reached by normal drive or AZ-5. No button-triggered reactivity.
  const span = sp.tip.span;
  const fBot = clamp(1 + s.ao, 0, 2);
  let tip = 0;
  for (const h of s.rod) {
    if (h > 0 && h < span) tip += Math.sin(Math.PI * h / span);
  }
  return sp.tip.worth_pcm * fBot * tip * 1e-5;
}

/**
 * Zielwert des axialen Flussprofils.
 *
 * Ein einzonales Punktkinetikmodell kennt keine Achse. Statt die Engine auf
 * zwei Zonen umzubauen -- was alle drei Reaktortypen beträfe, obwohl nur einer
 * es braucht -- wird die Verteilung als eigener, langsamer Zustand geführt:
 * der Unterschied der Reaktivität zwischen oben und unten, geteilt durch eine
 * Steifigkeit. Xenon oben verschiebt den Fluss nach unten, eingefahrene Stäbe
 * (sie kommen von oben) ebenfalls.
 */
function _axialTarget(s, sp) {
  const wXe = sp.feedback.xenon_worth_pcm;
  const dXe = ((s.zTop ? s.zTop.X : 0) - (s.zBot ? s.zBot.X : 0)) * wXe;
  let meanRod = 0;
  for (let i = 0; i < s.rod.length; i++) meanRod += s.rod[i];
  meanRod /= Math.max(s.rod.length, 1);
  const push = sp.axial.rodPush_pcm * meanRod;
  return clamp((dXe + push) / sp.axial.stiffness_pcm, -0.5, 0.5);
}

function _subcooling(s, sp) {
  const W = Math.max(s.W_core, 1);
  const Wfw = clamp(s.W_fw, 0, W);
  const hSat = hf(s.p_drum);
  const hMix = (Wfw * H_FW + (W - Wfw) * hSat) / W;
  return clamp((hSat - hMix) / sp.coolant.cp, 0, 80);
}

function _void(s, sp) {
  const W = Math.max(s.W_core, 1);
  const G = W / sp.coolant.flowArea_m2;
  const qPerKg = (s.P_th * 1000) / W;
  const subPerKg = sp.coolant.cp * s.dTsub;
  const fBoil = clamp(1 - subPerKg / Math.max(qPerKg, 1e-3), 0.05, 0.98);
  return averageVoid(s.x_e, s.p_drum, G, fBoil);
}

function _cpr(s, sp, base) {
  const flow = clamp(s.W_core / sp.mcp.W0, 0.05, 1.3);
  const power = clamp(base.load, 0.02, 2);
  const q = clamp(1 - s.x_e / 0.30, 0.05, 1);
  return clamp(1.8 * Math.pow(flow, 0.5) * Math.pow(q, 0.35) / power, 0, 20);
}

export default { spec, hooks };
