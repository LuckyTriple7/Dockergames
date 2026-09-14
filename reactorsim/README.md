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
einhalten sollst, geplante Störungen und eine Wertung am Ende. Gewertet werden
gelieferte Energie, Abweichung vom Bedarf, unquittierte Alarmsekunden,
Grenzwertüberschreitungen nach Schwere, Schnellabschaltungen und
Brennstoffschaden.

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
Auch Nichtstun kann beim Rohrleck den Zeitabschluss erreichen. Zeitabschluss und
Punkte beweisen keine richtige Behandlung; neue Diagnoseziele oder eine
Diagnosewertung sind nicht enthalten. Umfang, Balancing und Nachweise:
[Szenario-Audit](audit/SZENARIEN-2026-09-14.md).

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

Der Server rechnet den Punktestand aus den gemeldeten Kennzahlen **selbst** —
ein mitgeschicktes `score`-Feld wird nicht gelesen. Die Kennzahlen werden auf
Plausibilität geprüft (mehr Energie, als die Anlage in der Zeit liefern kann,
längere Schicht als das Szenario dauert, negative Abweichungen). Der Spielstand
selbst ist für den Server undurchsichtig: er speichert ihn und gibt ihn zurück,
ohne hineinzusehen — geprüft wird er beim Laden im Browser.

Ehrliche Einordnung: solange die Simulation im Browser läuft, sind Bestenlisten
nicht fälschungssicher. Die Prüfung verschiebt die Angriffsfläche von „eine
beliebige Zahl" auf „ein Satz physikalisch begrenzter Größen". Der saubere Weg
wäre Replay-Verifikation; der gesäte Zufall und die DOM-freien `sim/`-Module
halten diese Tür offen.

## Bedienung

- **Zeitraffer** 1× / 4× / 16× / 60×. Der Rechenschritt bleibt dabei konstant,
  der Zeitraffer verändert die Genauigkeit also nicht. Bei einer Schnell-
  abschaltung schaltet das Spiel selbst auf 1× zurück.
- **SCRAM** braucht zwei Tipper: der erste scharf, der zweite löst aus.
- **Kein automatischer Schutz.** Die Meldetafel warnt zuverlässig, greift aber nie selbst ein — die Schnellabschaltung ist allein Sache des Bedieners. Wer eine Meldung ignoriert, riskiert echten Brennstoffschaden.
- **Hochformat** zeigt die Panels als Reiter, breite Bildschirme als Raster mit
  dem Fließbild in der Mitte.
- **Sprache** DE/EN über den Startbildschirm.

## Entwicklung

```bash
python3 dev_run.py          # http://127.0.0.1:17779, Daten in dev_data/
node --test tests/          # Physik, Spielschicht, Determinismus
python3 -m pytest tests/    # Schnittstelle, Wertung, Struktur, Sprachdateien
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
