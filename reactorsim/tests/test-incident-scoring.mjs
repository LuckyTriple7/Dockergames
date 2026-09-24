import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { score } from '../static/js/game/scoring.js';
import { replayRun } from '../static/js/game/replay.js';
import { getPlant } from '../static/js/plants/index.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/scoring.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(fixture.name, () => {
    const result = score(fixture.summary);
    assert.equal(result.score, fixture.score);
    assert.ok(Math.abs(Object.values(result.parts).reduce((a, b) => a + b, 0) - result.score) < 1e-9);
    for (const [key, value] of Object.entries(fixture.parts || {})) {
      assert.equal(result.parts[key], value, key);
    }
    const legacyKeys = Object.keys(score({}).parts);
    if (fixture.summary.score_mode === 'incident_v1') {
      assert.deepEqual(Object.keys(result.parts).sort(), [...legacyKeys, 'objectives'].sort());
      for (const key of ['energy', 'deviation', 'scram', 'violations_info', 'violations_warn', 'violations_trip', 'floor_adjustment']) {
        assert.equal(result.parts[key], 0, key);
      }
    } else {
      assert.deepEqual(Object.keys(result.parts).sort(), legacyKeys.sort());
    }
  });
}

test('replay ignores inherited action names', () => {
  const scenario = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_feedwater_loss.json', import.meta.url), 'utf8'));
  const idle = replayRun(getPlant('pwr'), scenario, []);
  const injected = replayRun(getPlant('pwr'), scenario,
    ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map(id => ({n: 0, id, value: {met: true}})));
  assert.deepEqual(injected, idle);
});
