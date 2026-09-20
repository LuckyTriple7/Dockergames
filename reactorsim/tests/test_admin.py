#!/usr/bin/env python3
"""Admin-Panel: Spielerkonten anlegen, sperren, Passwoerter zuruecksetzen,
und sehen, wer sich wann von welcher Adresse angemeldet und was er gespielt
hat.

Ausgefuehrt mit: python3 -m pytest reactorsim/tests/test_admin.py
"""

import os
import re
import sys

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
    events = mod.USERS.recent_login_events()
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

    sessions = mod.USERS.recent_play_sessions()
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

    sessions = mod.USERS.recent_play_sessions()
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
    assert mod.USERS.recent_play_sessions()[0]['mode'] == 'tutorial'


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
    assert mod.USERS.recent_play_sessions() == []


def test_an_absurd_duration_is_capped(admin):
    """Die Dauer kommt vom Client. Sie ist Buchhaltung, keine Wertung -- aber
    ohne Deckel macht eine Fantasiezahl die Spalte "Spielzeit gesamt" fuer
    alle anderen unlesbar."""
    mod, _c = admin
    player = _player(mod)
    r = player.post('/api/runs', json={'reactor': 'pwr', 'scenario': None,
                                       'duration_s': 9e12, 'outcome': 'aborted'})
    assert r.status_code == 200
    assert mod.USERS.recent_play_sessions()[0]['duration_s'] == mod._RUN_MAX_DURATION_S


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

    sessions = mod.USERS.recent_play_sessions()
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
    assert mod.USERS.recent_play_sessions() == []


def test_player_cannot_reach_admin_routes(admin):
    mod, _c = admin
    mod.USERS.create_user('noadmin@example.test', 'noadmin-passwort-1')
    player = mod.app.test_client()
    player.post('/login', data={'user': 'noadmin@example.test', 'password': 'noadmin-passwort-1',
                                'csrf': _csrf(player), 'next': '/'})
    assert player.get('/admin').status_code == 403
    assert player.post('/admin/users', data={'email': 'x@y.test'}).status_code == 403
