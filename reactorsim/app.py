#!/usr/bin/env python3
"""ReactorSim — Kernkraftwerks-Leitstand als Browser-Spiel.

Kein Home-Assistant-Add-on: der Ordner enthaelt bewusst keine config.yaml,
sonst wuerde der Supervisor ihn als Add-on einlesen. Betrieb ausschliesslich
ueber docker-compose (Dockge).

Die gesamte Simulation laeuft im Browser. Dieser Server liefert nur die Seite,
die Uebersetzungen, /health fuer den Healthcheck und spaeter eine kleine
JSON-Schnittstelle fuer Spielstaende und Bestenliste.
"""

import json
import logging
import os
import secrets
import signal
import subprocess

from datetime import datetime, timezone
from urllib.parse import quote

from flask import (Flask, abort, g, jsonify, make_response, redirect,
                   render_template, request, send_from_directory)
from waitress import serve
from werkzeug.middleware.proxy_fix import ProxyFix

import auth as authmod
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

# Hinter einem Reverse Proxy traegt jede Anfrage dieselbe Absenderadresse,
# naemlich die des Proxys. Ohne ProxyFix teilen sich dann alle Spieler
# dieselbe Ratenbegrenzung. Wer den Port direkt erreicht, kann
# X-Forwarded-For faelschen -- das ist der Preis und aendert nichts daran,
# dass der Punktestand ohnehin serverseitig gerechnet wird.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

STORE = persist.Store(_DATA)
LIMITS = persist.RateLimit()
USERS = usersmod.UserStore(_DATA)
AUTH = authmod.Auth(_DATA, REACTORSIM_USER, REACTORSIM_PASSWORD, USERS)

PLAYER_COOKIE = 'rs_player'

# Was ohne Anmeldung erreichbar bleibt. /health muss offen sein, sonst meldet
# der Healthcheck den Container als krank; die Anmeldeseite selbst kann nicht
# hinter der Anmeldung liegen; /set-lang stellt nur ein Cookie und existiert
# auch auf der Anmeldeseite.
_PUBLIC_ENDPOINTS = frozenset({'health', 'login', 'set_lang'})

# Nur der Admin darf hier hinein, ein Spieler nie -- siehe _require_login().
_ADMIN_ENDPOINTS = frozenset({
    'admin_panel', 'admin_create_user', 'admin_lock_user',
    'admin_unlock_user', 'admin_reset_password',
})


@app.before_request
def _require_login():
    if request.endpoint in _PUBLIC_ENDPOINTS:
        return None
    user = AUTH.valid(request.cookies.get(authmod.SESSION_COOKIE))
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
        # Abmelden geht immer, unabhaengig von der Rolle -- sonst kaeme der
        # Admin nie am eigenen logout()-View vorbei (er faellt in KEINER der
        # beiden Rollenpruefungen unten durch, _ADMIN_ENDPOINTS ist nur fuer
        # die Verwaltungsrouten gedacht).
        if request.endpoint == 'logout':
            return None
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
        addr = request.remote_addr or '-'
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
            resp = make_response(redirect('/admin' if is_admin else nxt))
            resp.set_cookie(authmod.SESSION_COOKIE, AUTH.issue(uname),
                            max_age=authmod.SESSION_MAX_AGE, httponly=True,
                            samesite='Lax', secure=request.is_secure)
            return resp
        else:
            error = 'login_failed'

    resp = make_response(render_template(
        'login.html', t=t, lang=lang, app_version=APP_VERSION,
        csrf=AUTH.csrf_token(), next_url=nxt, error=error,
        prefill=request.form.get('user', '') if request.method == 'POST' else ''))
    resp.headers['Cache-Control'] = 'no-store'
    return resp, (401 if error else 200)


@app.route('/logout', methods=['GET', 'POST'])
def logout():
    # Sitzungskennung mitentwerten, nicht nur das Cookie loeschen -- sonst
    # wirkt ein Cookie, das anderswo noch im Browser laege, bis es abgelaufen
    # ist (siehe Auth.revoke()).
    AUTH.revoke(AUTH.valid(request.cookies.get(authmod.SESSION_COOKIE)))
    resp = make_response(redirect('/login'))
    resp.delete_cookie(authmod.SESSION_COOKIE)
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


def _render_admin(status: int = 200, **extra):
    lang = detect_language(request)
    ctx = {
        't': load_translations(lang), 'lang': lang, 'app_version': APP_VERSION,
        'users': USERS.list_users(),
        'logins': USERS.recent_login_events(_ADMIN_LIST_LIMIT),
        'sessions': USERS.recent_play_sessions(_ADMIN_LIST_LIMIT),
        'csrf': AUTH.csrf_token('admin'),
        'created': None, 'reset_password': None, 'error': None,
    }
    ctx.update(extra)
    resp = make_response(render_template('admin.html', **ctx), status)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


def _admin_csrf_ok() -> bool:
    return AUTH.csrf_ok(request.form.get('csrf'), 'admin')


@app.route('/admin', methods=['GET'])
def admin_panel():
    return _render_admin()


@app.route('/admin/users', methods=['POST'])
def admin_create_user():
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    user, err = USERS.create_user(request.form.get('email', ''),
                                  request.form.get('password') or None,
                                  created_by=g.user)
    if err:
        return _render_admin(400, error=err)
    return _render_admin(created=user)


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


@app.route('/admin/users/<user_id>/reset-password', methods=['POST'])
def admin_reset_password(user_id: str):
    if not _admin_csrf_ok():
        return _render_admin(400, error='csrf_expired')
    new_password, err = USERS.reset_password(user_id)
    if err:
        return _render_admin(404, error=err)
    row = USERS.get_by_id(user_id)
    return _render_admin(reset_password={'email': row['email'], 'password': new_password})


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
    addr = request.remote_addr or '-'
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
    # Admin-Panel: was ein Spieler gespielt hat und wie lange -- nur fuer
    # ausgewertete Laeufe (siehe Entscheidung Phase 1), das Tutorial landet
    # schon oben bei 'tutorial_unranked' nie hier.
    player = _current_player_row()
    if player:
        USERS.record_play_session(player['id'], reactor, scenario,
                                  summary.get('duration_s'), bool(summary.get('completed')))
    return jsonify({'ok': True, 'entry': entry, 'score': result['score'],
                    'parts': result['parts'], 'summary': summary})


# ── Seiten ────────────────────────────────────────────────────────────────────


@app.route('/')
def index():
    lang = detect_language(request)
    return render_template('index.html',
                           t=load_translations(lang),
                           lang=lang,
                           app_version=APP_VERSION)


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
    log.info("ReactorSim %s laeuft auf Port %d", APP_VERSION, PORT)
    serve(app, host='0.0.0.0', port=PORT, threads=8,
          ident=None,
          max_request_body_size=persist.MAX_SAVE_BYTES)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, _handle_sigterm)
    os.makedirs(_DATA, exist_ok=True)
    _serve()
