# Reactorsim – Weitere Verbesserungsvorschläge

Stand: 13.09.2026. Ergänzung zum [Spielaudit](AUDIT-2026-09-13.md) und zum [Physik-Audit](PHYSIK-AUDIT-2026-09-13.md).

Neben den gefundenen Bugs und der Physik sollten vor allem Verständlichkeit, Bedienung und Langzeitmotivation verbessert werden. Die folgenden Punkte dokumentieren die ursprünglichen Vorschläge. Stand 14.09.2026: Die erste Etappe mit Diagnoseanzeigen (Punkt 2) und Schichtauswertung (Punkt 4) ist in Version 0.1.18 umgesetzt; Umfang und Grenzen stehen in [VERBESSERUNGEN-2026-09-14.md](VERBESSERUNGEN-2026-09-14.md). Das DWR-Anfahren-Tutorial (Punkt 1) ist in Version 0.1.19 umgesetzt; siehe [TUTORIAL-2026-09-14.md](TUTORIAL-2026-09-14.md). Version 0.1.20 setzt Punkt 6 teilweise und Punkt 7 für die beiden genannten Einzelstörungen mit Modellgrenzen um; siehe [SZENARIEN-2026-09-14.md](SZENARIEN-2026-09-14.md). Version 0.1.21 setzt Punkt 5 für die drei neuen DWR-Schichten um; siehe [SZENARIOZIELE-2026-09-14.md](SZENARIOZIELE-2026-09-14.md). Die übrigen Szenarien sowie Punkte 3 und 8 bleiben offen.

## 1. Interaktives Anfahren-Tutorial — DWR-Einstieg umgesetzt in 0.1.19

Kurze Aufgaben wie „Leistung stabilisieren“ oder „Druckanstieg abfangen“. Jede Handlung bekommt eine Erklärung ihrer Wirkung.

## 2. Bessere Diagnosehilfen — umgesetzt in 0.1.18

Anzeigen unterscheiden zwischen Bedienwunsch und tatsächlichem Zustand:

- Ventil angefordert / tatsächlich geöffnet.
- Pumpe eingeschaltet / fördert tatsächlich.
- Messwert verfügbar / Messung ausgefallen.

## 3. Aussagekräftige Trends

Ereignismarker für Stabfahrten, Abschaltungen und Störungen ergänzen. Leistung, Druck und Durchsatz sollen zeitlich gemeinsam vergleichbar sein.

## 4. Lehrreiche Auswertung — umgesetzt in 0.1.18

Nach der Schicht erklären:

- Welche Störung trat auf?
- Wie hat der Spieler reagiert?
- Welche Reaktion hat geholfen?
- Wo begann die Verschlechterung?

## 5. Nachvollziehbare Szenarioziele - für drei neue DWR-Schichten umgesetzt in 0.1.21

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

## 7. Mehr Abwechslung durch vorhandene Mechanik - zwei Einzelstörungen umgesetzt in 0.1.20

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

## 8. Komfort beim Spielen

- Letzten erfolgreichen Speicherzeitpunkt anzeigen.
- Verlauf nach Fortsetzen erhalten.
- Einen laufenden Zeitsprung abbrechen können.

## Empfohlene Reihenfolge

1. Bugs und physikalische Modellfehler aus den beiden Audits korrigieren.
2. Diagnoseanzeigen und Auswertung verbessern.
3. Ein interaktives Tutorial ergänzen.
4. Zusätzliche Szenarien und Schwierigkeitsstufen ausbauen.

Diagnoseanzeigen und Auswertung machen bereits die vorhandenen Spielinhalte verständlicher und geben dem Spieler konkretes Feedback zu seinen Entscheidungen.
