// Die Klaenge haengen am Vorgang, nicht am Endbildschirm.
//
// Anlass: der Kernzerstoerungs-Klang kam aus showDestroyed()/showDebrief().
// Zwischen Brennstoffversagen und Fenster liegen aber mindestens drei
// Sekunden (DESTROY_PAUSE_MS), beim RBMK bis zu fuenfzehn, weil der Nachlauf
// vorher fertig sein soll -- der Ton kam also, wenn alles vorbei war.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createEndSounds } from '../static/js/game/endSounds.js';

function fakeHorn() {
  const played = [];
  return { played, meltdown() { played.push('meltdown'); }, explosion() { played.push('explosion'); } };
}

test('Brennstoffversagen klingt genau einmal, egal wie viele Bilder folgen', () => {
  const horn = fakeHorn();
  const sounds = createEndSounds(horn);
  const s = { destroyed: false };
  for (let i = 0; i < 5; i++) sounds.step(s);
  assert.deepEqual(horn.played, []);
  s.destroyed = true;
  for (let i = 0; i < 60; i++) sounds.step(s);
  assert.deepEqual(horn.played, ['meltdown']);
});

test('der haltende Deckel ist keine Explosion', () => {
  const horn = fakeHorn();
  const sounds = createEndSounds(horn);
  // done, aber lid === false: stepAftermath() hat gerechnet und entschieden,
  // dass der Schild liegen bleibt (event_lid_held).
  sounds.step({ destroyed: true, aftermath: { done: true, lid: false } });
  assert.deepEqual(horn.played, ['meltdown']);
});

test('ein noch laufender Nachlauf klingt noch nicht', () => {
  const horn = fakeHorn();
  const sounds = createEndSounds(horn);
  const s = { destroyed: true, aftermath: { done: false, lid: null } };
  sounds.step(s);
  assert.deepEqual(horn.played, ['meltdown']);
  // Erst wenn der Schild wirklich abhebt.
  s.aftermath = { done: true, lid: true };
  sounds.step(s);
  sounds.step(s);
  assert.deepEqual(horn.played, ['meltdown', 'explosion']);
});

test('die Wasserstoffexplosion haengt nicht an der Zerstoerung', () => {
  const horn = fakeHorn();
  const sounds = createEndSounds(horn);
  // SWR: sie kann in einem Lauf kommen, den der Spieler danach noch haelt.
  const s = { destroyed: false, h2Exploded: true };
  sounds.step(s);
  sounds.step(s);
  assert.deepEqual(horn.played, ['explosion']);
});

test('jeder Lauf faengt mit frischen Flanken an', () => {
  const horn = fakeHorn();
  const s = { destroyed: true, aftermath: { done: true, lid: true } };
  createEndSounds(horn).step(s);
  createEndSounds(horn).step(s);
  assert.deepEqual(horn.played, ['meltdown', 'explosion', 'meltdown', 'explosion']);
});

test('ohne Hupe und ohne Zustand passiert nichts', () => {
  createEndSounds(null).step({ destroyed: true });
  const horn = fakeHorn();
  createEndSounds(horn).step(null);
  assert.deepEqual(horn.played, []);
});

test('der Endbildschirm spielt keinen Klang mehr', () => {
  const main = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
  // showDestroyed() und showDebriefNow() riefen ihn frueher selbst -- ab
  // jetzt gibt es genau EINE Aufrufstelle, und die haengt am Zustand.
  assert.equal(main.includes('horn.meltdown()'), false);
  assert.match(main, /endSounds\?\.step\(state\)/);
});

test('der Explosionsklang ist von der Kernzerstoerung getrennt', () => {
  const annun = readFileSync(new URL('../static/js/ui/annunciator.js', import.meta.url), 'utf8');
  // Eigener Clip, nicht der der Kernzerstoerung -- und die Datei muss auch
  // wirklich ausgeliefert werden, sonst bleibt die Explosion still.
  const m = annun.match(/const EXPLOSION_CLIP = '([\w.-]+)';/);
  assert.ok(m, 'EXPLOSION_CLIP fehlt');
  assert.notEqual(m[1], 'game_over.mp3');
  assert.ok(existsSync(new URL(`../static/audio/${m[1]}`, import.meta.url)), `${m[1]} fehlt in static/audio`);
  assert.match(annun, /explosion\(\)\s*\{\s*if \(this\.enabled\) playClip\(EXPLOSION_CLIP\);/);
});
