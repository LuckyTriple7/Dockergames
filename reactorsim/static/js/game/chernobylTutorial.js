import { StartupTutorial } from './tutorial.js';
import { clamp } from '../sim/constants.js';

// "Block 4 -- die Nacht des 26. April": ein gefuehrter Nachbau der Stunden
// vor der Explosion, nicht ein weiteres Anfahr-Tutorial. Eigene Schritte,
// eigenes Praefix, eigene Haltezeiten -- siehe die generalisierte
// Basisklasse in tutorial.js (steps/holdSeconds sind dort ueberschreibbare
// Getter statt Modulkonstanten, genau damit diese Klasse die drei
// bestehenden Anfahrtutorials nicht beruehrt).
//
// Die Vorgeschichte (Volllast -> 50 % -> neun Stunden halten -> 7 %) baut
// erst das Xenon-Gleichgewicht auf, das den echten, fragilen Ausgangszustand
// ueberhaupt erklaerbar macht -- ein direkter Sprung auf 7 % kollabiert
// stattdessen innerhalb weniger Minuten (siehe Machbarkeitspruefung,
// BACKLOG.md). Live durchgerechnet dauert das im Browser mehrere Sekunden
// (gemessen: 708.000 Schritte, ~3,7 s) -- deshalb hier als gepruefter,
// fester Zustand hinterlegt, nicht bei jedem Start neu simuliert.
export const RBMK_CHERNOBYL_TUTORIAL = 'rbmk_chernobyl';

const STEPS = ['handover', 'dip', 'recover', 'pumps', 'test', 'window', 'az5'];
// 'recover' verlangt 1140 s (19 Minuten) SIMULIERTE Zeit -- am 60-fachen
// Zeitraffer sind das rund 19 reale Sekunden, kein zaehes Warten. Die Zahl
// ist bewusst die historische Haltezeit vor dem Versuch, nicht abgekuerzt.
// 'test' (Index 4) haelt nur kurz -- der Schritt schliesst, sobald der
// Auslauf sichtbar begonnen hat. Der schmale AR-Trimm (siehe unten) haelt die
// Leistung bis zum Druecken von AZ-5 nahe am Sollwert -- wie historisch
// (Leistung blieb ~36s nahezu flach bei ~200 MWth) faellt die Anlage NICHT
// von selbst durch, solange AZ-5 nicht gedrueckt wird.
// 'window' (Index 5) ist reine Anzeige, keine Sperre (siehe conditions()[5]
// und der bereits vorhandene AZ-5-Knopf, der nie gesperrt war -- siehe
// 'pressing AZ-5 too early'-Test): der Zerstoerungszeitpunkt haengt an der
// exakten axialen Schieflage im Moment des Drueckens (_tipReactivity in
// rbmk.js) und ist fuer einen Menschen ohne Anhaltspunkt praktisch nicht
// treffbar (siehe Nutzerrueckmeldung: "kein Mensch versteht wann er AZ5
// druecken muss"). Gemessen (siehe test-rbmk-chernobyl-tutorial.mjs) gibt es
// technisch ZWEI Fenster (7-22s und 39-43s seit Auslaufbeginn) -- nur das
// ZWEITE wird hier angezeigt: 'test' schliesst schon um t+8s, also MITTEN im
// ersten Fenster (der Schritt waere kaum eine Sekunde sichtbar gewesen,
// siehe Nutzerrueckmeldung), und waehrend des ersten Fensters ist von einem
// Leistungsanstieg optisch noch nichts zu sehen (der beginnt real erst ab
// ~t+33s) -- fuer einen Spieler ohne Anhaltspunkt nicht nachvollziehbar. Das
// zweite Fenster faellt dagegen genau mit dem sichtbaren Leistungsanstieg
// zusammen (Aufloesung: PRESS_WINDOW/_inPressWindow() unten). 'window' zeigt
// deshalb "warte" (mit sichtbar steigender Leistung), sobald der Anstieg
// beginnt weiterhin "warte", und erst in den 39-43s auf "JETZT" -- dann
// schliesst der Schritt (Uebergang zu 'az5') mit absichtlich sehr kurzer
// Haltezeit (siehe HOLD unten), damit das kurze Fenster (nur 4s) nicht
// teilweise mit aufgefressen wird.
// 'az5' (Index 6) haelt bewusst 15s, nicht nur 1: der promptkritische
// Exkurs (siehe _rodReactivity/_tipReactivity in rbmk.js) braucht nach dem
// Druecken selbst noch mehrere Sekunden, bis die Brennstoffenthalpie-Grenze
// erreicht wird (gemessen: Scheitel bei t+1,3 s, Kriterium bei t+5-6 s) --
// eine zu kurze Haltezeit wuerde den Schritt als "geschafft" abschliessen,
// bevor die Physik ueberhaupt zu Ende gelaufen ist (RunState.checkFail()
// greift zwar vor tutorial.done, aber nur wenn beide ueberhaupt noch laufen).
const HOLD = [5, 2, 1140, 3, 5, 0.2, 15];

// Beide gemessenen Zerstoerungsfenster seit Auslaufbeginn -- ausserhalb
// zerstoert AZ-5 die Anlage in diesem Modell nicht, siehe
// test-rbmk-chernobyl-tutorial.mjs ('press AZ-5 too early') und den Sweep,
// der diese Zahlen erzeugt hat. NICHT beide fuer 'window' verwenden, siehe
// PRESS_WINDOW unten und den STEPS-Kommentar oben.
const DESTROY_WINDOWS = [[7, 22], [39, 43]];

// Das einzige Fenster, das 'window' dem Spieler zeigt (siehe STEPS-
// Kommentar oben): faellt mit dem sichtbaren Leistungsanstieg zusammen,
// anders als das erste, fruehere Fenster.
const PRESS_WINDOW = DESTROY_WINDOWS[1];

// Kuehlmittelauslauf-Naeherung fuer den Turbinenauslaufversuch (siehe
// events.js rbmk_mcp_runback) -- geskriptet statt einer echten
// Turbinen-Rotortraegheit, wie besprochen: der Punkt ist die Kombination
// aus Xenon-armer, ORM-armer Anlage UND sinkendem Durchsatz, nicht eine
// mechanistische Rekonstruktion des Turbogenerators.
const COASTDOWN_S = 30;

// Schmale automatische Leistungsregelung waehrend des Auslaufs -- historisch
// lief genau die weiter (Leistung blieb ~36s nahezu flach bei ~200 MWth,
// siehe INSAG-7/Sequence-of-Events), waehrend die bereits weit gezogenen
// Haupt-/Sicherheitsstaebe unangetastet blieben, bereit fuer AZ-5. Absichtlich
// NICHT ueber c.powerCtl (das wuerde die Stabstellung selbst bewegen und
// damit ORM/Spitzeneffekt verfaelschen), sondern als eigener, schwacher
// Reaktivitaets-Trimm ueber s.rho_ext -- mit klar begrenzter Autoritaet
// (AR_CAP_PCM), so wie eine reale automatische Regelgruppe nur einen
// kleinen Teil der 211 Staebe stellt, nicht die ganze Anlage.
const AR_CAP_PCM = 500;
const AR_SPEED_PCM_S = 60;
const AR_DEADBAND = 0.0005;

// Stabstellung beim Ausloesen des Auslaufs: weit draussen, auf dem
// ANSTEIGENDEN Ast der Graphitspitzen-Kurve (span/2 liegt beim Scheitel,
// siehe rbmk.js: _tipReactivity) -- damit hebt eine WEITERE Einfahrt (wie
// AZ-5 sie ausloest) die Reaktivitaet zunaechst an, genau der historisch
// dokumentierte Ablauf. Bei ~200-237 MWth reicht die 19-Minuten-Haltung aus
// prepare() nicht, um von selbst so tief zu stehen (siehe Machbarkeitspruefung
// weiter oben) -- die Uebung bildet deshalb ab, was historisch ohnehin nicht
// bestritten ist: die Mannschaft zog die Staebe unmittelbar vor dem Test
// weiter, bis die Abschaltreserve auf die dokumentierten 6-8 Stab-Aequivalente
// fiel. Der noetige Xenon-Ausgleich (s.X) wird dafuer live nachgezogen, nicht
// hart hinterlegt, damit er zum jeweils aktuellen (leicht gedrifteten)
// Zustand passt.
const WITHDRAW_ROD = 0.02;

export class RbmkChernobylTutorial extends StartupTutorial {
  get prefix() { return 'tut_chernobyl_'; }
  get steps() { return STEPS; }
  get holdSeconds() { return HOLD; }
  // Netzanforderung bleibt die ganze Nacht bei 0 MW -- dieser Test lief
  // nicht im normalen Lastfolgebetrieb (siehe scn_rbmk_post_az5 fuer denselben
  // Ansatz nach der Abschaltung).
  get demand() { return 0; }

  prepare() {
    const { state: s, ctx: c } = this.engine;
    // Validierter Zustand nach 100% -> 50% -> 9h halten -> 7% -> 60 min
    // halten (ORM ~28, ~237 MWth) -- siehe Machbarkeitspruefung. Nur die
    // primaer wirksamen Felder; Sekundaerkreis-Werte liegen bereits nahe am
    // Nennbetrieb und werden von der Physik selbst in den ersten Sekunden
    // zurechtgezogen.
    s.n = 0.06638556453081638;
    // Verzoegerte Neutronen (6 Gruppen) und Nachwaerme-Gruppen (7) MUESSEN
    // mitkommen -- ohne sie bleiben sie auf der Vollwert-Kalibrierung des
    // frischen Zustands stehen, waehrend n auf 7% gesetzt wird. Das erzeugt
    // eine Phantom-Neutronenquelle und einen Scheinausschlag beim ersten
    // Schritt, der nichts mit echter Physik zu tun hat (gefunden beim
    // Testen: n sprang sonst innerhalb einer Sekunde auf ueber 500%).
    s.c[0] = 0.8494278718822719; s.c[1] = 2.286348890593593;
    s.c[2] = 0.5613875575936552; s.c[3] = 0.41703172612494116;
    s.c[4] = 0.03212239311895662; s.c[5] = 0.00444378096738251;
    s.D[0] = 0.0015897458084510614; s.D[1] = 0.0012601264003539218;
    s.D[2] = 0.0007968142393641646; s.D[3] = 0.001524650577173896;
    s.D[4] = 0.0031171451536580507; s.D[5] = 0.0024607092868473377;
    s.D[6] = 0.0014993178908948082;
    // Neu bestimmt nach der Trennung von Absorber- und Spitzenwirkung in
    // rbmk.js (_rodReactivity/_orm/_tipReactivity): der alte Wert war unter
    // der vorherigen, ungetrennten Stabkurve kalibriert und liegt seither
    // nicht mehr auf rho=0. Mit der korrigierten Kurve verlangt derselbe
    // Xenon-Stand (1.3665) keine erreichbare kritische Stabstellung mehr --
    // die volle Kritikalitaetssuche (audit/build_chernobyl_state.mjs) haelt
    // deshalb X etwas niedriger (0.966 statt 1.3665, weiterhin deutlich
    // erhoeht) und findet die Stabstellung dazu neu. ORM sinkt dadurch von
    // ~28 auf ~37 -- ein rod-Wert von 0.40-0.42 waere naeher an den
    // historischen 6-8 gewesen, hielt aber den 19-Minuten-Haltevorgang
    // (siehe 'recover') nicht durch: ein kurzer Anfangsausschlag drueckte n
    // knapp unter die 5,5-%-Grenze und liess die Haltezeit neu anlaufen.
    // 0.44 gibt genug Regelspielraum, um diesen Anfangsausschlag abzufangen.
    s.rod[0] = s.rod[1] = 0.44;
    s.rodDmd[0] = s.rodDmd[1] = 0.44;
    s.T_f = 585.7547959561184;
    s.T_cl = 558.7573570680994;
    s.T_ci = 556.7348461520972;
    s.T_co = 558.0251027025131;
    s.T_mod = 558.0251027025131;
    s.T_gr = 590.2992690043193;
    s.alphaBar = 0.05437736108274518;
    s.I = 0.5931298469040777;
    s.X = 1.0216242145650234;
    s.Pm = 0.9227506372313031;
    s.Sm = 1.0253115326317221;
    // Zonenwerte im selben Verhaeltnis mitskaliert wie der Gesamtwert X.
    s.zTop = { I: 0.5701612430885139, X: 1.0342, Pm: 0.9177148539236004, Sm: 1.026975160511478 };
    s.zBot = { I: 0.6160984507196482, X: 1.0128, Pm: 0.927786420539006, Sm: 1.0236510174987252 };
    s.ao = 0.051032455524760566;
    s.C_B = 0;
    s.P_th = 236.7584178907257;
    s.P_e = 77.0953354021486;
    s.P_demand = 0;
    s.p_drum = s.p_prim = 68.99911481375386;
    s.L_drum = 0.5000089737503258;
    s.M_drum = 159999.76885224957;
    s.x_e = 0.011104025370192403;
    s.dTsub = 1.288828965210931;
    s.W_steam = 116.54178618353212;
    s.W_fw = s.W_fwDemand = s.W_fwMain = 116.5;
    s.gov = 0.053213531642249595;
    s.mcpDmd = 1;
    // Sechs von acht Hauptumwaelzpumpen laufen -- der historische Normalfall
    // vor der Zuschaltung der beiden zusaetzlichen (siehe Schritt 'pumps').
    // Ein frischer Zustand startet mit ALLEN acht laufend, deshalb hier
    // zwei explizit anhalten.
    for (let i = 0; i < 2; i++) c.mcp[i].trip();
    // Lag-Filter (siehe rbmk.js: ctx.voidLag/aoLag/dpLag) tragen eigenes,
    // von `s` getrenntes Gedaechtnis -- ohne diesen Abgleich blieben sie auf
    // der Vollwert-Kalibrierung des frischen Zustands stehen, und der erste
    // Rechenschritt erzeugte einen Scheinausschlag (gefunden beim Testen:
    // +400 pcm binnen einer Sekunde, ganz ohne echte Ursache).
    c.voidLag.set(s.alphaBar);
    c.aoLag.set(s.ao);
    c.dpLag.set(0);
    c.pPrev = s.p_drum;
    // Automatik bleibt AN, mit dem Sollwert dieses Zustands -- das ist der
    // validierte Pfad (siehe Machbarkeitspruefung, BACKLOG.md): manuelles
    // Stabziehen ohne Regler kollabierte im Test selbst bei voll gezogenen
    // Staeben unaufhaltsam auf null, auch OHNE zusaetzlichen Einbruch.
    c.powerCtl.auto = true;
    c.powerCtl.setpoint = s.n;
  }

  // 'handover' (0) UND 'dip' (1) brauchen beide eine explizite Bestaetigung
  // statt Auto-Weiterlauf nach Ablauf der Haltezeit: 'dip' ist reiner
  // Erzaehltext (siehe conditions()[1]/_triggerDip), der sonst nach 2s von
  // selbst weiterspringt, bevor er gelesen ist.
  get confirmIndices() { return [0, 1]; }

  conditions() {
    const { state: s, ctx: c } = this.engine;
    const d = this.engine.derive();
    const intact = !s.destroyed && !s.fault && !s.scram.active;
    const pressure = s.p_drum >= 60 && s.p_drum <= 76;
    const pumpsRunning = c.mcp.filter(p => p.running && p.speed >= 0.9).length;
    return [
      // 0 handover: der uebernommene Zustand ist genau das, was die
      // Spaetschicht hinterlassen hat -- ~7 % Leistung, deutlich reduzierte
      // Abschaltreserve, intakt.
      intact && pressure && s.n >= 0.05 && s.n <= 0.085 && d.orm >= 15,
      // 1 dip: reine Einordnung im Text (siehe _triggerDip), keine
      // mechanische Simulation des Einbruchs -- die Anlage bleibt im bereits
      // erholten Zustand aus prepare().
      intact,
      // 2 recover: von Hand zurueck auf ~200 MWth, UND dort halten -- die
      // eigentliche 19-Minuten-Phase.
      intact && pressure && s.n >= 0.055 && s.n <= 0.09,
      // 3 pumps: die zwei zusaetzlichen Hauptumwaelzpumpen zuschalten.
      intact && pumpsRunning >= 8,
      // 4 test: der Kuehlmittelauslauf laeuft (siehe _triggerCoastdown).
      // Schliesst frueh, sobald der Durchsatz sichtbar faellt -- 'window'
      // (naechster Schritt) zeigt danach den Leistungsanstieg selbst live an.
      intact && s.mcpDmd < 0.9,
      // 5 window: reine Anzeige (siehe STEPS oben) -- bleibt "warte" stehen,
      // WAEHREND die Leistung sichtbar steigt, und schliesst erst zu 'az5'
      // weiter, sobald PRESS_WINDOW erreicht ist (das Druecken dann auch
      // tatsaechlich zerstoert). ODER sobald tatsaechlich gedrueckt wurde
      // (auch ausserhalb des Fensters, der Knopf war nie gesperrt) -- sonst
      // bliebe dieser Schritt fuer einen zu frueh/spaet druenckenden Spieler
      // fuer immer "nicht geschafft" stehen, obwohl die Runde laengst vorbei
      // ist.
      (intact && this._inPressWindow(s)) || s.scram.active,
      // 6 az5: Schnellabschaltung ausgeloest. Ob das noch glimpflich ausgeht
      // oder nicht, entscheidet danach die Physik -- nicht dieser Schritt
      // (siehe RunState.checkFail(), das immer VOR tutorial.done greift).
      s.scram.active,
    ];
  }

  /** Sekunden seit Auslaufbeginn, oder -1 vor dessen Start (siehe _runbackT0). */
  _sinceRunback(s) {
    return this._runbackT0 != null ? s.t_sim - this._runbackT0 : -1;
  }

  /** Innerhalb des angezeigten Fensters (siehe PRESS_WINDOW)? */
  _inPressWindow(s) {
    const t = this._sinceRunback(s);
    return t >= PRESS_WINDOW[0] && t <= PRESS_WINDOW[1];
  }

  completeStep() {
    const finishedId = this.steps[this.index];
    super.completeStep();
    // 'handover' -> 'dip' loest bewusst NICHTS aus: der historische
    // Leistungseinbruch (siehe INSAG-7, Ursache nicht abschliessend
    // geklaert) wird NICHT mechanisch nachgestellt. Getestet wurde ein
    // echter Reaktivitaetseinbruch ueber die Steuerstaebe -- selbst ein
    // kurzer, moderater (rund 17s, n auf ~1,7%) riss mehr Xenon auf, als
    // sich mit dem verbleibenden Stabwert je zurueckholen liess, AUCH mit
    // voll gezogenen Staeben. Das ist eine echte Grenze dieses
    // vereinfachten Modells, keine Kalibrierfrage -- die reale Mannschaft
    // schaffte die Erholung auf ~200 MW tatsaechlich. Diese Uebung
    // uebernimmt den bereits erholten Zustand direkt (siehe prepare()) und
    // zeigt den Einbruch nur als historische Einordnung im Anleitungstext
    // von 'dip', ohne die Simulation hindurchzufahren.
    if (finishedId === 'pumps') this._triggerCoastdown();
  }

  _triggerCoastdown() {
    const { state: s, ctx: c } = this.engine;
    // Der VOLLE Leistungsregler (c.powerCtl, bewegt beide Stabbaenke und
    // damit ORM/Spitzeneffekt) bleibt aus -- er wuerde sonst genau die
    // Staebe zurueckziehen, die fuer AZ-5 weit draussen stehen muessen.
    // Stattdessen uebernimmt ab hier der schmale AR-Trimm (siehe step()
    // unten) die Rolle der historischen automatischen Regelgruppe.
    c.powerCtl.auto = false;
    this._withdrawToTipSpan();
    c.arTrim = { rho: s.rho_ext || 0, setpoint: s.n };
    c.mcpRunback = { from: s.mcpDmd, to: 0, t0: s.t_sim, dur: COASTDOWN_S };
    // Eigener Merker, NICHT ueber c.mcpRunback.t0 -- events.js setzt
    // c.mcpRunback auf null, sobald die 30s-Rampe fertig ist (siehe
    // stepEvents), aber das zweite Zerstoerungsfenster (39-43s) liegt bereits
    // danach. Der Countdown fuer den Spieler (siehe view()) muss also laenger
    // leben als die Rampe selbst.
    this._runbackT0 = s.t_sim;
  }

  /**
   * Letzter Stabzug vor dem Test (siehe WITHDRAW_ROD oben): auf den engen
   * Bereich unterhalb der Graphitspitzen-Spanne, mit gerade so viel mehr
   * Xenon, wie es braucht, um dort wieder kritisch zu sein -- der aktuelle
   * (durch 19 Minuten Betrieb leicht gedriftete) Zustand bleibt sonst
   * unangetastet.
   */
  _withdrawToTipSpan() {
    const { state: s, spec: sp, reactivity } = this.engine;
    const xenonPcm = sp.feedback.xenon_worth_pcm * 1e-5;
    s.rod[0] = s.rod[1] = s.rodDmd[0] = s.rodDmd[1] = WITHDRAW_ROD;
    const rho = reactivity.compute(s, sp);
    const dX = rho / xenonPcm;
    if (Number.isFinite(dX) && dX > 0) {
      const scale = (s.X + dX) / s.X;
      s.X *= scale;
      if (s.zTop) s.zTop.X *= scale;
      if (s.zBot) s.zBot.X *= scale;
    }
  }

  /** Schmale automatische Regelgruppe: siehe AR_CAP_PCM oben. */
  step(dt) {
    super.step(dt);
    const { state: s, ctx: c } = this.engine;
    const trim = c.arTrim;
    if (!trim || s.scram.active) return;
    const err = s.n - trim.setpoint;
    if (Math.abs(err) > AR_DEADBAND) {
      trim.rho = clamp(trim.rho - Math.sign(err) * AR_SPEED_PCM_S * 1e-5 * dt,
        -AR_CAP_PCM * 1e-5, AR_CAP_PCM * 1e-5);
    }
    s.rho_ext = trim.rho;
  }

  hint() {
    const { state: s, ctx: c } = this.engine;
    const id = this.steps[this.index];
    if (id === 'handover') return 'tut_chernobyl_hint_handover';
    if (id === 'dip') return 'tut_chernobyl_hint_dip';
    if (id === 'recover') {
      if (s.n < 0.055) return 'tut_hint_pull';
      if (s.n > 0.09) return 'tut_hint_insert';
      return 'tut_chernobyl_hint_recover_hold';
    }
    if (id === 'pumps') return 'tut_chernobyl_hint_pumps';
    if (id === 'test') return 'tut_chernobyl_hint_test';
    if (id === 'window' || id === 'az5') return this._windowHint(s);
    return 'tut_hint_wait';
  }

  /**
   * Drei Zustaende relativ zu PRESS_WINDOW, geteilt zwischen 'window' (zeigt
   * sie an) und 'az5' (der Spieler kann dort immer noch zu spaet sein).
   */
  _windowHint(s) {
    const t = this._sinceRunback(s);
    if (t < 0) return 'tut_hint_wait';
    if (t < PRESS_WINDOW[0]) return 'tut_chernobyl_hint_window_wait';
    if (t <= PRESS_WINDOW[1]) return 'tut_chernobyl_hint_window_now';
    return 'tut_chernobyl_hint_window_after';
  }

  snapshot() {
    return { ...super.snapshot(), reactor: 'rbmk',
      runbackT0: Number.isFinite(this._runbackT0) ? this._runbackT0 : null };
  }

  restore(data) {
    super.restore(data);
    this._runbackT0 = Number.isFinite(data?.runbackT0) ? data.runbackT0 : null;
  }

  view() {
    const view = super.view();
    const { state: s, ctx: c } = this.engine;
    // Sekunden seit Auslaufbeginn -- treibt sowohl den 'window'-Schritt
    // (siehe conditions()[5]/_inDestroyWindow) als auch die Anzeige fuer den
    // Spieler, damit sich die Zerstoerungsfenster (7-22s, 39-43s) tatsaechlich
    // treffen lassen, statt sie im Kopf mitzuzaehlen.
    const sinceRunback = Number.isFinite(this._runbackT0) ? Math.max(0, s.t_sim - this._runbackT0) : null;
    return { ...view, values: { ...view.values, pressure: s.p_drum,
      level: s.L_drum * 100, orm: this.engine.derive().orm,
      pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length,
      mcpFlow: s.mcpDmd * 100, sinceRunback: sinceRunback ?? 0 } };
  }
}
