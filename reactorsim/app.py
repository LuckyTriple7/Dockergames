#!/usr/bin/env python3
"""ReactorSim — Kernkraftwerks-Leitstand als Browser-Spiel.

Kein Home-Assistant-Add-on: der Ordner enthaelt bewusst keine config.yaml,
sonst wuerde der Supervisor ihn als Add-on einlesen. Betrieb ausschliesslich
ueber docker-compose (Dockge).

Die gesamte Simulation laeuft im Browser. Dieser Server liefert nur die Seite,
die Uebersetzungen, /health fuer den Healthcheck und spaeter eine kleine
JSON-Schnittstelle fuer Spielstaende und Bestenliste.
"""

import ipaddress
import json
import logging
import os
import secrets
import signal
import sqlite3
import subprocess
import threading
import time

from datetime import datetime, timezone
from urllib.parse import quote

from flask import (Flask, abort, g, jsonify, make_response, redirect,
                   render_template, request, send_from_directory)
from waitress import serve
from werkzeug.middleware.proxy_fix import ProxyFix

import auth as authmod
import mailer as mailermod
import persist
import scoring
import users as usersmod

logging.basicConfig(format='[%(levelname)s] [%(asctime)s] %(message)s',
                    level=logging.INFO, datefmt='%Y-%m-%d %H:%M:%S', force=True)
log = logging.getLogger(__name__)
logging.getLogger('werkzeug').setLevel(logging.ERROR)
for _noisy in ('waitress', 'waitress.queue'):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# ── Pfade ─────────────────────────────────────────────────────────────────────

_BASE = os.environ.get('REACTORSIM_BASE', '/app')
_DATA = os.environ.get('REACTORSIM_DATA', '/data')

LOCALES_PATH = _BASE + '/locales'
STATIC_PATH = _BASE + '/static'
SCENARIO_PATH = STATIC_PATH + '/data/scenarios'
VERSION_PATH = _BASE + '/VERSION'
VERIFY_SCRIPT = _BASE + '/verify_run.mjs'
# Ein Lauf rechnet in Node in Sekundenbruchteilen (siehe tests/test-replay.mjs)
# -- selbst das laengste Szenario (6h) noch deutlich darunter. Grosszuegig
# bemessen gegen einen langsamen Container beim Start, nicht gegen die
# eigentliche Rechenzeit.
VERIFY_TIMEOUT_S = 20

PORT = int(os.environ.get('REACTORSIM_PORT', '17779'))

# Zugangsdaten des Admin-Kontos aus der Umgebung, also aus der
# Dockge-Konfiguration -- genau eines, fest verdrahtet. Ist kein Passwort
# gesetzt, erzeugt auth.Auth beim ersten Start eines und schreibt es ins
# Protokoll -- offen steht die Seite nie. Der Admin spielt nicht: er legt
# Spielerkonten im Admin-Panel an (siehe users.py, /admin-Routen unten).
REACTORSIM_USER = os.environ.get('REACTORSIM_USER', 'admin')
REACTORSIM_PASSWORD = os.environ.get('REACTORSIM_PASSWORD', '')

# Unter welcher Adresse die Anlage von aussen erreichbar ist -- nur fuer die
# Links in verschickten Mails. Ohne die Angabe nimmt _public_url() die Adresse
# der gerade laufenden Anfrage; das stimmt fast immer, geht aber daneben,
# sobald der Reverse Proxy unter einem anderen Namen veroeffentlicht als dem,
# unter dem der Container gerade angesprochen wurde.
REACTORSIM_PUBLIC_URL = os.environ.get('REACTORSIM_PUBLIC_URL', '').strip().rstrip('/')

# Eine einzige Versionsquelle: die Datei VERSION. Sie ist zugleich der Ausloeser
# des Build-Workflows, deshalb kann sie hier nicht auseinanderlaufen. Der
# Rueckfallwert greift nur, wenn jemand app.py ohne die Datei startet.
_FALLBACK_VERSION = '0.0.1'


def _read_version() -> str:
    try:
        with open(VERSION_PATH, 'r', encoding='utf-8') as f:
            v = f.read().strip()
        return v or _FALLBACK_VERSION
    except OSError:
        return _FALLBACK_VERSION


APP_VERSION = _read_version()

app = Flask(__name__, template_folder=_BASE + '/templates',
            static_folder=STATIC_PATH)
app.config['MAX_CONTENT_LENGTH'] = 256 * 1024

# Hinter Reverse Proxy (NPMPlus) und optional Cloudflare Tunnel haengen
# mehrere Zwischenstationen in der Kette. ProxyFix mit fester x_for-Anzahl
# vertraut blind einer Position und traf damit je nach Pfad mal den
# Docker-Gateway, mal einen Cloudflare-Knoten -- _client_ip() unten sucht
# stattdessen die erste oeffentliche Adresse in der Kette. Wer den Port
# direkt erreicht, kann die Header faelschen -- das ist der Preis und
# aendert nichts daran, dass der Punktestand ohnehin serverseitig
# gerechnet wird.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)

_PROXY_IP_HEADERS = ('X-Forwarded-For', 'CF-Connecting-IP')


def _client_ip() -> str:
    """Erste oeffentliche Adresse aus den Proxy-Headern, sonst der TCP-Peer."""
    for header in _PROXY_IP_HEADERS:
        raw = request.headers.get(header, '')
        for part in raw.split(','):
            candidate = part.strip()
            if not candidate:
                continue
            try:
                ip = ipaddress.ip_address(candidate)
            except ValueError:
                continue
            if ip.is_global:
                return candidate
    return request.remote_addr or '-'


class OpenRuns:
    """Serverseitige Zeitmessung eines laufenden Spiels.

    Bis 0.6.0 war die Dauer in der Historie reine Klientenangabe: der Browser
    schickte am Ende `duration_s`, und der Server deckelte sie bei 24 h --
    mehr konnte er nicht tun, weil er vom Lauf selbst nichts wusste. Mit
    diesem Verzeichnis weiss er es: der Client meldet den BEGINN (/api/runs/
    start), der Server merkt sich seine eigene Uhr dazu, und am Ende steht
    ihm eine Zahl zur Verfuegung, die gar nicht aus der Anfrage stammt.

    Drei Dinge fallen dabei ab:

    * `wall_s` -- die tatsaechlich am Schirm verbrachte Zeit. Sie ist die
      ehrlichere Antwort auf "wie lange hat der gespielt?" als die simulierte
      Zeit, die bei 60-fachem Zeitraffer das Sechzigfache betraegt.
    * eine OBERGRENZE fuer die gemeldete simulierte Zeit: schneller als 60x
      (der hoechste Zeitraffer, siehe loop.js) kann kein Browser rechnen, mehr
      als `Startzeit + wall_s * 60` kann ein ehrlicher Lauf also nicht erreicht
      haben.
    * `skip_s` -- die Summe der angemeldeten Xenon-Zeitspruenge (siehe
      /api/runs/skip). Der Vorspulknopf des freien Spiels rechnet in einer
      engen Schleife statt im Bildtakt und bricht die 60x-Grenze damit von
      innen; bis 0.6.2 bekam deshalb JEDES freie Spiel pauschal 48 h
      geschenkt, ob gesprungen wurde oder nicht. Jetzt zaehlt nur, was
      angemeldet wurde -- und angemeldet wird nur, was dieser Server selbst
      als freies Spiel gefuehrt hat.

    Seit 0.6.3 ueberlebt die Messung einen Neustart des Containers: die
    offenen Laeufe liegen in `runs.db` neben den Konten, mit der Wanduhr ihres
    Beginns. Die Ausfallzeit des Servers zaehlt dabei NICHT als Spielzeit --
    dafuer steht in derselben Datei eine Marke, die der laufende Betrieb alle
    paar Sekunden erneuert (siehe touch()); beim Hochfahren ist die Luecke
    zwischen ihr und jetzt die Zeit, in der niemand spielen konnte. Bleibt die
    Datei stumm (Schreibfehler, altes Verzeichnis), laeuft alles wie vorher:
    die Messung lebt im Speicher, ein Neustart verliert sie, und die Dauer
    faellt auf den 24-h-Deckel zurueck -- ein fehlender Messwert ist kein
    Grund, einen Lauf gar nicht erst aufzuzeichnen.
    """

    # Ein Lauf, der laenger offen steht als das laengste moegliche Spiel
    # (24 h simuliert, bei 1x also 24 h real) plus Puffer, ist keiner mehr --
    # der Browser ist weg, ohne sich abzumelden.
    TTL_S = 26 * 3600
    # Obergrenze gegen ein Verzeichnis, das nur waechst. Erreicht sie jemand
    # trotz TTL, fliegt der aelteste Eintrag -- das kostet hoechstens EINE
    # Zeitmessung, nie einen Lauf.
    MAX_OPEN = 2048
    # Abstand zwischen zwei Lebenszeichen auf der Platte. Kuerzer als der
    # Healthcheck des Containers (30 s, siehe Dockerfile), damit jeder davon
    # die Marke wirklich erneuert -- sonst waere die gemessene Ausfallzeit um
    # eine ganze Runde zu lang. Eine winzige Schreibweise alle halbe Minute.
    SEEN_EVERY_S = 20.0

    _SCHEMA = '''
        CREATE TABLE IF NOT EXISTS open_runs (
            token TEXT PRIMARY KEY,
            account TEXT NOT NULL,
            reactor TEXT,
            scenario TEXT,
            start_sim REAL NOT NULL,
            skip_s REAL NOT NULL DEFAULT 0,
            t0 REAL NOT NULL,
            lost_s REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS server_seen (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            seen REAL NOT NULL
        );
    '''

    def __init__(self, data_dir: str | None = None):
        self._runs: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()
        self._path = os.path.join(data_dir, 'runs.db') if data_dir else None
        self._seen_mono = 0.0
        self._warned = False
        if self._path:
            # Wie in users.py: das Verzeichnis kann beim allerersten Start
            # noch fehlen. Ohne dieses makedirs scheitert schon das Anlegen
            # der Tabellen -- und danach JEDE Schreibweise, weil es sie dann
            # nie gibt.
            os.makedirs(data_dir, exist_ok=True)
            self._restore()

    # ── Platte ────────────────────────────────────────────────────────────

    def _connect(self):
        conn = sqlite3.connect(self._path, timeout=5)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.row_factory = sqlite3.Row
        return conn

    def _write(self, sql: str, params: tuple = ()) -> None:
        """Buchhaltung, kein Spielstand: schlaegt sie fehl, laeuft die Runde
        weiter -- nur ohne Messung ueber einen Neustart hinweg. Gemeldet wird
        einmal, nicht bei jeder Schreibweise."""
        if not self._path:
            return
        try:
            with self._connect() as conn:
                conn.execute(sql, params)
        except sqlite3.Error as exc:
            if not self._warned:
                self._warned = True
                log.error("Zeitmessung nicht gespeichert: %s", exc.__class__.__name__)

    def _restore(self) -> None:
        """Offene Laeufe aus der Datei zurueckholen und die Ausfallzeit des
        Servers abziehen.

        Die Uhr auf der Platte ist die Wanduhr; drinnen rechnet alles weiter
        mit `time.monotonic()` (die keine Zeitumstellung kennt). Uebersetzt
        wird einmal hier: aus dem verstrichenen Anteil wird ein Startpunkt,
        als haette dieser Prozess den Lauf selbst eroeffnet.
        """
        now_wall, now_mono = time.time(), time.monotonic()
        try:
            with self._connect() as conn:
                conn.executescript(self._SCHEMA)
                row = conn.execute('SELECT seen FROM server_seen WHERE id = 1').fetchone()
                # Ohne Marke ist dies der erste Start mit dieser Datei: dann
                # gibt es keine Ausfallzeit, nur einen leeren Tisch.
                down = max(0.0, now_wall - float(row['seen'])) if row else 0.0
                conn.execute('INSERT INTO server_seen (id, seen) VALUES (1, ?) '
                             'ON CONFLICT(id) DO UPDATE SET seen = excluded.seen',
                             (now_wall,))
                rows = conn.execute('SELECT * FROM open_runs').fetchall()
                stale, live = [], []
                for r in rows:
                    lost = float(r['lost_s']) + down
                    elapsed = now_wall - float(r['t0']) - lost
                    if not (elapsed == elapsed) or elapsed > self.TTL_S:
                        stale.append(r['token'])
                        continue
                    live.append((r, max(0.0, elapsed), lost))
                if stale:
                    conn.executemany('DELETE FROM open_runs WHERE token = ?',
                                     [(tok,) for tok in stale])
                for r, _elapsed, lost in live:
                    conn.execute('UPDATE open_runs SET lost_s = ? WHERE token = ?',
                                 (lost, r['token']))
        except sqlite3.Error as exc:
            log.error("Offene Zeitmessungen nicht gelesen: %s", exc.__class__.__name__)
            return
        self._seen_mono = now_mono
        for r, elapsed, _lost in live:
            self._runs[(r['account'], r['token'])] = {
                't0': now_mono - elapsed, 'reactor': r['reactor'],
                'scenario': r['scenario'], 'start_sim': float(r['start_sim']),
                'skip_s': float(r['skip_s'])}
        if live or stale:
            log.info("Zeitmessung: %d offene Laeufe uebernommen, %d verfallen, "
                     "%.0f s Ausfallzeit abgezogen", len(live), len(stale), down)

    def touch(self) -> None:
        """Lebenszeichen auf der Platte -- gerufen aus jeder Anfrage, auch aus
        dem Healthcheck (siehe _require_login).

        Sie beantwortet beim naechsten Hochfahren genau eine Frage: wie lange
        war der Server weg? Diese Zeit sass niemand vor dem Schirm, sie darf
        also in keiner Messung stehen. Um bis zu SEEN_EVERY_S faellt die
        Antwort zu gross aus -- lieber ein paar Sekunden zu wenig gutschreiben
        als eine fremde Minute zu viel.
        """
        if not self._path:
            return
        now = time.monotonic()
        with self._lock:
            if now - self._seen_mono < self.SEEN_EVERY_S:
                return
            self._seen_mono = now
        self._write('INSERT INTO server_seen (id, seen) VALUES (1, ?) '
                    'ON CONFLICT(id) DO UPDATE SET seen = excluded.seen', (time.time(),))

    # ── Messung ───────────────────────────────────────────────────────────

    def _sweep(self, now: float) -> list:
        gone = [k for k, v in self._runs.items() if v['t0'] <= now - self.TTL_S]
        for key in gone:
            self._runs.pop(key, None)
        while len(self._runs) > self.MAX_OPEN:
            key = min(self._runs, key=lambda k: self._runs[k]['t0'])
            self._runs.pop(key, None)
            gone.append(key)
        return gone

    def open(self, account: str, reactor: str, scenario, start_sim: float) -> str:
        """@return die Kennung, die der Client beim Beenden zurueckgibt."""
        token = secrets.token_urlsafe(12)
        now, wall = time.monotonic(), time.time()
        with self._lock:
            gone = self._sweep(now)
            self._runs[(account, token)] = {
                't0': now, 'reactor': reactor, 'scenario': scenario,
                'start_sim': float(start_sim), 'skip_s': 0.0}
        for _acct, tok in gone:
            self._write('DELETE FROM open_runs WHERE token = ?', (tok,))
        self._write('INSERT OR REPLACE INTO open_runs '
                    '(token, account, reactor, scenario, start_sim, skip_s, t0, lost_s) '
                    'VALUES (?, ?, ?, ?, ?, 0, ?, 0)',
                    (token, account, reactor, scenario, float(start_sim), wall))
        return token

    def add_skip(self, account: str, token, seconds: float,
                 cap_total: float) -> float | None:
        """Einen Xenon-Zeitsprung zu einem offenen Lauf anmelden.

        @return die neue Summe, oder None wenn es diesen Lauf nicht gibt oder
        er kein freies Spiel ist. Ob er eines ist, sagt der hier hinterlegte
        Eintrag -- nicht die Anfrage: den Knopf gibt es nur im freien Spiel
        (main.js fastForwardXenon()), und ein Szenario darf sich auf diesem
        Weg keine Extrazeit erschreiben.
        """
        if not isinstance(token, str) or not token:
            return None
        with self._lock:
            entry = self._runs.get((account, token))
            if entry is None or entry['scenario'] is not None:
                return None
            entry['skip_s'] = min(entry['skip_s'] + max(0.0, float(seconds)), cap_total)
            total = entry['skip_s']
        self._write('UPDATE open_runs SET skip_s = ? WHERE token = ?', (total, token))
        return total

    def close(self, account: str, token) -> dict | None:
        """@return {'wall_s', 'reactor', 'scenario', 'start_sim', 'skip_s'}
        oder None.

        Das Konto gehoert mit in den Schluessel: sonst koennte eine fremde
        Kennung die Messung eines anderen Spielers einsammeln.
        """
        if not isinstance(token, str) or not token:
            return None
        with self._lock:
            entry = self._runs.pop((account, token), None)
        if entry is None:
            return None
        self._write('DELETE FROM open_runs WHERE token = ?', (token,))
        return {'wall_s': max(0.0, time.monotonic() - entry['t0']),
                'reactor': entry['reactor'], 'scenario': entry['scenario'],
                'start_sim': entry['start_sim'], 'skip_s': entry['skip_s']}


class MonitorRelay:
    """Ein Bild des laufenden Leitstands, je Konto, nur im Arbeitsspeicher.

    Die Simulation laeuft im Browser (siehe static/js/loop.js). Wer sie auf
    einem zweiten Bildschirm oder einem Tablet MITSEHEN will, braucht deshalb
    eine Stelle, an der der Leitstand ablegt und der Monitor abholt -- mehr
    macht diese Klasse nicht.

    Bewusst NICHT auf der Platte, anders als Spielstand, Konten und
    Zeitmessung: ein Monitorbild ist in einer halben Sekunde veraltet. Es zu
    speichern hiesse, zweimal je Sekunde und Spieler zu schreiben, um etwas
    aufzubewahren, das nie wieder jemand sehen will. Ein Neustart des
    Containers kostet genau ein Bild; der naechste Sendetakt fuellt es wieder.
    """

    #: Nach so langer Stille gilt ein Eintrag als tot und faellt weg. Der
    #: Monitor sagt "keine Verbindung" schon viel frueher (zehn Sekunden,
    #: siehe monitor.js) -- diese Grenze raeumt nur den Speicher auf.
    TTL_S = 300.0
    #: Deckel je Bild. Gemessen liegt ein Bild bei 4-8 kB; alles darueber ist
    #: kein Leitstand mehr, sondern ein Fehler oder ein Versuch, den Speicher
    #: des Servers als Ablage zu benutzen.
    MAX_BYTES = 64 * 1024
    #: Deckel ueber alle Konten. Bei 64 kB sind das hoechstens 16 MB, und
    #: mehr als so viele Spieler gleichzeitig hat diese Anlage nicht.
    MAX_ACCOUNTS = 256

    def __init__(self):
        self._frames: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _sweep(self, now: float) -> None:
        dead = [k for k, (ts, _) in self._frames.items() if now - ts > self.TTL_S]
        for key in dead:
            self._frames.pop(key, None)
        while len(self._frames) > self.MAX_ACCOUNTS:
            oldest = min(self._frames, key=lambda k: self._frames[k][0])
            self._frames.pop(oldest, None)

    def put(self, account: str, frame: dict) -> None:
        now = time.monotonic()
        with self._lock:
            # Erst ablegen, dann aufraeumen. Andersherum stuenden nach dem
            # Aufraeumen MAX_ACCOUNTS + 1 Eintraege da -- der Deckel waere um
            # genau eins zu hoch, und zwar dauerhaft.
            self._frames[account] = (now, frame)
            self._sweep(now)

    def get(self, account: str) -> tuple[float, dict] | None:
        """@return (Alter in Sekunden, Bild) oder None.

        Das Alter kommt von HIER, nicht aus dem Bild selbst: Leitstand und
        Monitor stehen oft auf verschiedenen Geraeten, und eine falsch gehende
        Uhr auf einem davon wuerde sonst ein frisches Bild als tot melden oder
        ein totes als frisch. Der Server ist die einzige Uhr, die beide sehen.
        """
        with self._lock:
            entry = self._frames.get(account)
        if entry is None:
            return None
        ts, frame = entry
        return max(0.0, time.monotonic() - ts), frame


STORE = persist.Store(_DATA)
LIMITS = persist.RateLimit()
RUNS = OpenRuns(_DATA)
MONITOR = MonitorRelay()
USERS = usersmod.UserStore(_DATA)
AUTH = authmod.Auth(_DATA, REACTORSIM_USER, REACTORSIM_PASSWORD, USERS)
# Konfiguration aus der Umgebung, also aus Dockge -- genau wie das
# Admin-Konto darueber. Ohne gesetzten Server bleibt alles beim Alten: das
# Panel zeigt erzeugte Passwoerter einmalig an, "Passwort vergessen" ist
# ausgeblendet. Siehe mailer.py.
MAIL = mailermod.Mailer.from_env()
if MAIL.configured:
    log.info('Mailversand ueber %s:%s (%s), Absender %s',
             MAIL.host, MAIL.port, MAIL.security, MAIL.sender)
else:
    log.info('Kein Mailserver gesetzt -- keine Willkommens-Mails, '
             'kein "Passwort vergessen". REACTORSIM_SMTP_HOST setzt ihn.')

PLAYER_COOKIE = 'rs_player'

# Was ohne Anmeldung erreichbar bleibt. /health muss offen sein, sonst meldet
# der Healthcheck den Container als krank; die Anmeldeseite selbst kann nicht
# hinter der Anmeldung liegen; /set-lang stellt nur ein Cookie und existiert
# auch auf der Anmeldeseite. /forgot und /reset MUESSEN offen
# sein: wer sein Passwort vergessen hat, kommt per Definition nicht an der
# Anmeldung vorbei. Beide sind deshalb gesondert ratenbegrenzt (siehe dort).
_PUBLIC_ENDPOINTS = frozenset({'health', 'login', 'set_lang', 'forgot', 'reset'})

# Was eine MITLESENDE Sitzung darf, und das ist alles (siehe Auth.issue()).
# Sie ist der Zugang des Zweitschirms: sie soll das Bild des Leitstands
# sehen und sonst nichts anfassen -- kein Spielstand, keine Einstellung,
# kein Hochladen eines eigenen Bildes. Deshalb eine Liste dessen, was geht,
# und nicht eine Liste dessen, was nicht geht: eine neue Route ist damit
# von sich aus gesperrt und nicht von sich aus offen.
_MONITOR_ENDPOINTS = frozenset({
    'monitor_page', 'monitor_get', 'vstatic', 'logout',
    # Lesend, nicht schreibend: der Zweitschirm baut seine Kopfzeile aus der
    # Kachelauswahl des Kontos (siehe api.readPrefs() in monitor.js). Ohne
    # sie stuenden dort andere Kacheln als drueben, und ein Schirm, der etwas
    # anderes zeigt als der Leitstand, ist als Mitleser wertlos.
    # prefs_write ist eine eigene Route und bleibt gesperrt.
    'prefs_read',
})

# Nur der Admin darf hier hinein, ein Spieler nie -- siehe _require_login().
_ADMIN_ENDPOINTS = frozenset({
    'admin_panel', 'admin_create_user', 'admin_lock_user',
    'admin_unlock_user', 'admin_reset_password', 'admin_user_detail',
    'admin_test_mail', 'admin_delete_user',
})


@app.before_request
def _require_login():
    # Lebenszeichen fuer die Zeitmessung (siehe OpenRuns.touch): hier oben,
    # vor jeder Zugangspruefung, damit auch der Healthcheck des Containers
    # die Marke erneuert -- er ist die einzige Anfrage, die selbst dann noch
    # kommt, wenn gerade niemand spielt.
    RUNS.touch()
    if request.endpoint in _PUBLIC_ENDPOINTS:
        return None
    user, role = AUTH.resolve(request.cookies.get(authmod.SESSION_COOKIE))
    if user and not AUTH.is_admin(user):
        # Eine Sitzung kann laenger gueltig sein als das Konto aktiv ist --
        # eine Sperre soll sofort wirken, nicht erst nach Ablauf des Cookies.
        row = USERS.find_for_login(user)
        if row is None or row['status'] != usersmod.STATUS_ACTIVE:
            AUTH.revoke(user)
            user = None
    if user:
        g.user = user
        g.is_admin = AUTH.is_admin(user)
        g.monitor_only = role == authmod.ROLE_MONITOR
        # Abmelden geht immer, unabhaengig von der Rolle -- sonst kaeme der
        # Admin nie am eigenen logout()-View vorbei (er faellt in KEINER der
        # beiden Rollenpruefungen unten durch, _ADMIN_ENDPOINTS ist nur fuer
        # die Verwaltungsrouten gedacht).
        if request.endpoint == 'logout':
            return None
        # Mitlesende Sitzung: nur der Zweitschirm. Vor der Admin-Pruefung,
        # damit ein Mitleser nicht ueber den Umweg "ist kein Admin" in
        # Spielrouten faellt.
        if g.monitor_only:
            if request.endpoint in _MONITOR_ENDPOINTS:
                return None
            if request.path.startswith('/api/'):
                return jsonify({'error': 'monitor_only'}), 403
            return redirect('/monitor')
        # Rollentrennung: der Admin spielt nicht, ein Spieler verwaltet nicht.
        if g.is_admin:
            if request.endpoint not in _ADMIN_ENDPOINTS:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'forbidden'}), 403
                return redirect('/admin')
        elif request.endpoint in _ADMIN_ENDPOINTS:
            abort(403)
        return None
    # Anfragen aus dem Spiel heraus bekommen eine Zahl, keine Anmeldeseite --
    # sonst landete HTML im JSON-Parser und der Fehler waere unlesbar.
    if request.path.startswith('/api/'):
        return jsonify({'error': 'unauthorized'}), 401
    return redirect('/login?next=' + quote(authmod.safe_next(request.full_path.rstrip('?')), safe=''))


@app.route('/login', methods=['GET', 'POST'])
def login():
    lang = detect_language(request)
    t = load_translations(lang)
    nxt = authmod.safe_next(request.values.get('next'))
    error = None

    if request.method == 'POST':
        # Gegen Durchprobieren: zehn Versuche je Minute und Absenderadresse.
        addr = _client_ip()
        raw_user = (request.form.get('user') or '').strip()
        # Spieler melden sich mit ihrer E-Mail-Adresse an (Gross-/
        # Kleinschreibung ist dort ohnehin gleichwertig); der Admin-Name
        # bleibt exakt wie in der Konfiguration.
        uname = raw_user if raw_user == AUTH.user else usersmod.normalize_email(raw_user)
        if not LIMITS.hit(f'login:{addr}', 10, 60):
            error = 'login_rate_limited'
        elif not AUTH.csrf_ok(request.form.get('csrf')):
            # Abgelaufenes Formular -- kein Angriff, nur eine alte Seite.
            error = 'login_expired'
        elif AUTH.check(uname, request.form.get('password', '')):
            is_admin = AUTH.is_admin(uname)
            if not is_admin:
                row = USERS.find_for_login(uname)
                if row:
                    USERS.record_login(row['id'], addr)
            # Mitlesen gilt nur fuer Spielerkonten: der Admin spielt
            # ohnehin nicht und hat keinen Leitstand, den er mitlesen
            # koennte.
            watch = bool(request.form.get('monitor')) and not is_admin
            resp = make_response(redirect(
                '/admin' if is_admin else ('/monitor' if watch else nxt)))
            resp.set_cookie(authmod.SESSION_COOKIE, AUTH.issue(uname, monitor=watch),
                            max_age=authmod.SESSION_MAX_AGE, httponly=True,
                            samesite='Lax', secure=request.is_secure)
            return resp
        else:
            error = 'login_failed'

    resp = make_response(render_template(
        'login.html', t=t, lang=lang, app_version=APP_VERSION,
        csrf=AUTH.csrf_token(), next_url=nxt, error=error,
        # Ohne Mailserver gibt es keinen Weg, einen Link zuzustellen -- dann
        # bleibt der Hinweis weg, statt auf ein Formular zu zeigen, das nichts
        # tun kann (der Admin setzt das Passwort dann wie bisher im Panel).
        can_reset=MAIL.configured,
        monitor_checked=bool(request.form.get('monitor')) if request.method == 'POST' else False,
        prefill=request.form.get('user', '') if request.method == 'POST' else ''))
    resp.headers['Cache-Control'] = 'no-store'
    return resp, (401 if error else 200)


@app.route('/logout', methods=['GET', 'POST'])
def logout():
    # Sitzungskennung mitentwerten, nicht nur das Cookie loeschen -- sonst
    # wirkt ein Cookie, das anderswo noch im Browser laege, bis es abgelaufen
    # ist. NUR die eigene Sitzung (siehe Auth.revoke_session()): seit 0.6.24
    # kann daneben ein Zweitschirm haengen, und der Leitstand soll nicht
    # ausgehen, weil am Tablet jemand auf "abmelden" tippt.
    AUTH.revoke_session(request.cookies.get(authmod.SESSION_COOKIE))
    resp = make_response(redirect('/login'))
    resp.delete_cookie(authmod.SESSION_COOKIE)
    return resp


# ── Mail ──────────────────────────────────────────────────────────────────────


def _public_url(path: str = '/') -> str:
    """Absolute Adresse fuer einen Link in einer Mail.

    Eine Mail wird gelesen, wenn von der Anfrage laengst nichts mehr da ist --
    ein relativer Pfad waere darin wertlos. REACTORSIM_PUBLIC_URL gewinnt, weil
    nur der Betreiber weiss, unter welchem Namen die Anlage veroeffentlicht
    ist; sonst die Adresse der laufenden Anfrage.
    """
    base = REACTORSIM_PUBLIC_URL or request.url_root.rstrip('/')
    return base + path


def _mail_text(t: dict, key: str, **kw) -> str:
    """Mailtext aus der Sprachdatei. Wie jeder andere Text der Seite -- eine
    Mail ist kein Grund, Deutsch fest zu verdrahten."""
    return t.get(key, key).format(**kw)


def _send_mail(t: dict, to: str, subject_key: str, body_key: str, **kw) -> str | None:
    """@return None bei Erfolg, sonst der Grund fuer die Anzeige im Panel."""
    return MAIL.send(to, _mail_text(t, subject_key), _mail_text(t, body_key, **kw))


# ── Passwort vergessen ────────────────────────────────────────────────────────
#
# Zwei offene Seiten, sonst waere der Ablauf sinnlos: wer sein Passwort
# vergessen hat, kommt nicht an der Anmeldung vorbei.
#
# Beide verraten NICHTS ueber den Kontobestand. /forgot antwortet immer
# gleich -- ob es die Adresse gibt, ob das Konto gesperrt ist, ob die Mail
# ankam. Deshalb geht der Versand auch in einen Hintergrund-Thread
# (Mailer.send_async): sonst wuerde schon die Antwortzeit verraten, ob
# ueberhaupt etwas zu verschicken war.

_FORGOT_PER_IP = 5          # je Stunde
_FORGOT_PER_EMAIL = 3       # je Stunde -- gegen das Zumuellen eines Postfachs
_RESET_PER_IP = 20          # je Stunde; Tokens raten ist damit chancenlos


@app.route('/forgot', methods=['GET', 'POST'])
def forgot():
    lang = detect_language(request)
    t = load_translations(lang)
    error = None
    done = False

    if not MAIL.configured:
        # Ohne Mailserver gibt es keinen Zustellweg. Die Seite sagt das offen,
        # statt ein Formular zu zeigen, das nichts bewirken kann.
        return _render_auth_page('forgot.html', t, lang, error='forgot_mail_off', status=404)

    if request.method == 'POST':
        addr = _client_ip()
        email = usersmod.normalize_email(request.form.get('email', ''))
        if not LIMITS.hit(f'forgot:a:{addr}', _FORGOT_PER_IP, 3600):
            error = 'forgot_rate_limited'
        elif not AUTH.csrf_ok(request.form.get('csrf'), 'forgot'):
            error = 'forgot_expired'
        elif not LIMITS.hit(f'forgot:e:{email}', _FORGOT_PER_EMAIL, 3600):
            # Auch das darf nichts verraten: dieselbe Antwort wie im Erfolgsfall.
            done = True
        else:
            USERS.purge_expired_resets()
            found = USERS.create_reset_token(email)
            if found:
                token, account = found
                link = _public_url('/reset?token=' + quote(token, safe=''))
                MAIL.send_async(
                    account['email'], _mail_text(t, 'mail_reset_subject'),
                    _mail_text(t, 'mail_reset_body', url=link,
                               hours=usersmod.RESET_TTL_S // 3600))
            else:
                log.info('Passwort-vergessen fuer unbekannte oder gesperrte '
                         'Adresse -- keine Mail verschickt')
            done = True

    status = 200 if not error else (429 if error == 'forgot_rate_limited' else 400)
    return _render_auth_page('forgot.html', t, lang, error=error, done=done,
                             status=status, csrf_scope='forgot')


@app.route('/reset', methods=['GET', 'POST'])
def reset():
    lang = detect_language(request)
    t = load_translations(lang)
    token = (request.values.get('token') or '').strip()
    addr = _client_ip()

    if not LIMITS.hit(f'reset:a:{addr}', _RESET_PER_IP, 3600):
        return _render_auth_page('reset.html', t, lang, error='reset_rate_limited',
                                 status=429)

    account = USERS.peek_reset_token(token) if token else None
    if account is None:
        return _render_auth_page('reset.html', t, lang, error='reset_error_bad_token',
                                 status=400)

    if request.method == 'POST':
        password = request.form.get('password', '')
        repeat = request.form.get('password2', '')
        if not AUTH.csrf_ok(request.form.get('csrf'), 'reset'):
            error = 'reset_expired'
        elif password != repeat:
            error = 'reset_error_mismatch'
        else:
            email, why = USERS.consume_reset_token(token, password)
            if why:
                error = 'reset_error_' + why
            else:
                # Ein neues Passwort beendet jede noch laufende Sitzung des
                # Kontos -- sonst bliebe genau das Geraet angemeldet, wegen
                # dem man das Passwort vielleicht gerade wechselt.
                AUTH.revoke(email)
                log.info('Passwort ueber Reset-Link neu gesetzt')
                return _render_auth_page('reset.html', t, lang, done=True)
        return _render_auth_page('reset.html', t, lang, error=error, token=token,
                                 email=account['email'], status=400, csrf_scope='reset')

    return _render_auth_page('reset.html', t, lang, token=token,
                             email=account['email'], csrf_scope='reset')


def _render_auth_page(template: str, t: dict, lang: str, status: int = 200,
                      csrf_scope: str = 'login', **extra):
    """Die kleinen offenen Seiten neben der Anmeldung. `no-store`, weil auf
    ihnen ein Einmal-Token steht, das kein Zwischenspeicher aufbewahren soll."""
    ctx = {'t': t, 'lang': lang, 'app_version': APP_VERSION,
           'csrf': AUTH.csrf_token(csrf_scope),
           'error': None, 'done': False, 'token': '', 'email': ''}
    ctx.update(extra)
    resp = make_response(render_template(template, **ctx), status)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


# ── i18n ──────────────────────────────────────────────────────────────────────

_LANGS = ('de', 'en')
_translations: dict[str, dict] = {}


_LOCALE_FILES = {'de': 'de.json', 'en': 'en.json'}


def load_translations(lang: str) -> dict:
    """Uebersetzungen liegen fest im Image, also einmal lesen und behalten.

    Der Dateiname kommt aus `_LOCALE_FILES`, einem festen Literal je Sprache --
    `lang` selbst geht nie in den Pfad ein, egal was hereinkommt."""
    lang = lang if lang in _LANGS else 'en'
    cached = _translations.get(lang)
    if cached is not None:
        return cached
    filename = _LOCALE_FILES.get(lang, 'en.json')
    try:
        with open(os.path.join(LOCALES_PATH, filename), 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError) as exc:
        log.error("Sprachdatei %s.json nicht lesbar: %s", lang, exc.__class__.__name__)
        data = {}
    _translations[lang] = data
    return data


def detect_language(req) -> str:
    lang = req.cookies.get('lang')
    if lang in _LANGS:
        return lang
    accept = (req.headers.get('Accept-Language') or '').lower()
    return 'de' if accept.startswith('de') else 'en'


# ── Szenarien ─────────────────────────────────────────────────────────────────
# Die Dateien liegen fest im Image. Einmal beim Start einlesen -- das ergibt
# zugleich die Whitelist gueltiger Szenariokennungen fuer die spaetere
# Bestenliste: nur was hier steht, darf ein Client als Szenario nennen.

def _load_scenarios() -> list:
    out = []
    try:
        names = sorted(os.listdir(SCENARIO_PATH))
    except OSError:
        return out
    for name in names:
        if not name.endswith('.json'):
            continue
        try:
            with open(os.path.join(SCENARIO_PATH, name), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError) as exc:
            log.error("Szenario %s nicht lesbar: %s", name, exc.__class__.__name__)
            continue
        if not isinstance(data, dict) or not data.get('id'):
            continue
        out.append({
            'id': data['id'],
            'file': name,
            'reactor': data.get('reactor'),
            'difficulty': data.get('difficulty', 1),
            'title_key': data.get('title_key'),
            'brief_key': data.get('brief_key'),
            'duration_s': data.get('duration_s', 0),
            'tutorial': data.get('tutorial'),
            'guidance': data.get('guidance'),
            'score_mode': data.get('score_mode'),
            'objectives': data.get('objectives'),
        })
    return out


SCENARIOS = _load_scenarios()
SCENARIO_IDS = frozenset(s['id'] for s in SCENARIOS)
SCENARIO_BY_ID = {s['id']: s for s in SCENARIOS}

# Nennleistung je Reaktortyp. Sie begrenzt, wie viel Energie ein Lauf
# ueberhaupt geliefert haben kann -- ohne diese Obergrenze waere die
# Plausibilitaetspruefung der Bestenliste zahnlos.
REACTOR_P0 = {'pwr': 1400.0, 'bwr': 1344.0, 'rbmk': 1000.0}


@app.route('/api/meta')
def meta():
    return jsonify({
        'version': APP_VERSION,
        'scenarios': SCENARIOS,
    })


# ── Spielerkennung ────────────────────────────────────────────────────────────
#
# Spielstaende und Einstellungen gehoeren dem angemeldeten Konto (g.user,
# gesetzt in _require_login), nicht mehr einem anonymen Geraete-Cookie -- wer
# hier ankommt, hat sich bereits angemeldet, sonst waere die Anfrage in
# _require_login abgewiesen worden. PLAYER_COOKIE lebt nur noch als
# Lesezugriff auf alte Browser-Cookies aus der Zeit vor Konten weiter, fuer
# die einmalige Uebernahme in Store.migrate_legacy().


def _account_id() -> str:
    if 'account' not in g:
        g.account = STORE.account_key(g.user)
        STORE.migrate_legacy(g.account, request.cookies.get(PLAYER_COOKIE))
    return g.account


def _current_player_row() -> dict | None:
    """Der Datensatz aus users.py fuer das angemeldete Spielerkonto, oder
    None fuer den Admin (der hat keinen). Fuer Login-/Spielprotokoll."""
    if 'player_row' not in g:
        g.player_row = None if g.is_admin else USERS.find_for_login(g.user)
    return g.player_row


# ── Admin-Panel ───────────────────────────────────────────────────────────────
#
# Nur der Admin erreicht diese Routen (siehe _require_login) -- er legt
# Spielerkonten an, sperrt sie bei Bedarf und setzt Passwoerter zurueck. Er
# sieht hier auch, wer sich wann von welcher Adresse angemeldet und was er
# gespielt hat.

_ADMIN_LIST_LIMIT = 50
# Die Kontoseite zeigt die Historie eines einzelnen Spielers -- da darf eine
# Seite mehr fassen als in der Uebersicht, aber nicht unbegrenzt: sie wird am
# Stueck gerendert und soll auch nach tausend Laeufen noch aufgehen.
_ADMIN_DETAIL_LIMIT = 200


# Weit hinter jedem denkbaren Bestand, und weit vor der Grenze, die SQLite
# fuer einen OFFSET noch annimmt.
_MAX_PAGE = 1_000_000


def _page_offset(param: str, limit: int) -> int:
    """Seitennummer aus der Adresse in einen Zeilenversatz umrechnen.

    Alles Unsinnige faellt auf Seite 1 zurueck -- ein Tippfehler in der Adresse
    soll eine Seite zeigen, keinen Fehler. Eine Seitennummer hinter dem Ende
    ergibt eine leere Seite, und die Blaetterleiste zeigt, wo es wirklich
    aufhoert; nach oben gedeckelt wird trotzdem, weil SQLite einen OFFSET
    jenseits von 64 Bit nicht annimmt und eine absurd grosse Zahl in der
    Adresse sonst eine Ausnahme statt einer leeren Seite ergaebe.
    """
    try:
        page = int(request.args.get(param, 1))
    except (TypeError, ValueError):
        page = 1
    return max(0, (min(max(1, page), _MAX_PAGE) - 1) * limit)


def _render_admin(status: int = 200, **extra):
    lang = detect_language(request)
    ctx = {
        't': load_translations(lang), 'lang': lang, 'app_version': APP_VERSION,
        'users': USERS.list_users(),
        'logins': USERS.recent_login_events(
            _ADMIN_LIST_LIMIT, _page_offset('logins', _ADMIN_LIST_LIMIT)),
        'sessions': USERS.recent_play_sessions(
            _ADMIN_LIST_LIMIT, _page_offset('runs', _ADMIN_LIST_LIMIT)),
        # Die Blaetterleiste haengt an der Adresse, und nach einer Aktion
        # (anlegen, sperren, loeschen) antwortet dieselbe Ansicht auf ein
        # POST -- dann steht in der Adresse keine Seitennummer, und beide
        # Listen stehen wieder auf Seite 1. Genau richtig: nach einer
        # Aenderung ist die neueste Zeile die interessante.
        'logins_param': 'logins', 'runs_param': 'runs', 'page_base': '/admin',
        'csrf': AUTH.csrf_token('admin'),
        'mail': MAIL.status(),
        'created': None, 'reset_password': None, 'error': None,
        'mail_result': None, 'deleted': None,
    }
    ctx.update(extra)
    resp = make_response(render_template('admin.html', **ctx), status)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


def _admin_csrf_ok() -> bool:
    return AUTH.csrf_ok(request.form.get('csrf'), 'admin')


def _mail_credentials(subject_key: str, body_key: str, email: str, password: str):
    """Zugangsdaten an ein Spielerkonto schicken (Willkommen bzw. neues
    Passwort). @return das Ergebnis-Dict fuer das Banner, oder None, wenn gar
    nicht verschickt werden sollte.

    Das Passwort steht im Klartext in der Mail. Das ist bewusst so und hier
    auch kein Geheimnisverlust gegenueber vorher: dieselbe Zeichenkette stand
    bisher im Panel und wurde von Hand weitergereicht -- per Zuruf, Chat oder
    Zettel. Der Weg ueber das Postfach des Spielers ist davon nicht der
    schlechteste. Das Panel zeigt das Passwort ZUSAETZLICH weiterhin einmalig
    an, damit ein fehlgeschlagener Versand das Konto nicht unbrauchbar macht.
    """
    if not MAIL.configured:
        return None
    t = load_translations(detect_language(request))
    err = _send_mail(t, email, subject_key, body_key,
                     url=_public_url('/'), email=email, password=password)
    return {'email': email, 'error': err}


@app.route('/admin', methods=['GET'])
def admin_panel():
    return _render_admin()


@app.route('/admin/users', methods=['POST'])
def admin_create_user():
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    password = request.form.get('password') or None
    user, err = USERS.create_user(request.form.get('email', ''), password,
                                  created_by=g.user)
    if err:
        return _render_admin(400, error=err)
    # Die Willkommens-Mail ist eine Kreuzchen-Entscheidung im Formular, keine
    # Automatik: wer zehn Konten fuer einen Kurs anlegt und die Zugaenge
    # ausdruckt, will sie nicht.
    mail_result = None
    if request.form.get('welcome'):
        mail_result = _mail_credentials(
            'mail_welcome_subject', 'mail_welcome_body',
            user['email'], user.get('generated_password') or password or '')
    return _render_admin(created=user, mail_result=mail_result)


@app.route('/admin/users/<user_id>', methods=['GET'])
def admin_user_detail(user_id: str):
    """Kontoseite: alles zu EINEM Spieler an einem Ort.

    Die Uebersicht zeigt je Konto nur eine Zeile und daneben die letzten 50
    Ereignisse aller Spieler gemischt -- die Frage "was hat dieser eine
    eigentlich gespielt?" liess sich damit nicht beantworten.
    """
    row = USERS.get_by_id(user_id)
    if row is None:
        return _render_admin(404, error='not_found')
    lang = detect_language(request)
    resp = make_response(render_template(
        'admin_user.html', t=load_translations(lang), lang=lang,
        app_version=APP_VERSION, csrf=AUTH.csrf_token('admin'), account=row,
        stats=USERS.user_stats(user_id),
        breakdown=USERS.scenario_breakdown(user_id),
        sessions=USERS.user_play_sessions(
            user_id, _ADMIN_DETAIL_LIMIT, _page_offset('runs', _ADMIN_DETAIL_LIMIT)),
        logins=USERS.user_login_events(
            user_id, _ADMIN_DETAIL_LIMIT, _page_offset('logins', _ADMIN_DETAIL_LIMIT)),
        logins_param='logins', runs_param='runs',
        page_base='/admin/users/' + quote(user_id, safe='')))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/admin/mail/test', methods=['POST'])
def admin_test_mail():
    """Eine Testmail, bevor das erste echte Konto darauf angewiesen ist.

    Ohne sie faellt ein Tippfehler im Hostnamen erst auf, wenn ein Spieler
    auf einen Link wartet, der nie kam -- und der Admin sieht davon nichts.
    """
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    if not MAIL.configured:
        return _render_admin(400, error='mail_not_configured')
    to = (request.form.get('to') or '').strip()
    t = load_translations(detect_language(request))
    err = _send_mail(t, to, 'mail_test_subject', 'mail_test_body', url=_public_url('/'))
    return _render_admin(200 if err is None else 400,
                         mail_result={'email': to, 'error': err})


@app.route('/admin/users/<user_id>/lock', methods=['POST'])
def admin_lock_user(user_id: str):
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    ok = USERS.set_status(user_id, usersmod.STATUS_LOCKED)
    return _render_admin() if ok else _render_admin(404, error='not_found')


@app.route('/admin/users/<user_id>/unlock', methods=['POST'])
def admin_unlock_user(user_id: str):
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    ok = USERS.set_status(user_id, usersmod.STATUS_ACTIVE)
    return _render_admin() if ok else _render_admin(404, error='not_found')


@app.route('/admin/users/<user_id>/delete', methods=['POST'])
def admin_delete_user(user_id: str):
    """Konto endgueltig entfernen -- Gegenstueck zum Sperren, nicht dessen
    Steigerung.

    Sperren ist das Mittel der Wahl: reversibel, Historie bleibt. Loeschen ist
    fuer den anderen Fall da, in dem jemand aus der Datei verschwinden soll --
    und weil die Historie je Konto seit 0.6.0 deutlich laenger ist, ist das
    kein Randfall mehr.

    Zwei Sicherungen, weil es keinen Rueckweg gibt:

    * Die E-Mail-Adresse muss abgetippt werden. Ein Klick daneben in einer
      Kontoliste ist zu leicht, und beide Knoepfe stehen in derselben Zeile.
    * Es geht nur von der Kontoseite aus (dort steht ein Konto allein auf dem
      Schirm), nicht aus der Zeile in der Uebersicht.

    Mitgeloescht wird alles, was an dem Konto haengt: Historie und Protokolle
    (users.py delete_user), die Spielstaende als Dateien, und die laufende
    Sitzung -- sonst spielte ein noch offener Browser munter weiter und
    schriebe Spielstaende in einen Ordner, zu dem es kein Konto mehr gibt.
    """
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    row = USERS.get_by_id(user_id)
    if row is None:
        return _render_admin(404, error='not_found')
    typed = usersmod.normalize_email(request.form.get('confirm_email', ''))
    if typed != row['email']:
        return _render_admin(400, error='delete_not_confirmed')
    email = row['email']
    AUTH.revoke(email)
    STORE.delete_account(STORE.account_key(email))
    deleted = USERS.delete_user(user_id)
    if deleted is None:
        return _render_admin(404, error='not_found')
    log.info('Spielerkonto geloescht, samt Historie und Spielstaenden')
    return _render_admin(deleted={'email': email})


@app.route('/admin/users/<user_id>/reset-password', methods=['POST'])
def admin_reset_password(user_id: str):
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    new_password, err = USERS.reset_password(user_id)
    if err:
        return _render_admin(404, error=err)
    row = USERS.get_by_id(user_id)
    # Backlog "Passwort-Reset Phase 2": steht ein Mailserver bereit, geht das
    # neue Passwort direkt an den Spieler, statt vom Admin von Hand
    # weitergereicht zu werden. Angezeigt wird es trotzdem noch einmal --
    # siehe _mail_credentials().
    mail_result = _mail_credentials('mail_newpass_subject', 'mail_newpass_body',
                                    row['email'], new_password)
    return _render_admin(reset_password={'email': row['email'], 'password': new_password},
                         mail_result=mail_result)


@app.template_filter('fmt_time')
def _fmt_time(ts):
    if not ts:
        return '\u2013'
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')


@app.template_filter('fmt_duration')
def _fmt_duration(seconds):
    if not seconds:
        return '\u2013'
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


# ── Sicherheits-Kopfzeilen ────────────────────────────────────────────────────
#
# Die Seite laedt ausschliesslich eigene Dateien: kein fremdes CDN, keine
# eingebettete Schrift, kein Zaehlpixel. Die Richtlinie darf deshalb streng
# sein -- 'self' und sonst nichts.
#
# Zwei Inline-Bloecke gibt es trotzdem, beide aus gutem Grund: die
# Uebersetzungstabelle in index.html (als Datei waere sie ein zweiter
# Rundlauf fuer etwas, das ohnehin zur Seite gehoert) und das vollstaendige
# CSS in login.html (die Anmeldeseite darf keine Datei nachladen, die hinter
# derselben Anmeldung liegt). Beide bekommen eine Nonce je Antwort statt
# 'unsafe-inline' -- sonst waere jedes eingeschleuste <script> mit erlaubt,
# und die Richtlinie haette gegen genau den Fall nichts mehr zu sagen.
#
# `frame-ancestors 'none'` ist der Grund fuer den ganzen Block: ohne ihn
# laesst sich das Anmeldeformular in einen fremden Rahmen setzen, und der
# Dienst haengt auf einem offenen LAN-Port.

_STATIC_HEADERS = {
    # Aelteren Browsern, die frame-ancestors noch nicht kennen, dasselbe sagen.
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    # Nichts davon braucht das Spiel, und was nicht gebraucht wird, bleibt zu.
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
}


def _csp_nonce() -> str:
    """Eine Nonce je Antwort. Wiederverwendung ueber Antworten hinweg waere
    dasselbe wie keine."""
    if 'csp_nonce' not in g:
        g.csp_nonce = secrets.token_urlsafe(16)
    return g.csp_nonce


@app.context_processor
def _inject_nonce():
    """`csp_nonce` steht damit in jedem Template, ohne dass jeder
    render_template()-Aufruf sie durchreichen muss."""
    return {'csp_nonce': _csp_nonce}


@app.after_request
def _security_headers(resp):
    for key, value in _STATIC_HEADERS.items():
        resp.headers.setdefault(key, value)
    # Nur bauen, wenn die Antwort ueberhaupt eine Nonce gezogen hat -- fuer
    # eine JSON-Antwort oder eine Datei aus static/ gibt es nichts inline,
    # und eine Nonce ohne Traeger ist nur Rauschen im Kopf.
    nonce = f" 'nonce-{g.csp_nonce}'" if 'csp_nonce' in g else ''
    resp.headers.setdefault('Content-Security-Policy', (
        "default-src 'self'; img-src 'self' data:; media-src 'self'; "
        f"style-src 'self'{nonce}; script-src 'self'{nonce}; "
        "connect-src 'self'; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'"
    ))
    return resp


def _limited(bucket: str, limit: int, window_s: float) -> bool:
    """Ratenbegrenzung je Konto UND je Absenderadresse."""
    acct = _account_id()
    addr = _client_ip()
    return not (LIMITS.hit(f'{bucket}:p:{acct}', limit, window_s)
                and LIMITS.hit(f'{bucket}:a:{addr}', limit * 4, window_s))


# ── Spielstaende ──────────────────────────────────────────────────────────────


@app.route('/api/saves')
def saves_list():
    return jsonify({'saves': STORE.list_saves(_account_id())})


@app.route('/api/saves/<slot>', methods=['GET'])
def save_read(slot: str):
    blob = STORE.read_save(_account_id(), slot)
    if blob is None:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(blob)


@app.route('/api/saves/<slot>', methods=['PUT'])
def save_write(slot: str):
    # Only saves carry the full eight-hour binary trend history (Flask 3.1).
    request.max_content_length = persist.MAX_SAVE_BYTES
    if _limited('save', 30, 60):
        return jsonify({'error': 'rate_limited'}), 429
    if not persist.SLOT_RE.match(slot):
        return jsonify({'error': 'bad_slot'}), 400
    blob = request.get_json(silent=True)
    if not isinstance(blob, dict):
        return jsonify({'error': 'bad_body'}), 400
    reactor = blob.get('reactor')
    if reactor is not None and not isinstance(reactor, str):
        return jsonify({'error': 'bad_reactor'}), 400
    err = STORE.write_save(_account_id(), slot, blob)
    if err:
        return jsonify({'error': err}), 413 if err == 'too_large' else 400
    return jsonify({'ok': True})


@app.route('/api/saves/<slot>', methods=['DELETE'])
def save_delete(slot: str):
    if not persist.SLOT_RE.match(slot):
        return jsonify({'error': 'bad_slot'}), 400
    return jsonify({'ok': STORE.delete_save(_account_id(), slot)})


# ── Zweitbildschirm ───────────────────────────────────────────────────────────
#
# Undurchsichtig wie ein Spielstand: der Server reicht das Bild weiter, ohne
# seinen Inhalt zu kennen. Geprueft wird nur, was er selbst braucht -- dass es
# ueberhaupt ein Objekt ist und eine laufende Nummer traegt.
#
# Es gibt bewusst KEINEN Rueckweg. Der Monitor liest, mehr nicht; die Anlage
# laesst sich von dort nicht anfassen.


@app.route('/api/monitor', methods=['POST'])
def monitor_put():
    request.max_content_length = MonitorRelay.MAX_BYTES
    # Zwei Bilder je Sekunde sind der Normalfall (FRAME_INTERVAL_MS in
    # net/monitorLink.js); die Grenze laesst Sichtbarkeitswechsel und
    # Abschiedsbilder daneben Platz, ohne einen Dauerstrom zuzulassen.
    if _limited('monitor', 240, 60):
        return jsonify({'error': 'rate_limited'}), 429
    frame = request.get_json(silent=True)
    if not isinstance(frame, dict) or not isinstance(frame.get('seq'), int):
        return jsonify({'error': 'bad_body'}), 400
    MONITOR.put(_account_id(), frame)
    return jsonify({'ok': True})


@app.route('/api/monitor', methods=['GET'])
def monitor_get():
    entry = MONITOR.get(_account_id())
    if entry is None:
        # Kein Fehler, sondern eine Aussage: es spielt gerade niemand. Der
        # Monitor sagt das auch genau so, statt "keine Verbindung" zu zeigen.
        return jsonify({'ok': True, 'none': True})
    age, frame = entry
    # Steht das Bild still (Leitstand angehalten, Reiter im Hintergrund),
    # kommt nur das Alter zurueck. Der Monitor braucht dann nichts zu
    # zeichnen, und die Leitung traegt ein paar Dutzend Byte statt mehrerer
    # Kilobyte -- zweimal je Sekunde, ueber Stunden.
    try:
        seen = int(request.args.get('seq', 0))
    except ValueError:
        seen = 0
    if seen and seen == frame.get('seq'):
        return jsonify({'ok': True, 'age': age, 'same': True})
    return jsonify({'ok': True, 'age': age, 'frame': frame})


# ── Einstellungen ───────────────────────────────────────────────────────────────
#
# Undurchsichtig wie ein Spielstand (siehe persist.py): der Server speichert
# und gibt zurueck, ohne die Struktur zu kennen. Sie gehoert der Oberflaeche,
# z.B. welche Werte je Reaktortyp in der Kopfzeile stehen.


@app.route('/api/prefs', methods=['GET'])
def prefs_read():
    return jsonify(STORE.read_prefs(_account_id()))


@app.route('/api/prefs', methods=['PUT'])
def prefs_write():
    if _limited('prefs', 30, 60):
        return jsonify({'error': 'rate_limited'}), 429
    blob = request.get_json(silent=True)
    if not isinstance(blob, dict):
        return jsonify({'error': 'bad_body'}), 400
    err = STORE.write_prefs(_account_id(), blob)
    if err:
        return jsonify({'error': err}), 413 if err == 'too_large' else 400
    return jsonify({'ok': True})


# ── Eigenes Konto ─────────────────────────────────────────────────────────────
#
# Bis 0.6.0 konnte ein Spieler sein Passwort im laufenden Betrieb nicht selbst
# aendern: entweder setzte der Admin es im Panel zurueck, oder man ging ueber
# "Passwort vergessen" und wartete auf eine Mail -- fuer etwas, das man
# gerade mit beiden Haenden am Schirm tun will, ein Umweg ueber das eigene
# Postfach. Und ohne Mailserver gab es gar keinen Weg.
#
# Drei Dinge unterscheiden diesen Weg vom Reset-Link:
#
# * Das ALTE Passwort muss mit (users.py change_password). Die Sitzung laeuft
#   30 Tage; ohne diese Pruefung reicht ein kurz unbeaufsichtigter Browser,
#   um ein Konto zu uebernehmen.
# * Die eigene Sitzung bleibt bestehen. Ein Passwortwechsel entwertet jede
#   andere Sitzung des Kontos (auth.py issue()) -- genau das ist erwuenscht,
#   aber sich dabei selbst auszusperren waere absurd. Deshalb wird gleich hier
#   ein frisches Sitzungstoken ausgegeben und als Cookie mitgeschickt.
# * Der Admin kommt hier nicht an: er hat kein Konto in users.db (sein
#   Passwort steht in der Dockge-Konfiguration), und _require_login leitet
#   ihn ohnehin nach /admin um.

_PASSWORD_TRIES = 10       # je Stunde -- Durchprobieren des alten Passworts


@app.route('/api/account', methods=['GET'])
def account_read():
    """Was das Spiel ueber das eigene Konto anzeigen darf."""
    player = _current_player_row()
    if not player:
        return jsonify({'error': 'no_account'}), 403
    return jsonify({'email': player['email'],
                    'min_password_chars': usersmod.MIN_PASSWORD_CHARS})


@app.route('/api/account/password', methods=['POST'])
def account_change_password():
    if _limited('password', _PASSWORD_TRIES, 3600):
        return jsonify({'error': 'rate_limited'}), 429
    player = _current_player_row()
    if not player:
        return jsonify({'error': 'no_account'}), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'bad_body'}), 400
    current = body.get('current')
    new_password = body.get('new')
    if not isinstance(current, str) or not isinstance(new_password, str):
        return jsonify({'error': 'bad_body'}), 400

    why = USERS.change_password(player['id'], current, new_password)
    if why:
        return jsonify({'error': why}), 429 if why == 'rate_limited' else 400

    # Jede andere Sitzung dieses Kontos faellt damit (auth.py issue() vergibt
    # eine neue Kennung und entwertet die vorherige) -- die eigene bekommt das
    # frische Token gleich als Cookie zurueck.
    log.info('Passwort durch den Spieler selbst geaendert')
    resp = jsonify({'ok': True})
    resp.set_cookie(authmod.SESSION_COOKIE, AUTH.issue(g.user),
                    max_age=authmod.SESSION_MAX_AGE, httponly=True,
                    samesite='Lax', secure=request.is_secure)
    return resp


# ── Spielhistorie ─────────────────────────────────────────────────────────────
#
# Bis 0.5.11 entstand der einzige Eintrag der Historie als Nebenwirkung von
# /api/highscores -- ein Lauf zaehlte also nur, wenn der Spieler am Ende
# ausdruecklich auf "Eintragen" drueckte. Tutorials (die gar nicht gewertet
# werden), freies Spiel, gescheiterte, zerstoerte und abgebrochene Laeufe
# tauchten damit nirgends auf, und "Spielzeit gesamt" im Panel zeigte einen
# Bruchteil der wirklich gespielten Zeit.
#
# Dieser Endpunkt meldet JEDEN beendeten Lauf, unabhaengig von der Wertung
# (main.js: reportRun()). Der Punktestand wird spaeter nachgetragen, falls
# einer eingereicht wird -- siehe UserStore.attach_score().

_RUN_MODES = frozenset(usersmod.MODES)
_RUN_OUTCOMES = frozenset(usersmod.OUTCOMES)

# Harte Obergrenze fuer die gemeldete SIMULIERTE Dauer. Sie greift, wenn zu
# einem Lauf keine eigene Messung vorliegt (siehe OpenRuns) -- nach einem
# Neustart des Containers etwa, oder bei einem aelteren Client.
_RUN_MAX_DURATION_S = 24 * 3600
# Darunter war es kein Lauf, sondern ein Blick hinein. Derselbe Wert steht in
# main.js -- geprueft wird er hier, weil nur der Server ihn durchsetzen kann.
_RUN_MIN_DURATION_S = 30

# Schneller als das kann kein Browser simulierte Zeit erzeugen: 60x ist die
# hoechste Zeitrafferstufe (siehe loop.js, static/js/main.js setSpeed()).
_RUN_MAX_RATE = 60
# Zuschlag auf die gemessene Zeit. Deckt den Abstand zwischen dem Melden des
# Beginns und dem ersten Rechenschritt, Uhrenaufloesung und den Fall, dass
# jemand die Runde eine Sekunde vor Ablauf der Messung beendet. Grosszuegig,
# weil eine zu enge Grenze einen ehrlichen Lauf kuerzen wuerde -- und eine
# gekuerzte ehrliche Angabe ist schlimmer als eine ungekuerzte falsche.
_RUN_RATE_GRACE_S = 120
# Das freie Spiel kennt zusaetzlich den Xenon-Zeitraffer (main.js
# fastForwardXenon(), XENON_SKIP_CAP_S): der rechnet in einer engen Schleife,
# nicht im Bildtakt, und erzeugt binnen Sekunden bis zu 48 h simulierte Zeit.
# Bis 0.6.2 hob der Server deshalb den Deckel fuer JEDES freie Spiel pauschal
# um diese 48 h an -- ob gesprungen wurde oder nicht. Damit war die 60x-Grenze
# im freien Spiel wirkungslos.
#
# Seit 0.6.3 meldet der Sprung sich an (/api/runs/skip, siehe dort): gezaehlt
# wird nur, was ein offener Lauf dieses Kontos tatsaechlich angemeldet hat,
# und angemeldet werden kann nur ein Lauf, den dieser Server selbst als freies
# Spiel fuehrt. Ein Szenario oder ein Tutorial bekommt hier nichts -- dort
# gibt es den Knopf gar nicht.
#
# Angemeldet wird die Sekundenzahl vom Client; nachpruefen kann der Server sie
# nicht, er rechnet die Physik ja nicht mit. Was er kann, ist sie eingrenzen --
# und dafuer braucht es keine eigene Zahl: die Notbremse des Knopfs liegt bei
# 48 h, also ueber dem 24-h-Deckel, der hier ohnehin ueber allem steht. Mehr
# als einen Tag simulierte Zeit meldet dieser Server nicht, gesprungen oder
# nicht. Das ist weniger als eine Pruefung und deutlich mehr als vorher, wo
# dieselben Stunden ungefragt fuer jeden freien Lauf galten.


def _run_duration_cap(measured: dict | None) -> float:
    """Wie viel simulierte Zeit dieser Lauf hoechstens erreicht haben kann."""
    if measured is None:
        return float(_RUN_MAX_DURATION_S)
    cap = (measured['start_sim'] + measured['wall_s'] * _RUN_MAX_RATE
           + _RUN_RATE_GRACE_S + measured['skip_s'])
    return min(float(_RUN_MAX_DURATION_S), cap)


def _run_mode(scenario: str | None) -> str:
    """Der Modus kommt aus dem KATALOG, nicht aus der Anfrage -- derselbe
    Grundsatz wie beim Schwierigkeitsgrad in scores_add(). Ohne Szenario ist
    es freies Spiel, und ob ein Szenario ein Tutorial ist, steht in seiner
    Datei."""
    if scenario is None:
        return usersmod.MODE_FREE
    if SCENARIO_BY_ID[scenario].get('tutorial'):
        return usersmod.MODE_TUTORIAL
    return usersmod.MODE_SCENARIO


@app.route('/api/runs/start', methods=['POST'])
def run_start():
    """Den Beginn eines Laufs melden, damit der Server seine Dauer selbst
    messen kann (siehe OpenRuns). Antwortet mit einer Kennung, die der Client
    beim Beenden zurueckgibt.

    Der Startpunkt eines FORTGESETZTEN Laufs kommt nicht aus der Anfrage,
    sondern aus dem gespeicherten Stand selbst: der liegt auf diesem Server,
    und sein `t_sim` steht als eigenes Feld darin (siehe net/persist.js
    pack()). Damit ist auch diese Zahl keine Behauptung des Browsers mehr.
    """
    if _limited('run_start', 30, 60):
        return jsonify({'error': 'rate_limited'}), 429
    player = _current_player_row()
    if not player:
        return jsonify({'error': 'no_account'}), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'bad_body'}), 400

    reactor = body.get('reactor')
    if not isinstance(reactor, str) or reactor not in REACTOR_P0:
        return jsonify({'error': 'bad_reactor'}), 400

    scenario = body.get('scenario')
    if scenario is not None and (not isinstance(scenario, str) or scenario not in SCENARIO_IDS):
        return jsonify({'error': 'bad_scenario'}), 400

    start_sim = 0.0
    slot = body.get('slot')
    if isinstance(slot, str) and persist.SLOT_RE.match(slot):
        blob = STORE.read_save(_account_id(), slot)
        # Der Spielstand bleibt undurchsichtig (siehe persist.py) -- gelesen
        # wird genau das eine Feld, das die Zeitmessung braucht, so wie
        # list_saves() es fuer die Anzeige ohnehin schon tut.
        if isinstance(blob, dict):
            try:
                value = float(blob.get('t_sim') or 0.0)
            except (TypeError, ValueError):
                value = 0.0
            if value == value and 0 <= value <= _RUN_MAX_DURATION_S:
                start_sim = value

    return jsonify({'run': RUNS.open(_account_id(), reactor, scenario, start_sim)})


@app.route('/api/runs/skip', methods=['POST'])
def run_skip():
    """Einen Xenon-Zeitsprung anmelden (siehe _run_duration_cap und den
    Abschnitt darueber).

    Der Client ruft das erst NACH dem Sprung und mit der wirklich gerechneten
    Zeit -- vorher weiss er sie nicht, ein Abbruch kann jederzeit dazwischen
    kommen. Bis die Antwort da ist, meldet er den Lauf nicht ab (main.js
    fastForwardXenon()); sonst koennte die Abmeldung die Anmeldung ueberholen
    und der Sprung fiele unter den Tisch.

    Der Zeitsprung selbst braucht diese Anfrage nicht: scheitert sie, springt
    der Client trotzdem, und nur die gemeldete Dauer wird am Ende gekuerzt.
    """
    if _limited('run_skip', 60, 60):
        return jsonify({'error': 'rate_limited'}), 429
    if not _current_player_row():
        return jsonify({'error': 'no_account'}), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'bad_body'}), 400
    try:
        seconds = float(body.get('seconds'))
    except (TypeError, ValueError):
        return jsonify({'error': 'bad_seconds'}), 400
    if not (seconds == seconds) or seconds < 0:       # NaN faellt mit durch
        return jsonify({'error': 'bad_seconds'}), 400

    total = RUNS.add_skip(_account_id(), body.get('run'), seconds,
                          cap_total=float(_RUN_MAX_DURATION_S))
    # Kein offener Lauf, eine fremde Kennung, oder ein Szenario, das den Knopf
    # gar nicht hat -- fuer diese Antwort ist das dasselbe: hier ist nichts
    # anzumelden.
    if total is None:
        return jsonify({'error': 'no_open_run'}), 400
    return jsonify({'ok': True, 'skip_s': total})


@app.route('/api/runs', methods=['POST'])
def run_record():
    """Ein beendeter Lauf fuer die Historie im Admin-Panel."""
    # Weiter als eine Runde dauern kann: ein Lauf endet nicht dreissigmal in
    # der Minute, und bei einem Fehler soll der naechste echte Lauf nicht
    # ausgesperrt sein.
    if _limited('run', 30, 60):
        return jsonify({'error': 'rate_limited'}), 429

    player = _current_player_row()
    if not player:
        # Kann nur ein Konto sein, das zwischen Anmeldung und jetzt
        # verschwunden ist -- der Admin kommt hier gar nicht an
        # (_require_login leitet ihn nach /admin um).
        return jsonify({'error': 'no_account'}), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'bad_body'}), 400

    reactor = body.get('reactor')
    if not isinstance(reactor, str) or reactor not in REACTOR_P0:
        return jsonify({'error': 'bad_reactor'}), 400

    scenario = body.get('scenario')
    if scenario is not None and (not isinstance(scenario, str) or scenario not in SCENARIO_IDS):
        return jsonify({'error': 'bad_scenario'}), 400

    outcome = body.get('outcome')
    if outcome not in _RUN_OUTCOMES:
        return jsonify({'error': 'bad_outcome'}), 400

    try:
        duration = float(body.get('duration_s') or 0.0)
    except (TypeError, ValueError):
        return jsonify({'error': 'bad_duration'}), 400
    if not (duration == duration) or duration < _RUN_MIN_DURATION_S:   # NaN faellt mit durch
        return jsonify({'error': 'too_short'}), 400

    mode = _run_mode(scenario)

    # Die eigene Messung dieses Laufs, falls der Client seinen Beginn gemeldet
    # hat (siehe /api/runs/start). Sie liefert die tatsaechlich verbrachte
    # Zeit UND die Obergrenze fuer die gemeldete simulierte -- beides ohne
    # eine Zahl aus dieser Anfrage.
    measured = RUNS.close(_account_id(), body.get('run'))
    # Eine Kennung, die zu einem anderen Reaktor oder Szenario gehoert, misst
    # einen anderen Lauf: dann lieber gar nicht messen als falsch messen.
    if measured is not None and (measured['reactor'] != reactor
                                 or measured['scenario'] != scenario):
        measured = None
    duration = min(duration, _run_duration_cap(measured))

    USERS.record_play_session(
        player['id'], reactor, scenario, duration,
        completed=(outcome == usersmod.OUTCOME_COMPLETED),
        mode=mode, outcome=outcome,
        wall_s=(measured['wall_s'] if measured else None))
    return jsonify({'ok': True})


# ── Bestenliste ───────────────────────────────────────────────────────────────


@app.route('/api/highscores', methods=['GET'])
def scores_list():
    reactor = request.args.get('reactor')
    scenario = request.args.get('scenario')
    if reactor is not None and reactor not in REACTOR_P0:
        return jsonify({'error': 'bad_reactor'}), 400
    if scenario is not None and scenario not in SCENARIO_IDS:
        return jsonify({'error': 'bad_scenario'}), 400
    try:
        limit = int(request.args.get('limit', 20))
    except ValueError:
        limit = 20
    # Historical versions stay on disk, but never crowd out current scores.
    modes = {s['id']: s.get('score_mode') or 'legacy' for s in SCENARIOS}
    return jsonify({'scores': STORE.list_scores(
        reactor, scenario, limit, score_mode=modes.get(scenario), canonical_modes=modes)})


def _verify_run(reactor: str, scenario_file: str, action_log: list) -> dict | None:
    """Lauf serverseitig nachrechnen (verify_run.mjs unter Node) statt der
    gemeldeten Kennzahlen nur auf Plausibilität zu prüfen.

    @return die nachgerechnete Zusammenfassung (dieselbe Form wie
    RunState.summary()), oder None bei jedem Fehler -- Zeitüberschreitung,
    Absturz, kaputtes Protokoll. Ein Fehler hier ist immer eine Ablehnung,
    nie ein Rückfall auf die Klientenangabe: wer ein Protokoll mitschickt,
    verspricht damit, dass es sich nachrechnen lässt.
    """
    payload = json.dumps({'reactor': reactor, 'scenarioFile': scenario_file, 'log': action_log})
    try:
        proc = subprocess.run(
            ['node', VERIFY_SCRIPT], input=payload, capture_output=True,
            text=True, timeout=VERIFY_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log.error("Nachrechnung nicht gestartet: %s", exc.__class__.__name__)
        return None
    if proc.returncode != 0:
        log.info("Nachrechnung abgelehnt: %s", (proc.stdout or proc.stderr or '').strip()[:200])
        return None
    try:
        data = json.loads(proc.stdout)
    except ValueError:
        log.error("Nachrechnung lieferte kein JSON")
        return None
    summary = data.get('summary') if isinstance(data, dict) else None
    return summary if isinstance(summary, dict) else None


@app.route('/api/highscores', methods=['POST'])
def scores_add():
    """Der Client schickt Kennzahlen, NIE einen Punktestand.

    Gepruefte Reihenfolge: Ratenbegrenzung, Kennungen gegen die Whitelist,
    Plausibilitaet der Kennzahlen, dann erst rechnen. Ein mitgeschicktes
    Feld "score" wird nicht gelesen -- es kommt gar nicht vor.
    """
    # Zwei Stufen. Oben eine weite Grenze gegen das blosse Fluten; die enge
    # Grenze steht weiter unten, kurz vor dem Schreiben. Stuende sie hier,
    # wuerde eine einzige fehlerhafte Anfrage den naechsten gueltigen Eintrag
    # fuer eine Minute blockieren -- und wer haendisch herumprobiert, sperrt
    # sich damit selbst aus.
    if _limited('score_burst', 60, 60):
        return jsonify({'error': 'rate_limited'}), 429

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'bad_body'}), 400

    summary = body.get('summary')
    if not isinstance(summary, dict):
        return jsonify({'error': 'bad_summary'}), 400

    reactor = summary.get('reactor') or body.get('reactor')
    scenario = summary.get('scenario') or body.get('scenario')
    if not isinstance(reactor, str) or reactor not in REACTOR_P0:
        return jsonify({'error': 'bad_reactor'}), 400
    if not isinstance(scenario, str) or scenario not in SCENARIO_IDS:
        return jsonify({'error': 'bad_scenario'}), 400

    scn = SCENARIO_BY_ID[scenario]
    if scn.get('tutorial'):
        return jsonify({'error': 'tutorial_unranked'}), 400
    if scn.get('reactor') != reactor:
        return jsonify({'error': 'reactor_mismatch'}), 400

    # Protokoll mitgeschickt (siehe game/recorder.js) -- dann selbst
    # nachrechnen statt der Zusammenfassung zu vertrauen, und die vom Client
    # gemeldeten Kennzahlen komplett durch das Ergebnis ersetzen. Ein
    # geladener Spielstand hat kein Protokoll (main.js boot()); nur Legacy
    # erlaubt dann die reine Plausibilitätsprüfung -- validate_summary
    # läuft in JEDEM Fall noch einmal darüber, auch über eine nachgerechnete
    # Zusammenfassung: billige zweite Absicherung, falls verify_run.mjs
    # selbst einen Fehler hätte.
    action_log = body.get('log')
    incident = scn.get('score_mode') == 'incident_v1'
    if incident and not isinstance(action_log, list):
        return jsonify({'error': 'replay_required'}), 400
    if isinstance(action_log, list):
        verified = _verify_run(reactor, scn['file'], action_log)
        if verified is None:
            return jsonify({'error': 'verification_failed'}), 400
        summary = verified

    summary = dict(summary)
    if not incident:
        # The catalog, never client-injected fields, selects the formula.
        summary.pop('score_mode', None)
        summary.pop('objectives', None)

    why = scoring.validate_summary(summary, scn, REACTOR_P0[reactor])
    if why:
        return jsonify({'error': 'implausible', 'detail': why}), 400

    # Der Schwierigkeitsgrad kommt AUS DER SZENARIODATEI, nie aus der Anfrage.
    # Er geht als Faktor in den Abschlussbonus ein, und zwar ungedeckelt: mit
    # dem mitgeschickten Wert liess sich der Punktestand beliebig hoch
    # schrauben (difficulty=1e6, completed=true ergab 250 Mio Punkte, und
    # validate_summary sah nichts Unplausibles -- es prueft jede andere
    # Kennzahl, nur diese nicht). Ueberschreiben statt pruefen: so kann das
    # Feld gar nicht erst falsch sein.
    summary['difficulty'] = scn.get('difficulty', 1)

    name = STORE.clean_name(body.get('name'))
    if not name:
        return jsonify({'error': 'bad_name'}), 400

    # Jetzt erst die enge Grenze: ein Eintrag je Minute, zweihundert am Tag.
    if _limited('score', 1, 60) or _limited('score_day', 200, 86400):
        return jsonify({'error': 'rate_limited'}), 429

    result = scoring.score(summary)
    entry = STORE.add_score(reactor, scenario, name, result['score'], summary,
                            score_mode='incident_v1' if incident else 'legacy')
    # Admin-Panel: der Lauf selbst steht schon in der Historie, gemeldet beim
    # Beenden ueber /api/runs. Hier kommt nur noch der Punktestand dazu.
    # Findet sich kein passender Lauf (der Client war beim Beenden offline,
    # oder es ist ein alter Client), wird einer angelegt -- lieber ein Eintrag
    # ohne Gegenstueck als ein gewerteter Lauf, der in der Historie fehlt.
    player = _current_player_row()
    if player:
        if not USERS.attach_score(player['id'], reactor, scenario, result['score']):
            USERS.record_play_session(
                player['id'], reactor, scenario, summary.get('duration_s'),
                bool(summary.get('completed')), mode=usersmod.MODE_SCENARIO,
                outcome=(usersmod.OUTCOME_COMPLETED if summary.get('completed')
                         else usersmod.OUTCOME_FAILED),
                score=result['score'])
    return jsonify({'ok': True, 'entry': entry, 'score': result['score'],
                    'parts': result['parts'], 'summary': summary})


# ── Seiten ────────────────────────────────────────────────────────────────────


def _render_index(initial_reactor=None, monitor=False):
    lang = detect_language(request)
    return render_template('index.html',
                           t=load_translations(lang),
                           lang=lang,
                           app_version=APP_VERSION,
                           initial_reactor=initial_reactor,
                           monitor=monitor)


@app.route('/')
def index():
    return _render_index()


# Zweitbildschirm: DIESELBE Seite, nur mit einem anderen Einstiegsmodul
# (monitor.js statt main.js, siehe index.html). Eine eigene Vorlage haette
# jede Kachel, jedes Rundinstrument und jedes Hilfefenster ein zweites Mal
# beschrieben -- und beim naechsten Reaktortyp waere genau eine davon
# vergessen worden. Gesperrt wird nicht durch weggelassene Knoten, sondern
# durch setControlsLocked() (siehe ui/controls.js).
@app.route('/monitor')
def monitor_page():
    return _render_index(monitor=True)


# Direktaufruf/Refresh von /reaktor/<typ> (siehe fadeScreens()/history.pushState
# in main.js) muss dieselbe Seite liefern wie '/' -- ausgeliefert wird immer
# index.html, initial_reactor sagt main.js nur, welchen Bildschirm es beim
# ersten Zeichnen zeigen soll (kein serverseitiges Routing der Reaktordaten
# selbst, die kommen wie eh und je aus PLANT_IDS im JS). Ein unbekannter Typ
# faellt auf die normale Uebersicht zurueck statt auf 404 -- ein alter/
# falscher Link soll die App zeigen, nicht eine Fehlerseite.
@app.route('/reaktor/<reactor_id>')
def reactor_page(reactor_id: str):
    if reactor_id not in REACTOR_P0:
        return _render_index()
    return _render_index(initial_reactor=reactor_id)


@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'version': APP_VERSION})


@app.route('/set-lang/<lang>')
def set_lang(lang: str):
    # Feste Literale statt Durchreichen des Pfadsegments: der Cookie-Wert ist
    # immer eine dieser beiden fest verdrahteten Zeichenketten, nie die
    # Anfragedaten selbst.
    lang = {'de': 'de', 'en': 'en'}.get(lang, 'en')
    resp = make_response(redirect('/'))
    resp.set_cookie('lang', lang, max_age=365 * 24 * 3600, samesite='Lax')
    return resp


@app.route('/s/<ver>/<path:filename>')
def vstatic(ver: str, filename: str):
    """Pfadversionierte Statics.

    `?v=` bustet keine ES-Modul-Unterimporte: der Browser holt ./sim/engine.js
    unter genau dieser URL, ohne Query-String, und liefert nach einem Versions-
    sprung eine neue main.js gegen dreissig veraltete Module. Steckt die Version
    im Pfad, erben alle relativen Importe sie automatisch, und die Dateien
    duerfen unbegrenzt gecacht werden.

    `ver` wird nicht geprueft -- der Wert waehlt keine Datei aus, er trennt nur
    Cache-Generationen. send_from_directory verhindert das Ausbrechen aus
    static/ von sich aus.
    """
    return send_from_directory(STATIC_PATH, filename, max_age=31536000)


# ── Start ─────────────────────────────────────────────────────────────────────


def _handle_sigterm(_signum, _frame):
    log.info("ReactorSim wird beendet")
    os._exit(0)


def _serve() -> None:
    """Waitress statt Flasks Entwicklungsserver.

    Werkzeugs Server legt pro Anfrage einen Thread ohne Obergrenze an und kennt
    kein Timeout fuer haengende Verbindungen -- auf einem offenen LAN-Port ist
    das angreifbar. Nebenbei verriet er Framework und exakte Python-Version im
    Server-Header.
    """
    # 8 Threads liefen mehrfach ueber ("Task queue depth" im Protokoll) --
    # jede grosse Hintergrundgrafik (siehe /static/img/) haelt ihren Thread
    # fuer die volle Uebertragungsdauer belegt, mehrere gleichzeitige
    # Seitenaufrufe reichten dafuer schon aus. Der Container hat kein
    # CPU-Limit (siehe docker-compose.yml), und die Arbeit hier ist I/O-
    # gebunden (Netzwerk, Plattenzugriff) -- die GIL bremst wartende Threads
    # nicht, mehr davon kosten praktisch nur ein paar Kilobyte Stack je Stueck.
    log.info("ReactorSim %s laeuft auf Port %d", APP_VERSION, PORT)
    # clear_untrusted_proxy_headers=False: Waitress entfernt X-Forwarded-*
    # sonst standardmaessig, bevor die App sie sieht -- hinter Reverse
    # Proxy/Cloudflare Tunnel kam dadurch bei jedem Besucher dieselbe
    # Docker-Gateway-Adresse an. Die Header sind dadurch wieder faelschbar
    # wie vor Waitress 0.8.10 -- deshalb wertet _client_ip() oben nicht
    # blind die letzte Adresse aus, sondern sucht die erste oeffentliche.
    serve(app, host='0.0.0.0', port=PORT, threads=24,
          ident=None,
          clear_untrusted_proxy_headers=False,
          max_request_body_size=persist.MAX_SAVE_BYTES)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, _handle_sigterm)
    os.makedirs(_DATA, exist_ok=True)
    _serve()
