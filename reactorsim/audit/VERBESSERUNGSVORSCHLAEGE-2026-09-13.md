# Reactorsim – Weitere Verbesserungsvorschläge

Stand: 13.09.2026. Ergänzung zum [Spielaudit](AUDIT-2026-09-13.md) und zum [Physik-Audit](PHYSIK-AUDIT-2026-09-13.md).

Neben den gefundenen Bugs und der Physik sollten vor allem Verständlichkeit, Bedienung und Langzeitmotivation verbessert werden. Die folgenden Punkte dokumentieren die ursprünglichen Vorschläge. Stand 14.09.2026: Die erste Etappe mit Diagnoseanzeigen (Punkt 2) und Schichtauswertung (Punkt 4) ist in Version 0.1.18 umgesetzt; Umfang und Grenzen stehen in [VERBESSERUNGEN-2026-09-14.md](VERBESSERUNGEN-2026-09-14.md). Das DWR-Anfahren-Tutorial (Punkt 1) ist in Version 0.1.19 umgesetzt; siehe [TUTORIAL-2026-09-14.md](TUTORIAL-2026-09-14.md). Version 0.1.20 setzt Punkt 6 teilweise und Punkt 7 für die beiden genannten Einzelstörungen mit Modellgrenzen um; siehe [SZENARIEN-2026-09-14.md](SZENARIEN-2026-09-14.md). Die Punkte 3, 5 und 8 bleiben offen.

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

## 5. Nachvollziehbare Szenarioziele

Neben „bestanden“ auch Zwischenziele zeigen: Anlage stabilisiert, Wärmeabfuhr hergestellt, Versorgung wiederhergestellt. Punkte sollten gute Störfallbeherrschung erkennbar belohnen.

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
jederzeit wiederherstellbar und ohne Hilfsspeisung. Eine Diagnosewertung oder
neue Szenarioziele sind nicht umgesetzt (Punkt 5 bleibt offen): Beim Rohrleck
kann auch Nichtstun den Zeitabschluss erreichen; Scores beweisen keine richtige
Behandlung. Die DE-/EN-Texte benennen diese Grenzen ausdrücklich.

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
