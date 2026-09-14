#!/usr/bin/env python3
"""Schnittstelle: Pfadprüfung, Größengrenzen, Ratenbegrenzung, Wertung.

Ausgeführt mit: python3 -m pytest reactorsim/tests/test_api.py
"""

import json
import os
import sys
import tempfile

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)


TEST_USER = 'tester'
TEST_PASSWORD = 'test-passwort-123'


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Angemeldeter Client.

    Seit 0.0.13 liegt alles ausser /health und /login hinter der Anmeldung.
    Diese Tests pruefen die Schnittstelle selbst, nicht den Zugang -- der hat
    seine eigene Datei (test_auth.py). Also hier einmal anmelden und fertig.
    """
    import re
    monkeypatch.setenv('REACTORSIM_BASE', _ROOT)
    monkeypatch.setenv('REACTORSIM_DATA', str(tmp_path))
    monkeypatch.setenv('REACTORSIM_USER', TEST_USER)
    monkeypatch.setenv('REACTORSIM_PASSWORD', TEST_PASSWORD)
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io'):
        sys.modules.pop(mod, None)
    import app as appmod
    appmod.app.config['TESTING'] = True
    c = appmod.app.test_client()
    html = c.get('/login').get_data(as_text=True)
    csrf = re.search(r'name="csrf" value="([^"]+)"', html).group(1)
    r = c.post('/login', data={'user': TEST_USER, 'password': TEST_PASSWORD,
                               'csrf': csrf, 'next': '/'})
    assert r.status_code == 302, 'Anmeldung im Test fehlgeschlagen'
    return c


def _summary(**over):
    base = {
        'reactor': 'pwr',
        'scenario': 'pwr_load_follow',
        'difficulty': 1,
        'energy_mwh_delivered': 5400.0,
        'energy_mwh_demanded': 5600.0,
        'deviation_mwh': 12.5,
        'alarm_seconds_unacked': 60,
        'violation_seconds': {'1': 30, '2': 0, '3': 0},
        'scram_count': 0,
        'fuel_damage': False,
        'duration_s': 14400.0,
        'completed': True,
    }
    base.update(over)
    return base


def test_health_and_meta(client):
    assert client.get('/health').get_json()['status'] == 'ok'
    meta = client.get('/api/meta').get_json()
    assert len(meta['scenarios']) >= 4
    assert all(s['reactor'] in ('pwr', 'bwr', 'rbmk') for s in meta['scenarios'])


def test_progression_scenarios_and_guidance_are_discoverable(client):
    scenarios = {s['id']: s for s in client.get('/api/meta').get_json()['scenarios']}
    ids = ['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults']
    for difficulty, scenario_id in enumerate(ids, 1):
        scenario = scenarios[scenario_id]
        assert scenario['difficulty'] == difficulty
        assert not scenario['tutorial']
        assert scenario['guidance']['auto_helper'] == (difficulty == 1)
        assert scenario['guidance']['event_alerts'] == (difficulty == 1)
        assert scenario['guidance']['hint_key'] == f'scn_{scenario_id}_hint'
    page = client.get('/').get_data(as_text=True)
    assert 'id="rs-guidance"' in page
    assert 'id="rs-brief-guidance"' in page


@pytest.mark.parametrize('slot', ['UPPER', 'mit punkt.', 'a' * 33, 'mit leer zeichen'])
def test_bad_slot_names_rejected(client, slot):
    r = client.put(f'/api/saves/{slot}', json={'v': 1})
    assert r.status_code == 400, slot


def test_path_traversal_cannot_escape(client, tmp_path):
    # Flask loest den Pfad selbst auf; wichtig ist, dass nichts ausserhalb
    # von /data entsteht.
    for slot in ['../../etc/passwd', '..%2F..%2Fx', 'a/b']:
        client.put(f'/api/saves/{slot}', json={'v': 1})
    for root, _dirs, files in os.walk(tmp_path):
        for name in files:
            assert str(tmp_path) in os.path.abspath(os.path.join(root, name))
    assert not os.path.exists('/tmp/reactorsim-escaped')


def test_save_roundtrip_and_size_limit(client):
    assert client.put('/api/saves/slot1', json={'v': 1, 'reactor': 'pwr', 't_sim': 5.0}).status_code == 200
    got = client.get('/api/saves/slot1').get_json()
    assert got['t_sim'] == 5.0
    listed = client.get('/api/saves').get_json()['saves']
    assert listed[0]['slot'] == 'slot1'

    big = {'v': 1, 'reactor': 'pwr', 'pad': 'x' * 200_000}
    r = client.put('/api/saves/big', json=big)
    assert r.status_code in (413, 400)

    assert client.delete('/api/saves/slot1').get_json()['ok'] is True
    assert client.get('/api/saves/slot1').status_code == 404


def test_score_is_recomputed_not_trusted(client):
    r = client.post('/api/highscores',
                    json={'name': 'Operator', 'score': 999999, 'summary': _summary()})
    data = r.get_json()
    assert r.status_code == 200
    assert data['score'] != 999999
    # Genau der Wert, den auch der Browser rechnet.
    sys.path.insert(0, _ROOT)
    import scoring
    assert data['score'] == scoring.score(_summary())['score']


def test_difficulty_comes_from_the_scenario_not_the_request(client):
    """Der Schwierigkeitsgrad ist ein Faktor im Abschlussbonus, und zwar ohne
    Deckel. Kam er aus der Anfrage, liess sich der Punktestand beliebig hoch
    schrauben -- validate_summary prueft jede andere Kennzahl, diese nicht:
    difficulty=1e6 mit completed=true ergab 250 Mio Punkte und ging glatt
    durch. Jetzt gewinnt die Szenariodatei."""
    import scoring
    r = client.post('/api/highscores',
                    json={'name': 'Schummler',
                          'summary': _summary(difficulty=1_000_000)})
    assert r.status_code == 200
    # pwr_load_follow steht in der Datei auf difficulty 1 -- genau der Wert,
    # den die ehrliche Rechnung benutzt.
    assert r.get_json()['score'] == scoring.score(_summary(difficulty=1))['score']


def test_difficulty_is_filled_in_when_missing(client):
    """Ueberschreiben statt pruefen heisst auch: ein Lauf ohne das Feld
    bekommt trotzdem den richtigen Bonus, statt still auf 1 zurueckzufallen."""
    import scoring
    # pwr_turbine_trip steht in der Datei auf difficulty 2 und dauert eine
    # Stunde -- die Kennzahlen muessen dazu passen, sonst greift vorher die
    # Plausibilitaetspruefung.
    summary = _summary(scenario='pwr_turbine_trip', duration_s=3600.0,
                       energy_mwh_delivered=1350.0, energy_mwh_demanded=1400.0,
                       violation_seconds={'1': 30, '2': 0, '3': 0})
    summary.pop('difficulty')
    r = client.post('/api/highscores', json={'name': 'X', 'summary': summary})
    assert r.status_code == 200
    assert r.get_json()['score'] == scoring.score({**summary, 'difficulty': 2})['score']


def test_score_with_log_is_verified_server_side_not_trusted(client):
    """Wird ein Protokoll mitgeschickt (siehe game/recorder.js), rechnet der
    Server den Lauf selbst nach (verify_run.mjs, Node) und ERSETZT die
    gemeldeten Kennzahlen komplett -- ein Client, der ein leeres Protokoll
    (keine Bedienhandlung) mit einer erfundenen Zusammenfassung kombiniert,
    bekommt trotzdem die ehrliche Wertung fuer "eine Stunde lang nichts
    getan", nicht seine erfundenen Zahlen.

    pwr_turbine_trip ohne jeden Eingriff: Turbine faellt ab, niemand fuehrt
    Speisewasser oder Turbine nach, die Netzabweichung reisst irgendwann die
    Frist -- deterministisch, siehe tests/test-replay.mjs fuer denselben Lauf
    unter Node."""
    import scoring
    real_summary = _summary(
        scenario='pwr_turbine_trip', duration_s=1200.0,
        energy_mwh_delivered=233.34, energy_mwh_demanded=466.67,
        deviation_mwh=223.333, violation_seconds={'1': 0, '2': 510, '3': 90},
        alarm_seconds_unacked=1347, completed=False, difficulty=2)
    fake_summary = _summary(scenario='pwr_turbine_trip', duration_s=3600.0,
                            energy_mwh_delivered=999999.0, energy_mwh_demanded=1.0,
                            completed=True, deviation_mwh=0.0)
    r = client.post('/api/highscores', json={'name': 'Schummler', 'summary': fake_summary, 'log': []})
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    # completed steht in STORE.add_score()'s entry direkt, aus der
    # tatsaechlich verwendeten Zusammenfassung -- False beweist, dass nicht
    # die erfundene ("completed": True) durchging.
    assert data['entry']['completed'] is False
    assert data['score'] == scoring.score(real_summary)['score']
    assert data['score'] != scoring.score(fake_summary)['score']


def test_score_verification_failure_is_rejected_not_trusted(client, monkeypatch):
    """Schlaegt die Nachrechnung selbst fehl (hier erzwungen: Skript fehlt),
    darf das NICHT auf die Klientenangabe zurueckfallen -- wer ein Protokoll
    mitschickt, verspricht damit, dass es sich nachrechnen laesst."""
    import app as appmod
    monkeypatch.setattr(appmod, 'VERIFY_SCRIPT', str(_HERE) + '/does-not-exist.mjs')
    r = client.post('/api/highscores',
                    json={'name': 'X', 'summary': _summary(), 'log': []})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'verification_failed'


def test_security_headers_are_set(client):
    """Der Dienst haengt auf einem offenen LAN-Port. Ohne frame-ancestors
    laesst sich das Anmeldeformular in einen fremden Rahmen setzen."""
    for path in ('/', '/login'):
        h = client.get(path).headers
        csp = h['Content-Security-Policy']
        assert "frame-ancestors 'none'" in csp, path
        assert "default-src 'self'" in csp, path
        assert "unsafe-inline" not in csp, path
        assert h['X-Content-Type-Options'] == 'nosniff', path
        assert h['X-Frame-Options'] == 'DENY', path


def test_inline_blocks_carry_a_fresh_nonce(client):
    """Die Uebersetzungstabelle (index.html) und das Anmelde-CSS (login.html)
    stehen inline. Ohne passende Nonce im Kopf wuerde die eigene Seite an der
    eigenen Richtlinie scheitern -- und eine ueber Antworten hinweg gleiche
    Nonce waere dasselbe wie keine."""
    import re
    seen = set()
    for path in ('/', '/login'):
        r = client.get(path)
        html = r.get_data(as_text=True)
        nonce = re.search(r'nonce="([^"]+)"', html).group(1)
        assert f"'nonce-{nonce}'" in r.headers['Content-Security-Policy'], path
        seen.add(nonce)
    assert len(seen) == 2, 'Nonce war zweimal dieselbe'


@pytest.mark.parametrize('over,why', [
    ({'energy_mwh_delivered': 999999}, 'energy_impossible'),
    ({'duration_s': 999999}, 'duration_too_long'),
    ({'deviation_mwh': -5}, 'deviation_negative'),
    ({'violation_seconds': {'1': 99999, '2': 0, '3': 0}}, 'violation_seconds_invalid'),
    ({'scram_count': -1}, 'scram_count_invalid'),
])
def test_implausible_summaries_rejected(client, over, why):
    r = client.post('/api/highscores', json={'name': 'X', 'summary': _summary(**over)})
    assert r.status_code == 400
    assert r.get_json()['detail'] == why


def test_unknown_ids_rejected(client):
    r = client.post('/api/highscores',
                    json={'name': 'X', 'summary': _summary(scenario='gibts_nicht')})
    assert r.get_json()['error'] == 'bad_scenario'
    r = client.post('/api/highscores', json={'name': 'X', 'summary': _summary(reactor='fusion')})
    assert r.get_json()['error'] == 'bad_reactor'
    # Szenario existiert, passt aber nicht zum Reaktortyp.
    r = client.post('/api/highscores',
                    json={'name': 'X', 'summary': _summary(scenario='bwr_msiv')})
    assert r.get_json()['error'] == 'reactor_mismatch'


def test_name_is_cleaned_and_required(client):
    r = client.post('/api/highscores', json={'name': '   ', 'summary': _summary()})
    assert r.get_json()['error'] == 'bad_name'

    import persist
    assert persist.Store.clean_name('Ope​rator\x07') == 'Operator'
    assert len(persist.Store.clean_name('x' * 100)) == 24


def test_rate_limit_on_highscores(client):
    first = client.post('/api/highscores', json={'name': 'A', 'summary': _summary()})
    assert first.status_code == 200
    second = client.post('/api/highscores', json={'name': 'B', 'summary': _summary()})
    assert second.status_code == 429


def test_scores_are_sorted_and_capped(client, tmp_path):
    import persist
    store = persist.Store(str(tmp_path))
    for i in range(60):
        store.add_score('pwr', 'pwr_load_follow', f'P{i}', i * 10, {'completed': True})
    scores = store.list_scores('pwr', 'pwr_load_follow', limit=50)
    assert len(scores) <= persist.MAX_SCORES_PER_LIST
    assert scores == sorted(scores, key=lambda e: e['score'], reverse=True)
    assert scores[0]['score'] == 590


def test_rate_limit_forgets_expired_keys(monkeypatch):
    """Aufgeraeumt wurden vorher nur Schluessel mit LEERER Liste. Ein
    Spieler-Token, das einmal getroffen und nie wieder gesehen wurde, behielt
    seinen Eintrag fuer immer -- bei einem Cookie je Geraet wuchs die Tabelle
    ueber die Laufzeit des Containers monoton mit."""
    import persist
    limits = persist.RateLimit()
    monkeypatch.setattr(limits, '_SWEEP_AT', 4)

    now = [1000.0]
    monkeypatch.setattr(persist.time, 'monotonic', lambda: now[0])

    for i in range(4):
        assert limits.hit(f'alt:{i}', 5, 60)
    assert len(limits._hits) == 4

    # Eine Stunde spaeter ist keiner der alten Schluessel mehr im Fenster.
    now[0] += 3600
    limits.hit('neu', 5, 60)
    assert set(limits._hits) == {'neu'}


def test_rate_limit_keeps_live_keys_across_a_sweep(monkeypatch):
    """Aufraeumen darf nur wegwerfen, was abgelaufen ist -- sonst hebt der
    Speicherschutz die Grenze auf, die er schuetzen soll."""
    import persist
    limits = persist.RateLimit()
    monkeypatch.setattr(limits, '_SWEEP_AT', 2)
    assert limits.hit('dauer', 2, 86400)
    for i in range(5):
        limits.hit(f'kurz:{i}', 5, 60)
    assert 'dauer' in limits._hits
    assert limits.hit('dauer', 2, 86400)      # zweiter von zwei
    assert not limits.hit('dauer', 2, 86400)  # Grenze steht noch


def test_save_slot_limit_without_parsing_every_slot(tmp_path, monkeypatch):
    """write_save() zaehlt nur noch, statt jeden Slot zu oeffnen und zu
    parsen. Verhalten an der Obergrenze muss dasselbe bleiben."""
    import persist
    store = persist.Store(str(tmp_path))
    pid = store.new_player_id()
    for i in range(persist.MAX_SLOTS):
        assert store.write_save(pid, f'slot{i}', {'v': 1}) is None
    assert store.count_saves(pid) == persist.MAX_SLOTS

    # Voll: ein NEUER Slot geht nicht mehr, ein vorhandener schon.
    assert store.write_save(pid, 'noch-einer', {'v': 1}) == 'too_many_slots'
    assert store.write_save(pid, 'slot0', {'v': 2}) is None

    # Die Einstellungen liegen im selben Ordner, zaehlen aber nicht als Slot.
    store.write_prefs(pid, {'a': 1})
    assert store.count_saves(pid) == persist.MAX_SLOTS
    assert len(store.list_saves(pid)) == persist.MAX_SLOTS


def test_migrate_legacy_copies_once_and_never_overwrites(tmp_path):
    """Alte, anonyme Geraete-Speicherstaende wandern einmalig in den Account
    -- ein zweiter Aufruf (z.B. ein zweites Geraet mit noch altem Cookie)
    darf nicht ueberschreiben, was der Account inzwischen selbst hat."""
    import persist
    store = persist.Store(str(tmp_path))
    legacy = store.new_player_id()
    store.write_save(legacy, 'slot1', {'v': 1, 'reactor': 'pwr'})
    store.write_prefs(legacy, {'x': 1})

    account = persist.Store.account_key('alice')
    store.migrate_legacy(account, legacy)
    assert store.read_save(account, 'slot1') == {'v': 1, 'reactor': 'pwr'}
    assert store.read_prefs(account) == {'x': 1}

    store.write_save(account, 'slot1', {'v': 2, 'reactor': 'pwr'})
    store.migrate_legacy(account, legacy)
    assert store.read_save(account, 'slot1') == {'v': 2, 'reactor': 'pwr'}


def test_legacy_cookie_save_migrates_to_account_on_first_login(tmp_path, monkeypatch):
    """Wer schon vor der Kontenpflicht gespielt hat, traegt den alten
    rs_player-Cookie noch im Browser -- beim ersten Login damit muss der
    alte Stand im neuen Konto auftauchen."""
    import re

    import persist

    monkeypatch.setenv('REACTORSIM_BASE', _ROOT)
    monkeypatch.setenv('REACTORSIM_DATA', str(tmp_path))
    monkeypatch.setenv('REACTORSIM_USER', TEST_USER)
    monkeypatch.setenv('REACTORSIM_PASSWORD', TEST_PASSWORD)
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io'):
        sys.modules.pop(mod, None)
    import app as appmod
    appmod.app.config['TESTING'] = True

    legacy_store = persist.Store(str(tmp_path))
    legacy_pid = legacy_store.new_player_id()
    legacy_store.write_save(legacy_pid, 'altstand', {'v': 1, 'reactor': 'pwr'})

    c = appmod.app.test_client()
    c.set_cookie('rs_player', legacy_pid)
    html = c.get('/login').get_data(as_text=True)
    csrf = re.search(r'name="csrf" value="([^"]+)"', html).group(1)
    r = c.post('/login', data={'user': TEST_USER, 'password': TEST_PASSWORD,
                               'csrf': csrf, 'next': '/'})
    assert r.status_code == 302

    saves = c.get('/api/saves').get_json()['saves']
    assert any(s['slot'] == 'altstand' for s in saves)


def test_atomic_write_survives_partial_failure(tmp_path):
    import atomic_io
    path = os.path.join(tmp_path, 'x.json')
    atomic_io.write_json(path, {'a': 1})
    with pytest.raises(TypeError):
        atomic_io.write_json(path, {'b': object()})
    # Die alte Datei steht noch vollstaendig da, und es liegt kein halber
    # Schreibvorgang daneben.
    with open(path, encoding='utf-8') as f:
        assert json.load(f) == {'a': 1}
    leftovers = [n for n in os.listdir(tmp_path) if n.startswith('.tmp-')]
    assert leftovers == []


def test_startup_tutorial_is_discoverable_and_unranked(client):
    scenarios = client.get('/api/meta').get_json()['scenarios']
    tutorial = next(s for s in scenarios if s['id'] == 'pwr_startup_tutorial')
    assert tutorial['tutorial'] == 'pwr_startup'
    response = client.post('/api/highscores', json={
        'name': 'Learner', 'summary': _summary(scenario='pwr_startup_tutorial'),
    })
    assert response.status_code == 400
    assert response.get_json()['error'] == 'tutorial_unranked'


INCIDENT_IDS = ['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults']


def _incident_summary(scn, **over):
    return _summary(
        **dict({'scenario': scn['id'], 'score_mode': 'incident_v1',
                'difficulty': scn['difficulty'], 'duration_s': scn['duration_s'],
                'energy_mwh_delivered': 0, 'energy_mwh_demanded': 0,
                'deviation_mwh': 0, 'alarm_seconds_unacked': 0,
                'violation_seconds': {'1': 0, '2': 0, '3': 0}, 'failed': None,
                'objectives': [{'id': o['id'], 'met': True} for o in scn['objectives']]}, **over))


@pytest.mark.parametrize('scenario_id', INCIDENT_IDS)
def test_incident_catalog_contract(client, scenario_id):
    import app as appmod
    scn = appmod.SCENARIO_BY_ID[scenario_id]
    assert scn['score_mode'] == 'incident_v1'
    expected = ['power', 'stable'] if scenario_id == 'pwr_sg_tube_leak' else ['supply', 'stable']
    assert [o['id'] for o in scn['objectives']] == expected
    for objective in scn['objectives']:
        assert {'id', 'type', 'after_events', 'hold_s'} <= set(objective)
        assert set(objective) <= {'id', 'type', 'after_events', 'hold_s', 'max_power_fraction'}
    meta = client.get('/api/meta').get_json()['scenarios']
    assert next(s for s in meta if s['id'] == scenario_id)['objectives'] == scn['objectives']


@pytest.mark.parametrize('log_body', [{}, {'log': None}, {'log': {}}, {'log': ''}, {'log': False}, {'log': 1}])
def test_incident_requires_list_log(client, monkeypatch, log_body):
    import app as appmod
    def unexpected(*args):
        pytest.fail('invalid log must not invoke replay')
    monkeypatch.setattr(appmod, '_verify_run', unexpected)
    r = client.post('/api/highscores', json={
        'name': 'X', 'summary': _summary(scenario=INCIDENT_IDS[0]), **log_body})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'replay_required'
    assert appmod.STORE.list_scores() == []


@pytest.mark.parametrize('scenario_id', INCIDENT_IDS)
def test_incident_empty_log_replayed_and_client_targets_ignored(client, monkeypatch, scenario_id):
    import app as appmod
    scn = appmod.SCENARIO_BY_ID[scenario_id]
    verified = _incident_summary(scn, difficulty=999999)
    calls = []
    def verify(reactor, file, action_log):
        calls.append((reactor, file, action_log))
        return verified
    monkeypatch.setattr(appmod, '_verify_run', verify)
    r = client.post('/api/highscores', json={
        'name': 'X', 'log': [], 'score_mode': 'legacy',
        'objectives': [{'id': 'invented', 'met': True}],
        'summary': _summary(scenario=scenario_id, score_mode='invented', difficulty=1e9,
                            objectives=[{'id': 'free_points', 'met': True}])})
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    assert calls == [('pwr', scn['file'], [])]
    assert data['score'] == 3000 + 250 * scn['difficulty']
    assert data['summary'] == dict(verified, difficulty=scn['difficulty'])
    assert data['entry']['score_mode'] == 'incident_v1'
    assert data['parts']['objectives'] == 2000


@pytest.mark.parametrize('over,detail', [
    ({'score_mode': None}, 'score_mode_invalid'),
    ({'score_mode': 'legacy'}, 'score_mode_invalid'),
    ({'reactor': 'bwr'}, 'identity_mismatch'),
    ({'scenario': 'pwr_load_follow'}, 'identity_mismatch'),
    ({'objectives': None}, 'objectives_invalid'),
    ({'objectives': []}, 'objectives_invalid'),
    ({'objectives': [{'id': 'supply', 'met': True}] * 2}, 'objectives_invalid'),
    ({'objectives': [{'id': 'invented', 'met': True}, {'id': 'stable', 'met': True}]}, 'objectives_invalid'),
    ({'objectives': [{'id': [], 'met': True}, {'id': 'stable', 'met': True}]}, 'objectives_invalid'),
    ({'objectives': [{'id': 'supply', 'met': 1}, {'id': 'stable', 'met': True}]}, 'objectives_invalid'),
    ({'objectives': [{'id': 'supply', 'met': True, 'hold_s': 0}, {'id': 'stable', 'met': True}]}, 'objectives_invalid'),
    ({'objectives': [{'id': 'supply', 'met': False}, {'id': 'stable', 'met': True}]}, 'completion_invalid'),
    ({'duration_s': 899.9}, 'completion_early'),
    ({'completed': 1}, 'completed_invalid'),
    ({'fuel_damage': 'false'}, 'fuel_damage_invalid'),
    ({'fuel_damage': True}, 'completion_invalid'),
    ({'failed': 'fail_objectives_unmet'}, 'completion_invalid'),
])
def test_incident_replay_summary_contract_rejected(client, monkeypatch, over, detail):
    import app as appmod
    scn = appmod.SCENARIO_BY_ID[INCIDENT_IDS[0]]
    verified = _incident_summary(scn, **over)
    monkeypatch.setattr(appmod, '_verify_run', lambda *args: verified)
    r = client.post('/api/highscores', json={'name': 'X', 'log': [], 'summary': _incident_summary(scn)})
    assert r.status_code == 400
    assert r.get_json() == {'error': 'implausible', 'detail': detail}
    assert appmod.STORE.list_scores() == []


@pytest.mark.parametrize('objectives', [None, [], [{'id': 'supply'}] * 2,
                                      [{'id': []}, {'id': 'stable'}], [{'id': ''}, {'id': 'stable'}]])
def test_incident_invalid_config_ids_rejected(client, monkeypatch, objectives):
    import app as appmod
    scn = appmod.SCENARIO_BY_ID[INCIDENT_IDS[0]]
    verified = _incident_summary(scn)
    monkeypatch.setattr(appmod, '_verify_run', lambda *args: verified)
    monkeypatch.setitem(scn, 'objectives', objectives)
    r = client.post('/api/highscores', json={'name': 'X', 'log': [], 'summary': verified})
    assert r.status_code == 400
    assert r.get_json()['detail'] == 'objective_config_invalid'


def test_incident_verify_error_never_falls_back(client, monkeypatch):
    import app as appmod
    monkeypatch.setattr(appmod, '_verify_run', lambda *args: None)
    r = client.post('/api/highscores', json={
        'name': 'X', 'log': [], 'summary': _incident_summary(appmod.SCENARIO_BY_ID[INCIDENT_IDS[0]])})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'verification_failed'


@pytest.mark.parametrize('scenario_id', INCIDENT_IDS)
def test_incident_real_idle_replay(client, scenario_id):
    import app as appmod
    import scoring
    scn = appmod.SCENARIO_BY_ID[scenario_id]
    r = client.post('/api/highscores', json={'name': 'Idle', 'log': [], 'summary': _incident_summary(scn)})
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    assert data['summary']['score_mode'] == 'incident_v1'
    assert data['summary']['completed'] is False
    assert scoring.validate_summary(data['summary'], scn, 1400) is None
    assert scoring.score(data['summary']) == {'score': data['score'], 'parts': data['parts']}


def test_incident_guided_helper_log_is_verified_and_ranked(client):
    import app as appmod
    import scoring
    scn = appmod.SCENARIO_BY_ID['pwr_feedwater_loss']
    action_log = [{'n': 3820, 'id': 'scram'},
                  {'n': 3900, 'id': 'helper', 'value': 'sg_level_low'}]
    r = client.post('/api/highscores', json={
        'name': 'Guided', 'log': action_log,
        'summary': _incident_summary(scn, completed=False, objectives=[])})
    assert r.status_code == 200, r.get_json()
    data = r.get_json()
    verified = data['summary']
    assert verified['completed'] is True
    assert verified['failed'] is None
    assert verified['duration_s'] == scn['duration_s']
    assert verified['scram_count'] == 1
    assert verified['objectives'] == [{'id': 'supply', 'met': True}, {'id': 'stable', 'met': True}]
    assert data['parts']['objectives'] == 2000
    assert data['parts']['mission'] == 1000
    assert data['parts']['bonus'] == 250
    assert scoring.score(verified) == {'score': data['score'], 'parts': data['parts']}
    assert 3150 <= data['score'] <= 3250
    assert client.get('/api/highscores?scenario=pwr_feedwater_loss').get_json()['scores'] == [data['entry']]


@pytest.mark.parametrize('scenario_id,trip_id', [
    ('pwr_sg_tube_leak', 'sg_level_low'),
    ('pwr_combined_faults', 'sg_level_low'),
    *[('pwr_feedwater_loss', value) for value in
      ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown', None, [], {}]],
])
def test_incident_denied_or_invalid_helper_log_rejected(client, scenario_id, trip_id):
    import app as appmod
    r = client.post('/api/highscores', json={
        'name': 'X', 'summary': _incident_summary(appmod.SCENARIO_BY_ID[scenario_id]),
        'log': [{'n': 3900, 'id': 'helper', 'value': trip_id}]})
    assert r.status_code == 400
    assert r.get_json()['error'] == 'verification_failed'
    assert appmod.STORE.list_scores() == []


@pytest.mark.parametrize('with_log', [False, True])
def test_legacy_injected_incident_fields_do_not_change_score(client, monkeypatch, with_log):
    import app as appmod
    import scoring
    fake = _summary(score_mode='incident_v1', objectives=[{'id': 'free', 'met': True}] * 2)
    monkeypatch.setattr(appmod, '_verify_run', lambda *args: fake)
    r = client.post('/api/highscores', json={
        'name': 'Legacy', 'summary': fake, **({'log': []} if with_log else {})})
    assert r.status_code == 200
    data = r.get_json()
    assert data['score'] == scoring.score(_summary())['score']
    assert data['summary'] == _summary()
    assert 'objectives' not in data['parts']
    assert 'score_mode' not in data['entry']


@pytest.mark.parametrize('field', ['reactor', 'scenario'])
@pytest.mark.parametrize('value', [[], {}, ['pwr'], {'id': 'pwr'}])
def test_json_unhashable_score_identity_returns_400(client, field, value):
    r = client.post('/api/highscores', json={'name': 'X', 'summary': _summary(**{field: value})})
    assert r.status_code == 400
    assert r.get_json()['error'] == f'bad_{field}'


def test_score_versions_have_independent_caps_and_filter_before_limit(client):
    import app as appmod
    import persist
    store = appmod.STORE
    scenario = INCIDENT_IDS[0]
    for i in range(60):
        store.add_score('pwr', scenario, f'old{i}', 10000 + i, {})
    old = store._read_scores()[f'pwr/{scenario}']
    for i in range(60):
        store.add_score('pwr', scenario, f'new{i}', i, {}, score_mode='incident_v1')
    data = store._read_scores()
    assert data[f'pwr/{scenario}'] == old
    assert len(data[f'pwr/{scenario}/incident_v1']) == persist.MAX_SCORES_PER_LIST
    assert len(old) == persist.MAX_SCORES_PER_LIST
    assert all('score_mode' not in e for e in old)
    assert store.list_scores('pwr', scenario, 1, score_mode='legacy')[0]['score'] == 10059
    assert store.list_scores('pwr', scenario, 1, score_mode='incident_v1')[0]['score'] == 59
    store.add_score('pwr', 'pwr_load_follow', 'legacy-current', 100, {'score_mode': 'incident_v1'}, score_mode='legacy')
    assert 'score_mode' not in store.list_scores('pwr', 'pwr_load_follow')[0]
    selected = client.get(f'/api/highscores?scenario={scenario}&limit=1').get_json()['scores']
    assert [e['score'] for e in selected] == [59]
    global_scores = client.get('/api/highscores?limit=2').get_json()['scores']
    assert [e['score'] for e in global_scores] == [100, 59]
    reactor_scores = client.get('/api/highscores?reactor=pwr&limit=2').get_json()['scores']
    assert reactor_scores == global_scores
