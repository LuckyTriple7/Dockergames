import { StartupTutorial } from './tutorial.js';

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

const STEPS = ['handover', 'dip', 'recover', 'pumps', 'test', 'az5'];
// 'recover' verlangt 1140 s (19 Minuten) SIMULIERTE Zeit -- am 60-fachen
// Zeitraffer sind das rund 19 reale Sekunden, kein zaehes Warten. Die Zahl
// ist bewusst die historische Haltezeit vor dem Versuch, nicht abgekuerzt.
// 'test' (Index 4) haelt nur kurz -- der Schritt gibt AZ-5 frei, sobald der
// Auslauf sichtbar begonnen hat. WICHTIG (siehe test-rbmk-chernobyl-
// tutorial.mjs): je laenger der Auslauf UNBEACHTET weiterlaeuft, desto
// gefaehrlicher wird die Lage -- ab rund 27 s nach Ausloesen destabilisiert
// die Anlage auch OHNE AZ-5 von selbst (derselbe positive Blasenkoeffizient).
// Die Uebung zwingt AZ-5 also nicht als alleinige Ursache herbei; sie zeigt,
// dass Zoegern in diesem Zustand so oder so gefaehrlich ist -- historisch
// vertretbar, auch wenn es die Trennung "AZ-5 allein war schuld" aufweicht.
// Nach AZ-5 bleibt die Simulation lange genug offen, um den anfaenglich
// positiven Graphitspitzeneffekt und den anschliessenden Stabeinlauf zu sehen.
// triggerScram() schaltet dafuer automatisch auf Echtzeit zurueck.
const HOLD = [5, 2, 1140, 3, 5, 20];

// Kuehlmittelauslauf-Naeherung fuer den Turbinenauslaufversuch (siehe
// events.js rbmk_mcp_runback) -- geskriptet statt einer echten
// Turbinen-Rotortraegheit, wie besprochen: der Punkt ist die Kombination
// aus Xenon-armer, ORM-armer Anlage UND sinkendem Durchsatz, nicht eine
// mechanistische Rekonstruktion des Turbogenerators.
const COASTDOWN_S = 30;

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
    s.rod[0] = s.rod[1] = 0.1353528450681849;
    s.rodDmd[0] = s.rodDmd[1] = 0.1353528450681849;
    s.T_f = 585.7547959561184;
    s.T_cl = 558.7573570680994;
    s.T_ci = 556.7348461520972;
    s.T_co = 558.0251027025131;
    s.T_mod = 558.0251027025131;
    s.T_gr = 590.2992690043193;
    s.alphaBar = 0.05437736108274518;
    s.I = 0.5931298469040777;
    s.X = 1.366547661120293;
    s.Pm = 0.9227506372313031;
    s.Sm = 1.0253115326317221;
    s.zTop = { I: 0.5701612430885139, X: 1.3819164026422766, Pm: 0.9177148539236004, Sm: 1.026975160511478 };
    s.zBot = { I: 0.6160984507196482, X: 1.353411736633394, Pm: 0.927786420539006, Sm: 1.0236510174987252 };
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

  get inspectReady() {
    // Wie die Basisklasse, aber ohne die feste 'inspect'-Bezeichnung: Schritt
    // 0 heisst hier 'handover' und nutzt denselben Bestaetigen-Mechanismus.
    return this.index === 0 && this.held + 1e-8 >= this.holdSeconds[0] && this.conditions()[0];
  }

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
      intact && s.mcpDmd < 0.9,
      // 5 az5: Schnellabschaltung ausgeloest. Die Haltezeit laesst die Folgen
      // sichtbar ablaufen. Ob das noch glimpflich ausgeht, entscheidet die
      // Physik (RunState.checkFail() greift immer VOR tutorial.done).
      s.scram.active,
    ];
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
    // Automatik jetzt AUS: sie wuerde sonst schuetzend gegen den
    // Leistungsanstieg aus dem sinkenden Durchsatz einfahren (im Test
    // beobachtet: ORM stieg dabei sogar wieder von 25 auf 30) und genau die
    // gefaehrliche Kombination verhindern, die dieser Versuch zeigen soll.
    // Historisch war die Reaktivitaetsfuehrung ohnehin auf Hand.
    c.powerCtl.auto = false;
    c.mcpRunback = { from: s.mcpDmd, to: 0, t0: s.t_sim, dur: COASTDOWN_S };
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
    if (id === 'az5') return 'tut_chernobyl_hint_az5';
    return 'tut_hint_wait';
  }

  snapshot() { return { ...super.snapshot(), reactor: 'rbmk' }; }

  view() {
    const view = super.view();
    const { state: s, ctx: c } = this.engine;
    return { ...view, values: { ...view.values, pressure: s.p_drum,
      level: s.L_drum * 100, orm: this.engine.derive().orm,
      pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length,
      mcpFlow: s.mcpDmd * 100 } };
  }
}
