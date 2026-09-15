#!/usr/bin/env python3
"""Spielerkonten -- angelegt vom Admin, nicht aus der Umgebung.

Der Admin (REACTORSIM_USER/REACTORSIM_PASSWORD, siehe auth.py) ist kein
Spieler: er legt Konten an, sperrt sie bei Bedarf und setzt Passwoerter
zurueck, spielt aber selbst nicht. Jeder Spieler meldet sich mit seiner
E-Mail-Adresse als Benutzername an (Phase 1 -- kein Mailversand, die Adresse
ist reiner Kontoname).

Abgelegt in einer einzigen SQLite-Datei unter /data/users.db:

* `users`       -- ein Datensatz je Spieler (E-Mail, Passwort-Hash, Sperre).
* `login_events`  -- jede erfolgreiche Anmeldung mit Zeitpunkt und Adresse
  (die Adresse kommt vom aufrufenden Code bereits durch ProxyFix bereinigt).
* `play_sessions` -- jeder ausgewertete Spiellauf (Reaktortyp, Szenario,
  Dauer, Erfolg), damit das Admin-Panel zeigen kann, was gespielt wurde.

Jede Methode oeffnet ihre eigene, kurzlebige Verbindung -- bei der zu
erwartenden Handvoll gleichzeitiger Spieler ist das einfacher als eine
gemeinsame Verbindung ueber Threads hinweg zu verwalten, und ein globales
Lock serialisiert ohnehin jeden Schreibzugriff (siehe persist.py fuer
dieselbe Abwaegung bei den JSON-Dateien dort).
"""

from __future__ import annotations

import os
import re
import secrets
import sqlite3
import string
import threading
import time

from werkzeug.security import generate_password_hash

MAX_EMAIL_CHARS = 254
MIN_PASSWORD_CHARS = 8

STATUS_ACTIVE = 'active'
STATUS_LOCKED = 'locked'

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# Wie in auth.py: kein Zeichen, das sich beim Abtippen oder in einer
# Protokollzeile missverstehen laesst -- das erzeugte Passwort wird dem Admin
# genau einmal im Panel angezeigt.
_ALPHABET = string.ascii_letters.replace('l', '').replace('I', '').replace('O', '') \
    + string.digits.replace('0', '').replace('1', '')

_lock = threading.Lock()


def normalize_email(raw: str) -> str:
    return (raw or '').strip().lower()


def generate_password(length: int = 16) -> str:
    return ''.join(secrets.choice(_ALPHABET) for _ in range(length))


class UserStore:
    def __init__(self, data_dir: str):
        os.makedirs(data_dir, exist_ok=True)
        self._path = os.path.join(data_dir, 'users.db')
        with self._connect() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at INTEGER NOT NULL,
                    created_by TEXT
                );
                CREATE TABLE IF NOT EXISTS login_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    at INTEGER NOT NULL,
                    ip TEXT
                );
                CREATE TABLE IF NOT EXISTS play_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    reactor TEXT,
                    scenario TEXT,
                    duration_s REAL,
                    completed INTEGER,
                    at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_play_sessions_user ON play_sessions(user_id);
            ''')

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, timeout=10)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.row_factory = sqlite3.Row
        return conn

    # ── Konten ────────────────────────────────────────────────────────────────

    def create_user(self, email: str, password: str | None = None,
                     created_by: str | None = None) -> tuple[dict | None, str | None]:
        """@return (Konto-Dict, None) oder (None, Fehlergrund).

        Das Konto-Dict traegt bei erzeugtem Passwort zusaetzlich
        'generated_password' im Klartext -- NUR im Rueckgabewert dieses einen
        Aufrufs, nie gespeichert. Ein selbst gesetztes Passwort taucht dort
        nicht wieder auf.
        """
        email = normalize_email(email)
        if not email or len(email) > MAX_EMAIL_CHARS or not _EMAIL_RE.match(email):
            return None, 'bad_email'
        generated = None
        if not password:
            password = generate_password()
            generated = password
        elif len(password) < MIN_PASSWORD_CHARS:
            return None, 'password_too_short'
        uid = secrets.token_hex(16)
        now = int(time.time())
        with _lock:
            try:
                with self._connect() as conn:
                    conn.execute(
                        'INSERT INTO users (id, email, password_hash, status, created_at, created_by) '
                        'VALUES (?, ?, ?, ?, ?, ?)',
                        (uid, email, generate_password_hash(password), STATUS_ACTIVE, now, created_by))
            except sqlite3.IntegrityError:
                return None, 'email_taken'
        result = {'id': uid, 'email': email}
        if generated:
            result['generated_password'] = generated
        return result, None

    def find_for_login(self, email: str) -> dict | None:
        """Fuer auth.check(): Hash und Sperrstatus, ohne alles andere."""
        email = normalize_email(email)
        if not email:
            return None
        with self._connect() as conn:
            row = conn.execute(
                'SELECT id, email, password_hash, status FROM users WHERE email = ?',
                (email,)).fetchone()
        return dict(row) if row else None

    def get_by_id(self, user_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                'SELECT id, email, status, created_at FROM users WHERE id = ?',
                (user_id,)).fetchone()
        return dict(row) if row else None

    def set_status(self, user_id: str, status: str) -> bool:
        if status not in (STATUS_ACTIVE, STATUS_LOCKED):
            raise ValueError('status')
        with _lock, self._connect() as conn:
            cur = conn.execute('UPDATE users SET status = ? WHERE id = ?', (status, user_id))
            return cur.rowcount > 0

    def reset_password(self, user_id: str) -> tuple[str | None, str | None]:
        """@return (neues Klartextpasswort, None) oder (None, 'not_found')."""
        new_password = generate_password()
        with _lock:
            with self._connect() as conn:
                cur = conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                                   (generate_password_hash(new_password), user_id))
                if cur.rowcount == 0:
                    return None, 'not_found'
        return new_password, None

    def list_users(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute('''
                SELECT u.id, u.email, u.status, u.created_at,
                    (SELECT MAX(at) FROM login_events WHERE user_id = u.id) AS last_login_at,
                    (SELECT ip FROM login_events WHERE user_id = u.id
                        ORDER BY at DESC LIMIT 1) AS last_login_ip,
                    (SELECT COALESCE(SUM(duration_s), 0) FROM play_sessions
                        WHERE user_id = u.id) AS total_playtime_s
                FROM users u ORDER BY u.email
            ''').fetchall()
        return [dict(r) for r in rows]

    # ── Anmelde- und Spielprotokoll ───────────────────────────────────────────

    def record_login(self, user_id: str, ip: str | None) -> None:
        with _lock, self._connect() as conn:
            conn.execute('INSERT INTO login_events (user_id, at, ip) VALUES (?, ?, ?)',
                         (user_id, int(time.time()), ip))

    def record_play_session(self, user_id: str, reactor, scenario,
                             duration_s, completed: bool) -> None:
        with _lock, self._connect() as conn:
            conn.execute(
                'INSERT INTO play_sessions (user_id, reactor, scenario, duration_s, completed, at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (user_id, reactor, scenario, duration_s, 1 if completed else 0, int(time.time())))

    def recent_login_events(self, limit: int = 50) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute('''
                SELECT l.at, l.ip, u.email FROM login_events l
                JOIN users u ON u.id = l.user_id
                ORDER BY l.at DESC LIMIT ?
            ''', (limit,)).fetchall()
        return [dict(r) for r in rows]

    def recent_play_sessions(self, limit: int = 50) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute('''
                SELECT p.at, p.reactor, p.scenario, p.duration_s, p.completed, u.email
                FROM play_sessions p JOIN users u ON u.id = p.user_id
                ORDER BY p.at DESC LIMIT ?
            ''', (limit,)).fetchall()
        return [dict(r) for r in rows]
