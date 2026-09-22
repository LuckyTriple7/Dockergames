#!/usr/bin/env python3
"""Mailversand.

Wie beim Admin-Konto (siehe auth.py) kommt die Konfiguration **aus der
Umgebung**, also aus der Dockge-Konfiguration -- nicht aus dem Panel. Ein
Postfachpasswort im Browserformular waere ein Geheimnis mehr, das ReactorSim
speichern, verschluesseln und wieder anzeigen muesste; in Dockge steht es
ohnehin schon neben dem Admin-Passwort. Das Panel *zeigt* die Einstellung
deshalb nur (ohne das Passwort) und kann eine Testmail schicken.

Ist kein Server gesetzt, laeuft alles wie bisher: das Panel zeigt erzeugte
Passwoerter einmalig an, "Passwort vergessen" bleibt ausgeblendet. Mailversand
ist eine Zugabe, keine Voraussetzung -- eine Anlage ohne Postfach soll
weiterhin vollstaendig bedienbar sein.

Fehler wandern als kurzer Grund zurueck an den Aufrufer ('auth_failed',
'connect_failed', ...), damit das Panel sie uebersetzen kann; der ausfuehrliche
Text steht daneben im Protokoll. Keine Ausnahme verlaesst send() -- ein
unerreichbarer Mailserver darf niemals ein Konto verhindern, das sonst
angelegt worden waere.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

log = logging.getLogger(__name__)

SECURITY_STARTTLS = 'starttls'
SECURITY_SSL = 'ssl'
SECURITY_NONE = 'none'

_SECURITIES = (SECURITY_STARTTLS, SECURITY_SSL, SECURITY_NONE)

# Uebliche Vorgaben, damit in Dockge nur Host, Postfach und Passwort noetig
# sind. Wer einen abweichenden Port braucht, setzt ihn ausdruecklich.
_DEFAULT_PORTS = {SECURITY_STARTTLS: 587, SECURITY_SSL: 465, SECURITY_NONE: 25}

# Grosszuegig gegen einen langsamen Mailserver, aber endlich: ohne Zeitgrenze
# haengt der Anlegen-Knopf im Panel, bis der Browser aufgibt.
DEFAULT_TIMEOUT_S = 20

SENDER_NAME = 'ReactorSim'


def _env_int(env: dict, key: str, fallback: int) -> int:
    try:
        value = int((env.get(key) or '').strip())
    except (TypeError, ValueError):
        return fallback
    return value if 0 < value < 65536 else fallback


class Mailer:
    """Ein SMTP-Zugang. Unkonfiguriert ist der Normalfall, nicht der Fehler."""

    def __init__(self, host: str = '', port: int = 0, user: str = '',
                 password: str = '', sender: str = '',
                 security: str = SECURITY_STARTTLS,
                 timeout_s: int = DEFAULT_TIMEOUT_S):
        self.host = (host or '').strip()
        self.security = security if security in _SECURITIES else SECURITY_STARTTLS
        self.port = port or _DEFAULT_PORTS[self.security]
        self.user = (user or '').strip()
        self._password = password or ''
        # Ohne eigene Absenderadresse ist das Postfach die naheliegende Wahl --
        # bei fast jedem Anbieter ist genau das die einzige erlaubte.
        self.sender = (sender or '').strip() or self.user
        self.timeout_s = timeout_s

    @classmethod
    def from_env(cls, env=None) -> 'Mailer':
        env = os.environ if env is None else env
        security = (env.get('REACTORSIM_SMTP_SECURITY') or SECURITY_STARTTLS).strip().lower()
        if security not in _SECURITIES:
            log.warning('REACTORSIM_SMTP_SECURITY=%r unbekannt -- es gilt %s',
                        security, SECURITY_STARTTLS)
            security = SECURITY_STARTTLS
        return cls(
            host=env.get('REACTORSIM_SMTP_HOST', ''),
            port=_env_int(env, 'REACTORSIM_SMTP_PORT', _DEFAULT_PORTS[security]),
            user=env.get('REACTORSIM_SMTP_USER', ''),
            password=env.get('REACTORSIM_SMTP_PASSWORD', ''),
            sender=env.get('REACTORSIM_SMTP_FROM', ''),
            security=security,
            timeout_s=_env_int(env, 'REACTORSIM_SMTP_TIMEOUT', DEFAULT_TIMEOUT_S),
        )

    @property
    def configured(self) -> bool:
        """Server UND Absenderadresse -- ohne eine von beiden geht nichts."""
        return bool(self.host and self.sender)

    def status(self) -> dict:
        """Was das Admin-Panel anzeigen darf. Das Passwort NIE im Klartext --
        nur, ob ueberhaupt eines gesetzt ist."""
        return {
            'configured': self.configured,
            'host': self.host,
            'port': self.port,
            'security': self.security,
            'user': self.user,
            'sender': self.sender,
            'password_set': bool(self._password),
        }

    # ── Versand ───────────────────────────────────────────────────────────────

    def send(self, to: str, subject: str, body: str) -> str | None:
        """@return None bei Erfolg, sonst ein kurzer Grund fuer das Panel."""
        to = (to or '').strip()
        if not self.configured:
            return 'not_configured'
        if not to:
            return 'no_recipient'

        # Die Kopfzeilen im selben Fang wie der Versand: eine Adresse mit
        # Zeilenumbruch laesst die email-Bibliothek zu Recht auffliegen (sie
        # verhindert damit untergeschobene Kopfzeilen), und dieser Aufruf
        # verspricht seinem Aufrufer, keine Ausnahme durchzulassen. Ueber die
        # vorhandenen Wege ist das nicht auszuloesen -- _EMAIL_RE in users.py
        # verbietet Leerraum --, aber die Zusage darf nicht am Wortlaut einer
        # fremden Bibliothek haengen.
        try:
            msg = EmailMessage()
            msg['From'] = formataddr((SENDER_NAME, self.sender))
            msg['To'] = to
            msg['Subject'] = subject
            msg['Date'] = formatdate(localtime=True)
            msg['Message-ID'] = make_msgid(domain=self.sender.rpartition('@')[2] or None)
            # Diese Mail beantwortet niemand, und niemand soll ihr
            # automatisch antworten: RFC 3834 haelt Abwesenheitsnotizen und
            # Autoresponder von einer Maschinenmail fern. Ohne die Zeile
            # bekaeme das Postfach auf jede Passwort-Mail die Urlaubsantwort
            # des Empfaengers zurueck.
            msg['Auto-Submitted'] = 'auto-generated'
            # Reine Textmail. Kein HTML, kein Zaehlpixel, kein nachgeladenes Bild --
            # dieselbe Linie wie bei der Seite selbst (siehe Kommentar zur CSP in
            # app.py).
            msg.set_content(body)
        except ValueError as exc:
            log.error('Mail an %r nicht gebaut: %s', to, exc)
            return 'bad_address'

        try:
            if self.security == SECURITY_SSL:
                with smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout_s,
                                      context=self._tls_context()) as smtp:
                    self._deliver(smtp, msg)
            else:
                with smtplib.SMTP(self.host, self.port, timeout=self.timeout_s) as smtp:
                    if self.security == SECURITY_STARTTLS:
                        smtp.starttls(context=self._tls_context())
                        # Nach STARTTLS neu begruessen: die vor der
                        # Verschluesselung angekuendigten Faehigkeiten (u. a.
                        # AUTH) gelten danach nicht mehr.
                        smtp.ehlo()
                    self._deliver(smtp, msg)
        except ssl.SSLError as exc:
            # Eigener Grund und nicht 'connect_failed': der Server war ja
            # erreichbar. Wer hier landet, hat ein Zertifikat, dem dieses
            # System nicht traut -- meist ein selbst ausgestelltes im eigenen
            # Netz. Das gehoert in den Zertifikatsspeicher des Containers,
            # nicht weggeschaltet.
            log.error('Mail an %s: TLS abgelehnt -- %s (%s)', to, exc.__class__.__name__, exc)
            return 'tls_failed'
        except smtplib.SMTPAuthenticationError as exc:
            log.error('Mail an %s: Anmeldung am Mailserver abgelehnt (%s)', to, exc)
            return 'auth_failed'
        except smtplib.SMTPRecipientsRefused as exc:
            log.error('Mail an %s: Empfaenger abgelehnt (%s)', to, exc)
            return 'recipient_refused'
        except smtplib.SMTPException as exc:
            log.error('Mail an %s: %s (%s)', to, exc.__class__.__name__, exc)
            return 'smtp_error'
        except OSError as exc:
            # Kein Netz, falscher Port, falscher Hostname, TLS-Fehler.
            log.error('Mail an %s: Verbindung fehlgeschlagen -- %s (%s)',
                      to, exc.__class__.__name__, exc)
            return 'connect_failed'
        log.info('Mail an %s verschickt: %s', to, subject)
        return None

    def _tls_context(self) -> ssl.SSLContext:
        """Zertifikat UND Hostname pruefen.

        Ohne Kontext nimmt smtplib ``ssl._create_stdlib_context()``, und das
        verschluesselt zwar, prueft aber nichts: ``verify_mode=CERT_NONE``,
        ``check_hostname=False``. Wer sich dazwischenhaengt, legt ein
        beliebiges Zertifikat vor und bekommt einen Wimpernschlag spaeter das
        Postfachpasswort im Klartext -- ``login()`` laeuft ja erst, wenn die
        Verbindung steht.
        """
        return ssl.create_default_context()

    def _deliver(self, smtp, msg: EmailMessage) -> None:
        if self.user and self._password:
            smtp.login(self.user, self._password)
        smtp.send_message(msg)

    def send_async(self, to: str, subject: str, body: str) -> None:
        """Fuer "Passwort vergessen": die Antwort darf nicht verraten, ob
        ueberhaupt verschickt wurde -- und schon gar nicht ueber ihre Laufzeit,
        ob es die Adresse gibt. Der Aufrufer bekommt deshalb sofort dieselbe
        Antwort, egal was hier gleich passiert."""
        if not self.configured:
            return
        threading.Thread(target=self.send, args=(to, subject, body),
                         name='rs-mail', daemon=True).start()
