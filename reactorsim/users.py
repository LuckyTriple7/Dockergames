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
* `play_sessions` -- JEDER beendete Spiellauf (Reaktortyp, Szenario, Dauer,
  Ausgang, Punktestand falls eingereicht), damit das Admin-Panel zeigen kann,
  was gespielt wurde. Bis 0.5.11 landete hier nur, was jemand ausdruecklich in
  die Bestenliste eingetragen hat -- Tutorials, freies Spiel, abgebrochene und
  gescheiterte Laeufe fehlten damit vollstaendig, und die Spalte "Spielzeit
  gesamt" zaehlte nur einen Bruchteil der tatsaechlichen Zeit.
  Seit 0.6.1 steht neben der vom Client gemeldeten SIMULIERTEN Dauer auch
  `wall_s` -- die tatsaechlich am Schirm verbrachte Zeit, vom Server selbst
  gemessen (siehe app.py, /api/runs/start). Die beiden Zahlen sind nicht
  dasselbe: bei 60-fachem Zeitraffer liegen zwischen ihnen Faktoren.
* `password_resets` -- offene "Passwort vergessen"-Vorgaenge. Gespeichert wird
  nur der SHA-256-Abdruck des Tokens, nie das Token selbst: wer die Datei
  liest, kann damit kein Passwort setzen.

Jede Methode oeffnet ihre eigene, kurzlebige Verbindung -- bei der zu
erwartenden Handvoll gleichzeitiger Spieler ist das einfacher als eine
gemeinsame Verbindung ueber Threads hinweg zu verwalten, und ein globales
Lock serialisiert ohnehin jeden Schreibzugriff (siehe persist.py fuer
dieselbe Abwaegung bei den JSON-Dateien dort).
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import string
import threading
import time

from werkzeug.security import check_password_hash, generate_password_hash

MAX_EMAIL_CHARS = 254
MIN_PASSWORD_CHARS = 8

STATUS_ACTIVE = 'active'
STATUS_LOCKED = 'locked'

# Wie ein Lauf zustande kam und wie er ausging. Beides steht in der Historie,
# weil "30 Minuten gespielt" ohne den Ausgang wenig sagt -- und weil ein
# Tutorial etwas anderes ist als eine gewertete Schicht.
MODE_SCENARIO = 'scenario'
MODE_TUTORIAL = 'tutorial'
MODE_FREE = 'free'
MODES = (MODE_SCENARIO, MODE_TUTORIAL, MODE_FREE)

OUTCOME_COMPLETED = 'completed'
OUTCOME_FAILED = 'failed'
OUTCOME_DESTROYED = 'destroyed'
OUTCOME_ABORTED = 'aborted'
OUTCOMES = (OUTCOME_COMPLETED, OUTCOME_FAILED, OUTCOME_DESTROYED, OUTCOME_ABORTED)

# Gueltigkeit eines "Passwort vergessen"-Links. Lang genug, dass eine Mail in
# Ruhe ankommen darf, kurz genug, dass ein liegen gebliebenes Postfach kein
# Dauerschluessel wird.
RESET_TTL_S = 2 * 3600

# Domainteil als punktfreie Segmente, durch genau einen Punkt getrennt. Die
# alte Form `[^@\s]+\.[^@\s]+` liess den Punkt in beide Klassen fallen: bei
# einer langen Domain ohne Treffer probierte die Engine jede Stelle als
# Trennpunkt durch -- quadratisch (CodeQL py/polynomial-redos). Hier gibt es
# fuer jede Adresse genau eine Zerlegung.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$')

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
                CREATE TABLE IF NOT EXISTS password_resets (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    used_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_play_sessions_user ON play_sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_play_sessions_at ON play_sessions(at);
                CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
            ''')
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Nachtraeglich hinzugekommene Spalten.

        Eine bestehende /data/users.db darf beim Update nicht neu angelegt
        werden -- sonst waeren alle Konten weg. ALTER TABLE ADD COLUMN ist in
        SQLite billig und laesst vorhandene Zeilen mit NULL stehen; genau das
        ist hier richtig: fuer alte Zeilen IST der Modus unbekannt, und eine
        erfundene Vorgabe wuerde das Panel mit falschen Angaben fuellen.
        """
        have = {row['name'] for row in conn.execute('PRAGMA table_info(play_sessions)')}
        for column, ddl in (('mode', 'TEXT'), ('outcome', 'TEXT'), ('score', 'INTEGER'),
                            ('wall_s', 'REAL')):
            if column not in have:
                conn.execute(f'ALTER TABLE play_sessions ADD COLUMN {column} {ddl}')

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

    def delete_user(self, user_id: str) -> dict | None:
        """Konto samt Historie endgueltig entfernen. @return das geloeschte
        Konto (fuer die Meldung im Panel), oder None wenn es das nicht gab.

        Sperren ist der Normalfall -- ein gesperrtes Konto behaelt seine
        Historie und laesst sich zuruecknehmen. Loeschen ist das Gegenteil und
        genau dafuer da: wenn jemand nicht mehr in der Datei stehen soll. Es
        nimmt deshalb ALLES mit, was an der Kennung haengt -- Anmelde- und
        Spielprotokoll, offene Reset-Vorgaenge --, in EINER Transaktion. Ein
        halb geloeschtes Konto waere das schlechteste von beidem: der Name weg,
        die Spuren da.

        NICHT betroffen sind die Bestenlisten-Eintraege: die tragen einen frei
        gewaehlten Anzeigenamen und keine Kontokennung (siehe persist.py), es
        gibt also gar nichts, was sich hier zuordnen liesse. Die Spielstaende
        loescht der Aufrufer (app.py) -- sie liegen als Dateien, nicht hier.
        """
        with _lock, self._connect() as conn:
            row = conn.execute('SELECT id, email FROM users WHERE id = ?',
                               (user_id,)).fetchone()
            if row is None:
                return None
            conn.execute('DELETE FROM login_events WHERE user_id = ?', (user_id,))
            conn.execute('DELETE FROM play_sessions WHERE user_id = ?', (user_id,))
            conn.execute('DELETE FROM password_resets WHERE user_id = ?', (user_id,))
            conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
            return dict(row)

    def change_password(self, user_id: str, current: str,
                        new_password: str) -> str | None:
        """Passwortwechsel durch den Spieler selbst (siehe app.py,
        /api/account/password). @return None bei Erfolg, sonst der Grund.

        Das alte Passwort wird MITGEPRUEFT, obwohl der Aufrufer bereits
        angemeldet ist: ohne das genuegt ein kurz unbeaufsichtigter Browser,
        um ein Konto zu uebernehmen -- die Sitzung laeuft 30 Tage (siehe
        auth.py SESSION_MAX_AGE).

        Geprueft und geschrieben wird in EINER Transaktion, wie beim
        Reset-Token: sonst koennten zwei gleichzeitige Wechsel beide gegen
        denselben alten Hash pruefen.
        """
        if not new_password or len(new_password) < MIN_PASSWORD_CHARS:
            return 'password_too_short'
        with _lock, self._connect() as conn:
            row = conn.execute(
                'SELECT password_hash, status FROM users WHERE id = ?',
                (user_id,)).fetchone()
            if row is None:
                return 'not_found'
            if row['status'] != STATUS_ACTIVE:
                return 'account_locked'
            if not check_password_hash(row['password_hash'], current or ''):
                return 'wrong_password'
            if check_password_hash(row['password_hash'], new_password):
                # Kein Fehler im technischen Sinn, aber der Spieler haette
                # sonst den Eindruck, etwas geaendert zu haben.
                return 'password_unchanged'
            conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                         (generate_password_hash(new_password), user_id))
        return None

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
                        WHERE user_id = u.id) AS total_playtime_s,
                    (SELECT COALESCE(SUM(wall_s), 0) FROM play_sessions
                        WHERE user_id = u.id) AS total_wall_s,
                    (SELECT COUNT(*) FROM play_sessions WHERE user_id = u.id) AS run_count
                FROM users u ORDER BY u.email
            ''').fetchall()
        return [dict(r) for r in rows]

    def set_password(self, user_id: str, password: str) -> str | None:
        """Selbst gewaehltes Passwort (Passwort-vergessen-Ablauf).
        @return None bei Erfolg, sonst der Fehlergrund."""
        if not password or len(password) < MIN_PASSWORD_CHARS:
            return 'password_too_short'
        with _lock, self._connect() as conn:
            cur = conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                               (generate_password_hash(password), user_id))
            if cur.rowcount == 0:
                return 'not_found'
        return None

    # ── Anmelde- und Spielprotokoll ───────────────────────────────────────────

    def record_login(self, user_id: str, ip: str | None) -> None:
        with _lock, self._connect() as conn:
            conn.execute('INSERT INTO login_events (user_id, at, ip) VALUES (?, ?, ?)',
                         (user_id, int(time.time()), ip))

    def record_play_session(self, user_id: str, reactor, scenario,
                             duration_s, completed: bool,
                             mode: str = MODE_SCENARIO,
                             outcome: str | None = None,
                             score: int | None = None,
                             wall_s: float | None = None) -> int:
        """Einen beendeten Lauf in die Historie schreiben. @return die Zeilen-ID.

        Der Aufrufer prueft Reaktor und Szenario gegen den Katalog (app.py);
        hier wird nur noch auf die bekannten Modi/Ausgaenge eingedampft,
        damit kein freier Text aus einer Anfrage in der Tabelle landet.

        `duration_s` ist SIMULIERTE Zeit und stammt vom Client; `wall_s` ist
        die am Schirm verbrachte, vom Server selbst gemessene Zeit (siehe
        app.py, /api/runs/start) und bleibt NULL, wenn zu diesem Lauf keine
        Messung vorliegt -- dann ist sie unbekannt, und eine geschaetzte Zahl
        waere eine erfundene Angabe.
        """
        mode = mode if mode in MODES else MODE_SCENARIO
        if outcome not in OUTCOMES:
            outcome = OUTCOME_COMPLETED if completed else OUTCOME_FAILED
        with _lock, self._connect() as conn:
            cur = conn.execute(
                'INSERT INTO play_sessions '
                '(user_id, reactor, scenario, duration_s, completed, at, mode, outcome, '
                ' score, wall_s) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (user_id, reactor, scenario, duration_s, 1 if completed else 0,
                 int(time.time()), mode, outcome, score, wall_s))
            return int(cur.lastrowid)

    # Wie lange nach dem Lauf ein eingereichter Punktestand noch als "zu
    # diesem Lauf gehoerig" gilt. Der Spieler tippt im Debrief erst seinen
    # Namen ein, liest die Auswertung und drueckt dann vielleicht auf
    # "Eintragen" -- Minuten spaeter ist voellig normal.
    SCORE_ATTACH_WINDOW_S = 3600

    def attach_score(self, user_id: str, reactor, scenario, score: int) -> bool:
        """Den eingereichten Punktestand an den passenden Lauf haengen.

        Der Lauf steht schon in der Tabelle: ihn meldet der Client beim
        Beenden (siehe app.py, /api/runs), unabhaengig davon, ob jemals ein
        Punktestand eingereicht wird. Ohne dieses Nachtragen stuende derselbe
        Lauf zweimal in der Historie -- einmal beim Beenden, einmal beim
        Eintragen -- und die Spielzeit waere doppelt gezaehlt.

        @return True, wenn ein Lauf gefunden wurde. Sonst legt der Aufrufer
        einen an (Offline-Fall: /api/runs kam nie an, /api/highscores schon).
        """
        cutoff = int(time.time()) - self.SCORE_ATTACH_WINDOW_S
        with _lock, self._connect() as conn:
            row = conn.execute(
                'SELECT id FROM play_sessions WHERE user_id = ? AND reactor = ? '
                'AND scenario = ? AND score IS NULL AND at >= ? ORDER BY at DESC LIMIT 1',
                (user_id, reactor, scenario, cutoff)).fetchone()
            if row is None:
                return False
            conn.execute('UPDATE play_sessions SET score = ? WHERE id = ?', (score, row['id']))
            return True

    # -- Blaetterbare Listen ---------------------------------------------------
    #
    # Jede dieser vier Abfragen liefert ein Dict mit `rows`, `total`, `offset`
    # und `limit` statt einer nackten Liste. Der Grund ist die Anzeige: eine
    # Seite, die nur die ersten 50 Zeilen zeigt und nicht sagt, wie viele es
    # insgesamt sind, laesst den Betreiber im Unklaren, ob er alles sieht --
    # und ohne `total` kann die Blaetterleiste nicht wissen, ob es eine
    # naechste Seite gibt. COUNT(*) ueber eine indizierte Tabelle mit ein paar
    # tausend Zeilen ist billig genug, um es bei jedem Seitenaufruf zu zahlen.

    @staticmethod
    def _page(rows, total: int, limit: int, offset: int) -> dict:
        return {'rows': [dict(r) for r in rows], 'total': int(total),
                'limit': int(limit), 'offset': int(offset)}

    def recent_login_events(self, limit: int = 50, offset: int = 0) -> dict:
        with self._connect() as conn:
            total = conn.execute('SELECT COUNT(*) FROM login_events').fetchone()[0]
            rows = conn.execute('''
                SELECT l.at, l.ip, u.email FROM login_events l
                JOIN users u ON u.id = l.user_id
                ORDER BY l.at DESC LIMIT ? OFFSET ?
            ''', (limit, offset)).fetchall()
        return self._page(rows, total, limit, offset)

    def recent_play_sessions(self, limit: int = 50, offset: int = 0) -> dict:
        with self._connect() as conn:
            total = conn.execute('SELECT COUNT(*) FROM play_sessions').fetchone()[0]
            rows = conn.execute('''
                SELECT p.at, p.reactor, p.scenario, p.duration_s, p.wall_s, p.completed,
                       p.mode, p.outcome, p.score, u.email, u.id AS user_id
                FROM play_sessions p JOIN users u ON u.id = p.user_id
                ORDER BY p.at DESC LIMIT ? OFFSET ?
            ''', (limit, offset)).fetchall()
        return self._page(rows, total, limit, offset)

    # -- Historie eines einzelnen Kontos --------------------------------------

    def user_play_sessions(self, user_id: str, limit: int = 200,
                           offset: int = 0) -> dict:
        with self._connect() as conn:
            total = conn.execute(
                'SELECT COUNT(*) FROM play_sessions WHERE user_id = ?',
                (user_id,)).fetchone()[0]
            rows = conn.execute('''
                SELECT at, reactor, scenario, duration_s, wall_s, completed,
                       mode, outcome, score
                FROM play_sessions WHERE user_id = ? ORDER BY at DESC LIMIT ? OFFSET ?
            ''', (user_id, limit, offset)).fetchall()
        return self._page(rows, total, limit, offset)

    def user_login_events(self, user_id: str, limit: int = 200,
                          offset: int = 0) -> dict:
        with self._connect() as conn:
            total = conn.execute(
                'SELECT COUNT(*) FROM login_events WHERE user_id = ?',
                (user_id,)).fetchone()[0]
            rows = conn.execute(
                'SELECT at, ip FROM login_events WHERE user_id = ? '
                'ORDER BY at DESC LIMIT ? OFFSET ?',
                (user_id, limit, offset)).fetchall()
        return self._page(rows, total, limit, offset)

    def user_stats(self, user_id: str) -> dict:
        """Die Zahlen ueber der Historie. Eine Abfrage statt fuenf, damit die
        Kontoseite nicht mehrfach ueber dieselbe Tabelle laeuft."""
        with self._connect() as conn:
            row = conn.execute('''
                SELECT COUNT(*) AS runs,
                       COALESCE(SUM(duration_s), 0) AS total_playtime_s,
                       COALESCE(SUM(wall_s), 0) AS total_wall_s,
                       COALESCE(SUM(completed), 0) AS completed_runs,
                       MAX(score) AS best_score,
                       MAX(at) AS last_play_at
                FROM play_sessions WHERE user_id = ?
            ''', (user_id,)).fetchone()
            logins = conn.execute(
                'SELECT COUNT(*) AS n FROM login_events WHERE user_id = ?',
                (user_id,)).fetchone()
        out = dict(row)
        out['logins'] = logins['n']
        return out

    def scenario_breakdown(self, user_id: str) -> list[dict]:
        """Je Szenario: wie oft, wie lange, wie oft geschafft, bester Wert."""
        with self._connect() as conn:
            rows = conn.execute('''
                SELECT reactor, scenario, mode, COUNT(*) AS runs,
                       COALESCE(SUM(duration_s), 0) AS total_s,
                       COALESCE(SUM(wall_s), 0) AS total_wall_s,
                       COALESCE(SUM(completed), 0) AS completed_runs,
                       MAX(score) AS best_score,
                       MAX(at) AS last_at
                FROM play_sessions WHERE user_id = ?
                GROUP BY reactor, scenario, mode ORDER BY last_at DESC
            ''', (user_id,)).fetchall()
        return [dict(r) for r in rows]

    # -- Passwort vergessen ---------------------------------------------------
    #
    # Gespeichert wird nur der Abdruck des Tokens. Das Token selbst existiert
    # genau zweimal: in der verschickten Mail und im Link, den der Spieler
    # anklickt. Wer die Datenbank liest, kann daraus keines bauen -- derselbe
    # Grundsatz wie beim Passwort-Hash eine Tabelle weiter oben.

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256((token or '').encode('utf-8')).hexdigest()

    def create_reset_token(self, email: str) -> tuple[str, dict] | None:
        """@return (Token im Klartext, Kontodaten) -- oder None, wenn es die
        Adresse nicht gibt oder das Konto gesperrt ist.

        Der Aufrufer darf den Unterschied NICHT nach aussen zeigen: die
        Antwort auf dem Formular ist immer dieselbe, sonst verraet sie, welche
        Adressen ein Konto haben.
        """
        row = self.find_for_login(email)
        if row is None or row['status'] != STATUS_ACTIVE:
            return None
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with _lock, self._connect() as conn:
            # Ein neuer Link entwertet alle vorherigen. Sonst haette jemand,
            # der zehnmal auf "Passwort vergessen" drueckt, zehn gleichzeitig
            # gueltige Schluessel im Postfach liegen.
            conn.execute('DELETE FROM password_resets WHERE user_id = ?', (row['id'],))
            conn.execute(
                'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) '
                'VALUES (?, ?, ?, ?)',
                (self._token_hash(token), row['id'], now, now + RESET_TTL_S))
        return token, {'id': row['id'], 'email': row['email']}

    def peek_reset_token(self, token: str) -> dict | None:
        """Gueltiges Token? @return die Kontodaten, sonst None. Aendert nichts
        -- fuer die GET-Seite, die erst das Formular zeigt."""
        with self._connect() as conn:
            row = conn.execute('''
                SELECT r.user_id, u.email, u.status FROM password_resets r
                JOIN users u ON u.id = r.user_id
                WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?
            ''', (self._token_hash(token), int(time.time()))).fetchone()
        if row is None or row['status'] != STATUS_ACTIVE:
            return None
        return {'id': row['user_id'], 'email': row['email']}

    def consume_reset_token(self, token: str,
                            new_password: str) -> tuple[str | None, str | None]:
        """Token einloesen und das Passwort setzen.
        @return (E-Mail des Kontos, None) oder (None, Fehlergrund).

        Token und Passwortwechsel laufen in EINER Transaktion: ohne das
        koennte ein zweiter Klick auf denselben Link zwischen Pruefung und
        Schreibvorgang hindurchrutschen.
        """
        if not new_password or len(new_password) < MIN_PASSWORD_CHARS:
            return None, 'password_too_short'
        digest = self._token_hash(token)
        now = int(time.time())
        with _lock, self._connect() as conn:
            row = conn.execute('''
                SELECT r.user_id, u.email, u.status FROM password_resets r
                JOIN users u ON u.id = r.user_id
                WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?
            ''', (digest, now)).fetchone()
            if row is None:
                return None, 'bad_token'
            if row['status'] != STATUS_ACTIVE:
                return None, 'account_locked'
            conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                         (generate_password_hash(new_password), row['user_id']))
            conn.execute('UPDATE password_resets SET used_at = ? WHERE token_hash = ?',
                         (now, digest))
            return row['email'], None

    def purge_expired_resets(self) -> None:
        """Abgelaufene und eingeloeste Vorgaenge wegraeumen. Billig, und ohne
        das waechst die Tabelle ueber die Laufzeit monoton mit."""
        with _lock, self._connect() as conn:
            conn.execute(
                'DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL',
                (int(time.time()),))
