// Das Bild fuer den Zweitbildschirm: was drin steht, was NICHT drin steht,
// und ob der Empfaenger daraus dieselben Anzeigen bekommt wie der Sender.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { pack } from '../static/js/net/persist.js';
import { TrendHistory } from '../static/js/game/trendHistory.js';
import { packFrame, applyFrame, FRAME_VERSION } from '../static/js/net/monitorFrame.js';
import { monitorReason, STALE_S, LOST_S } from '../static/js/net/monitorStatus.js';

const json = (value) => JSON.parse(JSON.stringify(value));

/** Ein Lauf, der schon etwas erlebt hat: abgeschaltet, Nachwaerme, Xenon im
 *  Aufbau, Regler in einer anderen Phase als beim Start. Ein frisch gebauter
 *  Motor wuerde auch ohne jedes uebertragene Feld gleich aussehen. */
function stirred(id, steps = 600) {
  const engine = createEngine(getPlant(id));
  engine.scram('test');
  for (let i = 0; i < steps; i++) engine.step(0.05);
  return engine;
}

for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: der Monitor zeigt dieselben Werte wie der Leitstand`, () => {
    const live = stirred(id);
    const seen = createEngine(getPlant(id));
    assert.equal(applyFrame(json(packFrame(live, {}, 1)), seen), null);

    // derive() ist genau das, was auf den Instrumenten landet (siehe
    // ui/panels.js) -- stimmt es ueberein, stimmt die Anzeige.
    const a = live.derive();
    const b = seen.derive();
    for (const key of Object.keys(a)) {
      if (typeof a[key] !== 'number') continue;
      assert.ok(Math.abs(a[key] - b[key]) < 1e-9, `${key}: ${a[key]} gegen ${b[key]}`);
    }
    assert.deepEqual(seen.state.rod, live.state.rod);
    assert.equal(seen.state.scram.active, live.state.scram.active);
    assert.equal(seen.state.t_sim, live.state.t_sim);
  });

  test(`${id}: der Quittierstand der Meldetafel kommt mit`, () => {
    const live = stirred(id);
    const before = live.trips.tiles().map((x) => x.tile).join(',');
    const seen = createEngine(getPlant(id));
    assert.equal(applyFrame(json(packFrame(live, {}, 1)), seen), null);
    assert.equal(seen.trips.tiles().map((x) => x.tile).join(','), before);
  });
}

test('das Bild traegt die Trendhistorie NICHT -- sie ist der Grund fuer die eigene Datei', () => {
  const live = stirred('pwr', 2400);
  new TrendHistory(live);
  for (let i = 0; i < 2400; i++) { live.step(0.05); live.ctx.trends.sample(); }

  const frame = packFrame(live, {}, 1);
  assert.equal(frame.trends, undefined);
  assert.equal(frame.learning, undefined);
  assert.equal(frame.rng, undefined);

  // Schon nach vierzig Minuten Betrieb ist allein der Trendblock eines
  // Spielstands groesser als das ganze Monitorbild -- und er waechst mit der
  // Laufzeit weiter, bis acht Stunden drin sind (28.800 Abtastungen). Das
  // zweimal je Sekunde zu verschicken waere die Leitung, nicht das Bild.
  const save = pack(live);
  const trends = JSON.stringify(save.trends).length;
  const wire = JSON.stringify(frame).length;
  assert.ok(wire < trends, `Bild ${wire} B gegen Trendblock ${trends} B`);
  assert.ok(wire < JSON.stringify(save).length);
});

test('das Meldungsprotokoll kommt nur in jedem zehnten Bild mit', () => {
  const live = stirred('rbmk');
  live.drainLog();
  const withLog = [];
  for (let seq = 1; seq <= 20; seq++) {
    if (packFrame(live, {}, seq).history !== undefined) withLog.push(seq);
  }
  assert.deepEqual(withLog, [10, 20]);
});

test('ein Bild aus einer anderen Ausgabe oder von einem anderen Typ wird abgewiesen', () => {
  const live = stirred('pwr');
  const seen = createEngine(getPlant('pwr'));
  const frame = json(packFrame(live, {}, 1));

  assert.equal(applyFrame({ ...frame, v: FRAME_VERSION + 1 }, seen), 'version');
  assert.equal(applyFrame({ ...frame, reactor: 'bwr' }, seen), 'reactor');
  assert.equal(applyFrame({ ...frame, state: null }, seen), 'shape');
  assert.equal(applyFrame(null, seen), 'version');

  // Nichts davon darf halb angekommen sein.
  assert.equal(seen.state.t_sim, 0);
});

test('ein unmoeglicher Wert im Bild wird abgewiesen, nicht angezeigt', () => {
  const live = stirred('pwr');
  const seen = createEngine(getPlant('pwr'));
  const frame = json(packFrame(live, {}, 1));
  frame.state.T_f = null;
  frame.state.rod = [0.4, Number.NaN];
  // JSON kennt kein NaN -- ueber die Leitung kaeme null. Beide Formen muessen
  // scheitern, und zwar BEVOR sie im Zustand stehen.
  assert.equal(applyFrame({ ...frame, state: { ...frame.state, rod: [0.4, 'x'] } }, seen), 'array:rod');
  assert.equal(seen.state.t_sim, 0);
});

test('Bilder laufen nicht auseinander: zwanzig hintereinander enden im selben Zustand', () => {
  const live = stirred('rbmk');
  const seen = createEngine(getPlant('rbmk'));
  for (let seq = 1; seq <= 20; seq++) {
    for (let i = 0; i < 10; i++) live.step(0.05);
    assert.equal(applyFrame(json(packFrame(live, {}, seq)), seen), null);
  }
  // Kein Aufsummieren, kein Nachlaufen: der letzte Stand ist der letzte
  // Stand, ganz gleich wie viele Bilder davor lagen.
  assert.equal(seen.state.t_sim, live.state.t_sim);
  assert.ok(Math.abs(seen.derive().power_th_pct - live.derive().power_th_pct) < 1e-9);
});

test('die Kopfdaten des Senders kommen unveraendert an', () => {
  const live = stirred('pwr');
  const meta = { run: 'abc', scenario: 'pwr_load_follow', speed: 60, hidden: true,
    gridFail: { mw: 40, for_s: 120 } };
  const frame = json(packFrame(live, meta, 7));
  assert.deepEqual(frame.meta, meta);
  assert.equal(frame.seq, 7);
  assert.equal(frame.reactor, 'pwr');
});

// ── Was oben in der Zeile steht ──────────────────────────────────────────────
//
// Die Reihenfolge ist der Inhalt: ein minimierter Leitstand schickt nichts
// mehr, sein Bild altert also genau wie bei abgerissenem Netz. Wer nur aufs
// Alter schaut, meldet "keine Verbindung" fuer etwas, das in Ordnung ist.

const reason = (over) => monitorReason({ state: 'live', age: 0, meta: {}, error: null, ...over });

test('im Normalfall sagt die Zeile, dass dieser Schirm nur zusieht', () => {
  assert.deepEqual(reason({}), { key: 'monitor_live', sev: 'ok' });
});

test('ein stehendes Bild wird grau, bevor es als tot gilt', () => {
  assert.equal(reason({ age: STALE_S - 0.1 }).key, 'monitor_live');
  assert.equal(reason({ age: STALE_S + 0.1 }).sev, 'warn');
  assert.equal(reason({ age: STALE_S + 0.1 }).key, 'monitor_stale');
  assert.deepEqual(reason({ age: LOST_S + 0.1 }), { key: 'monitor_lost', sev: 'bad' });
});

test('minimiert schlaegt alt -- sonst hiesse ein ruhender Leitstand "keine Verbindung"', () => {
  // Genau der Fall, um den es geht: der Reiter liegt seit fuenf Minuten im
  // Hintergrund, das Bild ist uralt, aber nichts ist kaputt.
  assert.equal(reason({ meta: { hidden: true }, age: 300 }).key, 'monitor_hidden');
  assert.equal(reason({ meta: { ended: true }, age: 300 }).key, 'monitor_ended');
  assert.equal(reason({ meta: { closed: true }, age: 300 }).key, 'monitor_closed');
  // Und die drei untereinander: geschlossen ist endgueltiger als beendet,
  // beendet endgueltiger als nur weggeklickt.
  assert.equal(reason({ meta: { closed: true, ended: true, hidden: true } }).key, 'monitor_closed');
  assert.equal(reason({ meta: { ended: true, hidden: true } }).key, 'monitor_ended');
});

test('angehalten gilt nur, solange Bilder ankommen', () => {
  // Pause haelt engine.step() an, nicht den Renderlauf -- ein pausierter
  // Leitstand sendet weiter.
  assert.equal(reason({ meta: { speed: 0 } }).key, 'monitor_paused');
  assert.equal(reason({ meta: { speed: 0 }, age: STALE_S + 1 }).key, 'monitor_paused');
  // Bleibt sein Bild trotzdem aus, ist die Pause nicht mehr die Erklaerung.
  assert.equal(reason({ meta: { speed: 0 }, age: LOST_S + 1 }).key, 'monitor_lost');
});

test('ohne brauchbares Bild wird gar nicht erst nach einem Grund gesucht', () => {
  // Ein Grund aus einem Bild, das nicht uebernommen werden konnte, waere
  // selbst nicht zu gebrauchen.
  assert.equal(reason({ error: 'version', meta: { hidden: true } }).key, 'monitor_bad_frame');
  assert.equal(reason({ state: 'offline', meta: { ended: true } }).key, 'monitor_offline');
  assert.equal(reason({ state: 'none', meta: { hidden: true } }).key, 'monitor_none');
  assert.equal(reason({ state: 'wait', age: Infinity, meta: null }).key, 'monitor_wait');
});

test('jeder Grund hat einen Text in beiden Sprachen', async () => {
  const { readFileSync } = await import('node:fs');
  const de = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'));
  const keys = new Set();
  for (const state of ['live', 'offline', 'none', 'wait']) {
    for (const age of [0, 5, 60]) {
      for (const meta of [{}, { hidden: true }, { ended: true }, { closed: true }, { speed: 0 }]) {
        for (const error of [null, 'version']) {
          keys.add(monitorReason({ state, age, meta, error }).key);
        }
      }
    }
  }
  assert.ok(keys.size >= 9, [...keys].join(','));
  for (const key of keys) {
    assert.ok(de[key], `de fehlt ${key}`);
    assert.ok(en[key], `en fehlt ${key}`);
  }
});
