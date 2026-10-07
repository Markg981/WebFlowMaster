import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createCollaudoServer } from './server.mjs';

test('historical cycles stay frozen while the current catalog is available without creating a cycle', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wfm-collaudo-browser-'));
  const servers = [];
  let browser;
  t.after(async () => {
    await browser?.close();
    for (const server of servers)
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const current = JSON.parse(await readFile(new URL('../casi.json', import.meta.url), 'utf8'));
  const historical = structuredClone(current);
  historical.version = 16;
  historical.cases = [current.cases[0]];
  const oldServer = await createCollaudoServer({ directory, initialCatalog: historical });
  servers.push(oldServer);
  await new Promise((resolve) => oldServer.listen(0, '127.0.0.1', resolve));
  const oldBase = `http://127.0.0.1:${oldServer.address().port}`;
  const cycle = await (
    await fetch(oldBase + '/api/cycles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: oldBase },
      body: JSON.stringify({ name: 'Storico' }),
    })
  ).json();
  await new Promise((resolve) => oldServer.close(resolve));
  const server = await createCollaudoServer({ directory, initialCatalog: current });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.waitForSelector('#areas .case');
  assert.equal(await page.locator('#areas .case').count(), 1);
  assert.match(await page.locator('#catalogNotice').innerText(), /versione 16/);
  assert.match(
    await page.locator('#catalogNotice').innerText(),
    new RegExp(`versione ${current.version}`),
  );
  // Switching to the preview first flushes the historical note to its own cycle.
  await page.locator('[data-expand]').first().click();
  await page.locator('[data-note]').first().fill('Nota storica da conservare');
  await page.locator('#cycleSelect').selectOption('');
  await page.waitForSelector('#QUO-01');
  assert.equal(await page.locator('#areas .case').count(), current.cases.length);
  assert.equal(await page.locator('#TEL-01').count(), 1);
  const automationCases = current.cases.filter((item) => item.area === 'AUT');
  for (const id of ['AUT-10', 'AUT-11', 'AUT-12'])
    assert.ok(automationCases.some((item) => item.id === id), `${id} is in the current catalog`);
  for (const item of automationCases)
    assert.equal(await page.locator(`#${item.id}`).count(), 1);
  await page.locator('#AUT-01 [data-expand]').click();
  assert.match(await page.locator('#AUT-01').innerText(), /recovery/i);
  assert.equal(await page.locator('[data-set]:enabled').count(), 0);
  assert.equal(await page.locator('[data-note]:enabled').count(), 0);
  assert.equal(await page.locator('#exportBtn').isDisabled(), true);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.cycles.length, 1);
  assert.equal(state.results[cycle.id][current.cases[0].id].note, 'Nota storica da conservare');
  // Preview survives reloads caused by importing the same backup.
  await page.locator('#pasteBtn').click();
  await page
    .locator('#importText')
    .fill(JSON.stringify(await (await fetch(base + '/api/backup')).json()));
  await page.locator('#importForm button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#importDialog').open);
  assert.equal(await page.locator('#cycleSelect').inputValue(), '');
  await page.locator('#newCycleBtn').click();
  await page.locator('#cycleForm [name=name]').fill('Attuale');
  await page.locator('#cycleForm button[type=submit]').click();
  await page.waitForFunction(
    () => document.querySelector('#cycleSelect').selectedOptions[0].textContent === 'Attuale',
  );
  assert.equal(await page.locator('#catalogNotice').isVisible(), false);
  assert.equal(await page.locator('#exportBtn').isDisabled(), false);
  assert.equal(await page.locator('[data-set]:enabled').count(), current.cases.length * 4);
  assert.equal(await page.locator('.case[data-status=todo]').count(), current.cases.length);
  const updatedState = await (await fetch(base + '/api/state')).json();
  const currentCycleId = await page.locator('#cycleSelect').inputValue();
  for (const item of current.cases.filter((item) => item.area === 'AUT')) {
    assert.equal(updatedState.results[currentCycleId][item.id], undefined);
    assert.equal(await page.locator(`#${item.id}`).getAttribute('data-status'), 'todo');
  }
  await page.locator('#cycleSelect').selectOption(cycle.id);
  await page.waitForFunction(() => document.querySelectorAll('#areas .case').length === 1);
  assert.equal(await page.locator('[id^="AUT-"]').count(), 0);
  assert.match(
    await page.locator('[data-note]').first().inputValue(),
    /Nota storica da conservare/,
  );
  assert.match(
    await (await fetch(base + '/api/csv?cycle=' + cycle.id)).text(),
    /Nota storica da conservare/,
  );
  // New areas remain usable on a narrow viewport.
  await page.locator('#cycleSelect').selectOption('');
  await page.waitForSelector('#QUO-01');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#fArea').selectOption('AUT');
  assert.equal(
    await page.locator('#areas .case').count(),
    current.cases.filter((c) => c.area === 'AUT').length,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
