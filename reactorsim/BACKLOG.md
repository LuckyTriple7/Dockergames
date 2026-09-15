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

Offen:

- **Passwort-Reset Phase 2:** bisher zeigt das Panel ein neues Zufallspasswort
  nur einmalig an (manuell weiterzugeben); automatischer Mailversand über
  SMTP-Konfiguration folgt später.
- **Self-Service:** ein Spieler kann sein Passwort nicht selbst ändern, nur
  der Admin per Reset (bewusste Entscheidung für Phase 1).
- Kein Löschen von Spielerkonten im Panel, nur Sperren.

### Chernobyl-Tutorial „Block 4 – Die Nacht des 26. April“

Umgesetzt: geführter RBMK-Nachbau der Nacht vom 26. April 1986 ab
Schichtübergabe bis AZ-5, sechs Schritte (`handover`, `dip`, `recover`,
`pumps`, `test`, `az5`), eigene Klasse `RbmkChernobylTutorial`
(`game/chernobylTutorial.js`). Machbarkeit vorab geprüft (Node-Experimente,
siehe CHANGELOG): AZ-5 kombiniert mit geskriptetem Kühlmittelauslauf
(`ev_rbmk_mcp_runback`) führt aus dem validierten Ausgangszustand (ORM≈28,
zweistufige Vorgeschichte 100%→50%→9h halten→7%) zuverlässig zu echter
Brennstoffzerstörung, mit der bestehenden Physik, ohne Kalibrierungsänderung.

Offen/bekannte Einschränkungen:

- **Leistungseinbruch nicht mechanisch simuliert.** Ein echter Reaktivitäts-
  einbruch reißt in diesem vereinfachten Modell mehr Xenon auf, als sich mit
  den verbleibenden Steuerstäben je zurückholen lässt (auch voll gezogen) --
  im Text offen benannt, nicht stillschweigend vereinfacht.
- **Enges Zeitfenster für AZ-5.** Die Kombination aus niedriger ORM und
  Durchsatzverlust wird erst nach ca. 27s Auslaufzeit gefährlich; davor
  bleibt AZ-5 folgenlos. Zusätzlich: laesst man den Auslauf ohne AZ-5 zu
  lange laufen (>~27s), destabilisiert die Anlage auch OHNE AZ-5 von selbst
  (derselbe positive Blasenkoeffizient) -- die Trennung "AZ-5 allein war die
  Ursache" ist dadurch physikalisch nicht ganz sauber, aber historisch
  vertretbar (siehe Anleitungstext).
- **Turbinenauslauf geskriptet**, keine echte Rotordrehzahl-Zustandsgröße
  (bewusste Vereinfachung, siehe frühere Analyse).
- Keine Zeitlupe für die letzten Sekunden vor der Exkursion (Zeitraffer bis
  60× existiert bereits generisch in `loop.js`, Zeitlupe <1× fehlt).

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
