// Siedewasserreaktor.
//
// 3840 MWth / 1344 MWe, ein Kreislauf: der im Kern erzeugte Dampf geht direkt
// zur Turbine. Kein Dampferzeuger, kein Druckhalter, kein Bor im Betrieb.
//
// Das Spielprinzip ist ein anderes als beim Druckwasserreaktor. Dort stellt
// die Turbine die Leistung und der Kern folgt. Hier ist es umgekehrt: das
// Regelventil hält den Dampfdruck konstant, und die Leistung macht der Kern --
// über den Umwälzstrom. Mehr Durchsatz schwemmt die Dampfblasen aus, mehr
// Moderator heißt mehr Reaktivität, und die Leistung steigt binnen Sekunden.
// Zwischen 60 und 110 % Durchsatz liegen rund 30 % Leistung, ohne dass ein Stab
// sich bewegt.
//
// Der Preis dafür ist die Instabilität. Bei viel Leistung und wenig Durchsatz
// koppeln Dampfgehalt, Druckverlust und Durchsatz zu einer Dichtewelle, die
// sich aufschaukelt statt abzuklingen. Dieser Bereich ist im
// Leistungs-Durchsatz-Kennfeld gesperrt, und das Spiel bildet ihn nach.

import { Pump, Valve, Lag, coldStopPumps } from '../sim/components.js';
import { FeedwaterController, GovernorController, RodController } from '../sim/controllers.js';
import { tsat, psat, hg, hf, hfg, rhog, averageVoid } from '../sim/steam.js';
import { clamp, toK, relax } from '../sim/constants.js';
import { availableSteam, saturatedPressure, coverage, transferFraction } from '../sim/thermal.js';
import { SEVERITY } from '../sim/trips.js';

const P0 = 70.7;                     // bar, Domdruck
const T_FW = toK(216);
const H_FW = 4.2 * 216;              // kJ/kg

export const spec = {
  id: 'bwr',
  P0_th: 3840,
  P0_e: 1344,
  cycleEFPD: 500,

  beta: { boc: 0.0056, eoc: 0.0050 },
  Lambda: 4e-5,

  fuel: {
    mass_t: 140,
    cp: 300,
    tau: 6.0,
    depositFraction: 0.974,
    T_melt: 3120,
  },
  clad: { C_frac: 0.12, tau: 0.05, T_fail: 1477 },

  coolant: {
    W0: 13000,          // kg/s Kerndurchsatz bei Nennbedingungen
    cp: 4.9,
    T_in: tsat(P0) - 12,
    T_out: tsat(P0),
    p0: P0,
    mass: 20000,
    flowArea_m2: 10.0,  // fuer die Massenstromdichte im Drift-Flux-Modell
  },

  feedbacks: ['rods', 'doppler', 'void', 'xenon', 'samarium', 'excess'],

  feedback: {
    doppler_pcm_per_K: -2.0,
    doppler_T_ref: 1150,

    // Stark negativ -- das ist die Sicherheitsreserve dieses Typs und
    // gleichzeitig sein Regelorgan.
    void_pcm_per_pct: -100,
    // Blasenanteil im Nennbetrieb -- der Nullpunkt dieses Beitrags.
    void_ref: 0.385,

    xenon_worth_pcm: 2600,
    samarium_worth_pcm: 550,

    // Der Ueberschuss wird hier nicht von Bor gehalten, sondern von den
    // Staeben und vom abbrennbaren Gift im Brennstoff. Uebrig bleibt der
    // Anteil, den die Regelgruppe traegt -- gut 800 pcm bei Nennleistung.
    // trim() sucht deshalb die Stabstellung statt einer Borkonzentration.
    excess_pcm: 3900,
  },

  // Steuerstaebe fahren von UNTEN ein: oben sitzt der Dampfabscheider.
  // Fuer die Rechnung ist das gleichgueltig, fuer das Fliessbild nicht.
  rodBanks: [
    { id: 'ctrl', worth: 2600, speed: 0.008, initial: 0.35 },
    { id: 'sd', worth: 5200, speed: 0.008, initial: 0.0 },
  ],
  // Hydraulisch eingeschossen, gegen den Kerndruck.
  scram: { timeS: 2.7, labelKey: 'btn_scram_resa', titleKey: 'btn_scram_resa_title' },

  recirc: {
    W0: 13000,
    // Der Schieber endet bei 45 %, weil darunter der Betriebspunkt dieses
    // Modells nicht mehr am Durchsatz haengt (siehe BACKLOG.md, "SWR: der
    // Betriebspunkt unter 48 % Umwaelzstrom"). Ein PUMPENAUSFALL geht
    // trotzdem darunter -- uebrig bleiben 12 % Naturumlauf, und dort faellt
    // der Blasenanteil mit dem Massenstrom statt zu steigen (Driftterm in
    // voidFraction()). Gemessen mit tests/tools/bwr_recirc_trip.mjs: 371 %
    // Spitze und zerstoerter Brennstoff nach 8,9 s, also genau die falsche
    // Richtung. Deshalb gibt es zu rcp_trip kein SWR-Szenario.
    min: 0.45,
    max: 1.10,
    tau: 6,               // s, Hochlauf der Umwaelzpumpen
    coastTau: 5,
  },

  vessel: {
    p0: P0,
    mass: 180000,          // kg Wasserinventar im Druckbehaelter
    cp: 5.2,
    level0: 0.5,
    massSpan: 40000,
    shrinkSwell: 1.6,      // staerker als beim DWR: der Kern selbst siedet
    // Blasenkollaps je bar/s Druckanstieg. Bei einer Frischdampf-Absperrung
    // steigt der Druck mit rund 2,5 bar/s, das sind gut 4 Prozentpunkte
    // Blasenanteil und damit rund 400 pcm positive Reaktivitaet.
    voidCollapse: 0.017,
    // Kernfreilegung, siehe coreCoolant(). mUncoverStart liegt bewusst weit
    // unter der Anzeige-Untergrenze (L_rpv erreicht 0 schon bei 160 000 kg) --
    // der Bediener hat also Vorwarnzeit, bevor die Dampfkuehlung tatsaechlich
    // einsetzt. mUncoverFloor liegt knapp ueber dem Boden von M_rpv (20 000 kg).
    mUncoverStart: 90000,
    mUncoverFloor: 25000,
    // Obergrenze des Inventars: der Behaelter bis obenhin voll Wasser, ohne
    // Dampfraum. Mehr passt nicht hinein, ganz gleich wie lange gespeist wird.
    massMax: 260000,
    // Groesster Ausschlag, den Schrumpfen/Quellen auf der Anzeige erzeugen
    // darf. 0,25 entspricht einer Viertelskala -- deutlich sichtbar, wie es
    // der Effekt sein soll, aber nicht in der Lage, die Anzeige von "voll"
    // auf "leer" zu ziehen.
    swellMax: 0.25,
    T_fw: T_FW,
    W_steam0: 2059,
    subcool0: 12,
  },

  turbine: {
    Cv: 55,
    strokeS: 3,
    // So gewaehlt, dass 3840 MWth bei Nenndruck 1344 MWe ergeben -- der
    // Gesamtwirkungsgrad von 35 %, in einen Faktor gefasst.
    workFactor: 0.2477,
    bypassCv: 30,
    bypassStrokeS: 0.8,
  },

  condenser: { T_cw: toK(15), pinch: 6, rise: 12, p0: 0.05 },

  // Notkondensator (Isolation Condenser). Reiner Naturumlauf-Wärmetauscher:
  // Dampf aus dem Dom kondensiert in einem Vorratsbehälter oberhalb des
  // Kerns, das Kondensat läuft von selbst zurück -- keine Pumpe nötig. Er
  // schaltet sich bei Isolierung (SCRAM + geschlossene Frischdampf-
  // Absperrung) automatisch zu und schluckt die Nachzerfallswärme, solange
  // Vorrat und Gleichstrom für die Ventile reichen. W0 ist Dampf-Äquivalent
  // in kg/s, deutlich über der anfänglichen Nachzerfallswärme (~7 % P0_th)
  // ausgelegt -- genau deshalb hätte er im Original gereicht.
  ic: { W0: 130, enduranceS: 7200 },

  // Diesel-driven low-pressure injection with finite external water supply.
  fireInj: { W0: 35, shutoffBar: 12, supplyKg: 1000000 },

  // Notstromdiesel. Er traegt den Eigenbedarf, nicht das Netz: Schaltraum,
  // Leittechnik, Notspeisung -- nicht die Umwaelzpumpe und nicht die
  // Hauptspeisepumpen. Deshalb ist feedMax kein Bruchteil des Vollast-
  // speisestroms (2059 kg/s), sondern in derselben Groessenordnung wie der
  // Notkondensator (ic.W0 = 130): beide sind dafuer da, Nachzerfallswaerme
  // abzufuehren, und fuer nichts sonst. Unmittelbar nach der Abschaltung
  // (rund 7 % von P0_th, etwa 140 kg/s Dampf) reicht das knapp nicht -- ein
  // paar Minuten spaeter schon. Genau das ist die Aussage: der Diesel ist
  // ein Weg zurueck, kein Rueckgaengigmachen.
  //
  // startS ist die Anlaufzeit in Simulationssekunden. Kein Wuerfel, ob er
  // anspringt: ein Notstromdiesel, der mit einer Wahrscheinlichkeit
  // versagt, waere im selben Lauf einmal die Rettung und einmal nicht, und
  // der Spieler koennte aus keinem von beiden etwas lernen.
  diesel: { startS: 30, feedMax: 130 },

  // Sicherheitsbehälter (Druckkammer + Kondensationskammer). Baut sich aus
  // dem Sicherheitsventil-Dampf auf, der in die Kondensationskammer bläst --
  // genau der Pfad, über den bei einer Isolierung Wärme den Reaktor
  // überhaupt noch verlässt. capacity ist die Dampfmasse (kg-äquivalent),
  // die den Druck von p0 auf designLimit hebt.
  //
  // Der Wert ist von der Kondensationskammer her gerechnet und nicht geraten.
  // Sie fasst rund 3000 m³ Wasser; der Druck steigt nicht, weil sich Masse
  // ansammelt, sondern weil sich dieses Wasser aufheizt und irgendwann selbst
  // siedet. Von 30 °C bis zur Saettigung bei 4,3 bar (145 °C) sind das
  // 3·10⁶ kg · 4,2 kJ/kgK · 115 K = 1,45·10⁹ kJ, und bei rund 2770 kJ je
  // Kilogramm Dampf entspricht das etwa 520 000 kg.
  //
  // Vorher standen hier 60 000. Damit riss der Behaelter bei voll geoeffnetem
  // Sicherheitsventil (900 kg/s) nach 67 Sekunden -- solange die Verletzung
  // folgenlos blieb, fiel das niemandem auf; seit sie den Lauf beendet
  // (lossCriteria), waere es eine Falle statt einer Lektion gewesen. Mit dem
  // gerechneten Wert bleiben gut zehn Minuten, um zu reagieren.
  //
  // ventCv war mit 9 kg/s gegen 900 kg/s Zustrom ein Prozent -- Venten war
  // wirkungslos, obwohl die Hilfe es als die Rettung nennt. 60 kg/s liegt
  // ueber der Nachzerfallsverdampfung (rund 25 kg/s bei 1,5 %), also hilft
  // Venten an einem abgeschalteten Reaktor wirklich, und bleibt zugleich
  // chancenlos gegen einen Reaktor, der noch auf Leistung laeuft. Genau die
  // Reihenfolge, die die Hilfe beschreibt: erst abschalten, dann venten.
  containment: { p0: 1.05, capacity: 520000, designLimit: 4.3, ventCv: 60 },

  // Referenzschenkel der Fuellstandsmessung. Die Messung vergleicht den
  // Druck einer stehenden Wassersaeule (Referenzschenkel, oben mit einem
  // Kondensationsgefaess) mit dem Druck im Behaelter. Kocht diese Saeule
  // weg, faellt der Vergleichsdruck -- und das Geraet meldet MEHR Wasser,
  // als da ist. Sie kocht genau dann, wenn der Sicherheitsbehaelter heisser
  // ist als die Saettigung zum Reaktordruck; der Schenkel haengt am
  // Behaelterdruck, steht aber in der Behaelteratmosphaere. Im Normalbetrieb
  // (70 bar im Dom, rund 1 bar im Sicherheitsbehaelter) kann das nicht
  // passieren -- erst wenn der Reaktor abgesenkt und der Behaelter aufgeheizt
  // ist, kehrt sich das Verhaeltnis um. Genau diese Lage hatte Fukushima-1:
  // die Anzeige stand ueber der Kernoberkante, waehrend der Kern frei lag.
  //
  // dTmin ist der Abstand, ab dem ueberhaupt etwas passiert -- ohne ihn
  // trocknete der Schenkel auch beim Kaltstart langsam aus, wo Dom und
  // Sicherheitsbehaelter beide knapp ueber Umgebungsdruck stehen und die
  // Rechnung ein Grad Unterschied findet. dTfull ist die Differenz, bei der
  // dryoutS voll wirkt; darunter trocknet er entsprechend langsamer. biasMax
  // ist der Fehler bei ganz leerem Schenkel, in Anteilen der Skala.
  refLeg: { dryoutS: 1200, refillS: 2400, dTmin: 10, dTfull: 30, biasMax: 0.5 },

  // Wasserstoff aus der Zirkon-Wasser-Reaktion. Setzt oberhalb von 1200 °C
  // Hüllrohrtemperatur ein, lange bevor der Brennstoff selbst schmilzt --
  // historisch genau der Punkt, an dem Fukushima-1 die Hülle verlor, ohne
  // dass der Kern schon "zerstört" im Sinne der Enthalpie-Grenze war.
  h2: { onsetK: toK(1200), rate: 0.012 },

  // Instabilitaet: Kennzahl S = Leistung / relativer Durchsatz.
    // Ansprechwert der Schwingungsueberwachung. Bewusst bei 22 % und nicht bei
  // 30 %: der Grenzzyklus begrenzt sich zwar selbst -- die schwingende Leistung
  // treibt ueber den Blasenanteil die mittlere Leistung herunter, damit sinkt
  // die Kennzahl und die Schwingung klingt wieder ab -- aber er tut das erst
  // bei knapp 30 % Ausschlag. Darauf zu setzen waere kein Sicherheitskonzept.
  stability: { sThreshold: 1.2, drSlope: 1.2, drBase: 0.2, freqHz: 0.5, oprm: 0.22 },

  // Bei siedenden Kernen heisst die Kennzahl nicht DNBR, sondern CPR --
  // kritisches Leistungsverhaeltnis. Im Kern siedet es ohnehin ueberall;
  // gefragt ist, wieviel Leistung bis zur Austrocknung fehlt.
  marginKey: 'val_cpr',

  // Domdruck-Rundinstrument. Nennwert 70,7 bar, Auslösung bei 78,5 -- eigene
  // Skala statt der DWR-Vorgabe (100-180 bar), sonst stünde die Nadel im
  // sauberen Volllastbetrieb dauerhaft unten im roten Bereich.
  pressureGauge: { min: 40, max: 90, bands: [[40, 58, 'warn'], [58, 76, 'ok'], [76, 90, 'danger']] },

  // Welches Fließbild-Bauteil zu welcher Meldung gehört. Der Siedewasser-
  // reaktor zeichnet Kern, Fallraum und Dampfraum als EIN Bauteil (rpv) --
  // anders als beim Druckwasserreaktor gibt es hier keinen eigenen Druck-
  // halter oder Dampferzeuger, die das trennen würden.
  alarmComponents: {
    power_high: 'rpv', period_short: 'rpv', oprm: 'rpv', instability: 'rpv',
    dome_press_high: 'rpv', level_low: 'rpv', level_high: 'rpv', srv_open: 'srv', clad_temp: 'rpv',
    recirc_low: 'rcp',
    turbine_trip: 'gen', grid_lost: 'gen', grid_deviation_warn: 'gen', grid_deviation_trip: 'gen',
    cont_press_high: 'rpv', h2_critical: 'rpv',
  },

  mimic: 'mimic-bwr',

  trips: [
    { id: 'power_high', key: 'trip_power_high', severity: SEVERITY.TRIP,
      test: (s) => s.n > 1.18, delay_s: 0.3, action: 'scram' },
    // Zwei Sekunden Verzoegerung statt einer halben. In der Instabilitaetszone
    // schwingt die Leistung mit rund 0,5 Hz; die gemessene Periode geht dabei
    // in jedem Aufwaertsast kurz unter zehn Sekunden. Mit kurzer Verzoegerung
    // loeste deshalb die Periodenueberwachung aus, bevor die eigentlich
    // zustaendige Schwingungsueberwachung ueberhaupt ansprach -- und der
    // Spieler haette nie gesehen, was ihn erwischt hat.
    { id: 'period_short', key: 'trip_period_short', severity: SEVERITY.TRIP,
      test: (s, d) => s.n > 1e-3 && d.period > 0 && d.period < 10,
      delay_s: 2.0, action: 'scram' },
    // s.promptCritical kommt fertig aus der Kinetik (sim/kinetics.js: rho > beta).
    { id: 'prompt_critical', key: 'trip_prompt_critical', severity: SEVERITY.TRIP,
      test: (s) => s.promptCritical, delay_s: 0, action: 'scram' },
    { id: 'dome_press_high', key: 'trip_dome_press_high', severity: SEVERITY.TRIP,
      test: (s) => s.p_dome > 78.5, delay_s: 0.5, action: 'scram' },
    { id: 'level_low', key: 'trip_level_low', severity: SEVERITY.TRIP,
      test: (s) => s.L_rpv < 0.25, delay_s: 1.0, action: 'scram' },
    { id: 'level_high', key: 'alarm_level_high', severity: SEVERITY.WARN,
      test: (s) => s.L_rpv > 0.78, delay_s: 2.0 },
    { id: 'oprm', key: 'trip_oprm', severity: SEVERITY.TRIP,
      test: (s, d) => d.oscAmp > 0.22, delay_s: 0.2, action: 'scram' },
    { id: 'instability', key: 'alarm_instability', severity: SEVERITY.WARN,
      test: (s, d) => d.decayRatio > 0.8, delay_s: 1.0 },
    { id: 'recirc_low', key: 'alarm_recirc_low', severity: SEVERITY.WARN,
      test: (s, d) => s.W_core < 0.5 * 13000 && s.n > 0.4, delay_s: 1.0 },
    { id: 'msiv', key: 'alarm_msiv_closed', severity: SEVERITY.WARN,
      test: (s) => s.msiv < 0.5, delay_s: 0 },
    // Die Absperrung KLEMMT -- das ist etwas anderes als "sie ist zu". Der
    // Knopf "Offen" laesst sich druecken, stepEvents() schreibt die Stellung
    // im naechsten Rechenschritt zurueck, und der Spieler klickt ins Leere,
    // ohne dass ihm irgendetwas davon gesagt wird. Genau diese Leerstelle
    // machte die Hilfe zur Falle: sie nannte das Oeffnen als DIE Handlung.
    { id: 'msiv_stuck', key: 'alarm_msiv_stuck', severity: SEVERITY.WARN,
      test: (s, d) => !!d.msivStuck, delay_s: 0, hold_s: 0 },
    { id: 'srv_open', key: 'alarm_srv_open', severity: SEVERITY.INFO,
      test: (s) => s.srv > 0.01, delay_s: 0 },
    { id: 'turbine_trip', key: 'alarm_turbine_trip', severity: SEVERITY.WARN,
      test: (s) => s.turbineTripped, delay_s: 0 },
    // Offener Generatorschalter OHNE Turbinenschnellschluss -- der
    // Netzabwurf (loss_of_load in game/events.js setzt NUR s.breaker).
    // Bis 0.6.26 sah der Spieler davon nichts: keine Kachel, keine Hupe,
    // nur eine Zeile im Protokoll, die vorbeiscrollt -- waehrend die
    // Generatorleistung auf null faellt und dort bleibt. Genau so gemeldet
    // worden ("kam einfach so, kein Alarm nix").
    //
    // Die Bedingung schliesst turbineTripped aus, weil onScram() den
    // Schalter mit oeffnet: nach einer Schnellabschaltung steht schon
    // alarm_turbine_trip, und zwei Kacheln fuer dieselbe Ursache sind eine
    // zu viel. Diese hier meldet den Zustand, den sonst keine meldet.
    { id: 'grid_lost', key: 'alarm_grid_lost', severity: SEVERITY.WARN,
      test: (s) => s.breaker === false && !s.turbineTripped, delay_s: 0 },
    { id: 'clad_temp', key: 'trip_clad_temp', severity: SEVERITY.TRIP,
      test: (s) => s.T_cl > 1477, delay_s: 0, action: 'scram' },
    // Eine klemmende Stabgruppe war vorher nur eine Zeile im Protokoll. Der
    // Sollwert liess sich weiter verstellen, die Stellung folgte nicht, und
    // nichts sagte warum -- auch die Schnellabschaltung bekommt sie nicht
    // herunter. Das gehoert auf die Meldetafel, nicht ins Protokoll.
    { id: 'rod_stuck', key: 'alarm_rod_stuck', severity: SEVERITY.WARN,
      test: (s, d) => !!d.rodStuck, delay_s: 0, hold_s: 0 },
    { id: 'cont_press_high', key: 'alarm_cont_press_high', severity: SEVERITY.WARN,
      test: (s, d) => d.pCont !== undefined && d.pCont > 3.5, delay_s: 2.0 },
    { id: 'h2_critical', key: 'alarm_h2_critical', severity: SEVERITY.WARN,
      test: (s, d) => d.h2Mass !== undefined && d.h2Mass > 40, delay_s: 2.0 },
  ],
};

export const hooks = {
  extraState(s, sp, ctx) {
    s.p_dome = sp.vessel.p0;
    s.L_rpv = sp.vessel.level0;
    s.M_rpv = sp.vessel.mass;
    s.W_rec = sp.recirc.W0;
    s.recircDmd = 1.0;
    s.x_e = 0;
    s.alphaBar = sp.feedback.void_ref;
    s.dTsub = sp.vessel.subcool0;
    s.W_steam = sp.vessel.W_steam0;
    s.W_fw = sp.vessel.W_steam0;
    s.gov = 0.8;
    s.bypass = 0;
    s.srv = 0;
    s.msiv = 1;
    s.p_cond = sp.condenser.p0;
    s.turbineTripped = false;
    s.breaker = true;
    s.p_prim = sp.vessel.p0;
    s.P_demand = sp.P0_e;

    // Schwingungszustand der Dichtewelle.
    s.osc = 0;
    s.oscV = 0;

    // Stromversorgung -- im Normalbetrieb immer da. Eine Störung (Station-
    // Blackout) nimmt beides; ohne Gleichstrom fallen die
    // Notkondensator-Ventile in ihre sichere Stellung: ZU, unbemerkt, weil
    // dieselbe Störung auch die Anzeigen mitreißt.
    //
    // gridPower und acPower sind seit 0.6.23 zwei verschiedene Dinge.
    // acPower heisst "es liegt Wechselstrom an" und wird von allem gelesen,
    // was einen Motor oder eine Leittechnik braucht. gridPower heisst
    // "dieser Wechselstrom kommt aus dem Netz" -- und nur daran haengt, was
    // ein Notstromdiesel NICHT traegt. Ohne die Trennung waere der Diesel
    // ein Knopf, der die Störung zurücknimmt, statt einer, der die Anlage
    // in einen schwächeren, aber beherrschbaren Zustand bringt.
    //
    // ACHTUNG fuer alles, was den Strom nehmen will: acPower ist seit
    // 0.6.23 ABGELEITET. stepDiesel() bildet es jeden Rechenschritt neu aus
    // gridPower und dieselRun, ein direkt gesetztes acPower ist im naechsten
    // Takt wieder weg. Wer das Netz nehmen will, nimmt gridPower.
    s.gridPower = true;
    s.acPower = true;
    s.dcPower = true;

    // Notstromdiesel. dieselCmd ist die Bedienerabsicht, dieselRun der
    // laufende Diesel -- die beiden fallen während des Anlaufs auseinander,
    // und dieselT misst, wie weit er damit ist.
    s.dieselCmd = false;
    s.dieselT = 0;
    s.dieselRun = false;

    // Notkondensator. icDemand ist die Bedienerabsicht (Automatik/Auf per
    // Default), icOpen die tatsächliche Ventilstellung -- die beiden fallen
    // auseinander, sobald der Gleichstrom fehlt.
    s.icDemand = 1;
    s.icOpen = false;
    s.icWater = 1.0;

    // Löschwassereinspeisung: von Hand, ohne jede Elektronik.
    s.fireInjOn = false;
    s.fireWaterKg = sp.fireInj.supplyKg;
    s.depressurize = false;

    // Sicherheitsbehälter.
    s.contMass = 0;
    s.pCont = sp.containment.p0;
    s.contVentOpen = false;
    s.contFailed = false;

    // Fuellstand der Referenzsaeule (1 = voll). Siehe spec.refLeg.
    s.refLegFill = 1;

    // Wasserstoff aus der Hüllrohrreaktion, in kg (grobe Näherung).
    s.h2Mass = 0;
    s.h2BuildingMass = 0;
    s.h2ProducedKg = 0;
    s.h2Exploded = false;

    ctx.recircPump = new Pump({
      W0: sp.recirc.W0, coastTau: sp.recirc.coastTau, rampTau: sp.recirc.tau,
    });
    // Einheitliche Liste fuer typunabhaengigen Code (Spielstand) -- siehe
    // net/persist.js, das den Betriebszustand jeder Pumpe mitsichert.
    ctx.pumpList = [ctx.recircPump];
    // Kaltstart: Umwaelzpumpe steht, der Spieler schaltet sie selbst zu --
    // genauso wie er selbst die Staebe zieht. Nur Naturumlauf bis dahin.
    if (ctx.cold) coldStopPumps(ctx.recircPump);
    ctx.govValve = new Valve(sp.turbine.strokeS, 0.8);
    ctx.bypassValve = new Valve(sp.turbine.bypassStrokeS, 0);
    ctx.voidLag = new Lag(1.0, sp.feedback.void_ref);
    ctx.dpLag = new Lag(0.3, 0);     // geglaettete Druckaenderungsrate
    ctx.pPrev = sp.vessel.p0;
    ctx.decayRatio = 0.2;

    ctx.rodCtl = new RodController({
      tAvgLow: tsat(sp.vessel.p0), tAvgHigh: tsat(sp.vessel.p0), deadbandK: 99, bank: 0,
    });
    // Beim Siedewasserreaktor regelt die Stabgruppe nicht auf eine
    // Mitteltemperatur -- die ist durch den Druck festgenagelt. Die Automatik
    // ist deshalb aus; geregelt wird ueber den Umwaelzstrom.
    ctx.rodCtl.auto = false;
    // Kein Regler fuehrt hier die Staebe -- deshalb zeigt das Kern-Panel auch
    // keinen Automatik-Schalter dafuer. Das Stellglied ist der Umwaelzstrom.
    ctx.rodAutoCtl = null;

    ctx.fwCtl = new FeedwaterController({
      levelSet: sp.vessel.level0, W0: sp.vessel.W_steam0, kp: 2.0, ki: 0.04,
    });
    ctx.govCtl = new GovernorController({
      mode: 'pressure', pSet: sp.vessel.p0, P0: sp.P0_e, posNominal: 0.8,
      kp: 0.9, ki: 0.35, trim: 0.5,
    });

    // Was net/persist.js in den Spielstand mitpackt und beim Laden
    // zurueckschreibt. ctx.rodCtl fehlt bewusst -- der ist hier inaktiv
    // (auto immer false, kein Schalter greift ihn ueberhaupt an), das
    // Stellglied ist der Umwaelzstrom, nicht dieser Regler.
    ctx.saveable = {
      pumps: ctx.pumpList,
      govValve: ctx.govValve,
      bypassValve: ctx.bypassValve,
      voidLag: ctx.voidLag,
      dpLag: ctx.dpLag,
      fwCtl: ctx.fwCtl,
      govCtl: ctx.govCtl,
    };
  },

  trim(s, sp, ctx, rx) {
    const n = s.n;
    const P = sp.P0_th * n;
    s.W_core = sp.recirc.W0;
    s.W_rec = sp.recirc.W0;
    s.p_dome = sp.vessel.p0;
    s.p_prim = sp.vessel.p0;

    const Tsat = tsat(s.p_dome);
    s.W_steam = (P * 1000) / (hg(s.p_dome) - H_FW);
    s.W_fw = s.W_steam;
    s.dTsub = _subcooling(s, sp);
    s.T_ci = Tsat - s.dTsub;
    s.T_co = Tsat;
    s.T_mod = Tsat;
    s.x_e = clamp(s.W_steam / s.W_core, 0, 1);
    // P_th muss vor _void stehen: die Siedezone folgt aus dem Verhaeltnis von
    // zugefuehrter Waerme zu Unterkuehlung. Stand P_th hier noch auf null, kam
    // ein Blasenanteil von 2 % heraus statt 38 %, und der Kern startete fast
    // zwei Dollar ueberkritisch.
    s.P_th = P;
    s.alphaBar = _void(s, sp);
    ctx.voidLag.set(s.alphaBar);
    // Kein Nachziehen von sp.feedback.void_ref an dieser Stelle: die
    // Beitragsregistry hat den Bezugswert beim Bauen uebernommen, eine
    // spaetere Aenderung am gemeinsam genutzten Typdatenobjekt wirkt nicht
    // mehr -- und wuerde bei zwei gleichzeitigen Laeufen auch den anderen
    // treffen. Der Bezugswert steht fest in der Typdatei, der kleine
    // Restbeitrag wird von der Stabstellung aufgenommen.

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
      // Kaltstart: ALLE Bankstellungen drin stehen lassen, nicht nur die
      // Regelbank -- die Abschaltbank steht sonst auf ihrem Vollast-Anfangs-
      // wert (ganz draussen) und macht den Kern trotz eingefahrener Regelbank
      // deutlich UEBERkritisch. Der Spieler zieht selbst, bis er kritisch wird.
      for (let i = 0; i < s.rod.length; i++) { s.rod[i] = 1; s.rodDmd[i] = 1; }
      // _void() lieferte eben (Zeile 339) einen Blasenanteil nahe null, weil
      // bei n ≈ 0 noch nichts siedet -- witzigerweise genau der Fall aus dem
      // Kommentar oben ("startete fast zwei Dollar ueberkritisch"), nur ohne
      // den rettenden P_th-Ramp direkt danach. Der Bezugswert der Rueck-
      // kopplung gilt fuer Betrieb bei Nennlast, nicht fuer einen Kern, der
      // noch gar nicht kritisch ist -- deshalb hier auf den Referenzwert
      // zurueckgesetzt, denselben, den extraState() schon als Anfangswert
      // eingetragen hatte. Sobald der Spieler den Kern hochfaehrt, uebernimmt
      // wieder die echte Formel.
      s.alphaBar = sp.feedback.void_ref;
      ctx.voidLag.set(s.alphaBar);
      rx.compute(s, sp);
    } else {
      // Kritisch wird hier ueber die Stabstellung, nicht ueber Bor. Die
      // Stabwirksamkeit ist nicht linear (S-Kurve), also Bisektion statt
      // Division.
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        s.rod[0] = mid;
        // Mehr Einfahrt heisst weniger Reaktivitaet.
        if (rx.compute(s, sp) > 0) lo = mid; else hi = mid;
      }
      s.rod[0] = 0.5 * (lo + hi);
      s.rodDmd[0] = s.rod[0];
      rx.compute(s, sp);
    }

    s.P_e = (s.W_steam * (hg(s.p_dome) - hf(s.p_cond)) * sp.turbine.workFactor) / 1000;
    s.P_demand = s.P_e;
    ctx.fwCtl.pi.preset(0);
  },

  /**
   * Siedender Kern: die Austrittstemperatur ist die Sättigungstemperatur, die
   * Wärme geht in den Dampfgehalt. Läuft in den Kinetik-Untertakten.
   */
  coreCoolant(s, sp, ctx, qCoolKW, h) {
    const Tsat = tsat(s.p_dome);

    // No temperature target above saturation: heat originates in the fuel.
    // The cladding transfer coefficient handles loss of wetted area.
    s.T_co = relax(s.T_co, Tsat, h, 3);
    s.T_mod = Tsat;
    s.T_ci = relax(s.T_ci, Tsat - s.dTsub, h, 3);

    const W = Math.max(s.W_core, 1);
    const qSub = W * sp.coolant.cp * Math.max(Tsat - s.T_ci, 0);
    const qBoil = Math.max(qCoolKW - qSub, 0);
    s.x_e = clamp(qBoil / (W * hfg(s.p_dome)), 0, 1);

    // Blasenkollaps bei schneller Druckerhoehung.
    //
    // Die quasistationaere Bilanz oben sieht nur das Gleichgewicht: so viel
    // Waerme, so viel Dampf. Sie kann nicht sehen, dass ein schneller
    // Druckanstieg den bereits vorhandenen Dampf zusammendrueckt und teilweise
    // kondensiert -- der Dampfinhalt des Kerns kann sich in Sekundenbruchteilen
    // gar nicht so aendern, wie die Bilanz es vorgibt.
    //
    // Genau dieser Effekt ist die klassische Druckstoerung des
    // Siedewasserreaktors: Frischdampf absperren, Druck steigt, Blasen fallen
    // zusammen, mehr Moderator, POSITIVE Reaktivitaet. Ohne den Term ging in
    // der ersten Fassung die Leistung bei einer Absperrung zurueck statt hoch --
    // der Reaktor haette sich falsch herum verhalten, und zwar bei genau der
    // Stoerung, fuer die dieser Typ bekannt ist.
    const collapse = sp.vessel.voidCollapse * ctx.dpLag.v;
    s.alphaBar = ctx.voidLag.step(clamp(_void(s, sp) - collapse, 0, 0.95), h);
  },

  heatTransfer(s, sp) {
    return transferFraction(_cpr(s, sp, { load: s.P_th / sp.P0_th }),
      coverage(s.M_rpv, sp.vessel.mUncoverStart, sp.vessel.mUncoverFloor));
  },

  stepLoop(s, sp, ctx, dt) {
    stepDiesel(s, sp, dt);
    if (!s.acPower) s.W_fw = Math.min(fireInjectionFlow(s, sp), s.fireWaterKg / dt);
    s.W_fw = Math.min(s.W_fw, Math.max(0, (sp.vessel.massMax - s.M_rpv) / dt));
    if (!s.acPower) s.fireWaterKg = Math.max(0, s.fireWaterKg - s.W_fw * dt);
    // ── Umwaelzstrom ────────────────────────────────────────────────────────
    ctx.recircPump.demand = clamp(s.recircDmd, 0, sp.recirc.max);
    ctx.recircPump.step(dt);
    s.W_rec = ctx.recircPump.flow(0.12);   // Naturumlauf bleibt

    // ── Dichtewelleninstabilitaet ───────────────────────────────────────────
    // Kennzahl: viel Leistung bei wenig Durchsatz. Daraus ein Abklingverhaeltnis
    // und daraus die Daempfung eines Schwingers zweiter Ordnung bei 0,5 Hz.
    // Ueber 1 wird die Daempfung negativ und die Schwingung waechst.
    const st = sp.stability;
    const flowRel = Math.max(s.W_rec / sp.recirc.W0, 0.05);
    const S = s.n / flowRel;
    const DR = clamp(st.drBase + st.drSlope * Math.max(0, S - st.sThreshold), 0.05, 1.4);
    ctx.decayRatio = DR;
    const lnDR = Math.log(DR);
    const zeta = -lnDR / Math.sqrt(4 * Math.PI * Math.PI + lnDR * lnDR);
    const w = 2 * Math.PI * st.freqHz;
    // Anregung: das Rauschen des siedenden Kerns. Ohne sie bliebe eine
    // instabile Anlage rechnerisch still stehen.
    const noise = (ctx.rng ? ctx.rng.normal() : 0) * 0.004;
    s.oscV += (-2 * zeta * w * s.oscV - w * w * s.osc + noise * w * w) * dt;
    s.osc = clamp(s.osc + s.oscV * dt, -0.6, 0.6);

    s.W_core = Math.max(s.W_rec * (1 + s.osc), 100);

    // ── Dampfabgabe ─────────────────────────────────────────────────────────
    ctx.govValve.demand = (s.turbineTripped || s.msiv < 0.5) ? 0 : s.gov;
    ctx.govValve.step(dt);
    ctx.bypassValve.demand = s.msiv < 0.5 ? 0 : s.bypass;
    ctx.bypassValve.step(dt);

    const dp = Math.max(s.p_dome - s.p_cond, 0);
    const rhoS = rhog(s.p_dome);
    let W_t = ctx.govValve.flow(sp.turbine.Cv, rhoS, dp);
    let W_bp = ctx.bypassValve.flow(sp.turbine.bypassCv, rhoS, dp);

    // Sicherheitsventile: blasen in die Kondensationskammer, nicht zur Turbine.
    s.srv = s.depressurize && s.dcPower ? 1
      : (s.p_dome > 78 ? clamp((s.p_dome - 78) / 3, 0, 1) : 0);
    let W_srv = s.srv * 900;
    const requested = W_t + W_bp + W_srv;
    const actual = availableSteam({ mass: s.M_rpv, feed: s.W_fw, requested, dt,
      pressure: s.p_dome, cp: sp.vessel.cp, metalCapacity: sp.vessel.mass * sp.vessel.cp * 0.05,
      heat: s.coolantHeatKJ / dt, feedEnthalpy: s.acPower ? H_FW : 4.2 * 20 });
    const scale = requested > 0 ? actual / requested : 0;
    W_t *= scale; W_bp *= scale; W_srv *= scale;
    s.W_steam = actual;

    // ── Notkondensator ──────────────────────────────────────────────────────
    // Automatik will ihn offen, sobald isoliert wurde (SCRAM + Frischdampf
    // zu) und noch Vorrat da ist -- der Bediener kann das mit icDemand
    // uebersteuern. Die tatsaechliche Ventilstellung braucht zusaetzlich
    // Gleichstrom: fehlt er, faellt das Ventil in seine sichere Stellung
    // (ZU) und bleibt dort, ganz gleich was die Automatik will. Das ist die
    // Kernstoerung von Fukushima-1 -- unbemerkt, weil dieselbe Stoerung auch
    // die Anzeige mitreisst (siehe uiControls()).
    const icWanted = !!s.icDemand && s.scram.active && s.msiv < 0.5 && s.icWater > 0;
    s.icOpen = icWanted && s.dcPower;
    // Nie mehr, als der Kern gerade tatsaechlich an Dampf erzeugt -- sonst
    // entzieht die feste Nennleistung dem Dom mehr Waerme, als ueberhaupt da
    // ist, und der Druck stuerzt auf den unteren Anschlag statt sich auf
    // einen Gleichgewichtswert nahe der Saettigung einzupendeln.
    const W_ic = s.icOpen ? Math.min(sp.ic.W0, Math.max(s.x_e * s.W_core, 0)) : 0;
    if (W_ic > 0) {
      // Kondensat laeuft von selbst in den Behaelter zurueck -- der
      // Notkondensator entzieht dem Dom Waerme (und damit Druck), aber
      // keine Masse. Der Vorrat schwindet trotzdem, weil sein EIGENER
      // Behaelter dabei verdampft.
      s.icWater = Math.max(s.icWater - (W_ic / sp.ic.W0) * (dt / sp.ic.enduranceS), 0);
    }

    // ── Druck ───────────────────────────────────────────────────────────────
    // Erzeugt wird, was im Kern verdampft; abgefuehrt, was die Ventile UND
    // der Notkondensator lassen. Der IC zaehlt nur hier, nicht im
    // Fuellstand weiter unten -- sein Kondensat bleibt im eigenen Kreislauf.
    const balance = saturatedPressure({ pressure: s.p_dome, mass: s.M_rpv,
      cp: sp.vessel.cp, metalCapacity: sp.vessel.mass * sp.vessel.cp * 0.05,
      heat: s.coolantHeatKJ / dt, feed: s.W_fw,
      feedEnthalpy: s.acPower ? H_FW : 4.2 * 20, steam: s.W_steam,
      extraCooling: W_ic * hfg(s.p_dome), dt });
    const pNew = balance.pressure;
    s.pressureClipKJ = balance.rejectedKJ;
    // Die geglaettete Aenderungsrate treibt den Blasenkollaps im Kern.
    ctx.dpLag.step((pNew - ctx.pPrev) / dt, dt);
    ctx.pPrev = pNew;
    s.p_dome = pNew;
    s.p_prim = s.p_dome;

    // ── Sicherheitsbehälter ─────────────────────────────────────────────────
    // Der Sicherheitsventil-Dampf blaest in die Kondensationskammer und
    // haelt den Behaelterdruck hoch -- der einzige Weg, ueber den bei
    // Isolierung ueberhaupt Masse aus dem Dom in den Sicherheitsbehaelter
    // gelangt. Venten laesst kontrolliert wieder ab (dafuer verlaesst
    // radioaktives Gas die Anlage), sonst steigt der Druck weiter, bis der
    // Behaelter selbst versagt.
    s.contMass = Math.max(0, s.contMass + W_srv * dt
      - (s.contVentOpen ? sp.containment.ventCv : 0) * dt);
    s.pCont = sp.containment.p0 + (s.contMass / sp.containment.capacity)
      * (sp.containment.designLimit - sp.containment.p0);
    if (!s.contFailed && s.pCont > sp.containment.designLimit) {
      s.contFailed = true;
      ctx.log.push({ t: s.t_sim, key: 'event_cont_failure', severity: 3 });
      // Ein geborstener Sicherheitsbehaelter haelt nichts mehr zurueck --
      // von hier an wirkt er wie ein offenes Ventil.
    }
    if (s.contFailed) s.contMass = Math.max(0, s.contMass - sp.containment.ventCv * 2 * dt);

    // ── Referenzschenkel der Fuellstandsmessung ─────────────────────────────
    // Behaelteratmosphaere heisser als die Saettigung zum Reaktordruck: die
    // Wassersaeule der Messung siedet aus. Umgekehrt fuellt das Kondensations-
    // gefaess sie von selbst wieder auf. Der Fehler wirkt nur auf die ANZEIGE
    // (siehe derived()), nicht auf s.L_rpv -- die Meldung "Fuellstand niedrig"
    // kommt weiterhin am echten Stand, sonst haette der Spieler bei leerem
    // Schenkel ueberhaupt keinen Hinweis mehr.
    const dTleg = tsat(s.pCont) - tsat(Math.max(s.p_dome, 0.05)) - sp.refLeg.dTmin;
    s.refLegFill = dTleg > 0
      ? Math.max(0, s.refLegFill - (dTleg / sp.refLeg.dTfull) * (dt / sp.refLeg.dryoutS))
      : Math.min(1, s.refLegFill + dt / sp.refLeg.refillS);

    // ── Wasserstoff ─────────────────────────────────────────────────────────
    // Simplified bounded oxidation source and two gas compartments. The
    // inert containment is not the oxygen-containing reactor building.
    const produced = Math.min(Math.max(0, 1000 - s.h2ProducedKg),
      Math.max(0, sp.h2.rate * (s.T_cl - sp.h2.onsetK) * dt),
      Math.max(0, s.M_rpv + (s.W_fw - s.W_steam) * dt) / 9);
    s.h2ProducedKg += produced;
    s.h2Mass += produced;
    s.M_rpv -= produced * 9;
    // Controlled vent goes to the stack. Overpressure/failure can leak gas
    // into the building independently of the vent command.
    const ventRate = s.contVentOpen ? 0.02 : 0;
    const leakRate = s.contFailed || s.pCont > sp.containment.designLimit * 0.7 ? 0.002 : 0;
    const removed = s.h2Mass * (1 - Math.exp(-(ventRate + leakRate) * dt));
    if (ventRate + leakRate > 0) {
      s.h2Mass -= removed;
      s.h2BuildingMass += removed * leakRate / (ventRate + leakRate);
    }
    // 10,000 m3 air compartment, ambient H2 density 0.0838 kg/m3.
    // Ignition is assumed once a flammable mixture forms (game abstraction).
    if (!s.h2Exploded && s.h2BuildingMass / (10000 * 0.0838) >= 0.04) {
      s.h2Exploded = true;
      ctx.log.push({ t: s.t_sim, key: 'event_h2_explosion', severity: 3 });
    }

    // ── Fuellstand ──────────────────────────────────────────────────────────
    //
    // Actual feed is capped before the balance; no mass is discarded.
    s.M_rpv = Math.max(0, s.M_rpv + (s.W_fw - s.W_steam) * dt);

    const Ltrue = clamp(0.5 + (s.M_rpv - sp.vessel.mass) / sp.vessel.massSpan, 0, 1);
    // Schrumpfen und Quellen ist hier staerker als beim Druckwasserreaktor:
    // der Kern selbst siedet, ein Druckabfall laesst den ganzen Behaelter
    // aufwallen.
    //
    // Der Ausschlag ist begrenzt, und das ist kein Schoenheitsfix. Die
    // Korrektur ist als KLEINE Verfaelschung um den Betriebsdruck herum
    // gedacht; ungebremst lieferte sie bei 110 bar Domdruck −91
    // Prozentpunkte. Die Anzeige stand dann auf 11 %, waehrend der Behaelter
    // physisch randvoll war -- und weil die Speisewasserregelung unten auf
    // GENAU DIESE ANZEIGE regelt (s.L_rpv, nicht s.M_rpv), sah sie einen fast
    // leeren Behaelter und speiste noch mehr nach. Das war die
    // selbstverstaerkende Schleife hinter den 2000 Tonnen, und die Meldung
    // "Fuellstand hoch" konnte dabei nie kommen, weil die Anzeige unten
    // klebte.
    const swell = clamp(sp.vessel.shrinkSwell * (sp.vessel.p0 - s.p_dome) / sp.vessel.p0,
      -sp.vessel.swellMax, sp.vessel.swellMax);
    s.L_rpv = clamp(Ltrue + coverage(s.M_rpv, sp.vessel.mass) * swell, 0, 1);

    // ── Unterkuehlung am Kerneintritt ───────────────────────────────────────
    s.dTsub = _subcooling(s, sp);

    // ── Turbine und Netz ────────────────────────────────────────────────────
    // s.T_cw statt sp.condenser.T_cw: die Kuehlwassertemperatur gehoert dem
    // Lauf, nicht der Bauart (Jahreszeit, siehe game/season.js). Der Wert aus
    // der Anlagendatei ist weiterhin ihr Anfangswert.
    s.p_cond = clamp(psat(s.T_cw + sp.condenser.pinch
      + (sp.condenser.rise || 12) * clamp(s.W_steam / sp.vessel.W_steam0, 0, 1.2)), 0.02, 1.5);
    const wSpec = (hg(s.p_dome) - hf(s.p_cond)) * sp.turbine.workFactor;
    s.P_e = s.breaker && !s.turbineTripped ? (W_t * wSpec) / 1000 : 0;
  },

  stepControls(s, sp, ctx, dt) {
    if (!s.scram.active && ctx.rodCtl.auto) {
      s.rodDmd[0] = clamp(s.rodDmd[0] + ctx.rodCtl.step(s.T_mod, 1, dt), 0, 1);
    }
    // Diesel injection needs low pressure, but no grid AC.
    s.W_fw = s.acPower ? ctx.fwCtl.step(s.L_rpv, s.W_steam, dt)
      : fireInjectionFlow(s, sp);
    // Am Notstromdiesel haengt die Notspeisung, nicht die Hauptspeisepumpe.
    // Der Regler darf weiter regeln -- er kommt nur nicht mehr so weit. Ohne
    // diesen Deckel liefe die Anlage nach dem Dieselstart wieder auf
    // Vollast, und die Störung waere mit einem Knopf erledigt.
    if (!s.gridPower && s.dieselRun) s.W_fw = Math.min(s.W_fw, sp.diesel.feedMax);
    // Das Regelventil haelt den Druck, nicht die Leistung.
    s.gov = ctx.govCtl.step(s.P_e, s.P_demand, s.p_dome, dt);
    s.bypass = s.p_dome > sp.vessel.p0 + 4
      ? clamp((s.p_dome - sp.vessel.p0 - 4) / 6, 0, 1) : 0;
  },

  /**
   * Verlustbedingungen, die nur dieser Typ hat.
   *
   * Ein geborstener Sicherheitsbehaelter ist das Ende der Anlage, auch wenn
   * der Kern selbst in dem Augenblick noch heil ist -- die letzte Barriere
   * zwischen Spaltprodukten und Umgebung ist weg, und es gibt keinen Weg
   * zurueck. Vorher war das folgenlos: im Szenario mit der
   * Frischdampf-Absperrung barst der Behaelter nach zehn Minuten, der Druck
   * lief auf das Fuenfundzwanzigfache des Auslegungswerts, und der Lauf
   * endete nach fuenfundvierzig Minuten mit "geschafft".
   */
  lossCriteria(s) {
    return s.contFailed ? 'event_cont_failure_loss' : null;
  },

  onScram(s, sp, ctx) {
    s.turbineTripped = true;
    ctx.govCtl.trip();
    s.gov = 0;
    s.breaker = false;
    // Die Umwaelzpumpen laufen mit ab -- so ist es verschaltet, und es haelt
    // den Naturumlauf frei.
    ctx.recircPump.trip();
  },

  /**
   * Bedienung dieses Typs: der Umwaelzstrom ist das Leistungsstellglied, und
   * die Frischdampf-Absperrung ist die Stoerung, die man selbst ausloesen
   * koennen soll.
   */
  uiControls(s, sp, ctx, kit) {
    const recirc = kit.slider({
      labelKey: 'ctl_recirc', min: Math.round(sp.recirc.min * 100),
      max: Math.round(sp.recirc.max * 100), step: 1,
      value: Math.round(s.recircDmd * 100), digits: 0, unitKey: 'unit_percent',
      onInput: (v) => { s.recircDmd = v / 100; },
    });
    const msiv = kit.buttonGroup('ctl_msiv', [
      { key: 'state_open', value: '1' },
      { key: 'state_closed', value: '0' },
    ], '1', (v) => { s.msiv = Number(v); });

    // Buttons show the request; diagnostics separately show feedback loss.
    const ic = kit.buttonGroup('ctl_ic', [
      { key: 'state_open', value: '1' },
      { key: 'state_closed', value: '0' },
    ], '1', (v) => { s.icDemand = Number(v); });

    // Enable the diesel pump; actual flow still depends on pressure.
    const fireInj = kit.buttonGroup('ctl_fire_inj', [
      { key: 'state_open', value: '1' },
      { key: 'state_closed', value: '0' },
    ], '0', (v) => { s.fireInjOn = !!Number(v); });

    const depressurize = kit.buttonGroup('ctl_depressurize', [
      { key: 'state_open', value: '1' }, { key: 'state_closed', value: '0' },
    ], '0', (v) => { s.depressurize = !!Number(v); });
    const dc = kit.buttonGroup('ctl_emergency_dc', [
      { key: 'state_on', value: '1' }, { key: 'state_off', value: '0' },
    ], '1', (v) => { s.dcPower = !!Number(v); });
    // Direkt hinter der Batterie, weil der Anlasser an ihr haengt: die
    // Reihenfolge auf dem Schirm ist die Reihenfolge der Handgriffe.
    const diesel = kit.buttonGroup('ctl_diesel', [
      { key: 'state_on', value: '1' }, { key: 'state_off', value: '0' },
    ], '0', (v) => { s.dieselCmd = !!Number(v); });
    // Eigene Anzeige fuer den Anlauf: ein Knopf, der auf "ein" steht,
    // waehrend noch nichts anliegt, waere sonst nicht von einem kaputten zu
    // unterscheiden. Sie zeigt die Sekunden bis zur Spannung und danach den
    // tragenden Diesel.
    const dieselState = kit.indicator({ labelKey: 'val_diesel', digits: 0,
      read: () => (s.dieselRun ? 0 : Math.max(0, sp.diesel.startS - s.dieselT)),
      unitKey: 'unit_seconds' });
    const fireSupply = kit.indicator({ labelKey: 'val_fire_water', unitKey: 'unit_t',
      digits: 1, read: () => s.fireWaterKg / 1000 });

    // Sicherheitsbehälter-Venten: kontrollierte Freisetzung, um einen
    // unkontrollierten Bruch zu verhindern.
    const contVent = kit.buttonGroup('ctl_cont_vent', [
      { key: 'state_open', value: '1' },
      { key: 'state_closed', value: '0' },
    ], '0', (v) => { s.contVentOpen = !!Number(v); });

    return [
      { mount: 'primary', node: recirc.node, set: (st) => recirc.set(Math.round(st.recircDmd * 100)) },
      { mount: 'secondary', node: msiv.node, set: (st) => msiv.set(String(st.msiv)) },
      {
        mount: 'safety',
        node: ic.node,
        set: (st) => ic.set(String(st.icDemand)),
      },
      { mount: 'safety', node: fireInj.node, set: (st) => fireInj.set(st.fireInjOn ? '1' : '0') },
      { mount: 'safety', node: depressurize.node, set: (st) => depressurize.set(st.depressurize ? '1' : '0') },
      { mount: 'safety', node: dc.node, set: (st) => dc.set(st.dcPower ? '1' : '0') },
      { mount: 'safety', node: diesel.node, set: (st) => diesel.set(st.dieselCmd ? '1' : '0') },
      { mount: 'safety', node: dieselState.node, set: () => dieselState.set() },
      { mount: 'safety', node: fireSupply.node, set: () => fireSupply.set() },
      { mount: 'safety', node: contVent.node, set: (st) => contVent.set(st.contVentOpen ? '1' : '0') },
    ];
  },

  togglePump(s, sp, ctx) {
    const p = ctx.recircPump;
    if (p.state === 'run') p.trip(); else p.start();
  },

  derived(s, sp, ctx, base) {
    // Fuellstandsanzeige braucht wie der Notkondensator Gleichstrom -- ohne
    // ihn friert sie auf dem letzten Wert ein, waehrend der Kern in
    // Wirklichkeit weiter leerlaeuft. Genau das hat 2011 dazu gefuehrt, dass
    // die Warte den Fuellstand fuer laenger stabil hielt, als er es war.
    //
    // Der zweite Fehler ist der gemeinere und der historisch entscheidende:
    // ein ausgekochter Referenzschenkel (s.refLegFill, siehe stepLoop) laesst
    // die Anzeige ZU HOCH lesen. In Fukushima-1 stand sie damit ueber der
    // Kernoberkante, waehrend der Kern schon frei lag -- die Warte sah keinen
    // Grund einzuspeisen. Der Fehler steht additiv auf dem echten Stand und
    // wird eingefroren wie der Wert selbst, sobald der Gleichstrom fehlt.
    const indicated = clamp(s.L_rpv + sp.refLeg.biasMax * (1 - s.refLegFill), 0, 1);
    ctx.displayLevel = s.dcPower ? indicated : (ctx.displayLevel ?? indicated);
    return {
      p_sg: s.p_dome,
      L_sg: ctx.displayLevel,
      W_steam: s.W_steam,
      W_fw: s.W_fw,
      gov: s.gov,
      bypass: s.bypass,
      p_cond: s.p_cond,
      voidFrac: s.alphaBar,
      msivStuck: !!ctx.msivStuck,
      quality: s.x_e,
      recirc: s.W_rec / sp.recirc.W0,
      subcooling: s.dTsub,
      decayRatio: ctx.decayRatio,
      oscAmp: Math.abs(s.osc),
      dnbr: _cpr(s, sp, base),
      shutdownMargin: sp.rodBanks.reduce((a, b, i) => a + b.worth * (1 - s.rod[i]), 0),
      pumpStates: [ctx.recircPump.state],
      // Siehe pwr.js: unterscheidet ausgefallen (Ereignis, Knopf gesperrt)
      // von selbst abgeschaltet (Spieler, Knopf bleibt bedienbar).
      pumpStuckList: [!!ctx.recircPumpStuck],
      pCont: s.pCont,
      h2Mass: s.h2Mass,
    };
  },
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/** Unterkuehlung am Kerneintritt aus der Mischung Umwaelzwasser + Speisewasser. */
function _subcooling(s, sp) {
  const W = Math.max(s.W_core, 1);
  const Wfw = clamp(s.W_fw, 0, W);
  const hSat = hf(s.p_dome);
  const hFeed = s.acPower ? H_FW : 4.2 * 20;
  const hMix = (Wfw * hFeed + (W - Wfw) * hSat) / W;
  return clamp((hSat - hMix) / sp.coolant.cp, 0, 60);
}

/**
 * Mittlerer Blasenanteil ueber die Kernhoehe.
 *
 * Die Siedezone ist der Teil des Kanals oberhalb des Siedebeginns. Ihr Anteil
 * folgt aus dem Verhaeltnis der Enthalpien: was zum Aufheizen bis zur
 * Saettigung draufgeht, siedet nicht.
 *
 *   f_sieden = 1 − (c_p · ΔT_unterkuehlt) / (q / W)
 *
 * Der erste Ansatz nahm stattdessen f_sieden = 1 − ΔT/55 K. Das sah aehnlich
 * aus und war trotzdem falsch, denn es haengt nur an der Unterkuehlung und
 * nicht am Durchsatz. Folge: bei 80 % Umwaelzstrom stieg zwar der Dampfgehalt,
 * gleichzeitig sank aber die gerechnete Siedezone -- beides hob sich auf, der
 * Blasenanteil bewegte sich um 0,4 Prozentpunkte, und die Leistung um 1,9 %
 * statt um die erwarteten 10 bis 20 %. Damit waere das Regelorgan dieses
 * Reaktortyps wirkungslos gewesen.
 */
function _void(s, sp) {
  const W = Math.max(s.W_core, 1);
  const G = W / sp.coolant.flowArea_m2;
  const qPerKg = (s.P_th * 1000) / W;              // kJ/kg zugefuehrt
  const subPerKg = sp.coolant.cp * s.dTsub;        // kJ/kg bis zur Saettigung
  const fBoil = clamp(1 - subPerKg / Math.max(qPerKg, 1e-3), 0.05, 0.98);
  return averageVoid(s.x_e, s.p_dome, G, fBoil);
}

/**
 * Abstand zur Siedekrise, beim Siedewasserreaktor als kritisches
 * Leistungsverhaeltnis. Wie beim Druckwasserreaktor eine monotone Kennzahl mit
 * der richtigen Form, keine echte Korrelation: mehr Durchsatz hilft, mehr
 * Leistung und mehr Dampfgehalt schaden.
 */
function _cpr(s, sp, base) {
  const flow = clamp(s.W_core / sp.recirc.W0, 0.05, 1.3);
  const power = clamp(base.load, 0.02, 2);
  const q = clamp(1 - s.x_e / 0.28, 0.05, 1);
  return clamp(1.9 * Math.pow(flow, 0.5) * Math.pow(q, 0.35) / power, 0, 20);
}

/**
 * Notstromdiesel: anfordern, anlaufen, tragen.
 *
 * Steht hier und nicht in game/events.js, weil es kein Ereignis ist,
 * sondern Anlagentechnik -- dieselbe Trennung wie beim Instandhaltungstrupp
 * (game/repairs.js): dort haengt die Reparatur am Anlagenzustand statt am
 * ausloesenden Ereignis, hier haengt der Strom an der Maschine statt an der
 * Störung, die ihn genommen hat.
 *
 * Der Anlasser braucht Gleichstrom. Nach einem Station-Blackout heisst das:
 * erst die Ersatzbatterien (ctl_emergency_dc), dann der Diesel -- zwei
 * Handgriffe in genau dieser Reihenfolge, und beide stehen schon auf dem
 * Schirm. Ein LAUFENDER Diesel braucht die Batterie nicht mehr; er erregt
 * sich selbst, und ihn beim naechsten Spannungseinbruch wieder ausgehen zu
 * lassen waere eine Strafe ohne Vorbild.
 */
function stepDiesel(s, sp, dt) {
  if (s.destroyed || !s.dieselCmd) {
    s.dieselT = 0;
    s.dieselRun = false;
  } else if (!s.dieselRun) {
    // Faellt die Batterie waehrend des Anlaufs weg, faengt er von vorne an.
    // Der Anlasser dreht dann eben nicht weiter, und ein halb angelassener
    // Diesel ist kein Zustand, den man aufheben koennte.
    s.dieselT = s.dcPower ? s.dieselT + dt : 0;
    if (s.dieselT >= sp.diesel.startS) s.dieselRun = true;
  }
  // EINE Stelle, die acPower setzt -- sonst muesste jede andere wissen, ob
  // gerade das Netz oder der Diesel traegt.
  s.acPower = s.gridPower || s.dieselRun;
}

export default { spec, hooks };

/** Diesel pump curve, no AC grid required; zero flow above shutoff head. */
export function fireInjectionFlow(s, sp = spec) {
  if (!s.fireInjOn || !(s.fireWaterKg > 0)) return 0;
  return sp.fireInj.W0 * Math.sqrt(clamp(1 - Math.max(s.p_dome - 1, 0) / (sp.fireInj.shutoffBar - 1), 0, 1));
}
