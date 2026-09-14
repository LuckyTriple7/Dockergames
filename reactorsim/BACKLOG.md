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

Der Trendpuffer (`ui/trend.js`) hält die Verläufe ohnehin. Ein Knopf in der
Auswertung, der sie als CSV herausgibt, kostet fast nichts und macht einen Lauf
außerhalb des Spiels auswertbar.

### Mehrbenutzerbetrieb

`persist.py` führt schon ein Spieler-Token je Gerät, `auth.py` kennt dagegen
genau ein Konto aus der Umgebung. Erst mit echten Konten ergibt eine
Bestenliste mit Namen Sinn.

## Weitere Störszenarien

Stand 0.1.20: 14 Szenariodateien einschließlich Anfahren-Tutorial. Zwei
Einzelstörungen aus der Ideensammlung sind jetzt als eigene DWR-Schichten
umgesetzt, ergänzt um eine kombinierte Stufe. Details und Nachweise:
[Szenario-Audit](audit/SZENARIEN-2026-09-14.md).

**Umgesetzt in 0.1.20, mit Modellgrenzen:**
- **DWR: Dampferzeuger-Rohrleck.** `pwr_sg_tube_leak`, Schwierigkeit 2,
  15 Minuten, konstantes Leck von 8 kg/s ohne Vorwarnung/automatischen Helfer.
  `sg_tube_leak` erhöht die Wassermasse des zusammengefassten Dampferzeugers
  und senkt den Druckhalterfüllstand. Keine vollständige Primärleckbilanz,
  keine druckabhängige Leckrate, keine einzelnen Dampferzeuger zur Diagnose
  „welcher DE?“, keine Einzelisolation oder Aktivitätsmessung. Die
  Speisewasserregelung kann den DE-Pegel stabil halten; RESA stoppt das Leck
  nicht. Auch Nichtstun kann den Zeitabschluss erreichen. Punkte sind kein
  Nachweis korrekter Leckbehandlung; eine Diagnoseprüfung fehlt weiterhin.
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
- **DWR: Fehlerhafte Druckmessung.** Kein "die Anzeige zeigt etwas anderes
  als die Physik"-Mechanismus vorhanden -- jeder angezeigte Wert ist heute
  der wahre. Braucht einen eigenen Drift-Zustand pro Messstelle und eine
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
