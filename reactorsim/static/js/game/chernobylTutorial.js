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
// 'pumps' (Index 3) schaltet die beiden zusaetzlichen Hauptumwaelzpumpen
// selbst zu (siehe AUTO_PUMPS_S/step() unten) -- seit dem Vorfuehrmodus ist
// das die letzte ehemals von Hand gefahrene Handlung dieser Uebung.
// 'test' (Index 4) haelt nur kurz -- der Schritt schliesst, sobald der
// Auslauf sichtbar begonnen hat. Der schmale AR-Trimm (siehe unten) haelt die
// Leistung bis zum Druecken von AZ-5 nahe am Sollwert -- wie historisch
// (Leistung blieb ~36s nahezu flach bei ~200 MWth) faellt die Anlage NICHT
// von selbst durch, solange AZ-5 nicht gedrueckt wird.
// 'window' (Index 5) ist reine Anzeige und laeuft, bis das Drehbuch AZ-5
// ausloest (siehe conditions()[5]/AUTO_SCRAM_S) -- rund sechs Sekunden, in
// denen der Auslauf schon laeuft und die Sekundenanzeige mitzaehlt.
// 'az5' (Index 6) haelt bewusst 15s, nicht nur 1: der promptkritische
// Exkurs (siehe _rodReactivity/_tipReactivity in rbmk.js) braucht nach dem
// Druecken selbst noch mehrere Sekunden, bis die Brennstoffenthalpie-Grenze
// erreicht wird -- eine zu kurze Haltezeit wuerde den Schritt als
// "geschafft" abschliessen, bevor die Physik ueberhaupt zu Ende gelaufen ist
// (RunState.checkFail() greift zwar vor tutorial.done, aber nur wenn beide
// ueberhaupt noch laufen).
const HOLD = [5, 2, 1140, 3, 5, 0.2, 15];

// Sekunden seit Auslaufbeginn, in denen AZ-5 den Kern zerstoert. Sekundenweise
// nachgemessen ueber den echten prepare()-Pfad:
//
//   8-21 s : AZ-5 zerstoert den Kern -- ECHTE Wirkung des Knopfes. Die
//            Graphitspitzen schieben beim Einfahren aus weit gezogener
//            Stellung mehr Reaktivitaet ein, als der Absorber gleich danach
//            wegnimmt (_tipReactivity/_rodReactivity in rbmk.js).
//   22-38 s: AZ-5 zerstoert den Kern NICHT -- die Enthalpiegrenze ist ein
//            integrales Kriterium (siehe engine.js): eine kurze, hohe Spitze
//            (gemessen bis 360 %) ueberlebt der Brennstoff, ein langsamerer
//            anhaltender Anstieg nicht.
//   39-43 s: zerstoert wieder -- hier faellt der Knopfdruck in den Scheitel
//            des Anstiegs, den der positive Dampfblasenkoeffizient ab ~t+33s
//            von selbst treibt. OHNE jeden Knopfdruck laeuft dieser Anstieg
//            auf 133 % bei t+38s und bleibt knapp diesseits der Grenze -- aber
//            nur, weil der schmale AR-Trimm mit seinen 500 pcm gegenhaelt
//            (ohne ihn versagt der Brennstoff schon bei t+19s). So knapp ist
//            der Abstand hier: siehe tut_chernobyl_debrief_note, das genau
//            diesen zweiten Befund ausspricht, und den zugehoerigen Test.
//   ab 44 s: zerstoert nicht mehr -- der Anstieg ist bereits abgeklungen.
const DESTROY_WINDOWS = [[8, 21], [39, 43]];

// Das Fenster, in dem AZ-5 tatsaechlich die Ursache ist -- siehe oben.
const PRESS_WINDOW = DESTROY_WINDOWS[0];

// AZ-5 loest in DIESEM Tutorial automatisch aus, in der Mitte von
// PRESS_WINDOW (also mit 6,5 s Abstand zu beiden Raendern). Zwei Gruende:
// der Zeitpunkt haengt an der axialen Schieflage im Augenblick des Drueckens
// (_tipReactivity in rbmk.js) und ist fuer einen Menschen ohne Anhaltspunkt
// nicht treffbar (Nutzerrueckmeldung: "kein Mensch versteht wann er AZ5
// druecken muss"), und der Doppelklick des AZ-5-Knopfes (erst "scharf", dann
// "bestaetigen", siehe main.js initControls()) frisst die Reaktionszeit
// ohnehin auf. engine.scram() ist idempotent.
const AUTO_SCRAM_S = (PRESS_WINDOW[0] + PRESS_WINDOW[1]) / 2;

// Wartezeit im Schritt 'pumps', bevor das Drehbuch die beiden zusaetzlichen
// Hauptumwaelzpumpen selbst zuschaltet. Kein physikalischer Wert -- nur
// lang genug, dass der Schritt samt Begruendung lesbar auf dem Schirm steht,
// bevor er sich selbst erledigt. Nachgemessen ist der Zeitpunkt unkritisch:
// zwischen sofortigem Zuschalten und 300 s Verzoegerung aendert sich der
// Zustand beim Auslaufbeginn praktisch nicht (n bleibt 6,3 %, ORM 76,x), der
// Kern wird in allen Faellen zerstoert.
const AUTO_PUMPS_S = 3;

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

// Uhrzeit der Nacht zum 26.04.1986 -- eine ZWEITE Zeitanzeige neben der
// Betriebszeit (die weiter stur ab null zaehlt, siehe status_clock). Sie
// beantwortet die Frage, die die Betriebszeit nicht beantworten kann: an
// welcher Stelle der historischen Nacht steht der Ablauf gerade?
//
// Die Uhr laeuft 1:1 mit t_sim und macht genau EINEN Sprung -- am Ende des
// Schritts 'dip', also dort, wo der Text ohnehin sagt, dass diese Stunde
// NICHT nachgestellt wird (Leistungseinbruch um 00:28 plus Erholung, siehe
// completeStep()). Vor dem Sprung zeigt sie die Schichtuebernahme kurz nach
// Mitternacht, danach die Stunde vor der Explosion.
//
// WALL_DIP_S ist so gewaehlt, dass AZ-5 auf die historische Sekunde faellt:
// vom Ende des Schritts 'dip' bis zum Knopfdruck vergehen im Drehbuch
// 1172,5 s (1140 s Haltephase + ~18 s Pumpenhochlauf + AUTO_SCRAM_S), also
// 01:23:40 - 1172,5 s = 01:04:07,5, aufgerundet auf die volle Sekunde. Die
// Zerstoerung liegt damit bei ~01:23:44, ebenfalls historisch. Der Test
// 'die Uhrzeit trifft die historischen Marken' misst das nach, statt es zu
// behaupten -- aendert sich eine der drei Zeiten oben, faellt er um.
//
// Was die Uhr NICHT leisten kann: die beiden zusaetzlichen Pumpen liefen
// historisch ab 01:07, also MITTEN in der Haltephase. Diese Uebung schaltet
// sie der Reihe nach erst danach zu (eigener Schritt), und eine Uhr, die
// nicht rueckwaerts laufen soll, kann diese Umstellung nicht verstecken --
// der Schritt 'pumps' zeigt deshalb ~01:23:25 und sagt das in seinem Text
// auch so. Nachgemessen ist der Zeitpunkt der Zuschaltung fuer den Ausgang
// ohne Bedeutung (siehe AUTO_PUMPS_S).
const WALL_DIP_S = 1 * 3600 + 4 * 60 + 8; // 01:04:08

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
    // Uhr auf die Schichtuebernahme kurz nach Mitternacht -- bis zum Sprung
    // im Schritt 'dip' laeuft sie deckungsgleich mit der Betriebszeit.
    this._setWallOffset(0);
  }

  // 'handover' (0) UND 'dip' (1) brauchen beide eine explizite Bestaetigung
  // statt Auto-Weiterlauf nach Ablauf der Haltezeit: 'dip' ist reiner
  // Erzaehltext (siehe conditions()[1]/_triggerDip), der sonst nach 2s von
  // selbst weiterspringt, bevor er gelesen ist.
  get confirmIndices() { return [0, 1]; }

  // 'window' (5) haelt intern nur HOLD[5]=0.2s (ein Entprellwert fuer den
  // fast-instant Uebergang zu 'az5', siehe STEPS-Kommentar), keine echte
  // Wartezeit -- "0/0.2 s" in der Kopfzeile sah aus wie "gleich fertig",
  // waehrend tatsaechlich noch bis zu ~35s auf PRESS_WINDOW zu warten ist
  // (Nutzerrueckmeldung). 'az5' (6) zeigt aus demselben Grund den Hinweis
  // statt der 15s-Haltezeit: waehrend der Physik-Nachlauf laeuft, ist "noch
  // 12 von 15 s" die unwichtigste Zahl auf dem Schirm -- der Hinweistext
  // sagt stattdessen, ob AZ-5 schon ausgeloest hat (window_wait/window_now).
  get liveStatusIndices() { return [5, 6]; }

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
      // 3 pumps: die zwei zusaetzlichen Hauptumwaelzpumpen laufen. Das
      // Drehbuch schaltet sie selbst zu (siehe step()/AUTO_PUMPS_S) -- die
      // Bedingung bleibt als Pruefung stehen, nicht als Aufgabe.
      intact && pumpsRunning >= 8,
      // 4 test: der Kuehlmittelauslauf laeuft (siehe _triggerCoastdown).
      // Schliesst frueh, sobald der Durchsatz sichtbar faellt -- 'window'
      // (naechster Schritt) zeigt danach den Leistungsanstieg selbst live an.
      intact && s.mcpDmd < 0.9,
      // 5 window: reine Anzeige (siehe STEPS oben) -- laeuft, bis das
      // Drehbuch AZ-5 ausloest (step()/AUTO_SCRAM_S). Nicht an
      // _inPressWindow() gebunden, obwohl der Schritt genau darin liegt: der
      // Beginn des Fensters (t+7s) faellt fast mit dem Ende von 'test'
      // zusammen, der Schritt waere dann kaum sichtbar -- so bleibt er bis
      // zum Knopfdruck stehen.
      s.scram.active,
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

  /** Innerhalb des Fensters, in dem AZ-5 wirklich zerstoert (PRESS_WINDOW)?
   *  Nur noch Selbstpruefung: das Drehbuch drueckt in dessen Mitte, diese
   *  Bedingung muss dabei zutreffen (siehe Test). */
  _inPressWindow(s) {
    const t = this._sinceRunback(s);
    return t >= PRESS_WINDOW[0] && t <= PRESS_WINDOW[1];
  }

  /** Vorfuehrmodus: solange die Uebung laeuft, fuehrt das Drehbuch die
   *  Stellteile, nicht der Spieler (siehe ui/controls.js: setControlsLocked).
   *  Anzeigen, Trends, Quittieren und Speichern bleiben frei -- gesperrt ist
   *  nur, was den nachgestellten Ablauf verschieben wuerde. */
  get locked() { return !this.done; }

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
    //
    // Genau hier springt deshalb die Uhr (siehe WALL_DIP_S): die uebersprungene
    // Stunde ist der Inhalt dieses Schritts, nicht ein Rechenfehler.
    if (finishedId === 'dip') this._setWallOffset(WALL_DIP_S - this.engine.state.t_sim);
    // Uhrzeit des Abschlusses mitschreiben -- die Schrittliste im Debrief
    // (siehe ui/tutorial.js: renderTutorialResult) zeigt sonst nur die
    // Betriebszeit, und gerade dort ist "AZ-5 · 01:23:40" der Punkt. Der
    // Sprung oben steht bewusst VOR dieser Zeile: der Schritt 'dip' ist der,
    // in dem die Stunde vergeht, also endet er auch nach ihr.
    const entry = this.completed[this.completed.length - 1];
    if (entry) entry.w = this._wallSeconds();
    if (finishedId === 'pumps') this._triggerCoastdown();
  }

  /** Versatz zwischen Betriebszeit und Uhrzeit -- auch fuer die Statuskachel
   *  'wallclock' im Anlagenzustand hinterlegt (siehe ui/panels.js), die den
   *  Tutorialzustand sonst nicht sehen kann. */
  _setWallOffset(offset) {
    this._wallOffset = offset;
    this.engine.ctx.wallClock = offset;
  }

  /** Sekunden seit Mitternacht des 26.04.1986 (siehe WALL_DIP_S). */
  _wallSeconds() {
    return this.engine.state.t_sim + (this._wallOffset || 0);
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

  /** Drehbuch (Pumpen, AZ-5) plus schmale Regelgruppe: siehe AR_CAP_PCM oben. */
  step(dt) {
    super.step(dt);
    const { state: s, ctx: c } = this.engine;
    // Die beiden zusaetzlichen Hauptumwaelzpumpen (siehe AUTO_PUMPS_S) --
    // start() ist idempotent genug (siehe components.js), aber die Pruefung
    // spart den Aufruf in jedem Takt. Eine durch ein Ereignis ausgefallene
    // Pumpe (ctx.pumpsStuck) bliebe stehen; dieses Szenario kennt keine.
    if (this.steps[this.index] === 'pumps' && this.elapsed >= AUTO_PUMPS_S) {
      for (const p of c.mcp) if (!p.running) p.start();
    }
    // AZ-5 automatisch bei AUTO_SCRAM_S (siehe dort) -- idempotent (siehe
    // engine.scram()).
    if (!s.scram.active && this._sinceRunback(s) >= AUTO_SCRAM_S) {
      this.engine.scram('az5');
    }
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
    const s = this.engine.state;
    const id = this.steps[this.index];
    if (id === 'handover') return 'tut_chernobyl_hint_handover';
    if (id === 'dip') return 'tut_chernobyl_hint_dip';
    // Kein 'tut_hint_pull'/'tut_hint_insert' mehr wie in den Anfahrtutorials:
    // die Staebe sind im Vorfuehrmodus gesperrt, ein Hinweis "jetzt ziehen"
    // waere eine Aufforderung zu etwas, das der Spieler gar nicht kann.
    if (id === 'recover') return 'tut_chernobyl_hint_recover_hold';
    if (id === 'pumps') return 'tut_chernobyl_hint_pumps';
    if (id === 'test') return 'tut_chernobyl_hint_test';
    if (id === 'window' || id === 'az5') return this._windowHint(s);
    return 'tut_hint_wait';
  }

  /**
   * Geteilt zwischen 'window' (wartet auf den Knopfdruck) und 'az5' (danach).
   * Seit das Drehbuch selbst drueckt, gibt es kein "zu spaet" mehr -- der
   * Zustand haengt allein daran, ob AZ-5 schon ausgeloest hat.
   */
  _windowHint(s) {
    if (this._sinceRunback(s) < 0) return 'tut_hint_wait';
    return s.scram.active ? 'tut_chernobyl_hint_window_now'
      : 'tut_chernobyl_hint_window_wait';
  }

  snapshot() {
    return { ...super.snapshot(), reactor: 'rbmk',
      runbackT0: Number.isFinite(this._runbackT0) ? this._runbackT0 : null,
      // Ohne den Versatz liefe die Uhr nach dem Laden wieder ab Mitternacht,
      // waehrend die Schrittliste bereits 01:23 zeigt (die Uhrzeiten der
      // erledigten Schritte stecken in completed[].w und kaemen mit).
      wallOffset: this._wallOffset || 0 };
  }

  restore(data) {
    super.restore(data);
    this._runbackT0 = Number.isFinite(data?.runbackT0) ? data.runbackT0 : null;
    // Nur uebernehmen, wenn der Schritt mit dem Sprung laut wiederhergestelltem
    // Stand ueberhaupt schon vorbei ist -- super.restore() verwirft
    // widerspruechliche Staende stillschweigend, und eine Uhr, die dann auf
    // 01:23 stuende, waere die einzige Anzeige, die davon nichts mitbekommt.
    const jumped = this.index > this.steps.indexOf('dip');
    this._setWallOffset(jumped && Number.isFinite(data?.wallOffset) ? data.wallOffset : 0);
  }

  view() {
    const view = super.view();
    const { state: s, ctx: c } = this.engine;
    // Sekunden seit Auslaufbeginn -- treibt den automatischen Knopfdruck
    // (siehe step()/AUTO_SCRAM_S) und die Anzeige fuer den Spieler, damit der
    // Zeitpunkt des Druckens gegen das gemessene Wirkfenster (PRESS_WINDOW,
    // 8-21s) nachvollziehbar bleibt, statt eine Behauptung zu sein.
    const sinceRunback = Number.isFinite(this._runbackT0) ? Math.max(0, s.t_sim - this._runbackT0) : null;
    // `wall` steht bewusst NEBEN values, nicht darin: values geht als
    // Zahlenbeutel durch num() in die *_values-Textbausteine (siehe
    // ui/tutorial.js), eine Uhrzeit waere dort "5.020,0".
    return { ...view, wall: this._wallSeconds(), values: { ...view.values, pressure: s.p_drum,
      level: s.L_drum * 100, orm: this.engine.derive().orm,
      pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length,
      mcpFlow: s.mcpDmd * 100, sinceRunback: sinceRunback ?? 0 } };
  }
}
