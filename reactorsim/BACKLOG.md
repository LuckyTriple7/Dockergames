# Backlog

Offene, bewusst zurückgestellte Punkte -- kein Anspruch auf Vollständigkeit,
nur was beim Arbeiten aufgefallen ist und noch nicht dran war.

## Erweiterungen

### Wiedergabe eines Laufs mit Bild

Die Nachrechnung (siehe CHANGELOG 0.0.76) hat die Bausteine schon gelegt:
`game/recorder.js` zeichnet jede Bedienhandlung mit Schrittzahl auf,
`game/replay.js` spielt sie ohne DOM durch dieselbe Engine noch einmal durch.
Was fehlt, ist nur noch die Bildausgabe obendrauf -- dieselbe Engine, derselbe
Ablauf, nur mit `ui/panels.js`/`ui/render.js` statt `captureKit()`, und einer
eigenen Wiedergabegeschwindigkeit statt Echtzeit. Passt zu dem, was das Spiel
zeigen will: nicht das Ende, sondern den Weg dorthin. Die Auswertung könnte an
jeder Meldung in der Zeitleiste anspringen, statt nur am Anfang zu starten.

Offene Fragen, bewusst noch nicht entschieden: eigene Seite oder Modal über
dem Leitstand; woher die Wiedergabe ihr Protokoll bekommt (eigener Endpunkt
`/api/highscores/<id>/log`? nur die eigenen Läufe, oder jeder Bestenlisten-
Eintrag?); ob während der Wiedergabe Ton laufen soll.

### Simulation in einen Web Worker

Würde Rechnung und Bildaufbau trennen: kein Ruckeln mehr bei 60×, und der
Zeitraffer könnte höher gehen. `templates/index.html` ist darauf schon
vorbereitet (`window.RS_I18N` statt `const`, siehe Kommentar dort).

Der Aufwand steckt nicht in der Engine, sondern in der Bedienung: `ui/panels.js`,
`ui/controls.js` und die `uiControls()`-Haken der drei Typdateien greifen heute
direkt auf `engine.state` und `engine.ctx` zu -- jeder Schieber, jeder
Auto/Hand-Schalter, jeder Pumpenknopf. Über eine Worker-Grenze braucht jeder
davon eine Nachricht. Das ist ein Umbau, keine Optimierung, und erst dann
sinnvoll, wenn Ruckeln tatsächlich auftritt.

### Nachlauf nach der Zerstörung für DWR und SWR

Seit 0.6.5 rechnet der RBMK einen Schritt weiter als bis `destroyed`: eine
Energiebilanz aus dem eigenen Zustand (Energie über Sättigung, verdampfbares
Inventar, Hubarbeit und Hubdruck des oberen Schilds) entscheidet, ob der
Deckel abhebt — siehe `engine.js: startAftermath` und `rbmk.js:
sp.aftermath`. Die Schnittstelle ist typunabhängig geschnitten, ein
Reaktortyp ohne `aftermath`-Block verhält sich wie vorher.

Für die anderen beiden fehlt nicht die Rechnung, sondern die Zielgröße:

- **SWR:** Der Sicherheitsbehälter ist bereits modelliert (`bwr.js`:
  `containment` mit `designLimit`, `contFailed`, plus Wasserstoff aus der
  Zirkon-Wasser-Reaktion und `event_h2_explosion`). Ein Nachlauf hätte hier
  also schon seine Schwelle und seinen zweiten Weg; zu klären wäre, wie er
  sich mit dem bestehenden Wasserstoffpfad verträgt, statt ihn zu doppeln.
- **DWR:** Kein Sicherheitsbehältermodell, also auch keine Schwelle. Ein
  ehrlicher Nachlauf bräuchte zuerst einen Druckaufbau im Behälter —
  das ist ein eigener Baustein, kein Zusatz zum vorhandenen.

Offen bleibt in beiden Fällen dasselbe wie beim RBMK: Zweitexplosion,
Brandverlauf und Freisetzung rechnet dieses Modell nicht.

### Vierter Reaktortyp

Die Schnittstelle aus `spec` und `hooks` trägt das ohne Änderung an der Engine
-- genau dafür ist sie so geschnitten. Der lehrreichste Kontrast zu den drei
vorhandenen wäre **CANDU**: Schwerwasser, positiver Dampfblasenkoeffizient wie
beim RBMK, aber mit ganz anderer Abschaltlogik, und Brennstoffwechsel im
laufenden Betrieb.

### Lauf-Export als CSV

Die gemeinsame Historie `ctx.trends` (`static/js/game/trendHistory.js`) hält
seit 0.1.22 maximal 28.800 Samples der letzten acht Simulationsstunden und
600 Marker vor, einschließlich Speicherung und exaktem Fortsetzen.
`static/js/ui/trend.js` stellt diese Daten nur dar. Ein CSV-Export der noch
vorhandenen Werte bleibt offen; fehlende Messwerte und gekürzte Historie
müssten dabei ausdrücklich erkennbar bleiben.

### Spielkomfort - erledigt in 0.1.23

Trendhistorie nach Fortsetzen und gemeinsame Ereignismarker sind in 0.1.22
global umgesetzt; der gesamte Laufzeit-Hinweisbereich ist mit gemerkter Wahl
einklappbar. Seit 0.1.23 sind auch der letzte erfolgreiche Auto-/Handspeicher-
zeitpunkt mit bleibender Fehleranzeige und der ausdrückliche Zeitsprung-Abbruch
umgesetzt. Sichere Speicherwarteschlangen und wiederholbare Speicher-/Szenario-
ladeabläufe ergänzen das Paket. Punkt 8 ist vollständig erfüllt; CSV-Export
und die übrigen Erweiterungen bleiben offen. Details:
[Trend-Audit 0.1.22](audit/TRENDS-2026-09-14.md) und
[Komfort-Audit 0.1.23](audit/KOMFORT-2026-09-14.md).

### Mehrbenutzerbetrieb

Umgesetzt: Admin-Konto (`REACTORSIM_USER`/`REACTORSIM_PASSWORD`, spielt
nicht) verwaltet Spielerkonten im Panel unter `/admin` -- anlegen (E-Mail als
Benutzername), sperren/entsperren, Passwort zurücksetzen, Anmelde- und
Spielprotokoll je Konto (Zeitpunkt, Absenderadresse, Reaktortyp/Szenario/
Dauer). Spielerkonten liegen in `/data/users.db` (SQLite) statt in der
Umgebung; `REACTORSIM_USERS` ist entfallen. Mehrere Spielerkonten spielen
gleichzeitig, eigene Spielstände je Konto (`persist.Store.account_key`).

**Seit 0.6.0 zusätzlich umgesetzt:**

- **Mailversand über die Dockge-Konfiguration** (`mailer.py`,
  `REACTORSIM_SMTP_*` plus `REACTORSIM_PUBLIC_URL`). Wie beim Admin-Konto
  steht das Postfachpasswort in der Umgebung, nicht im Panel -- das Panel
  zeigt die Einstellung nur an (ohne Passwort) und schickt eine Testmail.
  Unkonfiguriert bleibt alles wie vorher; Mailversand ist Zugabe, nicht
  Voraussetzung.
- **Willkommens-Mail** an ein neu angelegtes Konto, als Kreuzchen im
  Anlegen-Formular. Ein gescheiterter Versand lässt das Konto stehen und
  nennt den Grund im Panel.
- **Passwort-Reset Phase 2:** das zurückgesetzte Passwort geht automatisch an
  den Spieler, sofern ein Mailserver bereitsteht. Angezeigt wird es trotzdem
  weiterhin einmalig.
- **Passwort vergessen** (`/forgot`, `/reset`): Einmal-Link, zwei Stunden
  gültig, nur der SHA-256-Abdruck liegt in der Datenbank. Die Antwort ist
  immer dieselbe, ob es die Adresse gibt oder nicht; Versand asynchron, damit
  auch die Antwortzeit nichts verrät.
- **Vollständige Spielhistorie** (`/api/runs`, Kontoseite
  `/admin/users/<id>`): Jeder beendete Lauf wird gemeldet -- Szenario,
  Tutorial und freies Spiel, mit Ausgang (geschafft/gescheitert/abgebrochen/
  zerstört) und nachgetragenem Punktestand. Vorher entstand der einzige
  Eintrag als Nebenwirkung von "Eintragen" im Debrief, weshalb "Spielzeit
  gesamt" nur einen Bruchteil zeigte.

**Seit 0.6.1 zusätzlich umgesetzt -- damit ist der frühere offene Rest
abgearbeitet:**

- **Self-Service-Passwortwechsel im Spiel** (`/api/account/password`, Knopf
  „Konto" in der Fußzeile des Startbildschirms). Das alte Passwort muss mit --
  die Sitzung läuft 30 Tage, ohne diese Abfrage genügte ein kurz
  unbeaufsichtigter Browser. Der Wechsel wirft jedes andere angemeldete Gerät
  hinaus, die eigene Sitzung bekommt ein frisches Token als Cookie zurück.
- **Konten löschen** (`/admin/users/<id>/delete`), nur von der Kontoseite aus
  und nur nach Abtippen der E-Mail-Adresse. Mitgelöscht werden Spielhistorie,
  Anmeldeprotokoll, offene Reset-Vorgänge und sämtliche Spielstände als
  Dateien; die laufende Sitzung wird entwertet. Bestenlisten-Einträge bleiben:
  sie tragen einen frei gewählten Namen, keine Kontokennung.
- **Seitenblätterung** in beiden Ansichten (`?runs=N`, `?logins=N`). Jede
  Liste sagt jetzt auch, wie viele Einträge es insgesamt gibt.
- **Die Dauer misst der Server selbst.** `/api/runs/start` eröffnet beim
  Rundenstart eine Messung (`OpenRuns` in `app.py`), `/api/runs` schließt sie.
  Daraus fällt zweierlei ab: eine Spalte „Am Schirm" mit der tatsächlich
  verbrachten Zeit, die gar nicht aus der Anfrage stammt -- und eine
  Obergrenze für die gemeldete SIMULIERTE Zeit, denn schneller als 60× kann
  kein Browser rechnen. Bei einem fortgesetzten Lauf kommt auch der
  Startpunkt nicht mehr aus der Anfrage, sondern aus dem `t_sim` des
  gespeicherten Standes auf der eigenen Platte.

**Seit 0.6.3 sind die beiden letzten offenen Punkte umgesetzt:**

- **Der Xenon-Zeitsprung meldet sich beim Server an** (`/api/runs/skip`,
  `main.js fastForwardXenon()`). Vorher hob der Server den Deckel für *jedes*
  freie Spiel pauschal um 48 h an, ob gesprungen wurde oder nicht -- die
  60×-Grenze war dort wirkungslos. Jetzt zählt nur, was ein offener Lauf
  dieses Kontos angemeldet hat, und anmelden kann nur, was dieser Server
  selbst als freies Spiel führt: ein Szenario bekommt auf diesem Weg gar
  nichts (400 `no_open_run`). Der Client wartet die Antwort ab, bevor er den
  Lauf abmeldet, damit die Abmeldung die Anmeldung nicht überholt.
- **Die Messung überlebt einen Neustart des Containers.** Die offenen Läufe
  liegen in `/data/runs.db` (SQLite) neben den Konten, mit der Wanduhr ihres
  Beginns. Die Ausfallzeit des Servers zählt dabei **nicht** als Spielzeit:
  in derselben Datei steht eine Marke, die der laufende Betrieb alle 20
  Sekunden erneuert -- auch aus dem Healthcheck, der als einzige Anfrage
  selbst dann noch kommt, wenn niemand spielt. Beim Hochfahren ist die Lücke
  zwischen ihr und jetzt die Zeit, in der niemand spielen konnte, und sie
  wird von jedem übernommenen Lauf abgezogen.

Offen bzw. bewusst so:

- **Die angemeldete Sprungdauer ist eine Angabe des Clients.** Nachrechnen
  kann der Server sie nicht -- die Physik läuft im Browser. Er grenzt sie nur
  ein: freies Spiel, eigener offener Lauf, und über dem 24-h-Deckel ist
  ohnehin Schluss. Das ist weniger als eine Prüfung und deutlich mehr als die
  pauschalen 48 h vorher.
- **Ohne gemeldeten Beginn greift weiterhin nur der 24-h-Deckel** -- bei einem
  Client, der `/api/runs/start` nicht kennt (ein Tab, der vor dem Update
  geladen wurde). Zu so einem Lauf gibt es schlicht nichts zu messen; er steht
  mit leerer Spalte „Am Schirm" in der Historie, nicht mit einer geschätzten
  Zahl.
- **Die gemessene Ausfallzeit fällt um bis zu 20 Sekunden zu groß aus** (die
  Marke ist nur so frisch wie ihr letztes Schreiben). Lieber ein paar Sekunden
  zu wenig gutschreiben als eine fremde Minute zu viel.

### Chernobyl-Tutorial „Block 4 – Die Nacht des 26. April“

Umgesetzt: geführter RBMK-Nachbau der Nacht vom 26. April 1986 ab
Schichtübergabe bis AZ-5, seit 0.6.1 acht Schritte (`handover`, `dip`,
`recover`, `pumps`, `hold`, `test`, `window`, `az5`), eigene Klasse
`RbmkChernobylTutorial` (`game/chernobylTutorial.js`). AZ-5 führt aus dem
validierten Ausgangszustand (zweistufige Vorgeschichte
100%→50%→9h halten→7%) zusammen mit dem Kühlmittelauslauf zuverlässig zu
echter Brennstoffzerstörung, mit der bestehenden Physik, ohne
Kalibrierungsänderung.

Seit 0.5.9 ist die Übung ein **Vorführmodus**: Ab der Schichtübergabe fährt
das Drehbuch die Anlage selbst, gesperrt sind Stäbe, Leistungsregler, Pumpen
und AZ-5 (`tutorial.locked` → `ui/controls.js: setControlsLocked`). Grund: Der
Ablauf ließ sich nicht sauber nachspielen, es gab aber gar keine Sperre --
jeder Klick konnte ihn verschieben.

**0.6.1 hat die Übung von Grund auf ehrlicher gemacht.** Auslöser war der
Turbinenauslauf: Er war bis dahin ein Drehbuch, das den *Pumpen-Sollwert*
linear auf null fuhr. Beides war falsch -- es bewegte einen Schieber, den
niemand angefasst hatte, und historisch hingen nur **vier der acht**
Hauptumwälzpumpen am auslaufenden Generator. Jetzt ist die Drehzahl eine
echte Zustandsgröße (`s.tgSpeed`, `rbmk.js: sp.turbogen`): der Rotor bremst
gegen die Pumpenlast, und weil eine Kreiselpumpe Leistung mit der dritten
Potenz der Drehzahl zieht, folgt daraus `w(t) = w0/(1 + t/τ)` -- der
Rechenschritt dafür ist exakt, nicht genähert. Vier Pumpen bleiben am Netz,
der Kernstrom fällt also auf etwa die Hälfte statt auf null.

Das hat drei weitere Punkte mit umgeworfen, die vorher als unlösbar galten:

- **Das Wirkfenster ist breit geworden.** Neu vermessen
  ([`tests/tools/chernobyl_press_window.mjs`](tests/tools/chernobyl_press_window.mjs)):
  In den ersten zwölf Sekunden nach Auslaufbeginn übersteht der Kern AZ-5, ab
  etwa 15 s zerstört derselbe Knopf ihn, und das bis mindestens 105 s. Vorher
  waren es 8-21 s mit einem Überlebensstreifen dahinter -- eine Eigenschaft
  der alten Rampe auf null, nicht der Anlage.
- **Die historischen Zeiten treffen jetzt alle.** Weil 36 s im Fenster liegen,
  kann AZ-5 im dokumentierten Abstand zum Testbeginn drücken. Die Übung zeigt
  damit Schichtübernahme 00:27, Einbruch ab 00:28, Pumpen 01:07:00, Testbeginn
  01:23:04, AZ-5 01:23:40, Zerstörung 01:23:45 -- jede davon nachgemessen, nicht
  behauptet. Vorher war nur *eine* der beiden Testzeiten erreichbar, und die
  Pumpen zeigten 01:23:25 statt 01:07 (die Haltephase ist dafür in `recover`
  und `hold` geteilt, mit einem Schritt dazwischen, dessen Dauer auf die Uhr
  zielt statt fest zu stehen).
- **Die Leistung bleibt vor AZ-5 flach -- und das ist der historische
  Befund, nicht Ruhe.** Ohne Knopfdruck steht die Anzeige bei rund 7 %. Darunter
  passiert trotzdem alles: der Dampfblasenanteil steigt in den 36 Sekunden von
  5,9 auf 7,7 %, die Reaktivität wächst mit, und die schmale automatische
  Regelgruppe hält mit bis zu **−111 pcm** dagegen
  ([`tests/tools/chernobyl_pre_az5.mjs`](tests/tools/chernobyl_pre_az5.mjs)).
  Nimmt man ihr diese Autorität, zerstört sich dieselbe Anlage nach 20 s, ohne
  dass jemand AZ-5 berührt. Genau so beschreiben es die Aufzeichnungen der
  Nacht: Leistung rund 36 s nahezu konstant bei ~200 MWth, während der Kern
  längst geladen war. AZ-5 legt darauf weitere **600 pcm** aus den
  Graphitspitzen.

  Vorher trieb die Rampe auf null die Anlage schon ohne jeden Knopfdruck
  sichtbar auf 133 % -- das war unhistorisch, die reale Leistungsanzeige blieb
  flach. Das neue Modell ist also auch hier näher an der Nacht; die Aussage
  „AZ-5 ist die alleinige Ursache" aus der ersten Fassung von 0.6.1 war
  trotzdem falsch und ist in 0.6.2 richtiggestellt: **Auslöser ja, alleinige
  Ursache nein.** Ein Test hält das Gleichgewicht jetzt fest, damit die
  Formulierung nicht wieder abrutscht.

**Ebenfalls in 0.6.1 umgesetzt:**

- **Der Leistungseinbruch wird gefahren, nicht mehr erzählt.** Bis 0.6.0 stand
  hier, ein echter Einbruch reiße mehr Xenon auf, als sich je zurückholen
  lasse. Das galt für die damalige, ungetrennte Stabkurve und stimmt seit der
  Korrektur in `rbmk.js` nicht mehr: nachgemessen
  ([`tests/tools/chernobyl_dip.mjs`](tests/tools/chernobyl_dip.mjs)) kommt die
  Anlage aus Einbrüchen bis hinunter zu 0,05 % zuverlässig wieder auf 7,3 %,
  mit ORM ~76 und rho ~0 pcm -- praktisch auf den Zustand, den `prepare()`
  vorher fest hinterlegt hat. Xenon spielt dabei kaum eine Rolle, ein Einbruch
  von Minuten ist gegen die Jod-Halbwertszeit zu kurz. Der Schritt `dip` fährt
  die Regelung jetzt auf Hand, die Stäbe ein, hält, und lässt dieselbe Regelung
  die Leistung zurückholen. Den Rest der Erholung, die real bis kurz nach 01:00
  dauerte, übersprang die Uhr bis 0.6.3 — seit 0.6.4 wird auch er gefahren.
- **Zeitlupe.** `loop.js` konnte Faktoren unter 1 immer schon, es gab nur keine
  Bedienung dafür. Neu sind ¼×- und ½×-Knöpfe in der Statusleiste sowie `-`
  und `+`, die die ganze Leiter von ¼× bis 60× entlanggehen. Die Chernobyl-
  Übung fordert von sich aus ¼× an, vier Sekunden vor AZ-5
  (`tutorial.speedHint`) -- im Vorführmodus könnte der Spieler den Moment sonst
  nicht sehen, und die Stellteile sind gesperrt.

**Seit 0.6.4 zusätzlich umgesetzt — drei der vier bekannten Grenzen sind
abgearbeitet.** Nachweise: [Chernobyl-Audit 0.6.4](audit/CHERNOBYL-2026-09-21.md).

- **Die Rotorzeitkonstante bleibt gesetzt — aber nachweislich unkritisch.**
  Herleiten lässt sie sich nicht (τ = J·ω₀²/(2·P₀) bräuchte die Rotorträgheit
  von TG-8, die nirgends nachschlagbar ist). Gemessen wurde deshalb das
  Gegenteil einer Herleitung
  ([`tests/tools/chernobyl_tau_sweep.mjs`](tests/tools/chernobyl_tau_sweep.mjs)):
  Über τ = 8 bis 30 s — Faktor vier — fällt AZ-5 unverändert auf 01:23:40, der
  Kern ist fünf bis sechs Sekunden später zerstört, und die historischen 36 s
  liegen jedes Mal im Wirkfenster. Nur dessen unterer Rand wandert mit τ
  (10 s bei τ = 8 s, 25 s bei τ = 30 s). Empfindlicher ist die *Pumpenzahl*:
  drei bis fünf am auslaufenden Generator tragen den Mechanismus, bei sechs
  zerstört der geskriptete Lauf den Kern nicht mehr. Die historischen vier
  liegen mittig im tragenden Bereich.
- **Der Speisewasserschwall um 01:19 wird gefahren.** Neue Physik brauchte es
  dafür nicht — die Kette steckte in `rbmk.js` vollständig drin: mehr kaltes
  Speisewasser, höhere Unterkühlung (`_subcooling`), weniger Dampfblasen
  (`_void`), negative Reaktivität über den positiven Blasenkoeffizienten.
  Gefahren wird die Handlung (Speisewasserregler auf Hand, 15 % des
  Nennstroms, 30 s), alles Weitere macht die Anlage: Unterkühlung 1,2 → 2,6 K,
  Blasenanteil 5,3 → 1,9 %, Leistung −0,3 Prozentpunkte. Die zweite Hälfte des
  historischen Vorgangs — erst zu viel Wasser, dann zu wenig — fährt die
  Automatik von selbst, samt Blasen-Überschwinger auf das Doppelte.
  Nachgebildet ist der Vorgang, **nicht seine Dauer**: real lief der Schwall
  bis kurz vor den Versuch, so lange gehalten fährt er den zusammengefassten
  Trommelpegel dieses Modells in seinen Anschlag bei 1,00 m — und dann
  zerstört AZ-5 den Kern gar nicht mehr. Beim Auslaufbeginn steht die Anlage
  deshalb wieder dort, wo sie ohne den Schwall stünde.
- **Der Zeitmaßstab des Einbruchs ist nicht mehr gerafft.** Der Uhrensprung am
  Ende von `dip` ist ersatzlos weg: `recover` hält jetzt bis zur
  Pumpenzuschaltung um 01:07, genau wie `hold` bis zum Testbeginn hält. Damit
  ist die Uhr durchgehend die Betriebszeit plus festem Versatz. Die
  zusätzlichen 38 gerechneten Minuten kosten nichts an Genauigkeit — alle
  dokumentierten Zeiten treffen weiter, die Spitze liegt bei 294 statt 300 % —
  und bringen etwas: die Abschaltreserve sinkt über die Strecke von 81,7 auf
  72,2, weil das Xenon sich wirklich aufbaut. Damit die Übung nicht zur
  Stunde am Schirm wird, stellt sie den Zeitraffer selbst ein (60× durch die
  Haltephasen, 1× für die Pumpenzuschaltung, 4× für den Schwall, 1× für den
  Auslauf, ¼× um AZ-5).

**Seit 0.6.5: die Übung endet nicht mehr mit „Brennstoff zerstört".** Der
Nachlauf rechnet aus dem eigenen Zustand weiter (`engine.js:
startAftermath`): rund 20 GJ stehen im Brennstoff über der
Sättigungstemperatur, genug, um 13,8 der 24 t Kühlmittel im Kern schlagartig
zu verdampfen; der obere Schild — 2000 t auf 17 m — hebt schon bei 0,86 bar
Überdruck ab, seine Hubarbeit von 196 MJ ist knapp 1 % der freigesetzten
Energie. Zwei Sekunden nach dem Brennstoffversagen hebt er im Fließbild
sichtbar ab, Fahne und offener Schacht inklusive. Zugleich benennt der
Endbildschirm ausdrücklich, wo das Modell aufhört.

Offen/bekannte Einschränkungen:

- **Die Wucht bleibt hinter der Nacht zurück.** Die Exkursion erreicht hier
  rund 295 % der Nennleistung; Schätzungen der Untersuchungen nennen für die
  reale ein Vielfaches davon (Größenordnung hundertfache Nennleistung). Das
  ist keine fehlende Zeile Code, sondern die Kalibrierung des Kernmodells —
  dieselbe Baustelle wie die Stabkurve unten.
- **Nicht gerechnet und nicht behauptet:** die zweite Explosion (ihre Ursache
  ist bis heute umstritten, INSAG-7 lässt sie offen), der Graphitbrand (das
  Graphit steht im Modell beim Ende bei 309 °C, Zündung bräuchte ~700 °C) und
  die Freisetzung (es gibt kein Quellterm- oder Dosismodell).
- **`lift_m` und `conversion` sind gesetzt**, nicht hergeleitet: zehn Meter
  Hub als Größenordnung, 2 % Umsetzungsgrad als der in Versuchen genannte
  Bereich. Beide sind so gewählt, dass sie die Aussage eher schwächen als
  stärken — gebraucht würde rund 1 %.
- **Die Abschaltreserve zeigt weniger an als die dokumentierten 6-8
  Stabäquivalente** -- vor dem Test 0,0. Das ist, anders als hier bis 0.6.0
  vermutet, **keine Skalenfrage**. Nachgemessen
  ([`tests/tools/chernobyl_rod_sweep.mjs`](tests/tools/chernobyl_rod_sweep.mjs)):
  Bei der historischen Einfahrtiefe von 1,25 m -- also `h = tip.span = 0,179`,
  wo die Anzeige exakt 7,4 zeigt -- zerstört AZ-5 den Kern gar nicht mehr, die
  Spitze bleibt bei 40 %. Von allen geprüften Stellungen zwischen 0,02 und 0,22
  trägt nur 0,02 den Mechanismus, weil `sin(π·h/span)` bei `h = span` null ist
  und der früher greifende Absorber den Spitzeneffekt dazwischen auffrisst.
  Dieses Zwei-Bank-Modell braucht die Stäbe also weiter draußen, als sie
  historisch standen. Statt die Zahl zurechtzubiegen steht jetzt die
  Einfahrtiefe in Metern daneben, und der Schritttext sagt den Unterschied
  ausdrücklich. Eine echte Lösung bräuchte mehr Bänke oder eine axial
  aufgelöste Stabkurve -- ein Umbau am Kern des RBMK-Modells, nicht an dieser
  Übung.
- **Welche vier der acht Pumpen am auslaufenden Generator hängen, ist
  gesetzt** — nur ihre ANZAHL ist nachgemessen (siehe oben).
- **Die Dauer des Speisewasserschwalls ist eine Setzung** (30 s), begründet
  durch den Pegelanschlag des Modells, nicht durch die Aufzeichnungen.
- **Nicht nachgebildet:** blockierte Turbinenschnellabschaltung, ORM-Ausdruck
  um 01:22:30.

## Weitere Störszenarien

Stand 0.1.24: 15 Szenariodateien einschließlich Anfahren-Tutorial. Zwei
Einzelstörungen aus der Ideensammlung sind jetzt als eigene DWR-Schichten
umgesetzt, ergänzt um eine kombinierte Stufe. Details und Nachweise:
[historischer Szenario-Audit 0.1.20](audit/SZENARIEN-2026-09-14.md) und
[Ziel-Audit 0.1.21](audit/SZENARIOZIELE-2026-09-14.md). Die RBMK-Nach-AZ-5-Schicht
ergänzt seit 0.1.24 die aktive Versorgung nach der Abschaltung:
[RBMK-Audit 0.1.24](audit/RBMK-POST-AZ5-2026-09-14.md).

**Sicherheitsziele in 0.1.21 umgesetzt und 0.1.24 erweitert, weiterer Ausbau offen:**
Die drei DWR-Störungsschichten haben je zwei widerrufbare Zustandsziele mit
15/120 Sekunden Haltezeit und `incident_v1`-Wertung statt Produktionswertung.
Beide Ziele müssen am ursprünglichen Ende aktuell erfüllt sein. Speicherung
erhält Zielzeiten und Haltefenster; geladene Läufe bleiben ohne vollständiges
Replay lokal, die neuen Bestenlisten verlangen Server-Nachrechnung und sind
von alten Scores getrennt. Gemeinsame Trends und Ereignismarker sind seit
0.1.22 für alle Szenarien und freies Spiel aller drei Reaktortypen umgesetzt.
Die RBMK-Schicht ergänzt zwei Ziele mit 30/120 s Haltezeit und derselben
`incident_v1`-Wertung. Zielmarker betreffen aktuell diese vier Störungsschichten
und das Anfahren-Tutorial mit seinen eigenen fünf Lernzielen, nicht alle Szenarien.
Vollständige Übertragung der Ziele auf die übrigen Szenarien, weitergehende
Diagnoseziele, unvollständige Messinformationen und generische Messausfälle
bleiben offen; die genannten Komfortpunkte sind in 0.1.23 erledigt. Die bestehende
SWR-Füllstandslücke bei Gleichstromverlust ist kein generisches Sensormodell.
Die kalibrierten Spielziele ersetzen keine reale Störfallprozedur.

**Umgesetzt in 0.1.24, RBMK-Nach-AZ-5-Schicht:**
- `rbmk_post_az5`, Schwierigkeit 3, 30 Minuten, 0 MW Netzbedarf; echtes
  SCRAM bei t=0 mit Stabfahrt und erhaltener Brennstoff-/Graphit-/Nachwärme.
  Vier Pumpenausfälle bei 90 s, normale Speisung ab 180 s physisch auf 15 kg/s
  begrenzt, Hilfsspeisung ab 240 s verfügbar, aber nicht automatisch an.
- Dosierbare Hilfsspeisung bis 220 kg/s aus 160.000 kg Vorrat; tatsächliche
  Ströme und Restvorrat zählen. Übungsspezifische Bedienung und Diagnose trennen
  Auftrag, Kapazität und Wirkung. Inventarversorgung und stabile Wärmeabfuhr
  müssen bei 1800 s aktuell erfüllt sein; bloßes AZ-5 oder Abwarten genügt nicht.
- Aggregiertes Sättigungsmodell, beide Speisewege abstrahiert bei 165 °C;
  keine reale Prozedur, detaillierte Oxidation oder Sicherheitszertifizierung.
  Alte Szenario-JSONs bleiben unverändert. Das erfüllt weder sämtliche übrigen
  Szenarioziele noch offene Sensor-, Diagnose- oder Physikerweiterungen.

**Umgesetzt in 0.1.20, mit Modellgrenzen:**
- **DWR: Dampferzeuger-Rohrleck.** `pwr_sg_tube_leak`, Schwierigkeit 2,
  15 Minuten, konstantes Leck von 8 kg/s ohne Vorwarnung/automatischen Helfer.
  `sg_tube_leak` erhöht die Wassermasse des zusammengefassten Dampferzeugers
  und senkt den Druckhalterfüllstand. Keine vollständige Primärleckbilanz,
  keine druckabhängige Leckrate, keine einzelnen Dampferzeuger zur Diagnose
  „welcher DE?“, keine Einzelisolation oder Aktivitätsmessung. Die
  Speisewasserregelung kann den DE-Pegel stabil halten; RESA stoppt das Leck
  nicht. Seit 0.1.21 scheitert Nichtstun am Zielabschluss: erforderlich sind
  begrenzte Wärmeleistung und stabile Wärmeabfuhr. Punkte bestätigen nur diese
  Spielziele, keine korrekte reale Leckbehandlung; eine vollständige
  Diagnoseprüfung fehlt weiterhin.
- **DWR: Verlust der Speisewasserregelung.** `pwr_feedwater_loss`,
  Schwierigkeit 1, 15 Minuten, geführte Einzelstörung mit Vorwarnung und
  automatischer Hilfe gemäß Einstellungen. `feedwater_loss` setzt den Regler
  einmalig auf Hand/null; Automatik oder Handstellwert lassen sich jederzeit
  wieder ändern. Kein permanenter Pumpendefekt und keine Hilfsspeisung.
- **DWR: Kombinierte Störungen.** `pwr_combined_faults`, Schwierigkeit 3,
  18 Minuten, Turbinenschnellschluss bei 180 s und Speisewasserverlust bei
  240 s, ohne Vorwarnung/automatischen Helfer. Dieselbe unveränderte Physik.

**Weiter offen -- Ereignis existiert schon, nur noch nicht als eigenes
Szenario verpackt:**

- **DWR: Ausfall einer Hauptkühlmittelpumpe.** `rcp_trip` mit `loop`
  funktioniert für PWR bereits (`ctx.pumps[i].trip()`, vier Schleifen) --
  nur noch nie als alleiniger Szenario-Anlass benutzt.
- **SWR: Umwälzpumpen-Trip.** Derselbe `rcp_trip` faellt bei BWR auf
  `ctx.recircPump.trip()` zurück -- der Typ modelliert nur EINE
  zusammengefasste Umwälzpumpe, ein Teilausfall (nur eine von mehreren)
  ist damit nicht darstellbar, ein Komplettausfall schon.
- **RBMK: Klemmende Stabgruppe bei Leistungsanstieg.** `rod_stuck` waehrend
  einer Leistungsrampe (statt wie bisher im Volllastbetrieb) -- reine
  Szenario-Regie, keine neue Mechanik.
- **RBMK: Axiale Leistungsverzerrung.** `alarm_axial_tilt` existiert schon
  als Meldung; ob sich >0,35 zuverlaessig ueber ein gezieltes `rod_stuck`
  auf nur EINER Bank erreichen laesst (statt wie bisher stets beide
  Banken gemeinsam, siehe `rodBanksMoveTogether`), ist ungeprüft -- müsste
  am Modell ausprobiert werden, vermutlich ohne neuen Code.
- **RBMK: Überhitzter Graphit.** `alarm_graphite_hot` existiert; braucht
  vermutlich nur eine Szenario-Regie, die die Leistung lange genug hoch
  haelt (35 Minuten Zeitkonstante, siehe Kommentar in `rbmk.js`), keinen
  neuen Code.

**Kleine neue Bausteine -- bestehendes Muster leicht erweitert:**
- **SWR: Speisewasserregler außer Kontrolle.** `feedwater_loss` setzt
  `fwCtl` einmalig auf Hand mit `manual = 0` (ganz zu), sperrt aber keine
  spätere Bedienung. Ein anderer anfänglicher Stellwert wäre eine kleine
  Erweiterung; echtes „hängt bei 70 %“ müsste den Defekt zusätzlich dauerhaft
  gegen Bedienung durchsetzen.
- **RBMK: Trommelwasserstand außer Kontrolle.** Gleiches Muster, RBMK hat
  mit `ctx.fwCtl` dieselbe Reglerklasse wie DWR/SWR.

**Größerer Aufwand -- echte neue Mechanik noetig:**
- **DWR: Fehlerhafte Druckmessung.** Kein generischer Mechanismus für
  Messwertdrift vorhanden; die SWR-Füllstandsanzeige und ihr Trend kennen
  bereits Messausfall bei Gleichstromverlust. Druckmessfehler brauchen
  einen eigenen Drift-Zustand pro Messstelle und eine
  Stelle in `ui/panels.js`, die zwischen Anzeige- und Ist-Wert
  unterscheidet.
- **SWR: Schleichendes Vakuumversagen.** `p_cond` wird in `pwr.js`/`bwr.js`
  jeden Schritt frisch aus der Physik berechnet (Kühlwassertemperatur,
  Dampfmenge), nicht unabhaengig gesetzt -- eine Leckluft-Alterung braucht
  einen echten neuen Additionsterm in dieser Berechnung, keinen Event-Griff.
- **RBMK: Xenonfalle.** Ein Szenario, das schon MIT Xenonvergiftung
  startet, braucht eine Anfangsbedingung, die es heute nicht gibt --
  `createState()`/`createEngine()` kennen kein `opts.X`. Ergaenzung ist
  überschaubar (ein weiterer optionaler Anfangswert wie `burnup`), aber
  neu.
- **SWR: RESA versagt (ATWS).** Der groesste Brocken. `scram()` setzt heute
  bedingungslos `s.scram.active`, und die gemeinsame `stepRods()` in
  `sim/engine.js` fährt danach für ALLE Typen die Stäbe zwangsweise ein --
  ein "faehrt trotzdem nicht ein" braucht einen eigenen Zustand, der genau
  diese eine Stelle typspezifisch umgeht. Dazu kommt: ein SWR-ATWS wird in
  der Realität ueber Bor-Einspeisung (SLC) beherrscht, und dieses Spiel
  kennt loesliches Bor bisher nur beim DWR (Borsäure/Kachel
  Reaktorchemie) -- ohne einen Alternativweg waere das Szenario nicht zu
  gewinnen, nur zu verlieren. Erst dann sinnvoll, wenn beides zusammen
  gebaut wird.
