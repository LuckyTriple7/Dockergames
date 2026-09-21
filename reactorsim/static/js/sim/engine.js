// Die Engine: Reihenfolge eines Zeitschritts, gemeinsame Kernthermik,
// Schnellabschaltung, abgeleitete Anzeigewerte.
//
// Was hier steht, gilt für alle Reaktortypen. Alles Typspezifische kommt aus
// einem Datenobjekt (spec) und ein paar Haken (hooks). Die Engine verzweigt an
// keiner Stelle nach Reaktortyp -- muss sie es doch, ist die Schnittstelle
// falsch geschnitten und gehört erweitert, nicht umgangen.
//
// Reihenfolge eines Schritts:
//   1. Reaktivität aus der Beitragsregistry
//   2. Kinetik, mit der Kernthermik INNERHALB der Untertakte
//   3. Nachzerfallswärme
//   4. Kreislauf des Typs (Dampferzeuger, Druckhalter, Turbine, Netz)
//   5. Regler, im Untertakt von 0,2 s
//   6. Vergiftung
//   7. Grenzwerte, Meldungen -- ausschließlich Meldungen, keine Auslösung. Die
//      Schnellabschaltung kommt allein vom Bedienerknopf, siehe scram() unten.
//   8. sanitize()

import { PROMPT_FRACTION, relax, clamp, toC } from './constants.js';
import { makeKinetics, stepKinetics, measuredPeriod } from './kinetics.js';
import { createState, sanitize } from './state.js';
import { makeReactivity } from './reactivity.js';
import { stepDecay, decaySum } from './decayheat.js';
import { stepPoisons } from './poisons.js';
import { TripSystem } from './trips.js';
import { tsat, hfg } from './steam.js';
import { Rng } from '../rng.js';

/** Regler laufen nicht in jedem Rechenschritt, sondern alle 0,2 s. */
const CONTROL_PERIOD = 0.2;

/** Obergrenze fuer ctx.history (siehe dort) -- dieselbe wie die Anzeige
 *  selbst (Annunciator.log() in annunciator.js), mehr wuerde dort ohnehin
 *  sofort wieder abgeschnitten. */
const HISTORY_CAP = 120;

/**
 * Zwei Abbruchkriterien für den Brennstoff.
 *
 * 963 J/g (230 cal/g) ist der klassische Wert für Brennstoffzerlegung. Er gilt
 * für die radial gemittelte Enthalpie der heissesten Tablette -- unser Modell
 * führt dagegen EINEN Knoten für den ganzen Kern. Die Spitze liegt in einem
 * echten Kern beim Zwei- bis Dreifachen des Kernmittels, weil Fluss und
 * Abbrand nicht gleichmässig sind.
 *
 * Deshalb zusätzlich das Kriterium, das bei einer schnellen Leistungsexkursion
 * tatsächlich zuerst greift: der Enthalpie-ZUWACHS gegenüber dem
 * Betriebszustand. Hüllrohrversagen setzt in Versuchen bei etwa 250 J/g
 * Zuwachs ein (60 cal/g). Auf das Kernmittel umgerechnet sind das rund 96 J/g.
 */
const ENTHALPY_LIMIT_JPG = 963;
const ENTHALPY_RISE_LIMIT_JPG = 250;
const PEAK_FACTOR = 2.6;

/** Erdbeschleunigung -- gebraucht fuer den Nachlauf (siehe startAftermath). */
const G = 9.81;

/**
 * Wie lange eine Bedingung anstehen muss, bevor die Anlage verloren ist.
 *
 * Beide bewusst in Minuten, nicht in Sekunden: der Spieler soll eine Chance
 * haben, sie zu bemerken und abzustellen. Ein Grenzwert, der im Augenblick des
 * Ueberschreitens zuschlaegt, waere kein Lernstoff, sondern eine Falle.
 *
 * 180 s ueber der Huellrohrgrenze entspricht der Groessenordnung, in der die
 * Zirkon-Wasser-Reaktion bei 1200 °C von selbst durchgeht; 300 s ohne
 * Unterkuehlung ist die Zeit, in der ein freigelegter Kern bei
 * Nachzerfallswaerme trockenfaellt.
 */
const CLAD_FAIL_HOLD_S = 180;
const COOLANT_LOSS_HOLD_S = 300;

export function createEngine(plant, opts = {}) {
  const spec = plant.spec;
  const hooks = plant.hooks || {};

  // β_eff wandert mit dem Abbrand: ein frischer Kern spaltet fast nur U-235,
  // ein abgebrannter zu einem guten Teil Pu-239, das weniger verzögerte
  // Neutronen liefert. Aus 650 pcm werden über den Zyklus 550.
  const burnup = opts.burnup !== undefined ? opts.burnup : 0;
  const f = clamp(burnup / (spec.cycleEFPD || 450), 0, 1);
  const betaEff = spec.beta.boc + (spec.beta.eoc - spec.beta.boc) * f;

  const kin = makeKinetics(betaEff, spec.Lambda);
  const s = createState(spec, { ...opts, kin, burnup });
  const rx = makeReactivity(spec, hooks);
  // opts.extraTrips: Meldungen, die nicht am Reaktortyp haengen, sondern am
  // laufenden Szenario (siehe game/scenario.js, gridDeviationTrips()) --
  // spec.trips bleibt dafuer unangetastet, sonst wuerden sie sich beim
  // naechsten Rundenstart am selben Typ ansammeln (spec ist ein Modul-
  // weites Objekt, keine Kopie je Runde).
  const trips = new TripSystem([...(spec.trips || []), ...(opts.extraTrips || [])]);

  // Wärmekapazitäten und Durchgänge aus den Zeitkonstanten zurückgerechnet --
  // die Literatur nennt Zeitkonstanten, nicht kW/K.
  const mFuel = (spec.fuel.mass_t || 100) * 1000;                 // kg
  const C_f = (mFuel * (spec.fuel.cp || 300)) / 1000;             // kJ/K
  const UA_fc = C_f / (spec.fuel.tau || 5.5);                     // kW/K
  const C_cl = C_f * (spec.clad ? spec.clad.C_frac : 0.12);
  const UA_cc = C_cl / (spec.clad ? spec.clad.tau : 1.0);
  const C_cool = (spec.coolant.mass || 30000) * spec.coolant.cp;  // kJ/K

  const ctx = {
    spec, hooks, kin, rx, trips,
    betaEff,
    // Kaltstart: trim() soll den Kern NICHT auf Kritikalitaet einschwingen
    // (das waere ja gerade die Aufgabe des Spielers), sondern absichtlich
    // unterkritisch mit allen Staeben drin stehen lassen. Siehe trim() je Typ.
    cold: !!opts.cold,
    // Gesaeter Zufall fuer alles, was in der Anlage rauscht (Messwerte,
    // Anregung der Dichtewelle). Nie Math.random: sonst waere kein Lauf
    // wiederholbar und kein Regressionstest moeglich.
    rng: new Rng(opts.seed || 1),
    C_f, UA_fc, C_cl, UA_cc, C_cool, mFuel,
    controlAcc: 0,
    decayFrac: decaySum(s.D),
    nPrev: s.n,
    period: Infinity,
    substeps: 1,
    log: [],
    // Rollendes Protokoll-Gedaechtnis (siehe HISTORY_CAP oben), unabhaengig
    // vom DOM des Log-Panels (das haelt seine Eintraege nur als <li>-Knoten,
    // siehe annunciator.js) -- drainLog() unten fuellt es bei jedem Abholen
    // nach, persist.js nimmt es 1:1 in den Spielstand mit. Ohne das startete
    // das Protokoll nach jedem Laden leer, obwohl vorher Stunden gespielt
    // wurden.
    history: [],
  };

  // Startwerte des Typs: Bor, Druckhalter, Dampferzeuger, Turbine ...
  if (hooks.extraState) hooks.extraState(s, spec, ctx);

  // Auf den stationären Punkt einschwingen, damit der Spieler nicht in einem
  // driftenden Kern anfängt.
  if (hooks.trim) hooks.trim(s, spec, ctx, rx);

  // Bezugslinie der Brennstoffenthalpie auf den Betriebszustand setzen. Bliebe
  // sie auf null, wäre der Zuwachs im ersten Rechenschritt so groß wie die
  // ganze Betriebsenthalpie -- und der Kern im selben Augenblick zerstört.
  s.enthalpy = ((spec.fuel.cp || 300) * (s.T_f - 273.15)) / 1000;
  s.enthalpyBase = s.enthalpy;

  /**
   * Kernthermik. Wird aus der Kinetik heraus je Untertakt gerufen -- niemals
   * zusätzlich im Hauptschritt, sonst wird die Wärme doppelt gezählt.
   */
  function stepCore(h, n) {
    // ACHTUNG: prompter Anteil plus Nachzerfallswärme. Nicht n + ΣD_j, sonst
    // stünden im stationären Volllastbetrieb 107 % im Kern.
    const P_th = spec.P0_th * (PROMPT_FRACTION * n + ctx.decayFrac);
    s.P_th = P_th;

    const T_cool = 0.5 * (s.T_ci + s.T_co);

    // Brennstoff: Quelle ist die Spaltleistung, Senke das Hüllrohr.
    const qFuel = P_th * 1000 * (spec.fuel.depositFraction || 0.974);
    const fuelBefore = s.T_f;
    s.T_f = relax(s.T_f, s.T_cl + qFuel / UA_fc, h, C_f / UA_fc);

    // Hüllrohr zwischen Brennstoff und Kühlmittel.
    // Integrated fluxes conserve energy even during a fast transient.
    const qClad = qFuel - C_f * (s.T_f - fuelBefore) / h;
    const cladBefore = s.T_cl;
    const transfer = hooks.heatTransfer ? hooks.heatTransfer(s, spec, ctx) : 1;
    const UA = UA_cc * clamp(transfer, 0.0001, 1);
    s.T_cl = relax(s.T_cl, T_cool + qClad / UA, h, C_cl / UA);

    // Kühlmittel: Wärme vom Hüllrohr, plus der Teil der Spaltenergie, der gar
    // nicht erst im Brennstoff landet -- Gammastrahlung und Neutronen geben
    // rund 2,6 % direkt an Moderator und Einbauten ab. Ohne diesen Anteil
    // verschwänden 100 MW aus der Bilanz, und der Kern liefe auf 104,6 %,
    // um die Turbine trotzdem zu bedienen.
    const deposited = P_th * 1000 * (1 - (spec.fuel.depositFraction || 0.974));
    const qDirect = hooks.directHeat ? hooks.directHeat(s, spec, ctx, deposited, h) : deposited;
    const qCool = qClad - C_cl * (s.T_cl - cladBefore) / h + qDirect;
    s.coolantHeatKJ = (s.coolantHeatKJ || 0) + qCool * h;

    if (hooks.coreCoolant) {
      // Siedende Kerne rechnen hier anders: die Austrittstemperatur ist die
      // Sättigungstemperatur, und die Wärme geht in den Dampfgehalt statt in
      // eine Temperaturerhöhung. Der Haken sitzt bewusst INNERHALB der
      // Kinetik-Untertakte -- beim RBMK entscheidet die Rückwirkung des
      // Dampfblasenanteils auf die Reaktivität im Sekundenbereich über den
      // Ausgang, und ein erst im Hauptschritt nachgezogener Blasenanteil käme
      // dafür zu spät.
      hooks.coreCoolant(s, spec, ctx, qCool, h);
    } else {
      // ── Ausdampfen bei Druckverlust ──────────────────────────────────────
      //
      // Ein nicht siedender Kern führt seine Wärme über FLÜSSIGES Wasser ab.
      // Die Bilanz unten setzt das stillschweigend voraus: sie kennt nur
      // Durchsatz und Wärmekapazität und fragt nie, ob es bei dem Druck, der
      // gerade herrscht, überhaupt noch Wasser gibt.
      //
      // Ohne die Prüfung war das Ergebnis grotesk: im Szenario mit dem
      // klemmenden Abblaseventil lief der Primärkreis auf 1 bar und 0 %
      // Druckhalterfüllstand leer -- vollständiger Kühlmittelverlust -- und
      // die Brennstofftemperatur stand die ganze Zeit unverändert auf
      // 1027 °C. Das Modell kühlte mit Wasser weiter, das längst verdampft
      // war, und der Lauf endete mit "geschafft".
      //
      // Steigt die mittlere Kühlmitteltemperatur über die Sättigung, ist das
      // Wasser im Kern Dampf. Dampf hat einen Bruchteil der Dichte und einen
      // Bruchteil des Wärmeübergangs -- deshalb wird hier der DURCHGANG
      // selbst abgesenkt und nicht etwa ein zweiter Term danebengestellt.
      // Ein zusätzlicher Term war der erste Versuch und funktionierte nicht:
      // die Zeitkonstante der Wasserkühlung liegt bei 0,3 s, die des
      // Ausdampfens bei Minuten -- die Wasserkühlung zog den Knoten in jedem
      // Teilschritt rund siebenhundertmal stärker zurück, als das Ausdampfen
      // ihn anheben konnte, und im Ergebnis passierte nichts.
      //
      // Mit abgesenktem Durchgang folgt beides von selbst: das Gleichgewicht
      // T_ci + q/UA rückt weit nach oben, und die Zeitkonstante C/UA wächst
      // im selben Maß -- der Kern heizt sich über Minuten auf, nicht in
      // Sekunden. Genau der Verlauf eines Kühlmittelverlusts.
      const Tsat = tsat(s.p_prim);
      const dry = clamp((T_cool - Tsat) / (spec.coolant.flashBandK || 25), 0, 1);
      const eff = 1 - dry * (1 - (spec.coolant.dryTransferFrac || 0.02));

      // Der Faktor 2 kommt daher, dass der Knoten die MITTLERE Temperatur
      // führt, der Durchsatz aber die Differenz zwischen Ein- und Austritt
      // abführt.
      const UA_flow = 2 * Math.max(s.W_core, 1) * spec.coolant.cp * eff;
      const Tc = relax(T_cool, s.T_ci + qCool / UA_flow, h, C_cool / UA_flow);

      s.T_co = 2 * Tc - s.T_ci;
      s.T_mod = hooks.moderatorTemp ? hooks.moderatorTemp(s, spec, Tc) : Tc;
    }

    // Brennstoffenthalpie als Zerstörungskriterium. Die Bezugslinie folgt dem
    // Betriebszustand mit zwei Minuten Zeitkonstante -- langsam genug, dass
    // eine Exkursion von Sekunden voll als Zuwachs zählt, schnell genug, dass
    // ein normaler Lastwechsel ihn nicht auslöst.
    s.enthalpy = ((spec.fuel.cp || 300) * (s.T_f - 273.15)) / 1000;
    s.enthalpyBase = relax(s.enthalpyBase, s.enthalpy, h, 120);
    s.enthalpyRise = s.enthalpy - s.enthalpyBase;
    const peakRise = PEAK_FACTOR * s.enthalpyRise;
    // WELCHE der beiden Grenzen zuerst faellt, gehoert in die Meldung: die
    // 963 J/g sind die Zerlegung des Brennstoffs selbst, der Zuwachs von
    // 250 J/g ist das Versagen der Huellrohre im heissesten Kanal. Bis 0.6.4
    // sagte der Endbildschirm in beiden Faellen "der Brennstoff ist zerlegt"
    // -- bei einer Exkursion faellt aber fast immer die zweite Grenze zuerst,
    // und die sagt weniger.
    if (!s.destroyed && (s.enthalpy > ENTHALPY_LIMIT_JPG || peakRise > ENTHALPY_RISE_LIMIT_JPG)) {
      lose(s.enthalpy > ENTHALPY_LIMIT_JPG ? 'event_fuel_dispersal' : 'event_fuel_failure');
    }
  }

  /**
   * Die Anlage ist verloren. Ein Grund, ein Protokolleintrag, ein Ende.
   *
   * `destroyed` bleibt das Signal nach aussen (Spielschicht, Oberflaeche),
   * `destroyedKey` sagt zusaetzlich WARUM -- vorher gab es nur den einen Weg
   * ueber die Brennstoffenthalpie, und der Endbildschirm konnte deshalb auch
   * nur "Kernzerstoerung" sagen.
   */
  function lose(key) {
    if (s.destroyed) return;
    s.destroyed = true;
    s.destroyedKey = key;
    ctx.log.push({ t: s.t_sim, key, severity: 3 });
    ctx.trends?.mark({ t: s.t_sim, kind: 'event', key, severity: 3 });
    startAftermath(key);
  }

  /**
   * Der Nachlauf: was nach dem Brennstoffversagen noch RECHENBAR ist.
   *
   * Bis 0.6.4 endete das Modell mit `destroyed` -- der Endbildschirm sagte
   * "Brennstoff zerstoert", und was in einer solchen Anlage danach wirklich
   * geschieht, kam gar nicht vor. Fuer den RBMK ist das zu wenig: die Nacht
   * des 26. April endete nicht mit zerlegtem Brennstoff, sondern mit einem
   * abgehobenen Deckel.
   *
   * Gerechnet wird deshalb genau der eine Schritt, den der eigene Zustand
   * hergibt -- eine Energiebilanz, keine Explosionsmechanik:
   *
   *   E_ueber  die im Brennstoffknoten gespeicherte Energie OBERHALB der
   *            Saettigungstemperatur des Kuehlmittels. Nur sie kann beim
   *            Zerlegen an das Wasser uebergehen.
   *   m_Dampf  was davon verdampfen kann, begrenzt durch das Wasser im Kern.
   *   W_Deckel die Hubarbeit des oberen Schilds: Masse mal g mal Hubhoehe.
   *   p_Hub    der statische Ueberdruck, ab dem er ueberhaupt abhebt --
   *            Gewicht durch Flaeche, zwei nachschlagbare Zahlen und eine
   *            Division.
   *
   * Die EINZIGE Annahme ist der Umsetzungsgrad: welcher Anteil der
   * thermischen Energie in einer Dampfexplosion mechanisch wird. Versuche
   * nennen wenige Prozent; spec.aftermath.conversion haelt den Wert fest,
   * und `share` sagt, welcher Anteil hier noetig WAERE. Ist er kleiner,
   * hebt der Deckel ab. Alles Weitere -- zweite Explosion, Graphitbrand,
   * Freisetzung -- rechnet dieses Modell nicht und behauptet es auch nicht.
   */
  function startAftermath(cause) {
    const cfg = spec.aftermath;
    if (!cfg || s.aftermath) return;
    const p = s.p_drum || spec.coolant.p0;
    const Tsat = tsat(p);
    const mFuel = (spec.fuel.mass_t || 0) * 1000;
    const mWater = spec.coolant.mass || 0;
    const h = hfg(p) * 1000;
    const energy = Math.max(0, mFuel * (spec.fuel.cp || 300) * (s.T_f - Tsat));
    const mLid = (cfg.lid.mass_t || 0) * 1000;
    const area = Math.PI * (cfg.lid.diameter_m / 2) ** 2;
    const work = mLid * G * cfg.lid.lift_m;
    s.aftermath = {
      cause,
      t0: s.t_sim,
      energy_J: energy,
      steam_kg: h > 0 ? Math.min(mWater, energy / h) : 0,
      water_kg: mWater,
      work_J: work,
      lift_bar: area > 0 ? (mLid * G) / area / 1e5 : 0,
      share: energy > 0 ? work / energy : Infinity,
      lid: null,
      done: false,
    };
  }

  /** Eine Stufe, nach cfg.lid_delay_s -- lange genug, dass die Anzeigen den
   *  Ausschlag noch zeigen, kurz genug, dass es derselbe Vorgang bleibt. */
  function stepAftermath() {
    const a = s.aftermath;
    const cfg = spec.aftermath;
    if (!a || a.done || s.t_sim - a.t0 < cfg.lid_delay_s) return;
    a.lid = a.share <= cfg.conversion;
    a.done = true;
    const key = a.lid ? 'event_lid_lifted' : 'event_lid_held';
    ctx.log.push({ t: s.t_sim, key, severity: 3 });
    ctx.trends?.mark({ t: s.t_sim, kind: 'event', key, severity: 3 });
  }

  /**
   * Die uebrigen Wege, eine Anlage zu verlieren.
   *
   * Die Enthalpiegrenze oben trifft genau EINEN Fall: die schnelle
   * Leistungsexkursion. Sie war lange der einzige, und das war der Grund,
   * warum sich sieben von neun Szenarien mit verschraenkten Armen bestehen
   * liessen -- ein leergelaufener Primaerkreis, ein geborstener
   * Sicherheitsbehaelter, stundenlang ueberhitzte Huellrohre: alles ohne
   * Folgen, alles "geschafft". Ein Leitstandsspiel, dessen Anlage nicht
   * kaputtgehen kann, kann auch nichts beibringen.
   *
   * Was hier steht, gilt fuer jeden Typ. Typeigenes kommt ueber
   * hooks.lossCriteria() dazu -- die Engine verzweigt nicht nach Reaktortyp.
   */
  function checkLoss(d, dt) {
    if (s.destroyed) return;

    // Huellrohrversagen durch Dauerueberhitzung. Die Auslegungsgrenze (1204 °C
    // = 1477 K) ist keine Klippe, sondern der Punkt, ab dem die
    // Zirkon-Wasser-Reaktion selbsttragend wird: sie erzeugt eigene Waerme und
    // Wasserstoff dazu. Wer die Grenze kurz streift, verliert nichts; wer sie
    // minutenlang haelt, hat den Kern verloren, ganz ohne Leistungsausflug.
    const T_fail = (spec.clad && spec.clad.T_fail) || 1477;
    if (s.T_cl > T_fail) s.cladOverS += dt; else s.cladOverS = 0;
    if (s.cladOverS > CLAD_FAIL_HOLD_S) { lose('event_clad_failure'); return; }

    // Kuehlmittelverlust: der Kern liegt nicht mehr in Wasser, sondern in
    // Dampf, und das nicht nur fuer einen Augenblick. Gemessen an der
    // Saettigung, nicht an einer festen Temperatur -- genau so merkt es eine
    // echte Warte auch, naemlich an der verschwindenden Unterkuehlung.
    const dry = d.subcooling !== undefined && d.subcooling < 0;
    if (dry) s.uncoveredS += dt; else s.uncoveredS = 0;
    if (s.uncoveredS > COOLANT_LOSS_HOLD_S) { lose('event_coolant_loss'); return; }

    if (hooks.lossCriteria) {
      const key = hooks.lossCriteria(s, spec, ctx, d);
      if (key) lose(key);
    }
  }

  /** Stäbe fahren: im Normalbetrieb zum Sollwert, bei Schnellabschaltung ein. */
  function stepRods(dt) {
    const banks = spec.rodBanks;
    if (s.scram.active) {
      const rate = 1 / (spec.scram.timeS || 2.5);
      for (let i = 0; i < banks.length; i++) {
        s.rodDmd[i] = 1;
        s.rod[i] = Math.min(1, s.rod[i] + rate * dt);
      }
      return;
    }
    for (let i = 0; i < banks.length; i++) {
      const v = (banks[i].speed || 0.0125) * dt;
      const d = s.rodDmd[i] - s.rod[i];
      s.rod[i] += clamp(d, -v, v);
      s.rod[i] = clamp(s.rod[i], 0, 1);
    }
  }

  function scram(cause) {
    if (s.scram.active) return;
    s.scram = { active: true, t: s.t_sim, cause };
    ctx.log.push({ t: s.t_sim, key: 'event_scram', severity: 3, cause });
    ctx.trends?.mark({ t: s.t_sim, kind: 'scram', key: 'event_scram', severity: 3 });
    if (hooks.onScram) hooks.onScram(s, spec, ctx);
  }

  /**
   * Reaktorschutz zurücksetzen: erst danach gehorchen die Stäbe wieder dem
   * Sollwert des Bedieners -- solange scram.active steht, überschreibt
   * stepRods() jeden Sollwert mit "ganz rein". Ohne diese Funktion blieb das
   * für den Rest des Laufs so: einmal ausgelöst, für immer verriegelt.
   *
   * Genau wie die Meldetafel (trips.reset()) lässt sich eine noch anstehende
   * Ursache nicht wegdrücken -- ein Schutzsystem, das sich während der
   * Störung selbst freigibt, wäre keins.
   *
   * @returns {boolean} true, wenn zurückgesetzt wurde
   */
  function resetScram() {
    if (!s.scram.active) return false;
    for (const st of trips.states.values()) {
      if (st.def.action === 'scram' && st.latched) return false;
    }
    s.scram = { active: false, t: 0, cause: null };
    ctx.log.push({ t: s.t_sim, key: 'event_scram_reset', severity: 1 });
    ctx.trends?.mark({ t: s.t_sim, kind: 'event', key: 'event_scram_reset', severity: 1 });
    return true;
  }

  /**
   * Turbine/Generator wieder ans Netz -- genau wie beim Reaktorschutz eine
   * eigene, bewusste Handlung des Bedieners: ein Turbinenschnellschluss geht
   * nicht von selbst wieder weg, weder s.turbineTripped noch der Regler
   * (govCtl.trip() sperrt das Ventil dauerhaft). Ohne diese Funktion blieb
   * der Generator für den Rest des Laufs bei null, ganz gleich was am
   * Reaktor lag -- egal ob der Trip von einem SCRAM kam oder als eigene
   * Störung (turbine_trip/loss_of_load) aus einem Szenario.
   *
   * Gesperrt, solange der Reaktorschutz noch steht: eine Turbine an einen
   * gerade abgeschalteten Reaktor zu koppeln, hat keinen Sinn und keinen
   * Dampf dafür.
   *
   * @returns {boolean} true, wenn wieder zugeschaltet wurde
   */
  function resumeTurbine() {
    if (!s.turbineTripped) return false;
    if (s.scram.active) return false;
    s.turbineTripped = false;
    s.breaker = true;
    if (ctx.govCtl) ctx.govCtl.resume(s.P_e);
    ctx.log.push({ t: s.t_sim, key: 'event_turbine_resume', severity: 1 });
    ctx.trends?.mark({ t: s.t_sim, kind: 'event', key: 'event_turbine_resume', severity: 1 });
    return true;
  }

  function step(dt) {
    if (s.fault) return;
    s.coolantHeatKJ = 0;

    // 1 + 2: Reaktivität und Kinetik, Kernthermik in den Untertakten.
    const rho0 = rx.compute(s, spec);
    ctx.nPrev = s.n;
    const kres = stepKinetics(s, kin, rho0, dt, (h, n) => {
      stepCore(h, n);
      return rx.compute(s, spec);
    });
    ctx.substeps = kres.substeps;
    s.promptCritical = kres.promptCritical;
    ctx.period = measuredPeriod(ctx.nPrev, s.n, dt);

    // 3: Nachzerfallswärme. Bewusst nach der Kinetik -- die Untertakte rechnen
    // mit dem Wert des letzten Schritts, was bei Zeitkonstanten ab 5 s
    // bedeutungslos ist.
    ctx.decayFrac = stepDecay(s.D, s.n, dt);

    // 4: Kreislauf des Typs.
    stepRods(dt);
    if (hooks.stepLoop) hooks.stepLoop(s, spec, ctx, dt);

    // 5: Regler im eigenen Takt.
    ctx.controlAcc += dt;
    if (ctx.controlAcc >= CONTROL_PERIOD) {
      const cdt = ctx.controlAcc;
      ctx.controlAcc = 0;
      if (hooks.stepControls && !s.destroyed) hooks.stepControls(s, spec, ctx, cdt);
    }

    // 6: Vergiftung.
    stepPoisons(s, s.n, dt);

    // 7: Grenzwerte und Meldungen. Eine Meldung schaltet nichts ab -- sie
    // meldet nur. Die Schnellabschaltung bleibt Sache des Bedieners, der auf
    // den SCRAM/RESA/AZ-5-Knopf drückt; ohne ihn läuft die Anlage weiter,
    // auch über den Rand hinaus.
    const d = derive();
    trips.step(s, d, dt);

    // Die uebrigen Verlustwege neben der Enthalpiegrenze -- siehe checkLoss().
    checkLoss(d, dt);
    // Und was danach noch rechenbar ist -- siehe startAftermath().
    if (s.aftermath) stepAftermath();

    s.t_sim += dt;

    // 8: Grenzen prüfen. Findet sanitize() etwas Unmögliches, hält die Engine
    // an -- lieber ein ehrlicher Fehlerdialog als NaN auf jedem Instrument.
    if (!sanitize(s)) {
      ctx.log.push({ t: s.t_sim, key: 'event_sim_fault', severity: 3, detail: s.fault });
    }
  }

  /**
   * Alles, was die Anzeige braucht und nicht im Zustand steht.
   *
   * Wird je Bild mehrfach gerufen (Meldetafel, Spielschicht, fuenf Stellen in
   * ui/panels.js) und rechnet jedes Mal neu. Ein Puffer dafuer war da und ist
   * wieder raus: er brachte im Messbereich nichts -- drei gesparte Aufrufe je
   * Bild sind ein paar Mikrosekunden von sechzehn Millisekunden -- und kostete
   * genau die Eigenschaft, um die es in sim/state.js im Kopf geht. Wer den
   * Zustand von aussen anfasst (ein Test, eine Bedienung im angehaltenen
   * Zustand) und danach derive() liest, bekam den Wert von vorher.
   */
  function derive() {
    const P_th = s.P_th;
    const load = P_th / spec.P0_th;
    const T_avg = 0.5 * (s.T_ci + s.T_co);
    const Tsat = tsat(s.p_prim);
    const base = {
      P_th,
      load,
      power_th_pct: 100 * load,
      n_pct: 100 * s.n,
      decay_pct: 100 * ctx.decayFrac,
      T_avg,
      T_hot: s.T_co,
      T_cold: s.T_ci,
      T_sat: Tsat,
      subcooling: Tsat - s.T_co,
      period: ctx.period,
      rho: rx.total,
      rho_pcm: rx.total * 1e5,
      rho_dollar: rx.total / betaEff,
      breakdown: rx.breakdown,
      beta: betaEff,
      substeps: ctx.substeps,
      P_e: s.P_e,
      P_demand: s.P_demand,
      deviation: s.P_e - s.P_demand,
      f_grid: s.f_grid,
      W_core: s.W_core,
      scram: s.scram.active,
      destroyed: s.destroyed,
      // Klemmt eine Stabgruppe? Die Störung setzt ctx.stuckRods, und von da
      // an schreibt stepEvents() die Stellung in jedem Rechenschritt zurück
      // -- auch gegen die Schnellabschaltung. Ohne diesen Wert hatte der
      // Spieler keinerlei Anhaltspunkt: der Sollwert liess sich verstellen,
      // die Stellung folgte nicht, und nichts sagte warum.
      rodStuck: !!(ctx.stuckRods && Object.keys(ctx.stuckRods).length),
      // Dieselbe Frage fuer eine ausgefallene Pumpe (rcp_trip/mcp_trip,
      // siehe game/events.js): ctx.pumpsStuck/ctx.recircPumpStuck haelt
      // fest, WELCHE das sind, stepEvents() haelt sie jeden Schritt
      // gestoppt -- auch gegen einen Klick auf den Ein-Knopf. Ohne diesen
      // Wert stand nirgends eine Meldung, dass ueberhaupt etwas ausgefallen
      // ist, und der Spieler konnte die "ausgefallene" Pumpe einfach wieder
      // anklicken.
      pumpStuck: !!((ctx.pumpsStuck && ctx.pumpsStuck.size) || ctx.recircPumpStuck),
    };
    return hooks.derived ? Object.assign(base, hooks.derived(s, spec, ctx, base)) : base;
  }

  return {
    state: s,
    spec,
    hooks,
    ctx,
    kin,
    reactivity: rx,
    trips,
    step,
    derive,
    scram,
    resetScram,
    resumeTurbine,
    /** Protokolleinträge abholen und Puffer leeren -- ctx.history (siehe
     *  oben) wird dabei gleich mitgefuehrt, gedeckelt auf HISTORY_CAP. */
    drainLog() {
      const l = ctx.log.concat(trips.drainEvents());
      ctx.log = [];
      if (l.length) {
        ctx.history.push(...l);
        if (ctx.history.length > HISTORY_CAP) ctx.history.splice(0, ctx.history.length - HISTORY_CAP);
      }
      return l;
    },
    toC,
  };
}
