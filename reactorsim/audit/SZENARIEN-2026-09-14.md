# Szenarien und gestufte Unterstuetzung

Version **0.1.20**, 14.09.2026. Dritte Etappe der
[Audit-Vorschlaege](VERBESSERUNGSVORSCHLAEGE-2026-09-13.md): Punkt 6 teilweise,
Punkt 7 fuer die beiden genannten Einzelstoerungen mit Modellgrenzen umgesetzt.
Keine Aenderung der Physik, keine neuen Diagnoseziele oder Wertungsregeln.

## Umfang

| Szenario-ID | Profil / Schwierigkeit | Dauer | Ereignisse (Simulationszeit) |
| --- | --- | --- | --- |
| `pwr_feedwater_loss` | Gefuehrt / 1 | 15 min | `feedwater_loss` bei 180 s |
| `pwr_sg_tube_leak` | Selbstaendig / 2 | 15 min | `sg_tube_leak` bei 180 s, 8 kg/s |
| `pwr_combined_faults` | Anspruchsvoll / 3 | 18 min | `turbine_trip` bei 180 s, `feedwater_loss` bei 240 s |

Alle drei starten mit 1400 MWe Netzanforderung. Sie verwenden eigene Dateien
unter `static/data/scenarios/` und feste Seeds 20260914, 20260915, 20260916.
Der Gesamtkatalog umfasst 14 Dateien inklusive Tutorial; Titel, Schwierigkeiten
und Dauern sind in der [README](../README.md) vollstaendig aufgefuehrt.

Das optionale Objekt `guidance` enthaelt `hint_key` (DE-/EN-Hinweistext),
`event_alerts` (Ereignisvorwarnung) und `auto_helper` (automatische Behebung
erlaubt). Nur die gefuehrte Stufe erlaubt Vorwarnung und Helfer entsprechend
den Nutzereinstellungen; Stufen 2/3 sperren beides. Die globale Helferpraeferenz
wird nicht ueberschrieben. Szenarien ohne `guidance` bleiben wie bisher;
die Schwierigkeit allein schaltet keine Hilfe ab. Anlagenregler, Meldetafel,
Alarmtexte und Glossar bleiben verfuegbar, Schutzmeldungen loesen keine RESA aus.

Die Auswahl sortiert je Reaktortyp nach Schwierigkeit, Tutorial zuerst.
Szenariokarten zeigen die neuen Stufenprofile, Einweisung und Spiel die
zugehoerigen Hinweise. Die Einweisung ist erneut aufrufbar; alle neuen Texte
sind deutsch/englisch vorhanden. Scrollpositionen der Hinweiskarten werden
beim Neuaufbau zurueckgesetzt.

## Modell und Wertung

- **Speisewasser:** `feedwater_loss` setzt den Regler einmalig auf Hand/null.
  Automatik und Handstellwert bleiben jederzeit restaurierbar. Weder ein
  permanenter Pumpendefekt noch eine Hilfsspeisung sind modelliert.
- **Rohrleck (SGTR):** `stepEvents()` addiert `8 * dt` zur Wassermasse des
  zusammengefassten Dampferzeugers und senkt den Druckhalterfuellstand um
  `8 * 1.2e-5 * dt` (Untergrenze null). Keine vollstaendige Primaerleckbilanz,
  keine druckabhaengige Leckrate, keine Diagnose eines einzelnen betroffenen
  DE, keine SG-Einzelisolation und keine Aktivitaetsmessung. Die Regelung kann
  den DE-Pegel stabil halten. RESA beendet den Leckstrom nicht; Abkuehlung kann
  den Druckhalterpegel zusaetzlich senken. 8 kg/s ist fuer diesen kurzen
  Beobachtungszeitraum getestet, nicht fuer unbegrenzten Weiterbetrieb.
- **Abschluss:** Zeitablauf ohne Brennstoffschaden oder zu lange ignorierte
  Ausloesemeldung; deren Frist betraegt 180 s in den Einzelstoerungen und 90 s
  in der Kombination, jeweils bei nicht abgeschaltetem Reaktor. Quittieren
  allein beseitigt die Ursache nicht. RESA ist erlaubt. Beim SGTR kann auch
  Nichtstun den Zeitabschluss erreichen. Normale Betriebsscores beweisen
  weder richtige Diagnose noch korrekte Behandlung. Diese Grenzen stehen
  ausdruecklich in den DE-/EN-Locale-Texten, nicht nur in diesem Audit.

## Balancing und Nachweise

Vollstaendiger Teststand: **Node 164/164, Python 82/82 bestanden**.
`tests/test-scenario-progression.mjs` verwendet echte Engine-/Session-Laeufe
mit 0,05-s-Schritten und aufgezeichneten Bedienhandlungen, keinen Auto-Helfer
oder direkte Zustandsreparaturen. Seine Diagnostik liefert je Szenario die
Nichtstun-/Bedien-Summaries, Pegel-/Massenminima, Druckmaximum und Endpegel.

- Speisewasser: Nichtstun scheitert an `fail_trip_ignored`; RESA bei 191 s
  und Automatik bei 195 s erlauben Abschluss. Automatik bereits bei 182 s
  vermeidet die 25-%-Ausloeseschwelle ohne RESA; bei 183 s wird sie schon
  unterschritten, der Lauf kann sich dennoch erholen. Die gefuehrte Stufe
  hat somit ein enges Reaktionsfenster, keinen pauschal sanften Verlauf.
- Rohrleck: Nichtstun erreicht ebenfalls den Abschluss. RESA bei 240 s
  senkt die Endleistung auf unter 3 % des Nichtstun-Laufs, repariert aber
  nichts; der minimale Druckhalterpegel bleibt im Test ueber 17 %.
- Kombination: Nichtstun scheitert; RESA bei 210 s und Speisewasser-Automatik
  bei 255 s erlauben Abschluss. Im Bedienlauf bleiben DE-Pegel ueber 35 %,
  Druckhalterpegel ueber 24 % und Primaerdruck unter 162 bar.
- Speicherung bei 185 s und 300 s prueft Fortsetzung vor/nach Eingriffen;
  das zweite Kombinationsereignis muss nach dem Laden korrekt feuern.
  Endzustand, Auswertung und Replay werden mit dem ununterbrochenen Lauf
  verglichen. Alle Bedienfolgen samt Quittierungen stehen in der Testdatei.
- `test-guidance.mjs` prueft Vorwarnungen, unveraenderte Physik, lokalisierte
  Hinweise, Scrollreset und gesperrte Helferaktionen. Ergaenzte Lifecycle-/
  API-Tests decken Start, erneute Einweisung, Neustart, Fortsetzen, Rueckkehr
  zum normalen Spiel sowie Katalog und Guidance-Metadaten ab.

Reproduktion ab Projektwurzel (Python mit installiertem pytest):

```powershell
node --test "tests/*.mjs"
python -m pytest tests/
node --test tests/test-scenario-progression.mjs
node --test tests/test-guidance.mjs tests/test-lifecycle.mjs
python -m pytest tests/test_api.py tests/test_locales.py
python dev_run.py
```

Browserstatus: Echte Chromium-Version **151.0.7922.34**, Playwright **1.62.0**,
Viewports **1440x900** und **390x844**: **289 Pruefungen bestanden**, keine
Pageerrors, Console-Errors oder HTTP-Fehler. Geprueft wurden Anmeldung,
Szenarioauswahl und Profile, alle drei Briefings/Starts, erneute Einweisung,
Menuewechsel, freies Spiel, Helferpraeferenz und Sperren, echte Speisewasser-
Stoerung samt Helferaktion sowie Erreichbarkeit und Ueberlaeufe. Mausrad und
emulierte Touch-Gesten pruefen die langen Hinweise; kein physisches Mobilgeraet.
Uebernommene Scrollpositionen wurden dabei gefunden, korrigiert und erneut
geprueft. Der innere Hinweisbereich wird erst nach Einblenden des Briefings
zurueckgesetzt. Keine vollstaendigen Szenario-Abschlusslaeufe im Browser;
diese decken die Engine-/Session-Tests ab. Der Browserlauf erfolgte vor dem
reinen Versionswechsel von 0.1.19 auf 0.1.20 mit dem finalen Anwendungscode.

## Verbleibender Ausbau

Punkt 6 bleibt teilweise offen: unvollstaendige Messinformationen und generische
Messausfaelle sind nicht umgesetzt. Fuer Punkt 7 sind die beiden Einzelstoerungen
vorhanden, keine vollstaendige reale Stoerfallprozedur. Punkte 3 (Trends),
5 (nachvollziehbare Ziele/Diagnosewertung) und 8 (Komfort) bleiben offen.
Einzel-DE-Modell, Leckbilanz, Isolation, Aktivitaetsmessung oder echte
Speisewasserdefekte waeren eigene Modellerweiterungen, keine vorhandenen
Bedienmoeglichkeiten. Weitere Szenarioideen bleiben im [Backlog](../BACKLOG.md).
