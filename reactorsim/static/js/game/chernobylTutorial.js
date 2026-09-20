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

const STEPS = ['handover', 'dip', 'recover', 'pumps', 'hold', 'test', 'window', 'az5'];
// Die 19 Minuten Haltezeit vor dem Versuch sind seit 0.6.1 ZWEIGETEILT --
// 'recover' (Index 2) bis 01:07, dann 'pumps', dann 'hold' (Index 4) bis zum
// Testbeginn. Vorher lief die ganze Haltephase am Stueck und die Pumpen kamen
// erst DANACH, weshalb ihre Zuschaltung auf der Uhr 01:23:25 zeigte statt der
// historischen 01:07 (siehe BACKLOG.md). Die Summe der beiden Haltezeiten
// bleibt bei rund 19 Minuten; nachgemessen aendert die fruehere Zuschaltung
// den Zustand beim Auslaufbeginn praktisch nicht (n 6,25 % -> 6,29 %,
// Kernstrom 10.356 -> 10.500 kg/s, Spitze 334 % -> 338 %, zerstoert in beiden
// Faellen -- tests/tools/chernobyl_pumps_early.mjs).
// 'pumps' (Index 3) schaltet die beiden zusaetzlichen Hauptumwaelzpumpen
// selbst zu (siehe AUTO_PUMPS_S/step() unten) -- seit dem Vorfuehrmodus ist
// das die letzte ehemals von Hand gefahrene Handlung dieser Uebung.
// 'hold' (Index 4) haelt bis zum Testbeginn. Seine Dauer steht NICHT fest,
// sondern zielt auf eine Uhrzeit (siehe holdSeconds() unten): der
// Pumpenhochlauf davor dauert, was er dauert, und der Auslauf soll trotzdem
// auf die Sekunde dort beginnen, wo AZ-5 danach auf 01:23:40 faellt.
// 'test' (Index 5) haelt nur kurz -- der Schritt schliesst, sobald der
// Auslauf sichtbar begonnen hat. Der schmale AR-Trimm (siehe unten) haelt die
// Leistung bis zum Druecken von AZ-5 nahe am Sollwert -- wie historisch
// (Leistung blieb ~36s nahezu flach bei ~200 MWth) faellt die Anlage NICHT
// von selbst durch, solange AZ-5 nicht gedrueckt wird.
// 'window' (Index 6) ist reine Anzeige und laeuft, bis das Drehbuch AZ-5
// ausloest (siehe conditions()[6]/AUTO_SCRAM_S) -- rund sechs Sekunden, in
// denen der Auslauf schon laeuft und die Sekundenanzeige mitzaehlt.
// 'az5' (Index 7) haelt bewusst 15s, nicht nur 1: der promptkritische
// Exkurs (siehe _rodReactivity/_tipReactivity in rbmk.js) braucht nach dem
// Druecken selbst noch mehrere Sekunden, bis die Brennstoffenthalpie-Grenze
// erreicht wird -- eine zu kurze Haltezeit wuerde den Schritt als
// "geschafft" abschliessen, bevor die Physik ueberhaupt zu Ende gelaufen ist
// (RunState.checkFail() greift zwar vor tutorial.done, aber nur wenn beide
// ueberhaupt noch laufen).
// Die Haltezeit von 'recover' reicht vom Uhrensprung bis zur
// Pumpenzuschaltung (siehe WALL_DIP_S weiter unten); die von 'hold' steht
// hier nur als Rueckfallwert -- der wirkliche Wert kommt aus der Uhr.
const RECOVER_HOLD_S = 172;
const HOLD_FALLBACK_S = 971;
// 'dip' haelt 10 s, nicht 2: der Schritt schliesst erst, wenn die Leistung
// nach dem Einbruch wirklich wieder ruhig im Band steht, nicht schon beim
// Durchschwingen der Regelung.
const HOLD = [5, 10, RECOVER_HOLD_S, 3, HOLD_FALLBACK_S, 5, 0.2, 15];

// Sekunden seit Auslaufbeginn, in denen AZ-5 den Kern zerstoert.
// Sekundenweise nachgemessen ueber den echten prepare()-Pfad
// (tests/tools/chernobyl_press_window.mjs), NEU seit der Turbinenauslauf eine
// echte Rotordrehzahl ist (rbmk.js sp.turbogen) statt einer Rampe auf null:
//
//   0-12 s : AZ-5 zerstoert den Kern NICHT. Der Rotor hat erst ein Drittel
//            seiner Drehzahl verloren, der Kern ist noch gut gekuehlt -- die
//            Graphitspitzen heben die Leistung zwar auf ueber 250 %, aber der
//            Brennstoff haelt die Enthalpiegrenze (ein integrales Kriterium,
//            siehe engine.js). Genau das ist die Lehre der Uebung: der Knopf
//            allein tut es nicht, es ist die KOMBINATION.
//   13 s   : einzelner Treffer dicht an der Schwelle, 14 s wieder nicht --
//            der Rand ist keine scharfe Kante, sondern eine Zone.
//   ab 15 s: zerstoert, durchgehend bis zum Ende des vermessenen Bereichs
//            (105 s; was darueber steht, faellt schon aus dem Beobachtungs-
//            fenster der Messung und ist kein Befund).
//
// Verschwunden ist damit der frueher dokumentierte "Ueberlebensstreifen"
// zwischen 22 und 38 s. Er war eine Eigenschaft der alten, auf NULL
// gefahrenen Rampe -- die trieb die Anlage schon ohne jeden Knopfdruck auf
// 133 % und liess nur eine kurze Spitze zu. Mit vier Pumpen weiter am Netz
// passiert das nicht mehr: ohne AZ-5 bleibt die Leistung bei 7,6 % (siehe
// tut_chernobyl_debrief_note und den zugehoerigen Test). Der Knopf ist damit
// nicht mehr nur die Ursache, er ist die einzige.
const DESTROY_WINDOWS = [[13, 13], [15, 105]];

// Das Fenster, in dem AZ-5 tatsaechlich die Ursache ist -- siehe oben.
const PRESS_WINDOW = DESTROY_WINDOWS[1];

// AZ-5 loest in DIESEM Tutorial automatisch aus -- 36 s nach Testbeginn, also
// genau im historischen Abstand (Testbeginn 01:23:04, AZ-5 01:23:40).
//
// Bis 0.6.0 war das nicht moeglich: das damalige Wirkfenster endete bei 21 s,
// das Drehbuch drueckte deshalb bei 14,5 s, und die Uebung musste zwischen
// dem historischen Testbeginn und der historischen AZ-5-Sekunde waehlen
// (siehe BACKLOG.md, "Historische Zeitverhaeltnisse gerafft"). Mit dem echten
// Rotorauslauf reicht das Fenster bis weit hinter 36 s, also treffen jetzt
// BEIDE Zeiten.
//
// Dass ueberhaupt das Drehbuch drueckt und nicht der Spieler, bleibt: der
// Doppelklick des AZ-5-Knopfes (erst "scharf", dann "bestaetigen", siehe
// main.js initControls()) frisst die Reaktionszeit ohnehin auf, und der
// Vorfuehrmodus sperrt ihn (Nutzerrueckmeldung: "kein Mensch versteht wann er
// AZ5 druecken muss"). engine.scram() ist idempotent.
const AUTO_SCRAM_S = 36;

// Wartezeit im Schritt 'pumps', bevor das Drehbuch die beiden zusaetzlichen
// Hauptumwaelzpumpen selbst zuschaltet. Kein physikalischer Wert -- nur
// lang genug, dass der Schritt samt Begruendung lesbar auf dem Schirm steht,
// bevor er sich selbst erledigt. Nachgemessen ist der Zeitpunkt unkritisch:
// zwischen sofortigem Zuschalten und 300 s Verzoegerung aendert sich der
// Zustand beim Auslaufbeginn praktisch nicht (n bleibt 6,3 %, ORM 76,x), der
// Kern wird in allen Faellen zerstoert.
const AUTO_PUMPS_S = 3;

// Der Leistungseinbruch der Nacht -- seit 0.6.1 wirklich gefahren, nicht mehr
// nur im Text erzaehlt.
//
// Bis 0.6.0 stand hier, ein echter Einbruch reisse in diesem vereinfachten
// Modell mehr Xenon auf, als sich mit den verbleibenden Staeben je
// zurueckholen lasse. Das galt fuer die damalige, ungetrennte Stabkurve. Seit
// _rodReactivity und _orm in rbmk.js Absorber- und Spitzenwirkung
// auseinanderhalten, stimmt es nicht mehr: nachgemessen
// (tests/tools/chernobyl_dip.mjs) kommt die Anlage aus Einbruechen bis
// hinunter zu 0,05 % zuverlaessig wieder auf 7,3 % -- mit ORM ~76 und
// rho ~0 pcm, also praktisch auf den Zustand, den prepare() vorher fest
// hinterlegt hat. Xenon spielt dabei kaum eine Rolle: ein Einbruch von
// Sekunden bis Minuten ist gegen die Jod-Halbwertszeit von knapp sieben
// Stunden zu kurz (X steigt von 1,022 auf 1,058).
//
// Gefahren wird ein MASSVOLLER Einbruch. Tiefer geht auch, aber die
// Leistungsregelung schiesst beim Zurueckholen dann weit ueber (gemessen
// 134 % aus 0,05 % heraus) -- das waere eine Eigenschaft des Reglers, keine
// Aussage ueber die Nacht.
const DIP_DEPTH = 0.017;        // ~50 MWth
const DIP_ROD_RATE = 0.012;     // Anteil Fahrweg je Sekunde
const DIP_HOLD_S = 17;

// Zeitlupe fuer die Sekunden, um die es geht.
//
// Zwischen dem Knopfdruck (AUTO_SCRAM_S, 36 s nach Auslaufbeginn) und der
// Brennstoffzerstoerung liegen rund fuenf Sekunden. Bei 1x ist das genau der
// Moment, den die ganze Uebung aufbaut -- und er ist vorbei, bevor der Blick
// von der Leistungsanzeige zum Reaktivitaetsbalken gewandert ist. Bei 1/4x
// dauert derselbe Vorgang zwanzig Sekunden; gerechnet wird dabei nichts
// anderes, der Zeitschritt ist fest (DT in loop.js), nur die Zahl der
// Schritte je Realsekunde sinkt.
//
// Der Beginn liegt bewusst VOR dem Knopfdruck: die Umschaltung selbst soll
// nicht in den Ausschlag fallen, sondern vorher sitzen. Ein Ende gibt es
// nicht -- ab hier bleibt es langsam, bis die Uebung vorbei ist.
const SLOWMO_SPEED = 0.25;
const SLOWMO_FROM_S = AUTO_SCRAM_S - 4;


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
// dokumentierte Ablauf. Bei ~200-237 MWth reicht die Haltephase nicht, um von
// selbst so tief zu stehen -- die Uebung bildet deshalb ab, was historisch
// ohnehin nicht bestritten ist: die Mannschaft zog die Staebe unmittelbar vor
// dem Test weiter. Der noetige Xenon-Ausgleich (s.X) wird dafuer live
// nachgezogen, nicht hart hinterlegt, damit er zum jeweils aktuellen (leicht
// gedrifteten) Zustand passt.
//
// Warum ausgerechnet 0,02 und nicht die historische Einfahrtiefe von 1,25 m
// (also h = tip.span = 0,179, wo die Abschaltreserve genau die dokumentierten
// 7,4 Stabaequivalente anzeigt)? Nachgemessen
// (tests/tools/chernobyl_rod_sweep.mjs): von allen geprueften Stellungen
// zwischen 0,02 und 0,22 zerstoert AZ-5 den Kern NUR bei 0,02. Schon bei 0,04
// bleibt die Spitze bei 23 %, bei 0,179 bei 40 %. Der Grund liegt in der
// Kurvenform: sin(pi*h/span) ist bei h = span exakt null, dort schiebt eine
// weitere Einfahrt gar kein Graphit mehr in die untere Wassersaeule, und
// dazwischen frisst der frueher greifende Absorber den Effekt auf.
//
// Das ist damit KEINE Skalenfrage der Anzeige, wie BACKLOG.md bis 0.6.0
// annahm, sondern eine Eigenschaft dieses Zwei-Bank-Modells: es braucht die
// Staebe weiter draussen, als sie historisch standen, und zeigt folgerichtig
// weniger Reserve an als die dokumentierten 6-8. Statt die Zahl
// zurechtzubiegen stellt die Uebung die Einfahrtiefe daneben (siehe view():
// rodDepth) -- "0,14 m von 7 m" sagt, was "ORM 0,0" verschweigt.
const WITHDRAW_ROD = 0.02;

// Kernhoehe in Metern -- nur fuer die Anzeige der Einfahrtiefe. Dieselbe
// Zahl steckt in rbmk.js hinter tip.span (1,25 m von 7 m).
const CORE_HEIGHT_M = 7;

// Uhrzeit der Nacht zum 26.04.1986 -- eine ZWEITE Zeitanzeige neben der
// Betriebszeit (die weiter stur ab null zaehlt, siehe status_clock). Sie
// beantwortet die Frage, die die Betriebszeit nicht beantworten kann: an
// welcher Stelle der historischen Nacht steht der Ablauf gerade?
//
// Die Uhr laeuft 1:1 mit t_sim und macht genau EINEN Sprung -- am Ende des
// Schritts 'dip'. Sie beginnt bei 00:27, kurz vor dem historischen Einbruch
// um 00:28; der wird seit 0.6.1 wirklich gefahren (siehe DIP_DEPTH), dauert
// aber ein paar Minuten statt der realen Dreiviertelstunde. Der Sprung
// ueberbrueckt genau diesen Rest.
//
// Gesetzt werden die beiden dokumentierten Zeiten, nicht die Schrittdauern:
//
//   01:07:00  die beiden zusaetzlichen Hauptumwaelzpumpen laufen an. Bis
//             0.6.0 zeigte die Uhr hier 01:23:25, weil der Pumpenschritt
//             hinter der ganzen Haltephase stand; seither ist die Haltephase
//             an dieser Stelle GETEILT (siehe STEPS oben), und der Sprung am
//             Ende von 'dip' ist so bemessen, dass der Anlauf auf die
//             historische Minute faellt.
//   01:23:40  AZ-5. Darauf zielt die Haltezeit von 'hold' (siehe
//             holdSeconds()): der Auslauf muss AUTO_SCRAM_S vorher beginnen,
//             also um 01:23:25,5. Die Zerstoerung liegt dann bei ~01:23:45.
//
// Der Test 'die Uhrzeit trifft die historischen Marken' misst beides nach,
// statt es zu behaupten.
//
// Was die Uhr weiterhin NICHT leisten kann: der Testbeginn selbst. Historisch
// lief der Auslauf um 01:23:04 an, und AZ-5 kam 36 s spaeter -- in diesem
// Modell wirkt der Knopf aber nur zwischen 8 und 21 s nach Auslaufbeginn
// (PRESS_WINDOW). Von den beiden Zeiten ist nur eine zu treffen; die Uebung
// waehlt AZ-5 um 01:23:40, weil das die Zeit ist, die in jeder Darstellung
// der Nacht steht. Der Auslaufbeginn liegt damit 21,5 s zu spaet und sagt das
// in seinem Schritttext auch.
// Die Schichtuebernahme liegt kurz vor dem Einbruch, der historisch um 00:28
// begann -- vorher startete die Uhr bei null, was nur solange stimmte, wie der
// Einbruch gar nicht gefahren wurde.
const WALL_HANDOVER_S = 27 * 60;                // 00:27:00
const WALL_PUMPS_S = 1 * 3600 + 7 * 60;         // 01:07:00
const WALL_AZ5_S = 1 * 3600 + 23 * 60 + 40;     // 01:23:40
const WALL_COASTDOWN_S = WALL_AZ5_S - AUTO_SCRAM_S;
const WALL_DIP_S = WALL_PUMPS_S - AUTO_PUMPS_S - RECOVER_HOLD_S;

export class RbmkChernobylTutorial extends StartupTutorial {
  get prefix() { return 'tut_chernobyl_'; }
  get steps() { return STEPS; }
  /**
   * Haltezeiten je Schritt. Alle fest -- bis auf 'hold': dessen Dauer ergibt
   * sich aus der Uhr, nicht aus einer Zahl.
   *
   * Der Grund ist der Pumpenhochlauf davor. Er dauert, was die Pumpenmodelle
   * hergeben (~11 s), und jede feste Zahl hier waere eine Abschrift davon,
   * die beim naechsten Eingriff an components.js stillschweigend falsch wird.
   * Stattdessen zielt der Schritt auf WALL_COASTDOWN_S: verlangt wird die
   * bereits gehaltene Zeit PLUS der Rest bis dahin, womit der Vergleich in
   * StartupTutorial.step() (held >= required) genau dann aufgeht, wenn die
   * Uhr die Marke erreicht. Die Anzeige "x von y s" bleibt dabei brauchbar --
   * y ist konstant, weil beide Summanden sich gegenlaeufig aendern.
   */
  get holdSeconds() {
    const out = HOLD.slice();
    const i = STEPS.indexOf('hold');
    out[i] = this.held + Math.max(0, WALL_COASTDOWN_S - this._wallSeconds());
    return out;
  }
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
    // Uhr auf die Schichtuebernahme kurz vor dem Einbruch. Bis zum Sprung im
    // Schritt 'dip' laeuft sie von dort 1:1 mit der Betriebszeit weiter.
    this._setWallOffset(WALL_HANDOVER_S);
  }

  // Nur 'handover' (0) braucht eine Bestaetigung. 'dip' war bis 0.6.0 reiner
  // Erzaehltext und haette sonst nach zwei Sekunden weitergeschaltet, bevor
  // er gelesen ist -- seither wird der Einbruch wirklich gefahren und dauert
  // von selbst Minuten (siehe _triggerDip/step()).
  get confirmIndices() { return [0]; }

  // 'window' haelt intern nur 0.2s (ein Entprellwert fuer den
  // fast-instant Uebergang zu 'az5', siehe STEPS-Kommentar), keine echte
  // Wartezeit -- "0/0.2 s" in der Kopfzeile sah aus wie "gleich fertig",
  // waehrend tatsaechlich noch bis zu ~35s auf PRESS_WINDOW zu warten ist
  // (Nutzerrueckmeldung). 'az5' zeigt aus demselben Grund den Hinweis
  // statt der 15s-Haltezeit: waehrend der Physik-Nachlauf laeuft, ist "noch
  // 12 von 15 s" die unwichtigste Zahl auf dem Schirm -- der Hinweistext
  // sagt stattdessen, ob AZ-5 schon ausgeloest hat (window_wait/window_now).
  get liveStatusIndices() { return [STEPS.indexOf('window'), STEPS.indexOf('az5')]; }

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
      // 1 dip: der Einbruch ist gefahren (siehe _triggerDip/step()) und die
      // Leistung wieder oben. Erst dann geht es weiter -- vorher steht die
      // Anlage noch unten oder haengt im Ueberschwinger der Regelung.
      intact && pressure && this._dip?.phase === 'recover'
        && s.n >= 0.055 && s.n <= 0.09,
      // 2 recover: von Hand zurueck auf ~200 MWth, UND dort halten -- die
      // eigentliche 19-Minuten-Phase.
      intact && pressure && s.n >= 0.055 && s.n <= 0.09,
      // 3 pumps: die zwei zusaetzlichen Hauptumwaelzpumpen laufen. Das
      // Drehbuch schaltet sie selbst zu (siehe step()/AUTO_PUMPS_S) -- die
      // Bedingung bleibt als Pruefung stehen, nicht als Aufgabe.
      intact && pumpsRunning >= 8,
      // 4 hold: die zweite Haelfte der Haltephase, von der Pumpenzuschaltung
      // bis zum Testbeginn. Dieselbe Bedingung wie 'recover' -- geteilt ist
      // nur die Zeit, nicht der Zustand.
      intact && pressure && s.n >= 0.055 && s.n <= 0.09,
      // 5 test: der Turbogenerator laeuft aus (siehe _triggerCoastdown).
      // Schliesst frueh, sobald die Drehzahl sichtbar faellt -- 'window'
      // (naechster Schritt) zeigt danach den Leistungsanstieg selbst live an.
      // Geprueft wird die DREHZAHL, nicht mehr der Pumpen-Sollwert: den
      // bewegt seit 0.6.1 niemand mehr, er steht die ganze Zeit auf 100 %.
      intact && s.tgSpeed < 0.9,
      // 6 window: reine Anzeige (siehe STEPS oben) -- laeuft, bis das
      // Drehbuch AZ-5 ausloest (step()/AUTO_SCRAM_S). Nicht an
      // _inPressWindow() gebunden, obwohl der Schritt genau darin liegt: der
      // Beginn des Fensters (t+7s) faellt fast mit dem Ende von 'test'
      // zusammen, der Schritt waere dann kaum sichtbar -- so bleibt er bis
      // zum Knopfdruck stehen.
      s.scram.active,
      // 7 az5: Schnellabschaltung ausgeloest. Ob das noch glimpflich ausgeht
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

  /** Zeitlupe ab kurz vor AZ-5 (siehe SLOWMO_FROM_S). Vorher null: die
   *  19-Minuten-Haltephase will niemand langsamer sehen. */
  get speedHint() {
    const t = this._sinceRunback(this.engine.state);
    return t >= SLOWMO_FROM_S ? SLOWMO_SPEED : null;
  }

  completeStep() {
    const finishedId = this.steps[this.index];
    super.completeStep();
    // 'handover' -> 'dip': ab hier faehrt das Drehbuch den Einbruch wirklich
    // (siehe _triggerDip und DIP_DEPTH). Bis 0.6.0 war das nur Text.
    if (finishedId === 'handover') this._triggerDip();
    // Am Ende von 'dip' springt die Uhr (siehe WALL_DIP_S). Sie ueberbrueckt,
    // was zwischen der nachgefahrenen Erholung und 01:04 noch fehlt: real
    // dauerte die Erholung auf ~200 MWth eine gute halbe Stunde, hier sind es
    // wenige Minuten.
    if (finishedId === 'dip') this._setWallOffset(WALL_DIP_S - this.engine.state.t_sim);
    // Uhrzeit des Abschlusses mitschreiben -- die Schrittliste im Debrief
    // (siehe ui/tutorial.js: renderTutorialResult) zeigt sonst nur die
    // Betriebszeit, und gerade dort ist "AZ-5 · 01:23:40" der Punkt. Der
    // Sprung oben steht bewusst VOR dieser Zeile: der Schritt 'dip' ist der,
    // in dem die Stunde vergeht, also endet er auch nach ihr.
    const entry = this.completed[this.completed.length - 1];
    if (entry) entry.w = this._wallSeconds();
    // Der Auslauf beginnt am Ende der ZWEITEN Halbzeit der Haltephase, nicht
    // mehr direkt nach den Pumpen -- die laufen jetzt 16 Minuten frueher
    // (siehe STEPS oben).
    if (finishedId === 'hold') this._triggerCoastdown();
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

  /**
   * Den historischen Leistungseinbruch einleiten.
   *
   * Ursache und genauer Hergang sind bis heute nicht abschliessend geklaert
   * (INSAG-7, Anhang I). Nachgestellt wird deshalb die WIRKUNG, nicht eine
   * bestimmte Fehlbedienung: die Regelung geht auf Hand, die Staebe fahren
   * ein, bis die Leistung unten ist. Danach holt dieselbe Regelung sie
   * wieder hoch -- das ist der Teil, an dem die Mannschaft real stundenlang
   * arbeitete und den die Uebung in Minuten zeigt.
   */
  _triggerDip() {
    const { state: s, ctx: c } = this.engine;
    c.powerCtl.auto = false;
    this._dip = { phase: 'down', setpoint: s.n, t: 0 };
  }

  /** Ein Schritt des Einbruchs. Getrennt von step(), weil er nur waehrend
   *  genau eines Schritts laeuft und sonst nichts anfasst. */
  _stepDip(dt) {
    const { state: s, ctx: c } = this.engine;
    const d = this._dip;
    if (!d) return;
    if (d.phase === 'down') {
      // Gleichmaessig einfahren statt in einem Zug: ein Sprung waere ein
      // Reaktivitaetsschlag von mehreren tausend pcm, und gemessen waere
      // danach die Handbedienung, nicht der Zustand.
      const h = Math.min(1, s.rodDmd[0] + DIP_ROD_RATE * dt);
      s.rodDmd[0] = s.rodDmd[1] = h;
      if (s.n <= DIP_DEPTH) { d.phase = 'hold'; d.t = s.t_sim; }
    } else if (d.phase === 'hold') {
      if (s.t_sim - d.t >= DIP_HOLD_S) {
        d.phase = 'recover';
        // Die Regelung zieht die Staebe selbst zurueck, mit ihrer eigenen
        // Fahrgeschwindigkeit -- genau wie eine Mannschaft es koennte.
        c.powerCtl.auto = true;
        c.powerCtl.setpoint = d.setpoint;
      }
    }
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
    // Generator vom Netz: ab hier laeuft der Rotor aus und nimmt die vier an
    // ihm haengenden Hauptumwaelzpumpen mit (rbmk.js stepLoop, sp.turbogen).
    // Seit 0.6.1 eine echte Zustandsgroesse statt einer geskripteten Rampe auf
    // dem Pumpen-Sollwert -- siehe BACKLOG.md.
    s.tgCoasting = true;
    // Eigener Merker fuer den Sekundenzaehler: er muss auch dann noch laufen,
    // wenn die Drehzahl laengst unten ist -- das zweite Zerstoerungsfenster
    // (39-43 s) liegt weit hinter dem steilen Teil des Auslaufs.
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
    if (this.steps[this.index] === 'dip') this._stepDip(dt);
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
    if (id === 'dip') {
      const phase = this._dip?.phase;
      if (phase === 'down') return 'tut_chernobyl_hint_dip_down';
      if (phase === 'hold') return 'tut_chernobyl_hint_dip_bottom';
      if (phase === 'recover') return 'tut_chernobyl_hint_dip_recover';
      return 'tut_chernobyl_hint_dip';
    }
    // Kein 'tut_hint_pull'/'tut_hint_insert' mehr wie in den Anfahrtutorials:
    // die Staebe sind im Vorfuehrmodus gesperrt, ein Hinweis "jetzt ziehen"
    // waere eine Aufforderung zu etwas, das der Spieler gar nicht kann.
    if (id === 'recover') return 'tut_chernobyl_hint_recover_hold';
    if (id === 'pumps') return 'tut_chernobyl_hint_pumps';
    if (id === 'hold') return 'tut_chernobyl_hint_hold';
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
      wallOffset: this._wallOffset || 0,
      // Ohne den Einbruchszustand stuende die Anlage nach dem Laden mitten im
      // Einbruch, waehrend das Drehbuch wieder von vorn anfinge einzufahren.
      dip: this._dip ? { ...this._dip } : null };
  }

  restore(data) {
    super.restore(data);
    this._runbackT0 = Number.isFinite(data?.runbackT0) ? data.runbackT0 : null;
    // Nur uebernehmen, wenn der Schritt mit dem Sprung laut wiederhergestelltem
    // Stand ueberhaupt schon vorbei ist -- super.restore() verwirft
    // widerspruechliche Staende stillschweigend, und eine Uhr, die dann auf
    // 01:23 stuende, waere die einzige Anzeige, die davon nichts mitbekommt.
    const jumped = this.index > this.steps.indexOf('dip');
    this._setWallOffset(jumped && Number.isFinite(data?.wallOffset)
      ? data.wallOffset : WALL_HANDOVER_S);
    const dip = data?.dip;
    this._dip = dip && ['down', 'hold', 'recover'].includes(dip.phase)
      && Number.isFinite(dip.setpoint) && Number.isFinite(dip.t)
      ? { phase: dip.phase, setpoint: dip.setpoint, t: dip.t } : null;
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
      // Einfahrtiefe in Metern. Die Abschaltreserve steht in
      // Stabaequivalenten und faellt vor dem Test auf 0,0 -- eine Null, die
      // ohne Zusammenhang wie ein Anzeigefehler aussieht. Die Tiefe sagt
      // dasselbe in einer Einheit, die man nachmessen kann.
      rodDepth: s.rod[0] * CORE_HEIGHT_M,
      pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length,
      // Die Drehzahl des auslaufenden Turbogenerators, nicht der Sollwert
      // des Spielers: der steht waehrend des Versuchs unveraendert auf 100 %,
      // waehrend der Durchsatz faellt (siehe _triggerCoastdown).
      mcpFlow: s.tgSpeed * 100, sinceRunback: sinceRunback ?? 0 } };
  }
}
