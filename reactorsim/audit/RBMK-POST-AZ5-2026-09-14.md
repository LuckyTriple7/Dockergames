# RBMK: AZ-5 war erst der Anfang

Stand: 14.09.2026, Release 0.1.24. Dokumentiert den finalen Funktionsstand und
die abgeschlossenen Pruefungen unter 0.1.23 vor dem reinen Versionsbump.

## Umfang und Modell

- 15. Szenariodatei: `static/data/scenarios/rbmk_post_az5.json`, Schwierigkeit 3,
  1800 Simulationssekunden, 0 MW Netzbedarf, Profil `rbmk_post_az5_v1`.
- Vorbereitung ruft bei t=0 echtes `engine.scram('scenario')` auf: Staebe fahren
  noch; heisse Nachwaermegruppen `D`, Brennstoff und Graphit bleiben erhalten.
  Kein kalter Start und kein bloss gesetztes Abschaltflag. Loader/Session
  lehnen unbekannte oder zum Reaktortyp unpassende Vorbereitungsprofile ab.
- Bei 90 s fallen vier Hauptumwaelzpumpen aus; bei 180 s begrenzt ein physisches
  Versorgungslimit die normale Speisung auf 15 kg/s. Ab 240 s ist Hilfsspeisung
  verfuegbar, aber nicht automatisch eingeschaltet. Keine Vorwarnung/Auto-Hilfe.
- Hilfsspeisung: maximal 220 kg/s, Tank 160000 kg. Durchfluss wird vor der
  bestehenden Massen-/Energiebilanz durch Verfuegbarkeit und Vorrat begrenzt.
  Beide Speisewege verwenden 165 C warmes Wasser als gemeinsame Enthalpie-
  Abstraktion, keine Nachbildung einer realen RBMK-Stoerfallprozedur.
- Speiseauftrag, Kapazitaet und tatsaechlicher Strom sind getrennt. Helfer oder
  Replay koennen ausgefallene Pumpen auch nicht kurzzeitig wieder starten.
- Neue Bedienung wird nur fuer die Uebung eingebaut; Callbacks werden immer
  registriert, da Replay die Bedienfunktionen vor der Vorbereitung erfasst.
  Sekundaer-/Sicherheitspanel zeigen Soll-/Iststrom und Grenze, Hilfsverfuegbarkeit,
  Tankreserve/Restlaufzeit, echte Trommelmasse, Gesamtbilanz, `coolantHeatMW`,
  `graphiteHeatMW` und `T_gr`. AZ-5 allein ersetzt keine reale Waermeabfuhr im Spiel.
- Alte Szenario-JSONs bleiben unveraendert. Bisherige RBMK-Physik wurde per
  Regression geprueft; zusaetzlich ist `srv` initial 0. Wegen neuer Zustandsfelder
  wird kein identischer globaler Zustandshash behauptet. Uebrige Physikmodelle
  bleiben bestehen: aggregiertes Saettigungsmodell, keine detaillierte Oxidation,
  kein Ausbildungssimulator und keine Sicherheitszertifizierung.

## Ziele und Wertung

Genau zwei Ziele verwenden das bestehende `incident_v1` unveraendert:
`rbmk_inventory` fuer 30 s und `rbmk_heat_removal` fuer 120 s. Aktivierung erst
nach allen drei Ereignissen, Auswertung ab dem folgenden Physikschritt.
Massgeblich: `static/js/game/objectives.js` und die Szenariodefinition.

- Beide: endliche, konsistente RBMK-Werte; weder Zerstoerung noch `fault`;
  SCRAM aktiv, alle Staebe 0.99 bis 1, Neutronenniveau `n` 0 bis 0.01,
  `P_th` 0 bis 10 % Nennwaermeleistung, `W_core >= 5000 kg/s`.
- Druck 55 bis 75 bar; `0 < T_cl < 700 K`, ebenso Kernein-/austritt;
  `0 < T_gr <= 900 K`, tatsaechlicher Kuehlmittelwaermestrom positiv.
- Trommelmasse 144000 bis 176000 kg, Pegel 0.35 bis 0.70. Speise-/Dampfstrom
  jeweils >1 kg/s; Haupt-/Hilfsstrom nichtnegativ, innerhalb ihrer Kapazitaeten,
  Summe gleich Gesamtstrom; Tank innerhalb 0 bis 160000 kg. Hilfsstrom >1 kg/s
  setzt installierte und verfuegbare Versorgung voraus.
- Versorgung: kein wesentliches Defizit, `W_feed >= W_steam - tolerance`,
  mit `tolerance = max(5 kg/s, 0.1 * W_steam)`.
- Stabilitaet zusaetzlich: `abs(W_feed - W_steam) <= tolerance`; Pegelspanne
  im zusammenhaengenden Haltefenster <=0.02, mittlere Kuehlmitteltemperatur und
  Graphit jeweils hoechstens 1 K waermer als am Fensterbeginn; Tankreserve
  `>= max(10000 kg, 300 s * tatsaechlicher Hilfsstrom)`.
- Verletzungen setzen Haltezeiten zurueck und widerrufen erfuellte Ziele.
  Erster Erreichungszeitpunkt bleibt nur Historie, kein dauerhafter Erfolg.
  Beide Ziele muessen am festen Ende bei 1800 s aktuell erfuellt sein, sonst
  Misserfolg; kein vorzeitiger Sieg oder versteckter Fehlertimer. Brennstoffschaden
  bleibt frueher Abbruchgrund.
- Je aktuellem Ziel 1000 Punkte; Erfolg weitere 1000 + 250 je Schwierigkeit.
  Energie, Netzabweichung, SCRAM und Grenzwertdauer zaehlen null; unquittierte
  Alarme kosten maximal 100 Punkte, Katastrophenabzuege bleiben bestehen.
  Kanonisches Server-Replay ist fuer die Bestenliste Pflicht. Geladene Laeufe
  bleiben wie bisher lokal. Produktions-API-Wertungsformeln wurden nicht geaendert.

## Balancing

Gemessenes manuelles Beispiel, keine vorgeschriebene oder reale Bedienanweisung:
bei 240 s einschalten/50 %, dann 360 s 40 %, 600 s 30 %, 900 s 25 %, 1200 s 22 %,
1500 s 18 %. Endwerte: Tank 62978.02 kg, Trommelmasse 163268.39 kg,
Pegel 51.6637 %, Druck 73.2637 bar, Hilfsstrom 39.6 kg/s, Hauptstrom 15 kg/s,
Dampf 51.28 kg/s, tatsaechlicher Kuehlmittelwaermestrom 108.258 MW.
Ergebnis 3650 Punkte ohne Quittierung (100 Punkte Alarmabzug).
Eine gemessene rueckgekoppelte Regelstrategie mit 30-s-Abstand erreicht ebenfalls
3650 Punkte bei rund 69974 kg Reserve. Dosierung bei fallender Waerme ist die
Aufgabe, nicht das Auswendiglernen einer bestimmten Schaltfolge.

Nichtstun, wiederholtes AZ-5, Speisewasser-Automatikwechsel und dauerhaft 100 %
scheitern. Alle 101 ganzzahligen UI-Stellungen 0 bis 100 % plus zehn Halbstufen
zwischen 20 und 30 % wurden ab 240 s konstant gehalten: alle 111 scheitern.
Das beweist nichts ueber alle denkbaren spaeteren Aktivierungen oder Eingabefolgen.

## Speicherung und Mobilansicht

Neue flache Versorgungsfelder sind streng validiert, Altstaende erhalten neutrale
Vorgaben. Aeusseres Speicherformat v1, Trendformat v1 mit 15 Kanaelen und
Wertungsversion bleiben unveraendert. Ein Browser-Restore-Befund zeigte doppelte
frische Initialisierungsmeldungen: `pendingLog: {engine, trips}` sichert nun je
die letzten 120 noch nicht dargestellten Ereignisse. Laden ersetzt frische
Engine-/Vorbereitungsqueues durch die echten gespeicherten Queues; ohne Feld
starten sie leer. Noch nicht dargestellte echte Ereignisse erscheinen genau
einmal, auch nach DWR-/SWR-Fortsetzung. Keine Tankauffuellung beim Laden.
Die mobile Meldetafel-/Loggruppe schrumpfte auf 0 px; jetzt nicht schrumpfend
180 px hoch, Log gemessen 142 px. Touch-Scrollen und Alarmhilfe sind erreichbar.

## Verifikation und Grenzen

- Finale vollstaendige Laeufe: Node 380 bestanden, Python 175 bestanden;
  darunter 14 neue API-Tests mit echter RBMK-Bestenliste.
- Browser final: 1350 Assertions, 0 Fehler, 108 Faelle (104 UI + 4 Core).
  Desktop 1440x900: DE 332, EN 332; mobil emuliert 390x844: DE 343, EN 343.
  Chromium 151.0.7922.34, Playwright 1.62. Alle 15 Szenarien und freie Starts
  aller Reaktortypen, negative Faelle, Bedienung und Diagnose geprueft.
- Vier erfolgreiche, authentische UI-Aufzeichnungen serverseitig nachgerechnet:
  jeweils identische 3650 Punkte. Speichern bei 960 s erhielt den gesamten
  Payload exakt: ausstehende Meldungen, Historie, Physik, Ziele und Trends;
  keine Vorratsauffuellung und keine doppelten SCRAM-Meldungen.
- Native Tastatur-/Touch-Eingaben, keine vorgetaeuschte Physik. Kontrollierte
  0.05-s-Schritte bei angehaltener Browser-Schleife und Tempo 1; zusaetzlich
  uninstrumentierte RAF-Smokes. Keine JavaScript-/Konsolenfehler oder
  unerwarteten HTTP-Fehler. Kein 30-Minuten-Echtzeit-Dauertest, kein echtes Mobilgeraet.
- Browserstart und finale Codepruefung unter Version 0.1.23; anschliessend nur
  Dokumentation und VERSION auf 0.1.24. Historische Pruefberichte bleiben unveraendert.
