#!/usr/bin/env python3
"""Wertung -- serverseitig.

Dieselbe Formel wie in static/js/game/scoring.js. Das ist Absicht und kein
Versehen: der Server darf dem Browser den Punktestand nicht glauben, also muss
er ihn aus den gemeldeten Kennzahlen selbst ausrechnen. Wer die eine Seite
aendert, aendert die andere mit -- tests/fixtures/scoring.json haelt beide
zusammen, und zwar von beiden Seiten aus geprueft.

Die Kennzahlen selbst bleiben faelschbar, solange die Simulation im Browser
laeuft. Das verschiebt die Angriffsflaeche aber von "eine beliebige Zahl" auf
"ein Satz physikalisch begrenzter Groessen", und die lassen sich auf
Plausibilitaet pruefen (siehe validate_summary).

Fassung 2: `violation_seconds` (Sekunden mit aktiver Meldetafel-Kachel, nach
Schwere) ging vorher UNGEDECKELT und linear in die Wertung ein -- eine lange,
im Kern beherrschte Schicht mit einer harmlosen Dauerwarnung (z.B.
Graphittemperatur leicht ueber dem Normalband) sammelte so mehr Minus als ein
kurzer Lauf, der in einer echten Katastrophe endete. Jetzt zaehlt der ANTEIL
der Schichtdauer (`violation_seconds[sev] / duration_s`), gedeckelt je
Schwere -- eine WARN-Kachel, die 25 % der Schicht ansteht, kostet unabhaengig
davon, ob die Schicht eine oder vier Stunden dauerte, denselben Betrag.
"""

from __future__ import annotations

import math

WEIGHTS = {
    'mission': 1000.0,          # Schicht laut Szenario abgeschlossen
    'energy': 1000.0,           # x Anteil gelieferte/geforderte Energie
    'deviation_per_mwh': 2.0,
    'deviation_cap': 300.0,
    'alarm_per_second': 0.05,
    'alarm_cap': 100.0,
    # je Schwere: -min(Sekunden / Schichtdauer, 1.0) * Deckel
    'violation_cap': {1: 100.0, 2: 300.0, 3: 1000.0},
    'scram': 500.0,
    'fuel_damage': 5000.0,      # Kernzerstoerung (sim/engine.js lose())
    'cont_failed': 2500.0,      # SWR: Sicherheitsbehaelterversagen
    'h2_exploded': 3000.0,      # SWR: Wasserstoffexplosion -- additiv zu cont_failed,
                                # beides sind unabhaengig ausloesbare Ereignisse
    'difficulty_bonus': 250.0,
    'floor_no_scram': 500.0,
}


def _num(value, default=0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def _round_score(x: float) -> int:
    """Rundet exakte .5-Werte immer von Null weg -- Pythons eingebautes
    round() rundet zur geraden Zahl (round(0.5) == 0, round(2.5) == 2),
    JavaScripts Math.round() dagegen immer aufwaerts (Math.round(0.5) === 1).
    Server und Client MUESSEN hier identisch runden (siehe Dateikopf), sonst
    weicht der autoritative Server-Score vom Client-Vorschauwert ab, sobald
    ein Zwischenwert exakt auf eine halbe Zahl faellt (moeglich, da
    violations_warn & Co. mit Fliesskommazahlen rechnen). Eigener Name statt
    der eingebauten round(), damit der Unterschied nicht unbemerkt
    zurueckkommt."""
    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)


def score(summary: dict) -> dict:
    """@return {'score': int, 'parts': {...}} -- sum(parts.values()) ==
    score, IMMER exakt (siehe rounding_adjustment/floor_adjustment unten),
    nicht nur ungefaehr."""
    completed = bool(summary.get('completed'))
    fuel_damage = bool(summary.get('fuel_damage'))
    cont_failed = bool(summary.get('cont_failed'))
    h2_exploded = bool(summary.get('h2_exploded'))
    scram_count = _num(summary.get('scram_count'))

    demanded = max(_num(summary.get('energy_mwh_demanded')), 1e-9)
    ratio = min(_num(summary.get('energy_mwh_delivered')) / demanded, 1.0)
    # Tatsaechlich gespielte Zeit, NICHT die nominelle Szenariolaenge -- ein
    # nach 30 Minuten abgebrochener 4-Stunden-Lauf darf seine
    # Ueberschreitungssekunden nicht durch 14400 teilen.
    duration = max(_num(summary.get('duration_s')), 1.0)

    vs = summary.get('violation_seconds')
    if not isinstance(vs, dict):
        # Unsinn statt eines Objekts zaehlt als "keine Ueberschreitungen".
        # Abstuerzen darf die Wertung nicht -- sie laeuft auf einer Anfrage,
        # deren Inhalt der Server nicht bestimmt.
        vs = {}

    def violation_part(sev: int) -> float:
        seconds = _num(vs.get(sev, vs.get(str(sev))))
        return -min(seconds / duration, 1.0) * WEIGHTS['violation_cap'][sev]

    parts = {
        'mission': WEIGHTS['mission'] if completed else 0.0,
        'energy': WEIGHTS['energy'] * ratio,
        'deviation': -min(_num(summary.get('deviation_mwh')) * WEIGHTS['deviation_per_mwh'],
                           WEIGHTS['deviation_cap']),
        'alarms': -min(_num(summary.get('alarm_seconds_unacked')) * WEIGHTS['alarm_per_second'],
                        WEIGHTS['alarm_cap']),
        'violations_info': violation_part(1),
        'violations_warn': violation_part(2),
        'violations_trip': violation_part(3),
        'scram': -WEIGHTS['scram'] * scram_count,
        'fuel': -WEIGHTS['fuel_damage'] if fuel_damage else 0.0,
        'cont_failed': -WEIGHTS['cont_failed'] if cont_failed else 0.0,
        'h2_exploded': -WEIGHTS['h2_exploded'] if h2_exploded else 0.0,
        'bonus': (WEIGHTS['difficulty_bonus'] * _num(summary.get('difficulty'), 1.0))
                 if completed else 0.0,
    }

    incident = summary.get('score_mode') == 'incident_v1'
    catastrophic = fuel_damage or cont_failed or h2_exploded
    if incident:
        objectives = summary.get('objectives')
        objectives = objectives if isinstance(objectives, list) else []
        met = sum(isinstance(o, dict) and o.get('met') is True for o in objectives)
        success = completed and len(objectives) == 2 and met == 2 and not catastrophic
        parts['objectives'] = min(met, 2) * 1000.0
        parts['mission'] = WEIGHTS['mission'] if success else 0.0
        parts['bonus'] = (WEIGHTS['difficulty_bonus'] * _num(summary.get('difficulty'), 1.0)
                          if success else 0.0)
        for key in ('energy', 'deviation', 'scram', 'violations_info',
                    'violations_warn', 'violations_trip'):
            parts[key] = 0.0

    # round() passiert genau einmal, hier -- nicht als Teil eines Einzelpostens.
    subtotal = sum(parts.values())
    raw_score = _round_score(subtotal)
    parts['rounding_adjustment'] = raw_score - subtotal
    final_score = raw_score

    # Eine erfolgreich abgeschlossene, katastrophenfreie Schicht soll nicht
    # wegen bloss lange stehender Warnungen im Minus enden -- eine
    # Katastrophe (Kernschaden ODER Sicherheitsbehaelterversagen ODER
    # Wasserstoffexplosion) ist aber NIE "erfolgreich abgeschlossen", ganz
    # gleich ob der Schicht-Timer danach noch weiterlief.
    if not incident and completed and not catastrophic:
        final_score = max(final_score, 0)
        if scram_count == 0:
            final_score = max(final_score, int(WEIGHTS['floor_no_scram']))
    parts['floor_adjustment'] = final_score - raw_score

    return {'score': final_score, 'parts': parts}


def validate_summary(summary, scenario: dict, reactor_p0_e: float) -> str | None:
    """Plausibilitaetspruefung. @return Fehlergrund oder None.

    Geprueft wird nicht, ob jemand gut gespielt hat, sondern ob die gemeldeten
    Zahlen ueberhaupt aus einem Lauf stammen koennen: mehr Energie als die
    Anlage in der Zeit liefern kann, eine laengere Schicht als das Szenario
    dauert, negative Abweichungen, Ueberschreitungszeiten laenger als der Lauf.
    """
    if not isinstance(summary, dict):
        return 'summary_not_object'

    if scenario.get('score_mode') == 'incident_v1':
        configured = scenario.get('objectives')
        if (not isinstance(configured, list) or len(configured) != 2
                or any(not isinstance(o, dict) or not isinstance(o.get('id'), str)
                       or not o['id'] for o in configured)
                or len({o['id'] for o in configured}) != 2):
            return 'objective_config_invalid'
        if summary.get('score_mode') != 'incident_v1':
            return 'score_mode_invalid'
        if (summary.get('reactor') != scenario.get('reactor')
                or summary.get('scenario') != scenario.get('id')):
            return 'identity_mismatch'
        objectives = summary.get('objectives')
        if (not isinstance(objectives, list) or len(objectives) != 2
                or any(not isinstance(o, dict) or set(o) != {'id', 'met'}
                       or not isinstance(o['id'], str) or not isinstance(o['met'], bool)
                       for o in objectives)
                or sorted(o['id'] for o in objectives) != sorted(o['id'] for o in configured)):
            return 'objectives_invalid'
        for key in ('completed', 'fuel_damage'):
            if not isinstance(summary.get(key), bool):
                return f'{key}_invalid'
        if summary.get('failed') is not None and not isinstance(summary['failed'], str):
            return 'failed_invalid'
        if summary['completed']:
            if (not all(o['met'] for o in objectives) or summary.get('failed')
                    or any(summary.get(k) for k in ('fuel_damage', 'cont_failed', 'h2_exploded'))):
                return 'completion_invalid'
            if _num(summary.get('duration_s'), -1) < _num(scenario.get('duration_s')) - 1e-6:
                return 'completion_early'

    duration = _num(summary.get('duration_s'), -1.0)
    if duration <= 0:
        return 'duration_invalid'
    max_duration = _num(scenario.get('duration_s'), 0.0) * 1.05 + 120
    if duration > max_duration:
        return 'duration_too_long'

    delivered = _num(summary.get('energy_mwh_delivered'), -1.0)
    demanded = _num(summary.get('energy_mwh_demanded'), -1.0)
    if delivered < 0 or demanded < 0:
        return 'energy_negative'
    # Auch mit voll aufgedrehter Anlage nicht mehr als Nennleistung mal Zeit.
    ceiling = reactor_p0_e * duration / 3600.0 * 1.05 + 1.0
    if delivered > ceiling or demanded > ceiling:
        return 'energy_impossible'

    if _num(summary.get('deviation_mwh'), -1.0) < 0:
        return 'deviation_negative'

    scrams = _num(summary.get('scram_count'), -1.0)
    if scrams < 0 or scrams > 100:
        return 'scram_count_invalid'

    vs = summary.get('violation_seconds') or {}
    if not isinstance(vs, dict):
        return 'violations_not_object'
    for sev in (1, 2, 3):
        seconds = _num(vs.get(sev, vs.get(str(sev))), -1.0)
        if seconds < 0 or seconds > duration + 1:
            return 'violation_seconds_invalid'

    alarms = _num(summary.get('alarm_seconds_unacked'), -1.0)
    # Mehrere Meldungen koennen gleichzeitig anstehen, also darf die Summe
    # laenger sein als der Lauf -- aber nicht beliebig viel laenger.
    if alarms < 0 or alarms > duration * 40 + 60:
        return 'alarm_seconds_invalid'

    # Nur beim SWR ueberhaupt gesetzt (plants/bwr.js) -- bei den anderen
    # Typen fehlen die Felder ganz, das ist kein Fehler, nur "false".
    for key in ('cont_failed', 'h2_exploded'):
        val = summary.get(key)
        if val is not None and not isinstance(val, bool):
            return f'{key}_invalid'

    return None
