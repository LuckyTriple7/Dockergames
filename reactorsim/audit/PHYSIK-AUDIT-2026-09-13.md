# Reactorsim 0.1.15 – Physik und Realismus

Stand: 13.09.2026. Ergänzung zum [Spielaudit](AUDIT-2026-09-13.md). Ziel: glaubwürdige Ursache-Wirkungs-Beziehungen im Spiel. Keine Änderungen am Simulationscode.

## Gesamturteil

**Für normalen Leistungsbetrieb besitzt das Spiel eine brauchbare physikalische Basis. Bei Kühlungsverlust und einigen historischen Unfallmechanismen vermittelt es derzeit teilweise falsche Zusammenhänge.** Die wichtigste Verbesserung ist eine geschlossene Wasser- und Energiebilanz. Zusätzliche Detailparameter helfen wenig, solange ein leerer Dampferzeuger dauerhaft Nennleistung abführen kann.

Die Prüfung kombiniert Quellcodeanalyse, gezielte numerische Experimente und Primärquellen von NRC, IAEA, EPRI und IAPWS. Die Experimente stehen in [physics-probes.mjs](physics-probes.mjs):

```powershell
node reactorsim/audit/physics-probes.mjs
```

Die 99 vorhandenen JavaScript-Tests wurden erneut erfolgreich ausgeführt. Das belegt interne Konsistenz und vorhandene Regressionen, keine unabhängige physikalische Validierung. Die zusätzlichen Versuche sind diagnostische Messungen, keine Abnahmetests. Wo einzelne Hooks isoliert geprüft wurden, ist das ausdrücklich angegeben. Untersucht wurden repräsentative Zustände und Modellgleichungen, kein vollständiges Kennfeld und keine Nachrechnung einer konkreten Kraftwerksanlage.

## Was bereits plausibel ist

- Sechs Gruppen verzögerter Neutronen, Punktkinetik, negative Dopplerrückkopplung und eine getrennte Nachwärmekomponente sind sinnvolle Bausteine für dieses Spiel.
- DWR: Stäbe und Bor wirken auf unterschiedlichen Zeitskalen; die Kopplung zwischen Wärmeabnahme, Moderatortemperatur und Reaktivität hat grundsätzlich die passende Richtung.
- SWR: Mehr Umwälzstrom reduziert den Blasenanteil und erhöht die Leistung. Ein Dampfdruckanstieg kann über Blasenkollaps positive Reaktivität liefern. Diese Wirkungsrichtungen entsprechen der Darstellung in [EPRI: Basic Nuclear Physics and Reactor Theory, Seiten 84–89](https://content.nantel.org/production/inpo/zzzwebsitefiles/epri/epriEngFundBNPRTr1.pdf#page=84).
- Jod/Xenon und Promethium/Samarium werden mit Produktion, Zerfall und Abbrand modelliert. Der Xenonanstieg nach Abschaltung und der bleibende Samariumanstieg sind qualitativ passend. Das Xenonmaximum nach etwa acht Stunden und die Rückkehr Richtung Ausgangswert nach ungefähr einem Tag passen zur [NRC-Beschreibung der Abschaltreaktivität](https://www.nrc.gov/sr0933/section-3-new-generic-issues/issue-185-control-recriticality-following-small-break-loca-pwrs).
- RBMK: Graphitmoderation, eine positive Blasenrückkopplung für den gewählten historischen Betriebszustand und ein langsamer Stabantrieb sind sinnvolle Unterscheidungsmerkmale. Die historischen 18 Sekunden für vollständige Stabeinfahrt sind in [INSAG-7, Abschnitt 2.3](https://pub.iaea.org/MTCD/publications/PDF/Pub913e_web.pdf#page=14) dokumentiert.

Nach zehn Minuten ohne Eingriff liefert das Modell:

| Typ | Wärmeleistung | elektrische Leistung | Druck | Kerneintritt / Austritt |
| --- | ---: | ---: | ---: | ---: |
| DWR | 3850,9 MW | 1401,2 MW | 158,00 bar | 290,98 / 326,64 °C |
| SWR | 3841,1 MW | 1343,7 MW | 70,70 bar | 274,77 / 286,54 °C |
| RBMK | 3200,0 MW | 999,9 MW | 69,00 bar | 267,86 / 284,88 °C |

Die Werte passen zu den gewählten Spiel-Nennpunkten und plausiblen Typgrößenordnungen. Da `trim()` ausdrücklich auf diese Punkte kalibriert, ist deren Übereinstimmung allein kein Nachweis für realistische Transienten.

## 1. Hoch: DWR und RBMK produzieren Dampf aus einem nicht mehr abnehmenden Restinventar

**Code:** [pwr.js:424](../static/js/plants/pwr.js#L424), [pwr.js:462](../static/js/plants/pwr.js#L462), [rbmk.js:435](../static/js/plants/rbmk.js#L435), [rbmk.js:486](../static/js/plants/rbmk.js#L486).

Beim DWR hängen Wärmeübergang und sekundäre Wärmekapazität nicht vom tatsächlich vorhandenen `M_sg` ab. Die Masse fällt höchstens auf 1000 kg. Beim RBMK wird die Trommelmasse auf mindestens 20.000 kg begrenzt, während der siedende Kern weiterhin auf Sättigungstemperatur gehalten wird. Ausströmender Dampf wird nach Erreichen der Untergrenze nicht mehr durch weiteren Inventarverlust bezahlt.

**Experiment:** Nennbetrieb; Speisewasserregler auf Hand, Stellwert null; eine Stunde mit 0,05-s-Schritten rechnen, ohne weitere Bedienhandlung. Es wird die Engine untersucht, ohne vorgeschaltetes Szenario-Abbruchkriterium.

| Nach einer Stunde | DWR | RBMK |
| --- | ---: | ---: |
| Speisewasser | 0 kg/s | 0 kg/s |
| Restmasse im Modell | 1000 kg | 20.000 kg |
| Füllstandsanzeige | 0 % | praktisch 0 % |
| Dampfabgabe | 2065,8 kg/s | 2112,8 kg/s |
| Elektrische Leistung | 1401,2 MW | 1368,2 MW |
| Hüllrohrtemperatur | 359,4 °C | 303,5 °C |
| Anlage zerstört | nein | nein |

Das ist kein bloß ungenauer Schadenszeitpunkt: Die Massenbilanz ist verletzt. Beim RBMK steigt die elektrische Leistung sogar deutlich über den Nennwert von 1000 MW. Ein Szenario kann den Lauf wegen ignorierter Meldungen zwar vorher beenden; dadurch wird die darunterliegende Physik nicht richtig.

**Verbesserung:** Wasser- und Dampfinventar getrennt bilanzieren. Verdampfung durch verfügbare Energie und Flüssigkeitsmasse begrenzen. Benetzte Heizfläche, Wärmeübergang und wirksame Wärmekapazität vom Inventar abhängig machen. Beim RBMK zusätzlich Kanalkühlung und Trommelinventar koppeln. Massenuntergrenzen nur als numerischen Schutz verwenden, ohne damit neue Masse zu erzeugen.

Die Funktion des DWR-Dampferzeugers als Wärmesenke und die Bedeutung der Speisewasserzufuhr sind im [NRC-Bericht zu Three Mile Island](https://www.nrc.gov/reading-rm/doc-collections/fact-sheets/3mile-isle) beschrieben. Der konkrete Bilanzfehler oben folgt aus dem Code und den Messungen.

## 2. Hoch: SWR-Kernfreilegung erzeugt künstliche Wärme

**Code:** [bwr.js:462](../static/js/plants/bwr.js#L462), insbesondere `dryTarget`, `coolTarget` und die beiden Temperaturrelaxationen.

Bei Freilegung wird eine Zieltemperatur von `T_sat + 3200 K` vorgegeben. Diese Zieltemperatur hängt nicht von der tatsächlichen Wärmeleistung ab. Anschließend wärmt der künstlich heiße Kühlmittelknoten über die gemeinsame Wärmeübergangskette Brennstoff und Hüllrohr auf.

**Isolierter Modelltest:** `coreCoolant()` mit 0 kW Wärmezufuhr, festem Druck und niedrigem Inventar 180 Sekunden lang in 0,05-s-Schritten aufrufen. Die Austrittstemperatur steigt von 286,5 auf **2289,9 °C**. Dies ist bewusst kein vollständiger Unfalllauf, sondern ein Nachweis der eingebauten, energieunabhängigen Wärmequelle.

**Verbesserung:** Bei Freilegung den Wärmeübergang reduzieren. Brennstoff und Hüllrohr sollen sich aus Spaltleistung, Nachwärme und gegebenenfalls Oxidationswärme aufheizen. Auch Dampf und Strahlungsverluste gehören in die Energiebilanz. Die Temperatur muss Ergebnis dieser Bilanz sein. Ein kalter, wärmequellenfreier Kern darf durch Freilegung allein nicht heiß werden.

## 3. Hoch: Löschwasser kann gegen beliebigen Reaktordruck einspeisen

**Code:** [bwr.js:689](../static/js/plants/bwr.js#L689).

Bei fehlendem Wechselstrom liefert `fireInjOn` immer 35 kg/s. Im Test sind es sowohl bei **70,7 bar als auch bei 100 bar** dieselben 35 kg/s. Pumpenförderhöhe, Gegendruck, Wasserquelle und Antriebsenergie fehlen. Die Kommentare bezeichnen die Einspeisung sogar als motorlos.

Das vermittelt die falsche Handlungskette für das Fukushima-Szenario: Ein Knopf ersetzt die Druckabsenkung und die Herstellung eines geeigneten Einspeisewegs. Die IAEA beschreibt ausdrücklich, dass die Einspeisung mit Diesel-Feuerlöschpumpe bzw. Feuerwehrfahrzeugen eine Druckabsenkung erforderte. [Fukushima Technical Volume 1, gedruckte Seite 116 / PDF-Seite 127](https://www-pub.iaea.org/MTCD/Publications/PDF/AdditionalVolumes/P1710/Pub1710-TV1-Web.pdf#page=127).

**Verbesserung:** Einen einfachen druckabhängigen Pumpenkennwert mit Sperre oberhalb der Förderhöhe verwenden. Separaten Antrieb und begrenzten Vorrat modellieren. Einen nachvollziehbaren Druckentlastungsweg mit Stellbarkeit und Strom-/Druckluftabhängigkeit anbieten. Die Durchflussanzeige muss tatsächliche Einspeisung zeigen, nicht nur den Bedienwunsch.

## 4. Hoch: RBMK-Reaktivität hängt vom AZ-5-Knopf statt allein von der Geometrie ab

**Code:** [rbmk.js:526](../static/js/plants/rbmk.js#L526), [rbmk.js:630](../static/js/plants/rbmk.js#L630).

`_tipReactivity()` liefert grundsätzlich null, bis `s.az5.armed` gesetzt wird. Derselbe Stabweg hat bei Handfahrt und AZ-5 deshalb unterschiedliche geometrische Reaktivität. Der Hook kompensiert außerdem einen Teil der allgemeinen Absorberwirksamkeit mit einem zusätzlichen `notYet`-Term.

**Experiment:** Beide Gruppen auf 10 % Einfahrt setzen. Ohne Bewegung beträgt der Spitzenbeitrag vor AZ-5 null; unmittelbar nach Betätigung, weiterhin bei derselben Geometrie, beträgt er **+623,3 pcm**. Das ist ein künstlicher Sprung durch ein Ereignisflag.

Der historische Effekt entstand durch Wasserverdrängung und die räumliche Leistungsverteilung. Ein Steuersignal verändert die Stabgeometrie nicht augenblicklich. Die Ableitung dieses Befunds folgt aus der in [INSAG-7, Abschnitt 2.2](https://pub.iaea.org/MTCD/publications/PDF/Pub913e_web.pdf#page=14) beschriebenen Geometrie.

**Verbesserung:** Absorber und Graphitverdränger gemeinsam als Funktion der absoluten Position berechnen, möglichst mit mindestens zwei axialen Zonen. AZ-5 ändert Zielposition und Geschwindigkeit. Es darf keinen zusätzlichen Reaktivitätsschalter benötigen. Eine historische Exkursion sollte aus dem Modell entstehen und nicht durch nachträgliches Wegrechnen der Absorberwirkung erzwungen werden.

## 5. Mittel: Siedekrise bleibt hauptsächlich eine Anzeige

**Code:** [pwr.js:661](../static/js/plants/pwr.js#L661), [bwr.js:866](../static/js/plants/bwr.js#L866), [rbmk.js:698](../static/js/plants/rbmk.js#L698), [engine.js:140](../static/js/sim/engine.js#L140).

DNBR und CPR sind heuristische Kennzahlen. Das ist als Spielvereinfachung vertretbar. Problematisch ist, dass ihre Unterschreitung den Wärmeübergang nicht direkt verschlechtert. Die gemeinsame Brennstoff-/Hüllrohrkette behält ihre konstanten Wärmeübergänge; beim SWR verhindert insbesondere ausreichende Gesamtmasse zunächst den Freilegungs-Heizmechanismus, selbst wenn die lokale thermische Reserve verloren ist.

Die reale Bedeutung der Siedekrise ist gerade ein verschlechterter Wärmeübergang durch einen isolierenden Dampffilm, nicht bloß eine rote Zahl. [NRC-Glossar: Departure from nucleate boiling](https://www.nrc.gov/reading-rm/basic-ref/glossary/full-text).

**Verbesserung:** Einen einfachen Hot-Channel-Knoten mit Wärmefluss, Benetzung und Übergang zum schlechteren Wärmeübergang einführen. DNBR/CPR daraus ableiten oder zumindest konsistent mit diesem Zustand koppeln. Die vorhandenen Potenzformeln nicht als quantitativ validierte Grenzkorrelationen ausgeben.

## 6. Mittel: Wasserstoffexplosion ist an Venten gekoppelt

**Code:** [bwr.js:634](../static/js/plants/bwr.js#L634).

`contVentOpen && h2Mass > 25` löst die Explosion deterministisch aus. Konzentration, Sauerstoff, Dampfanteil, Gebäudevolumen und Zündung fehlen; ohne Venten kann dieser Zweig keine Explosion erzeugen. Das verführt zur falschen Schlussfolgerung „Nicht venten verhindert Wasserstoffexplosionen“.

Die NRC beschreibt die Explosionen in den Reaktorgebäuden und zugleich die Verbesserung von Entlastungssystemen als Folgemaßnahme. Eine Entlastung ist somit nicht grundsätzlich ein Explosionsschalter. [NRC: Lessons Learned from Fukushima](https://www.nrc.gov/reading-rm/doc-collections/fact-sheets/japan-events).

**Verbesserung:** Wasserstoff im Containment und im Gebäude getrennt führen; Leck-/Übertrittspfade und Entlastung unterscheiden. Eine grobe Konzentrations- und Zündbedingung genügt zunächst. Ein spezieller fehlerhafter Entlastungspfad kann als ausdrückliche Szenariostörung bestehen bleiben.

## 7. Mittel: Nachwärme fällt über Tage zu schnell ab

**Code:** [constants.js:54](../static/js/sim/constants.js#L54), [decayheat.js](../static/js/sim/decayheat.js), [test-decayheat.mjs:30](../tests/test-decayheat.mjs#L30).

Aus dem modellierten Volllastgleichgewicht, anschließend ohne weitere Spaltung:

| Zeit nach Abschaltung | Nachwärme, Anteil der Nennleistung |
| --- | ---: |
| 1 Sekunde | 6,436 % |
| 1 Minute | 3,059 % |
| 1 Stunde | 0,890 % |
| 1 Tag | 0,295 % |
| 2 Tage | 0,124 % |
| 7 Tage | 0,00165 % |

Der frühe Verlauf ist als grobe Spielnäherung brauchbar. Die längste Gruppe hat aber nur 100.000 Sekunden Zeitkonstante; danach bricht die Kurve exponentiell ein. Die längerfristige Kühlaufgabe wird so stark unterschätzt. EPRI beschreibt ausdrücklich relevante Nachwärme über mehrere Tage; das dortige Beispiel sinkt von etwa 16 MW nach einem Tag auf 9 MW nach fünf Tagen. [EPRI, Seite 90](https://content.nantel.org/production/inpo/zzzwebsitefiles/epri/epriEngFundBNPRTr1.pdf#page=90).

Dies ist keine Behauptung einer einzigen universellen Prozentkurve: Bestrahlungsdauer, Brennstoff und Betriebsgeschichte sind relevant. Schon der vorhandene Test erlaubt für einen Tag 0,5 % ± 0,3 Prozentpunkte und verdeckt damit die deutliche Abweichung vom eigenen Zielwert.

**Verbesserung:** Mehr logarithmisch verteilte Zerfallsgruppen an eine dokumentierte Referenz für definierte Bestrahlungsgeschichte anpassen. Punkte bis mindestens zum Ende des 48-Stunden-Zeitsprungs prüfen, besser bis mehrere Wochen. Passende relative Fehlertoleranzen festlegen.

## 8. Mittel: „Kaltstart“ ist thermisch kein Kaltstart

**Code:** `trim()` in [pwr.js:336](../static/js/plants/pwr.js#L336), [bwr.js:419](../static/js/plants/bwr.js#L419), [rbmk.js:403](../static/js/plants/rbmk.js#L403).

Die Presets setzen niedrige neutronische Leistung, eingefahrene Stäbe und gestoppte Pumpen, behalten aber ungefähr Nenndruck und heiße Kühlmitteltemperaturen:

| Preset | Eintrittstemperatur | Druck |
| --- | ---: | ---: |
| DWR kalt | 291 °C | 158 bar |
| SWR kalt | 286,54 °C | 70,7 bar |
| RBMK kalt | 284,88 °C | 69 bar |

**Verbesserung:** Kurzfristig als „Anfahren aus heißem, unterkritischem Zustand“ bezeichnen. Für echten Kaltstart braucht es niedrige Anfangstemperaturen und Drücke, Aufheizen des Inventars und der Strukturen sowie den Übergang vom einphasigen Wasser zum Sieden. Ein Leistungswert nahe null reicht als Kaltstartmodell nicht aus.

## 9. Niedrig bis mittel: Oberflächenspannung deutlich falsch angenähert

**Code:** [steam.js:146](../static/js/sim/steam.js#L146).

Die Näherung der Oberflächenspannung liefert:

| Temperatur | Spiel | IAPWS |
| --- | ---: | ---: |
| 100 °C | 20,96 mN/m | 58,91 mN/m |
| 285,88 °C | 5,37 mN/m | 17,62 mN/m |

Der Referenzwert wird im Probeskript aus `235.8 * τ^1.256 * (1 - 0.625 * τ)` mit `τ = 1 - T/647.096` berechnet. [IAPWS R1-76(2014)](https://iapws.org/documents/release/Surf-H2O.download).

Das beeinflusst die Blasendrift und damit den Blasenanteil. Weil die Oberflächenspannung mit einer Viertelpotenz eingeht und der Driftterm nur ein Teil des Nenners ist, folgt daraus **kein** ebenso großer Fehler der Gesamtleistung. Dessen Größe muss separat vermessen werden.

**Verbesserung:** Die kurze IAPWS-Formel übernehmen. Danach Umwälzstrom-/Leistungskennfeld und Nennpunkt neu prüfen. Die pauschale Ein-Prozent-Genauigkeitsaussage im Tabellenkommentar sollte ebenfalls erst durch Referenzvergleiche über den gesamten Druckbereich abgesichert werden, insbesondere im Kondensatorbereich.

## Bewusste Modellentscheidungen klarer kennzeichnen

**Historischer RBMK:** `_voidCoeff()` bleibt immer positiv und hängt nur an einer linear aus Stabpositionen gebildeten ORM. INSAG-7 beschreibt Abhängigkeiten von Kernzusammensetzung und Betriebszustand einschließlich unterschiedlicher Vorzeichen; ORM meint Reaktivitätsäquivalente und hängt vom Neutronenfeld ab. [INSAG-7, Abschnitte 2.1 und 4.2](https://pub.iaea.org/MTCD/publications/PDF/Pub913e_web.pdf). Für ein bestimmtes historisches Preset kann die Vereinfachung dienen; sie repräsentiert keine allgemeine RBMK-Kennlinie. Empfohlen: ausdrücklich „historische Ausführung“ kennzeichnen, ORM aus Stabwirksamkeit/Flussgewichtung ableiten und numerische Koeffizienten als Spielkalibrierung dokumentieren.

**Reaktorschutz:** `TripSystem` warnt absichtlich nur und löst nie automatisch aus. Das ist eine bestehende Gameplay-Entscheidung. Für realistisches Anlagenverhalten ist sie eine große Abweichung: reale Anlagen besitzen automatische Abschalt- und Kühlfunktionen. [NRC: BWR-Systemübersicht](https://www.nrc.gov/reading-rm/basic-ref/students/animated-bwr). Empfohlen: optionaler Anlagenmodus mit Automatik und ein ausdrücklich benannter Modus mit deaktiviertem Schutz. Dabei Szenarioziele und Wertung anpassen, damit korrektes automatisches Abschalten nicht als Bedienfehler zählt.

**Schadensmodell und Instabilität:** Enthalpieschwellen mit festem Spitzenfaktor, ein Übertemperatur-Zeitlimit und ein separat angeregter Dichtewellenschwinger können das Spiel tragen. Sie liefern aber keine validierten Brennstoffschäden oder konkreten Unfallzeiten. Für Spielrealismus zuerst die korrekte Richtung, Energiequelle, Zeitskala und Rückwirkung sicherstellen. Keine zusätzlichen Nachkommastellen als Ersatz für diese Kopplung verwenden.

## Empfohlene Umsetzung und Validierung

1. **Masse und Energie schließen:** DWR-Dampferzeuger, RBMK-Kanäle/Trommeln und SWR-Freilegung gemeinsam priorisieren. Bilanzreste je Schritt messbar machen; erfundene Restmassen und Temperaturquellen beseitigen.
2. **Bedienhandlungen physikalisch koppeln:** Druckabhängige Einspeisung, geometrischer RBMK-Stabbeitrag, thermische Rückwirkung der Siedekrise.
3. **Langzeit- und Unfallmodelle verbessern:** Nachwärmefit, Wasserstoffpfade, realistische Anfangszustände.
4. **Erst anschließend kalibrieren:** Spiel-Nennwerte und Szenarioschwierigkeit anpassen. Automatisches `trim()` darf größere Bilanzfehler nicht verbergen.

Als gezielte Referenzfälle eignen sich Nennbetrieb, Lastabsenkung, Abschaltung, Pumpenauslauf, vollständiger Speisewasserausfall und anschließende Wiederbespeisung. Ergänzend: wärmequellenfreier trockener Kern, hoher Gegendruck bei Niederdruckeinspeisung und identische RBMK-Stabpositionen bei unterschiedlicher Vorgeschichte. Für die deterministischen Fälle mehrere Schrittweiten vergleichen; Rauschen dafür abschalten oder getrennt statistisch prüfen. Grenzwerte und Toleranzen vor dem Nachkalibrieren festlegen.
