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

Für den **RBMK-1000 → Tutorial: RBMK-1000 selbst anfahren** gibt es ebenfalls
fünf Schritte: heißen, unterkritischen Zustand prüfen, acht Hauptumwälzpumpen
hochfahren, mit Dampfentnahme etwa 30 % Neutronenleistung aufbauen, rund
300 MWe einregeln und stabil halten. Die Hinweise berücksichtigen Trommeldruck
und -füllstand, positive Dampfblasen-Rückkopplung sowie die Abschaltreserve ORM.
Die Leistungsautomatik hält den beim Einschalten erreichten Wert; eine
Netzanforderung fährt den RBMK nicht automatisch hoch. Beide Tutorials nutzen
die normale Anlagenphysik und beginnen in einem vorbereiteten heißen Zustand,
nicht mit einem thermischen Kaltstart.

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
Brennstoffschaden. Vier Störungsschichten verwenden stattdessen die unten
beschriebene Sicherheitswertung: drei DWR-Schichten seit 0.1.21 und die
RBMK-Nach-AZ-5-Schicht seit 0.1.24. Die Tutorials bleiben ungewertet.

Alle 16 Szenariodateien, einschließlich Tutorials (Dauer in Simulationszeit):

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
| Tutorial: RBMK-1000 selbst anfahren | RBMK | 1, Tutorial | max. 60 min |
| Ausfall einer Umwälzpumpengruppe | RBMK | 2 | 60 min |
| Nachtschicht | RBMK | 3 | 180 min |
| Wiederanlauf aus heissem Stillstand | RBMK | 3 | 150 min |
| AZ-5 war erst der Anfang | RBMK | 3, anspruchsvoll | 30 min |

Die Auswahl ist je Reaktortyp nach Schwierigkeit sortiert, das Tutorial steht
zuerst. Die drei DWR-Störungsschichten zeigen ihr Stufenprofil auf der Karte:
**geführt** mit konkreten Hinweisen, Ereignisvorwarnungen und erlaubter
automatischer Hilfe gemäß Einstellungen; **selbständig** mit einer Einzelstörung;
**anspruchsvoll** mit kombinierten Störungen. Die beiden höheren Profile haben
keine Ereignisvorwarnungen und keine automatische Behebung. Hinweise stehen in
Einweisung und Spiel, die Einweisung lässt sich erneut öffnen. Alarmtexte und
Glossar bleiben verfügbar; alle neuen Texte gibt es auf Deutsch und Englisch.
Die globale Helfereinstellung wird nicht verändert. Bestehende Szenarien ohne
`guidance` behalten ihr bisheriges Verhalten, unabhängig von ihrer Schwierigkeit.

Beim neuen Start und beim Fortsetzen zeigt die Auswahl den Ladevorgang sowie
Fehler mit Wiederholungsmöglichkeit. Eine Wiederholung bleibt an das gewählte
Szenario, den Reaktortyp und gegebenenfalls den Speicherplatz gebunden.
Fehlende Szenario-Metadaten werden erneut abgerufen; unpassende oder ungültige
Definitionen starten nicht stillschweigend freies Spiel. Ein Auswahlwechsel,
Zurück oder Menü verwirft verspätete Ergebnisse, auch beim anschließenden Laden
des Spielstands. Ein unpassender Spielstand erhält eine allgemeine Ladefehlermeldung.

Für diese drei DWR-Schichten bleibt die Physik unverändert. Speisewasserverlust
bedeutet hier nur Regler auf Hand/null: Automatik und Handstellwert bleiben bedienbar, ohne permanenten
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

**RBMK: AZ-5 war erst der Anfang** (`rbmk_post_az5`) startet mit echtem SCRAM
bei t=0 und noch fahrenden Stäben, nicht mit einem kalten oder wärmefreien Kern.
Nachwärme, heißer Brennstoff und Graphit bleiben erhalten; der Netzbedarf ist
0 MW. Vier Hauptumwälzpumpen fallen bei 90 s aus, die normale Speisung wird
bei 180 s physisch auf 15 kg/s begrenzt. Ab 240 s ist Hilfsspeisung verfügbar,
aber erst von dir einzuschalten und zu dosieren, ohne Vorwarnung/Auto-Helfer.
Maximal 220 kg/s aus 160.000 kg Vorrat speisen in die bestehende Bilanz ein.
Beide Wege verwenden im Spiel abstrahiert 165 °C warmes Wasser; dies ist
keine reale Anlage oder Störfallprozedur. Reglerauftrag umgeht keine Kapazität,
Helfer oder Replay können ausgefallene Pumpen auch nicht kurz neu starten.

Die zusätzliche Bedienung erscheint nur in dieser Übung. Sekundär- und
Sicherheitspanel zeigen angeforderten und tatsächlichen Durchfluss, Grenze,
Verfügbarkeit, Vorrat und Restlaufzeit, tatsächliche Trommelmasse, Gesamtbilanz,
Kühlmittel-/Graphitwärmestrom in MW und Graphittemperatur. Mit sinkender Wärme
muss die Speisung dosiert werden; AZ-5 allein ersetzt keine Wärmeabfuhr.
Es gibt keine vorgeschriebene „magische“ Bedienfolge.

Genau zwei RBMK-Ziele prüfen nach allen drei Ereignissen und dem nächsten
Physikschritt die Inventarversorgung für 30 s und stabile Wärmeabfuhr für 120 s.
Erforderlich sind unter anderem wirksame Abschaltung, Kernumlauf, 144 bis 176 t
Trommelwasser, 35 bis 70 % Pegel und begrenzte Temperaturen/Druck. Stabilität
verlangt passende reale Speise-/Dampfströme, höchstens zwei Prozentpunkte
Pegelspanne, höchstens 1 K Erwärmung von mittlerem Kühlmittel und Graphit sowie
mindestens 10.000 kg oder den Bedarf für 300 s beim aktuellen Hilfsstrom als
Reserve, je nachdem, was größer ist. Haltezeiten werden bei Verletzung zurückgesetzt, erfüllte
Ziele widerrufen; der erste Erfolg bleibt nur Historie. Beide Ziele müssen
bei genau 1800 s aktuell erfüllt sein, sonst scheitert die Schicht. Kein
versteckter Fehlertimer; Brennstoffschaden bleibt ein früher Abbruchgrund.
Grenzwerte, gemessene Bedienbeispiele und Modellgrenzen:
[RBMK-Audit](audit/RBMK-POST-AZ5-2026-09-14.md).

Für alle vier `incident_v1`-Schichten gilt dieselbe Wertung:
Je aktuell erfülltem Ziel gibt es 1000 Punkte; erfolgreicher Abschluss bringt
zusätzlich 1000 plus 250 je Schwierigkeitsstufe. Energie, Netzabweichung,
RESA und Grenzwertdauer tragen jeweils null Punkte bei. Unquittierte Alarme
kosten weiterhin bis zu 100 Punkte; Katastrophenabzüge und Abbruchregeln
bleiben unverändert. Zielübersicht, Haltezeiten, erster Erfolg als Verlauf
und aufklappbare Kriterien stehen in Einweisung, Spiel und Auswertung.
Erneut geöffnete Einweisungen zeigen den aktuellen Zielstand.

Speichern erhält den Zielfortschritt; alte Spielstände ohne gültigen Zielblock
beginnen die Haltezeiten neu. Geladene Läufe werden nur lokal ausgewertet:
Ohne vollständiges Replay ab Schichtbeginn ist für diese vier Szenarien kein
Bestenlisteneintrag möglich. Alte Betriebswertungen bleiben gespeichert und
werden nicht mit den neuen Sicherheitswertungen vermischt. Grenzwerte,
Balancing und Nachweise für die DWR-Ziele: [Ziel-Audit](audit/SZENARIOZIELE-2026-09-14.md).
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
Für die vier `incident_v1`-Szenarien ist dieses kanonische Server-Replay Pflicht.
Aufgezeichnete Helfereingriffe werden auf bekannte Aktionen und die Erlaubnis laut `guidance`
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
  abschaltung schaltet das Spiel außerhalb eines aktiven Xenon-Zeitsprungs
  selbst auf 1× zurück.
- **SCRAM** braucht zwei Tipper: der erste scharf, der zweite löst aus.
- **Xenon-Zeitsprung:** Nur im laufenden freien Spiel nach SCRAM bei `X > 1`.
  **Abbrechen**, Pause, die globale Leertasten-Pausenfunktion oder ausgelöstes
  SCRAM beenden den Sprung; der erreichte Anlagenzustand bleibt erhalten und
  pausiert. Während des Sprungs sind positive Tempowechsel gesperrt.
  Es laufen echte Physikschritte, kein direkter Zustandswechsel. Nur das Ziel
  `X <= 1` führt zu Erfolg, Log-/Trendmarker und Weiterlauf bei 1×.
  Das Limit von 48 Simulationsstunden ist kein Erfolg; Abbruch, Fehler oder
  Zerstörung führen ebenfalls nicht zum automatischen Weiterlauf.
- **Kein automatischer Schutz.** Die Meldetafel warnt zuverlässig, löst aber
  selbst keine Schnellabschaltung aus. Diese bedienst du; in der RBMK-Nach-AZ-5-
  Übung gehört sie bereits zur Startvorbereitung. Wer eine Meldung ignoriert,
  riskiert Brennstoffschaden im Spiel.
- **Hochformat** zeigt die Panels als Reiter, breite Bildschirme als Raster mit
  dem Fließbild in der Mitte. Die Meldetafel-/Loggruppe behält mobil 180 px
  Mindesthöhe, damit Log-Scrollen per Touch und Alarmhilfe erreichbar bleiben.
- **Sprache** DE/EN über den Startbildschirm.
- **Einweisung erneut ansehen:** Kein eigener Laufzeit-Hinweisbereich mehr --
  Ziele, Bedienhinweise und Kriterien der Übung ruft der Knopf mit dem
  Klemmbrett-Symbol (`#rs-briefing-btn`) jederzeit wieder als Einweisung auf.
- **Tastatur:** Leertaste und Enter aktivieren fokussierte native
  Schaltflächen und Klappüberschriften, ohne dabei das Tempo umzuschalten.

## Trends

Die seit 0.1.22 gemeinsame Trendhistorie gilt aktuell für alle 15 Szenarien
und das freie Spiel aller drei Reaktortypen. Sie erfasst einmal je Simulationssekunde
unabhängig von Zeitraffer, sichtbarem Panel oder Rendering und hält maximal 28.800
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
in vier Störungsschichten (drei DWR, eine RBMK) mit je zwei Sicherheitszielen
und im Anfahren-Tutorial mit eigenen fünf Lernzielen. Andere Szenarien
erhalten dadurch keine neuen Ziele. Die Liste hält höchstens 600 Marker aus
den letzten acht Stunden vor und zeigt keine zukünftigen Ereignisse.

Ein Markerlisten-Knopf setzt einen weißen Cursor auf allen Diagrammen und
hält das Zeitfenster fest, **nicht die Simulation**. **Live** löscht die Auswahl
und folgt wieder der aktuellen Zeit. Hinweise kennzeichnen fehlende Historie
und gekürzte Markerlisten. Die Darstellung verdichtet Messpunkte je Pixel
unter Erhalt von Min/Max und Kurvenlücken, nicht die gespeicherten Daten.

## Spielstände

Automatische Sicherungen laufen alle 60 echten Sekunden in eigenen Slots je
Reaktortyp und Szenario beziehungsweise freiem Spiel. **Speichern** öffnet zehn
Handspeicherplätze je Reaktortyp; ein Klick schreibt in den gewählten Platz.
Scheitert das Laden der Platzliste, erscheinen Fehler und Wiederholen statt
scheinbar freier Plätze. Ein Schreibfehler lässt den Dialog für einen erneuten
Versuch offen; geschlossene oder veraltete Dialoge schreiben nicht in eine neue Runde.

Der globale Speicherstatus unter den Bedienelementen zeigt den letzten
erfolgreichen Auto-/Handspeicherzeitpunkt. Ein Fehler bleibt auch während eines
neuen Versuchs neben dem bisherigen Erfolg sichtbar. Nach einem neuen Schreiben
gilt die Bestätigungszeit im Browser (`Date.now()`); beim Fortsetzen stammt die
Zeit aus den echten Server-Metadaten (`saved_at`). Laden zählt nicht als neue
Speicherung. Der Status wird je Runde zurückgesetzt; außer geladenen Metadaten
gibt es keine rundenübergreifend gespeicherte Statushistorie.

Jeder neue Speicherauftrag hält den Zustand bereits beim Auslösen als
abgetrennten Snapshot fest. Schreibaufträge desselben Slots laufen auch über
Rundenwechsel hinweg in Reihenfolge, damit alte Antworten keinen neueren Stand
überschreiben. Die Warteschlange ist auf 16 Aufträge je Slot begrenzt;
ausstehende Autosicherungen desselben Kontexts werden zusammengefasst.
Fehler blockieren spätere Aufträge nicht; alte Antworten verändern nicht die
Statusanzeige der aktuellen Runde. Details: [Komfort-Audit](audit/KOMFORT-2026-09-14.md).

Speichern erhält alle noch vorgehaltenen Trendwerte und Marker. Die 15
Float32-Kanäle und Float64-Zeitwerte werden vollständig binär/Base64 abgelegt,
ohne Ausdünnung oder weiteren Präzisionsverlust gegenüber dem Live-Puffer.
Nach Fortsetzen läuft die Erfassung exakt ohne doppelte Messpunkte weiter.
Alte Spielstände ohne Trendblock oder mit ungültigem Trendblock starten mit
leerer, ausdrücklich als fehlend gekennzeichneter Historie; ein ansonsten
gültiger Anlagenzustand wird deshalb nicht abgelehnt. Trendhistorie ist kein
Replay und ändert weder Punkte noch Regeln für Bestenlisten.

Seit 0.1.24 werden neue RBMK-Versorgungsfelder streng validiert; alte Stände
erhalten neutrale Vorgaben. Äußeres Speicherformat v1, Trendformat v1 mit
15 Kanälen und Wertungsversion bleiben unverändert. `pendingLog: {engine, trips}`
sichert je bis zu 120 noch nicht dargestellte Ereignisse. Fortsetzen ersetzt
die frischen Start-/Vorbereitungsmeldungen durch diese echten Warteschlangen;
Altstände ohne Feld starten mit leeren Queues. Das verhindert doppelte
Start-/SCRAM-Meldungen und erhält ausstehende Meldungen genau einmal, auch
bei DWR und SWR, ohne Vorräte aufzufüllen.

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
