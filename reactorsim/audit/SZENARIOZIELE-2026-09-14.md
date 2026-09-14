# Szenarioziele und Sicherheitswertung

Version **0.1.21**, 14.09.2026. Punkt 5 der
[Verbesserungsvorschlaege](VERBESSERUNGSVORSCHLAEGE-2026-09-13.md) ist fuer die
drei neuen DWR-Schichten umgesetzt, fuer die uebrigen Szenarien weiter offen.
Dieses Audit ersetzt deren Ziel-/Wertungsstand aus dem
[historischen Szenario-Audit 0.1.20](SZENARIEN-2026-09-14.md), nicht dessen
Dokumentation der damaligen Tests. Keine Aenderung der Physik oder der uebrigen
Szenarien; der Katalog bleibt bei 14 Dateien einschliesslich Tutorial.

## Vertrag und Ablauf

Nur die drei folgenden JSON-Dateien unter `static/data/scenarios/` verwenden
`score_mode: "incident_v1"`, jeweils mit genau zwei `objectives`:

| Szenario | Aktivierung nach Ereignissen | Erstes Ziel, 15 s | Zweites Ziel, 120 s | Festes Ende |
| --- | --- | --- | --- | --- |
| `pwr_feedwater_loss` | `feedwater_loss` bei 180 s | `supply`: `pwr_feedwater` | `stable`: `pwr_heat_removal` | 900 s |
| `pwr_sg_tube_leak` | `sg_tube_leak` bei 180 s, 8 kg/s | `power`: `pwr_power_limited` | `stable`: `pwr_heat_removal` | 900 s |
| `pwr_combined_faults` | `turbine_trip` bei 180 s UND `feedwater_loss` bei 240 s | `supply`: `pwr_feedwater` | `stable`: `pwr_heat_removal` | 1080 s |

Die Definitionen enthalten `id`, `type`, `after_events`, `hold_s`; beim
Rohrleck tragen beide Ziele zusaetzlich `max_power_fraction: 0.1`.
Schwierigkeiten 1/2/3, Seeds 20260914/20260915/20260916, Ereignisse, Dauern und
1400 MWe Netzanforderung bleiben erhalten. Guidance bleibt gestuft: Nur die
gefuehrte Speisewasserschicht erlaubt Vorwarnungen und automatische Hilfe laut
Nutzereinstellung. Die beiden anderen sperren beides, nicht die Anlagenregler.

`ScenarioObjectives` prueft echte Engine-Zustaende nach den Szenarioereignissen.
Vorher gibt es keinen Fortschritt; der Aktivierungstakt selbst bringt keine
Haltezeit. In der Kombination muessen fuer beide Ziele beide Ereignisse
eingetreten sein. Die Ziele laufen unabhaengig, nicht als vorgeschriebene
Bedienreihenfolge. Automatikstellung, Lastsollwert, Neutronenleistung oder
SCRAM-Flag allein beweisen die geforderte Anlagenwirkung nicht.

Jede verletzte Bedingung setzt die betroffene Haltezeit und ihr Fenster zurueck.
Auch ein bereits erfuelltes Ziel verliert `met`; `achievedAt` bleibt nur als
erster historischer Erreichungszeitpunkt erhalten. Haltezeiten sind bei 15/120 s
gedeckelt, die Bedingungen werden danach weiter ueberwacht. Das stabile Fenster
ist kein rollender 120-s-Ausschnitt: Pegelspanne und Temperaturbezug gelten fuer
das gesamte ununterbrochene Fenster, bis eine Verletzung es zuruecksetzt.

`Session` beendet einen erfolgreichen Lauf ausschliesslich am urspruenglichen
Zeitende, wenn **beide Ziele aktuell erfuellt** sind. Sonst folgt
`fail_objectives_unmet`. Fruehere Abbruchregeln haben Vorrang: Brennstoffschaden
oder zu lange ununterbrochen anstehende Ausloesemeldung ohne Reaktorabschaltung
(180 s in den Einzelstoerungen, 90 s in der Kombination). Quittieren allein
ersetzt keine Behebung. Zwischenziele beenden die Schicht nicht vorzeitig.

## Gepruefte Grenzen

Alle genannten Zustandswerte, einschliesslich DE-Durchfluessen, -Inventar,
-Pegel, DNBR und Unterkuehlung, muessen endlich sein. Kein Anlagenverlust
(`destroyed`) und kein Simulationsfehler (`fault`). Grenzen sind einschliesslich,
ausser wo ausdruecklich `>` oder `<` steht. Temperaturen sind in Kelvin.

| Pruefung | Kriterien |
| --- | --- |
| Gemeinsam fuer jedes Ziel | Druckhalterpegel 17-100 %, Primaerdruck 140-164 bar, Sekundaerdruck > 0 und < 84 bar; Kernstrom mindestens 18000 kg/s, DNBR mindestens 1,3, Unterkuehlung mindestens 10 K; Huellrohrtemperatur > 0 und < 700 K, Kerneintritt/-austritt > 0 K, Waermeleistung >= 0 |
| Versorgung (`supply`) | Speisewasser- und Dampfstrom jeweils > 1 kg/s; DE-Inventar mindestens 80 % des Nennbestands (36000 kg), DE-Pegel 40-60 % |
| Leistungsbegrenzung (`power`) | Tatsaechliche Waermeleistung `P_th` hoechstens 10 % von `P0_th`; zusaetzliche Versorgungsbedingungen gelten hier nicht, wohl aber beim zweiten Ziel |
| Stabile Waermeabfuhr (`stable`) | Versorgungskriterien plus Betrag von Speisewasser + Leckstrom - Dampfstrom hoechstens `max(5 kg/s, 0.1 * Dampfstrom)`; Leckstrom endlich und nicht negativ |
| Gesamtes stabiles Haltefenster | DE-Pegelspanne maximal 2 Prozentpunkte; Mittel aus Kerneintritt/-austritt maximal 1 K ueber dem Fenster-Anfangswert |
| Rohrleck, beide Ziele | Zusaetzlich durchgehend `P_th <= 0.1 * P0_th`, auch waehrend stabiler Waermeabfuhr |

Die Versorgung kann auch mit tatsaechlich ausreichender manueller Regelung
erfuellt werden. Eine Schalterstellung ist kein Ersatz fuer Durchfluss und
Inventar; RESA allein ist ebenfalls kein Zielnachweis.

## Wertung und Replay

JavaScript `game/scoring.js` und Python `scoring.py` verwenden dieselbe Formel:

| Posten | `incident_v1` |
| --- | --- |
| Aktuell erfuellte Ziele bei der Auswertung | Je 1000 Punkte, maximal 2000; historischer erster Erfolg zaehlt nicht |
| Erfolgreicher Abschluss | 1000 Punkte plus 250 je Schwierigkeitsstufe, nur mit beiden Zielen und ohne Katastrophe |
| Energie, Netzabweichung, RESA, Grenzwertdauer aller Schweregrade | Je 0 Punkte; Kennzahlen bleiben in der Auswertung sichtbar |
| Unquittierte Alarmsekunden | -0,05 Punkte je Sekunde, insgesamt maximal -100 |
| Katastrophen | Unveraendert: Brennstoffschaden -5000, Sicherheitsbehaelterversagen -2500, Wasserstoffexplosion -3000 |

Die Legacy-Bodenregel wird nicht auf `incident_v1` angewendet. Null Punkte fuer
Grenzwertdauer hebt weder Sicherheitsgrenzen noch Abbruchregeln auf. Mission
und Bonus sind keine Belohnung fuer blosses Erreichen der Zeitgrenze.

`POST /api/highscores` verlangt fuer diese drei Szenarien ein Replay-Protokoll;
ohne Liste folgt `replay_required`, bei fehlgeschlagener Nachrechnung
`verification_failed`, ohne Rueckfall auf Client-Angaben. Node rechnet mit
derselben Engine und Session in 0,05-s-Schritten. Die verifizierte Summary
ersetzt die Client-Summary vollstaendig. Anschliessend werden Identitaeten,
Modus, genau zwei konfigurierte Ziel-IDs mit booleschem `met`, Abschlusszeit,
Ergebnis und die uebrigen Kennzahlen validiert. Schwierigkeit und Wertungsmodus
kommen aus dem Serverkatalog, nicht aus frei waehlbaren Client-Feldern.

Automatische Helfereingriffe werden als `helper` mit Schritt und Aktionskennung
aufgezeichnet und nachgespielt. Replay prueft bekannte Helferaktionen und die
Erlaubnis nach `guidance`; ungueltige oder gesperrte Helfereintraege lehnen ein
Incident-Replay ab, auch wenn sie nach dem Laufende stehen. Die globale
Helferpraeferenz bleibt unveraendert. Replay prueft Reproduzierbarkeit, nicht
menschliche Bedienung oder fachliche Gueltigkeit einer realen Prozedur.

`persist.py` speichert neue Scores unter
`reactor/scenario/incident_v1`, alte unter `reactor/scenario`. Bestehende Scores
werden durch die Umstellung weder geloescht noch umgerechnet. Die API zeigt
die zum aktuellen Katalog passende Wertungsversion, auch in ungefilterten
Listen; alte Produktionsscores verdraengen keine neuen Sicherheitswertungen.
Uebrige Szenarien behalten ihre Formel und den bisherigen Replay-/Fallback-Weg.

## Speichern und Anzeige

Das aeussere Speicherformat bleibt `SAVE_VERSION = 1`. `session.objectives`
enthaelt einen eigenen Block mit `version: 1`, Szenario-ID und Zielzustaenden:
`held`, `activatedAt`, `startedAt`, `levelMin`, `levelMax`, `tempBaseline` und
`achievedAt`. So bleiben auch bereits erfuellte oder spaeter widerrufene Ziele
und die Grenzen des ganzen Haltefensters nachvollziehbar.

Wiederherstellung erfolgt nach dem Physikzustand; IDs, Zeiten, Haltewerte,
Fenstergrenzen und aktuelle Bedingungen werden geprueft. Ein ungueltiger
Zielblock wird komplett verworfen, nicht teilweise uebernommen. Alte Staende
ohne gueltigen Zielblock bleiben ladbar, beginnen aber ohne Zielfortschritt;
vergangene Zeit wird nicht nachtraeglich gutgeschrieben. Vergangene Ereignisse
werden beim Laden aufgeholt, ohne die Stoerung erneut auszuloesen.

Der Save enthaelt **kein vollstaendiges Bedien-Replay ab Schichtbeginn**.
`main.js` entfernt daher beim Laden den Recorder: Incident-Laeufe behalten eine
lokale Ziel-/Punkteauswertung, koennen aber nicht in die Bestenliste eingereicht
werden. Das gespeicherte Lern-/Auswertungsjournal ist kein Ersatz fuer Replay.

DE/EN zeigen die Anzahl aktuell erfuellter Ziele, Warten auf Stoerungen,
laufende Haltezeiten, aktuellen Erfolg oder Widerruf und den ersten Erfolg als
Verlauf. Aufklappbare Kriterien halten die Hauptansicht kompakt. Eine erneut
geoeffnete Einweisung zeigt eine aktuelle Momentaufnahme; im Spiel werden die
Ziele laufend aktualisiert. Ladehinweis und Modellgrenzen bleiben sichtbar.

Nach einer erfolgreichen Einreichung uebernimmt die Auswertung die
autoritative Server-Summary, Ergebnis und Punktezerlegung. Abweichende
Zielergebnisse werden angeglichen, statt alte Erfolgsanzeigen stehenzulassen;
historische Zeitangaben werden bei solchen Abweichungen verworfen.
Verspaetete Antworten duerfen nur dieselbe Sitzung und dasselbe noch anstehende
Ergebnis aktualisieren. Bestenlistenantworten sind ebenfalls sitzungsgebunden.
Der im Browser gefundene unerreichbare Auswertungs-Footer wurde durch
`max-height: 82vh; overflow-y: auto` an `.rs-modal-wide` korrigiert; beim
Oeffnen wird die Scrollposition zurueckgesetzt. Der Browser-Retest bestaetigt
die Erreichbarkeit auch nach der autoritativen Serverantwort.

## Nachweise

Vollstaendige Tests: **Node 210/210 bestanden, Python 158/158 bestanden**.

- `tests/test-objectives.mjs`: Aktivierung erst nach Ereignissen, beide
  Kombinationsereignisse, exakte Haltezeiten, Unterbrechung/Widerruf,
  Sicherheitsgrenzen und nichtendliche Werte, Bilanz samt Leck, Fenstergrenzen,
  Save-Validierung und Abschluss am letzten Takt statt vorzeitigem Erfolg.
- `tests/test-scenario-progression.mjs`: echte Engine-/Session-Laeufe ohne
  kuenstliche Physikreparaturen, aufgezeichnete Bedienhandlungen, Nichtstun als
  Gegenprobe, Speicherung bei 185/300/600 s sowie identische Fortsetzung und
  Replay-Summaries. Beim Rohrleck scheitert Nichtstun nun an den Zielen;
  Speisewasser/Kombination scheitern ohne Eingriff an ignorierten Ausloesemeldungen.
- Manuelle Bediengegenprobe im gefuehrten Szenario: Automatik bei 182 s, also
  zwei Sekunden nach Ausfall, besteht ohne RESA und ohne Ausloeseschwelle.
  Bei 183 s wird der niedrige Pegel bereits unterschritten, Erholung bleibt
  moeglich. RESA ohne Wiederherstellung der Speisung scheitert in Speisewasser
  und Kombination. Kein pauschal sanftes Reaktionsfenster.
- `test-incident-scoring.mjs`, `test_scoring.py`, `test_api.py`, Replay-/Helfer-
  und Persistenztests: Formelparitaet, Summary-Validierung, Replay-Pflicht,
  serverseitiges Ergebnis, Helferprotokolle/Guidance und getrennte Listen.
- `test-objectives-ui.mjs`, Guidance-/Lifecycle- und Locale-Tests:
  Zielstatus, erster Erfolg/Widerruf, Kriterien, Ladehinweis, Einweisung,
  Auswertung und abgesicherte Serverantworten in DE/EN.

Serverseitig bestaetigte erfolgreiche Laeufe: **Speisewasser 3247, SGTR 3499, Kombination
3750, gefuehrter Helferlauf 3247 Punkte**. Das sind beobachtete Ergebnisse
konkreter aufgezeichneter Bedienplaene, keine universellen Sollscores;
insbesondere Quittierzeitpunkte beeinflussen den Alarmabzug. Die manuellen
Progressionsplaene samt Quittierungen stehen in `test-scenario-progression.mjs`:
RESA/Speisung bei 191/195 s, SGTR-RESA bei 240 s, Kombination bei 210/255 s.

Abschliessender Browserlauf: **1541 Pruefungen bestanden, 0 fehlgeschlagen**.
Chromium **151.0.7922.34**, Playwright **1.62.0**, Desktop **1440x900** und
emuliertes Mobilformat **390x844**, jeweils Deutsch und Englisch. Keine
JavaScript-, Console- oder HTTP-Fehler. 39 echte Footer-Klicks/Taps bestaetigen
Eintragen, Neustart und Menue ohne Tastatur-/JS-Klick-Workarounds.

Geprueft wurden unter anderem 12 erfolgreiche frische Schichten, sechs exakte
Save/Restore-Fortsetzungen mitten in der Haltezeit, Grenztakte 14,95/119,95 s,
Zielverlust durch echten Speisewasserentzug, Wiedererreichung, untatiger SGTR,
lokale Auswertung geladener Staende und vier echte Server-Replays einschliesslich
UI-Helfereingriff. Der erste Lauf fand einen unerreichbaren Auswertungs-Footer;
nach der Scrollkorrektur wurde die gesamte Suite mit zusaetzlichen
Erreichbarkeitspruefungen wiederholt.

Fuer reproduzierbare Zeitpunkte wurde nur testseitig ein App-Zugriff im
ausgelieferten JavaScript ergaenzt. Bei gestoppter Bildschleife liefen echte
Engine-/Session-Schritte von 0,05 s, Bedienaktionen, Recorder und Renderer;
keine vorgegebenen Ersatz-Physikwerte. Mobile ist Touch-Emulation, kein Test
auf physischem Endgeraet. Der Browserlauf testete den finalen Anwendungscode
vor dem reinen Versionswechsel von 0.1.20 auf 0.1.21.

Reproduktion der automatisierten Suiten ab Projektwurzel:

```powershell
node --test "tests/*.mjs"
python -m pytest tests/
```

## Grenzen und Restarbeit

Das Rohrleck bleibt ein konstanter Eintrag von 8 kg/s in einen zusammengefassten
DE mit sinkendem Druckhalterpegel. Keine vollstaendige Primaerleckbilanz,
druckabhaengige Leckrate, Einzel-DE-Diagnose, Isolation, Aktivitaetsmessung oder
Reparatur. RESA und Zielerfolg stoppen das Leck nicht; Abkuehlung kann den
Druckhalterpegel weiter senken. Speisewasserverlust bleibt ein einmaliges
Hand/null des Reglers, kein permanenter Pumpenschaden und keine Hilfsspeisung.
Die Grenzwerte sind fuer diese kurzen Spielschichten kalibriert, kein Nachweis
richtiger realer Behandlung oder sicheren unbegrenzten Weiterbetriebs.

Offen bleiben volle Zieluebernahme fuer andere Szenarien, weitergehende
Diagnosebewertung, aussagekraeftigere gemeinsame Trends/Ereignismarker (Punkt 3),
unvollstaendige Messinformationen und generische Messausfaelle (Punkt 6),
Komfortausbau (Punkt 8) sowie die genannten Modell-/Sensorerweiterungen.
Weitere Szenarioideen stehen im [Backlog](../BACKLOG.md).
