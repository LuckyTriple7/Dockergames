#!/usr/bin/env python3
"""Eine ReactorSim-Instanz fuer die Browsertests.

    python3 tests/browser_fixture.py <datenverzeichnis> <port> <konto> <passwort>

Wie dev_run.py, aber mit frei waehlbarem Datenverzeichnis und Port und einem
gleich angelegten Spielerkonto -- der Startbildschirm liegt hinter dem Login,
ohne Konto kommt kein Browsertest dorthin. Das Verzeichnis legt der Aufrufer
an und raeumt es wieder weg (siehe tests/browser-helper.mjs); hier wird nichts
Bestehendes angefasst, damit ein Testlauf niemals dev_data/ oder gar die
Produktivdaten beruehrt.

Wird nicht ins Image kopiert (tests/ steht in .dockerignore).
"""

import os
import sys

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    data, port, account, password = argv[1:]

    os.environ['REACTORSIM_BASE'] = _HERE
    os.environ['REACTORSIM_DATA'] = data
    os.environ['REACTORSIM_PORT'] = port
    os.makedirs(data, exist_ok=True)
    sys.path.insert(0, _HERE)

    import app  # erst nach den Umgebungsvariablen, die liest app.py beim Laden

    row, err = app.USERS.create_user(account, password, created_by='browser-test')
    # 'exists' waere in Ordnung -- das Verzeichnis ist aber frisch, also ist
    # jeder Fehlschlag hier ein echter und keine Wiederholung.
    if not row:
        print(f'Testkonto nicht angelegt: {err}', file=sys.stderr)
        return 1

    app._serve()
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
