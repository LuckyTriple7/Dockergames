# Erste Verbesserungsetappe: Diagnose und Schichtauswertung

Stand: 14.09.2026, Version **0.1.18**. Umgesetzt sind die vom Nutzer ausgewählten
Punkte 2 und 4 aus den [Verbesserungsvorschlägen](VERBESSERUNGSVORSCHLAEGE-2026-09-13.md).

## Diagnose

Der aufklappbare Diagnosebereich im Primärpanel zeigt für DWR, SWR und RBMK
Pumpenantrieb, Drehzahl und Pumpenbeitrag getrennt. Der Pumpenbeitrag enthält
keinen Naturumlaufsockel; der ebenfalls angezeigte Kernstrom enthält ihn.
Dadurch bleibt der Auslauf einer abgeschalteten Pumpe erkennbar.

Turbinenregelventil und Umleitventil zeigen den anliegenden Ventilauftrag und
die tatsächliche Öffnung. Der Auftrag kann bereits durch eine Verriegelung
begrenzt sein. Eine Öffnung ist keine Durchflussbestätigung.

Beim SWR stehen Notkondensator-Bedienwunsch und Rückmeldung nebeneinander.
Ohne DC wird die tatsächliche Stellung nicht offengelegt, sondern die
Rückmeldung als ausgefallen bezeichnet. Die Füllstandszahl wird ebenfalls
als ausgefallen markiert; das Rundinstrument hält weiterhin den letzten
Wert. Die Diagnose erklärt diese Unterscheidung. Die Notkondensator-Tasten
zeigen konsequent den Bedienwunsch. Die Diesel-Löschwasserpumpe bekommt eine
getrennte Anzeige für Einschaltwunsch und tatsächlich eingespeisten Strom.

## Schichtauswertung

Ein eigenes Protokoll erfasst im Simulationstakt aufgetretene Szenariostörungen
und kommende/gehende Meldungen. Gemeinsame und typspezifische Bedienaufträge
sowie Helfereingriffe werden unabhängig vom Replay-Recorder aufgezeichnet.
Die Auswertung eines Szenarios zeigt den zeitlich geordneten Verlauf vor
der bestehenden Punktezerlegung und hebt das erste protokollierte Warn- oder
Auslösesignal hervor.

Erlischt eine Meldung innerhalb von 120 Simulationssekunden nach einem
Bedienauftrag, nennt die Auswertung den letzten Auftrag und seinen Abstand.
Der Text erklärt ausdrücklich, dass zeitliche Nähe allein keine Ursache
beweist. Dies ist eine Lernhilfe anhand beobachteter Meldungswechsel, keine
Gegenrechnung dazu, welche einzelne Handlung den Verlauf verursacht hat.

Neue Spielstände erhalten das Protokoll einschließlich aktiver Meldungen.
Nach dem Laden werden weiterhin anstehende/quittierte Meldungen nicht erneut
als neu protokolliert. Bei alten Spielständen fehlt der frühere Verlauf;
diese Lücke wird gekennzeichnet. Bis zu 600 Einträge bleiben erhalten,
fortlaufende Schieberbewegungen werden zusammengefasst. Auch eine Kürzung
wird gekennzeichnet. Das Highscore-Summary und die Wertungsformel bleiben
unverändert. Die neue Nachbesprechung erscheint in der Szenarioauswertung;
freies Spiel hat weiterhin seinen bisherigen Verlustdialog.

## Prüfung

- Vollständige JavaScript-Suite: `node --test reactorsim/tests/test-*.mjs` —
  **144 bestanden, 0 fehlgeschlagen**.

- Acht neue Tests in `tests/test-learning.mjs`: Pumpenauslauf aller Typen,
  Ventilfahrt, SWR-Messverlust und ausbleibende Hochdruckeinspeisung,
  Fortsetzung ohne Recorder, getrennte Bedienaufträge, Ereignisaufzeichnung
  ohne Renderdurchlauf, lokalisierte Auswertung und alte Spielstände.
- Die fünf vorhandenen Übersetzungsprüfungen wurden mit `runpy` direkt
  ausgeführt und bestanden. Im verfügbaren Python ist pytest nicht installiert.
- Syntaxprüfung von `main.js` und `panels.js` sowie `git diff --check` bestanden.
- Kein visueller Durchlauf in einem echten Browser; die UI-Tests verwenden
  einen minimalen DOM-Ersatz und die echten deutschen Übersetzungen.

Tutorial, Trendmarker, Zwischenziele, Schwierigkeitsstufen, zusätzliche
Szenarien und weitere Komfortfunktionen bleiben für spätere Etappen offen.
