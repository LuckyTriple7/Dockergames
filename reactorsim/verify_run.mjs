#!/usr/bin/env node
// Serverseitige Nachrechnung eines Laufs -- dünne Kommandozeilenhülle um
// static/js/game/replay.js, das die eigentliche Arbeit macht (siehe dort für
// den Determinismus, auf dem das beruht). app.py ruft dieses Skript je
// eingereichter Wertung auf, wenn ein Protokoll mitgeschickt wurde, und
// ERSETZT die vom Client gemeldeten Kennzahlen durch das Ergebnis hier --
// der Client muss dem Server dann nichts mehr glauben.
//
// stdin:  {"reactor": "pwr", "scenarioFile": "pwr_porv_stuck.json", "log": [...]}
// stdout: {"summary": {...}}  oder  {"error": "<Grund>"}
// exitCode 0 nur bei Erfolg -- app.py wertet beides aus, nicht nur stdout.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getPlant } from './static/js/plants/index.js';
import { replayRun } from './static/js/game/replay.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = join(HERE, 'static', 'data', 'scenarios');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function fail(reason) {
  process.stdout.write(JSON.stringify({ error: reason }));
  process.exitCode = 1;
}

async function main() {
  let req;
  try {
    req = JSON.parse(await readStdin());
  } catch {
    fail('bad_json');
    return;
  }
  const { reactor, scenarioFile, log } = req || {};

  const plant = getPlant(reactor);
  if (!plant) { fail('unknown_reactor'); return; }
  if (typeof scenarioFile !== 'string' || scenarioFile.includes('/') || scenarioFile.includes('\\')) {
    // Kein Pfad von aussen -- app.py schickt immer nur den blanken Dateinamen
    // aus seiner eigenen Szenario-Whitelist (SCENARIO_BY_ID), nie das, was
    // im Request stand. Diese Prüfung ist die zweite Absicherung, nicht die
    // einzige.
    fail('bad_scenario_file');
    return;
  }
  if (!Array.isArray(log)) { fail('bad_log'); return; }

  let scenarioDef;
  try {
    scenarioDef = JSON.parse(readFileSync(join(SCENARIO_DIR, scenarioFile), 'utf8'));
  } catch {
    fail('scenario_not_found');
    return;
  }

  let summary;
  try {
    summary = replayRun(plant, scenarioDef, log);
  } catch (err) {
    process.stderr.write(String((err && err.stack) || err) + '\n');
    fail('replay_exception');
    return;
  }

  if (!summary) { fail('no_result'); return; }
  process.stdout.write(JSON.stringify({ summary }));
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || err) + '\n');
  fail('exception');
});
