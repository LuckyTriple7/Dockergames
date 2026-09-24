# Reactorsim – Weitere Verbesserungsvorschläge

Stand: 13.09.2026. Ergänzung zum [Spielaudit](AUDIT-2026-09-13.md) und zum [Physik-Audit](PHYSIK-AUDIT-2026-09-13.md).

Neben den gefundenen Bugs und der Physik sollten vor allem Verständlichkeit, Bedienung und Langzeitmotivation verbessert werden. Die folgenden Punkte dokumentieren die ursprünglichen Vorschläge. Stand 14.09.2026: Die erste Etappe mit Diagnoseanzeigen (Punkt 2) und Schichtauswertung (Punkt 4) ist in Version 0.1.18 umgesetzt; Umfang und Grenzen stehen in [VERBESSERUNGEN-2026-09-14.md](VERBESSERUNGEN-2026-09-14.md). Das DWR-Anfahren-Tutorial (Punkt 1) ist in Version 0.1.19 umgesetzt; siehe [TUTORIAL-2026-09-14.md](TUTORIAL-2026-09-14.md). Version 0.1.20 setzt Punkt 6 teilweise und Punkt 7 für die beiden genannten Einzelstörungen mit Modellgrenzen um; siehe [SZENARIEN-2026-09-14.md](SZENARIEN-2026-09-14.md). Version 0.1.21 setzt Punkt 5 für die drei neuen DWR-Schichten um; siehe [SZENARIOZIELE-2026-09-14.md](SZENARIOZIELE-2026-09-14.md). Version 0.1.22 setzt Punkt 3 global und den Trendhistorien-Teil von Punkt 8 um; siehe [TRENDS-2026-09-14.md](TRENDS-2026-09-14.md). Version 0.1.23 erfüllt Punkt 8 mit Speicherstatus und Zeitsprung-Abbruch vollständig; siehe [KOMFORT-2026-09-14.md](KOMFORT-2026-09-14.md). Ziele für die übrigen Szenarien und die weiteren fachlichen Erweiterungen bleiben offen.

Version 0.1.24 erweitert Punkt 5 auf eine RBMK-Schicht und ergänzt Punkt 7 um
aktive Versorgung nach AZ-5; aktuell 15 Szenarien, davon vier mit `incident_v1`.
Siehe [RBMK-POST-AZ5-2026-09-14.md](RBMK-POST-AZ5-2026-09-14.md).

## 1. Interaktives Anfahren-Tutorial — DWR-Einstieg umgesetzt in 0.1.19

Kurze Aufgaben wie „Leistung stabilisieren“ oder „Druckanstieg abfangen“. Jede Handlung bekommt eine Erklärung ihrer Wirkung.

## 2. Bessere Diagnosehilfen — umgesetzt in 0.1.18

Anzeigen unterscheiden zwischen Bedienwunsch und tatsächlichem Zustand:

- Ventil angefordert / tatsächlich geöffnet.
- Pumpe eingeschaltet / fördert tatsächlich.
- Messwert verfügbar / Messung ausgefallen.

## 3. Aussagekräftige Trends - global umgesetzt in 0.1.22

Ereignismarker für Stabfahrten, Abschaltungen und Störungen ergänzen. Leistung, Druck und Durchsatz sollen zeitlich gemeinsam vergleichbar sein.

Umgesetzt für aktuell alle 15 Szenarien und freies Spiel aller drei Reaktortypen:
gemeinsame 1-Hz-Historie der letzten acht Simulationsstunden, vier Haupt- und
vier erweiterte Diagramme mit gemeinsamer Zeitachse, bis zu 600 Marker sowie
Markerwahl mit weißem Cursor, festgehaltener Ansicht und Live-Rückkehr.
Bedienaufträge sind von tatsächlichen Zustandswechseln getrennt; fehlende
Messwerte bleiben Lücken. Zielmarker gelten aktuell für vier Störungsschichten
(drei DWR, eine RBMK) und die fünf eigenen Lernziele des Anfahren-Tutorials,
nicht als neue Ziele für alle Szenarien.

## 4. Lehrreiche Auswertung — umgesetzt in 0.1.18

Nach der Schicht erklären:

- Welche Störung trat auf?
- Wie hat der Spieler reagiert?
- Welche Reaktion hat geholfen?
- Wo begann die Verschlechterung?

## 5. Nachvollziehbare Szenarioziele - drei DWR-Schichten 0.1.21, eine RBMK-Schicht 0.1.24

Neben „bestanden“ auch Zwischenziele zeigen: Anlage stabilisiert, Wärmeabfuhr hergestellt, Versorgung wiederhergestellt. Punkte sollten gute Störfallbeherrschung erkennbar belohnen.

Umgesetzt für `pwr_feedwater_loss`, `pwr_sg_tube_leak` und
`pwr_combined_faults`: je zwei Zustandsziele nach den erforderlichen Störungen,
15 Sekunden Versorgung beziehungsweise begrenzte Wärmeleistung und 120 Sekunden
stabile Wärmeabfuhr. Grenzverletzungen setzen Haltezeiten zurück; beide Ziele
müssen am festen Schichtende aktuell erfüllt sein. Übersicht, laufende Zeiten,
erster Erfolg als Verlauf und Detailkriterien sind in DE/EN sichtbar.
`incident_v1` belohnt aktuelle Ziele statt Stromproduktion, ohne RESA-Abzug.
Speicherung erhält Fortschritt; Bestenlisten verlangen ein vollständiges
Server-Replay und bleiben von alten Betriebswertungen getrennt.

Seit 0.1.24 zusätzlich `rbmk_post_az5`: genau zwei Ziele, Inventarversorgung
30 s und stabile Wärmeabfuhr 120 s, nach allen drei Ereignissen und dem nächsten
Physikschritt. Reale Speisung, Trommelinventar, Wärmeabfuhr und Reserve zählen;
beide Ziele müssen bei 1800 s aktuell erfüllt sein. Rücksetzen/Widerruf und
`incident_v1` bleiben gleich, der erste Erfolg ist nur Historie. Für alle vier
Schichten ist kanonisches Server-Replay Pflicht; geladene Läufe bleiben lokal.
Details: [RBMK-Audit 0.1.24](RBMK-POST-AZ5-2026-09-14.md).

Offen bleiben die vollständige Übertragung auf die übrigen Szenarien und
weitergehende Diagnoseprüfungen. Die Ziele sind kalibrierte Spielkriterien,
kein Nachweis vollständiger realer Störfallbehandlung oder Leckreparatur.

## 6. Gestufte Schwierigkeit - teilweise umgesetzt in 0.1.20

Einstieg mit Einweisung und Hinweisen; anspruchsvollere Schichten mit unvollständigen Messinformationen und kombinierten Störungen. Physikalische Zusammenhänge bleiben gleich.

Umgesetzt: drei DWR-Stufen mit konkreter Anleitung, selbständiger Einzelstörung
und kombinierten Störungen; Profile auf den Karten, Hinweise in Einweisung und
Spiel. Vorwarnung und automatischer Helfer sind szenarioabhängig begrenzt,
ohne Änderung der Physik oder globalen Helferpräferenz. Unvollständige
Messinformationen und generische Messausfälle bleiben späterem Ausbau vorbehalten.

## 7. Mehr Abwechslung - DWR-Etappe 0.1.20, RBMK-Erweiterung 0.1.24

Dampferzeugerrohrbruch oder Speisewasserausfall als eigenständige Diagnoseaufgabe anbieten. Zunächst jeweils eine klare Störung verwenden, bevor mehrere Ereignisse kombiniert werden.

`pwr_sg_tube_leak` und `pwr_feedwater_loss` sind eigene Schichten;
`pwr_combined_faults` ergänzt die Kombination. Das Rohrleck verwendet nur einen
zusammengefassten DE und eine vereinfachte Leckwirkung, ohne Einzelisolation oder
Aktivitätsmessung. Speisewasserverlust setzt nur den Regler auf Hand/null,
jederzeit wiederherstellbar und ohne Hilfsspeisung. Seit 0.1.21 prüfen die
neuen Zustandsziele begrenzte Stabilisierung (Punkt 5); beim Rohrleck genügt
Nichtstun nicht mehr zum Erfolg. Eine vollständige Diagnosewertung fehlt
weiterhin, Scores beweisen keine richtige reale Behandlung. Die DE-/EN-Texte
benennen diese Grenzen ausdrücklich.

Neue Etappe 0.1.24: **AZ-5 war erst der Anfang**, RBMK, Schwierigkeit 3,
30 Minuten. Echtes SCRAM bei t=0 erhält die gespeicherte Wärme; vier
Pumpenausfälle, physisch begrenzte normale Speisung und erst später verfügbare,
manuell zu dosierende Hilfsspeisung verlangen aktive Wärmeabfuhr statt weiterer
AZ-5-Betätigung. Auftrag, Iststrom, Bilanz und endlicher Vorrat sind sichtbar.
Die neue Versorgungsmechanik ergänzt die bestehende Massen-/Energiebilanz;
beide Speisewege bei 165 °C sind ausdrücklich eine Spielabstraktion, keine
reale Prozedur. Alte Szenario-JSONs und historische Berichte bleiben unverändert.
Andere Szenarioziele, detaillierte Diagnose und generische Messausfälle bleiben offen.

## 8. Komfort beim Spielen - vollständig erfüllt in 0.1.23

- Umgesetzt in 0.1.23: globaler letzter erfolgreicher Auto-/Handspeicherzeitpunkt
  unter den Bedienelementen, mit bleibendem Fehler auch bei laufendem Retry.
  Neue Schreibbestätigung verwendet die Browserzeit, geladene Stände das echte
  serverseitige `saved_at`; keine neue Speicherung beim Laden, Status je Runde.
- Umgesetzt in 0.1.22: vorgehaltene Trendhistorie und Marker nach Fortsetzen exakt
  erhalten, ohne Ausdünnung der gespeicherten Daten; alte/ungültige Trendblöcke
  werden als fehlende Historie benannt, ohne gültige Anlagenzustände abzulehnen.
- Umgesetzt in 0.1.23: ausdrücklicher Xenon-Zeitsprung-Abbruch sowie Abbruch
  durch Pause, globale Leertaste oder SCRAM. Erreichter Zustand bleibt pausiert;
  nur Zielerfolg setzt mit 1× fort, nicht das 48-Stunden-Limit.

Zusätzlich umgesetzt: der gesamte Laufzeit-Hinweisbereich ist über seine
Überschrift einklappbar, standardmäßig offen, mit gemerkter Wahl und weiterhin
laufenden Zielen. Die Einweisung bleibt ohne äußeren Klappbereich.
Sichere Speicherwarteschlangen und wiederholbares Szenarioladen ergänzen den
Komfortabschluss; Umfang, Nachweise und Grenzen im
[Komfort-Audit 0.1.23](KOMFORT-2026-09-14.md).

## Empfohlene Reihenfolge

1. Bugs und physikalische Modellfehler aus den beiden Audits korrigieren.
2. Diagnoseanzeigen und Auswertung verbessern.
3. Ein interaktives Tutorial ergänzen.
4. Zusätzliche Szenarien und Schwierigkeitsstufen ausbauen.

Diagnoseanzeigen und Auswertung machen bereits die vorhandenen Spielinhalte verständlicher und geben dem Spieler konkretes Feedback zu seinen Entscheidungen.
