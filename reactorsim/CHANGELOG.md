# Changelog

## 0.6.0

- ✨ **Das Admin-Panel zeigt jetzt die vollständige Spielhistorie — vorher
  einen Bruchteil davon.** Ein Lauf landete bisher nur dann im Panel, wenn
  der Spieler am Ende ausdrücklich auf „Eintragen" drückte: Die einzige
  Aufzeichnung entstand als Nebenwirkung der Bestenlisten-Einsendung. Alles
  andere fehlte vollständig — Tutorials (die gar nicht gewertet werden),
  freies Spiel, gescheiterte Läufe, zerstörte Anlagen, jeder Abbruch —, und
  die Spalte „Spielzeit gesamt" zählte entsprechend nur einen Bruchteil der
  wirklich gespielten Zeit. Neu meldet der Client jeden beendeten Lauf über
  `/api/runs` (`main.js: reportRun()`), unabhängig von jeder Wertung: mit
  Art (Szenario/Tutorial/freies Spiel), Dauer und Ausgang (geschafft,
  gescheitert, abgebrochen, Anlage zerstört). Ein später eingereichter
  Punktestand wird an denselben Eintrag **nachgetragen**
  (`UserStore.attach_score()`) statt einen zweiten anzulegen — sonst stünde
  jeder gewertete Lauf doppelt da und die Spielzeit wäre doppelt gezählt.
  Art und Tutorialeigenschaft kommen aus dem Szenariokatalog, nicht aus der
  Anfrage (derselbe Grundsatz wie beim Schwierigkeitsgrad); die Dauer ist
  Client-Angabe und bei 24 h gedeckelt, Läufe unter 30 simulierten Sekunden
  werden gar nicht erst aufgezeichnet. Bestehende Einträge bleiben erhalten
  und stehen mit „unbekannt" in den neuen Spalten — für sie *ist* die Art
  unbekannt, eine erfundene Vorgabe wäre eine falsche Angabe.

- ✨ **Neue Kontoseite `/admin/users/<id>`: alles zu einem Spieler an einem
  Ort.** Die Übersicht zeigt je Konto eine Zeile und daneben die letzten 50
  Ereignisse aller Spieler gemischt — die Frage „was hat dieser eine
  eigentlich gespielt?" ließ sich damit nicht beantworten. Die Kontoseite
  zeigt Kennzahlen (Läufe, Spielzeit, davon geschafft, bester Wert,
  Anmeldungen), eine Auswertung je Szenario und die vollständigen Listen
  aller Läufe und Anmeldungen dieses Kontos (jeweils die letzten 200, was
  darüber liegt, ist ausdrücklich als gekürzt gekennzeichnet). Erreichbar
  über die E-Mail-Adresse in jeder Tabelle des Panels.

- ✨ **Mailversand — eingerichtet über Dockge, nicht im Panel.** Neues Modul
  `mailer.py` mit `REACTORSIM_SMTP_HOST/_PORT/_SECURITY/_USER/_PASSWORD/
  _FROM/_TIMEOUT` und `REACTORSIM_PUBLIC_URL`. Die Zugangsdaten des Postfachs
  stehen damit dort, wo schon das Admin-Passwort steht; das Panel *zeigt* die
  Einstellung nur (ohne Passwort, nur „gesetzt"/„nicht gesetzt") und kann
  eine Testmail schicken. Ein Postfachpasswort über ein Browserformular
  entgegenzunehmen hieße, ein weiteres Geheimnis zu speichern, zu
  verschlüsseln und wieder anzuzeigen — dafür gibt es keinen Grund, solange
  Dockge daneben liegt. Verschickt wird reiner Text, kein HTML, kein
  nachgeladenes Bild, kein Zählpixel (dieselbe Linie wie bei der Seite
  selbst). **Ohne gesetzten Mailserver ändert sich nichts**: das Panel zeigt
  erzeugte Passwörter weiterhin einmalig an, und „Passwort vergessen" ist
  gar nicht erst sichtbar. Fehler nennen den Grund im Panel (Anmeldung
  abgelehnt, nicht erreichbar, Empfänger abgelehnt) statt nur im Protokoll.

- ✨ **Willkommens-Mail an ein neu angelegtes Spielerkonto.** Ein Kreuzchen
  im Anlegen-Formular, kein Automatismus — wer zwanzig Konten für einen Kurs
  anlegt und die Zugänge ausdruckt, lässt es weg. Die Mail enthält Adresse,
  Benutzername und Passwort; dasselbe Passwort steht **zusätzlich weiterhin
  einmalig im Panel**, damit ein fehlgeschlagener Versand kein unbrauchbares
  Konto hinterlässt. Auch „Passwort zurücksetzen" schickt das neue Passwort
  jetzt direkt an den Spieler, sofern ein Mailserver bereitsteht — das war
  als „Passwort-Reset Phase 2" seit Einführung der Konten offen.

- ✨ **„Passwort vergessen" auf der Anmeldeseite.** `/forgot` nimmt die
  Adresse entgegen, `/reset?token=…` setzt das neue Passwort. Der Link gilt
  **zwei Stunden und genau einmal**; in der Datenbank liegt nur sein
  SHA-256-Abdruck, nie der Link selbst — wer `users.db` liest, kann daraus
  keinen bauen. Ein neuer Link entwertet alle vorherigen, und ein gesetztes
  Passwort beendet jede noch laufende Sitzung des Kontos. Die Antwort auf
  `/forgot` ist **immer dieselbe**, ob es die Adresse gibt, ob das Konto
  gesperrt ist oder ob die Mail ankam; der Versand läuft deshalb
  asynchron, damit auch die Antwortzeit nichts verrät. Grenzen: fünf
  Anfragen je Stunde und Absenderadresse, drei je E-Mail-Adresse, zwanzig
  Einlöseversuche je Stunde. CSRF-Token sind je Formular getrennt — ein
  Token des Anmeldeformulars gilt hier nicht.

- 🔧 **Anmeldung, „Passwort vergessen" und „Neues Passwort" teilen sich jetzt
  eine Vorlage** (`templates/auth_base.html`). Dieselbe Regelmenge dreimal
  nebeneinander wäre beim nächsten Farbwechsel auseinandergelaufen. Wie
  vorher lädt keine dieser Seiten eine Datei nach, die hinter der Anmeldung
  liegt.

- ✅ 34 neue Tests: `tests/test_mail.py` (22, mit einer smtplib-Attrappe —
  STARTTLS-Reihenfolge, Anmeldung, Fehlergründe, Willkommens-Mail, Reset-Mail,
  Testmail, der gesamte Passwort-vergessen-Ablauf samt Einmaligkeit des Links
  und gleicher Antwort für unbekannte und gesperrte Konten), sieben in
  `tests/test_admin.py` (Historie für Tutorial/freies Spiel/Abbruch/
  Zerstörung, Art aus dem Katalog statt aus der Anfrage, Nachtragen statt
  Verdoppeln, Kontoseite) und vier in `tests/test-lifecycle.mjs`
  (`reportRun()` meldet genau einmal, auch im freien Spiel und bei zerstörtem
  Kern, und ein kurzes Hineinschauen gar nicht).

## 0.5.11

- 🐛 **Admin-Panel zeigte bei jedem Besucher dieselbe Docker-Gateway-Adresse
  statt der echten IP.** Waitress entfernt `X-Forwarded-*`-Header seit
  Version 0.8.10 standardmäßig, bevor die App sie sieht
  (`clear_untrusted_proxy_headers=True` per Default) -- hinter Reverse
  Proxy (NPMPlus) und optional Cloudflare Tunnel kam dadurch nur noch die
  Adresse des letzten Zwischenglieds an. `clear_untrusted_proxy_headers=False`
  lässt die Header wieder durch. Da sie dadurch erneut fälschbar sind (wer
  den Port direkt erreicht, kann sie setzen), vertraut die eigene Auswertung
  (`_client_ip()`) nicht mehr blind einer festen Kettenposition wie zuvor
  ProxyFix mit `x_for=1`, sondern nimmt die erste öffentliche Adresse aus
  `X-Forwarded-For`/`CF-Connecting-IP`. Ändert nichts daran, dass der
  Punktestand ohnehin serverseitig gerechnet wird.

## 0.5.10

- ✨ **Neue Anzeige "Uhrzeit": das Chernobyl-Tutorial zeigt jetzt die Uhr
  jener Nacht.** Bisher gab es nur die Betriebszeit, die stur ab null läuft
  -- AZ-5 fiel dort auf 00:19:43, während der Text von 01:23:40 sprach
  (Nutzerrückfrage). Die neue Anzeige läuft mit der Betriebszeit mit und
  macht genau einen Sprung: am Ende des Schritts "Historische Einordnung",
  also dort, wo die Übung ohnehin offenlegt, dass sie den Leistungseinbruch
  um 00:28 samt Erholung nicht nachstellt. Danach stimmt sie auf die
  Sekunde -- Haltephase ab 01:04:08, AZ-5 um 01:23:40, Zerstörung um
  01:23:45. Sie steht neben der Schrittzeile, im Schritt-Fenster und in der
  Schrittliste des Debriefs, und ist zusätzlich als Statuskachel wählbar
  (in anderen Szenarien bleibt sie auf "—"). Einzige offen benannte
  Abweichung: Die beiden zusätzlichen Pumpen liefen historisch ab 01:07,
  also mitten in der Haltephase -- die Übung geht ihre Schritte der Reihe
  nach durch und schaltet sie erst an deren Ende zu, die Uhr zeigt dort
  deshalb 01:23. Ein Test misst die drei historischen Marken nach.

## 0.5.9

- ✨ **Chernobyl-Tutorial läuft jetzt als Vorführung ab -- und AZ-5 drückt
  endlich im richtigen Fenster.** Der Ablauf ließ sich nicht sauber
  nachspielen: Es gab keine einzige Sperre, jeder Klick auf irgendein
  Stellteil konnte den nachgestellten Ablauf verschieben, und die Übung war
  ohnehin schon zu weiten Teilen automatisch (5 von 7 Schritten). Ab der
  Schichtübergabe fährt das Drehbuch die Anlage jetzt komplett selbst: Es
  schaltet die beiden zusätzlichen Hauptumwälzpumpen zu (der Zeitpunkt ist
  nachgemessen unkritisch -- zwischen sofort und 5 Minuten Verzögerung
  ändert sich der Zustand beim Auslaufbeginn praktisch nicht) und löst AZ-5
  aus. Gesperrt sind dabei nur die kritischen Stellteile: Stäbe,
  Leistungsregler, Pumpen und AZ-5 (Knopf wie Strg+Z) -- Trends, Panels,
  Quittieren und Speichern bleiben bedienbar. Die gesperrten Kacheln werden
  sichtbar abgeblendet, wie schon bei der Pause.
- 🐛 **Der Knopfdruck war gar nicht die Ursache der Zerstörung -- die
  gezeigten Zeitfenster stimmten nicht.** AZ-5 löste bei Sekunde 41 aus, im
  vermeintlich "zweiten Zerstörungsfenster" (39-43s). Nachgemessen war der
  Kern zu diesem Zeitpunkt aber ohnehin am Durchgehen: Der positive
  Dampfblasenkoeffizient treibt die Leistung ab ~33s von selbst hoch. Das
  Tutorial verkaufte damit eine Selbstzerstörung als Folge des Knopfdrucks
  -- und der Hinweistext nannte dem Spieler dazu Fenstergrenzen, die bei
  einer Neumessung über den echten `prepare()`-Pfad nicht reproduzierbar
  waren. AZ-5 fällt jetzt auf Sekunde 14,5, mitten in das nachgemessene
  Fenster (8-21s), in dem der Knopf tatsächlich die Ursache ist.
- ✨ **Neuer Schlussbefund im Debrief.** Der zweite Messbefund geht dabei
  nicht verloren: Das Ergebnis benennt jetzt ausdrücklich, dass der Ausbruch
  schon vor dem Knopfdruck läuft (ohne AZ-5: 133 % bei 38s, gehalten allein
  vom schmalen AR-Trimm mit seinen 500 pcm -- ohne diese Autorität versagt
  der Brennstoff schon bei 19s). Beide Zahlen hängen an eigenen Tests, damit
  der Text nicht stillschweigend veraltet.

## 0.5.8

- ✨ **Chernobyl-Tutorial: AZ-5 löst jetzt automatisch aus.** Das
  Zerstörungsfenster ist nur 4 Sekunden breit (39-43s seit Auslaufbeginn) --
  der AZ-5-Knopf braucht aber zwei Klicks (erst scharf machen, dann
  bestätigen, Unfallschutz gegen Versehen-Drücken). Die Reaktionszeit
  zwischen beiden Klicks fraß das Fenster in der Praxis zuverlässig auf
  (Nutzerrückmeldung: zwei Versuche hintereinander 1,7-2,6s zu spät). AZ-5
  löst in diesem Tutorial jetzt bei Sekunde 41 (Fenstermitte) von selbst
  aus -- verifiziert per Testlauf ganz ohne jeden Klick, Kern wird
  zuverlässig zerstört. Nur diese eine Übung ist betroffen, der Knopf
  bleibt überall sonst unverändert zweistufig.

## 0.5.7

- 🐛 **Chernobyl-Tutorial Schritt 6/7: "0/0.2 s" sah nach "gleich fertig"
  aus, obwohl noch bis zu ~35 s zu warten waren.** HOLD[5]=0.2s ist ein
  interner Entprellwert für den schnellen Übergang zu 'az5', keine echte
  Wartezeit -- die Kopfzeile zeigte ihn trotzdem als Countdown an
  (Nutzerrückmeldung). Zusätzlich sah "Schritt 7" identisch aus, egal ob es
  erschien WEIL man im richtigen Zeitfenster ist, oder WEIL man (zu
  früh/spät) schon gedrückt hat -- beides führt über denselben Übergang.
  Schritt 6 und 7 zeigen jetzt in der Kopfzeile direkt den Live-Hinweis
  ("warten" / "JETZT AZ-5 drücken!" / "Fenster vorbei") statt einer
  Haltezeit-Zahl, ohne das Popup öffnen zu müssen.

## 0.5.6

- 🐛 **Speichern/Laden während des Chernobyl-Turbinenauslaufversuchs killte
  die Leistungsregelung, Kern lief unkontrolliert hoch.** Der schmale
  AR-Trimm (`ctx.arTrim`), der die Leistung nach `_triggerCoastdown()` nahe
  am Sollwert hält (`c.powerCtl.auto` ist ab dann bereits aus, der Trimm ist
  die EINZIGE noch aktive Gegenkopplung), ist ein Ad-hoc-Objekt auf `ctx`,
  kein `ctx.saveable`-Regler mit eigenem `snapshot()`/`restore()` --
  persist.js kannte ihn nicht. Nach jedem Laden während dieser Phase war die
  Regelung komplett weg, ohne jede Fehlermeldung: die Anlage lief danach
  ungebremst hoch, teils sekundenschnell statt wie vorgesehen über Minuten
  (Nutzerrückmeldung: 73-80 % Leistung bei nur 22 Sekunden seit
  Auslaufbeginn, erwartet ~6 %). `arTrim` wird jetzt genau wie das
  bestehende `mcpRunback` im Speicherstand mitgeführt.

## 0.5.5

- 🐛 **0.5.4 zeigte das falsche Zerstörungsfenster: Schritt 6 war teils unter
  einer Sekunde sichtbar, ohne Leistungsanstieg.** Es gibt technisch zwei
  Zerstörungsfenster (7-22s und 39-43s seit Auslaufbeginn), aber 'test'
  schließt schon um t+8s -- mitten im ERSTEN. Der neue 'window'-Schritt aus
  0.5.4 sprang dadurch sofort weiter, und in diesem ersten Fenster ist von
  einem Leistungsanstieg optisch noch nichts zu sehen (der beginnt real erst
  ab ~t+33s). Jetzt zählt für 'window' nur noch das ZWEITE Fenster
  (PRESS_WINDOW in chernobylTutorial.js): der Schritt bleibt auf "warten"
  stehen, während die Leistung sichtbar ansteigt, und schaltet erst in den
  39-43s auf "JETZT AZ-5 drücken!".

## 0.5.4

- ✨ **Chernobyl-Tutorial: neuer Schritt 'Auf den richtigen Moment warten'.**
  Wann genau AZ-5 die Anlage zerstört, hängt an der exakten axialen
  Schieflage im Moment des Drückens -- für einen Menschen ohne Anhaltspunkt
  praktisch nicht treffbar, selbst mit dem Sekundenzähler aus 0.5.3
  ("kein Mensch versteht wann er AZ5 drücken muss", Nutzerrückmeldung). Die
  Zerstörungsfenster sind deterministisch und wurden nachgemessen: 7-22 s
  und 39-43 s seit Auslaufbeginn. Ein neuer Schritt zeigt jetzt live "warte"
  bzw. "JETZT AZ-5 drücken!" an und schaltet nur während eines dieser
  Fenster zum letzten Schritt weiter -- der AZ-5-Knopf selbst war nie
  gesperrt und bleibt es auch jetzt nicht (siehe 'pressing AZ-5 too early'-
  Test).
- 🐛 **Statuszeile sagte "Anfahren-Tutorial abgeschlossen", auch nach der
  Chernobyl-Übung.** Der Text war für die drei echten Anfahrtutorials fest
  verdrahtet. Ein tutorialspezifischer Schlüssel (tut_chernobyl_completed)
  überschreibt ihn jetzt für die Chernobyl-Übung, mit Rückfall auf den
  alten Text für die drei Anfahrtutorials.

## 0.5.3

- 🐛 **0.5.2 (AZ-5-Hinweis erst bei Leistungsanstieg) zurückgenommen, echter
  Fix: Sekundenzähler seit Auslaufbeginn.** Der Hinweistext von Schritt
  'az5' nennt die Zerstörungsfenster bereits korrekt als Sekunden seit
  Auslaufbeginn (7-22 s, 39-43 s) -- er brauchte dafür nur den vollen
  Zeitraum ab Auslaufbeginn, den 0.5.2 versehentlich verkürzt hatte (Schritt
  'test' schloss erst bei n ≥ 15 % ab, das erste Fenster war damit
  unerreichbar, vom zweiten blieb nur ein Rest). Schritt 'test' schließt
  jetzt wieder sofort wie ursprünglich, dafür zeigen 'test' und 'az5' einen
  laufenden Sekundenzähler seit Auslaufbeginn, damit sich der Hinweistext
  tatsächlich befolgen lässt, statt die Sekunden im Kopf mitzählen zu
  müssen.

## 0.5.2

- 🐛 **Chernobyl-Tutorial: AZ-5-Hinweis erschien lange vor dem Leistungsanstieg.**
  Schritt 'test' schloss bereits ab, sobald der Kühlmitteldurchsatz unter 90 %
  fiel -- das passiert Sekunden nach Auslaufbeginn, lange bevor die Leistung
  überhaupt reagiert (der Blasenkoeffizient braucht die volle 30-Sekunden-
  Auslauframpe). Ein Spieler, der dem Hinweis sofort folgte, drückte AZ-5
  noch beim unveränderten ~200-MWth-Ausgangswert und sah nie den
  historischen Leistungsanstieg. `conditions()` verlangt jetzt zusätzlich
  n ≥ 15 % -- ändert nichts an der Physik oder am AZ-5-Knopf selbst (der war
  nie gesperrt), nur am Zeitpunkt des Hinweistexts. Damit fällt der
  vorgeschlagene Drückzeitpunkt fast genau auf das validierte historische
  Zerstörungsfenster (t+40s nach Auslaufbeginn).

## 0.5.1

- 🐛 **Chernobyl-Tutorial: Schritt 'dip' sprang nach 2s ungelesen weiter.**
  Der reine Erzähltext zum historischen Leistungseinbruch schloss automatisch
  nach der kurzen Haltezeit ab -- braucht jetzt wie 'handover' einen
  expliziten Bestätigen-Klick (`StartupTutorial.confirmIndices`).
- 🐛 **Chernobyl-Tutorial: Schritt 'recover' sagte 'von Hand halten', hielt
  aber automatisch.** Die Leistungsregelung (`c.powerCtl`) läuft während der
  19-Minuten-Haltephase durchgehend automatisch -- das ist Absicht (siehe
  Machbarkeitsprüfung, BACKLOG.md), der Text widersprach dem aber. Text/Hinweis
  korrigiert statt der Physik.

## 0.5.0

- ✨ **Kernzerstörung jetzt im Fließbild sichtbar.** Bisher zeigte nur das
  Auswertungsfenster ("Anlage verloren") die Zerstörung an -- das Fließbild
  selbst lief unverändert weiter, als wäre nichts passiert, wer das Fenster
  einmal wegklickte, sah am Bild keinen Unterschied mehr. Der Kern faerbt
  sich jetzt bei `state.destroyed` dauerhaft schwarz-verkohlt mit rotem
  Rand (`data-destroyed` auf der SVG-Wurzel, siehe `update()` in
  `mimic.js`), unabhängig vom Auswertungsfenster.
- ⚡ **Startseite/Splash deutlich schneller.** `splash.jpg`/`background.jpg`
  ersetzen die alten, unkomprimierten `splash.png`/`background.png` (je
  ~1,85 MB → ~170 KB, wie schon die Reaktorfotos in 0.3.0). Beide werden bei
  jedem Seitenaufruf gleichzeitig geladen (Übersicht + Splash-Banner) und
  hielten dabei bislang lange Serverthreads belegt.
- ⚡ **Waitress-Threadpool 8 → 24 Threads.** Docker-Protokoll zeigte
  wiederholt "Task queue depth" bis 15 -- der Pool war unter Last (mehrere
  gleichzeitige Seitenaufrufe, je mit den grossen Hintergrundbildern von
  oben) erschöpft. Kein CPU-Limit im `docker-compose.yml`, die Arbeit ist
  I/O-gebunden (Netzwerk, Platte) -- mehr Threads kosten hier praktisch nur
  Stack-Speicher, keine GIL-Konkurrenz um Rechenzeit.

## 0.4.1

- 🐛 **Instrumentenübersicht zeigte leere Karten.** RBMK/SWR kennen keine
  Bordosierung (`#rs-chem-ctl` bleibt leer), der DWR keine Sicherheits-
  systeme unter `#rs-safety-ctl` -- eine Karte mit Überschrift und sonst
  nichts stand trotzdem da. `openInstrumentsWindow()` überspringt jetzt
  Abschnitte ohne Inhalt.
- ✨ **Stabstellung in der Instrumentenübersicht.** Die Steuerstäbe-Karte
  bediente Automatik/Hand und Ziehen/Einfahren, zeigte aber nirgends, wie
  weit die Stäbe stehen -- reine Blindbedienung. Die Balken aus dem Reiter
  (samt eigener %-Anzeige je Bank) stehen jetzt mit in derselben Karte.
- 🐛 **Spielstände standen doppelt: Übersicht und Reaktorseite.** Die
  Übersicht behielt beim Umbau auf die neue Reaktorseite (0.3.0) ihre
  eigene Fortsetzen-Liste je Karte -- seit die Reaktorseite dieselben
  Stände zeigt, war das nur noch Dopplung. Die Karten der Übersicht zeigen
  jetzt nur noch Reaktortyp und Beschreibung, Fortsetzen läuft
  ausschließlich über die Reaktorseite.

## 0.4.0

- ✨ **Instrumentenübersicht (Taste O).** Rundinstrumente (Kern/Primär/
  Sekundär) und alle Stellteile (Stäbe, Pumpen, Speisewasser,
  Sicherheitssysteme, Bor, Netz) bündeln sich jetzt auf einer Fläche statt
  über acht Reiter verstreut zu sein -- kein Trend-Diagramm, keine reinen
  Zahlenzeilen, nur Gauges und Bedienung, wie gewünscht. Dieselbe
  Verschieben-statt-Kopieren-Regel wie bei „Kachel als Fenster" (R/P/S/G/A/
  V/M/C): jede Karte im neuen Fenster ist der echte Knoten aus seinem
  Reiter, keine zweite Instanz mit totem Zustand -- Schließen legt alles an
  seinen ursprünglichen Platz zurück. Anders als die einzelnen
  Panel-Fenster bewusst NICHT auf Desktop beschränkt: auf dem Handy ist das
  der einzige Weg, mehrere Stellteile ohne Reiterwechsel nebeneinander zu
  sehen. Q bleibt die Meldetafel-Quittierung, keine Kollision.

## 0.3.1

- 🐛 **Reaktor öffnen -> zurück -> denselben Reaktor wieder öffnen ergab ein
  leeres, schwarzes Fenster.** `fadeScreens()` (main.js) plante bei jedem
  Bildschirmwechsel einen `setTimeout`, der den alten Bildschirm nach der
  Sekunde Überblendung verbirgt -- ohne den vorigen Timer zu canceln. Zwei
  Wechsel innerhalb dieser Sekunde ließen den älteren Timer zuletzt feuern
  und den gerade erst wieder eingeblendeten Bildschirm erneut verstecken:
  `#rs-start` und `#rs-reactor` standen danach beide auf `hidden`, nur ein
  Neuladen half. Jetzt genau ein aktiver Timer je Wechsel.

## 0.3.0

- ✨ **Eigene Reaktorseite statt Inline-Auswahl.** Klick auf eine Karte in der
  Übersicht öffnet jetzt eine eigene Zwischenseite (`#rs-reactor`) mit
  Überschrift, Beschreibung, Hintergrundfoto des Typs, den gespeicherten
  Ständen und der Szenarienauswahl -- vorher erschienen Szenarienliste und
  „Los“-Knopf inline unter den Karten auf der Übersicht selbst. Übergang als
  1s-Opacity-Crossfade (`fadeScreens()`, `.rs-fade` in `base.css`); die URL
  wechselt per `history.pushState` auf `/reaktor/<typ>` (Browser-Zurück
  funktioniert, Direktaufruf/Neuladen liefert dieselbe Seite dank neuer
  Flask-Route `reactor_page()`). Hintergrundfotos (`pwr.jpg`/`bwr.jpg`/
  `rbmk.jpg`, `static/img/`) von ~1,85 MB PNG auf ~140 KB JPEG verkleinert.
  Zwei Lifecycle-Tests (`test-lifecycle.mjs`) prüften bisher `#rs-start` als
  Stellvertreter für „Simulation nicht gestartet“ -- jetzt direkt `#rs-app`,
  da die Ladeanzeige nun auf der neuen Seite sitzt. Alle 413 JS- und 196
  Python-Tests weiterhin grün.

## 0.2.4

- 🐛 **Speicher-Rückmeldung schob das Bedienfeld kurz nach unten.** Der Text
  „Speichern läuft …“ / „Speichern fehlgeschlagen“ neben dem Speichern-Knopf
  (`#rs-save-state`) nahm sichtbaren Platz ein und ließ beim
  Erscheinen/Verschwinden die Kopfzeile kurz springen -- wirkte wie ein
  Layout-Bug. Der Text bleibt für Screenreader im DOM (`role=status`), ist
  jetzt aber per `rs-sr-only` unsichtbar. Sichtbares Feedback kommt
  stattdessen vom Speichern-Knopf selbst: 2 s Grün bei Erfolg
  (`data-flash-ok`, `flashSaveOk()` in `main.js`), dauerhaft Rot bei Fehler
  bis zum nächsten erfolgreichen Speichern (`data-error`) -- ein
  unaufgelöster Fehler gewinnt dabei bewusst gegen ein kurzes Grün aus einem
  anderen, gleichzeitig erfolgreichen Speichervorgang (CSS-Reihenfolge in
  `layout.css`). Zwei neue Tests in `test-save-feedback.mjs` (alle 413 Tests
  weiterhin grün).

## 0.2.3

- 🐛 **AZ-5 zerstörte den Kern unabhängig davon, ob man es drückte.** Die
  generische Stabwirksamkeitskurve (`rodWorthCurve`) zog schon ab
  Stabposition h=0 Absorberreaktivität ab -- ohne die 1,25-m-Wassersäule
  vor dem Graphitverdränger zu kennen. Das hob praktisch alles wieder auf,
  was der Spitzeneffekt (`_tipReactivity`) für dieselbe Stabbewegung
  hinzufügte: der reale, dokumentierte Effekt ("positive scram effect",
  INSAG-7) blieb ein Rechenartefakt statt eines echten Ausschlags. Neue
  `_rodReactivity()` in `plants/rbmk.js` lässt den Absorber erst ab
  `tip.span` wirken, mit auf den verbleibenden Fahrweg umskalierter Kurve.
  Nebenwirkung, mit eigenem Hebel behoben: die Betriebskennzahl ORM
  (`_orm()`) zählt jetzt über dieselbe volle `rodWorthCurve` (h=0…1, nicht
  um `tip.span` verschoben) -- die um die Spitzenspanne verschobene Version
  hätte jede Stabstellung darin auf ORM≈0 (schlechtesten Blasenkoeffizienten)
  gezwungen, unabhängig von der genauen Tiefe, und den historischen Wert
  (6–8 von 211) im Modell unerreichbar gemacht, ohne die Anlage sofort
  instabil zu machen.
- ✨ **„Block 4" reproduziert AZ-5 jetzt als echte, promptkritische
  Exkursion** (`s.promptCritical`), nicht mehr über ein zufällig
  zusammenfallendes weiches Kriterium. Zwei neue Mechanismen in
  `game/chernobylTutorial.js`: ein schmaler AR-Trimm (`step()`, begrenzt auf
  ±500 pcm über `s.rho_ext`, NICHT über die Stabstellung) bildet die
  historische automatische Regelgruppe nach, die die Leistung ~36 s vor dem
  Test nahezu flach hielt; `_withdrawToTipSpan()` zieht beim Auslösen des
  Kühlmittelauslaufs die Hauptstäbe auf die dokumentierte
  Nacht-vor-dem-Unfall-Stellung (tief in der Graphitspitzen-Spanne, mit
  live nachgezogenem Xenon-Ausgleich statt fest hinterlegtem Wert) zurück.
  Gemessen destruktiv: Druck auf AZ-5 etwa 7–22 s und erneut 39–43 s nach
  Beginn des Auslaufs, dazwischen und danach übersteht die Anlage es --
  abhängig von der axialen Schieflage im Moment des Drückens, nicht von
  einer einfachen "je länger gewartet"-Regel. Hinweistext für Schritt 'az5'
  nennt die gemessenen Fenster jetzt.
- 🐛 Die Haltezeit für Schritt 'az5' (`HOLD[5]`) stand bei 1 s -- der jetzt
  echte promptkritische Ausschlag braucht nach dem Drücken selbst mehrere
  Sekunden bis zur Brennstoffenthalpie-Grenze (gemessen: 1,85–6 s je nach
  Zustand). Bei 1 s galt der Schritt (und damit die Übung) schon als
  geschafft, bevor die Physik überhaupt zu Ende gelaufen war. Jetzt 15 s.
- 🐛 **Kernzerstörung beendete jede Runde im selben Bildschirmtakt, in dem
  sie erkannt wurde** -- `session.js` schaltet `phase` synchron auf
  `DEBRIEF`, `main.js` fror das Bild (`setSpeed(0)`) und zeigte den
  Auswertungsdialog sofort darüber, bevor der Ausschlag überhaupt sichtbar
  ablaufen konnte. Gilt für jedes Szenario, nicht nur „Block 4". Neues
  `deferEnd()` in `main.js` lässt die Anlage nach Erkennen der Zerstörung
  noch 3 s sichtbar weiterlaufen (bei der 1×-Geschwindigkeit, auf die
  `triggerScram()` beim Drücken ohnehin zurückschaltet), bevor angehalten
  und der Dialog gezeigt wird -- gilt gleichermaßen für den
  Szenario-Auswertungsdialog wie für die Verlustanzeige im freien Spiel.
- ✨ Beide Enddialoge (Auswertung und Kernzerstörung) haben jetzt einen
  „Schließen"-Knopf, der nur das Fenster wegnimmt, statt (wie bisher nur
  „Menü") die ganze Runde zu verlassen -- Trends, Meldetafel und
  Instrumente lassen sich danach in Ruhe ansehen, „Menü" bleibt jederzeit
  erreichbar.

## 0.2.2

- ✨ **Neues Tutorial: „Block 4 – Die Nacht des 26. April“ (RBMK).** Geführter
  historischer Nachbau der Chernobyl-Nacht ab der Schichtübergabe um
  Mitternacht bis zum Turbinenauslaufversuch und AZ-5, basierend auf IAEA
  INSAG-7. Der Ausgangszustand (ORM ≈ 28, ≈237 MWth) ist das Ergebnis einer
  validierten zweistufigen Vorgeschichte (Volllast → 50 % → neun Stunden
  halten → 7 %) und wird als geprüfter, fester Zustand in `prepare()`
  hinterlegt (Live-Neuberechnung dauert im Browser ~3,7 s, siehe unten).
  AZ-5 kombiniert mit einem geskripteten Kühlmittelauslauf (neues Event
  `rbmk_mcp_runback`, 30 s) führt bei ausreichender Wartezeit zuverlässig zu
  echter Brennstoffzerstörung -- mit der **bestehenden** RBMK-Physik
  (Graphitverdränger- und Dampfblasen-Rückkopplung), keine neue Kalibrierung
  nötig. Ein realer Leistungseinbruch wird bewusst NICHT mechanisch
  nachgestellt: Schon ein kurzer, moderater Einbruch riss beim Testen mehr
  Xenon auf, als sich mit den verbleibenden Steuerstäben je zurückholen
  ließ, auch mit voll gezogenen Stäben -- eine Grenze dieses vereinfachten
  Modells, keine Kalibrierfrage, im Anleitungstext offen benannt.
- 🔧 **Tutorial-Basisklasse generalisiert.** `TUTORIAL_STEPS`/`HOLD_SECONDS`
  in `game/tutorial.js` waren Modulkonstanten, geteilt von allen drei
  bestehenden Anfahrtutorials (PWR/BWR/RBMK) -- keine Unterklasse konnte
  eine andere Schrittzahl haben. Jetzt überschreibbare Instanz-Getter
  (`steps`/`holdSeconds`), Default unverändert. `ui/tutorial.js` liest die
  Schrittliste jetzt von der lebenden Instanz bzw. (für die Debrief-Anzeige
  nach Sitzungsende) von einem zusätzlichen, nur dort angehängten Feld --
  das Speicherformat von `snapshot()` bleibt unverändert. Keine Auswirkung
  auf die drei bestehenden Anfahrtutorials (26 Regressionstests weiterhin
  grün).

## 0.2.1

- 🐛 Admin konnte sich nicht abmelden: die Rollenweiche in `_require_login()`
  schickte ihn bei jedem Aufruf zuerst nach `/admin`, bevor `logout()`
  überhaupt lief. `/logout` läuft jetzt unabhängig von der Rolle immer durch.

## 0.2.0

- ✨ **Admin-Panel statt REACTORSIM_USERS.** Das Konto aus
  `REACTORSIM_USER`/`REACTORSIM_PASSWORD` ist jetzt ein reines Admin-Konto --
  es spielt nicht, sondern landet nach der Anmeldung im Panel unter `/admin`.
  Dort legt es Spielerkonten an (E-Mail-Adresse als Benutzername, Passwort
  frei wählbar oder erzeugt), sperrt/entsperrt sie, setzt Passwörter zurück
  und sieht je Konto Anmeldezeitpunkt, Absenderadresse (per `ProxyFix`,
  konfigurierter Hop-Zaehler unveraendert bei 1) und die zuletzt gespielten,
  ausgewerteten Läufe (Reaktortyp, Szenario, Dauer). `REACTORSIM_USERS`
  entfällt ersatzlos; Spielerkonten liegen jetzt in `/data/users.db`
  (SQLite) statt in der Umgebung. Eine Sperre wirkt sofort, auch bei
  bereits laufender Sitzung. Mehrere Spielerkonten können gleichzeitig
  spielen (eigene Spielstände, eigene Ratenbegrenzung, wie zuvor); je Konto
  bleibt genau eine aktive Sitzung erzwungen, das Admin-Konto ist davon
  ausgenommen (mehrere Tabs/Geräte fürs Panel erlaubt, da es ohnehin nicht
  spielt). Passwort-Reset ist in dieser Phase manuell (Admin liest das neue
  Passwort einmalig im Panel ab und gibt es weiter); automatischer
  Mailversand folgt später. Bestehende Spielstände/Konten aus der
  Entwicklungszeit werden mit diesem Umbau nicht migriert.
- Anfahr-Tutorial für den SWR: vorbereiteter heißer, unterkritischer Start,
  Umwälzpumpe, manueller Leistungsaufbau und rund 300 MWe mit 120 Sekunden
  stabilem Betrieb. Dynamische Reaktivitätshinweise, eigene deutsche und
  englische Texte zu Dampfblasen, Durchsatz und Domdruckregelung. Speichern
  und Fortsetzen einschließlich ausstehender Inspektionsbestätigung;
  keine Bestenlistenwertung und keine Änderungen am laufenden Anlagenmodell.
- Alle Anfahr-Tutorials öffnen Schritt 1 im bestehenden Dialog und warten
  nach der Zustandsprüfung auf „Zustand geprüft – weiter“. Messwerte und
  Sollbereiche bleiben bis zur bewussten Bestätigung sichtbar.
- Anfahr-Tutorial für den RBMK-1000: fünf zustandsbasierte Lernziele vom
  vorbereiteten heißen Stillstand über acht Hauptumwälzpumpen und manuellen
  Leistungsaufbau bis zu rund 300 MWe und 120 Sekunden stabilem Betrieb.
  Eigene deutsche und englische Hinweise zu Trommeldruck, Wasserhaushalt,
  ORM, Dampfblasen-Rückkopplung und Leistungsautomatik. Fortschritt inklusive
  Haltezeit wird gespeichert; Abschluss ohne Bestenlistenwertung.
- 🐛 `users.py` fehlte im Dockerfile-`COPY`: Container startete seit dem
  Admin-Panel-Umbau mit `ModuleNotFoundError`, sobald `app.py` es importierte.
  Dockerfile korrigiert; `test_dockerfile.py` prüft jetzt den echten
  Python-Importgraph ab `app.py` statt einer festen Namensliste, damit ein
  fehlendes lokales Modul künftig in der CI auffällt statt erst beim Deploy.

## 0.1.35

- "Prompt kritisch" (ρ > β, s.promptCritical aus sim/kinetics.js) ist jetzt
  eine echte Meldetafel-Kachel (`prompt_critical`, höchste Schwere) in allen
  drei Reaktortypen statt nur ein Kopfzeilentext ohne Hupe, Protokoll oder
  Quittierung. Eigener Hilfetext mit Handlungsschritten; automatischer
  Helfer meldet bewusst "nicht behebbar" -- nur SCRAM/RESA/AZ-5 wirkt, wie
  bei "Leistung hoch"/"Periode kurz".
- Rechenrückstand (Simulation kommt beim Zeitraffer nicht hinterher) zeigt
  sich wieder, jetzt als rotes ❗ fest links in der oberen Werteleiste --
  ausserhalb der frei wähl-/verschiebbaren Werte, nur sichtbar, wenn's
  wirklich klemmt, mit Erklärung als Mouseover.

## 0.1.34

- `#rs-status-alarm`-Zeile ganz entfernt statt nur bei Bedarf ein-/
  auszublenden -- das Ein-/Ausblenden selbst verschob Inhalte darunter.
  Ersatz: Meldetafel-Kopfzeile (`#rs-p-alarm > .rs-panel-h`) färbt sich wie
  eine Kachel (gelb/orange/rot je Schwere), blinkt, solange etwas
  unquittiert ist, bleibt farbig, solange es nicht rückgestellt ist -- sie
  steht im Desktop-Raster ohnehin immer da, verschiebt beim Auftauchen also
  nichts. Auf dem Handy übernimmt weiterhin der Tab-Reiter (unverändert).
  Als Nebenwirkung sind die eigenständigen Slip- und Prompt-kritisch-
  Hinweise (`#rs-slip`, `#rs-prompt`) mit entfernt -- sie hingen an
  derselben Zeile und hatten sonst keine Anzeige; kein Ersatz dafür in
  dieser Version.

## 0.1.33

- "keine Störung"-Zeile in der Kopfzeile entfernt, solange nichts ansteht --
  derselbe Zustand steht schon in der Meldetafel. Die Zeile (samt farbigem
  Schweregrad-Hintergrund) erscheint jetzt nur noch bei tatsächlich aktivem
  Alarm oder Slip-/Kritisch-Hinweis.
- Trends-Kachel steht im Desktop-Raster nur noch mit Kopfzeile da, Diagramme
  eingeklappt -- die volle Ansicht ist über den bestehenden Klick auf die
  Kopfzeile bzw. Taste V (openPanelWindow(), siehe PANEL_KEYS) weiterhin nur
  einen Schritt entfernt, gibt beim Schließen des Fensters aber wieder Platz
  für Kern/Primär/Sekundär/Netz/Chemie/Meldetafel frei. Nur ab 1024px --
  auf dem Handy bleibt der Trends-Reiter unverändert voll sichtbar.

## 0.1.32

- Neuer Hotkey Q: quittiert die Meldetafel wie der Knopf selbst (löst
  `#rs-ack`.click() aus). Rückstellen bleibt bewusst ohne Taste, nur per
  Klick -- ein Fehlklick dort gibt bei stehendem SCRAM den Reaktorschutz
  frei. In der Tastenkürzel-Hilfe gelistet (`sc_ack`).

## 0.1.31

- "Passendes Panel anzeigen" im Tutorial-Anleitung-Dialog wirkte auf breiten
  Bildschirmen wie ein toter Knopf: der Reiterwechsel ist dort unsichtbar
  (alle Panels stehen ohnehin im Raster), und scrollIntoView+focus allein
  auf ein bereits sichtbares Panel fiel direkt nach dem Schliessen des
  Dialogs kaum auf. Kopfzeile des Zielpanels blinkt jetzt kurz auf
  (`rs-panel-jump`), respektiert prefers-reduced-motion.

## 0.1.30

- Anfahren-Tutorial nimmt keine eigene Zeile über dem Arbeitsbereich mehr
  ein (0.1.29 hatte sie nur verkleinert, nicht entfernt -- weiterhin ein
  eigener Balken). Schritt+Livewerte stehen jetzt als kleiner klickbarer
  Text (11 px, zentriert, zwei Zeilen) direkt in der Kopfzeile neben
  Speichern. Klick öffnet #rs-tutorial-modal mit Aufgabentext,
  zustandsabhängigem Hinweis, Warum-Erklärung, Lernzielen und dem Knopf
  "Passendes Panel anzeigen" (schließt den Dialog und springt zum Panel).
  Passt auch im schmalen Querformat, da die Kopfzeile ohnehin umbricht.

## 0.1.29

- Anfahren-Tutorial-Statusleiste (`#rs-tutorial`) verkleinert: der statische
  Aufgabentext, die "Warum wirkt das?"-Erklärung und die Lernziele-Checkliste
  wandern in einen eigenen "Anleitung"-Dialog (`#rs-tutorial-modal`), der
  wie Glossar/Tastenkürzel per Knopf geöffnet wird -- sie ändern sich nur
  fünfmal pro Lauf, kosteten aber dauerhaft Platz. In der Leiste bleiben nur
  Schritttitel, Livewerte, kompakte Haltezeit (`tut_hold_compact`) und der
  zustandsabhängige Hinweis (`tut_hint_*`) sichtbar -- die ändern sich
  während der Bedienung tatsächlich.

## 0.1.28

- Ein-Zeiler-Hinweise unter Ventilstellung, Speisewasserstrom, Druckhalter
  und Stäbe entfernt (`hint_gov`, `hint_fw`, `hint_pzr`, `hint_rods`) --
  offensichtlich, kosteten nur Platz unter jeder Regelstation.

## 0.1.27

- Kopfzeilen-Icon-Buttons (Stummschalten/?/⌨/⚙/Einweisung) wieder gleich
  breit. `.rs-status-controls > button` setzte `min-width: 0` fuer alle
  Knoepfe (noetig, damit lange Text-Knoepfe auf schmalen Ansichten
  umbrechen), das ueberschrieb `.rs-btn-icon`s eigenes `min-width: 38px` --
  jedes Icon zog sich auf seine eigene Zeichenbreite zusammen. Icon-Knoepfe
  jetzt per `flex: 0 0 38px` fest quadratisch, Text-Knoepfe schrumpfen
  weiterhin.

## 0.1.26

- Trendpanel: Live-/Auswahl-Statuszeile (`trend_following`/`trend_selected`,
  z.B. "Live: gemeinsame Simulationszeitachse...") komplett entfernt --
  0.1.25 hatte nur den statischen Erklärtext (`trend_help`) darüber
  gestrichen, diese Zeile blieb stehen. Zeitpunkt bei Auswahl steht bereits
  im Ereignis-Button selbst (`HH:MM:SS / n,nnn.n s`), keine Dopplung noetig.

## 0.1.25

- Laufzeit-Hinweisbereich `#rs-guidance` (Ziele, Bedienhinweise, Ein-/Ausblenden)
  vollständig entfernt statt nur eingeklappt -- kostete auch geschlossen noch
  Platz in der Seitenleiste. Die Einweisung bleibt über den vorhandenen
  `#rs-briefing-btn` erreichbar; nur dort und im Vorlauf (`#rs-brief-guidance`)
  rendert `renderGuidance()` noch.
- Trendpanel: statischer Erklärtext (`trend_help`) über den Diagrammen entfernt,
  reiner Platzverbrauch ohne dynamischen Inhalt. Der Live-/Auswahl-Status
  bleibt, der zeigt tatsächlich Zustand an.
- "Zuletzt erfolgreich gespeichert"-Zeile aus der sichtbaren Statuszeile
  entfernt; der Text steht jetzt als Tooltip (`title`) auf dem
  Speichern-Knopf, bleibt aber unsichtbar (`.rs-sr-only`) im DOM fuer
  Screenreader und Tests erhalten.

## 0.1.24

- 15. Szenario: **AZ-5 war erst der Anfang**, RBMK, Schwierigkeit 3,
  30 Simulationsminuten bei 0 MW Netzbedarf. `rbmk_post_az5_v1` löst bei t=0
  echtes Engine-SCRAM aus; Stäbe fahren noch, Nachwärmegruppen, heißer Brennstoff
  und Graphit bleiben erhalten. Nach 90 s fallen vier Hauptumwälzpumpen aus,
  nach 180 s ist die normale Speisung physisch auf 15 kg/s begrenzt; nach 240 s
  ist die Hilfsspeisung verfügbar, aber nicht automatisch eingeschaltet.
- Begrenzte Hilfsspeisung mit maximal 220 kg/s und 160.000 kg Vorrat vor der
  bestehenden Massen-/Energiebilanz; beide Speisewege verwenden abstrahiert
  165 °C warmes Wasser. Tatsächliche Ströme statt bloßer Regleraufträge zählen.
  Ausgefallene Pumpen bleiben auch gegen Helfer-/Replay-Neustarts gesperrt.
  Übungsspezifische Bedienung und Diagnose zeigen Auftrag, Kapazität, Iststrom,
  Vorrat/Reichweite, Trommelmasse, Bilanz, Kühlmittel-/Graphitwärme und T_gr.
- Genau zwei Ziele mit unverändertem `incident_v1`: Inventarversorgung 30 s,
  stabile Wärmeabfuhr 120 s, erst nach allen drei Ereignissen und dem nächsten
  Physikschritt. Grenzverletzungen setzen Haltezeiten zurück und widerrufen
  Erfolg; beide Ziele müssen bei 1800 s aktuell erfüllt sein. Kein versteckter
  Fehlertimer, keine Energie-/SCRAM-Strafe; Server-Replay für die Bestenliste
  zwingend, geladene Läufe weiterhin nur lokal. Sinkende Wärme verlangt dosierte
  Speisung, keine vorgeschriebene Bedienfolge. Gemessene erfolgreiche Läufe:
  3650 Punkte ohne Quittierung; Nichtstun und alle 111 geprüften konstanten
  Stellwerte ab 240 s scheitern, kein Beweis über beliebige spätere Eingaben.
- Neue flache Speicherfelder streng geprüft, Altstände neutral ergänzt;
  äußeres Format v1, Trendformat v1 mit 15 Kanälen und Wertungsversion unverändert.
  `pendingLog: {engine, trips}` bewahrt je die letzten 120 noch nicht dargestellten
  Meldungen. Laden ersetzt frische Start-/Vorbereitungsqueues durch gespeicherte
  Ereignisse, ohne Feld durch leere Queues: keine doppelten Startmeldungen,
  echte ausstehende Ereignisse genau einmal, auch bei DWR/SWR.
- Mobile Meldetafel-/Loggruppe schrumpft nicht mehr auf null: 180 px Gruppe,
  gemessen 142 px Log; Touch-Scrollen und Alarmhilfe bleiben erreichbar.
  Alte Szenario-JSONs unverändert, bisherige RBMK-Physik per Regression geprüft;
  zusätzlich `srv` initial auf 0 gesetzt. Kein identischer globaler Zustandshash
  behauptet, da neue Felder hinzukommen. Modell weiterhin zusammengefasst,
  sättigungsbasiert, ohne detaillierte Oxidation oder Sicherheitszertifizierung.
- Finale vollständige Prüfungen: Node 380/380, Python 175/175, darunter 14 neue
  API-Tests für echte RBMK-Bestenlisten ohne Änderung der Produktions-API-Formeln.
  Browser 1350/1350 in 108 Fällen, vier DE/EN-Desktop-/Mobil-Kombinationen;
  vier authentische UI-Läufe mit identischen Server-Replays zu je 3650 Punkten.
  Geprüft am finalen Code unter 0.1.23 vor der reinen Versionsanhebung;
  Methodik, Fortsetzung und Grenzen: [RBMK-Audit](audit/RBMK-POST-AZ5-2026-09-14.md).

## 0.1.23

- Globaler Speicherstatus unter den Bedienelementen: letzter erfolgreicher
  Auto-/Handspeicherzeitpunkt, laufender Auftrag und bleibende Fehlermeldung
  auch während eines Wiederholungsversuchs. Neue Schreibvorgänge verwenden die
  Browser-Bestätigungszeit; geladene Stände ihr echtes serverseitiges `saved_at`,
  ohne das Laden als neue Speicherung auszugeben. Anzeige je Runde zurückgesetzt.
- Beim Auslösen abgetrennte Snapshots und rundenübergreifende FIFO je Slot
  verhindern umgekehrtes Überschreiben. Maximal 16 Aufträge je Slot, doppelte
  ausstehende Autosicherungen desselben Kontexts zusammengefasst. Fehlgeschlagene
  oder geworfene Schreibvorgänge blockieren Folgeaufträge nicht; nur Antworten
  des aktuellen Kontexts verändern dessen Anzeige. Der Handspeicherdialog zeigt
  Listenfehler statt scheinbar leerer Plätze und erlaubt echte Wiederholung;
  Schreibfehler lassen ihn offen, alte Antworten/Schaltflächen bleiben wirkungslos.
- Szenariostart aus der Auswahl und Fortsetzen verwenden denselben festgehaltenen Ladekontext
  mit Lade-, Fehler- und Wiederholungsanzeige. Fehlende Metadaten werden erneut
  abgerufen, Definitionen einschließlich einfacher Störungsziele geprüft;
  kein stiller Wechsel ins freie Spiel. Auswahlwechsel, Zurück, Boot und Menü
  entwerten alte Antworten, auch einen in `boot()` wartenden Spielstandabruf.
- Xenon-Zeitsprung nur im laufenden freien Spiel nach SCRAM bei `X > 1`.
  Abbrechen, Pause, globale Leertaste oder SCRAM stoppen ihn mit aktuellem
  Zustand in Pause; positive Tempowechsel sind währenddessen gesperrt.
  Echte 0,05-s-Schritte in 2000er-Blöcken, Freigabe des Browsers vor dem ersten
  Block und tickgenaues Limit von 48 Simulationsstunden. Nur `X <= 1` gilt als
  Erfolg mit Log, Trendmarker und 1×; Limit, Fehler oder Zerstörung starten nicht
  automatisch weiter. Normales SCRAM außerhalb des Sprungs bleibt bei 1×.
- Punkt 8 der Verbesserungsvorschläge damit vollständig erfüllt: Trendhistorie
  seit 0.1.22, Speicherstatus und Abbruch seit 0.1.23. Speicherformat, Physik,
  Szenarioziele und Wertungen bleiben unverändert.
- Bestätigter vollständiger Node-Lauf: 322/322; Python unverändert erneut 161/161
  nach einem anfänglichen Windows-Zugriffsfehler im bestehenden Highscore-Stress-
  test, ohne Produktionsfix. Browser final 724/724 in vier DE/EN-Desktop-/Mobil-
  Kombinationen, zusätzlich vier uninstrumentierte Smokes. Funktionsprüfung vor
  der reinen Versionsanhebung 0.1.22 auf 0.1.23; Details, Fehlerinduktion und
  Grenzen: [Komfort-Audit](audit/KOMFORT-2026-09-14.md).

## 0.1.22

- Gemeinsame Trends für alle 14 Szenarien und das freie Spiel aller drei
  Reaktortypen: 1 Hz Simulationszeit, letzte acht Stunden, maximal 28.800
  Messpunkte. Vier Hauptdiagramme für Leistung, Druck, Füllstand und
  Speise-/Dampfstrom sowie vier erweiterte Diagramme teilen die Zeitachse
  mit Ansichten für 10 Minuten, eine und acht Stunden.
- Bis zu 600 Ereignismarker unterscheiden Bedienaufträge von tatsächlicher
  Schnellabschaltung, Rücksetzen/Wiederherstellung und Alarm-/Störungsflanken.
  Zielmarker gibt es für die drei DWR-Störungsschichten und das Anfahren-Tutorial,
  nicht für sämtliche Szenarien. Markerlisten-Schaltflächen setzen einen weißen
  Cursor und halten die Ansicht fest; „Live“ hebt die Auswahl auf. Fehlende
  Messwerte bleiben Kurvenlücken, auch beim SWR-Füllstand ohne Gleichstrom.
- Spielstände erhalten die gesamte noch vorgehaltene Trendhistorie und Marker
  binär/Base64, ohne Ausdünnung oder weiteren Präzisionsverlust gegenüber den
  15 Live-Float32-Kanälen und Float64-Zeitwerten. Nur die Darstellung verdichtet
  nach Min/Max. Alte oder ungültige Trendblöcke starten ausdrücklich ohne
  Historie, ohne einen gültigen Anlagenzustand abzulehnen. Erfassung läuft auch
  ohne Rendering, der Schlusswert liegt vor dem Abschluss-Callback vor;
  Fortsetzen bleibt exakt und ohne doppelte Samples. Replay und Wertung bleiben
  unverändert. Helferprotokollierung ist renderunabhängig und ohne Doppeleinträge;
  der tatsächliche UI-SCRAM-Auftrag mit `null` wird korrekt verarbeitet.
- Speicherlimit nur für Spielstand-PUTs auf 4 MiB (4.194.304 Bytes) angehoben;
  sonstige Flask-Anfragen bleiben bei 256 KiB, Einstellungen bei 8 KiB.
  Waitress erlaubt 4 MiB Transportgröße. 60 Slots ergeben maximal 240 MiB
  Spielstände je Konto, zuzüglich Backups und sonstiger Daten.
- Screenshot-Wunsch umgesetzt: Der gesamte Laufzeit-Hinweisbereich
  `#rs-guidance`, einschließlich Zielen und Bedienhinweisen, klappt nun über
  die Überschrift als natives `details` ein, geschlossen auf 40 px.
  Standardmäßig offen; die Wahl bleibt über Neuladen und Szenariowechsel in
  `localStorage` erhalten, bei gesperrtem Speicher zumindest im Arbeitsspeicher.
  Ziele laufen auch geschlossen weiter. Die Einweisung erhält keinen äußeren
  Klappbereich. Leertaste/Enter bedienen native Elemente ohne Tempo-Umschaltung.
- Bestätigte vollständige Prüfungen: Node 288/288, Python 161/161 und Browser
  1786/1786 in DE/EN auf Desktop und emulierter Mobilansicht. Browser-Endstand
  vor der reinen Versionsanhebung 0.1.21 auf 0.1.22; Prüfumfang, gemessene
  Speichergrößen und Grenzen: [Trend-Audit](audit/TRENDS-2026-09-14.md).

## 0.1.21

- Zustandsbasierte Sicherheitsziele und `incident_v1`-Wertung für die drei
  neuen DWR-Schichten: Versorgung beziehungsweise begrenzte Wärmeleistung
  15 Sekunden, stabile Wärmeabfuhr 120 Sekunden. Erst nach den erforderlichen
  Störungen aktiv; in der Kombination erst nach beiden. Grenzverletzungen
  setzen Haltezeiten zurück und widerrufen auch bereits erfüllte Ziele.
  Beide Ziele müssen am unveränderten Ende bei 900 beziehungsweise 1080
  Simulationssekunden aktuell erfüllt sein; kein vorzeitiger Erfolg.
- Je aktuell erfülltem Ziel 1000 Punkte, bei erfolgreichem Abschluss zusätzlich
  1000 plus 250 je Schwierigkeitsstufe. Energie, Netzabweichung, RESA und
  Grenzwertdauer tragen null Punkte bei; unquittierte Alarme kosten höchstens
  100 Punkte. Katastrophenabzüge und frühere Abbruchregeln bleiben erhalten.
  Übrige Szenarien und Physik bleiben unverändert; Ziele prüfen kalibrierte
  Spielzustände, keine vollständige Störfallbehandlung oder Leckreparatur.
- Zielübersicht, laufende Haltezeiten, erster Erreichungszeitpunkt und
  aufklappbare Kriterien in DE/EN; erneut geöffnete Einweisung mit aktuellem
  Zielstand. Auswertung übernimmt Ergebnis, Punkte und Summary vom Server,
  gegen verspätete Antworten nach Sitzungswechsel abgesichert.
- Speicherformat bleibt Version 1 und erhält Haltezeiten, Fenstergrenzen und
  ersten Erfolg. Alte/ungültige Zielblöcke starten ohne Zielfortschritt.
  Geladene Läufe haben kein vollständiges Replay und bleiben lokal gewertet.
  Für die drei neuen Bestenlisten ist Server-Replay Pflicht; Helfereingriffe
  werden aufgezeichnet und gegen `guidance` geprüft. Alte Betriebswertungen
  bleiben gespeichert, getrennt nach Wertungsversion.
- Vollständige Tests: Node 210/210, Python 158/158 bestanden. Echter
  Chromium-Test in DE/EN auf Desktop und emulierter Mobilansicht: 1541
  Prüfungen bestanden. Dabei den Auswertungsdialog höhenbegrenzt und scrollbar
  gemacht, damit Eintragen, Neustart und Menü auch bei langen Ergebnissen
  erreichbar bleiben. Details und Nachweise:
  `audit/SZENARIOZIELE-2026-09-14.md`.

## 0.1.20

- Drei kurze DWR-Schichten mit gestufter Unterstützung: Speisewasserregelung
  (geführt, Schwierigkeit 1, 15 Minuten), Dampferzeuger-Rohrleck mit 8 kg/s
  (selbständig, Schwierigkeit 2, 15 Minuten) und kombinierter Turbinen-/
  Speisewasserstörung (anspruchsvoll, Schwierigkeit 3, 18 Minuten).
- Szenarioauswahl nach Schwierigkeit, Tutorial zuerst; Stufenprofile auf den
  Karten. Deutsche/englische Hinweise in Einweisung und Spiel, Einweisung
  erneut zu öffnen. `guidance` steuert `hint_key`, `event_alerts` und
  `auto_helper`: Stufe 1 erlaubt Vorwarnung/Helfer gemäß Einstellungen,
  Stufen 2 und 3 nicht. Globale Helferpräferenz und alte Szenarien ohne
  `guidance` bleiben unverändert.
- Keine Physikänderung: Speisewasserregelung bleibt wiederherstellbar, ohne
  Hilfsspeisung oder permanenten Pumpendefekt. Rohrleck nur im vereinfachten
  zusammengefassten DE-Modell, ohne Einzelisolation/Aktivitätsmessung.
  Zeitabschluss und Punkte prüfen keine Diagnose oder korrekte Behandlung;
  beim Rohrleck kann auch Nichtstun zum Zeitabschluss führen. Diese Grenzen
  stehen ausdrücklich in den deutschen und englischen Szenariotexten.
- JavaScript 164/164 und Python 82/82 bestanden; neue Guidance- und
  Progressionstests sowie ergänzte Lifecycle-/API-Tests. Echter Chromium-Check
  auf Desktop und emulierter Mobilansicht: 289 Prüfungen bestanden. Dabei
  übernommene Scrollpositionen in Einweisung und Hinweiskarten korrigiert.
- Umfang, Reproduktion, Balancing und offener Ausbau:
  `audit/SZENARIEN-2026-09-14.md`.

## 0.1.19

- Interaktives DWR-Anfahren-Tutorial als eigene Übung in der Szenarioauswahl.
  Vorbereiteter heißer, unterkritischer Start; fünf Lernziele für
  Zustandsprüfung, Pumpenhochlauf, Stabbedienung, Lastaufnahme und stabilen Betrieb.
- Tutorialkarte mit aktuellen Werten, zustandsabhängigen Hinweisen,
  Wirkungserklärungen, Lernzielliste und Sprung zum passenden Panel.
- Fortschritt hängt vom Anlagenzustand ab. Die abschließende Haltezeit von
  120 Sekunden beginnt bei einer Abweichung neu; bloßes Abwarten gewährt keinen
  Erfolg. Schnellabschaltung, Schaden oder Zeitablauf beenden den Versuch.
- Spielstände bewahren Schritt, Haltezeit und erreichte Ziele. Die Auswertung
  zeigt Ziele und Schichtverlauf ohne Punkte; die API lehnt Tutorialwertungen ab.
- Acht neue JavaScript-Tests einschließlich vollständigem Anfahren,
  identischer Fortsetzung aus einer laufenden Haltezeit und UI-/Lifecycle-Fällen;
  zusätzlicher API-Test und deutsche/englische Texte.
- Umfang und Nachweise: `audit/TUTORIAL-2026-09-14.md`.

## 0.1.18

- Diagnosebereich im Primärpanel für alle drei Reaktortypen: Pumpenantrieb,
  Drehzahl und Pumpenbeitrag; Ventilauftrag und tatsächliche Öffnung;
  Kern- und Speisewasserstrom. Naturumlauf und Pumpenauslauf werden erklärt.
- SWR: Notkondensator-Bedienwunsch und Rückmeldung getrennt; Messausfall bei
  fehlendem Gleichstrom ausdrücklich sichtbar. Die Füllstandszahl zeigt dann
  keinen scheinbar aktuellen Wert. Diesel-Einspeisung wird getrennt vom
  Einschaltwunsch ausgewiesen.
- Szenarioauswertung mit Störungen, Bedienaufträgen, Helfereingriffen und
  Meldungswechseln. Erstes Warn-/Auslösesignal und der zeitliche Bezug zwischen
  letzter Bedienung und erloschener Meldung helfen bei der Nachbesprechung.
  Ein zeitlicher Zusammenhang wird nicht als bewiesene Ursache ausgegeben.
- Eigenes, mitgespeichertes Auswertungsprotokoll mit bis zu 600 Einträgen,
  unabhängig von Renderfrequenz und Replay-Recorder. Kontinuierliche
  Stellbewegungen werden zusammengefasst; fehlende Historie wird benannt.
- Deutsche und englische Texte; gezielte Diagnose-, Auswertungs- und
  Fortsetzungstests. Details: `audit/VERBESSERUNGEN-2026-09-14.md`.

## 0.1.17

- Dampfentnahme durch Inventar und Energie begrenzt; kein dauerhaftes Restwasser.
- Bedeckung und DNBR/CPR beeinflussen den Waermeuebergang; die kuenstliche
  SWR-Heizquelle bei Kernfreilegung entfaellt. Brennstoff und Graphit bilanzieren
  gespeicherte und abgegebene Waerme.
- Druckabhaengige Diesel-Loeschwasserpumpe mit begrenztem Vorrat, Anzeige,
  Druckentlastung und Gleichstrom-/Ersatzbatterie-Bedienung.
- Wasserstoff: getrennte Gasraeume, Leckage und kontrollierte Entlastung.
- RBMK-Stabwirkung folgt der Geometrie bei Handfahrt und AZ-5.
- Sieben Nachwaermegruppen erhalten den Langzeitanteil. Alte Viergruppenstaende
  werden unter Erhalt ihrer momentanen Nachwaermeleistung migriert.
- IAPWS-Oberflaechenspannung; heisser Wiederanlauf korrekt bezeichnet.
- Physik-Regressionen, Blackout-Gegenproben, Speicherung und Eingabe-Replay;
  Details und Modellgrenzen in audit/PHYSIK-FIXES-2026-09-13.md.

## 0.1.16

- Spielstände bewahren interne Vorwerte, Reglertakt, Zufallszustand und
  RBMK-Zonen-/AZ-5-Zustände. Neue Speicherstände setzen die geprüften
  Transienten exakt fort; ältere Stände bleiben mit rekonstruierten
  Vorwerten ladbar. Alarmursachen und freie Bedarfskurven werden mitgesichert.
- Fortsetzen lädt den Zustand vor Panelaufbau, Simulation und Autosicherung.
  Ladefehler bleiben im Menü sichtbar; veraltete Ladeantworten werden verworfen.
- Verlassen des freien Spiels beendet die Sitzung, sodass anschließend wieder
  Szenarien gestartet werden können. Neustart behält auch geladene Szenarien.
- Szenarioverluste zeigen Ursache, Verlauf und Wertung in einer Auswertung.
  Menü und Neustart räumen beide Enddialoge auf.
- Trends werden im Simulationstakt erfasst, unabhängig von Bildrate und
  Zeitraffer. Ein alter Xenon-Zeitsprung endet bei einem Sitzungswechsel.
- 14 Regressionstests für Persistenz, Menü-/Ladeabläufe, Enddialoge und Trends.

## 0.1.15

- 🐛 **Fix: der eigentliche Grund hinter 0.1.14 -- vergangene Szenario-
  Ereignisse feuerten nach JEDEM Laden erneut, nicht nur, weil ihre
  ctx-Merker fehlten.** `Session`/`Scenario` werden bei jedem Rundenstart
  frisch gebaut (auch beim Fortsetzen, main.js `boot()`), noch BEVOR der
  Spielstand angewendet wird -- die neue `Scenario`-Instanz weiss darum
  nichts von Ereignissen, die in einer früheren Sitzung schon liefen.
  Sprang `t_sim` durchs Laden über deren Zeitpunkt, feuerte
  `scenario.due()` sie beim nächsten Bild einfach noch einmal: doppelte
  Protokollzeilen (sichtbar durch das rollende Log-Gedächtnis aus 0.1.3),
  und bei einer laufenden Meldung wie "Pumpe ausgefallen" zusätzlich ein
  Aus-und-wieder-An auf der Meldetafel samt Hupe -- 0.1.14 allein reichte
  dafür nicht, weil es nur die ctx-Merker selbst sicherte, nicht das
  erneute Feuern des Ereignisses verhinderte.
  Neues `Scenario.catchUp(t)` (game/scenario.js) markiert nach dem Laden
  alle bereits vergangenen Ereignisse als erledigt, OHNE sie anzuwenden --
  ihre Wirkung steckt schon im geladenen Zustand. Geprüft per Nachbau des
  kompletten Ablaufs über echte `Session`/`Scenario`-Objekte: Protokoll
  bleibt unverändert, Meldung bleibt "ack", keine Hupe.

## 0.1.14

- 🐛 **Fix: "Pumpe ausgefallen" (und jede andere laufende Störung) verlor
  ihren Quittierstatus beim Laden eines Spielstands -- der von 0.1.3
  eigentlich schon gelöste Fall, nur an einer Stelle, die 0.1.3 nicht
  erreichte.** Ursache: `ctx.stuckRods`, `ctx.msivStuck`, `ctx.pumpsStuck`,
  `ctx.recircPumpStuck`, `ctx.recircRunback`, `ctx.porvStuck`,
  `ctx.sgLeak`, `ctx.boronRunaway` (alle in `game/events.js` `stepEvents()`)
  leben nur auf `ctx`, nie in `engine.state`, und waren deshalb komplett
  vom Spielstand ausgeschlossen. Nach dem Laden verteidigte `stepEvents()`
  nichts mehr aktiv: die Meldung fiel beim nächsten Bild sofort auf
  "normal" zurück, obwohl sie schon quittiert war und die Ursache
  unverändert weiter anstand -- UND der zugehörige Knopf (z.B. der
  "ausgefallenen" Pumpe) ließ sich wieder anklicken, ganz ohne Wirkung
  aus 0.1.11.
  Alle acht Merker sind jetzt Teil von `persist.js` `pack()`/`apply()`
  (neues, optionales `malfunctions`-Feld) -- geprüft per Nachbau des
  genauen Ablaufs (Pumpenausfall → quittiert → gespeichert → geladen):
  Meldung bleibt "ack", Knopf bleibt gesperrt.

## 0.1.13

- 🔧 **Fix: Reaktivitätsbilanz-Balken beim RBMK stand am Volllast-
  Gleichgewicht schon dauerhaft am Anschlag.** Der feste Vollausschlag
  von 3000 pcm (`reactivityBars()`) traf beim RBMK exakt den Gleichgewichts-
  wert der Xenon-Vergiftung (`xenon_worth_pcm: 3000`) -- der Balken war
  von der ersten Sekunde jedes Laufs an maximal ausgeschlagen, ganz ohne
  Störung, und hätte einen echten Xenon-Brunnen (Nachtschicht-Szenario)
  gar nicht mehr zeigen können. Vollausschlag ist jetzt 50 % über dem
  größten bekannten Einzelwert des jeweiligen Typs (`xenon_worth_pcm`),
  mindestens aber weiterhin 3000 -- betrifft auch DWR/SWR, deren
  Gleichgewichtswerte (2800/2600 pcm) vorher ebenfalls nahe am Anschlag
  lagen, nur nicht ganz so knapp.

## 0.1.12

- 🔧 **Fix: Quittieren/Rückstellen fehlten im vergrößerten Meldetafel-
  Fenster.** Der Kachel-Kopf mit diesen beiden Knöpfen blieb bisher am
  Ursprungsplatz stehen, wenn die Meldetafel per Klick auf den Titel als
  eigenes Fenster geöffnet wurde (`openPanelWindow()`/`closePanelWindow()`
  in main.js verschieben bisher nur `.rs-panel-body`) -- im Fenster selbst
  liess sich dann nichts quittieren oder zurückstellen. Die Knöpfe wandern
  jetzt mit ins Fenster (verschoben, nicht geklont) und zurück beim
  Schließen.

## 0.1.11

- 🐛 **Fix: ausgefallene Pumpe liess sich einfach wieder anklicken --
  keine Meldung, kein Widerstand.** Zwei getrennte Lücken, beide seit
  Einführung von `mcp_trip`/`rcp_trip`/`station_blackout` (lange vor
  dieser Session): der Ereignis-Griff rief nur `pump.trip()` EINMAL auf,
  ohne den Zustand danach zu verteidigen -- derselbe Knopf, der die Pumpe
  im Normalbetrieb auch anschaltet, holte sie sofort wieder zurück. Und
  weil dafür keine eigene Meldetafel-Kachel existierte (anders als bei
  einer klemmenden Stabgruppe oder einem klemmenden Ventil), stand auch
  nirgends, dass überhaupt etwas kaputt ist.
  - `ctx.pumpsStuck`/`ctx.recircPumpStuck` (game/events.js) hält jetzt
    fest, WELCHE Pumpe durch ein Ereignis ausgefallen ist, `stepEvents()`
    hält sie jeden Schritt gestoppt -- auch gegen den Ein-Knopf. Betrifft
    `rcp_trip` (DWR/SWR/RBMK), `mcp_trip` (RBMK) und `station_blackout`
    (SWR) gleichermaßen.
  - Neue RBMK-Meldung "Pumpe ausgefallen" (`mcp_stuck`, Meldetafel-Kachel
    „rcp"), mit eigener Hilfe -- dieselbe Lücke, die `rod_stuck` für
    klemmende Stabgruppen schon lange geschlossen hatte.
  - Betroffene Pumpenknöpfe werden jetzt zusätzlich ausgegraut und
    gesperrt (`pumpStuckList` je Typdatei, `pumpRow()` in controls.js) --
    eine vom SPIELER selbst abgeschaltete Pumpe bleibt dagegen ganz normal
    bedienbar, nur die durch ein Ereignis ausgefallene ist gesperrt.
  - Geprüft: `rbmk_night_shift`, `rbmk_cold_start` (beide nutzen
    `mcp_trip` schon länger) und `bwr_fukushima` (`station_blackout`)
    laufen mit dem Fix unverändert durch, keine Regression.

## 0.1.10

- 🔧 RBMK "Ausfall einer Umwälzpumpengruppe": Schwierigkeit ★★★→★★
  korrigiert. Ein Ereignis, eine durchgehende Aufgabe (Leistung per Hand
  halten), keine ORM-Krise, keine Xenon-Dynamik -- strukturell naeher an
  SWR "Lastfolge über Umwälzstrom" (★★) als an den anderen beiden
  RBMK-Dreisternern (Nachtschicht/Kaltstart: je drei gleichzeitige
  Komplikationen). Die 3 in 0.1.6 war ein Fehlschluss aus "jetzt nicht
  mehr trivial" auf "also drei Sterne".

## 0.1.9

- 🔊 Geigerzähler-Alarmton (`geiger_game_alert.mp3`) ausgetauscht.

## 0.1.8

- ⏪ Revert 0.1.7: `game_attention.mp3`-Tausch zurückgenommen, alter Ton
  wieder da.

## 0.1.7

- 🔊 Meldeton "Dauerlicht/Quittierung" (`game_attention.mp3`) ausgetauscht.

## 0.1.6

- 🔧 **Fix: neues RBMK-Szenario "Ausfall einer Umwälzpumpengruppe" (0.1.5)
  war ohne Wirkung, wenn der Leistungsregler auf Automatik blieb.**
  Nachtest ergab: der automatische Leistungsregler trimmt selbst einen
  Ausfall von 4 der 8 Hauptumwälzpumpen 60 Minuten lang praktisch ohne
  Leistungsabweichung weg -- die Kernaufgabe des Szenarios (positive
  Dampfblasen-Rückkopplung von Hand beherrschen) kam so nie zustande. Das
  Szenario startet jetzt mit dem Leistungsregler auf Hand (Ereignis
  `power_regulator_off` bei t=0, wie im historischen RBMK-Betrieb
  üblich) -- ohne Gegensteuern über die Steuerstäbe läuft die Leistung
  jetzt nachweislich auf "Leistung hoch" zu. Schwierigkeit deshalb auf
  ★★★ angehoben.
- 📝 Außerdem die Einweisung korrigiert: die Behauptung, geringerer
  Durchsatz erhöhe die Kavitationsgefahr an den verbliebenen Pumpen, hält
  der Simulation nicht stand -- die Unterkühlung (`_subcooling()` in
  rbmk.js) steigt hier tatsächlich mit sinkendem Durchsatz, weil das
  Speisewasser einen größeren Anteil der Mischtemperatur im Fallraum
  bestimmt. Ersetzt durch die zutreffende Aussage: höhere Pumpendrehzahl
  gleicht den Durchsatzverlust nur teilweise aus, das eigentliche
  Gegenmittel sind die Steuerstäbe.

## 0.1.5

- 🆕 **Neuntes Szenario: RBMK "Ausfall einer Umwälzpumpengruppe"** (60 min,
  ★★). Volllastbetrieb, nach zehn Minuten fallen zwei der acht
  Hauptumwälzpumpen aus (bestehendes `mcp_trip`-Ereignis, bisher nur als
  Nebenstörung in "Nachtschicht"/"Kaltstart" benutzt, hier erstmals als
  einzige, klar lernbare Aufgabe). Lehrt den positiven Dampfblasen-
  koeffizienten des RBMK aus der Durchsatz-Richtung: weniger Durchsatz →
  mehr Blasen → mehr Reaktivität → mehr Leistung → noch mehr Blasen, dazu
  steigendes Kavitationsrisiko an den verbliebenen Pumpen, wenn man
  versucht, den Ausfall über deren Mehrleistung auszugleichen.
- 📋 Weitere 13 Szenario-Ideen (DWR/SWR-Feedwater- und Pumpenausfälle,
  SG-Rohrbruch, Druckmessungs-Drift, Vakuumverlust, RBMK-Trommelpegel/
  Xenonfalle/Axialverzerrung/Graphitüberhitzung/Stabklemmer, SWR-ATWS)
  nach Machbarkeit sortiert ins BACKLOG.md aufgenommen -- mehrere davon
  (SG-Rohrbruch, Speisewasserverlust, DWR-Pumpenausfall) nutzen bereits
  vollständig implementierte, aber noch nie in einem Szenario verpackte
  Ereignisse (`sg_tube_leak`, `feedwater_loss`, `rcp_trip`).

## 0.1.4

- 📝 **Szenario-Einweisungen nach technischem Gegencheck geschärft.**
  - DWR Lastfolge: "Reaktivität dann nur noch über Borsäure" überstellt --
    eine klemmende Stabgruppe macht nicht die gesamte übrige Stabregelung
    unbrauchbar. Jetzt: "weitere Reaktivitätsführung muss überwiegend über
    Borierung/Deborierung erfolgen".
  - DWR Turbinenschnellschluss & SWR Frischdampf-Absperrung: Text macht
    jetzt explizit, dass eine reale Anlage hier automatisch schnell-
    abschalten würde, dieses Spiel die Entscheidung aber bewusst dem
    Spieler überlässt (Design gilt durchgängig im ganzen Spiel, siehe
    bereits bestehender Hinweis bei der SWR-Dichtewellen-Instabilität) --
    keine neue Auto-RESA-Logik, nur ehrliche Einweisung.
  - SWR Dichtewellen-Instabilität: der Umwälzstrom-Abfall (`recirc_runback`)
    lief bisher als Sollwert-Sprung, den die Pumpe in ~6s nachfährt --
    jetzt ein echter, schleichender Abfall über 5 Minuten (`over_s` im
    Ereignis, siehe events.js), das gibt mehr Zeit, die gefährliche
    Kombination aus hoher Leistung und niedrigem Durchsatz selbst
    herbeizuführen oder rechtzeitig gegenzusteuern. `bwr_flow_control.json`
    (dieselbe Ereignis-ID, geplante Lastführung statt Defekt) bleibt beim
    sofortigen Sollwert -- eigener Test dafür in test-bwr.mjs.

## 0.1.3

- 🔧 **Fix: Spielstand vergaß Quittierstatus und Ereignisprotokoll.**
  Beides lag ausserhalb von `engine.state` (Meldetafel-Quittierung in
  `engine.trips`, das Protokoll nur als `<li>`-Knoten im DOM) und landete
  nie im Speicherstand. Nach dem Laden blinkte/hupte jede vorher schon
  quittierte, aber weiterhin anstehende Meldung sofort wieder auf, und
  das Log-Panel startete leer, egal wie lange vorher gespielt wurde.
  - `TripSystem` bekommt `snapshot()`/`restore()` (sim/trips.js) --
    Quittierstatus je Kachel ist jetzt Teil des Spielstands.
  - Ein rollendes Protokoll-Gedächtnis (`ctx.history`, gedeckelt auf 120
    wie die Anzeige selbst) läuft unabhängig vom DOM mit und wird beim
    Laden einmalig ins Log-Panel nachgetragen.
  - Beides optional wie die bisherigen Zusatzfelder: ein alter
    Spielstand ohne sie lädt weiterhin normal, nur eben ohne diese zwei
    Extras (wie bisher).

## 0.1.2

- 🔧 **Fix: Ausklapp-Pfeil bei den Spielstand-Karten hing am linken
  Kartenrand statt am Text.** `list-style-position` bezieht sich beim
  nativen Dreieck-Marker auf die Randbox des GANZEN Listenelements, nicht
  auf den Textanfang -- bei einer ganzen Kartenbreite sass der Pfeil damit
  sichtbar losgeloest links, weit vom Wort "Spielstände" entfernt. Jetzt
  ein eigenes Dreieck per `::before` in einer Flexbox mit dem Text
  zusammen, dreht sich beim Aufklappen.

## 0.1.1

- 💾 **Zehn feste Handspeicherplätze je Reaktortyp.** Der Speichern-Knopf
  (und Strg+S) öffnet jetzt einen Auswahldialog mit allen zehn Plätzen
  dieses Reaktortyps -- belegt (mit Datum/Uhrzeit/Szenario) oder frei --
  statt stillschweigend einen einzigen, an Reaktor+Szenario gekoppelten
  Slot zu überschreiben. Ein neu ausprobiertes Szenario legt keinen
  elften Platz mehr an; der Spieler entscheidet selbst, welchen der
  zehn er überschreibt. Löschen geht direkt im Dialog.
  Die Autospeicherung bleibt unverändert (ein Slot je Reaktor+Szenario,
  läuft alle 60s im Hintergrund weiter).
- Die Spielstände unter jeder Reaktor-Karte sind jetzt **ausklappbar**
  (`<details>`, collapsed per Default, Zusammenfassung zeigt nur die
  Anzahl) -- bei bis zu zehn Handplätzen plus Autospeicherung wäre die
  Karte sonst schnell voller Text als Inhalt. Neuester Stand zuerst.
- 🔧 Serverseitiges Limit für Spielstände je Konto von 20 auf 60 Plätze
  angehoben -- 30 Handplätze (10 × 3 Reaktortypen) allein sprengten das
  alte Limit schon, bevor überhaupt eine Autospeicherung dazukam.

## 0.1.0

- 🔧 **Fix: Mouseover-Umsetzung aus 0.0.99 war falsch.** Namen erschienen
  wieder an einer festen Stelle im SVG statt neben dem Mauszeiger, UND die
  Messwerte (Temperatur, Druck, Prozent, MW) waren bis zum Hover unsichtbar
  -- fuer eine Leitwarte inakzeptabel, die Zahlen muessen ohne Maus
  durchgehend ablesbar sein. Jetzt: Messwerte sind wieder IMMER sichtbar
  wie vor 0.0.99, nur der Bauteilname (Reaktor, Pumpe, Druckhalter, …)
  kommt als echtes Tooltip direkt neben dem Mauszeiger (klappt am rechten/
  unteren Fensterrand automatisch auf die andere Seite um) -- damit kann
  ein Name nie mehr mit irgendetwas kollidieren, ganz gleich wo er
  auftaucht.

## 0.0.99

- 🖼️ **Fließbild-Beschriftungen grundlegend umgebaut: Name und Messwert nur
  noch per Mouseover statt dauerhaft im Bild.** Bei drei eng gepackten
  Fließbildern (DWR/SWR/RBMK) liefen sich dauerhaft eingeblendete Texte
  zuverlaessig gegenseitig ins Gehege, ganz gleich wie sorgfaeltig jede
  einzelne Position von Hand justiert wurde -- das ließ sich mit fixen
  Koordinaten nicht mehr zufriedenstellend loesen. Jetzt liegt Name und
  Messwert jedes Bauteils (Reaktor, Druckhalter, Dampferzeuger/
  Trommelabscheider, Pumpen, Ventile, Generator, Kondensator, …)
  unsichtbar bereit und erscheint erst, wenn die Maus darueber steht --
  damit kann nie mehr als eine Beschriftung gleichzeitig sichtbar sein,
  Ueberlagerung ist strukturell ausgeschlossen statt nur wegjustiert.
  Betrifft alle drei Reaktortypen gleichermaßen.
- 🔧 **Fix: Reaktorkarten auf dem Startbildschirm unterschiedlich groß.**
  Seit den Spielstaenden je Karte (0.0.95) war `.rs-card` kein direktes
  Grid-Kind von `.rs-start-cards` mehr und sackte auf seine eigene
  Inhaltshoehe zusammen -- DWR/SWR/RBMK sahen sichtbar unterschiedlich groß
  aus. Per CSS-Subgrid teilen sich alle drei Karten jetzt wieder dieselbe
  Zeilenhoehe, ganz gleich wie lang Beschreibung oder Spielstandsliste sind.

## 0.0.98

- 🖼️ **RBMK-Fließbild: Speisewasserpumpe ergänzt, Kern klarer beschriftet.**
  Rückmeldung zum Schaubild: dieselbe fehlende Speisewasserpumpe wie bei
  DWR (0.0.96) und SWR (0.0.97) -- zwischen Kondensator und Trommel-
  abscheider fehlte sie, das Kondensat floss im Bild scheinbar von allein
  zurück.
  "Druckröhren" heißt jetzt "Reaktorkern" (EN: "Reactor core" statt
  "Pressure tubes") -- der Block ist eben nicht nur die Rohre, sondern der
  ganze Graphitmoderator mit den Druckröhren darin.

## 0.0.97

- 🖼️ **SWR-Fließbild: Speisewasserpumpe ergänzt, Behälter umbenannt.**
  Rückmeldung zum Schaubild: dieselbe fehlende Speisewasserpumpe wie beim
  DWR (0.0.96) -- zwischen Kondensator und Reaktordruckbehälter fehlte
  sie, das Kondensat floss im Bild scheinbar von allein zurück. Zeigt
  jetzt zusätzlich "tripped" (rot), wenn kein Wechselstrom anliegt (siehe
  `s.acPower`) -- dann stehen die Speisewasserpumpen wirklich still, nicht
  nur ein zugedrehtes Ventil.
  "Druckbehälter" heißt jetzt "Reaktordruckbehälter" (EN: "Reactor
  vessel" statt "Vessel") -- war zu allgemein für das zentrale Bauteil, in
  dem beim SWR das Wasser tatsächlich siedet.

## 0.0.96

- 🖼️ **DWR-Fließbild: Speisewasserpumpe ergänzt, Primär-/Sekundärseite im
  Dampferzeuger sichtbar getrennt.** Rückmeldung zum Schaubild: zwischen
  Kondensator und Dampferzeuger fehlte die Speisewasserpumpe -- das Wasser
  floss im Bild scheinbar von allein bergauf. Sitzt jetzt an der Ecke der
  Speisewasserleitung, dreht sich mit dem tatsächlichen Speisewasserfluss.
  Der Dampferzeuger zeigt zusätzlich eine Trennlinie zwischen Primärseite
  (Rohrbündel, links) und Sekundärseite (Füllstand, rechts) -- beide Wasser
  laufen im Bild jetzt sichtbar getrennt, nie vermischt.

## 0.0.95

- 💾 **Spielstände hängen jetzt an ihrer eigenen Reaktor-Karte.** Bisher
  stand ein Eintrag je Reaktortyp in EINER gemeinsamen Liste unten auf dem
  Startbildschirm; ein RBMK-Stand sah dort aus, als könnte er zwischen
  DWR/SWR untergehen. Jeder Stand erscheint jetzt direkt unter seiner
  eigenen Karte (DWR/SWR/RBMK) und bleibt dort sichtbar, ganz unabhängig
  davon, welche Karte man gerade anklickt -- nichts geht verloren, nur
  anders sortiert.

## 0.0.94

- 🔇 **Fix: Ton-Hauptschalter (Mute) liess zwei Klaenge stumm ungeschaltet
  durch.** Der Schalter-Klick bei jeder Bedienung (Staebe, Automatik/Hand,
  Pumpen -- controls.js) und der Geigerzaehler-Alarm riefen `playClip()`
  direkt auf, ohne je den Mute-Zustand zu pruefen -- anders als Hupe,
  Musik und Stabfahrgeraeusch, die schon vorher ihr eigenes `enabled`
  hatten. `playClip()` hat jetzt selbst einen Hauptschalter
  (`setMuted()`, gesetzt in derselben Stelle wie alle anderen
  Ton-Einstellungen), der Mute-Knopf schaltet jetzt wirklich alles ab.

## 0.0.93

- 🐛 **Fix: Hintergrundbilder aus 0.0.92 unsichtbar.** Kamen als
  Inline-Style (`style="--rs-splash-bg: url(...)"`) aus dem Template --
  die serverseitige CSP (`style-src 'self' <nonce>`, kein `unsafe-inline`)
  blockt jedes `style="..."`-Attribut ohne Nonce, der Browser hat die
  Regel also stillschweigend verworfen. Jetzt liegt der Bildpfad fest in
  `base.css` (`url("/static/img/...")`), das faellt unter `img-src`, nicht
  `style-src`.

## 0.0.92

- 🖼️ **Startbanner und Reaktorauswahl bekommen Hintergrundbilder.** Splash
  zeigt jetzt `splash.png` als Foto-Hintergrund, die Reaktorauswahl
  `background.png` -- beide mit dunklem Schleier drueber, damit Text und
  Karten lesbar bleiben.
- Das Logo auf dem Splash erscheint nicht mehr sofort, sondern blendet erst
  5s nach dem Laden langsam ein. Ein Klick auf den Splash VOR Ablauf der 5s
  ueberspringt nur diese Wartezeit; danach blendet ein Klick wie gehabt das
  ganze Banner aus.
- Der Hinweistext "zum Start klicken" ist bis dahin unsichtbar und blinkt
  erst zusammen mit dem Logo ROT auf, statt wie bisher die ganze Zeit leise
  zu pulsieren.

## 0.0.91

- 🔧 **Wertungsformel grundlegend umgebaut.** `violation_seconds`
  (Sekunden mit aktiver Meldetafel-Kachel, nach Schwere) ging bisher
  UNGEDECKELT und linear in den Punktestand ein -- eine vier Stunden lang
  sauber gefahrene Schicht mit einer einzigen harmlosen Dauerwarnung (z.B.
  Graphittemperatur knapp über dem Normalband) sammelte mehr Minus als ein
  kurzer Lauf, der in einer echten Katastrophe endete. Ergebnis in einem
  realen Fall: Schicht vollständig gefahren, Energieziel erfüllt, kein
  SCRAM, kein Kernschaden -- trotzdem **-2497 Punkte**, ohne jede Anzeige,
  woher das kommt.
  - Jede Schwere (INFO/WARN/TRIP) zählt jetzt als **Anteil der tatsächlich
    gespielten Schichtdauer**, gedeckelt bei -100/-300/-1000 Punkten --
    eine Warnung, die 25 % der Schicht ansteht, kostet unabhängig davon,
    ob die Schicht eine oder vier Stunden dauerte, denselben Betrag.
  - Neue Bodenregel: eine erfolgreich abgeschlossene, katastrophenfreie
    Schicht (kein Kernschaden, kein Sicherheitsbehälterversagen, keine
    Wasserstoffexplosion) fällt nie unter 0 Punkte, ganz ohne SCRAM sogar
    nie unter 500.
  - SWR-Sicherheitsbehälterversagen und Wasserstoffexplosion
    (`plants/bwr.js`) setzten bisher nie `fuel_damage` und kosteten dadurch
    nur die bis dahin aufgelaufenen `violation_seconds` -- jetzt eigene,
    additive Katastrophenstrafen (-2500/-3000), die auch bei formal zu
    Ende gelaufenem Schicht-Timer NIE durch die Bodenregel aufgehoben
    werden.
  - Gemeinsame Rundungsfunktion (`_round_score`/`roundScore`, "weg von
    Null") in `scoring.py`/`scoring.js` ersetzt `round()`/`Math.round()`:
    beide runden exakte `.5`-Werte unterschiedlich (Python zur geraden
    Zahl, JavaScript immer aufwärts) -- bei Fließkomma-Zwischenwerten ein
    echtes Risiko, dass Server- und Client-Score auseinanderlaufen.
  - `parts` (die Zerlegung des Scores) ist jetzt vollständig: jeder
    Faktor eigens aufgeschlüsselt, inklusive `rounding_adjustment` und
    `floor_adjustment` -- die Summe aller Teile ergibt IMMER exakt den
    Score, nicht nur ungefähr.
- ✨ **Auswertung zeigt jetzt, woher jeder Punkt kommt.** Vollständige
  Score-Zerlegung (Mission, Energie, Abweichung, Alarme, Bonus, SCRAM,
  Kernschaden, Sicherheitsbehälterversagen, Wasserstoffexplosion,
  Mindestwertung), dazu ein neuer Abschnitt "Grenzwertüberschreitungen"
  (Zeit UND Punktewirkung je Schwere) und "Hauptursachen" (welche
  Meldetafel-Kachel wie lange stand, bis zu drei). Ursachen-Daten
  (`result.causes`) liegen bewusst NEBEN der Zusammenfassung, nicht darin
  -- sie gehen nie zum Server, nur die Wertungs-Kennzahlen selbst.
  Aus einer Rücksprache mit einer zweiten KI über mehrere Runden entstanden
  (Formel, Bodenregel-Lücken, Rundungsfehler -- Details im Verlauf).

## 0.0.90

- ✨ **Rundinstrumente klickbar: eigene Hilfe je Messwert.** Alle 10
  Rundinstrumente (Kern/Primär-/Sekundärkreis) lassen sich jetzt anklicken
  (oder per Tastatur: Tab, dann Enter/Leertaste) -- genau wie eine
  Meldetafel-Kachel öffnet das dasselbe Hilfefenster, mit konkreter
  Zu-niedrig-/Zu-hoch-Anleitung statt bloßer Definition. Neue Schlüssel
  `gauge_<name>_help` (DE+EN), Nutzer-Text.
- 🛠️ **Hilfefenster kann jetzt Absätze, Zwischenüberschriften und Fettschrift.**
  `renderHelpText()` (panels.js) ist eine winzige selbstgeschriebene
  Markdown-Teilmenge (Leerzeile = Absatz, `### ` = Zwischenüberschrift,
  `**..**` = fett), baut echte DOM-Knoten statt eines HTML-Strings -- kein
  Escaping nötig. Betrifft auch die Meldetafel-Hilfe (dieselbe Funktion),
  bestehende Texte ohne diese Zeichen sehen unverändert aus.
- Verifiziert per Playwright gegen den laufenden Server: Klick UND Tastatur
  getestet (DWR Primärdruck, RBMK/DWR-Verzweigung im Text korrekt
  dargestellt), SWR-spezifisches Containment-Instrument ebenfalls verdrahtet.
  Volle Testsuite 71/71 grün, inklusive
  `test_help_texts_only_name_controls_that_exist` für die neuen Schlüssel.

## 0.0.89

- 🗑️ **Geigerzähler-Ticken entfernt.** Reiner WebAudio-Synthesizer
  (gefiltertes Rauschen, `ui/geiger.js`), keine echte Aufnahme -- unnoetig
  neben der Musik (`game_background_1.mp3`, echte Aufnahme, laeuft bereits
  ueber denselben Musik-Schalter). Datei geloescht, Einstellung
  "Geigerzähler-Ticken" raus, `Geiger`-Klasse aus `main.js`/`panels.js`
  entfernt. Die akustische Ereignis-Vorwarnung (`geiger_game_alert.mp3`,
  eine echte Aufnahme trotz des Dateinamens) bleibt unveraendert -- ein
  eigenstaendiger Klang, keine Ticken-Synthese.

## 0.0.88

- ✨ **Thermische Nennleistung auf dem Startbildschirm.** Die Reaktorkarten
  zeigten bisher nur die elektrische Leistung (z.B. "1400 MWe"). Jetzt steht
  die thermische Leistung davor ("3850 MWth · 1400 MWe · ...") -- DWR 3850,
  SWR 3840, RBMK 3200 MWth (Wirkungsgrad 31-36 %, je Typ verschieden).

## 0.0.87

- ✍️ **Alle 35 Meldetafel-Hilfetexte (DE+EN) neu geschrieben** -- Nutzer-
  Ueberarbeitung, klarere Sprache, durchgehend "Konkret tun" / "Actions"
  statt uneinheitlicher Formulierungen. In der englischen Fassung dabei alle
  in Anfuehrungszeichen genannten Bedienelemente von den deutschen
  Original-Bezeichnungen auf die tatsaechlichen englischen UI-Beschriftungen
  umgestellt (98 Stellen, automatisch anhand von locales/en.json abgeglichen)
  und zwei falsch benannte Querverweise korrigiert ("Pressure low",
  "Dome pressure high"). test_help_texts_only_name_controls_that_exist
  (tests/test_locales.py) prueft das jetzt wieder gruen fuer beide Sprachen.

## 0.0.86

- ✨ **Therm. Leistung auch als MW-Wert waehlbar.** Die Kopfzeile zeigte
  Thermische Leistung bisher nur in Prozent der Nennleistung. Neuer Eintrag
  "Therm. Leistung (MW)" im Einstellungen-Dialog (Zahnrad) -- zusaetzlich zum
  Prozentwert waehlbar, nicht als Ersatz dafuer, und wie jede Kopfzeilen-
  Auswahl je Reaktortyp getrennt gespeichert.

## 0.0.85

- 🐛 **Fluss-Animation im Fließbild auf hellen Dampfrohren praktisch
  unsichtbar (0.0.84 reichte nicht).** Die helle gestrichelte Linie
  (`--rs-flow`, hellblau) lag bei hohem Druck auf einem Dampfrohr, das durch
  `--rs-steam-l` selbst schon fast weiß eingefärbt ist -- beide Töne lagen zu
  nah beieinander, die Animation war zwar aktiv (Screenshot-Diagnose zeigte
  die korrekte Opazität), aber am Bildschirm nicht zu erkennen. Jetzt liegt
  unter der hellen Linie eine dunkle Kontur (`rs-flow-halo`, gleicher
  Rhythmus, gleiches `--rs-w`), die auf jedem Rohrton sichtbar bleibt, dazu
  eine kräftigere Flussfarbe (`#22d3ee` statt `#a9e7ff`). Per Playwright
  gegen den laufenden Server verifiziert (RBMK, Regelventil 11 %, genau der
  vom Nutzer gemeldete Fall).

## 0.0.84

- ✨ **Regelventil und Umleitung im Fließbild: Zustand jetzt klar erkennbar.**
  Bisher unterschied sich "offen" (dunkles Grün) kaum von "zu" (dunkles Grau)
  -- bei kleiner, aber echter Öffnung sah ein Ventil aus wie geschlossen.
  "run" ist jetzt deutlich heller und dicker umrandet, "stopped" bewusst matt
  (`mimic.css`).
- ✨ **Prozentzahl direkt am Ventilsymbol.** Regelventil und Umleitung zeigen
  jetzt ihre Stellung ("73 %" usw.) im Fließbild selbst, nicht nur als Farbe
  -- bei allen drei Reaktortypen (`valve()` in `mimic.js`, optionaler
  `pctId`-Parameter).
- ✨ **Fluss-Animation bleibt bei kleinem, aber echtem Durchsatz sichtbar.**
  Ihre Opazität hing bisher direkt am Durchsatz-Anteil -- bei einem fast
  geschlossenen Regelventil war sie praktisch bei 0 und die Anlage sah aus,
  als fördere sie hinter dem Reaktor gar nichts mehr. Ein Sockelwert
  (`flowVis()`) sorgt jetzt dafür, dass jeder echte Fluss sichtbar bleibt;
  nur ein wirklich geschlossenes Ventil zeigt weiterhin keine Animation.

## 0.0.83

- ✨ **Mehrbenutzerbetrieb: weitere Konten über `REACTORSIM_USERS`.** Bisher
  gab es genau ein Konto (`REACTORSIM_USER`/`REACTORSIM_PASSWORD`). Jetzt
  lassen sich beliebig viele weitere als `name:passwort,name2:passwort2`
  eintragen -- jedes ein vollwertiges Konto mit eigenem Passwort.
- 🔐 **Spielstände, Einstellungen und Bestenlisten-Ratenbegrenzung gehören
  jetzt dem Konto, nicht mehr dem Browser.** Bisher hing das alles an einem
  anonymen Cookie (`rs_player`) -- ein anderer Browser oder ein gelöschter
  Cookie hieß: alte Spielstände sind weg. Jetzt liegt der Schlüssel im
  angemeldeten Konto selbst (`persist.Store.account_key`, ein fester Hash aus
  dem Benutzernamen), unabhängig vom Gerät. Beim ersten Login nach diesem
  Update wird ein noch vorhandener alter `rs_player`-Spielstand einmalig ins
  Konto übernommen.
- 🔒 **Ein Konto, eine Sitzung.** Meldet sich ein Konto auf einem zweiten
  Gerät an, wird die Sitzung des ersten sofort ungültig (eigene
  Sitzungskennung je Konto in `sessions.json`, nicht nur die Signatur des
  Cookies) -- dasselbe Konto kann nicht mehr gleichzeitig auf zwei Geräten
  weiterlaufen. Abmelden entwertet die Sitzung ebenfalls serverseitig, nicht
  nur das lokale Cookie.

## 0.0.82

- ✨ **Bestätigungston beim Quittieren.** 0.0.81 stellte sicher, dass der
  Dauerton (`game_attention.mp3`) nach der Sirene ankommt -- quittiert der
  Bediener aber VORHER, kam er nie zu Gehör, weil `silence()` beide Töne
  sofort abstellt. Klick auf "Quittieren" spielt ihn jetzt einmal komplett
  als eigenständigen Klang ab (`Horn.ack()`, `playClip()` -- kein Loop, kein
  Zustand, unabhängig von Sirene/Dauerton), nur wenn gerade wirklich eine
  Meldung anstand.

## 0.0.81

- 🐛 **Hupen-Fehler wirklich gefunden (Diagnose-Logs aus 0.0.79 haben ihn
  gezeigt): `TripSystem.horn` lief nur bei Kachelzustand 'new', nicht bei
  'clear'.** Eine Störung, die von selbst wieder verschwindet, BEVOR jemand
  quittiert, wechselt nach `hold_s` von 'new' zu 'clear' (langsames Blinken,
  siehe ISA-18.2-Folge im Dateikopf `sim/trips.js`) -- die Kachel bleibt
  dabei unquittiert, aber die Hupe verstummte trotzdem sofort. Die Sirene
  (0.0.74: einmal durch, dann Dauerton bis zum Quittieren) wurde dadurch
  oft mitten im Ton abgewürgt, lange bevor sie fertig war -- der Dauerton
  kam praktisch nie an, weil die meisten Störungen kürzer stehen als die
  Sirene selbst läuft. 0.0.77/0.0.78 haben an der Symptomstelle
  (Sirene→Dauerton-Übergabe) gesucht, der Fehler lag eine Ebene tiefer.
  `horn` läuft jetzt für 'new' UND 'clear' -- verstummt erst durch echtes
  Quittieren.
  Temporäre Diagnose-Logs (0.0.79) wieder entfernt, 5 neue Tests
  (`tests/test-trips.mjs`) sichern das Verhalten gegen Wiederauftreten ab
  -- schlagen nachweislich fehl auf dem alten Stand, grün auf diesem.
  Volle Suite: 65 Python + 98 JS, alle grün.

## 0.0.80

- 🐛 **Speichern-Knopf und Autospeicherung teilten sich einen Slot.**
  `saveCurrentGame()` schrieb für beide in denselben `"auto-<typ>-<szenario>"`
  -- die naechste automatische Sicherung (alle 60s) überschrieb einen gerade
  von Hand gesicherten Stand kommentarlos mit dem inzwischen weitergelaufenen
  Zustand. Eigener Slot jetzt: Autospeicherung bleibt `"auto-..."`, der
  Speichern-Knopf (Klick UND Strg+S) schreibt nach `"manual-..."`
  (`saveSlotName()`, `main.js`). Beide stehen als eigene Zeilen in der
  Fortsetzen-Liste, an der Beschriftung unterscheidbar
  (`btn_resume_named_manual`).

## 0.0.79

- 🔧 **Temporäre Diagnose-Logs für den Dauerton-Fehler.** 0.0.78 hat das
  Problem nicht behoben (immer noch stumm nach der Sirene). Statt einer
  weiteren Vermutung: `console.log`/`console.error` in `Horn.alarm()` und
  `MusicLoop.start()` (`ui/annunciator.js`, `ui/music.js`), klar als
  "TEMPORAERE DIAGNOSE" markiert -- zeigen bei jedem Poll den Zustand beider
  `<audio>`-Elemente (paused/ended/currentTime/readyState/error). Fliegen
  wieder raus, sobald die Konsolenausgabe den echten Fehler zeigt.

## 0.0.78

- 🐛 **Meldehupe: Dauerton kam wirklich nie, jetzt gefunden.** 0.0.77s Fix
  (Abfrage statt Ereignis) traf nicht die Ursache. Der eigentliche Fehler:
  `Horn.unlock()` spielte testweise auch den Dauerton (`game_attention.mp3`)
  einmal an, um ihn fuer Autoplay freizuschalten -- und `unlock()` haengt am
  Ack- UND am SCRAM-Knopf, also genau den Knoepfen, auf die ein Spieler
  klickt, WAEHREND eine Meldung laeuft. `audio.play()` setzt `paused` sofort
  synchron auf false, noch bevor die zurückgegebene Promise sich auflöst --
  fiel dieser Klick mit dem Moment zusammen, in dem `alarm()` nach
  Sirenenende den Dauerton ECHT starten wollte, sah `MusicLoop.start()`
  "läuft schon" und tat nichts; `unlock()`s eigenes `.then(stop())` legte ihn
  gleich darauf wieder still. Kein Fehler in der Konsole, weil beide
  `play()`-Aufrufe technisch erfolgreich waren -- reines Zeitfenster-Problem.
  `unlock()` schaltet jetzt nur noch die Sirene frei; der Dauerton braucht
  das nicht, er startet ohnehin nur aus `alarm()` heraus, genau wie die
  Sirene selbst auch nie eigens freigeschaltet werden musste.

## 0.0.77

- ✨ **Steuerstab-Anzeige im Anlagenfließbild** (`ui/mimic.js`). Bisher zeigte
  keiner der drei Typen, wo die Stäbe stehen -- jetzt je zwei Linien im
  Kernkasten (Regel- und Abschaltgruppe), Spitze folgt `s.rod[i]`. Fahrrichtung
  typgerecht: DWR/RBMK von oben, SWR von unten (siehe Dateikopf `plants/bwr.js`).
  Blinkt kurz auf, wenn sich die Stellung ändert (`rs-mimic-blink`
  wiederverwendet) -- macht nebenbei eine klemmende Gruppe (`alarm_rod_stuck`)
  im Bild sichtbar: die klemmende Linie bewegt sich nicht mit, die andere
  schon.
- 🐛 **Meldehupe: Dauerton nach der Sirene kam nie.** Die zweistufige Hupe aus
  0.0.74 (Sirene einmal, danach `game_attention.mp3` bis zum Quittieren)
  hing am `ended`-Ereignis der Sirene, um umzuschalten -- kam bei einem
  Spieler nie an, vermutlich eine Eigenheit der Aufnahme oder des Browsers
  beim Ereignis selbst. `Horn.alarm()` fragt jetzt `this._siren.audio.ended`
  direkt ab, statt auf das Ereignis zu warten -- robuster, weil `alarm()`
  ohnehin einmal je Sekunde aus dem Renderlauf gerufen wird (siehe
  `panels.js` `hornNext`), eine Abfrage dort braucht keine korrekt
  verdrahtete Einmal-Registrierung.

## 0.0.76

- ✨ **Serverseitige Nachrechnung statt reiner Plausibilitätsprüfung**
  (Backlog "Serverseitige Nachrechnung statt Plausibilitätsprüfung").
  Bisher prüfte `scoring.validate_summary()` nur, ob gemeldete Kennzahlen aus
  *irgendeinem* Lauf stammen könnten -- jetzt rechnet der Server den Lauf,
  wenn möglich, selbst nach und ersetzt die gemeldeten Kennzahlen komplett
  durch das Ergebnis.
  - `game/recorder.js`: zeichnet jede Bedienhandlung mit der Anzahl der
    bisherigen Rechenschritte auf (fester Zeitschritt, kein Echtzeitstempel
    nötig). `attachRecorder(engine)` haengt sich einmal an `engine.step()`.
  - `game/coreActions.js`: die Handlungen, die jeder Reaktortyp hat (Stäbe,
    Pumpen, Lastanforderung, Turbinenregler/Speisewasser, SCRAM, Quittieren,
    Rückstellen, Turbine zuschalten) -- eine Funktion je Handlung, DOM-frei,
    deshalb im Browser UND unter Node importierbar.
  - `game/replayKit.js`: tauscht den Kit, den `hooks.uiControls()` bekommt
    (siehe Dateikopf `plants/pwr.js`) -- `recordingKit()` zeichnet auf UND
    baut echte Bedienelemente (Browser), `captureKit()` baut keine
    Oberfläche und sammelt nur die Mutations-Funktionen (Server). Die
    typspezifische Bedienung (Borsäure, Frischdampf-Absperrung, ...) steht
    dadurch weiterhin nur einmal in der jeweiligen Typdatei.
  - `game/replay.js`: baut dieselbe Engine, spielt das Protokoll durch
    dieselbe `Session`/`RunState`-Maschine (unveränderter Wortlaut der
    Wertung) noch einmal durch, liefert dieselbe Form wie
    `RunState.summary()`. `verify_run.mjs` (neu, Repo-Wurzel) ist die dünne
    Kommandozeilenhülle darum, die `app.py` per Subprocess unter Node
    aufruft.
  - `ui/panels.js`/`main.js`: jede Bedienhandlung läuft jetzt über
    `record()`/`recordingKit()` statt die Engine direkt anzufassen --
    dieselbe Wirkung, nur mit Aufzeichnung nebenbei.
  - Ein geladener Spielstand (main.js `loadGame()`) verwirft das Protokoll
    (`engine.recorder = null`): ein Sprung auf einen gespeicherten Zustand
    lässt sich nicht aus Schritten plus Protokoll nachrechnen. Solche Läufe
    fallen weiterhin auf die reine Plausibilitätsprüfung zurück, wie bisher.
  - `Dockerfile`: `nodejs` ergänzt, `verify_run.mjs` wird mit ins Image
    kopiert.
  - 3 neue JS-Tests (`tests/test-replay.mjs`, beweisen Bitgleichheit
    zwischen Live-Lauf und Nachrechnung) und 2 neue Python-Tests
    (`tests/test_api.py`, End-zu-End über den echten Node-Subprozess).
    Volle Suite: 65 Python + 93 JS, alle grün.
  - Bekannte Grenze, bewusst nicht in diesem Schritt gelöst: ein sehr langer
    Lauf mit vielen Schieber-Bewegungen kann das 256-KB-Anfragelimit
    (`MAX_CONTENT_LENGTH`) erreichen -- die Übermittlung schlägt dann fehl,
    genau wie jeder andere API-Fehler auch (keine Sonderbehandlung nötig,
    aber auch keine besonders freundliche Meldung dafür).
  - Rest von Backlog-Punkt 2 ("Wiedergabe eines Laufs") bleibt offen -- siehe
    BACKLOG.md, jetzt mit den hier gelegten Bausteinen.

## 0.0.75

- ✨ **Acht Tastenkürzel öffnen ein Panel als Fenster** (nur Desktop, wie ein
  Klick auf die Panel-Kopfzeile): `R` Reaktorkern, `P` Primärkreis,
  `S` Sekundärkreis, `G` Generator und Netz, `A` Anlagenfließbild,
  `V` Trendschreiber, `M` Meldetafel, `C` Reaktorchemie
  (`PANEL_KEYS` in `main.js`). Reagieren nur ohne Strg/Alt/Cmd, damit sie
  sich nicht mit `Strg+M` (Ton stumm) & Co. beißen.

## 0.0.74

- ✨ **Vier neue Tastenkürzel** (`ui/shortcuts.js`, `main.js`):
  - `Strg+S` speichert sofort, dieselbe Stelle wie der Speichern-Knopf.
  - `Strg+X` zeigt eine Abfrage ("Zum Hauptmenü?") und verlässt danach die
    Schicht -- der Menü-Knopf selbst fragt weiterhin nicht nach, ein
    Tastendruck kann aber aus Versehen kommen.
  - `Strg+Z` **gehalten** (eine volle Sekunde) löst die Schnellabschaltung
    aus -- der Knopf blinkt währenddessen über dasselbe `data-armed`, das
    auch der Zwei-Klick-Knopf benutzt. Loslassen vor Ablauf bricht ab, ganz
    ohne Auslösung.
  - `Strg+M` schaltet den Ton stumm/an, dieselbe Stelle wie die beiden
    Lautsprecher-Knöpfe (Startbildschirm, Kopfzeile).
- ✨ **Meldehupe zweistufig statt Dauersirene.** Bisher lief `alarm_sirene.mp3`
  in Dauerschleife, solange eine Meldung unquittiert war -- als nervig
  empfunden. Jetzt läuft die Sirene EINMAL durch, danach übernimmt ein neuer
  Dauerton (`game_attention.mp3`) bis zum Quittieren (`Horn` in
  `annunciator.js`).

## 0.0.73

- ✍️ **Alle 9 Szenario-Einweisungen überarbeitet** (`scn_*_brief` in
  `locales/de.json` und `locales/en.json`), Wortlaut vom Nutzer geliefert.
  Nur die Fließtexte geändert, Titel (`scn_*_title`) unangetastet. Beim
  Einpflegen der englischen Fassung mussten die in Anführungszeichen
  genannten Bedienelemente noch auf die tatsächlichen englischen
  UI-Beschriftungen umgestellt werden (z. B. „Blockventil“ → "Block valve",
  „Steuerstäbe → Ziehen“ → "Control rods → Withdraw") -- sonst hätte
  `test_help_texts_only_name_controls_that_exist` (läuft auch auf
  `_brief`-Schlüsseln) fehlgeschlagen, weil die deutschen Namen im
  englischen Sprachpaket nirgends existieren.

## 0.0.72

- 🐛 **Lange Einweisung ohne Scrollbalken -- Knöpfe unerreichbar.** Betraf
  vor allem die RBMK-Kaltstart-Einweisung ("Kaltstart nach Revision"): der
  Text ist der längste aller Einweisungen, aber `#rs-brief` fehlte die
  `rs-modal-wide`-Klasse (Höhendeckel + `overflow-y: auto`), die Glossar,
  Alarmhilfe & Co. längst haben. Der Dialog lief einfach über den sichtbaren
  Bildschirm hinaus, ohne jede Möglichkeit zu scrollen -- "Los"/"Zurück"
  standen unten drunter, nicht anklickbar.

## 0.0.71

- ✨ **Automatischer Helfer bei Meldungen** (`game/helper.js`), optional,
  Standard AN (Häkchen im Startbildschirm, "Automatische Störungshilfe").
  Ein Klick auf eine Meldetafel-Kachel öffnet wie bisher die Hilfe -- jetzt
  mit einem zusätzlichen Knopf "Problem beheben", der Bedienhandlungen aus
  dem "Konkret tun"-Text selbst ausführt: Blockventil zu, ausgefallene Pumpe
  zuschalten, Regler auf Automatik, Turbine wieder zuschalten, je nachdem was
  die Meldung verlangt. Jede ausgeführte Handlung erscheint einzeln im Dialog
  UND im Ereignisprotokoll ("Blockventil geschlossen — Leck am Abblaseventil
  gestoppt." statt nur "behoben").
  Eine Handlung fasst der Helfer NIE an, bei keinem der drei Typen: die
  Schnellabschaltung selbst (SCRAM/RESA/AZ-5, siehe `sim/trips.js` -- "Die
  Schnellabschaltung bleibt allein Sache des Bedieners"). Verlangt eine
  Meldung nur diesen einen Handgriff (Leistungsauslösung, kurze Periode, ...),
  bleibt sie deshalb "lässt sich nicht automatisch beheben" -- der Hilfetext
  daneben sagt, was zu tun ist, aber drücken muss der Spieler selbst.
  Beim RBMK ist das zugleich sicherheitsrelevant: bei niedriger Abschalt-
  reserve (ORM) führt AZ-5 in den ersten Sekunden POSITIVE Reaktivität ein
  (Graphitspitzen, siehe `plants/rbmk.js`, 26. April 1986) -- der Helfer fährt
  die Stäbe stattdessen von Hand ein, genau wie es `alarm_orm_critical_help`
  selbst vorschreibt.
  Zweite Ausnahme unabhängig von der SCRAM-Regel: **SWR, Wasserstoff
  kritisch** bleibt absichtlich unbehebbar. Bei der Auslöseschwelle dieser
  Meldung (40 kg) steht die Wasserstoffmenge längst über den 25 kg, ab denen
  Venten in `bwr.js` die Explosion selbst auslöst -- eine Abwägung mit
  Ermessen, kein Knopf, der sie blind trifft.
  Nicht jede Meldung ist sonst automatisierbar (ein klemmender Stab, axiale
  Xenon-Schieflage) -- auch dort sagt der Dialog "lässt sich nicht automatisch
  beheben" statt gar nichts zu tun.

## 0.0.70

- 🐛 **Turbine wieder zuschalten konnte den Kern zerstören (DWR).** Gefunden
  beim headless Durchspielen aller neun Szenarien (echte Engine, kein Mock).
  Nach einem Turbinenschnellschluss pendelt sich die Anlage oft deutlich
  unter Volllast ein (Umleitstation faengt den Dampf auf) -- schaltete man
  die Turbine dann wieder zu ("Turbine zuschalten"), sprang die Vorsteuerung
  des Regelventils sofort auf den vollen Anforderungswert, egal wie weit die
  Ist-Leistung davon entfernt war. Das riss mehr Dampf ab, als der Kern
  gerade machte, kühlte ihn schlagartig -- und über den negativen
  Moderatorkoeffizienten wurde daraus ein echter Leistungsausflug bis zur
  Kernzerstörung, oft nur Sekunden nach dem Zuschalten.
  `GovernorController.resume()` faehrt die Vorsteuerung jetzt ueber 180s von
  der Stellung aus hoch, die zur Ist-Leistung beim Zuschalten passt, statt in
  einem Schritt zu springen -- betrifft nur den Lastbetrieb (DWR), Druck-
  betrieb (SWR/RBMK) unveraendert. Kein Regressionsschaden in den anderen
  acht Szenarien (per erneutem Durchlauf bestaetigt).

## 0.0.69

- 🐛 **"Netzanforderung zu lange verfehlt" schlug ohne jede Vorwarnung zu.**
  Betrifft 6 von 9 Szenarien (bwr_flow_control, bwr_instability,
  pwr_load_follow, pwr_turbine_trip, rbmk_cold_start, rbmk_night_shift).
  Die Abweichung stand zwar staendig sichtbar in der Statuszeile
  ("Abweichung"), aber ohne Warnfarbe, Meldetafel-Eintrag oder Hupe -- die
  interne Frist (600s bei den meisten, teils 150-300s) lief unsichtbar mit,
  bis die Schicht ohne Ankuendigung abgebrochen war.
  - Neue Szenario-eigene Meldetafel-Kacheln (`game/scenario.js`,
    `gridDeviationTrips()`): WARN sobald die Abweichung das Fail-Limit
    ueberhaupt reisst, TRIP als letzte Warnung rund 90s vor der harten
    Frist (bzw. die Haelfte der Frist bei kurzen Fenstern) -- inklusive
    Hupe, Protokolleintrag und Hilfetext, genau wie jede andere Meldung.
    Nimmt dieselbe SCRAM-Ausnahme wie die Fail-Bedingung selbst (`RunState.
    checkFail()`): eine bewusste Abschaltung zaehlt nicht als Verfehlen.
  - Engine kennt dafuer `opts.extraTrips` (`sim/engine.js`) -- Meldungen, die
    am Szenario haengen statt am Reaktortyp, ohne `spec.trips` (Modul-weit,
    nicht pro Runde) dafuer anzufassen.
  - "Abweichung" im Netz-Panel faerbt sich jetzt mit derselben Kachel-Schwere.
  - Kleinere Optimierung nebenbei: `engine.trips.tiles()` lief im Renderlauf
    bisher dreimal je Bild, jetzt einmal und wiederverwendet.
  - Per Smoke-Test durchgespielt: Warn-/Trip-Zeitpunkt, SCRAM-Ausnahme,
    Clear-Uebergang -- alle drei bestaetigt korrekt.

## 0.0.68

- ✨ **Auswertung zeigt jetzt Minimum DNBR/CPR und Abschaltreserve.** Beide
  wurden schon laenger mitgezaehlt (`RunState.summary()`), standen aber
  nirgends in der Auswertung -- eine Einweisung, die "Ziel: ... ohne die
  Reserve unter 30 zu sehen" verspricht, muss hinterher auch zeigen, wie nah
  man dran war. Je Reaktortyp nur, wenn er den Wert kennt (DNBR beim DWR,
  CPR bei SWR/RBMK, Abschaltreserve nur beim RBMK).
- 🐛 **Einweisung "Kaltstart nach Revision" (RBMK) irrefuehrend.** Text
  schickte direkt in den Leistungsanstieg durch die 200-MW-Zone, ohne zu
  erwaehnen, dass die Netzanforderung die ersten 30 Minuten bei 0 MW steht
  UND das Regelventil in Automatik nur den Trommeldruck haelt, nicht die
  Last -- jedes Megawatt, das der Kern macht, ging bisher unbemerkt durch
  und riss binnen Minuten die Fehlbedingung "Netzanforderung zu lange
  verfehlt". Hinweis ergaenzt: Kernleistung zurückhalten, bis die
  Anforderung selbst zu klettern beginnt.

## 0.0.67

- 🐛 **Einweisung liess sich nach "Fortsetzen" nicht mehr oeffnen.** Der
  Knopf braucht `app.briefDef` -- das setzte bisher nur der Weg ueber "Los"
  (frischer Szenariostart, `loadScenario()`). Der Fortsetzen-Knopf in der
  Start-Liste holte die Szenariodefinition zum Booten zwar auch nach, schrieb
  sie aber nie in `app.briefDef`: kein Fehler, der Knopf tat einfach nichts.
  Betraf jeden Szenario-Spielstand nach Speichern+Fortsetzen.

## 0.0.66

- 🐛 **CPR fehlte in der Kopfzeilen-Auswahl beim RBMK/SWR.** Der Katalog
  (`statusStats.js`) beschriftete den Abstand-zur-Siedekrise-Wert immer mit
  dem generischen "Marge" -- die Panels selbst zeigen dort schon laenger
  DNBR bzw. CPR je nach Kerntyp (`sp.marginKey`), die Kopfzeile und ihr
  Einstellungen-Dialog taten das nicht. Beide zeigen den Namen jetzt passend
  zum aktuell geladenen Reaktortyp; beim RBMK/SWR taucht "CPR" jetzt in der
  Auswahlliste auf.

## 0.0.65

- ✨ **Statuskacheln in der Kopfzeile per Ziehen umsortieren.** Kurz halten
  (Long-Press, gegen Kollision mit dem seitlichen Wischen zum Scrollen),
  dann verschieben -- Maus, Touch und Stift gleich (`ui/dragReorder.js`,
  kein HTML5-Drag&Drop, das kennt keine Touch-Geraete). Reihenfolge wird wie
  die Auswahl selbst je Reaktortyp gespeichert, unabhaengig von Szenario
  oder freiem Spiel. Der Einstellungen-Dialog ueberschreibt eine gezogene
  Reihenfolge nicht mehr -- neu angehakte Werte kommen ans Ende, bereits
  gezeigte behalten ihren Platz.

## 0.0.64

- ✨ **Klick-Geraeusch fuer Schalter** (`game_switch.mp3`). Automatik/Hand-
  Umschalter, Tastengruppen (Bor, PORV-Sperre, MSIV, IC, Notinjektion,
  Behaelterentlueftung, ...) und Pumpenknoepfe geben jetzt hoerbares
  Feedback -- zentral in `controls.js`, damit kein Reaktortyp seinen eigenen
  Aufruf braucht und vergisst. Schieber/Stellraeder bleiben stumm, die
  laufen stufenlos.

## 0.0.63

- 🐛 **Bedienung griff auch bei angehaltener Simulation durch.** Leertaste
  (`loop.speed = 0`) stoppte nur `engine.step()` -- Stabfahrt, Pumpen, Bor,
  Regelstationen (Turbinenventil, Speisewasser, Druckhalter, Umwaelzstrom,
  MSIV, ...) liessen sich trotzdem bedienen, ohne dass sich etwas rechnete.
  Alle Bedienelemente aus `controls.js` sperren jetzt zentral, solange
  angehalten ist (`setControlsPaused()`); die betroffenen Panels blenden
  dazu ab.
- ✨ **Strg+Pfeil hoch/runter fährt die Stäbe.** Bisher nur per Maus/Touch
  ueber die Halteknoepfe. Pfeiltasten ohne Strg blieben bewusst frei --
  sie scrollen sonst die Seite.
- ✨ **Motorengeraeusch bei der Stabfahrt** (`game_rods_move.mp3`). Laeuft,
  solange gefahren wird (Knopf gehalten oder Strg+Pfeil wiederholt), und
  stoppt von selbst kurz nach dem Loslassen -- kein eigener Schalter im
  Ton-Dialog, nur der Hauptschalter (Stummschaltung) sticht, wie bei
  SCRAM/Kernschmelze auch.

## 0.0.62

- ✨ **Startbanner vor dem Startbildschirm.** Grosses Logo, Klick/Enter/
  Leertaste blendet aus und startet die Musik -- der Startbildschirm dahinter
  baut sich unveraendert auf, das Banner liegt nur optisch drueber
  (`#rs-splash`, z-index in base.css).
- ✨ **Autosave gegen Strg+R.** Bisher gab es nur den Speichern-Knopf von
  Hand -- ein Reload oder Tab-Absturz ohne vorheriges Speichern kostete den
  ganzen Lauf. Jetzt sichert eine laufende Runde sich alle 60 echte Sekunden
  automatisch in denselben Slot (siehe 0.0.60/0.0.61), nur waehrend die Runde
  wirklich laeuft (nicht ueber Debriefing/Kernzerstoerung hinweg). Die
  Fortsetzen-Liste auf dem Startbildschirm zeigt den Stand danach von selbst
  an -- eine eigene "Weiterspielen?"-Nachfrage brauchte es dafuer nicht.

## 0.0.61

- 🐛 **Wertung fing nach Fortsetzen eines Szenarios bei null an.** Nachtrag zu
  0.0.60: das Fortsetzen selbst war repariert, aber `RunState` (Zeit im
  Toleranzband, Abweichung, SCRAM-Zaehler, ...) hatte kein Gedaechtnis ueber
  einen Speicherpunkt hinweg -- ein gespeicherter und fortgesetzter Lauf
  wertete am Ende nur noch die Minuten nach dem Laden, nicht den ganzen Lauf.
  `RunState` hat jetzt `snapshot()`/`restore()` wie Pumpen und Regler; der
  Zwischenstand steckt mit im Speicherblock (`run`-Feld, optional -- alte
  Staende ohne das Feld laden weiter, Wertung faengt dann wie bisher bei null
  an).

## 0.0.60

Drei Funde aus einer echten Spielsitzung.

- 🐛 **Speicherstand-Kollision zwischen Szenario und freiem Spiel.** Der
  Auto-Slot hing nur am Reaktortyp (`auto-<typ>`), nicht am Szenario. Ein
  RBMK-Szenario gespeichert, danach RBMK im freien Spiel gespeichert -- beide
  landeten im selben Slot, der zweite Stand loeschte den ersten wortlos.
  Slot heisst jetzt `auto-<typ>-<szenario>` bzw. `auto-<typ>-free`, jede
  Kombination hat ihren eigenen Platz. Alte Staende im frueheren Format
  bleiben unberuehrt liegen.
- 🐛 **Fortsetzen eines Szenario-Standes wurde immer zu freiem Spiel.** Die
  Fortsetzen-Liste zeigte den richtigen Szenarionamen an, bootete beim Klick
  aber immer mit `scenarioDef = null` -- Bedarfskurve, Ereignisse und
  Erfolgsbedingung des Szenarios waren nach dem Fortsetzen weg, ohne jede
  Meldung. Laedt jetzt dieselbe Szenariodefinition nach wie beim
  Erststart. Bekannte Einschraenkung: die Punktezaehler fuer den Lauf
  beginnen dabei wieder bei null, nicht beim Stand vor dem Speichern.
- 🐛 **RBMK-Leistungsregler nicht stossfrei beim Einschalten.** Automatik
  sprang beim Einschalten auf den Sollwert von Rundenbeginn zurueck, egal wie
  weit die Ist-Leistung seither gewandert war (Handbetrieb, Xenon-Transiente)
  -- bei stark abweichender Leistung zog er dann hart in die falsche
  Richtung. Uebernimmt jetzt beim Einschalten die aktuelle Leistung als
  neuen Sollwert.

## 0.0.59

- 🐛 **Sirene lief im Hauptmenü und nach Neustart weiter.** `toMenu()` und
  `boot()` stoppten Loop und Musik, aber nie `app.horn` -- eine unquittierte
  Meldung liess die Sirene (eigene Dauerschleife, unabhaengig vom Spieltakt)
  einfach weiterlaufen, auch mit verlassener Runde. Beide Stellen rufen jetzt
  `horn.silence()`, bevor der alte Horn verworfen bzw. das Menue gezeigt wird.

## 0.0.58

- 🐛 **Lautloses Einfrieren behoben.** Warf `engine.step()` oder der
  `afterStep`-Callback (Rundenauswertung, Trips) irgendwo einen Fehler, brach
  die ganze rAF-Schleife stumm ab: die Kopfzeile blieb stehen, `running`
  meldete weiter `true`, kein Dialog, kein sichtbarer Fehler — nur ein Neuladen
  half. `app.render.tick()` war schon per try/catch abgesichert, der
  Simulationsschritt selbst nicht. Jetzt fängt `loop.js` das ganze Bild in
  einem try/catch, loggt den Fehler in die Konsole und zeigt den vorhandenen
  Störfall-Dialog mit Fehlerdetail statt eines stillen Stillstands.

## 0.0.57

Vier Dinge, die beim ersten echten Blick auf den Bildschirm auffielen — und
eines davon machte ein Szenario unspielbar.

- 🐛 **Die Borsäure gab es auf dem Desktop nicht.** In `layout.css` stand
  `#rs-p-chem { display: none; }` für alles ab 1024 px, mit der Begründung,
  die Chemie-Werte stünden ja im Kern-Panel. Das galt für die WERTE. In der
  Kachel sitzt aber auch die Bedienung. Damit war auf jedem Desktop-Browser
  **kein Bor dosierbar** — und `pwr_load_follow` dort nicht zu gewinnen, weil
  nach dem klemmenden Stab genau das der einzige verbliebene Weg ist. Die
  frisch geschriebenen Hilfetexte verwiesen auf ein Bedienelement, das der
  Spieler nicht finden konnte, weil es nicht da war.
  Die Kachel hat jetzt einen eigenen Platz im Raster. Nachgemessen mit
  Playwright: drei Reaktortypen × drei Auflösungen, keine Überlappung.
- 🐛 **Die Bedienung lag 140 px unter der Kachelkante.** Auch mit sichtbarer
  Kachel hätte man im Panel scrollen müssen, ohne jeden Hinweis darauf. Die
  Knöpfe stehen jetzt VOR den Messwerten — beim Druckwasserreaktor ist die
  Borsäure das einzige Reaktivitätsstellglied neben den Stäben.
- 🐛 **Die Einweisung war eine Textwand.** `#rs-alarm-help-text` hatte
  `white-space: pre-line`, `#rs-brief-text` nicht. Seit dort in 0.0.56 ein
  Block mit nummerierten Schritten steht, lief ausgerechnet der Teil, der die
  Handgriffe aufzählt, zu einem Absatz zusammen.
- 🐛 **Aus der Einweisung gab es keinen Weg zurück.** Wer ein Szenario
  aufschlug, um zu lesen, worum es geht, musste es anschließend spielen.
  Jetzt steht „Zurück" neben „Schicht beginnen".

### Ton

- 🔊 **Mute-Knopf**, auf dem Startbildschirm und in der Kopfzeile des
  Leitstands. Vorher lagen die drei Tonschalter ausschließlich im
  Zahnrad-Dialog INNEN — wer es still haben wollte, musste erst eine Schicht
  beginnen.
  `prefs.audio.muted` ist ein Hauptschalter über Musik, Hupe und
  Geigerzähler; die drei Einzelschalter bleiben erhalten, damit sie nach dem
  Aufdrehen wieder so stehen wie vorher. Der Zustand wird gespeichert und
  überlebt das Neuladen.
- 🧹 **`applyAudioPrefs()`** ist jetzt die einzige Stelle, die den Tonzustand
  herstellt. Dieselbe Rechnung stand vorher dreimal im Code (Laden der
  Einstellungen, Speichern im Zahnrad-Dialog, Rundenstart für die Hupe) — ein
  vierter Schalter wäre ein vierter Ort zum Vergessen gewesen.

**Warum der Ton erst nach einem Klick kommt, bleibt so:** das ist keine
Einstellung, sondern die Autoplay-Sperre der Browser. Ohne echte Nutzergeste
verweigern Chrome, Firefox und Safari jeden Ton. Das Spiel nutzt den ersten
Klick auf eine Reaktorkarte dafür — vorher *kann* nichts kommen.

Nachgeprüft mit Playwright statt behauptet: `play()`/`pause()` mitgeschrieben,
stumm läuft kein einziger Aufruf, Aufdrehen im Leitstand startet die
Hintergrundmusik sofort, beide Knöpfe bleiben synchron.


## 0.0.56

Alle 33 Hilfetexte und alle 9 Einweisungen neu geschrieben, in beiden
Sprachen, jede Aussage gegen den Code geprüft.

Der Anlass war eine einzige Frage: „Was ist hier zu tun?" Die Hilfe zu
„Frischdampf abgesperrt" nannte als einzige Handlung „Absperrung auf Offen
stellen" — und dieser Klick wirkt genau einen Rechenschritt lang. Dieselbe
Frage stellte sich bei der Einweisung zum Lastfolgebetrieb: sie sagt „ab da
bleibt nur noch Bor" und nirgends, dass das Bedienelement „Borsäure" heißt
und im Reiter Chemie sitzt.

### Was sich an jedem Text geändert hat

- 📍 **Jedes Bedienelement wird mit Kachel und Namen genannt**, so wie es auf
  dem Schirm steht. „Bor dosieren" ohne zu sagen wo, ist keine Anleitung.
- 🔢 **Wo die Reihenfolge zählt, ist nummeriert.** Beim Frischdampf etwa:
  abschalten, DANN Notkondensator — der arbeitet nur bei abgeschaltetem
  Reaktor, andersherum passiert nichts.
- 🚫 **Wo etwas NICHT wirkt, steht das jetzt da.** „Regelventil" und
  Umleitstation sitzen hinter der Absperrung; sie zu öffnen ändert nichts.
  Der alte Text zu „Domdruck hoch" empfahl genau das.
- 🔬 **Jede Zahl gegen den Code geprüft:** Ansprechpunkte der Sicherheits- und
  Abblaseventile, Umleitstation, Auslegungsdruck des Sicherheitsbehälters,
  Trommeldruck, Grenzwerte der Meldungen.

### Drei Texte, die vorher falsch waren

- **„Frischdampf abgesperrt"** verwies auf eine unmögliche Handlung und
  erwähnte weder Schnellabschaltung noch Notkondensator — also genau die
  beiden Dinge, auf die es ankommt.
- **„Domdruck hoch"** empfahl Regelventil und Umleitstation. Beide sind
  wirkungslos, wenn der Druck steigt, WEIL abgesperrt ist — dem häufigsten
  Fall, in dem diese Meldung kommt.
- **„Abblaseventil offen"** versprach, das Ventil schließe von selbst wieder.
  Bei der klemmenden Störung stimmt das nicht, und der Spieler wartete auf
  etwas, das nie kam.

### Ein Test, der diese Fehlerklasse künftig abfängt

`test_help_texts_only_name_controls_that_exist` prüft jedes in
Anführungszeichen genannte Bedienelement gegen die tatsächlichen
Beschriftungen — in Hilfetexten und Einweisungen, in beiden Sprachen, ohne
Ausnahmeliste. Er fängt nicht jede falsche Aussage (ob eine Handlung in
DIESER Lage wirkt, weiß nur der Code), aber die häufigste: ein Bedienelement
nennen, das unter diesem Namen gar nicht existiert.

Beim ersten Lauf fand er drei eigene Fehler in den frisch geschriebenen
Texten:

- `„-Heizung"` — abgekürzt statt ausgeschrieben, kein Bedienelement.
- Die englischen Texte schickten den Spieler auf einen Knopf `"closed"`. Der
  heißt dort **`shut`**.
- Der englische Text verwies auf `"SCRAM/RESA/AZ-5"`; der Glossareintrag
  heißt `SCRAM / RESA / AZ-5`, mit Leerzeichen.

Genau die Sorte Abweichung, die einen Spieler vergeblich suchen lässt.

### Die Einweisungen

Die Erzählung bleibt unangetastet — sie stellt die Lage gut dar. Jede bekommt
einen Block „Darauf kommt es an" mit drei bis fünf Punkten: welches
Bedienelement, welche Kachel, welche Reihenfolge, und worauf beim Ablesen zu
achten ist. Beim Lastfolgebetrieb steht jetzt da, dass „Borsäure" in der
Kachel Reaktorchemie sitzt, dass Verdünnen die Leistung hebt und Aufborieren
sie senkt — und dass man wegen der drei Minuten Totzeit früh und in kleinen
Schritten dosieren muss, statt zu warten, bis die Abweichung sichtbar ist.


## 0.0.55

Ein Spieler fragte, was bei „Frischdampf abgesperrt" zu tun sei. Die Hilfe
nannte als einzige Handlung „Absperrung auf Offen stellen". Nachgemessen:
der Klick wirkt genau einen Rechenschritt lang, dann schreibt die Störung die
Stellung zurück. Beim Nachgehen stellte sich heraus, dass das Symptom war,
nicht die Krankheit.

**Sieben von neun Szenarien bestand man, indem man nichts tat.** Nachgemessen
mit `tests/tools/passive.mjs` (neu), einem Lauf ohne jede Bedienung:

- `pwr_porv_stuck`, das Three-Mile-Island-Szenario: Primärkreis läuft auf
  1 bar und 0 % Druckhalterfüllstand leer — vollständiger Kühlmittelverlust —
  und die Brennstofftemperatur steht die ganze Zeit unverändert auf 1027 °C.
  Ergebnis: „geschafft", 1750 Punkte, der höchste Wert im ganzen Spiel.
- `bwr_msiv`: Sicherheitsbehälter berstet nach zehn Minuten, Druck läuft auf
  110 bar — das Fünfundzwanzigfache des Auslegungswerts. Ergebnis: „geschafft".

Ursache war nicht Nachlässigkeit an einer Stelle, sondern eine fehlende
Kopplung: **der einzige Verlustweg war die Brennstoffenthalpie**, und die
greift nur bei einer schnellen Leistungsexkursion. Kühlmittelverlust,
geborstener Sicherheitsbehälter, überhitzte Hüllrohre — alles ohne Folgen.
Wer nichts falsch machen kann, kann auch nichts lernen.

### Die Anlage kann jetzt kaputtgehen

- ⚛️ **Der Kern dampft bei Druckverlust aus.** Der generische Kernpfad
  (`engine.js stepCore`) rechnete die Wärmeabfuhr über flüssiges Wasser, ohne
  je zu fragen, ob es bei dem herrschenden Druck noch welches gibt. Jetzt
  bricht der Wärmeübergang ein, sobald die Kühlmitteltemperatur die Sättigung
  übersteigt.
  Der erste Versuch dafür war falsch und steht als Warnung im Code: ein
  zusätzlicher Term neben der Wasserkühlung verlor gegen diese im Verhältnis
  700:1, weil deren Zeitkonstante bei 0,3 s liegt und die des Ausdampfens bei
  Minuten. Abgesenkt werden muss der Durchgang selbst.
- ⚛️ **Kavitierende Pumpen fördern Dampf, nicht Wasser.** Eine Kreiselpumpe
  fördert Volumen; bei 1 bar hat Dampf rund 1/1600 der Dichte von Wasser.
  Vorher standen im leergelaufenen Primärkreis unverändert 20 000 kg/s im
  Kern, und die Durchsatz-Auslösung meldete nichts, weil der Messwert stimmte.
- ⚛️ **Vier Verlustwege statt einem** (`engine.js checkLoss`): Brennstoff-
  enthalpie wie bisher, dazu Hüllrohrversagen (über 1204 °C für mehr als drei
  Minuten — ab da trägt sich die Zirkon-Wasser-Reaktion selbst), Kühlmittel-
  verlust (Unterkühlung über fünf Minuten unter null) und, typeigen über
  `hooks.lossCriteria`, der geborstene Sicherheitsbehälter. Beide Zeiten
  bewusst in Minuten: ein Grenzwert, der im Augenblick des Überschreitens
  zuschlägt, wäre eine Falle und kein Lernstoff.
- 🖥️ **Der Endbildschirm sagt jetzt, WORAN es lag** — einer von vier Texten
  statt immer „Kernzerstörung, Brennstoffenthalpie über 963 J/g".

### Der Füllstand des Siedewasserreaktors log

- 🐛 **Das Inventar hatte keine Obergrenze.** Bei abgesperrtem Frischdampf
  speiste der Regler mit 1724 kg/s nach, während nur 900 kg/s über das
  Sicherheitsventil abgingen — nach vierzig Minuten standen **2 056 144 kg**
  im Behälter, das Elffache des Nennwerts.
- 🐛 **Und die Anzeige zeigte dabei 11 %.** Der Schrumpf-/Quell-Term ist als
  kleine Verfälschung um den Betriebsdruck gedacht; bei 110 bar lieferte er
  −91 Prozentpunkte. Da die Speisewasserregelung auf genau diese Anzeige
  regelt, sah sie einen fast leeren Behälter und speiste noch mehr — die
  selbstverstärkende Schleife hinter den 2000 Tonnen. „Füllstand hoch" konnte
  nie ansprechen, weil die Anzeige unten klebte. Beides ist jetzt begrenzt.
- ⚖️ **Sicherheitsbehälter neu bemessen.** `capacity` stand auf 60 000 kg —
  bei voll geöffnetem Sicherheitsventil riss er nach 67 Sekunden. Solange das
  folgenlos blieb, fiel es nicht auf; als Verlustbedingung wäre es eine Falle
  gewesen. Der neue Wert (520 000 kg) ist von der Kondensationskammer her
  gerechnet und lässt gut zehn Minuten. `ventCv` war mit 9 kg/s gegen 900 kg/s
  Zustrom wirkungslos, obwohl die Hilfe Venten als die Rettung nennt; 60 kg/s
  liegt über der Nachzerfallsverdampfung, also hilft es an einem
  abgeschalteten Reaktor wirklich — und bleibt chancenlos gegen einen, der
  noch läuft. Genau die Reihenfolge, die die Hilfe beschreibt.

### Klemmende Stellglieder melden sich

- 🔔 **Drei neue Meldungen:** „Stabgruppe klemmt", „Frischdampf-Absperrung
  klemmt", „Abblaseventil klemmt offen". Vorher klickte man ins Leere: der
  Knopf ließ sich drücken, die Stellung sprang zurück, und nichts sagte warum.
  Jede der drei bringt eine Hilfe mit, die die Handlungen nennt, die
  stattdessen wirken — mit Reiter, Bedienelement und Reihenfolge.

### `pwr_porv_stuck` war nicht zu gewinnen

- 🎛️ **Blockventil ergänzt** (Reiter Primär). Das Abblaseventil klemmt offen,
  und es gab kein einziges Bedienelement dagegen — der Primärkreis lief leer,
  ganz gleich was der Spieler tat. Genau dieses Ventil hat in Three Mile
  Island das Leck schließlich gestoppt, nach zweieinhalb Stunden.

### Die Szenarien reagieren

- 🎯 **Neue Fehlbedingung `trip_ignored`:** eine Auslösemeldung steht fünf
  Minuten an, ohne dass abgeschaltet wird. Das ist die Lehre dieses Spiels in
  eine Regel gefasst — die Meldetafel schaltet nichts ab, der Bediener muss.
- 🎯 **Netzbedingungen ergänzt**, mit einer Schwelle aus der szenarioeigenen
  Toleranz (dem Dreifachen) statt geratener Zahlen. Reine Störfall-Szenarien
  bekommen keine, dort wäre der verlorene Lastabsatz Folge und nicht Fehler.
- 🐛 **`grid_deviation` feuert nicht mehr bei abgeschaltetem Reaktor.** Wer auf
  eine Auslösemeldung hin richtig abschaltet, kann danach keine Leistung
  liefern — ihn dafür den Lauf verlieren zu lassen bestrafte genau die
  Handlung, zu der jeder Hilfetext auffordert. Die Schnellabschaltung kostet
  ohnehin 500 Punkte; sie darf Geld kosten, nicht die Anlage.

### Gemessen statt geglaubt

Zwei Sonden, beide dauerhaft im Baum:

- `tests/tools/passive.mjs` — Lauf ohne jede Bedienung. **Vorher 7 von 9
  bestanden, jetzt 0 von 9.**
- `tests/tools/competent.mjs` — Gegenprobe mit schlichter, korrekter
  Betriebsweise. **8 von 9 bestanden.** Die Gegenprobe ist die wichtigere von
  beiden: Szenarien so scharf zu stellen, dass Nichtstun scheitert, ist leicht
  — man kann dabei versehentlich jeden richtigen Lauf unmöglich machen und
  hätte die Fehlerrichtung nur gedreht. (Das neunte, `rbmk_night_shift`,
  scheitert an der Sonde, nicht am Spiel: sie führt die Last des RBMK nur
  grob.)

- ✅ **`test-game.mjs` baute Kaltstart-Szenarien mit heißem Kern auf** — das
  `cold`-Flag wurde nicht durchgereicht, anders als in `main.js boot()`. Der
  Test prüfte damit eine Lage, die es im Spiel nicht gibt. Aufgefallen ist es
  erst, als die Netzabweichung zu einer Fehlbedingung wurde.


## 0.0.54

Durchsicht auf Fehler und Optimierungen -- nichts davon fiel im Spiel auf,
zwei davon hätten es früher oder später getan.

- 🔒 **Bestenliste war beliebig manipulierbar.** Der Schwierigkeitsgrad ging
  als Faktor in den Abschlussbonus ein, und zwar ohne Deckel -- aber er kam
  aus der Anfrage. `validate_summary()` prüft jede andere Kennzahl auf
  Plausibilität, diese nicht: `difficulty: 1000000` mit `completed: true`
  ergab **250 001 000 Punkte** und ging glatt durch. Der Wert kommt jetzt aus
  der Szenariodatei und wird überschrieben statt geprüft -- so kann er gar
  nicht erst falsch sein, und ein Lauf ohne das Feld bekommt trotzdem den
  richtigen Bonus.
- 🔒 **Sicherheits-Kopfzeilen ergänzt.** Es gab keine. Der Dienst hängt auf
  einem offenen LAN-Port, und ohne `frame-ancestors` ließ sich die
  Anmeldeseite in einen fremden Rahmen setzen. Jetzt CSP (streng, `'self'`
  und sonst nichts), `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`. Die zwei bewusst eingebetteten
  Blöcke -- Übersetzungstabelle in `index.html`, vollständiges CSS in
  `login.html` -- bekommen eine Nonce je Antwort statt `'unsafe-inline'`:
  mit `unsafe-inline` wäre jedes eingeschleuste `<script>` mit erlaubt, und
  die Richtlinie hätte gegen genau den Fall nichts mehr zu sagen.
- 🐛 **Vorspulen nach Kernzerstörung setzte die Anlage wieder in Gang.** Die
  Xenon-Vorausschau (`fastForwardXenon`) prüfte am Ende auf
  `destroyed && !endShown`. Die Bildschleife läuft während ihrer Pausen aber
  weiter und kann den Kernzerstörungs-Dialog selbst öffnen -- dann stand
  `endShown` schon, der Zweig fiel durch, und der Zweig für den Normalfall
  schrieb "Zeitsprung" ins Protokoll und stellte den Zeitraffer auf 1×, mit
  offenem Kernzerstörungs-Dialog davor.
- 🐛 **Netzabweichung wurde in Schritten gezählt, nicht in Sekunden.**
  `RunState.checkFail()` summierte die Dauer mit einer fest im Code stehenden
  `0.05` statt mit dem übergebenen `dt`. Heute zufällig richtig, weil
  `loop.js` mit genau dieser Schrittweite rechnet -- und in dem Augenblick
  lautlos falsch, in dem irgendwo eine andere benutzt wird. `dt` kommt jetzt
  aus dem Aufruf, ein Test hält zwei Schrittweiten gegeneinander.
- 🐛 **Ratenbegrenzung wuchs unbegrenzt.** Aufgeräumt wurden nur Einträge mit
  leerer Trefferliste. Ein Spieler-Token, das einmal getroffen und nie wieder
  gesehen wurde, blieb für immer stehen -- bei einem Cookie je Gerät wuchs die
  Tabelle über die Laufzeit des Containers monoton mit. Jetzt fliegt raus, was
  außerhalb seines Zeitfensters liegt.
- ✅ **CI baut nicht mehr ungeprüft.** Der Workflow schob bei jedem
  VERSION-Bump ein Image nach GHCR, ohne einen einzigen Test zu starten -- die
  75 Tests im Ordner liefen ausschließlich von Hand, darunter die komplette
  Simulationsprüfung. Jetzt laufen `pytest` und `node --test` vor dem Bau, und
  der Bau hängt am Ergebnis.
- ✅ **Die zwei dauerhaft roten Tests sind repariert**, statt weiter im Backlog
  zu stehen. `test_dockerfile.py` verglich Windows-Backslash-Pfade gegen die
  Schrägstrich-Ziele des Dockerfiles und scheiterte dort an *jedem* Modul in
  einem Unterordner -- also genau an denen, die er prüfen soll. `test_auth.py`
  prüfte POSIX-Rechtebits auf NTFS. Ein roter Test, den man zu ignorieren
  lernt, prüft nichts mehr; der Dockerfile-Test ist ausgerechnet der, der ein
  vergessenes `COPY` fangen soll. Nebenbei: `auth.py` fehlte in seiner Liste.
- ⚡ **`sanitize()` baut keine Wegwerf-Arrays mehr.** Es lief über
  `Object.entries(RANGES)` und legte damit in jedem Rechenschritt vierzehn
  frische Paar-Arrays an -- bis zu 1200-mal je Sekunde im 60-fachen
  Zeitraffer, für eine konstante Tabelle.
- ⚡ **`write_save()` zählt nur noch.** Für die Slot-Obergrenze öffnete und
  parste es über `list_saves()` bis zu zwanzig Spielstände, um nichts davon
  zu benutzen.
- 🧹 `.dockerignore` ergänzt. Ändert nichts am Image -- die Wurzeldateien
  werden ohnehin einzeln kopiert --, hält aber `dev_data/` mit `auth.json`
  und `secret.key` aus dem Build-Kontext.
- 📋 Backlog neu geschrieben: die beiden erledigten Test-Punkte raus, dafür
  die zurückgestellten Erweiterungen mit Begründung drin (serverseitige
  Nachrechnung, Wiedergabe, Web Worker, vierter Reaktortyp, CSV-Export,
  Mehrbenutzerbetrieb).

Nicht übernommen: ein Puffer für `engine.derive()`. Der Wert wird je Bild
sechsmal gebraucht und jedes Mal neu gerechnet, das sah nach einem leichten
Gewinn aus. Gemessen sind es ein paar Mikrosekunden von sechzehn
Millisekunden je Bild -- und der Puffer kostete genau die Eigenschaft, um die
es im Kopf von `sim/state.js` geht: wer den Zustand von außen anfasst und
danach `derive()` liest, bekam den Wert von vorher. Ein Test fiel sofort
darauf herein. Rückgängig gemacht, Begründung steht jetzt an `derive()`.

## 0.0.53

- 🖼️ **Beschriftungen und Messwerte lagen auf Rohrleitungen** -- über alle
  drei Fließbilder verteilt (SWR am schlimmsten: "Notkondensator"-Label
  quer über der Frischdampfleitung, Füllstand direkt drauf). Ursache: die
  Positionen waren einzeln von Hand gesetzt, ohne die tatsächliche
  Rohrgeometrie zu prüfen. Mit `getBBox()`/`isPointInStroke()` in einem
  echten Browser für alle drei Typen automatisiert nachgemessen (nicht nur
  am Bild geraten) und behoben:
  - SWR: Notkondensator-Baugruppe hochgesetzt (in den seit v0.0.51
    reservierten Raum über der viewBox), Ventil-Label jetzt links statt
    darüber, Füllstand über dem Kästchen statt daneben, Kondensatrücklauf
    zapft seitlich ab statt mittig durch die neue Beschriftung.
  - Alle drei Typen: Regelventil-Label jetzt rechts (zur Turbine) statt
    links -- links verläuft eine parallele Steigleitung zur Umleitung genau
    durch die Beschriftung. Umwälzpumpe sitzt jetzt an der unteren
    Schleifenecke statt mittig auf der Rohrleitung (wie beim DWR seit je).
  - DWR: "Dampferzeuger"-Beschriftung tiefer gesetzt -- das Speisewasserrohr
    fiel genau durch die alte Position.
  - RBMK: Leistungsanzeige tiefer im Kanalblock (Steigleitung im Weg),
    "Druckröhren"-Beschriftung linksbündig statt mittig (kollidierte sonst
    mit der verschobenen Pumpenbeschriftung).

## 0.0.52

- 🔒 **CodeQL-Alerts gefixt:** Pfad-Aufbau bei Spielstaenden/Bestenliste
  (`persist.py`) lief bisher ueber `os.path.join` nach Regex-Pruefung --
  CodeQL erkennt `re.match` nicht als Sanitizer, deshalb zusaetzlich durch
  `werkzeug.safe_join` geschickt. Uebersetzungsdatei (`app.py`) kommt jetzt
  aus einer festen `{sprache: dateiname}`-Zuordnung statt aus einem
  f-String mit der Sprachkennung. Offene Weiterleitung nach dem Login
  (`auth.safe_next`) setzt das Ziel jetzt aus den per `urlsplit` geparsten
  Bestandteilen neu zusammen (`urlunsplit`), statt den prüften Rohwert
  durchzureichen -- rein Haerten, keine Funktionsaenderung.

## 0.0.51

- 🖼️ **Sicherheitsventil-Label saß auf dem Notkondensator-Label** (SWR-
  Fließbild) -- beide quetschten sich in denselben schmalen Streifen über
  dem Frischdampf. `viewBox` um 40px nach oben erweitert, Sicherheitsventil
  dorthin verschoben, klare Trennung jetzt.
- 🏷️ **"Dampferzeugerfüllstand" hieß auch beim SWR/RBMK so**, wo es keinen
  Dampferzeuger gibt (Kernbehälter/Trommelabscheider). Label auf
  typneutrales "Füllstand" vereinfacht.

## 0.0.50

- 🐛 **Sicherheitsbehälter beim Fukushima-Szenario riss praktisch sofort.**
  `capacity: 2600` war so klein, dass schon der erste, harmlose
  Sicherheitsventil-Stoß direkt nach der Isolierung (~7.500 kg in 30
  Sekunden, Notkondensator fängt das normalerweise ab) den Grenzwert riss —
  4 Sekunden nach dem Erdbeben, lange vor dem eigentlichen Stromausfall.
  Per Engine-Simulation nachgerechnet und auf `60000` gesetzt: der harmlose
  Erststoß bleibt jetzt sicher drunter, ein unbehandelter Blackout reißt den
  Behälter nach ca. 40 Minuten statt 4 Sekunden.
- 🌊 **Füllstandsanzeige lügt beim Stromausfall mit, wie der Notkondensator.**
  2011 zeigte die Warte lange einen stabilen Füllstand, während der Kern in
  Wirklichkeit bereits freilag — die Anzeige hing an derselben Gleichstrom-
  versorgung wie der Rest der Instrumentierung. Jetzt friert `d.L_sg`
  (Kopfzeile und Fließbild) beim Stromausfall auf dem letzten echten Wert
  ein, während der Kern real weiter leerläuft.
- 🔧 **Frischdampf-Absperrung (SWR-Störfall-Szenario) blieb nicht zu.**
  `msiv_close` setzte `s.msiv` bisher nur einmalig auf 0 -- ein Klick auf
  "offen" machte die ganze Störung rückgängig. Jetzt wie ein klemmender
  Stab dauerhaft erzwungen (`ctx.msivStuck`).
- 🖼️ **Sicherheitsventil jetzt im Fließbild sichtbar** (SWR), vorher nur als
  Meldetafel-Alarm ohne jede Stelle im Bild.
- 📝 Ereignisprotokoll: "gekommen"/"gegangen" durch klareres
  "ausgelöst"/"beendet" ersetzt.

## 0.0.49

- 🟢 **Kopfzeilen-Werte jetzt durchgehend grün/gelb/rot.** Viele der 44
  wählbaren Statuszeilen-Werte (Primärdruck, Kernstrom, Periode,
  Reaktivität, SG-Füllstand, Achsversatz, Graphittemperatur, Notkondensator-
  Vorrat, Umwälzstrom, Abklingverhältnis, ...) zeigten bisher nie eine Farbe,
  selbst wenn die Anlage längst im Warnbereich stand -- nur wenige Werte
  (Brennstoff, Hülltemperatur, DNBR, ORM, ...) hatten das schon. Neue
  Schwellen sind dieselben Zahlen wie die echten Grenzwertproben je Typ
  (`plants/*.js`, `trips`), nicht frei erfunden -- wo es keine gibt (z.B.
  Anforderung, Xenon, Bor, Abbrand), bleibt der Wert bewusst ungefärbt statt
  eine Gefahr vorzutäuschen, die das Modell gar nicht kennt. Werte ohne
  Alarm zeigen jetzt zusätzlich explizit Grün statt nur neutralem Weiß.

## 0.0.48

- 🎵 **Aufgenommene Klangeffekte statt Synthese, plus Musik.** Meldehupe,
  SCRAM und Kernzerstörung liefen bisher komplett über WebAudio-Oszillatoren
  (`annunciator.js`); jetzt echte Aufnahmen (`static/audio/*.mp3`, Pixabay-
  Lizenz). Die Hupe läuft dabei als Dauerschleife, solange eine Meldung
  unquittiert ist, statt sich jede Sekunde neu anzusetzen.
- 🆕 **Intro- und Hintergrundmusik.** Startbildschirm bekommt eine eigene
  Musikschleife (ab dem ersten Klick auf eine Reaktorkarte), eine laufende
  Runde eine andere -- beide über den neuen "Musik"-Schalter im Ton-Dialog
  ab-/anschaltbar, unabhängig von Hupe und Geigerzähler.
- 🆕 **Akustische Vorwarnung vor Szenario-Ereignissen.** 2-5 Minuten bevor
  ein geplantes Ereignis (Pumpenausfall, klemmender Stab, ...) tatsächlich
  eintritt, kommt einmalig ein kurzer Warnton -- geseedet wie das Ereignis
  selbst, reproduzierbar bei gleichem Szenario-Seed.

## 0.0.47

- ❄️ **Kaltstart jetzt auch in Szenarien.** Bisher erzwang `boot()` immer ein
  warmes Anfahren, sobald ein Szenario lief -- der `cold`-Modus (alle Stäbe
  drin, Pumpen aus, `trim()` schwingt bewusst NICHT auf Kritikalität ein) war
  auf das freie Spiel beschränkt. Ein Szenario kann jetzt `"cold": true`
  setzen und startet dann wirklich kalt.
- 🆕 **Neues Szenario: "Kaltstart nach Revision" (RBMK).** Anders als
  "Nachtschicht" (steht bei Volllast, fährt runter und wieder hoch) beginnt
  dieses Szenario kalt und steigt von unten durch die 200-Megawatt-
  Gefahrenzone -- Pumpen anfahren, Stäbe behutsam ziehen, kritisch werden,
  hochfahren, während eine Stabbank klemmt und später eine Umwälzpumpe
  ausfällt.
- 📖 **Alle Einweisungstexte zu echten Kurzgeschichten ausgebaut.** Die
  bisherigen zwei bis drei Sätze pro Szenario waren zu knapp, um die
  Situation wirklich zu verstehen. Jetzt: Zeit/Ort, was passiert, warum es
  gefährlich ist, was zu tun ist -- auf Deutsch und Englisch, für alle neun
  Szenarien.
- 🔁 **Einweisung während der Runde erneut aufrufbar.** Neuer Knopf in der
  Kopfzeile (nur bei Szenarien, nicht im freien Spiel) öffnet dieselbe
  Einweisung noch einmal, ohne die laufende Runde zu unterbrechen.
- ⌨️ **Tastenkürzel-Übersicht ergänzt.** Leertaste, Zeitraffer 1-4 und Esc
  standen bisher nirgends im Spiel selbst -- neues Hilfe-Fenster nach dem
  Muster des Grundlagen-Glossars.

## 0.0.46

- 💾 **Spielstand speicherte Pumpen, Ventile und Regler bisher gar nicht.** Nur Zahlen/Bool'sche Felder direkt am Zustand wurden mitgesichert -- Pumpen (Kaltstart: an/aus, Drehzahl), Regelventile (Stellung), und Regler (Automatik/Hand, Handwert, PI-Integrator) leben in eigenen Objekten daneben und kamen beim Laden IMMER frisch (= Vollast, Automatik) zurück, ganz gleich was eingestellt war.
  Jede betroffene Klasse (Pump, Valve, PI, Lag, RateLimiter, TransportDelay, RodController, PressurizerController, FeedwaterController, GovernorController, PowerController) hat jetzt `snapshot()`/`restore()`; jeder Reaktortyp meldet seine Instanzen über `ctx.saveable` (ein Objekt, keine Sonderfälle in persist.js). Alte Spielstände ohne dieses Feld laden weiter -- die Komponenten federn dann wie bisher auf ihre Anfangswerte ein, statt den Ladevorgang scheitern zu lassen.
  Per Node-Roundtrip (packen → frische Engine → laden) bei allen drei Typen bit-genau bestätigt: Pumpenzustand, Automatik/Hand-Stellung, PI-Integrator, Ventilstellung -- alles exakt wie vorher. Zusätzlich im echten Browser verifiziert: Pumpe gestartet, gespeichert, Seite komplett neu geladen, fortgesetzt -- Pumpe läuft weiter, statt wieder zu stehen.

## 0.0.45

- 📊 **Gesamtreaktivität jetzt auch als Kopfzeilen-Wert wählbar.** Bisher nur als Zeigerausschlag (Rundinstrument) und als "Gesamt"-Balken in der Reaktivitätsbilanz sichtbar, beides nur im Kern-Panel -- jetzt auch als reine Zahl mit Vorzeichen (z.B. "+120 pcm") im Katalog der Kopfzeilen-Einstellungen, genau wie die anderen 44 Werte.

## 0.0.44

- 💡 **Hinweis: thermische Leistung sagt bei Kritikalitätsannäherung nichts.** Real UND in dieser Sim bleibt sie bei 0,0 % stehen, lange bevor beim Stäbeziehen etwas ansteht -- Periode und Reaktivitätsbilanz reagieren viel früher. Neuer Hinweistext im Kern-Panel, direkt unter der Leistungsanzeige.

## 0.0.43

- 🔧 **Kaltstart: jetzt auch die Pumpen aus.** Hauptkühlmittel-/Umwälz-/Umwälzpumpen standen bisher trotz "Reaktor aus" auf voller Drehzahl -- der Kaltstart deckte nur Stäbe (und beim DWR Bor) ab. Jetzt stehen sie zu Beginn (Anzeige "stopped", nicht "tripped" -- kein Störungsauslauf, einfach nie gestartet), Naturumlauf hält den Kern trotzdem sicher. Der Spieler schaltet sie über denselben Knopf zu, mit dem er sonst eine ausgefallene Pumpe neu startet. Betrifft alle drei Typen.
  Nebenbei die Grundlage dafür geschaffen: `Pump.flow()` gab den Naturumlauf-Sockel bisher nur her, wenn die Pumpe mal lief oder ausgelöst hat (`running || tripped`) -- eine Pumpe, die einfach noch nie gestartet wurde, wäre auf echten Nullstrom gelaufen. Jetzt gilt der Sockel immer, was er physikalisch auch tut.

## 0.0.42

- ☢️ **Geigerzähler-Ticken.** Tickt gelegentlich im Leerlauf (0,1/s, reine Atmosphäre -- eine Leitwarte hat normalerweise keine spürbare Strahlung), deutlich schneller im Takt einer anstehenden Meldung, gestaffelt nach Schwere. Neue Sound-Sektion im ⚙-Menü ("Einstellungen", vorher "Kopfzeile anpassen") mit zwei Häkchen: Meldehupe und Geigerzähler, beide dauerhaft gespeichert (`/api/prefs`). Anders als die Hupe (pro Runde neu gebaut) lebt der Geigerzähler über die ganze Sitzung -- schon auf dem Startbildschirm entsperrt, tickt ab der ersten Runde, nicht erst nach dem ersten SCRAM. Per Playwright verifiziert: 2 Ticks/20s im Leerlauf (genau die konfigurierten 0,1 Hz), deutlich mehr direkt nach SCRAM, Aus-Schalter bringt es sofort auf null.

## 0.0.41

- 📱 **Kopfzeilen-Bedienung lief auf schmalen Handys über.** Xenon-Vorspulknopf (Text) plus Zeitraffer, ⚙, ?, Speichern, Menü, SCRAM passten ab 360px Breite nicht mehr in eine Zeile -- SCRAM konnte bis zu 25px hinterm sichtbaren Rand landen. Vorspulknopf jetzt Icon (⏩) statt Text wie die anderen Werkzeugknöpfe, Zeile bekommt zusätzlich `flex-wrap`, damit sie bei Bedarf sauber zweizeilig wird statt zu überlaufen. Per Playwright bei 360px verifiziert: passt jetzt exakt, SCRAM immer voll sichtbar.
- ⚗️ **Xenon-Override beim Hochfahren aus dem Kaltstart bestätigt.** Kein Code nötig, nur nachgerechnet: fährt man nach dem Kaltstart rein über Stäbe auf Vollast, drückt das nachwachsende Xenon die Leistung in den folgenden Stunden bis auf rund 12 % herunter, sobald die Stäbe ganz draußen sind und nichts mehr nachgeben -- der Kern erholt sich danach von selbst erst nach rund einem Tag. Genau das reale "Xenon-Override"-Problem; beim DWR hilft in der Praxis Verdünnen (`ctl_boron_dilute`) über die Stabreserve hinaus.
- 💾 Kaltstart-Häkchen wird jetzt gespeichert (`/api/prefs`, wie die Kopfzeilen-Auswahl) statt bei jedem Besuch neu gesetzt werden zu müssen.

## 0.0.40

- 🗑️ **Spielstände löschen.** Jeder Eintrag in der Fortsetzen-Liste hat jetzt einen Löschen-Knopf, gesichert wie SCRAM (erster Klick bewaffnet, zweiter binnen 4s löscht wirklich). Backend (`DELETE /api/saves/<slot>`) gab es schon, es fehlte nur die Oberfläche.
- ❄️ **Kaltstart: den Reaktor selbst hochfahren.** Neue Option auf dem Startbildschirm ("Kalt starten", nur freies Spiel) -- Kern steht mit allen Stabbänken voll eingefahren spürbar unterkritisch (DWR ca. −3800 pcm, SWR ca. −3100 pcm, RBMK ca. −1600 pcm), Leistung bei 0. Kritisch werden und hochfahren ist jetzt selbst zu tun: Stäbe ziehen (und beim DWR zusätzlich verdünnen), Periode beobachten, bei Erreichen der Kritikalität rechtzeitig bremsen.
  Kein Skript, echte Physik: an der Engine nachgemessen läuft der Übergang genau wie erwartet -- Periode wird mit dem Ziehen kürzer und kürzer, bei Kritikalität beginnt die Leistung zu steigen, alles ohne Fehler oder Kernschaden bei sachgemäßer Bedienung.
  Kleinere Fundsache beim Bauen: der SWR wurde mit voll eingefahrenen Stäben trotzdem leicht ÜBERkritisch, weil der Dampfblasenanteil bei Nullleistung auf null fällt und der (auf Volllast-Blasenanteil kalibrierte) Rückkopplungsterm das als kräftig positive Reaktivität liest ("Blasenkollaps") -- derselbe Effekt, den ein Kommentar im Code schon aus dem Volllast-Hochfahren kennt ("startete fast zwei Dollar überkritisch"), hier nur ohne den rettenden Leistungsanstieg direkt danach. Für den Kaltstart wird der Rückkopplungswert deshalb auf den Referenzwert zurückgesetzt.

## 0.0.39

- ⏩ **Jodgrube durchstehen, ohne 24 echte Minuten zu warten.** Neuer Knopf "Zeit vorspulen, bis Xenon abgeklungen" -- erscheint nur im freien Spiel, nur bei abgeschalteter Anlage (SCRAM) mit noch spürbar erhöhtem Xenon. Läuft dieselben Schritte wie der normale Betrieb (Engine + Sitzung je 0,05 s), nur ohne Bildaufbau dazwischen -- ein echter Störfall währenddessen bricht sofort ab und zeigt sich normal, statt still überfahren zu werden. In Blöcken mit Fortschrittsanzeige, damit der Tab nicht einfriert.
  Ziel ist die Rückkehr auf den Vollastwert (X* = 1), nicht auf nahe null -- an der echten Engine nachgemessen: Xenon steigt nach dem Abschalten erst noch rund 8h (Jodgrube), fällt dann und ist nach rund 27h wieder auf Vollastniveau. Nahe an den oft für den RBMK genannten "24 Stunden".

## 0.0.38

- 📈 **Freies Spiel: Netzanforderung wandert jetzt.** Bisher stand `P_demand` im freien Spiel fest auf dem Startwert und änderte sich nie von selbst -- "folge der Netzanforderung" war ohne Szenario nur Kosmetik in der Anleitung, es gab schlicht nichts zu folgen. Jetzt ein Zufallsspaziergang wie ein echter Netzbetreiber: alle 5–15 Minuten ein neues Ziel zwischen 50 % und 100 % Nennleistung, dahin geht es sanft (max. 0,2 %/s Nennleistung), nie sprunghaft. Neu gesät bei jedem Rundenstart -- keine feste Wiederholung wie bei einem Szenario, hier zählt keine Wertung. Die Regler-Zeile "Anforderung" zeigt weiterhin nur an, sie wird jetzt wie in Szenarien vom Spiel geführt statt vom Schieberegler.

## 0.0.37

- ⚡ **Kopfzeilen-Auswahl wirkt jetzt sofort.** Statt beim Speichern nur den Server zu aktualisieren und auf den nächsten Rundenstart zu warten, wechselt die laufende Kopfzeile sofort um -- ohne die zugrundeliegenden Knoten neu zu bauen (nur `hidden`/Reihenfolge), bleiben die Wertebindungen aus dem laufenden `buildPanels()` gültig.
- 💾 **Ein Spielstand-Slot je Reaktortyp statt einem gemeinsamen.** Vorher überschrieb "Speichern" beim SWR denselben Stand wie beim DWR (ein einziger Slot `auto`). Jetzt eigener Slot je Typ (`auto-pwr`/`auto-bwr`/`auto-rbmk`) -- ältere Stände im alten Slot `auto` sind darüber nicht mehr erreichbar. Der Startbildschirm zeigt jetzt für jeden gefundenen Stand einen eigenen "Fortsetzen"-Knopf mit Reaktortyp, Szenario (oder "Freies Spiel") und Speicherzeitpunkt im Text, statt nur einen namenlosen Knopf.

## 0.0.36

- ⚙️ **Kopfzeile frei anpassbar.** Welche Werte oben in der Statuszeile stehen, wählt man jetzt selbst (⚙-Knopf neben dem Fragezeichen) aus einem Katalog von 44 Werten -- alles, was auch in den Panels steht (Xenon, Bor, Abschaltreserve, Void-Koeffizient, …), nicht nur die bisherigen fest verdrahteten neun. Auswahl gilt je Reaktortyp getrennt und bleibt dauerhaft beim Spieler gespeichert (`/api/prefs`, eigene Datei je Spieler unter `/data/players/`), wirkt ab dem nächsten Rundenstart. Per Playwright-Livetest verifiziert: Auswahl übersteht Neustart und Menü-Rückkehr, bleibt zwischen Reaktortypen getrennt, taucht nicht in der Spielstand-Liste auf.

## 0.0.35

- 🐛 **SWR und RBMK: Dampferzeugerdruck/-füllstand zeigten dauerhaft "—".** Jeder Reaktortyp legt diese Werte intern unter eigenem Namen ab (SWR: `p_dome`/`L_rpv`, RBMK: `p_drum`/`L_drum`) und stellt sie im abgeleiteten Zustand unter dem gemeinsamen Namen `p_sg`/`L_sg` bereit — genau dafür gibt es diese Ebene. Die Anzeige (Rundinstrumente, Textzeile, Trendschreiber) griff aber direkt auf den rohen Zustand zu, wo dieser Name bei SWR und RBMK nie existiert. Nur beim DWR ging es zufällig gut, weil er selbst so heißt. Gefunden per Playwright-Livetest.

## 0.0.34

- ☢️ **Notkondensator jetzt im Fließbild.** Seit 0.0.29 real simuliert (Naturumlauf, Fukushima-Physik), stand aber nur als Textzeile im Sekundärkreis-Panel — im Anlagenfließbild fehlte er ganz. Jetzt eigene Schleife am Behälterkopf mit Isolierventil (auf/zu per Zustand) und Vorratsanzeige.
- 🔲 **Meldetafel-Kacheln überarbeitet.** Symbol lag per `position:absolute` über der Kachel und überlappte bei kurzen, einzeiligen Meldungen ("Leistung hoch") die erste Textzeile statt sauber daneben zu stehen — betraf Handy, Desktop und das neue Fenster gleichermaßen. Jetzt eigene Zeile über dem Text, dazu größere Kacheln (58px statt 46px, Schrift 11px statt 10px, breitere Spalten).

## 0.0.33

- 🖥️ **Kachel als Fenster.** Klick auf die Kopfzeile einer Kachel (Reaktorkern, Primärkreis, …) hebt sie als großes Fenster über den ganzen Leitstand — kein Freischrollen oder seitliches Scrollen in engen Spalten mehr nötig, um z.B. alle drei Rundinstrumente im Kern-Panel zu sehen. Verschiebt den echten `rs-panel-body`-Knoten (nicht geklont), daher bleiben alle Anzeigen live und alle Knöpfe bedienbar. Das gewohnte Raster samt Scrollen bleibt unverändert bestehen — das Fenster ist nur zusätzlich obendrauf. Esc, ein Klick daneben oder "Schließen" beenden es wieder. Nur auf dem Desktop-Raster aktiv (ab 1024px); auf dem Handy zeigt der Reiter das Panel schon voll, dort bleibt der Klick wirkungslos.

## 0.0.32

- 🐛 **`manifest.json`: "Syntax error" in der Konsole.** Der Browser holt eine Web-App-Manifest-Datei standardmäßig ohne Cookies — landete auf der Anmeldeseite (`/s/...` braucht eine Sitzung wie alles andere), bekam HTML statt JSON zurück und meldete einen Parsefehler beim ersten Zeichen. Rein kosmetisch (betraf nur "Zum Startbildschirm hinzufügen", nicht das Spiel selbst), aber seit 0.0.21 in der Konsole. `crossorigin="use-credentials"` am Manifest-Link behoben.

## 0.0.31

- 📊 **Sicherheitsbehälterdruck bekommt ein Rundinstrument.** Stand bisher nur als kleine Textzeile unter "Sicherheitssysteme" — jetzt ein Instrument im Sekundärkreis-Panel wie jeder andere überwachte Druck, nur beim Siedewasserreaktor (`sp.containment` existiert ausschließlich dort).
- 💡 **Ereignisprotokoll ist jetzt klickbar**, genau wie die Meldetafel-Kacheln: ein Eintrag öffnet dieselbe Erklärung, wenn eine existiert (Meldungen teilen sich die `_help`-Texte mit der Meldetafel). Für Ereignisse ohne eigene Erklärung (SCRAM ausgelöst, Frischdampf abgesperrt, …) ein Hinweistext statt eines nackten, unübersetzten Schlüsselnamens im Fenster.

## 0.0.30

- 🐛 **Rundinstrumente verdoppelten sich nach einem Neustart.** Kern-, Primär- und Sekundärkreis-Panel hängten ihre Instrumente bei jedem `buildPanels()`-Aufruf nur an, ohne den Behälter vorher zu leeren — anders als überall sonst im Leitstand. Nach "Neustart" (0.0.20) oder einer neuen Partie blieben die alten Instrumente als Leichen im DOM stehen, für immer auf "—" eingefroren, während die neuen daneben live liefen. Jetzt wird jeder der drei Behälter vor dem Befüllen geleert.

## 0.0.29

- ☢️ **Fukushima-1-Szenario, mit echter neuer Physik statt reiner Datendatei.** Bisher konnte kein Reaktortyp durch reinen Kühlungsverlust nach der Abschaltung schmelzen — Zerstörung ging immer nur über einen Leistungsausflug. Für den Siedewasserreaktor jetzt vier neue, dauerhafte Systeme:
  - **Notkondensator (Isolation Condenser).** Reiner Naturumlauf-Wärmetauscher, schaltet sich bei Isolierung (SCRAM + geschlossene Frischdampf-Absperrung) automatisch zu. Die Ventile sind fail-safe ZU ausgelegt — fehlt der Gleichstrom, fallen sie in ihre sichere Stellung, unbemerkt, weil dieselbe Störung auch die Anzeige einfrieren lässt. Genau die Fehlerkette von Fukushima-1, 2011.
  - **Kernfreilegung.** Sinkt der Füllstand unter die obere Kernkante, bricht die Kühlung ein — reine Nachzerfallswärme reicht jetzt aus, um die Hüllrohrgrenze und danach die Brennstoff-Zerstörungsgrenze zu reißen, ganz ohne Reaktivitätsausflug. Per Kopfsimulation geprüft: unbedient Kernschaden nach rund drei Stunden, Löschwassereinspeisung bis ~100 Minuten nach Stromausfall rettet den Kern noch, ab ~150 Minuten ist es zu spät.
  - **Löschwassereinspeisung.** Einziges Wasser, das auch im vollständigen Stromausfall noch fließt — kein Motor, keine Elektronik.
  - **Sicherheitsbehälter mit Venten und Wasserstoff.** Sicherheitsventil-Dampf baut Behälterdruck auf; kontrolliertes Venten verhindert ein Versagen, setzt aber radioaktives Gas frei. Oberhalb 1200 °C Hüllrohrtemperatur entsteht Wasserstoff aus der Zirkon-Wasser-Reaktion — spätes Venten bei hohem Wasserstoffstand kann zur Explosion im Reaktorgebäude führen, wie 2011.
  - `sanitize()`-Grenzen für Kühlmitteltemperatur von 1000 K auf 4000 K angehoben — die alte Grenze klemmte die neue Dampfkühlung bei Kernfreilegung fälschlich als „Rechenfehler".
  - Neues Panel „Sicherheitssysteme" mit drei neuen Reglern, drei neuen Anzeigewerten, zwei neuen Meldungen.

## 0.0.28

- 📖 **Meldetafel-Hilfe komplett neu geschrieben, alle 28 Meldungen.** Die Kurzfassung aus 0.0.17 sagte nur, was passiert — nicht mehr, was konkret zu tun ist. Jeder Text hat jetzt die genaue Auslösebedingung mit Zahlen, dann eine Schritt-für-Schritt-Liste mit den tatsächlichen Reglernamen aus dem Leitstand ("Hauptumwälzpumpen", "Druckhalter-Sprühen", "Frischdampf-Absperrung" usw.) statt allgemeiner Stichworte. Modal zeigt jetzt mehrzeilig mit Aufzählungspunkten (`white-space: pre-line`), etwas breiter für den längeren Text.

## 0.0.27

- 💡 **Fließbild zeigt jetzt, welches Bauteil eine anstehende Meldung betrifft.** Bisher stand das nur auf der Meldetafel — jetzt bekommt das betroffene Bauteil (Kern, Druckhalter/Dampferzeuger/Trommel, Hauptkühlmittelpumpe, Generator, je nach Typ) einen farbigen Rand in derselben Schwere-Farbe wie die Meldetafel, bei Auslösung zusätzlich blinkend. Neues Feld `alarmComponents` je Typdatei ordnet jede Meldung ihrem Bauteil zu.

## 0.0.26

- 🐛 **Druck-Rundinstrument stand bei Siedewasserreaktor und RBMK dauerhaft im Roten.** Die Skala war fest auf den Druckwasserreaktor zugeschnitten (100-180 bar, Normalbereich 140-168) — Siedewasserreaktor (Domdruck, Nennwert 70,7 bar) und RBMK (Trommeldruck, 69 bar) liegen mit ihrem gesamten Normalbetrieb unterhalb der Skala, die Nadel klebte deshalb immer am unteren Anschlag im roten Bereich, selbst bei sauberstem Volllastbetrieb. Skala kommt jetzt aus der Typdatei (`pressureGauge`): DWR unverändert, SWR 40-90 bar (Normalbereich 58-76), RBMK 40-85 bar (Normalbereich 55-73) — beide mit Auslösewert als Randbedingung der roten Zone.

## 0.0.25

- 🐛 **"Generator"-Beschriftung im Fließbild lief über den Bildrand.** Der Text stand seit jeher linksbündig ab x=470 in einer 520 breit angelegten Zeichenfläche — bei "Generator" reicht das bis etwa x=525, fünf Einheiten über den Rand. Solange der Anzeigebereich breiter als das Fließbild-Seitenverhältnis war, blieb das durch den Leerraum links/rechts der Zeichnung unsichtbar; passte die Fläche genau in der Breite (schmalerer Bildschirm, schmaleres Panel), schnitt die SVG selbst den Überstand ab. Jetzt rechtsbündig mit Rand vor dem Zeichenflächenrand, bei allen drei Reaktortypen — verschwindet bei keiner Fenstergröße mehr, weil nichts mehr über die deklarierte Fläche hinaus gezeichnet wird.

## 0.0.24

- 🐛 **Turbine blieb nach einem Schnellschluss für immer vom Netz.** `s.turbineTripped` und der Turbinenregler (`govCtl.trip()`) wurden nirgends zurückgesetzt — weder nach einem Turbinenschnellschluss durch SCRAM noch nach der eigenständigen Störung `turbine_trip`/`loss_of_load`. Der Generator blieb für den Rest des Laufs bei 0 MW, ganz gleich wie stabil der Reaktor stand. Neuer Knopf **"Turbine zuschalten"** im Netz-Panel (nur aktiv, wenn wirklich etwas zu tun ist) — gesperrt, solange der Reaktorschutz noch steht, genau wie beim Reaktorschutz selbst (0.0.18).

## 0.0.23

- 🔊 **Anlagengeräusche statt Gepiepse.** Die Meldehupe war ein einzelner Rechteck-Ton auf einer Frequenz — jetzt zwei leicht verstimmte Sägezahn-Oszillatoren durchs Tiefpassfilter, die gegeneinander schweben, wie eine echte elektromagnetische Hupe. TRIP-Meldungen bekommen die höhere, dringlichere Stimme.
- 💥 **SCRAM hat jetzt ein Geräusch:** tiefer Schlag (Relais/Magnetventil), ein kurzer metallischer Klack, danach abklingendes Zischen (Dampf/Druckluft) — alles aus Oszillator und gefiltertem Rauschen, keine Datei.
- ☢️ **Kernzerstörung hat jetzt ein Geräusch:** ein Knall aus breitbandigem Rauschen, darunter mehrere Sekunden tiefes Grollen. Vorher stumm.
- Weiterhin keine Audiodatei im Spiel — alles synthetisiert über die Web Audio API, wie schon die alte Hupe.

## 0.0.22

- 🐛 **Neustart zeigte sofort wieder "Kernzerstörung".** Der Knopf aus 0.0.20 stoppte die alte Spielschleife nie -- sie lief pausiert weiter, sah beim nächsten Bild noch `destroyed` vom alten Lauf zusammen mit dem eben erst zurückgesetzten `endShown` und zeigte den Dialog erneut, jetzt mit den Werten der frischen Anlage. `boot()` stoppt jetzt zuerst jede laufende Schleife, bevor eine neue entsteht.
- 📊 **Statuszeile: Marge und Brennstofftemperatur** sind jetzt immer sichtbar, nicht nur im jeweiligen Tab -- die zwei Werte, die tatsächlich über einen Kernschaden entscheiden, standen bisher nur im Panel des laufenden Reiters.
- 🎨 **Therm. Leistung und Generator färben sich jetzt nach Zustand** statt fest verdrahtet Blau zu bleiben: Leistung ab 100 % gelb, ab 110 % rot; Generator gelb ohne Netzschalter bei anstehender Anforderung, rot bei abgeworfener Turbine.
- 🎯 **Zwei neue Extremszenarien.** *Klemmendes Abblaseventil* (DWR, Seed 1979 — Three Mile Island): Druck und Füllstand fallen langsam, die Meldetafel warnt früh, wer sie überhört verliert DNBR. *Dichtewellen-Instabilität* (SWR, Seed 1988 — LaSalle): Umwälzstrom bricht ein, wer die Leistung trotzdem mit den Stäben nachzieht statt zuerst den Durchsatz wiederherzustellen, treibt den Kern in die gesperrte Ecke des Kennfelds. Beide per Kopfsimulation geprüft: unbedient gefährlich, rechtzeitiges Eingreifen rettet den Kern.

## 0.0.21

- 🖼️ **Logo und Icons.** ReactorSim war bisher komplett unbebrandet — kein Favicon, kein Icon, ein leerer Tab. Jetzt Favicon (ICO + PNG), Apple-Touch-Icon, ein Icon-Badge auf dem Startbildschirm und ein Web-Manifest für "Zum Startbildschirm hinzufügen". Die Anmeldeseite bekommt bewusst kein Favicon — sie darf laut eigenem Kommentar keine Datei nachladen, die hinter derselben Anmeldung liegt.
- 📄 README bekommt ein Logo oben.

## 0.0.20

- ✏️ **Meldetafel-Hilfe an das manuelle SCRAM angepasst.** Alle Hilfetexte von 0.0.17 gingen noch von automatischer Abschaltung aus ("SCRAM ist bereits ausgelöst"). Seit 0.0.19 stimmt das nicht mehr — jeder betroffene Text sagt jetzt "SCRAM auslösen" statt eine bereits erledigte Sache zu behaupten.
- 🔺 **Meldetafel-Schwere jetzt auch als Form, nicht nur als Farbe.** ● Hinweis, ▲ Warnung, ■ Auslösung — für Rot-Grün-Schwäche war Warnung gegen Auslösung bisher nicht zu unterscheiden.
- ⌨️ **Steuerstäbe fahren jetzt auch über die Tastatur.** Die Halteknöpfe reagierten bisher nur auf Maus/Touch (`pointerdown`/`up`), Tab+Enter/Leertaste tat nichts. Dazu Pointer Capture, damit ein Loslassen neben dem Knopf den Fahrbefehl nicht unbemerkt weiterlaufen lässt.
- 🔁 **Neustart-Knopf** in Auswertung und Kernzerstörung — gleicher Typ, gleiches Szenario, sofort von vorn, ohne den Umweg über Menü und Einweisung.
- 📖 **Grundlagen-Glossar** über den neuen „?"-Knopf im Leitstand: 13 Begriffe kurz erklärt (Reaktivität, DNBR/CPR, Xenon, ORM, Void-Koeffizient, SCRAM/RESA/AZ-5, Meldetafel-Zustände, …) — kein Lehrgang, nur zum Nachschlagen.
- 🧹 Zwei tote Übersetzungsschlüssel entfernt (`start_scenarios_soon`, `start_difficulty`) — Reste eines nie gebauten Reglers, nirgends mehr referenziert.
- 🖼️ **RBMK-Fließbild: Abschaltreserve statt Graphittemperatur am Kern.** Die Graphittemperatur hat eine Zeitkonstante von 35 Minuten — über eine Schicht sieht sie praktisch unbewegt aus, und stand dazu direkt unter der Beschriftung "Druckröhren", als gehörte sie dazu. Am selben Fleck steht jetzt die ORM, selbst beschriftet ("ORM …") und rot/gelb bei Unterschreitung — die Zahl, die bei diesem Typ tatsächlich in Echtzeit über Gefahr entscheidet.

## 0.0.19

- ⚠️ **Schnellabschaltung löst nicht mehr von selbst aus.** Bisher schaltete jede Meldung mit `action: 'scram'` (Leistung hoch, DNBR niedrig, Kühlmittelverlust, …) den Reaktor automatisch ab — der Bediener bekam davon oft nur die Meldetafel zu sehen. Jetzt meldet das System weiterhin zuverlässig (Kachel, Hupe, Protokoll), greift aber nicht mehr ein: die Schnellabschaltung ist allein Sache des Bedieners am SCRAM/RESA/AZ-5-Knopf. Wer nicht reagiert, riskiert jetzt echten Brennstoffschaden — bei allen drei Reaktortypen.

## 0.0.18

- 🐛 **Reaktorschutz saß nach einer Schnellabschaltung für immer fest.** Einmal ausgelöst — auch automatisch, etwa durch „Leistung hoch" — fuhr die Engine die Stäbe für den Rest des Laufs zwangsweise auf „ganz eingefahren", ganz gleich was der Bediener einstellte: kein Zurück in den Normalbetrieb, alle drei Reaktortypen betroffen. „Rückstellen" gibt den Reaktorschutz jetzt frei — aber erst, wenn die auslösende Ursache tatsächlich weg ist, sonst bleibt er stehen, genau wie die Meldetafel selbst.

## 0.0.17

- 💡 **Meldetafel erklärt sich jetzt.** Eine Kachel sagte bisher nur, dass etwas ansteht — nicht, was es bedeutet oder was zu tun ist. Klick (oder Enter/Leertaste) auf eine Meldung öffnet eine kurze Erklärung mit der empfohlenen Handlung, auf Deutsch und Englisch.

## 0.0.16

- 🔧 **Generator-Beschriftung lag auf der Turbine und dem Abdampfrohr.** Text und Messwert standen zentriert über/unter dem Generatorkreis — geometrisch genau in der Spalte, in der die Turbinenkontur endet und das Abdampfrohr senkrecht nach unten läuft. Jetzt steht beides seitlich rechts vom Generator, frei von beiden.

## 0.0.15

- 🎛️ **„Hand" hat jetzt auch einen Hebel.** Bisher gab es nur den Umschalter: der Regler hörte auf zu regeln, und der Spieler hatte trotzdem nichts, womit er stellen konnte. Beim Speisewasser war es sogar schädlich — der Handwert stand auf Volllast, beim Druckhalter auf „Heizung aus". Jetzt ist jede Betriebsart eine **Regelstation**: Umschalter plus Stellschieber, der in Automatik mitläuft und in Hand dem Bediener gehört.
- 🤝 **Stoßfreie Übernahme.** Wer auf Hand schaltet, übernimmt genau den Wert, der gerade steht — nichts springt. Ein Regler, bei dem schon das Umschalten eine Störung auslöst, wird nie benutzt, und dann ist die Handbedienung wertlos, obwohl sie da ist.
- 🔧 **Stationen je Typ:** Regelventil und Speisewasser bei allen dreien, dazu Druckhalter-Heizung und -Sprühen beim Druckwasserreaktor.
- 🎚️ **Der Schalter „Stabregelung" zeigt endlich auf den Regler, der die Stäbe wirklich führt.** Beim Druckwasserreaktor die Temperaturregelung, beim RBMK der Leistungsregler — dort heißt der Schalter jetzt auch so. Beim Siedewasserreaktor führt gar keiner die Stäbe, also gibt es dort auch keinen Schalter mehr: das Stellglied ist der Umwälzstrom.
- 📝 Unter jeder Station steht in einem Satz, was Handbetrieb dort bedeutet.

## 0.0.14

- 🎚️ **Automatik/Hand als Zweifeld-Umschalter statt als Einzelknopf.** Vorher trug ein Knopf seinen eigenen Zustand als Aufschrift — „Turbinenregler [Hand]" liest sich aber wie ein Angebot, auf Hand zu schalten, und nicht wie die Feststellung, dass er längst darauf steht. Jetzt stehen beide Felder nebeneinander, das geltende ist hervorgehoben: Automatik grün, Hand bernstein. In einer Leitwarte muss auf einen Blick sichtbar sein, was gilt — nicht, was passieren würde.

## 0.0.13

- 🔐 **Anmeldung.** Die Seite stand bisher offen — wer die Adresse kannte, war drin. Jetzt ein Konto, Benutzername und Passwort aus `REACTORSIM_USER` und `REACTORSIM_PASSWORD`, also aus der Dockge-Konfiguration. Mehrbenutzerbetrieb folgt später.
- 🛡️ **Ohne gesetztes Passwort steht die Seite trotzdem nicht offen.** Fehlt `REACTORSIM_PASSWORD`, erzeugt ReactorSim beim ersten Start ein zufälliges, schreibt es **einmal** ins Protokoll und legt nur den scrypt-Hash in `./data/auth.json` ab (Rechte 0600). Ein Dienst im Internet, der auf ein gesetztes Passwort hofft, ist ein Dienst ohne Passwort.
- 🚪 **Geschützt ist alles außer zwei Pfaden.** `/health` bleibt offen, sonst meldet Docker den Container dauerhaft als krank; `/login` kann nicht hinter der Anmeldung liegen. Alles andere — Seite, Statics, gesamte JSON-Schnittstelle — braucht eine Sitzung. Ein Test geht die Liste durch, damit kein neuer Pfad versehentlich offen bleibt.
- 🍪 **Sitzung als signiertes Token** (itsdangerous) in einem HttpOnly-Cookie mit SameSite=Lax, 30 Tage gültig, `secure` sobald über HTTPS aufgerufen. Der Signierschlüssel liegt in `./data/secret.key` — dadurch überlebt die Anmeldung einen Neustart des Containers.
- 🚧 **Gegen Durchprobieren** zehn Versuche je Minute und Absenderadresse. Das Passwort wird auch bei falschem Benutzernamen geprüft, sonst verrät die Antwortzeit, welcher Name existiert. Das Anmeldeformular trägt ein CSRF-Token, und `?next=` akzeptiert nur anwendungseigene Pfade — eine Anmeldeseite, die Besucher auf fremde Seiten weiterleitet, wäre eine offene Weiterleitung.
- 🔁 **Abgelaufene Sitzung wird sichtbar.** Antwortet die Schnittstelle mit 401, springt der Browser auf die Anmeldeseite, statt still nichts mehr zu speichern.
- ✅ **88 Tests** — 74 unter `node --test`, 54 unter `pytest` (davon 14 neu für den Zugang).

## 0.0.12

- 🔤 **Beschriftung der Rundinstrumente steht jetzt über dem Zifferblatt statt darauf.** Vorher lief der Schriftzug mitten durch den oberen Bogen, und lange Bezeichnungen wurden abgeschnitten — „Unterkühlungsspanne" passt bei 108 Pixeln Instrumentenbreite in keine Zeile. Sie darf nun zweizeilig umbrechen, und alle Instrumente einer Reihe beginnen trotzdem auf gleicher Höhe.
- 🧹 **Jeder Reaktortyp zeigt nur noch seine eigenen Messwerte.** Die Panels tragen die Zeilen aller drei Typen, weil sie fest im Template stehen — ein Druckwasserreaktor zeigte deshalb Abschaltreserve, Void-Koeffizient und Graphittemperatur als Striche. Sieben leere Zeilen sehen nach kaputter Anzeige aus, nicht nach „gibt es hier nicht".
- 📏 **CPR statt DNBR bei den siedenden Kernen.** Der Abstand zur Siedekrise heißt beim Druckwasserreaktor DNBR, bei Siedewasserreaktor und RBMK aber CPR — im Kern siedet es dort ohnehin überall, gefragt ist, wie viel Leistung bis zur Austrocknung fehlt. Wie schon bei RESA/SCRAM/AZ-5 steht der Name in der Typdatei.

## 0.0.11

- 🐛 **Siedewasserreaktor und RBMK sahen aus wie Vorschau, obwohl sie fertig sind.** Die Klasse zum Ausgrauen stand fest im Template — aus der Zeit, als nur der Druckwasserreaktor gebaut war. Beide waren tatsächlich anklickbar und voll spielbar, sie sahen nur nicht so aus. Das Ausgrauen entscheidet jetzt dieselbe Stelle, die auch prüft, ob ein Typ überhaupt spielbar ist.

## 0.0.10

- 🔴 **Die Schnellabschaltung heißt jetzt, wie sie im jeweiligen Leitstand heißt.** Im deutschen **RESA**, im englischen **SCRAM**, beim RBMK in beiden Sprachen **AZ-5** — Notschutz fünfter Kategorie. „SCRAM" pauschal über alle drei Typen zu schreiben war amerikanisch für zwei Anlagen, die es nie so genannt hätten, und schlicht falsch für die dritte. Der Name gehört zum Reaktortyp, nicht zum Knopf: er steht in der Typdatei und wird von dort gezogen.
- 💬 Dazu ein Hinweistext beim Überfahren, der sagt, was passiert — inklusive der achtzehn Sekunden und der Graphitspitzen beim RBMK.

## 0.0.9

- 💾 **Speichern und Fortsetzen.** Ein Knopf in der Statuszeile legt den Stand ab, der Startbildschirm bietet ihn beim nächsten Mal zum Fortsetzen an. Der Stand wird erst angewandt, wenn die Anlage steht — Regler und Pumpen schwingen sich dann aus dem geladenen Zustand von selbst ein, statt mit fremden Integralständen weiterzulaufen.

## 0.0.8

- 💾 **Spielstände und Bestenliste.** Ablage unter `./data`, ohne Anmeldung: ein zufälliges Token im Cookie erkennt das Gerät wieder, mehr wird nicht gespeichert. Nach jeder Schicht lässt sich das Ergebnis mit einem Namen eintragen; die Bestenliste zum Szenario steht direkt darunter.
- 🔒 **Der Server glaubt dem Browser den Punktestand nicht.** Der Client meldet Kennzahlen, der Server rechnet daraus mit derselben Formel neu. Ein mitgeschicktes `score`-Feld wird gar nicht gelesen. Die Formel steht deshalb zweimal — in JavaScript und in Python — und eine gemeinsame Fixture-Datei hält beide Seiten zusammen.
- 🧱 **Plausibilitätsprüfung statt blindem Vertrauen.** Mehr Energie, als die Anlage in der Zeit liefern kann, eine längere Schicht als das Szenario dauert, negative Abweichungen, Überschreitungszeiten länger als der Lauf — alles abgewiesen. Reaktortyp und Szenario müssen zueinander passen und beide aus der serverseitigen Liste stammen.
- 🚧 **Ratenbegrenzung in zwei Stufen.** Oben eine weite Grenze gegen das bloße Fluten, die enge Grenze (ein Eintrag je Minute) erst kurz vor dem Schreiben. Stünde sie oben, würde eine einzige fehlerhafte Anfrage den nächsten gültigen Eintrag für eine Minute blockieren. Gezählt wird je Spieler **und** je Absenderadresse — ProxyFix ist aktiv, sonst teilen sich hinter einem Reverse Proxy alle dieselbe Grenze.
- 📦 **Der Spielstand ist für den Server undurchsichtig.** Er speichert ihn und gibt ihn zurück, ohne hineinzusehen: die Struktur gehört der Simulation, und eine Prüfung im Server wäre eine zweite, stets veraltete Kopie davon. Geprüft wird beim Laden im Browser — ein kaputter Stand wird verweigert, statt NaN in die Engine zu füttern.
- 🧪 **Struktur- und Sprachtests.** Ein Test läuft den ES-Modul-Importgraph ab `main.js` ab und prüft jede erreichte Datei gegen die COPY-Zeilen des Dockerfiles: ein vergessenes Modul stürzt nicht ab, es liefert still 404 und eine halbtote Oberfläche. Ein zweiter prüft Schlüsselgleichheit und Platzhalter beider Sprachdateien und sucht nach fest verdrahtetem deutschem Text außerhalb von Kommentaren.
- ✅ **104 Tests** — 74 unter `node --test`, 30 unter `pytest`.

## 0.0.7

- 📋 **Szenarien statt nur freiem Spiel.** Fünf Schichten zur Auswahl: Lastfolge und Turbinenschnellschluss am Druckwasserreaktor, Lastfolge über den Umwälzstrom und Frischdampf-Absperrung am Siedewasserreaktor, Nachtschicht am RBMK. Jedes Szenario bringt eine Bedarfskurve, geplante Störungen, Ziele und Fehlbedingungen mit — als Datendatei, nicht als Code.
- 🎲 **Störungszeitpunkte sind gesät, nicht zufällig.** `"rand(6000,8400)"` wird über den Startwert des Szenarios aufgelöst. Derselbe Startwert ergibt dieselbe Schicht — sonst gäbe es keine Wiederholbarkeit und keinen Regressionstest.
- 💣 **Störungsbibliothek.** Eine Störung fasst den Zustand an und sonst nichts: eine ausgefallene Pumpe ist eine ausgefallene Pumpe, der Rest folgt aus der Physik. Klemmende Stabgruppe, klemmendes Abblaseventil, Dampferzeuger-Rohrleck, Speisewasserausfall, unkontrollierte Bor-Verdünnung, Frischdampf-Absperrung, Pumpenausfälle, abgeschalteter Leistungsregler, Turbinenschnellschluss, Netzabwurf.
- 🏁 **Einweisung und Auswertung.** Vor der Schicht steht, worum es geht; danach die Punkte mit ihrer Aufschlüsselung. Gewertet werden gelieferte Energie, Abweichung vom Bedarf, unquittierte Alarmsekunden, Grenzwertüberschreitungen nach Schwere, Schnellabschaltungen und Brennstoffschaden.
- ⏱️ **Die Spielschicht sieht jeden Rechenschritt, nicht jedes Bild.** Eine Störung, die auf Sekunde 1200 fällt, darf bei 60-fachem Zeitraffer nicht zwischen zwei Bildern verschwinden.
- ✅ **74 Tests.** Darunter: jedes Szenario läuft unbedient bis zum Ende durch, ohne Ausnahme und ohne ungültigen Zustand; jeder Szenariotext existiert in beiden Sprachen; die Wertungsformel liegt als Fixture-Datei fest, die später auch die Python-Seite prüft.

## 0.0.6

- ☢️ **Der RBMK-1000 ist spielbar.** Graphitmoderiert, Druckröhren, Trommelabscheider, acht Hauptumwälzpumpen. Alle drei Reaktortypen sind damit verfügbar.
- ➕ **Positiver Dampfblasenkoeffizient, abhängig von der Abschaltreserve.** Bei nominal 46 eingefahrenen Stäben sind es +20 pcm je Prozentpunkt Blasenanteil, bei leerem Kern über +60. Die Abschaltreserve ist damit kein Anzeigewert, sondern der Parameter, der den gefährlichsten Kennwert der Anlage einstellt.
- 🔻 **Die Vorgeschichte fährt sich von selbst.** Leistung absenken, warten: Xenon baut auf, der Leistungsregler zieht die Stäbe, die Abschaltreserve schmilzt von 58 auf unter 15 — in gut vierzig Minuten. Nichts daran ist gescriptet; es fällt aus denselben Gleichungen wie der Normalbetrieb.
- 💥 **AZ-5 mit Graphitspitzen, in beide Richtungen.** Bei niedriger Abschaltreserve fügt die Schnellabschaltung **positive** Reaktivität ein: die Einfuhr erreicht 1,7 β, die Leistung steigt in zweieinhalb Sekunden auf das Achthundertfache, der Brennstoff zerlegt sich. Aus dem Nennbetrieb dagegen ist dieselbe Schnellabschaltung durchweg negativ und schaltet sauber ab. Beides muss stimmen — sonst wäre es ein Zwischenfilm mit Physik-Anstrich, und ein Test hält genau das fest.
- 🧮 **Der Absorber wird während des Verdrängerwegs herausgerechnet.** Der allgemeine Stabbeitrag zählt ihn vom ersten Zentimeter an mit, weil er nichts von Graphitverdrängern weiß. Ohne diese Verrechnung standen +350 pcm Graphit gegen −830 pcm Absorber, und die Eigenheit, um die es bei diesem Reaktortyp geht, hätte es im Spiel nicht gegeben.
- 🔁 **Axiale Xenon-Schwingung** aus zwei Zonen mit eigener Vergiftung. Sie wandert über gut einen Tag hin und her, statt wegzulaufen — die erste Auslegung der Steifigkeit hatte eine Schleifenverstärkung über eins, und das Flussprofil kippte binnen zwei Stunden ganz nach unten.
- ⚙️ **Leistungsregler auf die Stäbe.** Wo der Kern selbst die Leistung macht, braucht es einen Regler, der direkt darauf geht. Ohne ihn trieb allein der Xenon-Abbrand die Anlage in drei Stunden über die Leistungsauslösung — ein Reaktor mit schwachem Leistungskoeffizienten hat keinen Grund, von selbst auf seinem Arbeitspunkt zu bleiben.
- 🔧 **Ein Fehler, der alle drei Typen betraf:** der Druckregler des Turbinenventils konnte nie unter 30 % schließen, weil er sich dieselbe schmale Stellgrenze mit dem Lastregler teilte. Bei kleiner Leistung lief die Anlage dadurch leer — der Trommeldruck fiel von 69 auf 12 bar, und der Blasenanteil im Kern stieg, obwohl die Leistung sank.
- 🩹 **Zweites Versagenskriterium für den Brennstoff.** 963 J/g gilt für die heißeste Tablette; unser Modell führt einen Knoten für den ganzen Kern. Dazu kommt deshalb der Enthalpie-Zuwachs gegenüber dem Betriebszustand — das Kriterium, das bei einer schnellen Exkursion tatsächlich zuerst greift.
- 🖼️ **Eigenes Fließbild** mit Graphitblock, Druckröhren, Trommelabscheider und innerer Umwälzschleife. Der Block glüht mit der Graphittemperatur, die ihrer eigenen halben Stunde Zeitkonstante folgt.
- ✅ **65 Tests.**

## 0.0.5

- ⚛️ **Der Siedewasserreaktor ist spielbar.** 3840 MWth / 1344 MWe, ein Kreislauf, Dampf direkt zur Turbine. Das Regelventil hält den Domdruck, die Leistung macht der Kern — über den Umwälzstrom. Zwischen 100 und 80 % Durchsatz liegen 11 % Leistung, ohne dass ein Stab sich bewegt.
- 🌀 **Dichtewelleninstabilität.** Bei viel Leistung und wenig Durchsatz koppeln Dampfgehalt, Druckverlust und Durchsatz zu einer Schwingung, die sich aufschaukelt statt abzuklingen. Der Grenzzyklus begrenzt sich zwar selbst, aber erst bei knapp 30 % Ausschlag — die Schwingungsüberwachung löst vorher aus.
- 💨 **Frischdampf-Absperrung mit dem richtigen Vorzeichen.** Druck steigt, Dampfblasen fallen zusammen, mehr Moderator, **positive** Reaktivität, Leistungsspitze. Die erste Fassung ließ die Leistung dabei zurückgehen: die quasistationäre Dampfbilanz sieht nur das Gleichgewicht und kann nicht sehen, dass ein schneller Druckanstieg den vorhandenen Dampf zusammendrückt. Ohne diesen Term hätte sich der Reaktor genau bei der Störung falsch herum verhalten, für die dieser Typ bekannt ist.
- 🔬 **Ein Fehler im Blasenmodell, der das Regelorgan lahmgelegt hätte.** Der Anteil der siedenden Kanalhöhe hing zuerst nur an der Unterkühlung. Damit hob sich bei sinkendem Durchsatz der steigende Dampfgehalt gegen die schrumpfende Siedezone auf — der Blasenanteil bewegte sich um 0,4 Prozentpunkte und die Leistung um 1,9 % statt um 11 %. Richtig ist das Verhältnis der Enthalpien: was zum Aufheizen bis zur Sättigung draufgeht, siedet nicht.
- 🧩 **Die Abstraktion hat gehalten.** Der zweite Reaktortyp brauchte genau eine Erweiterung der Engine: einen Haken für den siedenden Kern, weil dort die Austrittstemperatur festliegt und die Wärme in den Dampfgehalt geht. Alles Weitere — Kinetik, Rückkopplungen, Vergiftung, Nachzerfallswärme, Meldetafel — lief unverändert. Ein Test hält das fest: der Rechenkern darf keinen Reaktortyp beim Namen nennen.
- 🎛️ **Die Oberfläche fragt den Typ nach seiner Bedienung.** Bor und Druckhalter beim Druckwasserreaktor, Umwälzstrom und Frischdampf-Absperrung beim Siedewasserreaktor. Dazu ein eigenes Fließbild mit Druckbehälter, Abscheider und innerer Umwälzschleife.
- ✅ **56 Tests,** darunter ein Nachweis, dass zwei Reaktoren gleichzeitig laufen können, ohne sich über gemeinsam genutzte Typdaten zu stören.

## 0.0.4

- 🖼️ **Anlagenfließbild.** Reaktor, Druckhalter, Hauptkühlmittelpumpe, Dampferzeuger, Regelventil, Umleitstation, Turbine, Generator und Kondensator als Schema, mit fließendem Medium in den Leitungen, Rohrfarbe nach Temperatur, glühendem Kern nach Leistung, mitlaufenden Füllständen in Dampferzeuger und Druckhalter sowie Zustandsfarbe an Pumpe, Ventilen und Generator.
- ⚡ **Bewegung ohne Rechenlast.** Der Renderlauf schreibt nur eine Handvoll CSS-Custom-Properties auf den SVG-Wurzelknoten; Fluss, Drehzahl und Farbmischung entstehen daraus in CSS. Das sind rund zehn Schreibvorgänge je Takt statt hunderter DOM-Zugriffe — der Unterschied zwischen flüssig und ruckelig auf einem älteren Handy.
- 🔇 Bei `prefers-reduced-motion` stehen Fluss und Pumpenrad still, die Zustandsfarben bleiben.

## 0.0.3

- 🏭 **Der Druckwasserreaktor ist spielbar.** Vollständiger Kreislauf: Kern, vier Hauptkühlmittelpumpen mit Auslauf, heißer und kalter Strang als echte Laufzeit, Dampferzeuger mit Rohrmetallknoten, Druckhalter mit Heizstäben, Sprühwasser und Abblaseventil, Frischdampfschiene, Turbine, Kondensator, Speisewasser-Dreikomponentenregelung und Netzanbindung. Stabregelung, Turbinenregler, Speisewasser und Druckhalter lassen sich einzeln auf Hand umschalten.
- 🎛️ **Leitwarte mit Instrumenten statt Zahlenlisten.** Neun Rundinstrumente mit farbigen Betriebsbereichen, Stabbalken mit Sollwertmarke, die Reaktivitätsbilanz als Balken um die Nulllinie, vier Trendschreiber mit umschaltbarem Zeitbereich und eine Meldetafel mit Ringback-Folge und Hupe.
- 🧪 **Drei Fehler, die der Beharrungstest gefunden hat.** Der Dampferzeuger rechnete mit der Eintritts- statt der mittleren Rohrbündeltemperatur und entzog damit die doppelte Leistung — der Reaktor lief binnen Sekunden über die Leistungsauslösung. Das Temperaturprogramm der Stabregelung stand 1,7 K über der Mitteltemperatur, die sich aus der Wärmebilanz ergibt, und zog die Stäbe bis zum Anschlag. Und die 2,6 % Spaltenergie, die als Gammastrahlung direkt an Moderator und Einbauten gehen, fehlten in der Bilanz: 100 MW verschwanden, der Kern lief auf 104,6 %, um die Turbine trotzdem zu bedienen.
- 🎚️ **Turbinenregler mit Vorsteuerung.** Ein reiner PI auf die Leistungsabweichung scheiterte in beide Richtungen: vorsichtig ausgelegt blieb bei 60 % Last eine Dauerabweichung von 5 % stehen, kräftig ausgelegt entstand ein Grenzzyklus mit 94 MW Ausschlag im Sekundentakt. Ursache ist die kleine Streckenverstärkung — mehr Ventilöffnung senkt den Frischdampfdruck und damit die Arbeit je Kilogramm. Jetzt folgt die grobe Ventilstellung direkt der Lastanforderung, der Regler trimmt nur noch nach.
- ✅ **47 Tests.** Neu dabei: Beharrungszustand über eine Stunde, Energiebilanz über alle Kreisläufe, Schnellabschaltung, Jod-Grube mit Nachweis der fehlenden Stabwirksamkeit, Turbinenschnellschluss, Pumpenausfall, Selbstbegrenzung durch die Temperaturrückkopplungen, 4000 zufällige Bedieneingriffe ohne NaN und ein Determinismusnachweis über den Zustandshash.

## 0.0.2

- ⚛️ **Physik-Kern: Punktkinetik mit sechs Gruppen verzögerter Neutronen.** Gelöst mit einem exponentiellen Integrator — über einen Teilschritt werden die Vorläufer als Quelle festgehalten und die dann lineare Leistungsgleichung exakt gelöst. Rückwärts-Euler war der erste Ansatz und fiel durch: er ersetzt e^(a·h) durch 1/(1−a·h), und der Ratenfehler von rund a·h/2 multipliziert sich über eine prompt-kritische Exkursion auf. Zwischen dt = 0,05 s und dt = 0,0125 s lagen die Spitzenwerte 47 % auseinander. Mit der Exponentialform ist das Ergebnis praktisch unabhängig vom Zeitschritt.
- 🔥 **Reaktivitätsbilanz als Registry.** Jeder Beitrag — Stäbe, Doppler, Moderator, Dampfblasen, Xenon, Samarium, Bor, Graphit — ist ein eigener Eintrag statt einer Zeile in einer langen Formel. Die Engine verzweigt dadurch nie nach Reaktortyp, und die Oberfläche kann später ohne Zusatzarbeit zeigen, welcher Effekt gerade wie viele pcm liefert.
- ☢️ **Xenon-135 und Jod-135, in Vielfachen des Volllast-Gleichgewichts gerechnet.** Das kürzt Spaltquerschnitt und Fluss aus den Gleichungen und lässt genau das Verhältnis stehen, das die Jod-Grube bestimmt. Nach einer Abschaltung aus Volllast steigt die Xenon-Vergiftung auf das 1,9-Fache und erreicht ihr Maximum nach 8,5 Stunden — geprüft gegen die analytische Lösung, nicht gegen eine erinnerte Zahl.
- 🌡️ **Nachzerfallswärme in vier exponentiellen Gruppen** statt der bei t = 0 singulären Way-Wigner-Form. Trifft die ANS-5.1-Referenzpunkte über fünf Zehnerpotenzen: 4,2 % nach 10 s, 2,7 % nach 100 s, 0,89 % nach einer Stunde.
- 🎲 **Gesäter Zufall (xoshiro128+) statt Math.random.** Ohne reproduzierbare Folge gäbe es keine Wiedergabe eines Laufs und keine Regressionstests gegen einen festen Startwert.
- ✅ **33 Tests unter `node --test`,** darunter die Inhour-Gleichung als kanonische Prüfung des Kinetiklösers — sie wird im Test selbst numerisch gelöst, nicht als Zahl hinterlegt.

## 0.0.1

- 🏗️ **Erste Fassung: Gerüst und Leitstands-Oberfläche.** ReactorSim startet als eigenständiger Container (Port 17779, `docker-compose.yml` für Dockge) und liefert den kompletten Aufbau der Leitwarte: Startbildschirm mit den drei Reaktortypen, Statuszeile, acht Panels, Meldetafel und Trendbereich. Die Simulation dahinter ist noch ein Platzhalter — sie bewegt die Anzeigen, rechnet aber noch keine Physik. Der echte Kern folgt in 0.0.2.
- 📱 **Hochformat und Desktop aus demselben DOM.** Schmale Bildschirme bekommen Reiter, breite ein festes Raster mit dem Fließbild in der Mitte. Umgeschaltet wird ausschließlich per CSS — kein Layout-JavaScript, kein Resize-Handler.
- ⏱️ **Zeitraffer ohne Genauigkeitsverlust.** Der Simulationsschritt liegt fest bei 0,05 s; 1×, 4×, 16× und 60× ändern nur die Anzahl Schritte je Sekunde. Bei Rechenrückstand wird der Überschuss verworfen und gemeldet, statt sich zur Todesspirale aufzustauen.
- 🌍 **Deutsch und Englisch von Anfang an.** Kein Text steht fest im Code; die Übersetzungstabelle wird als Ganzes ins Skript gereicht.
- 🧠 **ES-Module statt Einzeldatei, mit versionierten Pfaden.** Ein `?v=`-Anhang bustet die Unterimporte eines Moduls nicht — der Browser würde nach einem Versionssprung eine neue `main.js` gegen veraltete Module laufen lassen. Die Statics liegen deshalb unter `/s/<version>/`, damit jede relative Einbindung die Version erbt.
