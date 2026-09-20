# ReactorSim in Dockge betreiben

ReactorSim ist ein gewöhnlicher Container ohne Abhängigkeiten: kein Datenbank-
Server, kein Cache, kein zweiter Dienst. Das fertige Image liegt unter
`ghcr.io/luckytriple7/reactorsim` für **amd64 und arm64**. Den Quellcode
brauchst du nicht.

In Dockge ist das ein Stack. Lege ihn an, füge die Datei unten ein, starten.

```
/opt/stacks/reactorsim/
├── compose.yaml
└── data/            legt sich beim ersten Start selbst an
```

---

## Die Datei

`/opt/stacks/reactorsim/compose.yaml`:

```yaml
services:
  reactorsim:
    image: ghcr.io/luckytriple7/reactorsim:latest
    container_name: reactorsim
    restart: unless-stopped

    ports:
      # links der Port auf dem Server, rechts der im Container.
      # Nur die linke Seite darfst du ändern — innen hört der Dienst fest
      # auf 17779, und der Healthcheck unten prüft genau den.
      - "17779:17779"

    volumes:
      # Spielstände, Bestenliste und Spielerkonten. Mehr legt ReactorSim nicht ab.
      - ./data:/data

    environment:
      # Zugang des Admin-Kontos. Ohne gesetztes Passwort erzeugt ReactorSim
      # beim ersten Start eines und schreibt es ins Protokoll — offen steht
      # die Seite nie. Der Admin spielt nicht: er legt im Panel unter /admin
      # die eigentlichen Spielerkonten an (siehe Abschnitt "Zugang" unten).
      - REACTORSIM_USER=admin
      - REACTORSIM_PASSWORD=bitte-aendern
      # Nur für die Zeitstempel in den Protokollzeilen.
      - TZ=Europe/Berlin
      # Mailversand — optional, siehe Abschnitt "E-Mail" weiter unten.
      #- REACTORSIM_SMTP_HOST=mail.example.net
      #- REACTORSIM_SMTP_PORT=587
      #- REACTORSIM_SMTP_SECURITY=starttls
      #- REACTORSIM_SMTP_USER=reactorsim@example.net
      #- REACTORSIM_SMTP_PASSWORD=postfach-passwort
      #- REACTORSIM_SMTP_FROM=reactorsim@example.net
      #- REACTORSIM_PUBLIC_URL=https://reactorsim.example.net

    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:17779/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

    # Auf einem Mietserver läuft sonst irgendwann die Platte mit Protokollen
    # voll. Drei Dateien à 10 MB reichen für jede Fehlersuche.
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Danach `http://<server>:17779`.

---

## Zugang

Zwei Arten von Konten, streng getrennt:

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `REACTORSIM_USER` | `admin` | Benutzername des Admin-Kontos |
| `REACTORSIM_PASSWORD` | — | Admin-Passwort. Fehlt es, wird eines erzeugt |

Das **Admin-Konto** kommt wie bisher aus der Konfiguration und **spielt
nicht** — es meldet sich an, landet direkt im Panel unter `/admin` und legt
dort die eigentlichen **Spielerkonten** an: E-Mail-Adresse als Benutzername,
Passwort frei wählbar oder automatisch erzeugt (dann einmalig im Panel
angezeigt, genau wie das Admin-Passwort einmalig im Protokoll). Dort lassen
sich Konten auch sperren/entsperren und Passwörter zurücksetzen.

Das Panel zeigt außerdem die **Spielhistorie**: wer sich wann von welcher
Adresse angemeldet hat, und jeden beendeten Lauf mit Reaktortyp, Szenario,
Art (Szenario/Tutorial/freies Spiel), Dauer, Ausgang (geschafft, gescheitert,
abgebrochen, Anlage zerstört) und — falls eingetragen — Punktestand. Ein
Klick auf eine E-Mail-Adresse öffnet die **Kontoseite** mit der vollständigen
Historie dieses einen Spielers, einer Auswertung je Szenario und allen
Anmeldungen.

> Läufe unter 30 Sekunden simulierter Zeit werden nicht aufgezeichnet — sonst
> stünde jedes kurze Hineinschauen als eigener Eintrag in der Liste.

Ist kein Passwort für das Admin-Konto gesetzt, erzeugt ReactorSim beim ersten
Start ein zufälliges, schreibt es **einmal** ins Protokoll und legt nur den
Hash in `./data/auth.json` ab:

```bash
docker compose logs reactorsim | grep -A 3 "Passwort"
```

Ein gesetztes `REACTORSIM_PASSWORD` gewinnt immer gegen die gespeicherte
Fassung — ändern heißt also: Wert in Dockge ändern, Stack neu starten, fertig.

Jedes Spielerkonto hat eigene Spielstände, Einstellungen und eine eigene
Ratenbegrenzung — mehrere Leute können also gleichzeitig denselben Server
nutzen, ohne sich gegenseitig zu überschreiben. Zugleich gilt **je
Spielerkonto genau eine aktive Sitzung**: meldet sich dasselbe Konto auf
einem zweiten Gerät an, wird die Sitzung auf dem ersten sofort ungültig.
Dasselbe Spielerkonto kann also nie auf zwei Geräten gleichzeitig
weiterspielen — für zwei Geräte gleichzeitig braucht es zwei Konten. Das
Admin-Konto ist davon ausgenommen: es spielt nicht, mehrere Admin-Sitzungen
(Tabs, Geräte) gleichzeitig sind erlaubt.

Die Anmeldung hält 30 Tage in einem HttpOnly-Cookie. Abmelden über den Link
oben im Panel bzw. unten auf dem Startbildschirm. Gegen Durchprobieren sind
zehn Versuche je Minute und Absenderadresse erlaubt. Eine Sperre im
Admin-Panel wirkt sofort — eine bereits laufende Sitzung des gesperrten
Kontos stirbt beim nächsten Zugriff, nicht erst wenn das Cookie abläuft.

---

## E-Mail

**Optional.** Ohne Mailserver funktioniert alles wie zuvor: Der Admin legt ein
Konto an, liest das erzeugte Passwort einmalig im Panel ab und gibt es selbst
weiter. Mit Mailserver kommen zwei Dinge dazu:

- **Willkommens-Mail** an ein neu angelegtes Konto, mit Adresse, Benutzername
  und Passwort. Ein Kreuzchen im Anlegen-Formular, kein Automatismus — wer
  zwanzig Konten für einen Kurs anlegt und die Zugänge ausdruckt, lässt es
  weg. Beim Zurücksetzen eines Passworts geht das neue automatisch mit.
- **„Passwort vergessen"** auf der Anmeldeseite. Der Spieler gibt seine
  Adresse ein und bekommt einen Link, der **zwei Stunden** und **genau einmal**
  gilt. Ohne Mailserver ist der Link gar nicht erst sichtbar.

Die Zugangsdaten des Postfachs stehen **in Dockge**, nicht im Panel — genau
wie das Admin-Passwort. Das Panel zeigt die Einstellung nur an (ohne das
Passwort) und kann eine Testmail schicken.

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `REACTORSIM_SMTP_HOST` | — | Mailserver. Ohne ihn ist der Versand aus. |
| `REACTORSIM_SMTP_PORT` | je nach Verschlüsselung | 587 (starttls), 465 (ssl), 25 (none) |
| `REACTORSIM_SMTP_SECURITY` | `starttls` | `starttls`, `ssl` oder `none` |
| `REACTORSIM_SMTP_USER` | — | Postfach. Leer lassen für einen Server ohne Anmeldung. |
| `REACTORSIM_SMTP_PASSWORD` | — | Passwort des Postfachs |
| `REACTORSIM_SMTP_FROM` | Wert von `_USER` | Absenderadresse |
| `REACTORSIM_SMTP_TIMEOUT` | `20` | Sekunden, bis ein stummer Mailserver aufgegeben wird |
| `REACTORSIM_PUBLIC_URL` | Adresse der Anfrage | Basis für die Links **in** den Mails |

`REACTORSIM_PUBLIC_URL` ist der Wert, den man am leichtesten vergisst. Ein
Link in einer Mail wird gelesen, wenn von der ursprünglichen Anfrage nichts
mehr da ist — er muss deshalb die Adresse tragen, unter der die Anlage von
außen erreichbar ist (`https://reactorsim.example.net`), nicht die, unter der
der Container gerade zufällig angesprochen wurde. Ohne die Angabe rät
ReactorSim aus der laufenden Anfrage; hinter einem Reverse Proxy stimmt das
meistens, aber eben nicht immer.

**Zuerst die Testmail.** Im Panel unter „E-Mail-Server" eine Adresse eintragen
und senden. Kommt sie nicht an, steht der Grund im Panel und ausführlicher im
Protokoll (`docker compose logs reactorsim`):

| Meldung | Meistens |
|---|---|
| Anmeldung abgelehnt | Postfach oder Passwort falsch |
| nicht erreichbar | Hostname, Port oder Verschlüsselung falsch |
| Empfänger abgelehnt | Absenderadresse gehört nicht zum Postfach |

Verschickt wird **reiner Text** — kein HTML, kein nachgeladenes Bild, kein
Zählpixel. Die Mails enthalten das Passwort im Klartext; das ist dieselbe
Zeichenkette, die sonst im Panel steht und von Hand weitergereicht würde.
Wem das zu viel ist, lässt den Mailserver weg oder das Kreuzchen leer.

**Was gegen Missbrauch spricht:** „Passwort vergessen" antwortet immer gleich,
ob es die Adresse gibt oder nicht — sonst ließe sich darüber der Kontobestand
abfragen. Pro Absenderadresse sind fünf Anfragen je Stunde erlaubt, pro
E-Mail-Adresse drei. Gespeichert wird nur der Abdruck des Links, nie der Link
selbst.

---

## Hinter einem Reverse Proxy

Empfohlen, sobald der Server aus dem Internet erreichbar ist. Dann soll der
Port **nicht** offen im Netz stehen, sondern nur lokal — der Proxy holt ihn
sich von dort:

```yaml
    ports:
      - "127.0.0.1:17779:17779"
```

Im Proxy (NPMplus, Nginx Proxy Manager, Caddy, Traefik) ein normales
HTTP-Ziel auf `127.0.0.1:17779`. Zu beachten ist nichts Besonderes:

- **Keine WebSockets.** Die Simulation läuft im Browser; der Server liefert nur
  die Seite und ein paar kleine JSON-Antworten.
- **Keine Sticky Sessions**, kein Zustand im Server-Speicher.
- **Latenz ist gleichgültig.** Zwischen Browser und Server geht nach dem Laden
  fast nichts mehr hin und her — ein Reaktor auf einem Server in Finnland fährt
  sich genauso flüssig wie einer auf dem Rechner nebenan.

**Absenderadresse (`X-Forwarded-For`):** Waitress selbst kennt keinen Proxy;
ReactorSim korrigiert die Adresse deshalb per `ProxyFix` (Werkzeug) um genau
**einen** vertrauenswürdigen Hop. Das passt für den ueblichen Aufbau oben --
ein einzelner Reverse Proxy direkt vor dem Container. Steht ein **weiterer**
Proxy davor (z. B. Cloudflare vor Traefik, oder ein zweiter interner
Load-Balancer), muss die Zahl der Hops in `app.py` (`x_for=1`) entsprechend
erhöht werden — sonst zeigt das Admin-Panel bei "Letzte Adresse" die IP des
inneren statt des tatsächlichen Proxys, oder (bei zu hoch angesetztem Wert)
liesse sich die Adresse ueber den Header faelschen. Ohne jeden Reverse Proxy
(Container direkt im Netz erreichbar) muesste `x_for` stattdessen auf `0`
stehen, sonst liest ReactorSim die Adresse aus einem vom Client frei
waehlbaren Header statt aus der echten Verbindung.

Läuft der Proxy in einem eigenen Container statt im Host-Netz, muss stattdessen
ein gemeinsames Docker-Netz her:

```yaml
services:
  reactorsim:
    image: ghcr.io/luckytriple7/reactorsim:latest
    container_name: reactorsim
    restart: unless-stopped
    volumes:
      - ./data:/data
    networks:
      - proxy
    # ports entfällt komplett — der Proxy erreicht den Container über das Netz
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:17779/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  proxy:
    external: true
```

Im Proxy zeigt das Ziel dann auf `http://reactorsim:17779` — auf den
Containernamen, nicht auf eine IP. Docker vergibt die IP bei jedem Neustart
neu, der Name bleibt.

---

## Version festnageln statt `latest`

`latest` holt beim nächsten `docker compose pull` die neueste Fassung. Wenn du
lieber selbst bestimmst, wann sich etwas ändert:

```yaml
    image: ghcr.io/luckytriple7/reactorsim:0.0.13
```

Verfügbare Marken siehst du unter
`https://github.com/LuckyTriple7?tab=packages`.

Aktualisieren in Dockge: **Update** am Stack, oder auf der Kommandozeile

```bash
cd /opt/stacks/reactorsim
docker compose pull && docker compose up -d
```

Der Datenordner bleibt dabei unberührt.

---

## Daten und Sicherung

Unter `./data` liegen:

```
data/
├── auth.json             Hash des Admin-Passworts (0600)
├── secret.key            Signierschlüssel der Sitzungen (0600)
├── sessions.json         Sitzungskennung je Spielerkonto (Ein-Geraet-Sperre)
├── users.db              Spielerkonten, Anmelde- und Spielhistorie, offene
│                         Passwort-Links (SQLite)
├── highscores.json       Bestenliste
└── players/<hash>/       Spielstände je Konto
```

`auth.json` und `secret.key` gehören in die Sicherung, sonst muss der Admin
sich neu anmelden — und ohne `auth.json` gilt ein erzeugtes Admin-Passwort
nicht mehr. Wer `REACTORSIM_PASSWORD` setzt, ist davon unabhängig. `users.db`
gehört ebenso in die Sicherung: ohne sie sind alle Spielerkonten weg, nicht
nur deren Sitzungen.

Sichern heißt: den Ordner `data` kopieren. SQLite schreibt im WAL-Modus; ein
Kopiervorgang im laufenden Betrieb kann dabei theoretisch eine zu diesem
Zeitpunkt offene Transaktion erwischen. Für eine unter Last laufende Anlage
also nach Möglichkeit kurz `docker compose stop` vor dem Kopieren, bei einer
ruhigen Instanz reicht der Kopiervorgang im laufenden Betrieb in aller Regel.

**Personenbezogene Daten:** Seit den Spielerkonten anders als zuvor. Jedes
Konto trägt eine E-Mail-Adresse als Benutzername, dazu Anmeldezeitpunkt und
Absenderadresse je Login sowie Reaktortyp, Szenario, Art, Dauer und Ausgang
je **beendetem** Spiellauf — nicht mehr nur je ausgewertetem (alles in
`users.db`, sichtbar nur im Admin-Panel). Die Historie wächst damit deutlich
schneller als zuvor und ist zugleich aussagekräftiger: Sie zeigt, wann jemand
wie lange gespielt hat. Wer den Server für andere Personen betreibt, sollte
das je nach Kontext (Datenschutz) berücksichtigen. Ist ein Mailserver
eingerichtet, gehen außerdem E-Mail-Adressen der Spieler an diesen Server.

---

## Ressourcen

Der Container braucht im Leerlauf rund 60 MB Arbeitsspeicher und praktisch
keine CPU — die Physik rechnet der Browser des Spielers, nicht der Server. Ein
Server mit 1 GB RAM trägt ihn mühelos neben allem anderen.

Wer es begrenzen will:

```yaml
    deploy:
      resources:
        limits:
          memory: 256M
```

---

## Mehrere Instanzen

ReactorSim kennt keine Instanzsperre. Mehrere Stacks nebeneinander brauchen nur
je einen eigenen Host-Port, einen eigenen `container_name` und einen eigenen
Ordner — `./data` zeigt in Dockge automatisch in den jeweiligen Stack-Ordner.

```
/opt/stacks/
├── reactorsim/       compose.yaml  data     Port 17779
└── reactorsim-test/  compose.yaml  data     Port 17780
```

---

## Wenn es nicht läuft

```bash
cd /opt/stacks/reactorsim
docker compose logs --tail 50 reactorsim
curl -s http://127.0.0.1:17779/health
```

Beim Start steht genau eine Zeile im Protokoll:

```
[INFO] [2026-09-11 15:33:52] ReactorSim 0.0.10 laeuft auf Port 17779
```

Kommt sie nicht, ist der Container gar nicht hochgekommen — dann sagt
`docker compose logs` warum. Antwortet `/health` mit
`{"status":"ok","version":"…"}`, läuft der Dienst, und ein Problem liegt
zwischen Browser und Server (Port, Firewall, Proxy).
