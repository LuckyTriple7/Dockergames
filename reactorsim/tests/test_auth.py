#!/usr/bin/env python3
"""Anmeldung: ohne Sitzung kommt niemand rein.

Der wichtigste Test hier ist der erste. Ein Dienst, der im Internet steht, darf
keinen Pfad haben, der ohne Anmeldung Inhalte liefert -- ausser dem
Healthcheck, den der Container selbst abfragt.

Seit dem Umbau auf Admin-Panel + Spielerkonten (siehe users.py) gibt es zwei
Rollen: das Admin-Konto kommt weiter aus REACTORSIM_USER/REACTORSIM_PASSWORD
und spielt nicht, Spielerkonten legt der Admin im Panel an. Tests, die
pruefen, dass eine Anmeldung ueberhaupt Zugriff verschafft, tun das deshalb
konsequent an der jeweils passenden Rolle: /admin fuer den Admin, ein
Spielendpunkt wie /api/meta fuer einen Spieler.
"""

import os
import re
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)

USER = 'operator'
PASSWORD = 'sehr-geheim-123'

PLAYER_EMAIL = 'spieler@example.test'
PLAYER_PASSWORD = 'spieler-passwort-123'


def _fresh(tmp_path, monkeypatch, user=USER, password=PASSWORD):
    monkeypatch.setenv('REACTORSIM_BASE', _ROOT)
    monkeypatch.setenv('REACTORSIM_DATA', str(tmp_path))
    monkeypatch.setenv('REACTORSIM_USER', user)
    if password is None:
        monkeypatch.delenv('REACTORSIM_PASSWORD', raising=False)
    else:
        monkeypatch.setenv('REACTORSIM_PASSWORD', password)
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io', 'users'):
        sys.modules.pop(mod, None)
    import app as appmod
    appmod.app.config['TESTING'] = True
    return appmod


def _add_player(mod, email=PLAYER_EMAIL, password=PLAYER_PASSWORD):
    user, err = mod.USERS.create_user(email, password, created_by=USER)
    assert err is None, err
    return user


@pytest.fixture()
def client(tmp_path, monkeypatch):
    return _fresh(tmp_path, monkeypatch).app.test_client()


def _csrf(client, path='/login'):
    html = client.get(path).get_data(as_text=True)
    m = re.search(r'name="csrf" value="([^"]+)"', html)
    assert m, 'kein CSRF-Token im Formular'
    return m.group(1)


def _login(client, user=USER, password=PASSWORD, **extra):
    data = {'user': user, 'password': password, 'csrf': _csrf(client), 'next': '/'}
    data.update(extra)
    return client.post('/login', data=data)


@pytest.mark.parametrize('path', [
    '/', '/api/meta', '/api/saves', '/api/highscores',
    '/s/0.0.1/js/main.js', '/s/0.0.1/css/base.css',
    '/static/js/main.js', '/admin',
])
def test_nothing_is_reachable_without_login(client, path):
    r = client.get(path)
    assert r.status_code in (302, 401), f'{path} antwortet {r.status_code}'
    if r.status_code == 302:
        assert '/login' in r.headers['Location']


def test_health_stays_open(client):
    # Der Healthcheck laeuft im Container ohne Cookie -- waere er geschuetzt,
    # meldete Docker den Container dauerhaft als krank.
    r = client.get('/health')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'ok'


def test_login_page_is_self_contained(client):
    html = client.get('/login').get_data(as_text=True)
    # Sie darf nichts nachladen, was selbst hinter der Anmeldung liegt.
    assert '<link' not in html
    assert '<script' not in html
    assert 'noindex' in html


def test_admin_login_reaches_only_the_admin_panel(client):
    """Der Admin spielt nicht: er landet nach der Anmeldung im Panel, ganz
    gleich was `next` sagt, und Spielrouten bleiben ihm verschlossen."""
    r = _login(client)
    assert r.status_code == 302
    assert r.headers['Location'].endswith('/admin')
    assert client.get('/admin').status_code == 200
    assert client.get('/').status_code == 302
    assert client.get('/').headers['Location'].endswith('/admin')
    assert client.get('/api/meta').status_code == 403


def test_player_login_reaches_only_the_game(tmp_path, monkeypatch):
    """Ein Spielerkonto darf spielen, aber nicht ins Admin-Panel."""
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    c = mod.app.test_client()
    r = _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert r.status_code == 302
    assert r.headers['Location'].endswith('/')
    assert c.get('/api/meta').status_code == 200
    assert c.get('/admin').status_code == 403


@pytest.mark.parametrize('user,password', [
    (USER, 'falsch'),
    ('admin', PASSWORD),
    ('', ''),
    (USER, PASSWORD + ' '),
])
def test_wrong_credentials_rejected(client, user, password):
    r = _login(client, user=user, password=password)
    assert r.status_code == 401
    assert client.get('/api/meta').status_code == 401


def test_csrf_required(client):
    r = client.post('/login', data={'user': USER, 'password': PASSWORD, 'next': '/'})
    assert r.status_code == 401
    assert client.get('/api/meta').status_code == 401


def test_open_redirect_blocked(tmp_path, monkeypatch):
    """`next` gilt nur fuer Spielerkonten -- der Admin wird ohnehin immer auf
    /admin geschickt (siehe test_admin_login_reaches_only_the_admin_panel)."""
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    c = mod.app.test_client()
    for target in ('https://evil.example', '//evil.example', '\\\\evil.example',
                   'javascript:alert(1)'):
        r = _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD, next=target)
        assert r.status_code == 302
        assert 'evil' not in r.headers['Location']
        assert 'javascript' not in r.headers['Location']


def test_logout_ends_the_session(tmp_path, monkeypatch):
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    c = mod.app.test_client()
    _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert c.get('/api/meta').status_code == 200
    c.get('/logout')
    assert c.get('/api/meta').status_code == 401


def test_session_cookie_is_httponly(client):
    r = _login(client)
    cookie = r.headers.get('Set-Cookie', '')
    assert 'HttpOnly' in cookie
    assert 'SameSite=Lax' in cookie


def test_brute_force_is_limited(client):
    for _ in range(10):
        _login(client, password='falsch')
    r = _login(client, password='falsch')
    html = r.get_data(as_text=True)
    assert 'Versuche' in html or 'attempts' in html


def test_forged_session_cookie_rejected(client):
    client.set_cookie('rs_session', 'ich-bin-angemeldet')
    assert client.get('/api/meta').status_code == 401


def test_generated_password_when_none_configured(tmp_path, caplog):
    """Ohne gesetztes Passwort wird eines erzeugt -- und nur als Hash abgelegt.

    Geprueft wird direkt am Modul, nicht ueber die App: app.py ruft beim Import
    logging.basicConfig(force=True) und raeumt dabei jeden Testmitschnitt weg.
    """
    import logging
    sys.modules.pop('auth', None)
    sys.modules.pop('atomic_io', None)
    import auth as authmod

    caplog.set_level(logging.WARNING, logger='auth')
    a = authmod.Auth(str(tmp_path), 'operator', None)
    m = re.search(r'Passwort:\s+(\S+)', caplog.text)
    assert m, f'kein erzeugtes Passwort im Protokoll: {caplog.text!r}'
    generated = m.group(1)
    assert len(generated) == 16
    assert a.check('operator', generated)
    assert not a.check('operator', 'falsch')

    stored = (tmp_path / 'auth.json').read_text(encoding='utf-8')
    assert generated not in stored, 'Klartextpasswort auf der Platte'
    assert 'password_hash' in stored
    # NTFS kennt keine POSIX-Rechtebits: os.stat().st_mode liefert unter
    # Windows immer 666, ganz gleich was chmod() gerufen hat. Der Schutz gilt
    # dort ueber die Dateisystem-ACL des Benutzerprofils. Geprueft wird die
    # Zusicherung deshalb da, wo sie etwas bedeutet -- im Image und in der CI.
    if os.name == 'posix':
        assert oct(os.stat(tmp_path / 'auth.json').st_mode)[-3:] == '600'
        assert oct(os.stat(tmp_path / 'secret.key').st_mode)[-3:] == '600'

    # Neustart ohne gesetztes Passwort: der gespeicherte Hash gilt weiter,
    # es wird kein zweites erzeugt.
    caplog.clear()
    b = authmod.Auth(str(tmp_path), 'operator', None)
    assert b.check('operator', generated)
    assert 'Passwort:' not in caplog.text


def test_app_without_configured_password_still_requires_login(tmp_path, monkeypatch):
    mod = _fresh(tmp_path, monkeypatch, password=None)
    c = mod.app.test_client()
    assert c.get('/api/meta').status_code == 401
    assert c.get('/').status_code == 302


def test_configured_password_wins_over_stored(tmp_path, monkeypatch):
    _fresh(tmp_path, monkeypatch, password=None)          # erzeugt und speichert
    mod = _fresh(tmp_path, monkeypatch, password='neues-passwort')
    c = mod.app.test_client()
    html = c.get('/login').get_data(as_text=True)
    csrf = re.search(r'name="csrf" value="([^"]+)"', html).group(1)
    r = c.post('/login', data={'user': USER, 'password': 'neues-passwort', 'csrf': csrf, 'next': '/'})
    assert r.status_code == 302


def test_locked_player_cannot_login(tmp_path, monkeypatch):
    """Gesperrte Konten scheitern mit derselben Meldung wie ein falsches
    Passwort -- sonst liesse sich von aussen erkennen, welches Konto gerade
    gesperrt ist (Anti-Enumeration, siehe auth.check())."""
    mod = _fresh(tmp_path, monkeypatch)
    user = _add_player(mod)
    mod.USERS.set_status(user['id'], 'locked')
    c = mod.app.test_client()
    r = _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert r.status_code == 401
    html = r.get_data(as_text=True)
    assert 'falsch' in html or 'wrong' in html.lower() or 'incorrect' in html.lower()


def test_locking_a_player_ends_the_session_immediately(tmp_path, monkeypatch):
    """Eine Sperre muss sofort wirken -- nicht erst, wenn das 30 Tage
    gueltige Cookie irgendwann ablaeuft."""
    mod = _fresh(tmp_path, monkeypatch)
    user = _add_player(mod)
    c = mod.app.test_client()
    _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert c.get('/api/meta').status_code == 200
    mod.USERS.set_status(user['id'], 'locked')
    assert c.get('/api/meta').status_code == 401


def test_second_login_on_same_player_account_kicks_the_first(tmp_path, monkeypatch):
    """Genau eine aktive Sitzung je Spielerkonto: meldet sich dasselbe Konto
    auf einem zweiten Geraet an, stirbt die Sitzung des ersten -- das Spiel
    kann dann nicht mehr gleichzeitig auf beiden weiterlaufen."""
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    geraet_a = mod.app.test_client()
    geraet_b = mod.app.test_client()

    _login(geraet_a, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert geraet_a.get('/api/meta').status_code == 200

    _login(geraet_b, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert geraet_b.get('/api/meta').status_code == 200
    assert geraet_a.get('/api/meta').status_code == 401


def test_admin_sessions_are_not_kicked(client):
    """Der Admin spielt nicht -- Speicherstand-Konflikte durch mehrere
    Sitzungen koennen also nicht entstehen. Mehrere Geraete/Tabs im Panel
    sollen sich deshalb nicht gegenseitig ausloggen."""
    geraet_a = client
    geraet_b = client.application.test_client()

    _login(geraet_a)
    assert geraet_a.get('/admin').status_code == 200

    _login(geraet_b)
    assert geraet_b.get('/admin').status_code == 200
    assert geraet_a.get('/admin').status_code == 200


def test_logout_kicks_a_copied_cookie_too(tmp_path, monkeypatch):
    """Abmelden entwertet die Sitzungskennung serverseitig, nicht nur das
    Cookie im eigenen Browser -- eine Kopie des alten Cookies (z.B. aus einem
    Backup) darf danach nicht weiter gelten."""
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    original = mod.app.test_client()
    copy_of_cookie = mod.app.test_client()

    r = _login(original, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    token = r.headers['Set-Cookie'].split('rs_session=')[1].split(';')[0]
    copy_of_cookie.set_cookie('rs_session', token)

    original.get('/logout')
    assert copy_of_cookie.get('/api/meta').status_code == 401


def test_session_survives_restart(tmp_path, monkeypatch):
    mod = _fresh(tmp_path, monkeypatch)
    _add_player(mod)
    c = mod.app.test_client()
    r = _login(c, user=PLAYER_EMAIL, password=PLAYER_PASSWORD)
    token = r.headers['Set-Cookie'].split('rs_session=')[1].split(';')[0]

    # Neustart: derselbe Datenordner, also derselbe Signierschluessel UND
    # dieselbe users.db -- das Spielerkonto muss nicht neu angelegt werden.
    mod2 = _fresh(tmp_path, monkeypatch)
    c2 = mod2.app.test_client()
    c2.set_cookie('rs_session', token)
    assert c2.get('/api/meta').status_code == 200
