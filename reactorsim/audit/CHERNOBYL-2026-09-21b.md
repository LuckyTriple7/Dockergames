# Chernobyl-Audit 0.6.11 — Stabgruppen, Abschaltreserve, Exkursion

Nachweise zu den Änderungen in 0.6.11 an der Übung „Block 4 – Die Nacht des
26. April". Alle Zahlen stammen aus Läufen über den echten `prepare()`-Pfad,
die Werkzeuge liegen unter `tests/tools/`.

## 1. Ausgangslage: die Zerstörung hing an vierzehn pcm

Vor 0.6.11 (`tip.worth_pcm` = 320 je Gruppe, zwei Gruppen):

| Größe | Wert |
|---|---|
| Reaktivitätsspitze nach AZ-5 | 494 pcm |
| beta | 480 pcm |
| Leistungsspitze | 295 % |
| Zerstörung | 01:23:45 |
| Abschaltreserve beim Test | 0,0 Stabäquivalente |

Der Abstand zur prompt-kritischen Schwelle betrug 14 pcm. Jede zusätzliche
Gegenkopplung in dieser Größenordnung ließ die Zerstörung ausbleiben — das
wurde beim Einbau der dritten Stabgruppe unmittelbar sichtbar (Abschnitt 2).

## 2. Die dritte Stabgruppe

Der RBMK-1000 hat 24 verkürzte Absorberstäbe (USP), die von unten einfahren.
Ihnen fehlt der Graphitverdränger am Kernboden; sie können den positiven
Schnellabschalteffekt nicht auslösen. Sie bilden jetzt eine eigene Gruppe
(`rbmk.js: rodBanks`), die Übung lässt sie beim letzten Stabzug im Kern.

Damit zeigt die Abschaltreserve beim Testbeginn:

```
187 Stäbe bei h = 0,02  ->  187 * 0,0000525 = 0,01
 24 Stäbe bei h = 0,40  ->  24  * 0,3065    = 7,36
-------------------------------------------------
Abschaltreserve                               7,4   (dokumentiert 6-8)
```

**Invarianz bei gleicher Stellung.** Die Aufteilung darf den Normalbetrieb
nicht verändern. Geprüft über einen Skalar-Auszug (n, T_f, T_cl, T_gr,
p_drum, L_drum, M_drum, x_e, Blasenanteil, Xe, I, Sm, Pm, ao, W_fw, W_steam,
P_th, P_e, rho, ORM, Blasenkoeffizient, mittlere Stabstellung; je 15 Stellen)
über 1200 Schritte gegen den Stand vor der Änderung:

| Schritt | Ergebnis |
|---|---|
| 0, 1, 4, 17 | identisch |
| 200, 600, 1200 | Abweichung in der 15. signifikanten Stelle |

Ursache ist allein die Summationsreihenfolge (2400+2694+506 gegen
2400+3200). Zwei Stellen, an denen die alte Zahl der Gruppen fest verdrahtet
war, mussten dafür mitgezogen werden: die Kritikalitätssuche beim Start und
der Leistungsregler in `stepControls` — beide bewegten nur `rod[0]`/`rod[1]`.

## 3. Kalibrierung der Verdrängerwirksamkeit

`tests/tools/chernobyl_tip_sweep.mjs`, beta = 480 pcm:

| tip_pcm | ORM | rho_max | Spitze | zerstört | Zerstörung |
|---|---|---|---|---|---|
| 640 | 7,4 | 499 | 77 % | – | – |
| 800 | 7,4 | 623 | 213 % | – | – |
| 900 | 7,4 | 698 | 342 % | – | – |
| 1000 | 7,4 | 767 | 576 % | – | – |
| 1050 | 7,4 | 798 | 727 % | ja | 01:23:42,65 |
| 1100 | 7,4 | 826 | 900 % | ja | 01:23:42,30 |
| **1150** | **7,4** | **850** | **1088 %** | **ja** | **01:23:42,10** |
| 1200 | 7,4 | 874 | 1290 % | ja | 01:23:42,00 |
| 1400 | 7,4 | 966 | 2183 % | ja | 01:23:41,65 |

Gewählt: 1150 pcm. Der tragende Bereich reicht von 1050 bis über 1400, die
Zerstörung hängt also nicht mehr an der Kalibrierung auf zehn pcm genau.

Der Zeitpunkt der Zerstörung ist über diesen ganzen Bereich kaum
beeinflussbar (2,0 bis 2,9 s nach AZ-5) und liegt damit rund zwei Sekunden
vor den dokumentierten 01:23:44 bis 01:23:47. Das ist der Preis: eine
stärkere Exkursion ist zwangsläufig eine schnellere.

## 4. Der Druckzeitpunkt entscheidet nicht mehr

Abhängigkeit vom Zeitpunkt des Knopfdrucks (Sekunden nach Auslaufbeginn):

| tip_pcm | t+0 | t+5 | t+15 | t+36 |
|---|---|---|---|---|
| 640 | 53 % | 58 % | 65 % | 77 % |
| 900 | 271 % | 297 % | 326 % | 342 % |
| 1000 | 503 % | 542 % | 574 % | 576 % |
| 1050 | 662 % ZER | 706 % ZER | 736 % ZER | 727 % ZER |
| 1150 | 1050 % ZER | 1096 % ZER | 1120 % ZER | 1088 % ZER |

Es gibt keine Wirksamkeit, bei der ein Druck bei t+36 zerstört und einer bei
t+0 nicht. Das frühere schmale Fenster (0-12 s überlebt, ab 15 s zerstört)
war eine Eigenschaft der Kante bei beta, kein eigenständiger Befund. Neu
vermessen (`chernobyl_press_window.mjs`): Zerstörungsfenster [0, 110] s.

Was weiterhin unterscheidet, ist die Stabstellung: derselbe Druck vor dem
letzten Stabzug, mit den Stäben auf Haltestellung, bleibt folgenlos.

**Nebenbefund:** `chernobyl_press_window.mjs` war seit 0.6.4 unbrauchbar. Sein
Laufbudget von 2500 s endete, bevor der Auslauf überhaupt begann (er beginnt
nach rund 3360 s, seit der Uhrensprung entfallen ist); jeder Lauf meldete
folgerichtig „nicht zerstört". Budget auf 4200 s angehoben.

## 5. Prüfung über den echten Simulationstakt

Bis 0.6.10 prüften alle Tests dieser Übung mit einem Nachbau der Schleife
(`engine.step` + `session.step` von Hand). Der Weg, den ein Spieler nimmt —
`loop.js` mit Bildtakt, den Zeitraffer-Umschaltungen der Übung und dem
Verwerfen von Rückstand bei zu langsamen Bildern — war nicht abgedeckt.

Neu: `tests/test-chernobyl-apploop.mjs` fährt genau diesen Weg mit gestellter
Uhr und gestelltem `requestAnimationFrame`.

| Bildrate | Spitze | AZ-5 | Zerstörung | Rückstand verworfen |
|---|---|---|---|---|
| 60 fps | 1022 % | 01:23:40 | 01:23:42 | nein |
| 20 fps | 1022 % | 01:23:40 | 01:23:42 | nein |
| 5 fps | 1022 % | 01:23:40 | 01:23:42 | ja |

Derselbe Test gegen den Stand 0.6.10 gefahren: AZ-5 01:23:40, Zerstörung
01:23:45, Spitze 295 % — der Kern wird dort also ebenfalls zerstört, nur mit
der alten, knappen Wucht.

## 6. Neu nachgestellt

- **Reaktorschutz beim Schnellschluss beider Turbosätze** als eigene
  Auslösung (`trip_rbmk_tg_stop`) plus Anlagenzustand „abgeschaltet"
  (`alarm_rbmk_tg_stop_blocked`). Die Übung schaltet ihn unmittelbar vor dem
  Auslaufbeginn ab, mit Eintrag in der Zeitleiste. Geprüft wird beides: scharf
  meldet er, abgeschaltet nicht, und im Nennbetrieb steht keine der beiden
  Kacheln.
- **ORM-Ausdruck um 01:22:30** als Ereignis in Zeitleiste und Lernprotokoll,
  mit eigenem Schritthinweis und Beobachtungstempo. Der Hinweis stellt die
  dokumentierten 6-8 neben die Anzeige dieses Modells, statt eine der beiden
  Zahlen zu verschweigen.
