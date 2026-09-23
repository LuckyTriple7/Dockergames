#!/usr/bin/env python3
"""Admin-Panel: Spielerkonten anlegen, sperren, Passwoerter zuruecksetzen,
und sehen, wer sich wann von welcher Adresse angemeldet und was er gespielt
hat.

Ausgefuehrt mit: python3 -m pytest reactorsim/tests/test_admin.py
"""

import os
import re
import sqlite3
import sys
import time

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)

ADMIN_USER = 'admin'
ADMIN_PASSWORD = 'admin-passwort-123'


def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv('REACTORSIM_BASE', _ROOT)
    monkeypatch.setenv('REACTORSIM_DATA', str(tmp_path))
    monkeypatch.setenv('REACTORSIM_USER', ADMIN_USER)
    monkeypatch.setenv('REACTORSIM_PASSWORD', ADMIN_PASSWORD)
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io', 'users', 'mailer'):
        sys.modules.pop(mod, None)
    import app as appmod
    appmod.app.config['TESTING'] = True
    return appmod


def _csrf(client, path='/login'):
    html = client.get(path).get_data(as_text=True)
    m = re.search(r'name="csrf" value="([^"]+)"', html)
    assert m, 'kein CSRF-Token im Formular'
    return m.group(1)


@pytest.fixture()
def admin(tmp_path, monkeypatch):
    """Angemeldeter Admin-Client."""
    mod = _fresh(tmp_path, monkeypatch)
    c = mod.app.test_client()
    r = c.post('/login', data={'user': ADMIN_USER, 'password': ADMIN_PASSWORD,
                               'csrf': _csrf(c), 'next': '/'})
    assert r.status_code == 302
    return mod, c


def _admin_csrf(client):
    html = client.get('/admin').get_data(as_text=True)
    m = re.search(r'name="csrf" value="([^"]+)"', html)
    assert m, 'kein CSRF-Token im Admin-Panel'
    return m.group(1)


def test_admin_can_create_a_player_with_generated_password(admin):
    """Ohne eigenes Passwort im Formular erzeugt das Panel eines und zeigt
    es GENAU EINMAL an -- wie beim Admin-Bootstrap in auth.py."""
    mod, c = admin
    r = c.post('/admin/users', data={
        'email': 'Neu@Example.TEST', 'password': '', 'csrf': _admin_csrf(c)})
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert 'neu@example.test' in html.lower()

    # Das erzeugte Passwort steht nur in dieser Antwort, nirgendwo gespeichert.
    row = mod.USERS.find_for_login('neu@example.test')
    assert row is not None
    assert row['status'] == 'active'

    m = re.search(r'neu@example\.test.*?:\s*([^\s<]+)', html, re.IGNORECASE | re.DOTALL)
    assert m, f'kein Passwort in der Antwort gefunden: {html!r}'
    generated = m.group(1)

    player = mod.app.test_client()
    login_csrf = _csrf(player)
    lr = player.post('/login', data={'user': 'neu@example.test', 'password': generated,
                                     'csrf': login_csrf, 'next': '/'})
    assert lr.status_code == 302
    assert lr.headers['Location'].endswith('/')
    assert player.get('/api/meta').status_code == 200


def test_admin_can_create_a_player_with_own_password(admin):
    mod, c = admin
    r = c.post('/admin/users', data={
        'email': 'own@example.test', 'password': 'eigenes-passwort-99', 'csrf': _admin_csrf(c)})
    assert r.status_code == 200
    player = mod.app.test_client()
    lr = player.post('/login', data={'user': 'own@example.test', 'password': 'eigenes-passwort-99',
                                     'csrf': _csrf(player), 'next': '/'})
    assert lr.status_code == 302


@pytest.mark.parametrize('email', ['not-an-email', '', '   ', 'a@b'])
def test_bad_email_rejected(admin, email):
    mod, c = admin
    r = c.post('/admin/users', data={'email': email, 'password': '', 'csrf': _admin_csrf(c)})
    assert r.status_code == 400
    assert mod.USERS.find_for_login(email) is None


def test_duplicate_email_rejected(admin):
    mod, c = admin
    ok = c.post('/admin/users', data={'email': 'dup@example.test', 'password': 'erstes-passwort-1', 'csrf': _admin_csrf(c)})
    assert ok.status_code == 200
    again = c.post('/admin/users', data={'email': 'dup@example.test', 'password': 'zweites-passwort-2', 'csrf': _admin_csrf(c)})
    assert again.status_code == 400
    # Das erste Konto bleibt unveraendert nutzbar.
    player = mod.app.test_client()
    lr = player.post('/login', data={'user': 'dup@example.test', 'password': 'erstes-passwort-1',
                                     'csrf': _csrf(player), 'next': '/'})
    assert lr.status_code == 302


def test_short_password_rejected(admin):
    mod, c = admin
    r = c.post('/admin/users', data={'email': 'kurz@example.test', 'password': 'kurz', 'csrf': _admin_csrf(c)})
    assert r.status_code == 400
    assert mod.USERS.find_for_login('kurz@example.test') is None


def test_admin_form_requires_csrf(admin):
    mod, c = admin
    r = c.post('/admin/users', data={'email': 'nocsrf@example.test', 'password': ''})
    assert r.status_code == 400
    assert mod.USERS.find_for_login('nocsrf@example.test') is None


def test_lock_prevents_login_and_unlock_restores_it(admin):
    mod, c = admin
    user, err = mod.USERS.create_user('sperr@example.test', 'sperr-passwort-1')
    assert err is None
    csrf = _admin_csrf(c)
    r = c.post(f"/admin/users/{user['id']}/lock", data={'csrf': csrf})
    assert r.status_code == 200
    assert mod.USERS.find_for_login('sperr@example.test')['status'] == 'locked'

    player = mod.app.test_client()
    lr = player.post('/login', data={'user': 'sperr@example.test', 'password': 'sperr-passwort-1',
                                     'csrf': _csrf(player), 'next': '/'})
    assert lr.status_code == 401

    r2 = c.post(f"/admin/users/{user['id']}/unlock", data={'csrf': _admin_csrf(c)})
    assert r2.status_code == 200
    assert mod.USERS.find_for_login('sperr@example.test')['status'] == 'active'
    player2 = mod.app.test_client()
    lr2 = player2.post('/login', data={'user': 'sperr@example.test', 'password': 'sperr-passwort-1',
                                       'csrf': _csrf(player2), 'next': '/'})
    assert lr2.status_code == 302


def test_reset_password_shows_it_once_and_invalidates_the_old_one(admin):
    mod, c = admin
    user, err = mod.USERS.create_user('reset@example.test', 'altes-passwort-1')
    assert err is None
    r = c.post(f"/admin/users/{user['id']}/reset-password", data={'csrf': _admin_csrf(c)})
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    m = re.search(r'reset@example\.test.*?:\s*([^\s<]+)', html, re.IGNORECASE | re.DOTALL)
    assert m, f'kein neues Passwort in der Antwort: {html!r}'
    new_password = m.group(1)

    old_attempt = mod.app.test_client()
    r_old = old_attempt.post('/login', data={'user': 'reset@example.test', 'password': 'altes-passwort-1',
                                             'csrf': _csrf(old_attempt), 'next': '/'})
    assert r_old.status_code == 401

    new_attempt = mod.app.test_client()
    r_new = new_attempt.post('/login', data={'user': 'reset@example.test', 'password': new_password,
                                             'csrf': _csrf(new_attempt), 'next': '/'})
    assert r_new.status_code == 302


def test_unknown_user_id_actions_report_not_found(admin):
    mod, c = admin
    csrf = _admin_csrf(c)
    for path in ('lock', 'unlock', 'reset-password'):
        r = c.post(f'/admin/users/does-not-exist/{path}', data={'csrf': csrf})
        assert r.status_code == 404


def test_login_event_is_recorded_with_ip(admin):
    mod, c = admin
    mod.USERS.create_user('log@example.test', 'log-passwort-1')
    player = mod.app.test_client()
    player.post('/login', data={'user': 'log@example.test', 'password': 'log-passwort-1',
                                'csrf': _csrf(player), 'next': '/'},
                environ_overrides={'REMOTE_ADDR': '203.0.113.7'})
    events = mod.USERS.recent_login_events()['rows']
    assert any(e['email'] == 'log@example.test' and e['ip'] == '203.0.113.7' for e in events)

    html = c.get('/admin').get_data(as_text=True)
    assert 'log@example.test' in html
    assert '203.0.113.7' in html


def _player(mod, email='play@example.test', password='play-passwort-1'):
    """Angemeldeter Spieler-Client."""
    mod.USERS.create_user(email, password)
    client = mod.app.test_client()
    r = client.post('/login', data={'user': email, 'password': password,
                                    'csrf': _csrf(client), 'next': '/'})
    assert r.status_code == 302
    return client


def test_a_scored_run_lands_in_the_history_with_its_score(admin):
    """Eine eingereichte Wertung erzeugt auch dann einen Historieneintrag,
    wenn /api/runs nie ankam (alter Client, oder beim Beenden offline) --
    aber nur EINEN, und mit Punktestand."""
    mod, c = admin
    mod.USERS.create_user('play@example.test', 'play-passwort-1')
    player = mod.app.test_client()
    player.post('/login', data={'user': 'play@example.test', 'password': 'play-passwort-1',
                                'csrf': _csrf(player), 'next': '/'})

    summary = {
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'difficulty': 1,
        'energy_mwh_delivered': 5400.0, 'energy_mwh_demanded': 5600.0,
        'deviation_mwh': 12.5, 'alarm_seconds_unacked': 60,
        'violation_seconds': {'1': 30, '2': 0, '3': 0}, 'scram_count': 0,
        'fuel_damage': False, 'duration_s': 14400.0, 'completed': True,
    }
    r = player.post('/api/highscores', json={'name': 'Play', 'summary': summary})
    assert r.status_code == 200, r.get_json()

    sessions = mod.USERS.recent_play_sessions()['rows']
    assert len(sessions) == 1
    entry = sessions[0]
    assert entry['email'] == 'play@example.test'
    assert entry['reactor'] == 'pwr'
    assert entry['scenario'] == 'pwr_load_follow'
    assert entry['duration_s'] == 14400.0
    assert entry['completed'] == 1
    assert entry['mode'] == 'scenario'
    assert entry['outcome'] == 'completed'
    assert entry['score'] == r.get_json()['score']

    html = c.get('/admin').get_data(as_text=True)
    assert 'play@example.test' in html
    assert 'pwr_load_follow' in html


def test_every_finished_run_is_recorded_not_only_scored_ones(admin):
    """Der eigentliche Grund fuer /api/runs: bis dahin zaehlte ein Lauf nur,
    wenn jemand am Ende auf "Eintragen" drueckte. Tutorial, freies Spiel und
    jeder gescheiterte Lauf fehlten in der Historie vollstaendig."""
    mod, c = admin
    player = _player(mod)

    for body in (
        {'reactor': 'pwr', 'scenario': 'pwr_startup_tutorial',
         'duration_s': 1500.0, 'outcome': 'completed'},
        {'reactor': 'rbmk', 'scenario': None, 'duration_s': 900.0, 'outcome': 'aborted'},
        {'reactor': 'bwr', 'scenario': 'bwr_msiv', 'duration_s': 600.0, 'outcome': 'failed'},
        {'reactor': 'rbmk', 'scenario': 'rbmk_chernobyl', 'duration_s': 300.0,
         'outcome': 'destroyed'},
    ):
        assert player.post('/api/runs', json=body).status_code == 200, body

    sessions = mod.USERS.recent_play_sessions()['rows']
    assert len(sessions) == 4
    by_mode = {s['mode'] for s in sessions}
    assert by_mode == {'tutorial', 'free', 'scenario'}
    assert {s['outcome'] for s in sessions} == {'completed', 'aborted', 'failed', 'destroyed'}
    # Und die Spielzeit im Panel zaehlt jetzt alles zusammen, nicht nur das
    # Eingereichte.
    assert mod.USERS.user_stats(sessions[0]['user_id'])['total_playtime_s'] == 3300.0


def test_the_mode_comes_from_the_catalog_not_from_the_request(admin):
    """Ein Client koennte 'mode' mitschicken -- gelesen wird er nicht. Ob ein
    Szenario ein Tutorial ist, steht in seiner Datei."""
    mod, _c = admin
    player = _player(mod)
    ok = player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_startup_tutorial', 'duration_s': 900.0,
        'outcome': 'completed', 'mode': 'scenario'})
    assert ok.status_code == 200
    assert mod.USERS.recent_play_sessions()['rows'][0]['mode'] == 'tutorial'


@pytest.mark.parametrize('body', [
    {'reactor': 'kein-reaktor', 'scenario': None, 'duration_s': 900, 'outcome': 'aborted'},
    {'reactor': 'pwr', 'scenario': 'gibt-es-nicht', 'duration_s': 900, 'outcome': 'aborted'},
    {'reactor': 'pwr', 'scenario': None, 'duration_s': 900, 'outcome': 'ausgedacht'},
    {'reactor': 'pwr', 'scenario': None, 'duration_s': 'viel', 'outcome': 'aborted'},
    {'reactor': 'pwr', 'scenario': None, 'duration_s': 5, 'outcome': 'aborted'},
])
def test_implausible_runs_are_refused(admin, body):
    mod, _c = admin
    player = _player(mod)
    assert player.post('/api/runs', json=body).status_code == 400
    assert mod.USERS.recent_play_sessions()['rows'] == []


def test_an_absurd_duration_is_capped(admin):
    """Ohne eigene Messung bleibt der harte 24-h-Deckel. Er greift, wenn der
    Client den Beginn nie gemeldet hat -- nach einem Neustart des Containers
    etwa, oder bei einem aelteren Client."""
    mod, _c = admin
    player = _player(mod)
    r = player.post('/api/runs', json={'reactor': 'pwr', 'scenario': None,
                                       'duration_s': 9e12, 'outcome': 'aborted'})
    assert r.status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    assert row['duration_s'] == mod._RUN_MAX_DURATION_S
    # Ohne Messung steht dort NICHTS -- eine geschaetzte Zahl waere eine
    # erfundene Angabe.
    assert row['wall_s'] is None


def test_a_measured_run_caps_the_reported_duration_at_what_60x_allows(admin):
    """Der Kern des Ganzen: der Server misst selbst, statt zu glauben.

    Ein Szenariolauf, der Sekundenbruchteile nach dem Start gemeldet wird,
    kann hoechstens ein paar Dutzend Sekunden simulierte Zeit erzeugt haben
    (60x plus Zuschlag) -- keine vier Stunden.
    """
    mod, _c = admin
    player = _player(mod)
    start = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': 'pwr_load_follow'})
    assert start.status_code == 200
    token = start.get_json()['run']

    r = player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'duration_s': 14400.0,
        'outcome': 'completed', 'run': token})
    assert r.status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    # Der Test laeuft in Bruchteilen einer Sekunde: die Grenze ist praktisch
    # der Zuschlag allein.
    assert row['duration_s'] <= mod._RUN_RATE_GRACE_S + 60
    assert row['duration_s'] < 14400.0
    # Und die tatsaechlich verbrachte Zeit steht jetzt daneben.
    assert row['wall_s'] is not None and row['wall_s'] >= 0


def test_a_measured_run_leaves_an_honest_duration_alone(admin):
    """Der Deckel darf eine ehrliche Angabe nicht kuerzen: 45 simulierte
    Sekunden liegen weit unter dem, was der Zuschlag ohnehin zulaesst."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': 'pwr_load_follow'}
                        ).get_json()['run']
    player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'duration_s': 45.0,
        'outcome': 'failed', 'run': token})
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] == 45.0


def test_a_run_token_belongs_to_one_account_and_one_scenario(admin):
    """Eine fremde oder unpassende Kennung misst einen anderen Lauf -- dann
    lieber gar nicht messen als falsch messen."""
    mod, _c = admin
    one = _player(mod, 'eins@example.test', 'eins-passwort-1')
    two = _player(mod, 'zwei@example.test', 'zwei-passwort-1')
    token = one.post('/api/runs/start',
                     json={'reactor': 'pwr', 'scenario': 'pwr_load_follow'}
                     ).get_json()['run']

    # Fremdes Konto: die Kennung greift nicht, der Lauf wird trotzdem
    # aufgezeichnet -- nur ungemessen und mit dem harten Deckel.
    two.post('/api/runs', json={'reactor': 'pwr', 'scenario': 'pwr_load_follow',
                                'duration_s': 9e12, 'outcome': 'aborted', 'run': token})
    stolen = mod.USERS.recent_play_sessions()['rows'][0]
    assert stolen['email'] == 'zwei@example.test'
    assert stolen['wall_s'] is None
    assert stolen['duration_s'] == mod._RUN_MAX_DURATION_S

    # Eigenes Konto, aber anderes Szenario als beim Start gemeldet.
    one.post('/api/runs', json={'reactor': 'bwr', 'scenario': 'bwr_msiv',
                                'duration_s': 9e12, 'outcome': 'aborted', 'run': token})
    assert mod.USERS.recent_play_sessions()['rows'][0]['wall_s'] is None


def test_a_resumed_run_starts_from_the_saved_state_not_from_a_claim(admin):
    """Ein fortgesetzter Lauf beginnt nicht bei null -- und woher, weiss der
    Server aus dem gespeicherten Stand, der auf seiner eigenen Platte liegt,
    nicht aus der Anfrage."""
    mod, _c = admin
    player = _player(mod)
    assert player.put('/api/saves/auto-pwr', json={
        'v': 1, 'reactor': 'pwr', 'scenario': 'pwr_load_follow',
        't_sim': 7200.0, 'state': {}}).status_code == 200

    token = player.post('/api/runs/start', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow',
        'slot': 'auto-pwr'}).get_json()['run']
    player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'duration_s': 7260.0,
        'outcome': 'completed', 'run': token})
    # 7260 s liegen weit ueber dem, was die Messung allein erlauben wuerde,
    # aber innerhalb von "Stand 7200 s + Zuschlag".
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] == 7260.0

    # Ohne den Stand als Ausgangspunkt waere genau dieselbe Angabe gekuerzt.
    bare = player.post('/api/runs/start', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow'}).get_json()['run']
    player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'duration_s': 7260.0,
        'outcome': 'completed', 'run': bare})
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] < 7260.0


# -- Xenon-Zeitsprung und Neustart --------------------------------------------


def _free_run(player, duration_s=9e12, **over):
    body = {'reactor': 'pwr', 'scenario': None, 'duration_s': duration_s,
            'outcome': 'aborted'}
    body.update(over)
    return player.post('/api/runs', json=body)


def test_free_play_no_longer_gets_48_hours_for_free(admin):
    """Bis 0.6.2 hob der Server den Deckel fuer JEDES freie Spiel pauschal um
    die 48 h des Xenon-Zeitraffers an -- ob gesprungen wurde oder nicht. Damit
    war die 60x-Grenze dort wirkungslos: 24 h simulierte Zeit gingen immer
    durch. Ohne angemeldeten Sprung gilt jetzt dieselbe Grenze wie im
    Szenario."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    assert _free_run(player, run=token).status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    assert row['duration_s'] <= mod._RUN_RATE_GRACE_S + 60
    assert row['duration_s'] < mod._RUN_MAX_DURATION_S


def test_an_announced_jump_raises_the_cap_by_exactly_what_was_announced(admin):
    """Der Server rechnet die Physik nicht mit, er kann den Sprung also nicht
    nachpruefen. Was er kann: nur zaehlen, was angemeldet wurde."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    r = player.post('/api/runs/skip', json={'run': token, 'seconds': 8 * 3600.0})
    assert r.status_code == 200 and r.get_json()['skip_s'] == 8 * 3600.0

    assert _free_run(player, run=token).status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    # Acht Stunden Sprung plus der Zuschlag, und keine Minute mehr: die
    # Messung selbst gibt in dieser Sekunde nichts her.
    assert 8 * 3600.0 <= row['duration_s'] <= 8 * 3600.0 + mod._RUN_RATE_GRACE_S + 60


def test_two_jumps_add_up_and_stay_under_the_hard_ceiling(admin):
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    for _ in range(2):
        r = player.post('/api/runs/skip', json={'run': token, 'seconds': 20 * 3600.0})
        assert r.status_code == 200
    # Zusammen 40 h, gedeckelt auf die 24 h, die ohnehin ueber allem stehen.
    assert r.get_json()['skip_s'] == float(mod._RUN_MAX_DURATION_S)
    _free_run(player, run=token)
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] \
        == float(mod._RUN_MAX_DURATION_S)


def test_an_absurd_jump_is_cut_to_the_hard_ceiling(admin):
    """Auch eine erfundene Sekundenzahl hebt nichts ueber den 24-h-Deckel."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    r = player.post('/api/runs/skip', json={'run': token, 'seconds': 9e12})
    assert r.get_json()['skip_s'] == float(mod._RUN_MAX_DURATION_S)
    _free_run(player, run=token)
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] \
        == float(mod._RUN_MAX_DURATION_S)


def test_a_scenario_cannot_announce_a_jump_at_all(admin):
    """Den Knopf gibt es nur im freien Spiel. Ob ein Lauf eines ist, sagt der
    Eintrag auf diesem Server -- nicht die Anfrage."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': 'pwr_load_follow'}
                        ).get_json()['run']
    r = player.post('/api/runs/skip', json={'run': token, 'seconds': 8 * 3600.0})
    assert r.status_code == 400 and r.get_json()['error'] == 'no_open_run'

    player.post('/api/runs', json={'reactor': 'pwr', 'scenario': 'pwr_load_follow',
                                   'duration_s': 9e12, 'outcome': 'aborted',
                                   'run': token})
    row = mod.USERS.recent_play_sessions()['rows'][0]
    assert row['duration_s'] <= mod._RUN_RATE_GRACE_S + 60


@pytest.mark.parametrize('body', [
    {'run': 'gibt-es-nicht', 'seconds': 60.0},
    {'seconds': 60.0},
    {'run': 'gibt-es-nicht'},
])
def test_a_jump_without_a_matching_open_run_is_refused(admin, body):
    mod, _c = admin
    player = _player(mod)
    assert player.post('/api/runs/skip', json=body).status_code == 400


def test_a_jump_cannot_be_announced_for_someone_elses_run(admin):
    mod, _c = admin
    one = _player(mod, 'eins@example.test', 'eins-passwort-1')
    two = _player(mod, 'zwei@example.test', 'zwei-passwort-1')
    token = one.post('/api/runs/start',
                     json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    assert two.post('/api/runs/skip',
                    json={'run': token, 'seconds': 8 * 3600.0}).status_code == 400
    # Der fremde Versuch hat dem Lauf nichts gutgeschrieben.
    _free_run(one, run=token)
    assert mod.USERS.recent_play_sessions()['rows'][0]['duration_s'] \
        <= mod._RUN_RATE_GRACE_S + 60


def _open_runs_db(tmp_path):
    return sqlite3.connect(os.path.join(str(tmp_path), 'runs.db'))


def test_a_measurement_survives_a_restart_and_the_downtime_is_not_playtime(admin, tmp_path):
    """Bis 0.6.2 lag die Messung nur im Speicher: ein Neustart des Containers
    verlor sie, und der Lauf fiel auf den 24-h-Deckel zurueck. Jetzt steht sie
    in runs.db -- ohne die Zeit, in der der Server weg war: davor sass
    niemand."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    player.post('/api/runs/skip', json={'run': token, 'seconds': 3600.0})

    now = time.time()
    with _open_runs_db(tmp_path) as conn:
        # Der Lauf laeuft seit einer Stunde, der Server war die letzten 50
        # Minuten davon nicht erreichbar.
        conn.execute('UPDATE open_runs SET t0 = ?', (now - 3600.0,))
        conn.execute('UPDATE server_seen SET seen = ?', (now - 3000.0,))
    mod.RUNS = mod.OpenRuns(str(tmp_path))

    assert _free_run(player, run=token).status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    # 3600 s offen, 3000 s davon Ausfallzeit: 600 s am Schirm.
    assert 590.0 <= row['wall_s'] <= 640.0
    # Und der angemeldete Sprung hat den Neustart mit ueberlebt.
    assert row['duration_s'] >= 600.0 * mod._RUN_MAX_RATE + 3600.0


def test_a_run_left_open_for_longer_than_a_day_is_forgotten_on_restart(admin, tmp_path):
    """Kein Browser spielt 30 Stunden durch -- dahinter steht ein Tab, den
    niemand mehr anschaut. Solche Eintraege raeumt das Hochfahren weg, statt
    sie als Messung auszugeben."""
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    with _open_runs_db(tmp_path) as conn:
        conn.execute('UPDATE open_runs SET t0 = ?', (time.time() - 30 * 3600.0,))
    mod.RUNS = mod.OpenRuns(str(tmp_path))
    with _open_runs_db(tmp_path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM open_runs').fetchone()[0] == 0

    assert _free_run(player, run=token).status_code == 200
    row = mod.USERS.recent_play_sessions()['rows'][0]
    assert row['wall_s'] is None
    assert row['duration_s'] == float(mod._RUN_MAX_DURATION_S)


def test_the_measurement_works_on_a_data_directory_that_does_not_exist_yet(admin, tmp_path):
    """Beim allerersten Start ist `/data` noch leer -- und kann ganz fehlen.
    Ohne eigenes Anlegen scheitert schon das Erzeugen der Tabellen, und danach
    JEDE Schreibweise, weil es sie dann nie gibt: ein Container, der die
    Zeitmessung stillschweigend nie gehabt haette."""
    mod, _c = admin
    fresh = tmp_path / 'erster-start'
    runs = mod.OpenRuns(str(fresh))
    token = runs.open('konto', 'pwr', None, 0.0)
    assert runs.add_skip('konto', token, 60.0, cap_total=3600.0) == 60.0
    with sqlite3.connect(str(fresh / 'runs.db')) as conn:
        row = conn.execute('SELECT skip_s FROM open_runs').fetchone()
        assert row is not None and row[0] == 60.0
    measured = runs.close('konto', token)
    assert measured['skip_s'] == 60.0 and measured['wall_s'] >= 0.0


def test_a_closed_run_leaves_nothing_behind_on_disk(admin, tmp_path):
    mod, _c = admin
    player = _player(mod)
    token = player.post('/api/runs/start',
                        json={'reactor': 'pwr', 'scenario': None}).get_json()['run']
    with _open_runs_db(tmp_path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM open_runs').fetchone()[0] == 1
    _free_run(player, run=token)
    with _open_runs_db(tmp_path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM open_runs').fetchone()[0] == 0


# -- Blaetterung --------------------------------------------------------------


def test_the_overview_pages_through_more_entries_than_one_screen(admin):
    """Vor 0.6.1 zeigte die Uebersicht die letzten 50 Eintraege und schwieg
    ueber den Rest -- der war nur noch direkt in users.db zu sehen."""
    mod, c = admin
    _player(mod, 'viel@example.test', 'viel-passwort-1')
    uid = mod.USERS.find_for_login('viel@example.test')['id']
    for i in range(mod._ADMIN_LIST_LIMIT + 5):
        mod.USERS.record_play_session(uid, 'pwr', None, 60.0 + i, False,
                                      mode='free', outcome='aborted')

    first = mod.USERS.recent_play_sessions(mod._ADMIN_LIST_LIMIT, 0)
    assert first['total'] == mod._ADMIN_LIST_LIMIT + 5
    assert len(first['rows']) == mod._ADMIN_LIST_LIMIT
    second = mod.USERS.recent_play_sessions(mod._ADMIN_LIST_LIMIT,
                                            mod._ADMIN_LIST_LIMIT)
    assert len(second['rows']) == 5
    # Keine Zeile doppelt, keine verloren.
    first_ids = set(r['duration_s'] for r in first['rows'])
    second_ids = set(r['duration_s'] for r in second['rows'])
    assert not first_ids.intersection(second_ids)

    html = c.get('/admin?runs=2').get_data(as_text=True)
    assert 'Seite 2' in html or 'Page 2' in html
    # Die erste Seite ist von hier aus erreichbar.
    assert 'runs=1' in html


def test_page_numbers_that_make_no_sense_fall_back_to_the_first_page(admin):
    mod, c = admin
    _player(mod, 'egal@example.test', 'egal-passwort-1')
    for query in ('?runs=0', '?runs=-5', '?runs=abc', '?logins=99999999999999999999'):
        assert c.get('/admin' + query).status_code == 200


def test_the_account_page_pages_its_history(admin):
    mod, c = admin
    _player(mod, 'lang@example.test', 'lang-passwort-1')
    uid = mod.USERS.find_for_login('lang@example.test')['id']
    for i in range(mod._ADMIN_DETAIL_LIMIT + 3):
        mod.USERS.record_play_session(uid, 'bwr', None, 100.0 + i, False,
                                      mode='free', outcome='aborted')
    page = mod.USERS.user_play_sessions(uid, mod._ADMIN_DETAIL_LIMIT,
                                        mod._ADMIN_DETAIL_LIMIT)
    assert page['total'] == mod._ADMIN_DETAIL_LIMIT + 3
    assert len(page['rows']) == 3
    assert c.get('/admin/users/' + uid + '?runs=2').status_code == 200


# -- Konto loeschen -----------------------------------------------------------


def test_deleting_an_account_takes_its_history_and_saves_with_it(admin):
    mod, c = admin
    player = _player(mod, 'weg@example.test', 'weg-passwort-1')
    uid = mod.USERS.find_for_login('weg@example.test')['id']
    player.post('/api/runs', json={'reactor': 'pwr', 'scenario': None,
                                   'duration_s': 900.0, 'outcome': 'aborted'})
    assert player.put('/api/saves/auto-pwr', json={'reactor': 'pwr'}).status_code == 200
    account_dir = os.path.join(mod.STORE.players,
                               mod.STORE.account_key('weg@example.test'))
    assert os.path.isdir(account_dir)

    r = c.post('/admin/users/' + uid + '/delete',
               data={'csrf': _admin_csrf(c), 'confirm_email': 'Weg@Example.TEST'})
    assert r.status_code == 200
    assert mod.USERS.find_for_login('weg@example.test') is None
    assert mod.USERS.recent_play_sessions()['rows'] == []
    assert mod.USERS.recent_login_events()['rows'] == []
    assert not os.path.exists(account_dir)
    # Die laufende Sitzung ist damit ebenfalls tot.
    assert player.get('/api/meta').status_code in (302, 401)


def test_deleting_needs_the_typed_address_and_a_fresh_form(admin):
    mod, c = admin
    _player(mod, 'bleibt@example.test', 'bleibt-passwort-1')
    uid = mod.USERS.find_for_login('bleibt@example.test')['id']

    wrong = c.post('/admin/users/' + uid + '/delete',
                   data={'csrf': _admin_csrf(c),
                         'confirm_email': 'tippfehler@example.test'})
    assert wrong.status_code == 400
    assert mod.USERS.find_for_login('bleibt@example.test') is not None

    blank = c.post('/admin/users/' + uid + '/delete', data={'csrf': _admin_csrf(c)})
    assert blank.status_code == 400

    stale = c.post('/admin/users/' + uid + '/delete',
                   data={'csrf': 'abgelaufen', 'confirm_email': 'bleibt@example.test'})
    assert stale.status_code == 400
    assert mod.USERS.find_for_login('bleibt@example.test') is not None


def test_a_player_cannot_delete_accounts(admin):
    mod, _c = admin
    player = _player(mod, 'nixadmin@example.test', 'nixadmin-passwort-1')
    uid = mod.USERS.find_for_login('nixadmin@example.test')['id']
    assert player.post('/admin/users/' + uid + '/delete',
                       data={'confirm_email': 'nixadmin@example.test'}).status_code == 403
    assert mod.USERS.find_for_login('nixadmin@example.test') is not None


# -- Passwort selbst aendern --------------------------------------------------


def test_a_player_changes_their_own_password_and_stays_signed_in(admin):
    """Der Backlog-Punkt: bis 0.6.0 ging das nur ueber den Admin oder ueber
    einen Link ins eigene Postfach."""
    mod, _c = admin
    player = _player(mod, 'selbst@example.test', 'selbst-passwort-1')
    r = player.post('/api/account/password',
                    json={'current': 'selbst-passwort-1', 'new': 'neues-passwort-2'})
    assert r.status_code == 200, r.get_json()

    # Dieselbe Sitzung laeuft weiter -- das frische Token kam als Cookie mit.
    assert player.get('/api/meta').status_code == 200
    # Das neue Passwort gilt, das alte nicht mehr.
    assert mod.AUTH.check('selbst@example.test', 'neues-passwort-2')
    assert not mod.AUTH.check('selbst@example.test', 'selbst-passwort-1')


def test_changing_the_password_signs_out_every_other_device(admin):
    mod, _c = admin
    first = _player(mod, 'zwei-geraete@example.test', 'geraet-passwort-1')
    # Zweites Geraet: meldet sich an und entwertet dabei die erste Sitzung
    # (eine aktive Sitzung je Konto, siehe auth.py). Der Wechsel dort darf
    # die eigene, neuere Sitzung nicht mit umbringen.
    second = mod.app.test_client()
    second.post('/login', data={'user': 'zwei-geraete@example.test',
                                'password': 'geraet-passwort-1',
                                'csrf': _csrf(second), 'next': '/'})
    assert second.post('/api/account/password',
                       json={'current': 'geraet-passwort-1',
                             'new': 'geraet-passwort-2'}).status_code == 200
    assert second.get('/api/meta').status_code == 200
    assert first.get('/api/meta').status_code in (302, 401)


@pytest.mark.parametrize('body, error', [
    ({'current': 'falsch-falsch-1', 'new': 'neues-passwort-2'}, 'wrong_password'),
    ({'current': 'selbst-passwort-1', 'new': 'kurz'}, 'password_too_short'),
    ({'current': 'selbst-passwort-1', 'new': 'selbst-passwort-1'}, 'password_unchanged'),
    ({'current': 'selbst-passwort-1'}, 'bad_body'),
])
def test_a_password_change_that_should_not_happen(admin, body, error):
    mod, _c = admin
    player = _player(mod, 'selbst@example.test', 'selbst-passwort-1')
    r = player.post('/api/account/password', json=body)
    assert r.status_code == 400
    assert r.get_json()['error'] == error
    # In jedem Fall gilt weiterhin das alte Passwort.
    assert mod.AUTH.check('selbst@example.test', 'selbst-passwort-1')


def test_guessing_the_old_password_runs_into_the_rate_limit(admin):
    mod, _c = admin
    player = _player(mod, 'raten@example.test', 'raten-passwort-1')
    codes = [player.post('/api/account/password',
                         json={'current': 'daneben-' + str(i),
                               'new': 'egal-egal-egal-1'}).status_code
             for i in range(mod._PASSWORD_TRIES + 2)]
    assert 429 in codes
    assert mod.AUTH.check('raten@example.test', 'raten-passwort-1')


def test_the_admin_has_no_self_service_account(admin):
    """Sein Passwort steht in der Dockge-Konfiguration, nicht in users.db --
    hier kaeme er ohnehin nicht an (_require_login leitet ihn nach /admin)."""
    _mod, c = admin
    assert c.post('/api/account/password',
                  json={'current': ADMIN_PASSWORD, 'new': 'was-anderes-1'}
                  ).status_code in (302, 403)


def test_a_score_attaches_to_the_reported_run_instead_of_doubling_it(admin):
    """Der Lauf wird beim Beenden gemeldet, der Punktestand erst danach beim
    Eintragen. Ohne attach_score() stuende derselbe Lauf zweimal in der
    Historie und die Spielzeit waere doppelt gezaehlt."""
    mod, _c = admin
    player = _player(mod)
    assert player.post('/api/runs', json={
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'duration_s': 14400.0,
        'outcome': 'completed'}).status_code == 200

    summary = {
        'reactor': 'pwr', 'scenario': 'pwr_load_follow', 'difficulty': 1,
        'energy_mwh_delivered': 5400.0, 'energy_mwh_demanded': 5600.0,
        'deviation_mwh': 12.5, 'alarm_seconds_unacked': 60,
        'violation_seconds': {'1': 30, '2': 0, '3': 0}, 'scram_count': 0,
        'fuel_damage': False, 'duration_s': 14400.0, 'completed': True,
    }
    r = player.post('/api/highscores', json={'name': 'Play', 'summary': summary})
    assert r.status_code == 200, r.get_json()

    sessions = mod.USERS.recent_play_sessions()['rows']
    assert len(sessions) == 1, 'der Lauf steht doppelt in der Historie'
    assert sessions[0]['score'] == r.get_json()['score']
    assert mod.USERS.user_stats(sessions[0]['user_id'])['total_playtime_s'] == 14400.0


def test_the_account_page_shows_that_players_own_history(admin):
    mod, c = admin
    player = _player(mod, 'detail@example.test', 'detail-passwort-1')
    other = _player(mod, 'andere@example.test', 'andere-passwort-1')
    player.post('/api/runs', json={'reactor': 'rbmk', 'scenario': 'rbmk_night_shift',
                                   'duration_s': 1800.0, 'outcome': 'failed'})
    other.post('/api/runs', json={'reactor': 'bwr', 'scenario': 'bwr_msiv',
                                  'duration_s': 600.0, 'outcome': 'completed'})

    uid = mod.USERS.find_for_login('detail@example.test')['id']
    page = c.get(f'/admin/users/{uid}')
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    assert 'detail@example.test' in html
    assert 'rbmk_night_shift' in html
    # Die Kontoseite zeigt NUR diesen einen Spieler.
    assert 'bwr_msiv' not in html
    assert 'andere@example.test' not in html


def test_the_account_page_refuses_unknown_ids_and_players(admin):
    mod, c = admin
    assert c.get('/admin/users/gibt-es-nicht').status_code == 404
    player = _player(mod, 'nosnoop@example.test', 'nosnoop-passwort-1')
    uid = mod.USERS.find_for_login('nosnoop@example.test')['id']
    assert player.get(f'/admin/users/{uid}').status_code == 403


def test_a_player_run_needs_an_account(admin):
    """Der Admin spielt nicht -- er landet auf /admin, nicht auf /api/runs."""
    mod, c = admin
    r = c.post('/api/runs', json={'reactor': 'pwr', 'scenario': None,
                                  'duration_s': 900, 'outcome': 'aborted'})
    assert r.status_code in (302, 403)
    assert mod.USERS.recent_play_sessions()['rows'] == []


def test_player_cannot_reach_admin_routes(admin):
    mod, _c = admin
    mod.USERS.create_user('noadmin@example.test', 'noadmin-passwort-1')
    player = mod.app.test_client()
    player.post('/login', data={'user': 'noadmin@example.test', 'password': 'noadmin-passwort-1',
                                'csrf': _csrf(player), 'next': '/'})
    assert player.get('/admin').status_code == 403
    assert player.post('/admin/users', data={'email': 'x@y.test'}).status_code == 403


def test_reset_password_survives_an_account_that_vanishes_in_between(admin, monkeypatch):
    """Zwei Admin-Reiter: im einen laeuft der Passwort-Reset, im anderen wird
    dasselbe Konto geloescht.

    Zwischen `reset_password()` und dem `get_by_id()` fuer die Anzeige passt
    genau dieses Rennen. Vorher stand danach `row['email']` ohne Pruefung da
    und die Antwort war ein Absturz statt einer Meldung -- der Admin saehe
    eine leere Fehlerseite und wuesste nicht, ob das Passwort nun gesetzt ist.
    """
    mod, c = admin
    user, err = mod.USERS.create_user('rennen@example.test', 'altes-passwort-1')
    assert err is None
    monkeypatch.setattr(mod.USERS, 'get_by_id', lambda _uid: None)
    r = c.post(f"/admin/users/{user['id']}/reset-password", data={'csrf': _admin_csrf(c)})
    assert r.status_code == 404
