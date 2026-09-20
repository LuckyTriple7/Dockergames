#!/usr/bin/env python3
"""Mailversand, Willkommens-Mail und der Passwort-vergessen-Ablauf.

Kein echter Mailserver: smtplib wird durch eine Attrappe ersetzt, die jede
Nachricht einsammelt. Geprueft wird damit genau das, was ohne Attrappe
niemand sieht -- ob ueberhaupt verschickt wird, an wen, mit welchem Inhalt,
und was passiert, wenn der Server nein sagt.

Ausgefuehrt mit: python3 -m pytest reactorsim/tests/test_mail.py
"""

import os
import re
import smtplib
import sys
import time

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)

ADMIN_USER = 'admin'
ADMIN_PASSWORD = 'admin-passwort-123'

SMTP_ENV = {
    'REACTORSIM_SMTP_HOST': 'mail.example.test',
    'REACTORSIM_SMTP_PORT': '587',
    'REACTORSIM_SMTP_USER': 'reactorsim@example.test',
    'REACTORSIM_SMTP_PASSWORD': 'postfach-geheim',
    'REACTORSIM_SMTP_FROM': 'reactorsim@example.test',
    'REACTORSIM_SMTP_SECURITY': 'starttls',
    'REACTORSIM_PUBLIC_URL': 'https://reactorsim.example.test',
}


class FakeSMTP:
    """Attrappe fuer smtplib.SMTP -- sammelt, statt zu verschicken."""

    sent = []
    calls = []
    fail_with = None       # Ausnahme, die login()/send_message() werfen soll

    def __init__(self, host, port, timeout=None):
        FakeSMTP.calls.append(('connect', host, port, timeout))
        if isinstance(FakeSMTP.fail_with, OSError) and not isinstance(
                FakeSMTP.fail_with, smtplib.SMTPException):
            raise FakeSMTP.fail_with

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def starttls(self):
        FakeSMTP.calls.append(('starttls',))

    def ehlo(self):
        FakeSMTP.calls.append(('ehlo',))

    def login(self, user, password):
        FakeSMTP.calls.append(('login', user, password))
        if FakeSMTP.fail_with is not None:
            raise FakeSMTP.fail_with

    def send_message(self, msg):
        FakeSMTP.calls.append(('send',))
        FakeSMTP.sent.append(msg)

    @classmethod
    def reset(cls):
        cls.sent, cls.calls, cls.fail_with = [], [], None


def _fresh(tmp_path, monkeypatch, env=None):
    monkeypatch.setenv('REACTORSIM_BASE', _ROOT)
    monkeypatch.setenv('REACTORSIM_DATA', str(tmp_path))
    monkeypatch.setenv('REACTORSIM_USER', ADMIN_USER)
    monkeypatch.setenv('REACTORSIM_PASSWORD', ADMIN_PASSWORD)
    # Eine Umgebung aus einem frueheren Test darf nicht durchschlagen.
    for key in SMTP_ENV:
        monkeypatch.delenv(key, raising=False)
    for key, value in (env or {}).items():
        monkeypatch.setenv(key, value)
    for mod in ('app', 'auth', 'persist', 'scoring', 'atomic_io', 'users', 'mailer'):
        sys.modules.pop(mod, None)
    import app as appmod
    appmod.app.config['TESTING'] = True
    FakeSMTP.reset()
    monkeypatch.setattr(appmod.mailermod.smtplib, 'SMTP', FakeSMTP)
    monkeypatch.setattr(appmod.mailermod.smtplib, 'SMTP_SSL', FakeSMTP)
    return appmod


def _csrf(client, path='/login'):
    html = client.get(path).get_data(as_text=True)
    m = re.search(r'name="csrf" value="([^"]+)"', html)
    assert m, f'kein CSRF-Token in {path}'
    return m.group(1)


def _login_admin(mod):
    c = mod.app.test_client()
    r = c.post('/login', data={'user': ADMIN_USER, 'password': ADMIN_PASSWORD,
                               'csrf': _csrf(c), 'next': '/'})
    assert r.status_code == 302
    return c


def _body(msg):
    return msg.get_content()


def _await_mail(count=1, timeout_s=3.0):
    """send_async() laeuft in einem eigenen Thread (siehe mailer.py) -- der
    Test darf deshalb nicht sofort nachsehen."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if len(FakeSMTP.sent) >= count:
            return True
        time.sleep(0.02)
    return len(FakeSMTP.sent) >= count


@pytest.fixture()
def mailed(tmp_path, monkeypatch):
    """Anlage MIT eingerichtetem Mailserver, Admin angemeldet."""
    mod = _fresh(tmp_path, monkeypatch, SMTP_ENV)
    return mod, _login_admin(mod)


@pytest.fixture()
def unmailed(tmp_path, monkeypatch):
    """Anlage OHNE Mailserver -- der Zustand vor dieser Version."""
    mod = _fresh(tmp_path, monkeypatch)
    return mod, _login_admin(mod)


# ── mailer.Mailer fuer sich ───────────────────────────────────────────────────


def test_default_port_follows_the_chosen_encryption():
    import mailer as mailermod
    for security, port in (('starttls', 587), ('ssl', 465), ('none', 25)):
        m = mailermod.Mailer.from_env({'REACTORSIM_SMTP_HOST': 'h',
                                       'REACTORSIM_SMTP_FROM': 'a@b.test',
                                       'REACTORSIM_SMTP_SECURITY': security})
        assert m.port == port, security


def test_unknown_encryption_falls_back_to_starttls():
    import mailer as mailermod
    m = mailermod.Mailer.from_env({'REACTORSIM_SMTP_HOST': 'h',
                                   'REACTORSIM_SMTP_FROM': 'a@b.test',
                                   'REACTORSIM_SMTP_SECURITY': 'quatsch'})
    assert m.security == 'starttls' and m.port == 587


def test_sender_defaults_to_the_mailbox():
    import mailer as mailermod
    m = mailermod.Mailer.from_env({'REACTORSIM_SMTP_HOST': 'h',
                                   'REACTORSIM_SMTP_USER': 'postfach@example.test'})
    assert m.sender == 'postfach@example.test' and m.configured


def test_without_a_host_nothing_is_configured_and_nothing_is_sent():
    import mailer as mailermod
    m = mailermod.Mailer()
    assert m.configured is False
    assert m.send('wer@example.test', 'Betreff', 'Text') == 'not_configured'


def test_status_never_contains_the_password():
    import mailer as mailermod
    m = mailermod.Mailer.from_env(SMTP_ENV)
    status = m.status()
    assert status['password_set'] is True
    assert SMTP_ENV['REACTORSIM_SMTP_PASSWORD'] not in repr(status)


def test_send_uses_starttls_and_logs_in(mailed):
    _mod, _c = mailed
    import mailer as mailermod
    m = mailermod.Mailer.from_env(SMTP_ENV)
    assert m.send('wer@example.test', 'Betreff', 'Inhalt') is None
    kinds = [c[0] for c in FakeSMTP.calls]
    assert kinds == ['connect', 'starttls', 'ehlo', 'login', 'send']
    msg = FakeSMTP.sent[0]
    assert msg['To'] == 'wer@example.test'
    assert msg['Subject'] == 'Betreff'
    assert 'reactorsim@example.test' in msg['From']
    assert _body(msg).strip() == 'Inhalt'


def test_send_reports_why_it_failed(mailed):
    _mod, _c = mailed
    import mailer as mailermod
    m = mailermod.Mailer.from_env(SMTP_ENV)
    for exc, reason in (
        (smtplib.SMTPAuthenticationError(535, b'nope'), 'auth_failed'),
        (smtplib.SMTPRecipientsRefused({}), 'recipient_refused'),
        (smtplib.SMTPException('kaputt'), 'smtp_error'),
        (ConnectionRefusedError('zu'), 'connect_failed'),
    ):
        FakeSMTP.reset()
        FakeSMTP.fail_with = exc
        assert m.send('wer@example.test', 'B', 'I') == reason, reason
        assert FakeSMTP.sent == []


# ── Willkommens-Mail ──────────────────────────────────────────────────────────


def test_new_account_gets_a_welcome_mail_with_its_credentials(mailed):
    mod, c = mailed
    r = c.post('/admin/users', data={'email': 'neu@example.test', 'password': '',
                                     'welcome': '1', 'csrf': _csrf(c, '/admin')})
    assert r.status_code == 200
    assert len(FakeSMTP.sent) == 1
    msg = FakeSMTP.sent[0]
    assert msg['To'] == 'neu@example.test'
    body = _body(msg)
    assert 'neu@example.test' in body
    assert SMTP_ENV['REACTORSIM_PUBLIC_URL'] in body

    # Das Passwort in der Mail MUSS das sein, mit dem man sich anmelden kann.
    m = re.search(r'(?:Passwort|Password):\s*(\S+)', body)
    assert m, body
    player = mod.app.test_client()
    lr = player.post('/login', data={'user': 'neu@example.test', 'password': m.group(1),
                                     'csrf': _csrf(player), 'next': '/'})
    assert lr.status_code == 302


def test_no_welcome_mail_without_the_checkbox(mailed):
    _mod, c = mailed
    r = c.post('/admin/users', data={'email': 'still@example.test',
                                     'password': 'still-passwort-1',
                                     'csrf': _csrf(c, '/admin')})
    assert r.status_code == 200
    assert FakeSMTP.sent == []


def test_a_failed_welcome_mail_still_leaves_a_usable_account(mailed):
    """Ein unerreichbarer Mailserver darf kein Konto verhindern -- das
    Passwort steht dann wie bisher einmalig im Panel."""
    mod, c = mailed
    FakeSMTP.fail_with = ConnectionRefusedError('zu')
    r = c.post('/admin/users', data={'email': 'trotzdem@example.test', 'password': '',
                                     'welcome': '1', 'csrf': _csrf(c, '/admin')})
    assert r.status_code == 200
    assert mod.USERS.find_for_login('trotzdem@example.test') is not None
    html = r.get_data(as_text=True)
    assert 'trotzdem@example.test' in html
    # Der Grund steht sichtbar im Panel, nicht nur im Protokoll.
    assert 'unreachable' in html or 'erreichbar' in html


def test_password_reset_mails_the_new_password(mailed):
    mod, c = mailed
    user, err = mod.USERS.create_user('reset@example.test', 'altes-passwort-1')
    assert err is None
    FakeSMTP.reset()
    r = c.post(f"/admin/users/{user['id']}/reset-password", data={'csrf': _csrf(c, '/admin')})
    assert r.status_code == 200
    assert len(FakeSMTP.sent) == 1
    body = _body(FakeSMTP.sent[0])
    m = re.search(r'(?:Passwort|Password):\s*(\S+)', body)
    assert m, body
    player = mod.app.test_client()
    lr = player.post('/login', data={'user': 'reset@example.test', 'password': m.group(1),
                                     'csrf': _csrf(player), 'next': '/'})
    assert lr.status_code == 302


def test_test_mail_route_reports_success_and_failure(mailed):
    _mod, c = mailed
    r = c.post('/admin/mail/test', data={'to': 'pruef@example.test',
                                         'csrf': _csrf(c, '/admin')})
    assert r.status_code == 200
    assert FakeSMTP.sent[0]['To'] == 'pruef@example.test'

    FakeSMTP.reset()
    FakeSMTP.fail_with = smtplib.SMTPAuthenticationError(535, b'nope')
    r2 = c.post('/admin/mail/test', data={'to': 'pruef@example.test',
                                          'csrf': _csrf(c, '/admin')})
    assert r2.status_code == 400
    assert 'pruef@example.test' in r2.get_data(as_text=True)


def test_mail_routes_need_the_admin_csrf_token(mailed):
    _mod, c = mailed
    assert c.post('/admin/mail/test', data={'to': 'x@example.test'}).status_code == 400
    assert FakeSMTP.sent == []


# ── Passwort vergessen ────────────────────────────────────────────────────────


def test_forgot_is_closed_without_a_mail_server(unmailed):
    mod, _c = unmailed
    anon = mod.app.test_client()
    assert anon.get('/forgot').status_code == 404
    # Und es steht auch kein Link dorthin auf der Anmeldeseite.
    assert '/forgot' not in anon.get('/login').get_data(as_text=True)


def test_login_page_offers_the_link_when_mail_works(mailed):
    mod, _c = mailed
    assert '/forgot' in mod.app.test_client().get('/login').get_data(as_text=True)


def test_forgot_link_sets_a_new_password_and_kills_the_old_one(mailed):
    mod, _c = mailed
    mod.USERS.create_user('vergesslich@example.test', 'altes-passwort-1')
    FakeSMTP.reset()

    anon = mod.app.test_client()
    r = anon.post('/forgot', data={'email': 'Vergesslich@Example.TEST',
                                   'csrf': _csrf(anon, '/forgot')})
    assert r.status_code == 200
    assert _await_mail(), 'keine Mail verschickt'
    link = re.search(r'(https://\S*/reset\?token=\S+)', _body(FakeSMTP.sent[0]))
    assert link, _body(FakeSMTP.sent[0])
    path = link.group(1).replace(SMTP_ENV['REACTORSIM_PUBLIC_URL'], '')

    form = anon.get(path)
    assert form.status_code == 200
    assert 'vergesslich@example.test' in form.get_data(as_text=True)

    token = re.search(r'name="token" value="([^"]+)"', form.get_data(as_text=True)).group(1)
    done = anon.post('/reset', data={'token': token, 'password': 'ganz-neues-passwort',
                                     'password2': 'ganz-neues-passwort',
                                     'csrf': _csrf(anon, path)})
    assert done.status_code == 200

    player = mod.app.test_client()
    alt = player.post('/login', data={'user': 'vergesslich@example.test',
                                      'password': 'altes-passwort-1',
                                      'csrf': _csrf(player), 'next': '/'})
    assert alt.status_code == 401
    neu = mod.app.test_client()
    ok = neu.post('/login', data={'user': 'vergesslich@example.test',
                                  'password': 'ganz-neues-passwort',
                                  'csrf': _csrf(neu), 'next': '/'})
    assert ok.status_code == 302


def test_a_reset_link_works_exactly_once(mailed):
    mod, _c = mailed
    mod.USERS.create_user('einmal@example.test', 'altes-passwort-1')
    found = mod.USERS.create_reset_token('einmal@example.test')
    assert found
    token = found[0]

    anon = mod.app.test_client()
    path = f'/reset?token={token}'
    first = anon.post('/reset', data={'token': token, 'password': 'erstes-neues-1',
                                      'password2': 'erstes-neues-1',
                                      'csrf': _csrf(anon, path)})
    assert first.status_code == 200
    second = mod.app.test_client()
    again = second.get(path)
    assert again.status_code == 400


def test_mismatched_repeat_and_short_password_are_refused(mailed):
    mod, _c = mailed
    mod.USERS.create_user('tippfehler@example.test', 'altes-passwort-1')
    token = mod.USERS.create_reset_token('tippfehler@example.test')[0]
    anon = mod.app.test_client()
    path = f'/reset?token={token}'

    r = anon.post('/reset', data={'token': token, 'password': 'ein-langes-passwort',
                                  'password2': 'ein-anderes-passwort',
                                  'csrf': _csrf(anon, path)})
    assert r.status_code == 400
    r2 = anon.post('/reset', data={'token': token, 'password': 'kurz', 'password2': 'kurz',
                                   'csrf': _csrf(anon, path)})
    assert r2.status_code == 400
    # Beide Fehlversuche haben das Token NICHT verbraucht.
    assert mod.USERS.peek_reset_token(token) is not None


def test_an_invalid_token_never_shows_a_form(mailed):
    mod, _c = mailed
    anon = mod.app.test_client()
    for token in ('', 'ausgedacht', 'x' * 64):
        r = anon.get(f'/reset?token={token}')
        assert r.status_code == 400
        assert 'name="password"' not in r.get_data(as_text=True)


def test_forgot_answers_the_same_for_unknown_and_locked_accounts(mailed):
    """Die Antwort darf nicht verraten, welche Adressen ein Konto haben."""
    mod, _c = mailed
    user, _ = mod.USERS.create_user('gesperrt@example.test', 'altes-passwort-1')
    mod.USERS.set_status(user['id'], 'locked')

    answers = set()
    for email in ('gibtsnicht@example.test', 'gesperrt@example.test'):
        anon = mod.app.test_client()
        r = anon.post('/forgot', data={'email': email, 'csrf': _csrf(anon, '/forgot')})
        assert r.status_code == 200
        # CSRF-Token und CSP-Nonce sind je Antwort neu und sagen nichts
        # ueber das Konto aus -- alles andere muss Zeichen fuer Zeichen gleich
        # sein.
        text = re.sub(r'(?:value|nonce)="[^"]*"', '', r.get_data(as_text=True))
        answers.add(text)
    assert len(answers) == 1, 'unterschiedliche Antworten verraten den Kontobestand'
    time.sleep(0.2)
    assert FakeSMTP.sent == [], 'fuer ein gesperrtes oder fehlendes Konto keine Mail'


def test_forgot_is_rate_limited_per_address(mailed):
    mod, _c = mailed
    mod.USERS.create_user('viel@example.test', 'altes-passwort-1')
    anon = mod.app.test_client()
    codes = [anon.post('/forgot', data={'email': 'viel@example.test',
                                        'csrf': _csrf(anon, '/forgot')}).status_code
             for _ in range(6)]
    assert 429 in codes, codes
    assert _await_mail(3) and len(FakeSMTP.sent) <= 3, \
        f'{len(FakeSMTP.sent)} Mails trotz Begrenzung'


def test_forgot_needs_its_own_csrf_token(mailed):
    mod, _c = mailed
    mod.USERS.create_user('csrf@example.test', 'altes-passwort-1')
    anon = mod.app.test_client()
    # Ein Token des ANMELDEformulars darf hier nicht gelten (scope-getrennt,
    # siehe auth.Auth.csrf_token).
    r = anon.post('/forgot', data={'email': 'csrf@example.test', 'csrf': _csrf(anon)})
    assert r.status_code == 400
    time.sleep(0.2)
    assert FakeSMTP.sent == []
