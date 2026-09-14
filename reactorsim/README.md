<p align="center"><img src="static/img/logo.png" alt="ReactorSim" width="360"></p>

# ReactorSim

Kernkraftwerks-Leitstand als Browser-Spiel. Du bist Reaktorfahrer: Anlage im
Fahrbereich halten, der Netzanforderung folgen, Störungen beherrschen.

Drei Reaktortypen mit echten physikalischen Eigenheiten:

| Typ | Leistung | Charakter |
|---|---|---|
| **DWR** — Druckwasserreaktor | 3850 MWth / 1400 MWe | Zwei Kreisläufe, 158 bar, kein Sieden im Kern. Steuerstäbe schnell, Borsäure langsam. Alle Rückkopplungen negativ — verzeiht viel. |
| **SWR** — Siedewasserreaktor | 3840 MWth / 1344 MWe | Ein Kreislauf, Dampf direkt zur Turbine. Leistung über den Umwälzstrom in Sekunden. Bei wenig Durchsatz und viel Leistung droht die Dichtewelleninstabilität. |
| **RBMK-1000** | 3200 MWth / 1000 MWe | Graphitmoderiert, Druckröhren. Bei kleiner Leistung wird der Dampfblasenkoeffizient positiv, und die Abschaltreserve ORM entscheidet, ob die Schnellabschaltung abschaltet — oder zündet. |

> Physikalisch nachgebildet, aber ein Spiel. Kein Ausbildungssimulator.

## Betrieb

Kein Home-Assistant-Add-on — der Ordner enthält bewusst keine `config.yaml`.
Betrieb über Docker (Dockge, Portainer, `docker compose`):

```bash
docker compose up -d
```

Danach `http://<server>:17779` öffnen. Der Dienst hört im Container fest auf
17779; willst du einen anderen Port, ändere nur die linke Seite der
Portzuordnung in der `docker-compose.yml`.

Der Zugang ist durch ein Konto geschützt — Benutzer und Passwort kommen aus
`REACTORSIM_USER` und `REACTORSIM_PASSWORD`. Ohne gesetztes Passwort erzeugt
ReactorSim beim ersten Start eines und schreibt es ins Protokoll; offen steht
die Seite nie. Weitere Konten (eigene Spielstände je Konto) über
`REACTORSIM_USERS="name:passwort,name2:passwort2"`. Je Konto ist genau eine
Sitzung gleichzeitig aktiv — meldet es sich auf einem zweiten Gerät an, endet
die Sitzung auf dem ersten.

Unter `./data` landen Spielstände, Bestenliste und die Zugangsdaten (nur als
Hash). Personenbezogene Daten entstehen keine — der Spielstand gehört dem
Konto, nicht dem Gerät.

## Anfahren lernen

Wähle **DWR → Tutorial: DWR selbst anfahren → Schicht beginnen**. Die Übung
beginnt heiß und unterkritisch mit vorbereiteter Abschaltgruppe und
Borkonzentration. Fünf Aufgaben führen von der Zustandsprüfung über Pumpen-
und Stabbedienung bis zur stabilen Abgabe von 150 MWe. Die Tutorialkarte über
dem Leitstand zeigt aktuelle Werte, passende Hinweise und die noch erforderliche
Haltezeit. Über „Warum wirkt das?“ erhältst du die Erklärung, über
„Passendes Panel anzeigen“ gelangst du zur jeweiligen Bedienung.

Zum Lesen kannst du pausieren. Nutze zunächst 1× für Stabfahrten und warte
die tatsächliche Bewegung ab. Der Abschluss verlangt 120 zusammenhängende
stabile Simulationssekunden; nach spätestens 60 Simulationsminuten endet ein
unvollständiger Versuch ohne Erfolg. Speichern und Fortsetzen erhalten auch
das Lernziel und seine Haltezeit. Die Übung hat eine Auswertung mit erreichten
Lernzielen und Schichtverlauf, aber keine Punkte oder Bestenlisteneinträge.

## Szenarien

Neben dem freien Spiel gibt es Schichten mit Auftrag: eine Bedarfskurve, die du
einhalten sollst, geplante Störungen und eine Wertung am Ende. In den bisherigen
Betriebsszenarien zählen gelieferte Energie, Abweichung vom Bedarf, unquittierte Alarmsekunden,
Grenzwertüberschreitungen nach Schwere, Schnellabschaltungen und
Brennstoffschaden. Die drei neuen DWR-Störungsschichten verwenden seit 0.1.21
stattdessen die unten beschriebene Sicherheitswertung; das Tutorial bleibt ungewertet.

Alle 14 Szenariodateien, einschließlich Tutorial (Dauer in Simulationszeit):

| Szenario | Typ | Schwierigkeit | Dauer |
|---|---|---|---|
| Tutorial: DWR selbst anfahren | DWR | 1, Tutorial | max. 60 min |
| Lastfolge über vier Stunden | DWR | 1 | 240 min |
| Speisewasserregelung: geführte Störung | DWR | 1, geführt | 15 min |
| Turbinenschnellschluss | DWR | 2 | 60 min |
| Dampferzeuger-Rohrleck: selbständige Einordnung | DWR | 2, selbständig | 15 min |
| Klemmendes Abblaseventil | DWR | 3 | 60 min |
| Kombinierte Störungen: Prioritäten setzen | DWR | 3, anspruchsvoll | 18 min |
| Lastfolge über den Umwälzstrom | SWR | 2 | 180 min |
| Frischdampf-Absperrung | SWR | 3 | 45 min |
| Dichtewellen-Instabilität | SWR | 3 | 60 min |
| Station-Blackout | SWR | 3 | 360 min |
| Ausfall einer Umwälzpumpengruppe | RBMK | 2 | 60 min |
| Nachtschicht | RBMK | 3 | 180 min |
| Wiederanlauf aus heissem Stillstand | RBMK | 3 | 150 min |

Die Auswahl ist je Reaktortyp nach Schwierigkeit sortiert, das Tutorial steht
zuerst. Die drei neuen DWR-Schichten zeigen ihr Stufenprofil auf der Karte:
**geführt** mit konkreten Hinweisen, Ereignisvorwarnungen und erlaubter
automatischer Hilfe gemäß Einstellungen; **selbständig** mit einer Einzelstörung;
**anspruchsvoll** mit kombinierten Störungen. Die beiden höheren Profile haben
keine Ereignisvorwarnungen und keine automatische Behebung. Hinweise stehen in
Einweisung und Spiel, die Einweisung lässt sich erneut öffnen. Alarmtexte und
Glossar bleiben verfügbar; alle neuen Texte gibt es auf Deutsch und Englisch.
Die globale Helfereinstellung wird nicht verändert. Bestehende Szenarien ohne
`guidance` behalten ihr bisheriges Verhalten, unabhängig von ihrer Schwierigkeit.

Die Physik bleibt unverändert. Speisewasserverlust bedeutet hier nur Regler auf
Hand/null: Automatik und Handstellwert bleiben bedienbar, ohne permanenten
Pumpendefekt oder Hilfsspeisung. Das Rohrleck ist ein vereinfachter Masseneintrag
in einen zusammengefassten Dampferzeuger mit sinkendem Druckhalterfüllstand,
keine vollständige Primärleckbilanz; Einzelisolation und Aktivitätsmessung fehlen.
RESA stoppt das Leck nicht. Die neuen Ziele bestätigen nur begrenzte,
für das Spiel kalibrierte Stabilisierung, keine vollständige Störfallbehandlung,
Leckreparatur oder sicheren Dauerbetrieb.

Seit 0.1.21 haben diese drei Schichten genau zwei Zustandsziele (`incident_v1`):
Speisewasserversorgung für 15 Sekunden, beim Rohrleck stattdessen tatsächliche
Wärmeleistung höchstens 10 % der Nennwärmeleistung; dazu stabile Wärmeabfuhr
für 120 Sekunden, beim Rohrleck ebenfalls unter dieser Leistungsgrenze.
Die Prüfung beginnt erst nach der Störung, in der Kombination nach beiden.
Reale Durchflüsse, Inventare und Sicherheitsgrenzen zählen, nicht allein
Reglerstellung oder RESA. Jede Unterbrechung setzt die betreffende Haltezeit
zurück, auch nach erstmaligem Erreichen. Beide Ziele müssen am festen Ende
bei 900 beziehungsweise 1080 Simulationssekunden aktuell erfüllt sein.
Abwarten genügt nicht; Zwischenziele beenden die Schicht nicht vorzeitig.

Je aktuell erfülltem Ziel gibt es 1000 Punkte; erfolgreicher Abschluss bringt
zusätzlich 1000 plus 250 je Schwierigkeitsstufe. Energie, Netzabweichung,
RESA und Grenzwertdauer tragen jeweils null Punkte bei. Unquittierte Alarme
kosten weiterhin bis zu 100 Punkte; Katastrophenabzüge und Abbruchregeln
bleiben unverändert. Zielübersicht, Haltezeiten, erster Erfolg als Verlauf
und aufklappbare Kriterien stehen in Einweisung, Spiel und Auswertung.
Erneut geöffnete Einweisungen zeigen den aktuellen Zielstand.

Speichern erhält den Zielfortschritt; alte Spielstände ohne gültigen Zielblock
beginnen die Haltezeiten neu. Geladene Läufe werden nur lokal ausgewertet:
Ohne vollständiges Replay ab Schichtbeginn ist für diese drei Szenarien kein
Bestenlisteneintrag möglich. Alte Betriebswertungen bleiben gespeichert und
werden nicht mit den neuen Sicherheitswertungen vermischt. Grenzwerte,
Balancing und Nachweise: [Ziel-Audit](audit/SZENARIOZIELE-2026-09-14.md).
Der [Szenario-Audit](audit/SZENARIEN-2026-09-14.md) hält den historischen
Stand 0.1.20 fest.

Ein Szenario ist eine Datendatei unter `static/data/scenarios/`. Störungs-
zeitpunkte dürfen `"rand(6000,8400)"` sein und werden über den Startwert des
Szenarios aufgelöst — derselbe Startwert ergibt dieselbe Schicht.

## Schnittstelle

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/health` | Healthcheck — als einziger Pfad ohne Anmeldung |
| GET/POST | `/login`, `/logout` | Anmeldung |
| GET | `/api/meta` | Version und Szenarienliste |
| GET/PUT/DELETE | `/api/saves[/<slot>]` | Spielstände |
| GET/POST | `/api/highscores` | Bestenliste |

Der Server rechnet den Punktestand **selbst**; ein mitgeschicktes `score`-Feld
wird nicht gelesen. Mitgelieferte Bedienprotokolle werden in Node durch
dieselbe Engine und Session nachgerechnet. Das Replay-Ergebnis ersetzt die
Client-Kennzahlen; scheitert die Nachrechnung, wird die Einreichung abgelehnt.
Für die drei `incident_v1`-Szenarien ist dieses Replay Pflicht. Aufgezeichnete
Helfereingriffe werden auf bekannte Aktionen und die Erlaubnis laut `guidance`
geprüft. Die Auswertung übernimmt die autoritative Server-Summary samt
Ergebnis und Punkten, ohne verspätete Antworten in eine andere Sitzung zu übernehmen.

Zusätzlich werden Kennzahlen auf Plausibilität geprüft. Nur die bisherigen
Betriebsszenarien erlauben weiterhin Einreichungen ohne Replay, etwa nach dem
Laden; diese reine Plausibilitätsprüfung ist nicht fälschungssicher. Auch ein
Replay beweist einen reproduzierbaren Spielverlauf, nicht menschliche Bedienung
oder eine fachlich richtige reale Störfallbehandlung. Der Spielstand selbst
bleibt für den Server undurchsichtig und wird beim Laden im Browser geprüft.

## Bedienung

- **Zeitraffer** 1× / 4× / 16× / 60×. Der Rechenschritt bleibt dabei konstant,
  der Zeitraffer verändert die Genauigkeit also nicht. Bei einer Schnell-
  abschaltung schaltet das Spiel selbst auf 1× zurück.
- **SCRAM** braucht zwei Tipper: der erste scharf, der zweite löst aus.
- **Kein automatischer Schutz.** Die Meldetafel warnt zuverlässig, greift aber nie selbst ein — die Schnellabschaltung ist allein Sache des Bedieners. Wer eine Meldung ignoriert, riskiert echten Brennstoffschaden.
- **Hochformat** zeigt die Panels als Reiter, breite Bildschirme als Raster mit
  dem Fließbild in der Mitte.
- **Sprache** DE/EN über den Startbildschirm.
- **Hinweise einklappen:** Die Überschrift des Laufzeit-Hinweisbereichs
  klappt den gesamten Inhalt samt Zielübersicht auf 40 px ein. Standardmäßig
  ist er offen; die Wahl bleibt unter `rs-guidance-open` als `true`/`false`
  in `localStorage` über Neuladen und Szenariowechsel erhalten. Bei gesperrtem
  Speicher gilt sie nur im Arbeitsspeicher bis zum Neuladen. Zielprüfung und
  Haltezeiten laufen geschlossen weiter. Die erneut geöffnete Einweisung
  hat keinen zusätzlichen äußeren Klappbereich.
- **Tastatur:** Leertaste und Enter aktivieren fokussierte native
  Schaltflächen und Klappüberschriften, ohne dabei das Tempo umzuschalten.

## Trends

Seit 0.1.22 teilen alle 14 Szenarien und das freie Spiel aller drei Reaktortypen
dieselbe Trendhistorie. Sie erfasst einmal je Simulationssekunde unabhängig
von Zeitraffer, sichtbarem Panel oder Rendering und hält maximal 28.800
Messpunkte der letzten acht Simulationsstunden vor.

Vier Hauptdiagramme zeigen Leistung in Prozent, Druck in bar, Füllstand in
Prozent sowie Speisewasser-/Dampfstrom in kg/s. Aufklappbar folgen Temperatur
in °C, Reaktivität in pcm, Xenon in Prozent und Kernstrom in kg/s. Alle teilen
dieselbe Zeitachse; wähle **10 Minuten**, **1 Stunde** oder **8 Stunden**.
Die Leistungskurven zeigen Wärmeleistung, elektrische Leistung und Bedarf
bezogen auf die jeweilige Nennleistung. Fehlende Messwerte werden nicht
überbrückt: Beim SWR unterbricht Gleichstromverlust die Füllstandskurve.

Die Ereignisliste unterscheidet Bedienaufträge von tatsächlichen
Zustandswechseln wie Schnellabschaltung, Rücksetzen/Wiederherstellung und
Alarm-/Störungsflanken. Zielstart, Rücksetzen der Haltezeit, Erreichen und
Verlust eines Ziels werden dort erfasst, wo Ziele implementiert sind:
in den drei DWR-Störungsschichten und im Anfahren-Tutorial. Andere Szenarien
erhalten dadurch keine neuen Ziele. Die Liste hält höchstens 600 Marker aus
den letzten acht Stunden vor und zeigt keine zukünftigen Ereignisse.

Ein Markerlisten-Knopf setzt einen weißen Cursor auf allen Diagrammen und
hält das Zeitfenster fest, **nicht die Simulation**. **Live** löscht die Auswahl
und folgt wieder der aktuellen Zeit. Hinweise kennzeichnen fehlende Historie
und gekürzte Markerlisten. Die Darstellung verdichtet Messpunkte je Pixel
unter Erhalt von Min/Max und Kurvenlücken, nicht die gespeicherten Daten.

## Spielstände

Speichern erhält alle noch vorgehaltenen Trendwerte und Marker. Die 15
Float32-Kanäle und Float64-Zeitwerte werden vollständig binär/Base64 abgelegt,
ohne Ausdünnung oder weiteren Präzisionsverlust gegenüber dem Live-Puffer.
Nach Fortsetzen läuft die Erfassung exakt ohne doppelte Messpunkte weiter.
Alte Spielstände ohne Trendblock oder mit ungültigem Trendblock starten mit
leerer, ausdrücklich als fehlend gekennzeichneter Historie; ein ansonsten
gültiger Anlagenzustand wird deshalb nicht abgelehnt. Trendhistorie ist kein
Replay und ändert weder Punkte noch Regeln für Bestenlisten.

Für `PUT /api/saves/<slot>` gilt ein Limit von **4 MiB = 4.194.304 Bytes**.
Andere Flask-Anfragen bleiben auf 256 KiB begrenzt, Einstellungen auf 8 KiB;
Waitress erlaubt transportseitig 4 MiB, ohne die engeren Anwendungsgrenzen
aufzuheben. Bei 60 Slots sind bis zu **240 MiB je Konto** allein für
Spielstände einzuplanen, zuzüglich Backups und sonstiger Daten.

Ein voller Trendblock umfasst 1.958.400 Rohdatenbytes beziehungsweise
2.611.200 Base64-Bytes, jeweils ohne JSON und übrigen Spielstand. Gemessene
synthetische Stress-Spielstände mit 28.800 Samples, 600 maximal großen
Markern und 600 Lernprotokolleinträgen: DWR 4.001.083, SWR 3.999.431,
RBMK 3.999.653 Bytes. Das sind Speicherprüfungen, keine achtstündigen
Physikläufe. Prüfumfang und offene Punkte: [Trend-Audit](audit/TRENDS-2026-09-14.md).

## Entwicklung

```bash
python3 dev_run.py          # http://127.0.0.1:17779, Daten in dev_data/
node --test "tests/*.mjs"   # Physik, Spielschicht, Determinismus
python -m pytest tests/     # Schnittstelle, Wertung, Struktur, Sprachdateien
```

Die gesamte Simulation läuft im Browser in reinen ES-Modulen — kein npm, kein
Bundler, kein Framework. Die Module unter `static/js/sim/` haben bewusst keinen
DOM-Bezug: dadurch sind sie unter `node --test` direkt importierbar und können
später ohne Umbau in einen Web Worker wandern.

Aufbau in Kürze:

```
app.py              Flask: Seite, /health, Sprache, versionierte Statics, API
static/js/sim/      Physik (Punktkinetik, Rückkopplungen, Xenon, Thermohydraulik)
static/js/plants/   je Reaktortyp ein Datenobjekt plus kleines Hook-Modul
static/js/game/     Szenarien, Störungen, Wertung
static/js/ui/       Instrumente, Trends, Fließbild, Meldetafel
```

Version und Build: die Datei `VERSION` ist die einzige Versionsquelle und
zugleich der Auslöser des GitHub-Workflows, der das Image nach GHCR baut.

## Lizenz

MIT — siehe [LICENSE.md](LICENSE.md).
