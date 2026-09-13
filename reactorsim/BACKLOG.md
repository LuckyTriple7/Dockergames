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

### Vierter Reaktortyp

Die Schnittstelle aus `spec` und `hooks` trägt das ohne Änderung an der Engine
-- genau dafür ist sie so geschnitten. Der lehrreichste Kontrast zu den drei
vorhandenen wäre **CANDU**: Schwerwasser, positiver Dampfblasenkoeffizient wie
beim RBMK, aber mit ganz anderer Abschaltlogik, und Brennstoffwechsel im
laufenden Betrieb.

### Lauf-Export als CSV

Der Trendpuffer (`ui/trend.js`) hält die Verläufe ohnehin. Ein Knopf in der
Auswertung, der sie als CSV herausgibt, kostet fast nichts und macht einen Lauf
außerhalb des Spiels auswertbar.

### Mehrbenutzerbetrieb

`persist.py` führt schon ein Spieler-Token je Gerät, `auth.py` kennt dagegen
genau ein Konto aus der Umgebung. Erst mit echten Konten ergibt eine
Bestenliste mit Namen Sinn.
