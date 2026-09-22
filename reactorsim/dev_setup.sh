#!/bin/sh
# Entwicklungsumgebung herrichten -- lokaler Start (dev_run.py), Python-Tests
# und Browsertests. Mehrfach ausfuehrbar, tut beim zweiten Mal nichts Neues.
#
# Warum es das gibt: im Webtop liegen /config und /share auf einem echten
# Datentraeger, / dagegen im Overlay des Containers. Alles, was hier
# installiert wird, landet unter /config (pip --user, Playwright-Browser) oder
# im Projekt selbst (node_modules) und ueberlebt damit einen Neustart. Wird
# das Webtop-Image dagegen erneuert, ist der Overlay weg und mit ihm die
# Python- und Node-Fassung -- dann stellt dieser Aufruf alles wieder her.
#
# Wird nicht ins Image kopiert.
set -e

cd "$(dirname "$0")"

echo "== Python =="
python3 --version
# --user: landet in /config/.local, nicht im Overlay. Die Skripte dort liegen
# nicht auf PATH, deshalb ruft alles hier python3 -m <modul> auf.
python3 -m pip install --user --quiet --disable-pip-version-check -r requirements.txt
python3 -m pip install --user --quiet --disable-pip-version-check pytest
python3 -c 'from importlib.metadata import version; print("flask", version("flask"), "/ waitress", version("waitress"), "/ pytest", version("pytest"))'

echo
echo "== Browser =="
# playwright-core laedt im Gegensatz zu playwright nie selbst einen Browser
# herunter; es nimmt, was im Cache liegt. Die Fassung in package.json gehoert
# deshalb zur Revision dieses Cache -- passt sie nicht, meldet der erste
# Testlauf "Executable doesn't exist" und will 600 MB ziehen.
CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ls "$CACHE"/chromium-* >/dev/null 2>&1; then
    echo "Chromium im Cache: $(ls -d "$CACHE"/chromium-* | head -n 1)"
else
    echo "Kein Chromium unter $CACHE." >&2
    echo "Einmalig nachholen mit: npx playwright@1.60.0 install --with-deps chromium" >&2
fi

echo
echo "== Node =="
node --version
# npm ci braucht die Sperrdatei und raeumt node_modules vorher aus; beim
# allerersten Mal (noch keine package-lock.json) gibt es nur npm install.
if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
else
    npm install --no-audit --no-fund
fi

echo
echo "Fertig. Tests:"
echo "  python3 -m pytest tests/ -q     # Server und Vorlagen"
echo "  node --test tests/              # Simulation und Oberflaeche"
echo "  npm run test:browser            # Startbildschirm im echten Chromium"
echo "Spielen: python3 dev_run.py"
