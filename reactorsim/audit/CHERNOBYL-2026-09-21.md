# Chernobyl-Übung: drei offene Punkte nachgemessen

Stand: 21.09.2026, Release 0.6.4. Betrifft drei der vier bekannten Grenzen aus
`BACKLOG.md`, Abschnitt „Chernobyl-Tutorial". Der vierte — die Abschaltreserve
zeigt 0,0 statt der dokumentierten 6-8 Stabäquivalente — bleibt offen und ist
bewusst nicht Teil dieser Arbeit: er sitzt in der Stabkurve selbst
(`rbmk.js: _tipReactivity`) und beträfe jedes RBMK-Szenario.

Alle Zahlen hier stammen aus Werkzeugen unter `tests/tools/`, nicht aus
Schätzungen. Jedes ist einzeln aufrufbar und schreibt seine Tabelle auf die
Standardausgabe.

## 1. Die Rotorzeitkonstante τ = 15 s

**Frage:** Die Übung steht und fällt mit dem Auslauf des Turbogenerators
(`rbmk.js: sp.turbogen`). τ = 15 s war gesetzt, nicht hergeleitet — und
herleiten lässt es sich auch nicht: τ = J·ω₀²/(2·P₀) bräuchte die
Rotorträgheit von TG-8, für die es keine nachschlagbare Quelle gibt.

**Stattdessen gemessen** (`tests/tools/chernobyl_tau_sweep.mjs`), was mehr wert
ist als eine Herleitung: hängt das Ergebnis überhaupt an der Zahl? Je
Einstellung wird der geskriptete Lauf komplett gefahren und zusätzlich das
Wirkfenster abgetastet — zu welchen Sekunden nach Auslaufbeginn zerstört AZ-5
den Kern?

```
tau   Pumpen   AZ-5 (Drehbuch)  Zerstörung   Spitze   Wirkfenster (s)   36 s drin
  8s       4      01:23:40       01:23:45     292 %   10-65             ja
 10s       4      01:23:40       01:23:45     295 %   10-70 (+2 Inseln) ja
 12s       4      01:23:40       01:23:45     299 %   10-75 (+2 Inseln) ja
 15s       4      01:23:40       01:23:45     299 %   15-90 (+1 Insel)  ja   <- heute
 18s       4      01:23:40       01:23:45     301 %   15-110            ja
 22s       4      01:23:40       01:23:45     306 %   20-120            ja
 30s       4      01:23:40       01:23:46     299 %   25-120            ja
 15s       3      01:23:40       01:23:46     298 %   25-120            ja
 15s       5      01:23:40       01:23:45     289 %   10-50             ja
 15s       6      01:23:40       keine        264 %   10-30             NEIN
```

Abgetastet alle 5 s bis 120 s. Der *untere* Rand ist scharf und wandert
sauber mit τ; der obere franst aus (einzelne überlebende Sekunden zwischen
zerstörenden — „Inseln" oben), weil dort Auslauf, Blasenaufbau und der
schmale AR-Trimm gegeneinander laufen. Für die Frage dieser Messung zählt
der untere Rand: er entscheidet, ob 36 s drin liegen.

**Befund:** Über den Bereich τ = 8 bis 30 s — ein Faktor von fast vier —
ändert sich nichts Wesentliches: AZ-5 fällt auf 01:23:40, der Kern ist fünf
bis sechs Sekunden später zerstört, die historischen 36 s liegen jedes Mal im
Wirkfenster. Nur der untere Rand des Fensters wandert mit τ (10 s bei τ = 8 s,
25 s bei τ = 30 s), und das ist keine Überraschung: ein träger Rotor braucht
länger, bis der Kernstrom spürbar fällt.

τ ist damit keine Kalibrierung, an der die Nacht hängt, sondern eine
Einstellung innerhalb eines breiten Plateaus. Die Zahl bleibt gesetzt — sie
steht jetzt aber als *unkritisch nachgewiesen* da, nicht als unbelegte
Behauptung.

**Die Pumpenzahl ist der empfindlichere Parameter.** Drei, vier oder fünf
Pumpen am auslaufenden Generator tragen den Mechanismus; bei sechs (also nur
noch zwei am Netz) fällt der Kernstrom so weit, dass der geskriptete Lauf den
Kern nicht mehr zerstört. Die historischen vier liegen mittig im tragenden
Bereich, nicht an seinem Rand.

## 2. Der Speisewasserschwall um 01:19

**Umgesetzt.** Die Wirkkette steckte in `rbmk.js` längst vollständig drin, es
brauchte keine neue Physik: mehr kaltes Speisewasser → höhere Unterkühlung
(`_subcooling`) → weniger Dampfblasen (`_void`) → negative Reaktivität über
den positiven Blasenkoeffizienten. Die Übung fährt jetzt die *Handlung* —
Speisewasserregler auf Hand, hoher Stellwert — und lässt die Anlage den Rest
machen (`chernobylTutorial.js: _stepFeedSurge`).

**Gemessen** (`tests/tools/chernobyl_feed_surge.mjs`), bevor eine Zahl
festgeschrieben wurde. Gewählt: 15 % des Nennspeisestroms, 30 Sekunden.

| Größe | vorher | während | danach |
|---|---|---|---|
| Speisestrom | 112 kg/s | 231 kg/s | auf 0, dann zurück |
| Unterkühlung | 1,2 K | 2,6 K | 0 K, dann zurück |
| Blasenanteil | 5,3 % | 1,9 % | Überschwinger auf das Doppelte (10-11 %) |
| Leistung | Haltewert | −0,3 Prozentpunkte | +1,5 bis +1,6 Prozentpunkte |
| Trommelpegel | 0,50 m | bis 0,64 m | zurück auf 0,50 m |

Die zweite Hälfte des historischen Vorgangs — erst zu viel Wasser, dann zu
wenig — fährt die **Automatik** von selbst: sie nimmt den Strom zurück, um den
Pegel wieder auf den Sollwert zu bringen, und dabei kommen die Blasen mit
einem Überschwinger wieder.

**Modellgrenze, benannt statt umgangen:** Der reale Schwall lief bis kurz vor
den Versuch. So lange gehalten, fährt er den zusammengefassten Trommelpegel
dieses Modells in seinen Anschlag bei 1,00 m (Meldung „Pegel hoch" ab 0,78 m)
und lässt die Anlage mit abgestelltem Speisewasser und 9,4 % Blasenanteil in
den Test gehen — ein Zustand, auf den die AZ-5-Wirkung nicht kalibriert ist.
Nachgebildet ist deshalb der Vorgang, nicht seine Dauer.

**Gegenprobe** (dieselbe Datei, Fall „ohne Schwall" gegen „wie gebaut"): Beim
Auslaufbeginn steht die Anlage wieder dort, wo sie ohne den Schwall stünde —
Blasenanteil 5,16 statt 5,19 %. AZ-5 zerstört den Kern weiterhin, eine
Sekunde später (01:23:46 statt 01:23:45) und mit 295 statt 300 % Spitze. Mit
120 s Schwall dagegen — der Fall, der den Pegel in den Anschlag fährt —
zerstört derselbe Knopf den Kern **nicht** mehr.

## 3. Der Zeitmaßstab des Einbruchs

**Umgesetzt.** Bis 0.6.3 machte die Uhr genau einen Sprung — am Ende des
Schritts `dip`, über gut eine halbe Stunde. Der Einbruch selbst wurde seit
0.6.1 wirklich gefahren, die Erholung danach dauerte hier aber Minuten statt
der realen guten halben Stunde.

Jetzt hält der Schritt `recover` bis zur Pumpenzuschaltung um 01:07, genau wie
`hold` bis zum Testbeginn um 01:23:04 hält (`holdSeconds()` zielt bei beiden
auf eine Uhrzeit statt auf eine Zahl). Damit ist die Uhr die Betriebszeit plus
einem festen Versatz — von der Schichtübernahme bis zur Zerstörung, ohne
Sprung.

Gemessen (`tests/tools/chernobyl_full.mjs`), vorher gegen nachher:

```
                    mit Sprung (0.6.3)      gefahren (0.6.4)
dip fertig          00:01:21 / 01:04:05     00:01:21 / 00:28:21
recover fertig      00:04:13 / 01:06:57     00:39:57 / 01:06:57
Pumpen              00:04:30 / 01:07:15     00:40:15 / 01:07:15
Testbeginn          00:20:20 / 01:23:04     00:56:04 / 01:23:04
AZ-5                          01:23:40                01:23:40
Zerstörung                    01:23:45                01:23:46
Spitze                          300,4 %                 294,5 %
ORM bei 'recover'                  81,7                    72,2
```

Alle dokumentierten Uhrzeiten treffen weiterhin. Die Abschaltreserve sinkt
über die zusätzlichen 38 gerechneten Minuten von 81,7 auf 72,2 — das Xenon
baut sich auf, wie es soll; vorher fiel diese Entwicklung mit dem Sprung
einfach aus.

**Preis:** Die Übung rechnet jetzt rund 3400 statt 1200 Sekunden. Bei 1× säße
der Spieler knapp eine Stunde davor. Die Übung stellt den Zeitraffer deshalb
selbst ein (`speedHint`) und nimmt sich für die drei Stellen Zeit, an denen
etwas zu sehen ist:

- 60× durch die beiden langen Haltephasen,
- 1× für die Pumpenzuschaltung um 01:07 (der Schritttext bittet ausdrücklich
  darum, dem Kernstrom zuzusehen),
- 4× für den Speisewasserschwall samt Nachschwingen (90 s),
- 1× für den Auslauf, ¼× ab vier Sekunden vor AZ-5.

Umgeschaltet wird nur an den Flanken (`main.js: applyTutorialSpeed`) — wer
selbst am Zeitraffer dreht, behält ihn.

## Was offen bleibt

- **Die Abschaltreserve zeigt 0,0 statt 6-8 Stabäquivalente.** Unverändert
  offen, siehe `BACKLOG.md`. Ursache ist die Kurvenform `sin(π·h/span)` in
  `_tipReactivity`: sie ist bei der historischen Einfahrtiefe von 1,25 m
  (h = tip.span) exakt null, weshalb die Übung die Stäbe weiter draußen
  braucht, als sie historisch standen.
- **Nicht nachgebildet bleiben** die blockierte Turbinenschnellabschaltung und
  der ORM-Ausdruck um 01:22:30. Der Speisewasserschwall ist aus dieser Liste
  heraus.
- **Die angemeldete Dauer des Schwalls** ist eine Setzung (30 s), begründet
  durch den Pegelanschlag des Modells, nicht durch die Aufzeichnungen.
