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
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io', 'users'):
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


def test_play_session_is_recorded_for_scored_runs_only(admin):
    """Nur ausgewertete Laeufe zaehlen (Entscheidung Phase 1) -- das
    Tutorial (tutorial_unranked) und abgelehnte Einsendungen tauchen im
    Admin-Panel nicht als Spielzeit auf."""
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

    html = c.get('/admin').get_data(as_text=True)
    assert 'play@example.test' in html
    assert 'pwr_load_follow' in html


def test_player_cannot_reach_admin_routes(admin):
    mod, _c = admin
    mod.USERS.create_user('noadmin@example.test', 'noadmin-passwort-1')
    player = mod.app.test_client()
    player.post('/login', data={'user': 'noadmin@example.test', 'password': 'noadmin-passwort-1',
                                'csrf': _csrf(player), 'next': '/'})
    assert player.get('/admin').status_code == 403
    assert player.post('/admin/users', data={'email': 'x@y.test'}).status_code == 403
