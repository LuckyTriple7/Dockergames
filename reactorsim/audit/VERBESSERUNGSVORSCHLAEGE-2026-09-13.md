# Reactorsim – Weitere Verbesserungsvorschläge

Stand: 13.09.2026. Ergänzung zum [Spielaudit](AUDIT-2026-09-13.md) und zum [Physik-Audit](PHYSIK-AUDIT-2026-09-13.md).

Neben den gefundenen Bugs und der Physik sollten vor allem Verständlichkeit, Bedienung und Langzeitmotivation verbessert werden. Die folgenden Punkte dokumentieren die ursprünglichen Vorschläge. Stand 14.09.2026: Die erste Etappe mit Diagnoseanzeigen (Punkt 2) und Schichtauswertung (Punkt 4) ist in Version 0.1.18 umgesetzt; Umfang und Grenzen stehen in [VERBESSERUNGEN-2026-09-14.md](VERBESSERUNGEN-2026-09-14.md). Die übrigen Punkte bleiben offen.

## 1. Interaktives Anfahren-Tutorial

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

## 6. Gestufte Schwierigkeit

Einstieg mit Einweisung und Hinweisen; anspruchsvollere Schichten mit unvollständigen Messinformationen und kombinierten Störungen. Physikalische Zusammenhänge bleiben gleich.

## 7. Mehr Abwechslung durch vorhandene Mechanik

Dampferzeugerrohrbruch oder Speisewasserausfall als eigenständige Diagnoseaufgabe anbieten. Zunächst jeweils eine klare Störung verwenden, bevor mehrere Ereignisse kombiniert werden.

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
