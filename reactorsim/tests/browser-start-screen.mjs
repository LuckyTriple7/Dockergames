// Startbildschirm im echten Browser: was sichtbar ist, entscheidet hier das
// zusammengesetzte Ergebnis aus Markup, CSS und main.js -- nicht ein
// nachgestelltes DOM. Siehe tests/browser-helper.mjs fuer Start und Anmeldung.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { playwright, startApp, signIn } from './browser-helper.mjs';

const FREE_ONLY = ['#rs-cold-start-row', '#rs-free-setup', '#rs-free-setup-hint'];

let app;
let browser;

before(async () => {
  const { chromium } = await playwright();
  app = await startApp();
  browser = await chromium.launch();
}, { timeout: 60_000 });

after(async () => {
  await browser?.close();
  await app?.stop();
});

/** Reaktorbildschirm mit gefuellter Szenarienliste. */
async function openReactor(index = 0) {
  const page = await signIn(browser, app);
  await page.locator('.rs-card').nth(index).click();
  await page.waitForSelector('#rs-scn-list .rs-scn');
  return page;
}

async function visible(page, selectors) {
  const state = {};
  for (const selector of selectors) state[selector] = await page.locator(selector).isVisible();
  return state;
}

const all = (value) => Object.fromEntries(FREE_ONLY.map((selector) => [selector, value]));

test('the free-play settings follow the selection', async () => {
  const page = await openReactor();
  const cards = page.locator('#rs-scn-list .rs-scn');
  assert.ok(await cards.count() > 1, 'Reaktortyp ohne Szenario -- Test braucht beide Zustaende');

  // Karte 0 ist das freie Spiel, es ist beim Aufbau der Liste vorgewaehlt.
  assert.deepEqual(await visible(page, FREE_ONLY), all(true));
  await cards.nth(1).click();
  assert.deepEqual(await visible(page, FREE_ONLY), all(false));
  await cards.nth(0).click();
  assert.deepEqual(await visible(page, FREE_ONLY), all(true));
  await page.close();
});

test('switching reactors returns to free play and brings the settings back', async () => {
  const page = await openReactor();
  await page.locator('#rs-scn-list .rs-scn').nth(1).click();
  assert.deepEqual(await visible(page, FREE_ONLY), all(false));

  await page.locator('#rs-reactor-back').click();
  await page.locator('.rs-card').nth(1).click();
  await page.waitForSelector('#rs-scn-list .rs-scn');
  assert.deepEqual(await visible(page, FREE_ONLY), all(true));
  await page.close();
});

test('helper and debug toggles stay put -- they are not free-play only', async () => {
  const page = await openReactor();
  const always = ['#rs-helper-toggle', '#rs-debug-toggle'];
  assert.deepEqual(await visible(page, always), { '#rs-helper-toggle': true, '#rs-debug-toggle': true });
  await page.locator('#rs-scn-list .rs-scn').nth(1).click();
  assert.deepEqual(await visible(page, always), { '#rs-helper-toggle': true, '#rs-debug-toggle': true });
  await page.close();
});

test('no script error reaches the console on the way to the start screen', async () => {
  const page = await signIn(browser, app);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  await page.locator('.rs-card').first().click();
  await page.waitForSelector('#rs-scn-list .rs-scn');
  await page.locator('#rs-scn-list .rs-scn').nth(1).click();
  assert.deepEqual(problems, []);
  await page.close();
});
