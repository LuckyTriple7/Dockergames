#!/usr/bin/env python3
"""Die Wertung muss auf beiden Seiten dasselbe ergeben.

Die Fixture-Datei tests/fixtures/scoring.json wird von der JavaScript-Seite
(tests/test-game.mjs) gegen dieselben Erwartungswerte geprueft. Weicht eine
Seite ab, faellt es hier oder dort auf -- und nicht erst dann, wenn ein
Spieler sich ueber einen anderen Punktestand wundert.
"""

import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

import scoring  # noqa: E402


def _fixtures():
    with open(os.path.join(_HERE, 'fixtures', 'scoring.json'), encoding='utf-8') as f:
        return json.load(f)


def _base(**over):
    """Eine 'saubere' erfuellte Schicht als Ausgangspunkt fuer die
    Bodenregel-/Katastrophen-Tests -- ohne Grundzustand muesste jeder Test
    alle Felder einzeln aufzaehlen, nur um dann eins davon zu aendern."""
    d = {
        'energy_mwh_delivered': 1000, 'energy_mwh_demanded': 1000,
        'deviation_mwh': 0, 'alarm_seconds_unacked': 0,
        'violation_seconds': {1: 0, 2: 0, 3: 0},
        'scram_count': 0, 'fuel_damage': False, 'cont_failed': False,
        'h2_exploded': False, 'completed': True, 'difficulty': 1,
        'duration_s': 3600,
    }
    d.update(over)
    return d


def test_fixtures_match():
    for f in _fixtures():
        got = scoring.score(f['summary'])['score']
        assert got == f['score'], f"{f['name']}: {got} statt {f['score']}"


def test_parts_sum_to_score_exactly():
    """Summe aller Einzelposten (inkl. rounding_adjustment/floor_adjustment)
    muss IMMER exakt den Score ergeben -- sonst kann die Debrief-Zerlegung
    einen anderen Gesamtwert zeigen als tatsaechlich vergeben wird."""
    for f in _fixtures():
        result = scoring.score(f['summary'])
        assert sum(result['parts'].values()) == pytest.approx(result['score']), f['name']


def test_more_energy_than_demanded_gives_no_extra():
    base = _fixtures()[0]['summary']
    over = dict(base, energy_mwh_delivered=base['energy_mwh_demanded'] * 3)
    assert scoring.score(over)['score'] == scoring.score(base)['score']


def test_every_penalty_lowers_the_score():
    base = _fixtures()[0]['summary']
    ref = scoring.score(base)['score']
    for over in ({'deviation_mwh': 50}, {'alarm_seconds_unacked': 600},
                 {'scram_count': 1}, {'fuel_damage': True},
                 {'violation_seconds': {'1': 0, '2': 0, '3': 60}}):
        assert scoring.score(dict(base, **over))['score'] < ref, over


def test_nan_and_nonsense_do_not_crash():
    assert isinstance(scoring.score({})['score'], int)
    weird = {'energy_mwh_delivered': 'viel', 'energy_mwh_demanded': None,
             'deviation_mwh': float('nan'), 'violation_seconds': 'keine'}
    assert isinstance(scoring.score(weird)['score'], int)


# ── Bodenregel: erfuellte, katastrophenfreie Schicht faellt nie unter 0/500 ──


def test_completed_no_catastrophe_no_scram_floors_at_500():
    # Massive WARN-Zeit druemte den Rohscore ohne Bodenregel weit unter 0.
    summary = _base(violation_seconds={1: 0, 2: 3600, 3: 0})
    assert scoring.score(summary)['score'] >= 500


def test_completed_no_catastrophe_with_scram_floors_at_0_not_500():
    # Alle Deckel voll ausgereizt plus ein SCRAM druemt den Rohscore auf -50
    # (siehe Rechnung): die schwaechere Bodenregel (nur completed &
    # !catastrophic) hebt auf 0 an, die staerkere (zusaetzlich scram_count==0)
    # greift wegen des SCRAM NICHT -- Ergebnis muss 0 sein, nicht 500.
    summary = _base(scram_count=1, deviation_mwh=1000, alarm_seconds_unacked=10000,
                     violation_seconds={1: 3600, 2: 3600, 3: 3600})
    assert scoring.score(summary)['score'] == 0


def test_fuel_damage_bypasses_the_floor():
    summary = _base(fuel_damage=True)
    assert scoring.score(summary)['score'] < -1000


def test_cont_failed_bypasses_the_floor():
    summary = _base(cont_failed=True)
    assert scoring.score(summary)['score'] < 500


def test_h2_exploded_bypasses_the_floor():
    """Genau der Fehler aus der ersten Entwurfsfassung: die Bodenregel prüfte
    dort nur fuel_damage, nicht cont_failed/h2_exploded -- eine SWR-Schicht
    mit Wasserstoffexplosion bekam dadurch trotzdem +500."""
    summary = _base(h2_exploded=True)
    assert scoring.score(summary)['score'] < 500


def test_cont_failed_and_h2_exploded_are_additive():
    only_cont = scoring.score(_base(cont_failed=True))['score']
    only_h2 = scoring.score(_base(h2_exploded=True))['score']
    both = scoring.score(_base(cont_failed=True, h2_exploded=True))['score']
    # Beide Strafen zusammen, nicht nur die groessere Einzelstrafe.
    assert both == pytest.approx(only_cont - scoring.WEIGHTS['h2_exploded'])
    assert both == pytest.approx(only_h2 - scoring.WEIGHTS['cont_failed'])


# ── Gemeinsame Rundung (Python round() vs. JS Math.round() bei exakten .5) ──


def test_round_score_matches_round_half_away_from_zero():
    assert scoring._round_score(0.5) == 1
    assert scoring._round_score(-0.5) == -1
    assert scoring._round_score(2.5) == 3   # Pythons round() rundet das zur 2


def test_exact_half_subtotal_uses_round_away_from_zero_not_python_builtin():
    """alarm_seconds_unacked=30 ergibt alarms=-1.5 exakt (30*0.05, in Python
    zufaellig exakt binaer darstellbar) -- zusammen mit mission+energy+bonus
    (1000+1000+250) eine Teilsumme von genau 2248.5. floor(2248.5) ist
    GERADE (2248): Pythons eingebautes round() würde deshalb ABrunden auf
    2248 (Bankers Rounding, zur geraden Zahl), waehrend "weg von Null"
    aufrundet auf 2249. Nur wenn scoring.score() wirklich _round_score()
    und nicht round() benutzt, kommt 2249 heraus -- der Fehlerfall aus der
    Spezifikations-Ruecksprache waere hier sonst lautlos zurueckgekommen."""
    summary = _base(alarm_seconds_unacked=30)
    result = scoring.score(summary)
    subtotal = sum(v for k, v in result['parts'].items()
                    if k not in ('rounding_adjustment', 'floor_adjustment'))
    assert subtotal == pytest.approx(2248.5)
    assert round(subtotal) == 2248            # Pythons eingebautes round() -- NICHT das Sollverhalten
    assert result['score'] == 2249            # weg-von-Null, wie gefordert
