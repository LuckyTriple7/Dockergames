// Huelle fuer die Browsertests: echte App, echter Browser, echtes HTTP.
//
// Die uebrigen Tests unter tests/ laden einzelne Module und stellen sich die
// Umgebung nach. Das faengt Rechenfehler, aber nichts, was erst im Browser
// entsteht -- eine Zeile, die CSS trotz `hidden` weiter anzeigt, ein Knopf,
// den ein anderes Element ueberdeckt. Dafuer starten die Tests hier eine
// eigene Instanz auf einem freien Port mit einem frischen Datenverzeichnis
// (nie dev_data/) und fahren sie mit Chromium an.
//
// Laufen NICHT bei `node --test tests/` mit: der Standardlauf sammelt
// `test-*.mjs`, diese Dateien heissen `browser-*.mjs`. Start mit
// `npm run test:browser`, Einrichtung mit `./dev_setup.sh`.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ACCOUNT = 'browsertest@example.invalid';
const PASSWORD = 'Browsertest-1234';

/** @return playwright-core oder ein Abbruch, der sagt, was zu tun ist. */
export async function playwright() {
  try {
    return await import('playwright-core');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('playwright-core fehlt -- einmal ./dev_setup.sh ausfuehren.');
  }
}

/**
 * Freier Port vom Betriebssystem: Port 0 binden, die Nummer ablesen, wieder
 * schliessen. Ein fester Port kollidiert sonst mit der Instanz, die nebenher
 * zum Ausprobieren laeuft.
 */
async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * ReactorSim hochfahren und warten, bis /health antwortet.
 * @return {{url, account, password, stop}} stop() beendet sie und raeumt das
 *         Datenverzeichnis weg -- gehoert in ein finally, sonst bleibt ein
 *         Python-Prozess stehen.
 */
export async function startApp() {
  const data = await mkdtemp(join(tmpdir(), 'reactorsim-browsertest-'));
  const port = await freePort();
  const child = spawn('python3', [join(HERE, 'browser_fixture.py'), data, String(port), ACCOUNT, PASSWORD],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });

  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exited === null) child.kill('SIGTERM');
    await rm(data, { recursive: true, force: true });
  };

  // 30 s: der erste Start legt Schluessel und Datenbanken an. Faellt der
  // Prozess vorher, steht der Grund in seiner Ausgabe -- die gehoert in die
  // Fehlermeldung, sonst steht da nur eine abgelaufene Frist.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      await stop();
      throw new Error(`ReactorSim startete nicht (Code ${exited}):\n${log}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return { url, account: ACCOUNT, password: PASSWORD, stop };
    } catch { /* noch nicht offen */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop();
  throw new Error(`ReactorSim antwortete nicht auf ${url}/health:\n${log}`);
}

/**
 * Angemeldete Seite auf dem Startbildschirm.
 *
 * Das Startbanner faengt Klicks ab, und sein erster Klick blendet in den
 * ersten fuenf Sekunden nur das Logo ein (siehe dismissSplash in main.js) --
 * Enter blendet sofort aus, sonst wartet jeder Test fuenf Sekunden oder
 * klickt ins Banner statt auf die Reaktorkarte.
 */
export async function signIn(browser, app) {
  const page = await browser.newPage();
  await page.goto(`${app.url}/login`);
  await page.fill('input[name="user"]', app.account);
  await page.fill('input[name="password"]', app.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${app.url}/`);
  const splash = page.locator('#rs-splash');
  if (await splash.count()) {
    await splash.press('Enter');
    await splash.waitFor({ state: 'hidden' });
  }
  return page;
}
