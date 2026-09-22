#!/usr/bin/env python3
"""Anmeldung.

Zwei Arten von Konten, streng getrennt:

* **Das Admin-Konto** kommt wie bisher aus REACTORSIM_USER/REACTORSIM_PASSWORD
  (aus der Dockge-Konfiguration) -- genau eines, fest verdrahtet. Der Admin
  spielt nicht: er legt Spielerkonten im Admin-Panel an, sperrt sie bei
  Bedarf und setzt Passwoerter zurueck (siehe app.py, /admin-Routen).
* **Spielerkonten** liegen in users.UserStore (SQLite, /data/users.db), vom
  Admin angelegt statt aus der Umgebung. Jedes hat eigene Spielstaende (siehe
  persist.Store.account_key).

Grundsaetze:

* **Ohne Passwort steht die Seite nicht offen.** Ist fuer das Admin-Konto
  keines gesetzt, erzeugt ReactorSim beim ersten Start eines, schreibt es
  EINMAL ins Protokoll und legt nur den Hash auf der Platte ab. Ein Dienst,
  der im Internet steht und auf ein gesetztes Passwort hofft, ist ein Dienst
  ohne Passwort.
* Der Hash entsteht ueber werkzeug.security (scrypt). Das Klartextpasswort aus
  der Umgebung wird beim Start gehasht und danach nicht mehr angefasst.
* Die Sitzung haengt an einem signierten Token (itsdangerous) UND -- fuer
  Spielerkonten -- an einer je Konto gemerkten Sitzungskennung. Es gibt zwei
  Arten davon:
  - SPIELEND: genau eine je Konto. Meldet sich ein Spielerkonto anderswo neu
    zum Spielen an, wird die vorherige Kennung ungueltig und die alte Sitzung
    stirbt beim naechsten Zugriff. Das muss so bleiben: der Server haelt
    einen Spielstandsatz je Konto (persist.Store.account_key), zwei spielende
    Geraete wuerden sich gegenseitig ueberschreiben.
  - MITLESEND: bis MAX_MONITOR_SESSIONS gleichzeitig, und sie entwerten
    nichts. Das ist der Zugang des Zweitbildschirms (/monitor); er darf nur
    das Bild lesen und sonst nichts (_MONITOR_ENDPOINTS in app.py). Bis
    0.6.23 gab es diese Art nicht, und damit war /monitor auf einem zweiten
    Geraet unbenutzbar: die Anmeldung dort warf den Leitstand hinaus.
  Das Admin-Konto ist von beidem ausgenommen: es spielt nicht, Speicherstand-
  Konflikte durch mehrere Sitzungen koennen also nicht entstehen, und mehrere
  Tabs/Geraete fuer die Verwaltung sollen nicht gegenseitig ausloggen.
* Der Signierschluessel liegt in /data und wird beim ersten Start erzeugt.
  Faellt er weg, sind alle Sitzungen ungueltig -- mehr passiert nicht.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import string
import threading
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import atomic_io

if TYPE_CHECKING:
    import users

log = logging.getLogger(__name__)

SESSION_COOKIE = 'rs_session'
SESSION_MAX_AGE = 30 * 24 * 3600      # 30 Tage

# Wie viele MITLESENDE Geraete gleichzeitig an einem Spielerkonto haengen
# duerfen.
#
# Bis 0.6.23 gab es je Spielerkonto genau eine Sitzung, und jede Anmeldung
# entwertete die vorherige. Damit war der Zweitschirm (/monitor, seit
# 0.6.14) unbenutzbar: er braucht dieselbe Sitzung wie der Leitstand, also
# meldet man sich am Tablet an -- und genau dadurch fliegt der Leitstand
# raus. Meldet man sich dort wieder an, fliegt das Tablet raus.
#
# Die SPIELENDE Sitzung bleibt trotzdem einmalig. Sie muss es sein: der
# Server haelt einen Spielstandsatz je Konto (persist.Store.account_key),
# zwei spielende Geraete wuerden sich gegenseitig ueberschreiben. Deshalb
# zwei ARTEN von Sitzung statt einfach mehr davon -- eine mitlesende darf
# nur den Zweitschirm und sonst nichts (siehe _require_login() in app.py).
#
# Fuenf mitlesende, weil mehr Schirme niemand gleichzeitig aufstellt. Ist
# die Zahl voll, faellt die AELTESTE heraus, nicht die neueste: wer sich
# gerade anmeldet, will auch hereinkommen.
MAX_MONITOR_SESSIONS = 5

ROLE_PLAY = 'play'
ROLE_MONITOR = 'monitor'
CSRF_MAX_AGE = 3600                    # eine Stunde fuer das Anmeldeformular

# Kein Zeichen, das sich in einer Protokollzeile oder beim Abtippen
# missverstehen laesst -- das Passwort wird genau einmal angezeigt.
_ALPHABET = string.ascii_letters.replace('l', '').replace('I', '').replace('O', '') \
    + string.digits.replace('0', '').replace('1', '')


class Auth:
    def __init__(self, data_dir: str, user: str, password: str | None,
                 players: users.UserStore | None = None):
        self._dir = Path(data_dir)
        self.user = (user or 'admin').strip() or 'admin'
        self._auth_path = self._dir / 'auth.json'
        self._key_path = self._dir / 'secret.key'
        self._sessions_path = self._dir / 'sessions.json'
        self._session_lock = threading.Lock()
        self._players = players

        self._admin_hash = self._resolve_password(password)
        # Fester Vergleichs-Hash fuer unbekannte oder gesperrte Benutzernamen
        # -- ohne ihn braeuchte check() fuer einen falschen Namen kein scrypt
        # zu rechnen, und die Antwortzeit verriete, welcher Name ueberhaupt
        # existiert (oder gerade gesperrt ist).
        self._dummy_hash = generate_password_hash(secrets.token_hex(16))

        self._serializer = URLSafeTimedSerializer(self._secret(), salt='rs-session')
        self._csrf = URLSafeTimedSerializer(self._secret(), salt='rs-csrf')
        self._sessions = self._read_sessions()

    # ── Einrichtung ───────────────────────────────────────────────────────────

    def _resolve_password(self, password: str | None) -> str:
        """Passwort aus der Umgebung, sonst der gespeicherte Hash, sonst neu."""
        if password:
            # Gesetztes Passwort gewinnt immer. Wer es in der Dockge-Konfiguration
            # aendert, hat es beim naechsten Start geaendert -- ohne Umweg ueber
            # eine Datei, die noch das alte traegt.
            return generate_password_hash(password)

        stored = self._read_stored_hash()
        if stored:
            return stored

        generated = ''.join(secrets.choice(_ALPHABET) for _ in range(16))
        digest = generate_password_hash(generated)
        self._write_stored_hash(digest)
        log.warning('')
        log.warning('  Kein REACTORSIM_PASSWORD gesetzt -- ein Passwort wurde erzeugt:')
        log.warning('')
        log.warning('      Benutzer:  %s', self.user)
        log.warning('      Passwort:  %s', generated)
        log.warning('')
        log.warning('  Es steht NUR hier. Auf der Platte liegt nur der Hash.')
        log.warning('  Dauerhaft besser: REACTORSIM_PASSWORD in der Konfiguration setzen.')
        log.warning('')
        return digest

    def _read_stored_hash(self) -> str | None:
        try:
            with open(self._auth_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            digest = data.get('password_hash')
            return digest if isinstance(digest, str) and digest else None
        except (OSError, ValueError):
            return None

    def _write_stored_hash(self, digest: str) -> None:
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            atomic_io.write_json(str(self._auth_path), {'password_hash': digest}, mode=0o600)
        except OSError as exc:
            # Nicht schreiben zu koennen ist kein Grund, die Seite offen zu
            # lassen -- das Passwort gilt dann nur bis zum naechsten Neustart.
            log.error('auth.json nicht schreibbar (%s) -- das erzeugte Passwort gilt '
                      'nur bis zum Neustart', exc.__class__.__name__)

    def _secret(self) -> bytes:
        try:
            return self._key_path.read_bytes()
        except OSError:
            pass
        key = secrets.token_bytes(32)
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            atomic_io.write_bytes(str(self._key_path), key, mode=0o600)
        except OSError:
            log.error('secret.key nicht schreibbar -- Sitzungen enden mit dem Neustart')
        return key

    # ── Anmeldung ─────────────────────────────────────────────────────────────

    def is_admin(self, user: str | None) -> bool:
        return bool(user) and user == self.user

    def check(self, user: str, password: str) -> bool:
        """Benutzer und Passwort pruefen -- Admin-Konto ODER Spielerkonto.

        Das Passwort wird IMMER genau einmal gegen EINEN Hash geprueft, auch
        bei unbekanntem oder gesperrtem Benutzernamen (dann gegen den
        Vergleichs-Hash aus __init__) -- sonst verraet die Antwortzeit,
        welcher Name existiert oder gesperrt ist.
        """
        uname = (user or '').strip()
        if uname and self.is_admin(uname):
            return check_password_hash(self._admin_hash, password or '')
        row = self._players.find_for_login(uname) if self._players else None
        real_hash = row['password_hash'] if row else self._dummy_hash
        ok_pass = check_password_hash(real_hash, password or '')
        return bool(row) and row['status'] == 'active' and ok_pass

    def issue(self, user: str, monitor: bool = False) -> str:
        """Neues Sitzungstoken fuer `user`.

        Eine SPIELENDE Anmeldung entwertet die vorherige spielende -- genau
        eine je Konto, gleich von welchem Geraet zuletzt angemeldet wurde.
        Eine MITLESENDE reiht sich daneben ein und entwertet gar nichts: sie
        ist der Zugang des Zweitschirms und darf den Leitstand nicht
        hinauswerfen, das war der ganze Anlass (siehe
        MAX_MONITOR_SESSIONS).

        Das Admin-Konto bekommt keine Sitzungskennung: es spielt nicht,
        mehrere gleichzeitige Admin-Sitzungen (Tabs, Geraete) sind
        erlaubt."""
        if self.is_admin(user):
            return self._serializer.dumps({'u': user})
        sid = secrets.token_hex(16)
        with self._session_lock:
            entry = self._entry(user)
            if monitor:
                # Vorne abschneiden: der aelteste Schirm geht, der neue bleibt.
                entry['mon'] = (entry['mon'] + [sid])[-MAX_MONITOR_SESSIONS:]
            else:
                entry['play'] = sid
            self._sessions[user] = entry
            self._write_sessions()
        return self._serializer.dumps(
            {'u': user, 's': sid, **({'m': 1} if monitor else {})})

    def valid(self, token: str | None) -> str | None:
        """@return den Benutzernamen der gueltigen Sitzung, sonst None."""
        return self.resolve(token)[0]

    def resolve(self, token: str | None) -> tuple:
        """@return (Benutzername, Rolle) der gueltigen Sitzung, sonst
        (None, None).

        Die Rolle steht im Token UND wird an sessions.json geprueft: ein
        Mitleser, der sein 'm' herausschneidet, findet seine Kennung dann
        unter 'play' nicht wieder und ist schlicht abgemeldet. Die Signatur
        schuetzt das Token ohnehin -- das hier ist der zweite Riegel, damit
        die Rolle nicht allein am Inhalt des Cookies haengt."""
        if not token:
            return (None, None)
        try:
            data = self._serializer.loads(token, max_age=SESSION_MAX_AGE)
        except (BadSignature, SignatureExpired):
            return (None, None)
        if not isinstance(data, dict):
            return (None, None)
        user = data.get('u')
        if not user:
            return (None, None)
        if self.is_admin(user):
            return (user, ROLE_PLAY)
        sid = data.get('s')
        if not sid:
            return (None, None)
        with self._session_lock:
            entry = self._entry(user)
        if data.get('m'):
            return (user, ROLE_MONITOR) if sid in entry['mon'] else (None, None)
        return (user, ROLE_PLAY) if sid and sid == entry['play'] else (None, None)

    def _entry(self, user: str) -> dict:
        """Die Sitzungen eines Kontos als {'play': sid|None, 'mon': [sid]}.

        sessions.json von vor 0.6.24 haelt hier EINE Kennung als
        Zeichenkette. Sie gilt als die spielende -- sonst waere nach dem
        Update jeder angemeldete Spieler abgemeldet, und zwar ausgerechnet
        durch die Aenderung, die das ungewollte Abmelden abstellen soll.
        Der Aufrufer haelt dabei das Schloss."""
        value = self._sessions.get(user)
        if isinstance(value, str):
            return {'play': value, 'mon': []}
        if isinstance(value, dict):
            play = value.get('play')
            mon = value.get('mon')
            return {
                'play': play if isinstance(play, str) else None,
                'mon': [v for v in mon if isinstance(v, str)] if isinstance(mon, list) else [],
            }
        return {'play': None, 'mon': []}

    def revoke_session(self, token: str | None) -> None:
        """NUR die Sitzung dieses Tokens beenden.

        Fuers Abmelden. Bis 0.6.23 war das dasselbe wie revoke(), weil es je
        Konto nur eine Sitzung gab. Jetzt nicht mehr: wer sich am
        Zweitschirm abmeldet, darf nicht den Leitstand mitreissen -- das
        waere genau das Verhalten, das diese Aenderung abstellt."""
        user, role = self.resolve(token)
        if not user or self.is_admin(user):
            return
        try:
            sid = self._serializer.loads(token, max_age=SESSION_MAX_AGE).get('s')
        except (BadSignature, SignatureExpired):
            return
        with self._session_lock:
            entry = self._entry(user)
            if role == ROLE_MONITOR:
                entry['mon'] = [v for v in entry['mon'] if v != sid]
            elif entry['play'] == sid:
                entry['play'] = None
            if entry['play'] is None and not entry['mon']:
                self._sessions.pop(user, None)
            else:
                self._sessions[user] = entry
            self._write_sessions()

    def revoke(self, user: str | None) -> None:
        """ALLE Sitzungen des Kontos loeschen -- ein Cookie, das nach dem
        Abmelden trotzdem noch irgendwo im Browser laege, wirkt damit sofort
        nicht mehr, nicht erst nach Ablauf. Absichtlich alle und nicht nur
        die eigene: gerufen wird das beim Abmelden, beim Sperren, beim
        Passwortwechsel und beim Loeschen eines Kontos, und in jedem dieser
        Faelle ist "alle Geraete" gemeint. Fuer das Admin-Konto gibt es keine
        gespeicherte Sitzungskennung (siehe issue()) -- Abmelden loescht dort
        nur das Cookie im eigenen Browser, andere Admin-Sitzungen bleiben
        wie gewollt bestehen."""
        if not user or self.is_admin(user):
            return
        with self._session_lock:
            if self._sessions.pop(user, None) is not None:
                self._write_sessions()

    def _read_sessions(self) -> dict:
        try:
            with open(self._sessions_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write_sessions(self) -> None:
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            atomic_io.write_json(str(self._sessions_path), self._sessions)
        except OSError as exc:
            log.error('sessions.json nicht schreibbar (%s) -- Abmelden und '
                      'Geraetegrenze wirken bis zum naechsten Neustart nicht',
                      exc.__class__.__name__)

    # ── CSRF fuer Anmelde- und Admin-Formulare ────────────────────────────────
    #
    # `scope` trennt die Formulare: ein abgelaufenes Anmeldeformular darf kein
    # gueltiges Token fuer eine Admin-Aktion sein und umgekehrt.

    def csrf_token(self, scope: str = 'login') -> str:
        return self._csrf.dumps(scope)

    def csrf_ok(self, token: str | None, scope: str = 'login') -> bool:
        if not token:
            return False
        try:
            return self._csrf.loads(token, max_age=CSRF_MAX_AGE) == scope
        except (BadSignature, SignatureExpired):
            return False


def safe_next(raw: str | None) -> str:
    """Nur anwendungseigene Pfade duerfen Sprungziel nach der Anmeldung sein.

    Ohne diese Pruefung waere ?next=https://fremde.seite eine offene
    Weiterleitung: die Anmeldeseite der eigenen Anlage wuerde Besucher auf eine
    fremde schicken. Das Ergebnis wird aus den geparsten Bestandteilen per
    `urlunsplit` neu zusammengesetzt statt den Rohwert durchzureichen -- erst
    das unterbricht die Taint-Kette (CodeQL erkennt sonst auch nach den
    Pruefungen noch eine offene Weiterleitung).
    """
    value = (raw or '/').replace('\\', '/')
    if any(ord(c) < 32 for c in value):
        return '/'
    parts = urlsplit(value)
    if parts.scheme or parts.netloc or not parts.path.startswith('/') or parts.path.startswith('//'):
        return '/'
    return urlunsplit(('', '', parts.path, parts.query, parts.fragment))
