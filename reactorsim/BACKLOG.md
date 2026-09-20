# Backlog

Offene, bewusst zurückgestellte Punkte -- kein Anspruch auf Vollständigkeit,
nur was beim Arbeiten aufgefallen ist und noch nicht dran war.

## Erweiterungen

### Wiedergabe eines Laufs mit Bild

Die Nachrechnung (siehe CHANGELOG 0.0.76) hat die Bausteine schon gelegt:
`game/recorder.js` zeichnet jede Bedienhandlung mit Schrittzahl auf,
`game/replay.js` spielt sie ohne DOM durch dieselbe Engine noch einmal durch.
Was fehlt, ist nur noch die Bildausgabe obendrauf -- dieselbe Engine, derselbe
Ablauf, nur mit `ui/panels.js`/`ui/render.js` statt `captureKit()`, und einer
eigenen Wiedergabegeschwindigkeit statt Echtzeit. Passt zu dem, was das Spiel
zeigen will: nicht das Ende, sondern den Weg dorthin. Die Auswertung könnte an
jeder Meldung in der Zeitleiste anspringen, statt nur am Anfang zu starten.

Offene Fragen, bewusst noch nicht entschieden: eigene Seite oder Modal über
dem Leitstand; woher die Wiedergabe ihr Protokoll bekommt (eigener Endpunkt
`/api/highscores/<id>/log`? nur die eigenen Läufe, oder jeder Bestenlisten-
Eintrag?); ob während der Wiedergabe Ton laufen soll.

### Simulation in einen Web Worker

Würde Rechnung und Bildaufbau trennen: kein Ruckeln mehr bei 60×, und der
Zeitraffer könnte höher gehen. `templates/index.html` ist darauf schon
vorbereitet (`window.RS_I18N` statt `const`, siehe Kommentar dort).

Der Aufwand steckt nicht in der Engine, sondern in der Bedienung: `ui/panels.js`,
`ui/controls.js` und die `uiControls()`-Haken der drei Typdateien greifen heute
direkt auf `engine.state` und `engine.ctx` zu -- jeder Schieber, jeder
Auto/Hand-Schalter, jeder Pumpenknopf. Über eine Worker-Grenze braucht jeder
davon eine Nachricht. Das ist ein Umbau, keine Optimierung, und erst dann
sinnvoll, wenn Ruckeln tatsächlich auftritt.

### Vierter Reaktortyp

Die Schnittstelle aus `spec` und `hooks` trägt das ohne Änderung an der Engine
-- genau dafür ist sie so geschnitten. Der lehrreichste Kontrast zu den drei
vorhandenen wäre **CANDU**: Schwerwasser, positiver Dampfblasenkoeffizient wie
beim RBMK, aber mit ganz anderer Abschaltlogik, und Brennstoffwechsel im
laufenden Betrieb.

### Lauf-Export als CSV

Die gemeinsame Historie `ctx.trends` (`static/js/game/trendHistory.js`) hält
seit 0.1.22 maximal 28.800 Samples der letzten acht Simulationsstunden und
600 Marker vor, einschließlich Speicherung und exaktem Fortsetzen.
`static/js/ui/trend.js` stellt diese Daten nur dar. Ein CSV-Export der noch
vorhandenen Werte bleibt offen; fehlende Messwerte und gekürzte Historie
müssten dabei ausdrücklich erkennbar bleiben.

### Spielkomfort - erledigt in 0.1.23

Trendhistorie nach Fortsetzen und gemeinsame Ereignismarker sind in 0.1.22
global umgesetzt; der gesamte Laufzeit-Hinweisbereich ist mit gemerkter Wahl
einklappbar. Seit 0.1.23 sind auch der letzte erfolgreiche Auto-/Handspeicher-
zeitpunkt mit bleibender Fehleranzeige und der ausdrückliche Zeitsprung-Abbruch
umgesetzt. Sichere Speicherwarteschlangen und wiederholbare Speicher-/Szenario-
ladeabläufe ergänzen das Paket. Punkt 8 ist vollständig erfüllt; CSV-Export
und die übrigen Erweiterungen bleiben offen. Details:
[Trend-Audit 0.1.22](audit/TRENDS-2026-09-14.md) und
[Komfort-Audit 0.1.23](audit/KOMFORT-2026-09-14.md).

### Mehrbenutzerbetrieb

Umgesetzt: Admin-Konto (`REACTORSIM_USER`/`REACTORSIM_PASSWORD`, spielt
nicht) verwaltet Spielerkonten im Panel unter `/admin` -- anlegen (E-Mail als
Benutzername), sperren/entsperren, Passwort zurücksetzen, Anmelde- und
Spielprotokoll je Konto (Zeitpunkt, Absenderadresse, Reaktortyp/Szenario/
Dauer). Spielerkonten liegen in `/data/users.db` (SQLite) statt in der
Umgebung; `REACTORSIM_USERS` ist entfallen. Mehrere Spielerkonten spielen
gleichzeitig, eigene Spielstände je Konto (`persist.Store.account_key`).

**Seit 0.6.0 zusätzlich umgesetzt:**

- **Mailversand über die Dockge-Konfiguration** (`mailer.py`,
  `REACTORSIM_SMTP_*` plus `REACTORSIM_PUBLIC_URL`). Wie beim Admin-Konto
  steht das Postfachpasswort in der Umgebung, nicht im Panel -- das Panel
  zeigt die Einstellung nur an (ohne Passwort) und schickt eine Testmail.
  Unkonfiguriert bleibt alles wie vorher; Mailversand ist Zugabe, nicht
  Voraussetzung.
- **Willkommens-Mail** an ein neu angelegtes Konto, als Kreuzchen im
  Anlegen-Formular. Ein gescheiterter Versand lässt das Konto stehen und
  nennt den Grund im Panel.
- **Passwort-Reset Phase 2:** das zurückgesetzte Passwort geht automatisch an
  den Spieler, sofern ein Mailserver bereitsteht. Angezeigt wird es trotzdem
  weiterhin einmalig.
- **Passwort vergessen** (`/forgot`, `/reset`): Einmal-Link, zwei Stunden
  gültig, nur der SHA-256-Abdruck liegt in der Datenbank. Die Antwort ist
  immer dieselbe, ob es die Adresse gibt oder nicht; Versand asynchron, damit
  auch die Antwortzeit nichts verrät.
- **Vollständige Spielhistorie** (`/api/runs`, Kontoseite
  `/admin/users/<id>`): Jeder beendete Lauf wird gemeldet -- Szenario,
  Tutorial und freies Spiel, mit Ausgang (geschafft/gescheitert/abgebrochen/
  zerstört) und nachgetragenem Punktestand. Vorher entstand der einzige
  Eintrag als Nebenwirkung von "Eintragen" im Debrief, weshalb "Spielzeit
  gesamt" nur einen Bruchteil zeigte.

**Seit 0.6.1 zusätzlich umgesetzt -- damit ist der frühere offene Rest
abgearbeitet:**

- **Self-Service-Passwortwechsel im Spiel** (`/api/account/password`, Knopf
  „Konto" in der Fußzeile des Startbildschirms). Das alte Passwort muss mit --
  die Sitzung läuft 30 Tage, ohne diese Abfrage genügte ein kurz
  unbeaufsichtigter Browser. Der Wechsel wirft jedes andere angemeldete Gerät
  hinaus, die eigene Sitzung bekommt ein frisches Token als Cookie zurück.
- **Konten löschen** (`/admin/users/<id>/delete`), nur von der Kontoseite aus
  und nur nach Abtippen der E-Mail-Adresse. Mitgelöscht werden Spielhistorie,
  Anmeldeprotokoll, offene Reset-Vorgänge und sämtliche Spielstände als
  Dateien; die laufende Sitzung wird entwertet. Bestenlisten-Einträge bleiben:
  sie tragen einen frei gewählten Namen, keine Kontokennung.
- **Seitenblätterung** in beiden Ansichten (`?runs=N`, `?logins=N`). Jede
  Liste sagt jetzt auch, wie viele Einträge es insgesamt gibt.
- **Die Dauer misst der Server selbst.** `/api/runs/start` eröffnet beim
  Rundenstart eine Messung (`OpenRuns` in `app.py`), `/api/runs` schließt sie.
  Daraus fällt zweierlei ab: eine Spalte „Am Schirm" mit der tatsächlich
  verbrachten Zeit, die gar nicht aus der Anfrage stammt -- und eine
  Obergrenze für die gemeldete SIMULIERTE Zeit, denn schneller als 60× kann
  kein Browser rechnen. Bei einem fortgesetzten Lauf kommt auch der
  Startpunkt nicht mehr aus der Anfrage, sondern aus dem `t_sim` des
  gespeicherten Standes auf der eigenen Platte.

Offen:

- **Das freie Spiel bleibt von der 60×-Grenze ausgenommen.** Der
  Xenon-Zeitraffer (`main.js fastForwardXenon()`) rechnet in einer engen
  Schleife statt im Bildtakt und erzeugt binnen Sekunden bis zu 48 h
  simulierte Zeit -- für diesen Modus ist die Grenze deshalb wirkungslos und
  wird in `app.py` ausdrücklich so benannt, statt sie zu behaupten. Für
  Szenarien und Tutorials greift sie. Ein sauberer Weg wäre, den Sprung selbst
  beim Server anzumelden.
- **Ohne Messung greift weiterhin nur der 24-h-Deckel** -- nach einem Neustart
  des Containers (die Messungen liegen nur im Speicher) oder bei einem
  Client, der `/api/runs/start` nicht kennt. Solche Läufe stehen mit leerer
  Spalte „Am Schirm" in der Historie, nicht mit einer geschätzten Zahl.

### Chernobyl-Tutorial „Block 4 – Die Nacht des 26. April“

Umgesetzt: geführter RBMK-Nachbau der Nacht vom 26. April 1986 ab
Schichtübergabe bis AZ-5, seit 0.6.1 acht Schritte (`handover`, `dip`,
`recover`, `pumps`, `hold`, `test`, `window`, `az5`), eigene Klasse
`RbmkChernobylTutorial` (`game/chernobylTutorial.js`). AZ-5 führt aus dem
validierten Ausgangszustand (zweistufige Vorgeschichte
100%→50%→9h halten→7%) zusammen mit dem Kühlmittelauslauf zuverlässig zu
echter Brennstoffzerstörung, mit der bestehenden Physik, ohne
Kalibrierungsänderung.

Seit 0.5.9 ist die Übung ein **Vorführmodus**: Ab der Schichtübergabe fährt
das Drehbuch die Anlage selbst, gesperrt sind Stäbe, Leistungsregler, Pumpen
und AZ-5 (`tutorial.locked` → `ui/controls.js: setControlsLocked`). Grund: Der
Ablauf ließ sich nicht sauber nachspielen, es gab aber gar keine Sperre --
jeder Klick konnte ihn verschieben.

**0.6.1 hat die Übung von Grund auf ehrlicher gemacht.** Auslöser war der
Turbinenauslauf: Er war bis dahin ein Drehbuch, das den *Pumpen-Sollwert*
linear auf null fuhr. Beides war falsch -- es bewegte einen Schieber, den
niemand angefasst hatte, und historisch hingen nur **vier der acht**
Hauptumwälzpumpen am auslaufenden Generator. Jetzt ist die Drehzahl eine
echte Zustandsgröße (`s.tgSpeed`, `rbmk.js: sp.turbogen`): der Rotor bremst
gegen die Pumpenlast, und weil eine Kreiselpumpe Leistung mit der dritten
Potenz der Drehzahl zieht, folgt daraus `w(t) = w0/(1 + t/τ)` -- der
Rechenschritt dafür ist exakt, nicht genähert. Vier Pumpen bleiben am Netz,
der Kernstrom fällt also auf etwa die Hälfte statt auf null.

Das hat drei weitere Punkte mit umgeworfen, die vorher als unlösbar galten:

- **Das Wirkfenster ist breit geworden.** Neu vermessen
  ([`tests/tools/chernobyl_press_window.mjs`](tests/tools/chernobyl_press_window.mjs)):
  In den ersten zwölf Sekunden nach Auslaufbeginn übersteht der Kern AZ-5, ab
  etwa 15 s zerstört derselbe Knopf ihn, und das bis mindestens 105 s. Vorher
  waren es 8-21 s mit einem Überlebensstreifen dahinter -- eine Eigenschaft
  der alten Rampe auf null, nicht der Anlage.
- **Die historischen Zeiten treffen jetzt alle.** Weil 36 s im Fenster liegen,
  kann AZ-5 im dokumentierten Abstand zum Testbeginn drücken. Die Übung zeigt
  damit Schichtübernahme 00:27, Einbruch ab 00:28, Pumpen 01:07:00, Testbeginn
  01:23:04, AZ-5 01:23:40, Zerstörung 01:23:45 -- jede davon nachgemessen, nicht
  behauptet. Vorher war nur *eine* der beiden Testzeiten erreichbar, und die
  Pumpen zeigten 01:23:25 statt 01:07 (die Haltephase ist dafür in `recover`
  und `hold` geteilt, mit einem Schritt dazwischen, dessen Dauer auf die Uhr
  zielt statt fest zu stehen).
- **AZ-5 ist jetzt die alleinige Ursache.** Ohne Knopfdruck bleibt die Leistung
  bei rund 7 % -- vier Pumpen kühlen weiter. Vorher trieb die Rampe die Anlage
  schon ohne jeden Knopfdruck auf 133 %, und der Abschlusstext musste das
  einräumen. Geblieben ist der zweite Befund: nimmt man der schmalen
  automatischen Regelung ihre 500 pcm, zerstört sich dieselbe Anlage nach rund
  22 s von selbst.

**Ebenfalls in 0.6.1 umgesetzt:**

- **Der Leistungseinbruch wird gefahren, nicht mehr erzählt.** Bis 0.6.0 stand
  hier, ein echter Einbruch reiße mehr Xenon auf, als sich je zurückholen
  lasse. Das galt für die damalige, ungetrennte Stabkurve und stimmt seit der
  Korrektur in `rbmk.js` nicht mehr: nachgemessen
  ([`tests/tools/chernobyl_dip.mjs`](tests/tools/chernobyl_dip.mjs)) kommt die
  Anlage aus Einbrüchen bis hinunter zu 0,05 % zuverlässig wieder auf 7,3 %,
  mit ORM ~76 und rho ~0 pcm -- praktisch auf den Zustand, den `prepare()`
  vorher fest hinterlegt hat. Xenon spielt dabei kaum eine Rolle, ein Einbruch
  von Minuten ist gegen die Jod-Halbwertszeit zu kurz. Der Schritt `dip` fährt
  die Regelung jetzt auf Hand, die Stäbe ein, hält, und lässt dieselbe Regelung
  die Leistung zurückholen. Die Uhr springt danach nur noch über den Rest der
  Erholung, die real bis kurz nach 01:00 dauerte.
- **Zeitlupe.** `loop.js` konnte Faktoren unter 1 immer schon, es gab nur keine
  Bedienung dafür. Neu sind ¼×- und ½×-Knöpfe in der Statusleiste sowie `-`
  und `+`, die die ganze Leiter von ¼× bis 60× entlanggehen. Die Chernobyl-
  Übung fordert von sich aus ¼× an, vier Sekunden vor AZ-5
  (`tutorial.speedHint`) -- im Vorführmodus könnte der Spieler den Moment sonst
  nicht sehen, und die Stellteile sind gesperrt.

Offen/bekannte Einschränkungen:

- **Die Abschaltreserve zeigt weniger an als die dokumentierten 6-8
  Stabäquivalente** -- vor dem Test 0,0. Das ist, anders als hier bis 0.6.0
  vermutet, **keine Skalenfrage**. Nachgemessen
  ([`tests/tools/chernobyl_rod_sweep.mjs`](tests/tools/chernobyl_rod_sweep.mjs)):
  Bei der historischen Einfahrtiefe von 1,25 m -- also `h = tip.span = 0,179`,
  wo die Anzeige exakt 7,4 zeigt -- zerstört AZ-5 den Kern gar nicht mehr, die
  Spitze bleibt bei 40 %. Von allen geprüften Stellungen zwischen 0,02 und 0,22
  trägt nur 0,02 den Mechanismus, weil `sin(π·h/span)` bei `h = span` null ist
  und der früher greifende Absorber den Spitzeneffekt dazwischen auffrisst.
  Dieses Zwei-Bank-Modell braucht die Stäbe also weiter draußen, als sie
  historisch standen. Statt die Zahl zurechtzubiegen steht jetzt die
  Einfahrtiefe in Metern daneben, und der Schritttext sagt den Unterschied
  ausdrücklich. Eine echte Lösung bräuchte mehr Bänke oder eine axial
  aufgelöste Stabkurve -- ein Umbau am Kern des RBMK-Modells, nicht an dieser
  Übung.
- **Die Rotorzeitkonstante ist gesetzt, nicht hergeleitet.** τ = 15 s bildet den
  dokumentierten Auslauf ab (Durchsatz spürbar weg nach einer halben Minute),
  ohne eine Schwungmasse zu erfinden, für die es keine nachschlagbare Zahl
  gibt. Welche vier der acht Pumpen am Generator hängen, ist ebenfalls gesetzt.
- **Der zeitliche Maßstab des Einbruchs bleibt gerafft.** Real dauerte die
  Erholung auf ~200 MWth über eine halbe Stunde, hier sind es Minuten; der
  Rest steckt weiterhin im einen Uhrensprung am Ende von `dip`.
- **Nicht nachgebildet:** Speisewasserschwall um 01:19, blockierte
  Turbinenschnellabschaltung, ORM-Ausdruck um 01:22:30.

## Weitere Störszenarien

Stand 0.1.24: 15 Szenariodateien einschließlich Anfahren-Tutorial. Zwei
Einzelstörungen aus der Ideensammlung sind jetzt als eigene DWR-Schichten
umgesetzt, ergänzt um eine kombinierte Stufe. Details und Nachweise:
[historischer Szenario-Audit 0.1.20](audit/SZENARIEN-2026-09-14.md) und
[Ziel-Audit 0.1.21](audit/SZENARIOZIELE-2026-09-14.md). Die RBMK-Nach-AZ-5-Schicht
ergänzt seit 0.1.24 die aktive Versorgung nach der Abschaltung:
[RBMK-Audit 0.1.24](audit/RBMK-POST-AZ5-2026-09-14.md).

**Sicherheitsziele in 0.1.21 umgesetzt und 0.1.24 erweitert, weiterer Ausbau offen:**
Die drei DWR-Störungsschichten haben je zwei widerrufbare Zustandsziele mit
15/120 Sekunden Haltezeit und `incident_v1`-Wertung statt Produktionswertung.
Beide Ziele müssen am ursprünglichen Ende aktuell erfüllt sein. Speicherung
erhält Zielzeiten und Haltefenster; geladene Läufe bleiben ohne vollständiges
Replay lokal, die neuen Bestenlisten verlangen Server-Nachrechnung und sind
von alten Scores getrennt. Gemeinsame Trends und Ereignismarker sind seit
0.1.22 für alle Szenarien und freies Spiel aller drei Reaktortypen umgesetzt.
Die RBMK-Schicht ergänzt zwei Ziele mit 30/120 s Haltezeit und derselben
`incident_v1`-Wertung. Zielmarker betreffen aktuell diese vier Störungsschichten
und das Anfahren-Tutorial mit seinen eigenen fünf Lernzielen, nicht alle Szenarien.
Vollständige Übertragung der Ziele auf die übrigen Szenarien, weitergehende
Diagnoseziele, unvollständige Messinformationen und generische Messausfälle
bleiben offen; die genannten Komfortpunkte sind in 0.1.23 erledigt. Die bestehende
SWR-Füllstandslücke bei Gleichstromverlust ist kein generisches Sensormodell.
Die kalibrierten Spielziele ersetzen keine reale Störfallprozedur.

**Umgesetzt in 0.1.24, RBMK-Nach-AZ-5-Schicht:**
- `rbmk_post_az5`, Schwierigkeit 3, 30 Minuten, 0 MW Netzbedarf; echtes
  SCRAM bei t=0 mit Stabfahrt und erhaltener Brennstoff-/Graphit-/Nachwärme.
  Vier Pumpenausfälle bei 90 s, normale Speisung ab 180 s physisch auf 15 kg/s
  begrenzt, Hilfsspeisung ab 240 s verfügbar, aber nicht automatisch an.
- Dosierbare Hilfsspeisung bis 220 kg/s aus 160.000 kg Vorrat; tatsächliche
  Ströme und Restvorrat zählen. Übungsspezifische Bedienung und Diagnose trennen
  Auftrag, Kapazität und Wirkung. Inventarversorgung und stabile Wärmeabfuhr
  müssen bei 1800 s aktuell erfüllt sein; bloßes AZ-5 oder Abwarten genügt nicht.
- Aggregiertes Sättigungsmodell, beide Speisewege abstrahiert bei 165 °C;
  keine reale Prozedur, detaillierte Oxidation oder Sicherheitszertifizierung.
  Alte Szenario-JSONs bleiben unverändert. Das erfüllt weder sämtliche übrigen
  Szenarioziele noch offene Sensor-, Diagnose- oder Physikerweiterungen.

**Umgesetzt in 0.1.20, mit Modellgrenzen:**
- **DWR: Dampferzeuger-Rohrleck.** `pwr_sg_tube_leak`, Schwierigkeit 2,
  15 Minuten, konstantes Leck von 8 kg/s ohne Vorwarnung/automatischen Helfer.
  `sg_tube_leak` erhöht die Wassermasse des zusammengefassten Dampferzeugers
  und senkt den Druckhalterfüllstand. Keine vollständige Primärleckbilanz,
  keine druckabhängige Leckrate, keine einzelnen Dampferzeuger zur Diagnose
  „welcher DE?“, keine Einzelisolation oder Aktivitätsmessung. Die
  Speisewasserregelung kann den DE-Pegel stabil halten; RESA stoppt das Leck
  nicht. Seit 0.1.21 scheitert Nichtstun am Zielabschluss: erforderlich sind
  begrenzte Wärmeleistung und stabile Wärmeabfuhr. Punkte bestätigen nur diese
  Spielziele, keine korrekte reale Leckbehandlung; eine vollständige
  Diagnoseprüfung fehlt weiterhin.
- **DWR: Verlust der Speisewasserregelung.** `pwr_feedwater_loss`,
  Schwierigkeit 1, 15 Minuten, geführte Einzelstörung mit Vorwarnung und
  automatischer Hilfe gemäß Einstellungen. `feedwater_loss` setzt den Regler
  einmalig auf Hand/null; Automatik oder Handstellwert lassen sich jederzeit
  wieder ändern. Kein permanenter Pumpendefekt und keine Hilfsspeisung.
- **DWR: Kombinierte Störungen.** `pwr_combined_faults`, Schwierigkeit 3,
  18 Minuten, Turbinenschnellschluss bei 180 s und Speisewasserverlust bei
  240 s, ohne Vorwarnung/automatischen Helfer. Dieselbe unveränderte Physik.

**Weiter offen -- Ereignis existiert schon, nur noch nicht als eigenes
Szenario verpackt:**

- **DWR: Ausfall einer Hauptkühlmittelpumpe.** `rcp_trip` mit `loop`
  funktioniert für PWR bereits (`ctx.pumps[i].trip()`, vier Schleifen) --
  nur noch nie als alleiniger Szenario-Anlass benutzt.
- **SWR: Umwälzpumpen-Trip.** Derselbe `rcp_trip` faellt bei BWR auf
  `ctx.recircPump.trip()` zurück -- der Typ modelliert nur EINE
  zusammengefasste Umwälzpumpe, ein Teilausfall (nur eine von mehreren)
  ist damit nicht darstellbar, ein Komplettausfall schon.
- **RBMK: Klemmende Stabgruppe bei Leistungsanstieg.** `rod_stuck` waehrend
  einer Leistungsrampe (statt wie bisher im Volllastbetrieb) -- reine
  Szenario-Regie, keine neue Mechanik.
- **RBMK: Axiale Leistungsverzerrung.** `alarm_axial_tilt` existiert schon
  als Meldung; ob sich >0,35 zuverlaessig ueber ein gezieltes `rod_stuck`
  auf nur EINER Bank erreichen laesst (statt wie bisher stets beide
  Banken gemeinsam, siehe `rodBanksMoveTogether`), ist ungeprüft -- müsste
  am Modell ausprobiert werden, vermutlich ohne neuen Code.
- **RBMK: Überhitzter Graphit.** `alarm_graphite_hot` existiert; braucht
  vermutlich nur eine Szenario-Regie, die die Leistung lange genug hoch
  haelt (35 Minuten Zeitkonstante, siehe Kommentar in `rbmk.js`), keinen
  neuen Code.

**Kleine neue Bausteine -- bestehendes Muster leicht erweitert:**
- **SWR: Speisewasserregler außer Kontrolle.** `feedwater_loss` setzt
  `fwCtl` einmalig auf Hand mit `manual = 0` (ganz zu), sperrt aber keine
  spätere Bedienung. Ein anderer anfänglicher Stellwert wäre eine kleine
  Erweiterung; echtes „hängt bei 70 %“ müsste den Defekt zusätzlich dauerhaft
  gegen Bedienung durchsetzen.
- **RBMK: Trommelwasserstand außer Kontrolle.** Gleiches Muster, RBMK hat
  mit `ctx.fwCtl` dieselbe Reglerklasse wie DWR/SWR.

**Größerer Aufwand -- echte neue Mechanik noetig:**
- **DWR: Fehlerhafte Druckmessung.** Kein generischer Mechanismus für
  Messwertdrift vorhanden; die SWR-Füllstandsanzeige und ihr Trend kennen
  bereits Messausfall bei Gleichstromverlust. Druckmessfehler brauchen
  einen eigenen Drift-Zustand pro Messstelle und eine
  Stelle in `ui/panels.js`, die zwischen Anzeige- und Ist-Wert
  unterscheidet.
- **SWR: Schleichendes Vakuumversagen.** `p_cond` wird in `pwr.js`/`bwr.js`
  jeden Schritt frisch aus der Physik berechnet (Kühlwassertemperatur,
  Dampfmenge), nicht unabhaengig gesetzt -- eine Leckluft-Alterung braucht
  einen echten neuen Additionsterm in dieser Berechnung, keinen Event-Griff.
- **RBMK: Xenonfalle.** Ein Szenario, das schon MIT Xenonvergiftung
  startet, braucht eine Anfangsbedingung, die es heute nicht gibt --
  `createState()`/`createEngine()` kennen kein `opts.X`. Ergaenzung ist
  überschaubar (ein weiterer optionaler Anfangswert wie `burnup`), aber
  neu.
- **SWR: RESA versagt (ATWS).** Der groesste Brocken. `scram()` setzt heute
  bedingungslos `s.scram.active`, und die gemeinsame `stepRods()` in
  `sim/engine.js` fährt danach für ALLE Typen die Stäbe zwangsweise ein --
  ein "faehrt trotzdem nicht ein" braucht einen eigenen Zustand, der genau
  diese eine Stelle typspezifisch umgeht. Dazu kommt: ein SWR-ATWS wird in
  der Realität ueber Bor-Einspeisung (SLC) beherrscht, und dieses Spiel
  kennt loesliches Bor bisher nur beim DWR (Borsäure/Kachel
  Reaktorchemie) -- ohne einen Alternativweg waere das Szenario nicht zu
  gewinnen, nur zu verlieren. Erst dann sinnvoll, wenn beides zusammen
  gebaut wird.
