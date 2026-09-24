# Reactorsim: Physik-Korrekturen vom 13.09.2026

Stand: Version **0.1.17**. Grundlage ist das [Physik-Audit](PHYSIK-AUDIT-2026-09-13.md).
Die dort beschriebenen neun Fehler beziehungsweise irreführenden Darstellungen
wurden im bestehenden Spielmodell bearbeitet. Eine vollständige thermohydraulische
oder historische Anlagenvalidierung ist damit nicht verbunden. Software-Sicherheit
war nicht Gegenstand dieser Arbeiten.

## Änderungen gegenüber dem Audit

| Auditpunkt | Umsetzung | Nachweis / Grenze |
| --- | --- | --- |
| 1. Dampf aus nicht abnehmendem Restinventar | Massenuntergrenzen entfernt. Dampfentnahme durch verfügbares Inventar und Energie begrenzt. Dampferzeuger-Benetzung und Behälter-Wärmekapazität hängen vom Wasserbestand ab. | Leere Behälter liefern weder Dampf noch elektrische Leistung; Schwellen der Sättigungsnäherung bleiben bestehen. |
| 2. Künstliche SWR-Heizung bei Kernfreilegung | Festes Temperaturziel von Sättigung plus 3200 K entfernt. Fehlende Bedeckung reduziert den Wärmeübergang; Wärme stammt aus dem Brennstoff. | Isolierter Kühlmitteltest bleibt bei 0 kW auf Sättigungstemperatur. |
| 3. Druckunabhängige Löschwassereinspeisung | Diesel-Pumpenkennlinie, Fördergrenze bei 12 bar absolut und endlicher Wasservorrat. Reaktordruckentlastung benötigt DC; Ersatzbatterien sind bedienbar. | Bei 70,7 und 100 bar keine Förderung. Bei 6 bar rund 25,85 kg/s. Kennlinie und Vorrat sind Spielparameter. |
| 4. AZ-5 als Reaktivitätsschalter | Verdrängerwirkung hängt von Stabposition und axialem Profil ab. Ereignisfreigabe und künstliche Absorberkompensation entfernt. | Bei identischer Geometrie ist die Reaktivität vor und unmittelbar nach AZ-5 identisch. |
| 5. DNBR/CPR nur als Anzeige | Unterschreiten der kritischen Marge reduziert den Wärmeübergang kontinuierlich. Geringe Bedeckung verschärft dies. | Nennbetrieb bleibt stabil; anhaltende starke Instabilität kann nun Schäden verursachen. Wärmeübergang weiterhin phänomenologisch. |
| 6. Venten als Explosionsschalter | Getrennte Wasserstoffbestände für Containment und luftgefülltes Gebäude. Venten entfernt Gas zum Kamin; Überdruckleckage kann Gas ins Gebäude transportieren. | Venten allein löst keine Explosion aus. Gebäudeansammlung kann auch bei geschlossenem Vent gefährlich werden. Zündung bleibt vereinfacht. |
| 7. Zu schnell verschwindende Nachwärme | Sieben Pseudogruppen mit kurzen und langen Zeitkonstanten statt vier Gruppen. | Rund 0,527 % nach einem Tag und 0,312 % nach einer Woche aus anfänglichem Volllastgleichgewicht. Keine ANS-5.1-Berechnung. |
| 8. Angeblicher Kaltstart | Startoption und RBMK-Szenario als heißer, unterkritischer Wiederanlauf bezeichnet. | Temperaturen und Druck passen nun zur Beschreibung. Ein echter thermischer Kaltstart bleibt offen. |
| 9. Oberflächenspannung | IAPWS-R1-76-Korrelation eingesetzt. | 58,912 mN/m bei 100 °C und 17,621 mN/m bei 285,88 °C. |

Zusätzlich wurde die Wärmeübertragung zwischen Brennstoff, Hüllrohr und Kühlmittel
über integrierte Energieflüsse formuliert. Beim RBMK wird die im Graphit
gespeicherte Energie von der unmittelbaren Kühlmittelzufuhr abgezogen und später
wieder abgegeben. Leere Behälter zeigen durch Schrumpfen/Quellen keinen scheinbar
hohen Wasserstand mehr.

## Bedienung, Hilfe und Spielstände

Im SWR stehen unter Sicherheitssysteme die Reaktordruckabsenkung und die
Gleichstrom-/Ersatzbatterie-Bedienung zur Verfügung. Der verbleibende
Löschwasservorrat wird in Tonnen angezeigt. Tatsächlich eingespeiste Masse
verbraucht den Vorrat; ein bloßer Einschaltbefehl bei zu hohem Druck nicht.

Der RBMK wird ausdrücklich als historische Ausführung bezeichnet. Hilfetexte
erklären, dass auch manuelle Stabeinfahrt den geometrischen Verdrängereffekt hat.
Der Helfer führt bei geringer ORM oder stark positiver Blasenrückkopplung keine
blinde Stabeinfahrt mehr aus. Die bereits vorhandene Spielregel, nach der
Auslösemeldungen grundsätzlich eine Bedienerreaktion verlangen, bleibt bestehen;
das Erdbeben-Szenario besitzt weiterhin seine explizite Abschaltung.

Neue Zustandsfelder werden gespeichert. Alte Viergruppen-Nachwärmebestände werden
unter Erhalt ihrer momentanen Summenleistung auf die neuen Gruppen verteilt.
Die ursprüngliche Bestrahlungsgeschichte lässt sich daraus nicht rekonstruieren;
die weitere Entwicklung eines alten Spielstands ändert sich deshalb. Auch alte
Replays sind durch die neue Physik nicht versionsübergreifend ergebnisgleich.
Neue Aufzeichnungen reproduzieren die neuen Notfall-Bedienhandlungen.

## Messwerte und Tests

Nennbetrieb nach 600 simulierten Sekunden, ermittelt mit
[physics-probes.mjs](physics-probes.mjs):

| Reaktor | Thermisch | Elektrisch | Primärdruck |
| --- | ---: | ---: | ---: |
| DWR | 3850,90 MW | 1401,20 MW | 158,002 bar |
| SWR | 3840,43 MW | 1343,55 MW | 70,699 bar |
| RBMK | 3199,98 MW | 999,92 MW | 69,000 bar |

Weitere Stichproben:

- SWR-Kühlmittel bei festem Druck und 0 kW Wärmezufuhr: nach 180 Sekunden
  weiterhin 286,539 °C, ohne den früheren künstlichen Temperaturanstieg.
- RBMK bei 10 % Einfahrt: Verdrängerbeitrag vor und unmittelbar nach AZ-5
  jeweils 665,727 pcm. Dieser Einzelbeitrag ist keine Aussage über die
  gesamte Reaktivität oder einen historischen Unfallverlauf.
- Nachwärme aus Volllastgleichgewicht: 5,977 % nach 1 s, 2,666 % nach 60 s,
  1,123 % nach 1 h, 0,527 % nach 1 Tag und 0,312 % nach 7 Tagen.
- Das originale Sechs-Stunden-Blackout-Szenario wird mit Ersatzbatterien eine
  Minute nach DC-Ausfall, wieder verfügbarem IC und kontrollierter Entlastung
  ohne Anlagenschaden abgeschlossen. Ohne Wiederherstellung der Kühlung endet
  die Gegenprobe durch einen physischen Schaden, nicht durch einen Rechenfehler.

Ausgeführte Prüfungen:

```text
node --test reactorsim/tests/test-*.mjs
136 bestanden, 0 fehlgeschlagen

python -m pytest reactorsim/tests/test_locales.py -q --tb=short
5 bestanden

node reactorsim/audit/physics-probes.mjs
Diagnosewerte wie oben
```

Die neuen [Physiktests](../tests/test-physics.mjs) prüfen Massen- und Energiebudgets,
fehlende künstliche Heizleistung, Druckabhängigkeit der Einspeisung, Vorratsverbrauch,
DC-Abhängigkeit, Wasserstoffpfade, Stabgeometrie, Graphitspeicherung, Nachwärme,
Speicherkompatibilität und beide Blackout-Verläufe. Ein zusätzlicher
[Replay-Test](../tests/test-replay.mjs) prüft die aufgezeichneten Notfallaktionen.

Bestehende Tests wurden fachlich angepasst: Beim DWR-Pumpenausfall wird auf die
erste Auslösemeldung reagiert; beim SWR-Druckstoß nach der beobachteten Anfangsphase.
Der Test mit minutenlang ignorierter starker Schwingung erwartet nun Schaden.
Eine zwangsläufige RBMK-Zerstörung nach AZ-5 wird nicht mehr als Sollverhalten
vorgegeben; stattdessen werden positionsabhängige positive Anfangswirkung,
negative Wirkung vollständig eingefahrener Stäbe und Abschaltung aus Nennbetrieb
geprüft. Die vorhandenen Nennbetriebs-, Langzeit-, Persistenz- und Lifecycle-Tests
laufen weiterhin mit.

Kein visueller Durchlauf im echten Browser wurde ausgeführt. Die automatisierten
Prüfungen decken Simulationslogik, Bedienaktionen und vorhandene Lifecycle-Tests ab,
aber nicht die tatsächliche Darstellung auf verschiedenen Bildschirmgrößen.

## Verbleibende Modellgrenzen

- Die Behälter verwenden weiterhin ein konzentriertes Sättigungsmodell zwischen
  1 und 110 bar. Wasser und Dampf werden nicht als vollständige getrennte
  Zweiphasen-Zustände gerechnet. Energie an der Druckbegrenzung wird als
  `pressureClipKJ` sichtbar, aber nicht in ein Überhitzungsmodell übertragen.
- DNBR/CPR-Korrelationen, Benetzungsfunktion, geringe Rest-Dampfkühlung und
  Schadensschwellen sind Spielnäherungen. Zeitpunkte von Brennstoffschäden sind
  keine validierten Unfallprognosen. Oxidationswärme und detaillierte
  Zirkonium-Reaktionskinetik fehlen weiterhin.
- RBMK-Verdrängerwirkung ist eine reduzierte Positionskurve. ORM bleibt eine
  Positionsnäherung; die bestehende starke ORM-Abhängigkeit des Blasenkoeffizienten
  ist weiterhin eine Spielkalibrierung. Räumliche Neutronentransportrechnung,
  unterschiedliche historische Kernbeladungen und Nachrüstvarianten fehlen.
- Die sieben Nachwärmegruppen sind eine plausible Näherung mit Langzeitanteil,
  kein isotopenaufgelöster oder normgerechter Nachwärmenachweis.
- Ersatzbatterien sind sofort anschließbar. Bereitstellungszeit, Batteriekapazität,
  Dieselverbrauch und die Logistik externer Wasserversorgung sind nicht modelliert.
  Die Fördergrenze von 12 bar und der Vorrat von 1000 t sind gewählte Spielparameter.
- Das Wasserstoffmodell nimmt ein luftgefülltes Gebäudevolumen von 10.000 m³,
  vereinfachte Leckraten und eine begrenzte Produktionsmenge an. Beim Erreichen
  einer brennbaren Mischung wird Zündung als Spielereignis unterstellt.
  Sauerstoffverbrauch, räumliche Gasverteilung, Dampfverdünnung und Druckwirkung
  einer Verbrennung werden nicht berechnet.

## Physikalische Bezugspunkte

Die Oberflächenspannung verwendet unmittelbar die veröffentlichte Korrelation
aus [IAPWS R1-76, Revision 2014](https://iapws.org/documents/release/Surf-H2O.download).

Die geometrische Bezugsgröße von 1,25 m Wassersäule bei 7 m Kernhöhe und die
Bedeutung des axialen Leistungsprofils folgen aus
[IAEA INSAG-7](https://pub.iaea.org/MTCD/publications/PDF/Pub913e_web.pdf).
Die konkrete Spielkurve und ihre pcm-Werte sind daraus nicht quantitativ validiert.

Die notwendige Druckabsenkung vor Niederdruckeinspeisung wird im
[IAEA-Fukushima-Bericht, Technical Volume 1](https://www-pub.iaea.org/MTCD/Publications/PDF/AdditionalVolumes/P1710/Pub1710-TV1-Web.pdf)
beschrieben. Die eingesetzte Pumpenkennlinie ist keine Rekonstruktion einer
bestimmten historischen Feuerwehrpumpe.

Die Größenordnung einer unteren Wasserstoff-Brennbarkeitsgrenze von etwa 4 Vol.-%
in Luft ist im [DOE-Material zu Wasserstoffeigenschaften](https://www.energy.gov/sites/default/files/2014/03/f12/fcm01r0.pdf)
beschrieben. Brennbarkeit ist kein Nachweis einer automatisch eintretenden
Explosion; diese Unterscheidung begrenzt ausdrücklich das verwendete Spielmodell.
