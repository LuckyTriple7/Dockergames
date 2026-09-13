#!/usr/bin/env python3
"""Anmeldung.

Mehrere Konten moeglich. Das Hauptkonto kommt wie bisher aus
REACTORSIM_USER/REACTORSIM_PASSWORD (aus der Dockge-Konfiguration), weitere
ueber REACTORSIM_USERS="name:passwort,name2:passwort2" -- jedes ein
vollwertiges Konto mit eigenen Spielstaenden (siehe persist.Store.account_key).

Grundsaetze:

* **Ohne Passwort steht die Seite nicht offen.** Ist fuer das Hauptkonto
  keines gesetzt, erzeugt ReactorSim beim ersten Start eines, schreibt es
  EINMAL ins Protokoll und legt nur den Hash auf der Platte ab. Ein Dienst,
  der im Internet steht und auf ein gesetztes Passwort hofft, ist ein Dienst
  ohne Passwort.
* Der Hash entsteht ueber werkzeug.security (scrypt). Das Klartextpasswort aus
  der Umgebung wird beim Start gehasht und danach nicht mehr angefasst.
* Die Sitzung haengt an einem signierten Token (itsdangerous) UND an einer je
  Konto gemerkten Sitzungskennung: meldet sich ein Konto anderswo neu an, wird
  die vorherige Kennung ungueltig, und die alte Sitzung stirbt beim naechsten
  Zugriff -- genau eine aktive Sitzung je Konto, das Spiel kann nie auf zwei
  Geraeten gleichzeitig weiterlaufen.
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
from urllib.parse import urlsplit, urlunsplit

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import atomic_io

log = logging.getLogger(__name__)

SESSION_COOKIE = 'rs_session'
SESSION_MAX_AGE = 30 * 24 * 3600      # 30 Tage
CSRF_MAX_AGE = 3600                    # eine Stunde fuer das Anmeldeformular

# Kein Zeichen, das sich in einer Protokollzeile oder beim Abtippen
# missverstehen laesst -- das Passwort wird genau einmal angezeigt.
_ALPHABET = string.ascii_letters.replace('l', '').replace('I', '').replace('O', '') \
    + string.digits.replace('0', '').replace('1', '')


class Auth:
    def __init__(self, data_dir: str, user: str, password: str | None,
                 extra_users: dict[str, str] | None = None):
        self._dir = Path(data_dir)
        self.user = (user or 'admin').strip() or 'admin'
        self._auth_path = self._dir / 'auth.json'
        self._key_path = self._dir / 'secret.key'
        self._sessions_path = self._dir / 'sessions.json'
        self._session_lock = threading.Lock()

        self._hashes = {self.user: self._resolve_password(password)}
        for uname, pw in (extra_users or {}).items():
            uname = (uname or '').strip()
            if not uname or uname in self._hashes:
                # Leerer oder doppelter Name (auch ein Zusammenstoss mit dem
                # Hauptkonto) -- ueberspringen statt das Hauptkonto zu
                # verlieren. War schon vorher REACTORSIM_USER, gewinnt es.
                log.warning("REACTORSIM_USERS: Konto %r uebersprungen (leer oder doppelt)", uname)
                continue
            self._hashes[uname] = generate_password_hash(pw)
        # Fester Vergleichs-Hash fuer unbekannte Benutzernamen -- ohne ihn
        # braeuchte check() fuer einen falschen Namen kein scrypt zu rechnen,
        # und die Antwortzeit verriete, welcher Name ueberhaupt existiert.
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

    def check(self, user: str, password: str) -> bool:
        """Benutzer und Passwort pruefen.

        Das Passwort wird IMMER geprueft, auch bei unbekanntem Benutzernamen
        (gegen den Vergleichs-Hash aus __init__) -- sonst verraet die
        Antwortzeit, welcher Name existiert.
        """
        uname = (user or '').strip()
        ok_user = uname in self._hashes
        ok_pass = check_password_hash(self._hashes.get(uname, self._dummy_hash), password or '')
        return ok_user and ok_pass

    def issue(self, user: str) -> str:
        """Neues Sitzungstoken fuer `user` -- UND eine neue Sitzungskennung,
        die jede vorher fuer dieses Konto ausgegebene Sitzung entwertet (siehe
        valid()). Genau eine aktive Sitzung je Konto, gleich von welchem
        Geraet zuletzt angemeldet wurde."""
        sid = secrets.token_hex(16)
        with self._session_lock:
            self._sessions[user] = sid
            self._write_sessions()
        return self._serializer.dumps({'u': user, 's': sid})

    def valid(self, token: str | None) -> str | None:
        """@return den Benutzernamen der gueltigen Sitzung, sonst None."""
        if not token:
            return None
        try:
            data = self._serializer.loads(token, max_age=SESSION_MAX_AGE)
        except (BadSignature, SignatureExpired):
            return None
        if not isinstance(data, dict):
            return None
        user, sid = data.get('u'), data.get('s')
        if not user or not sid:
            return None
        with self._session_lock:
            current = self._sessions.get(user)
        return user if sid == current else None

    def revoke(self, user: str | None) -> None:
        """Sitzungskennung des Kontos loeschen -- ein Cookie, das nach dem
        Abmelden trotzdem noch im Browser laege, wirkt damit sofort nicht
        mehr, nicht erst nach Ablauf."""
        if not user:
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
            log.error('sessions.json nicht schreibbar (%s) -- die '
                      'Ein-Geraet-Sperre wirkt bis zum naechsten Neustart nicht',
                      exc.__class__.__name__)

    # ── CSRF fuer das Anmeldeformular ─────────────────────────────────────────

    def csrf_token(self) -> str:
        return self._csrf.dumps('login')

    def csrf_ok(self, token: str | None) -> bool:
        if not token:
            return False
        try:
            return self._csrf.loads(token, max_age=CSRF_MAX_AGE) == 'login'
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
