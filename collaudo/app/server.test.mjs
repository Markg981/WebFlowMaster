import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollaudoServer } from './server.mjs';

const catalog = {
  version: 16,
  areas: [{ id: 'API', title: 'Test API', intro: '' }],
  cases: [
    {
      id: 'API-01',
      area: 'API',
      title: 'Una richiesta',
      priority: 'P1',
      actor: 'editor.a',
      preconditions: '',
      steps: ['Eseguire'],
      expected: 'Risposta valida',
    },
  ],
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wfm-collaudo-'));
  const server = await createCollaudoServer({ directory, initialCatalog: catalog });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, body, origin = base) =>
    fetch(
      base + path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify(body),
          },
    );
  return { directory, server, request, base };
}
test('cycles and notes survive restart and stale edits are refused', async (t) => {
  const f = await fixture(t);
  const cycle = await (
    await f.request('/api/cycles', {
      name: 'Collaudo',
      version: '6d007cf',
      environment: 'https://wfm.collaudo.test',
    })
  ).json();
  const saved = await f.request('/api/results', {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'pass',
    note: 'Verificato',
    tester: 'Marco',
    revision: 1,
  });
  assert.equal(saved.status, 200);
  const stale = await f.request('/api/results', {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'fail',
    note: '',
    tester: 'Marco',
    revision: 1,
  });
  assert.equal(stale.status, 409);
  const persisted = JSON.parse(await readFile(join(f.directory, 'state.json'), 'utf8'));
  assert.equal(persisted.results[cycle.id]['API-01'].note, 'Verificato');
  const reopened = await createCollaudoServer({ directory: f.directory, initialCatalog: catalog });
  await new Promise((resolve) => reopened.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => reopened.close(resolve)));
  const state = await (await fetch(`http://127.0.0.1:${reopened.address().port}/api/state`)).json();
  assert.equal(state.results[cycle.id]['API-01'].status, 'pass');
});
test('foreign origins and unknown cases cannot write results', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request('/api/cycles', { name: 'Bad' }, 'https://elsewhere.test')).status,
    403,
  );
  const cycle = await (await f.request('/api/cycles', { name: 'Local' })).json();
  assert.equal(
    (
      await f.request('/api/results', {
        cycleId: cycle.id,
        caseId: 'API-999',
        status: 'pass',
        note: '',
        tester: '',
        revision: 1,
      })
    ).status,
    400,
  );
});
test('import adds cases and historical outcomes without resetting current data', async (t) => {
  const f = await fixture(t);
  const imported = {
    catalog: { ...catalog, cases: [{ ...catalog.cases[0], id: 'API-02', title: 'Secondo' }] },
    state: {
      cycles: [{ id: 'history', name: 'Originale' }],
      results: {
        history: {
          'API-02': {
            status: 'block',
            note: 'Manca IdP',
            tester: 'Marco',
            recordedLabel: 'Registrato da Marco, 27/09/26, 10:04',
          },
        },
      },
    },
  };
  assert.equal((await f.request('/api/import', imported)).status, 200);
  const backup = await (await f.request('/api/backup')).json();
  assert.equal(backup.catalog.cases.length, 2);
  assert.equal(backup.state.results.history['API-02'].note, 'Manca IdP');
  assert.equal((await f.request('/api/import', imported)).status, 200);
  assert.equal((await (await f.request('/api/backup')).json()).catalog.cases.length, 2);
  imported.catalog.cases[0].title = 'Rimpiazzo silenzioso';
  assert.equal((await f.request('/api/import', imported)).status, 409);
});
test('malformed backups and unsupported states are rejected atomically', async (t) => {
  const f = await fixture(t);
  const before = await (await f.request('/api/backup')).json();
  const bad = {
    catalog,
    state: {
      cycles: [{ id: 'x', name: 'Bad' }],
      results: { x: { 'API-01': { status: 'inventato' } } },
    },
  };
  assert.equal((await f.request('/api/import', bad)).status, 400);
  assert.deepEqual(await (await f.request('/api/backup')).json(), before);
});
test('parallel edits cannot silently overwrite each other', async (t) => {
  const f = await fixture(t);
  const cycle = await (await f.request('/api/cycles', { name: 'Parallel' })).json();
  const body = {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'pass',
    note: '',
    tester: '',
    revision: 1,
  };
  const responses = await Promise.all([
    f.request('/api/results', body),
    f.request('/api/results', { ...body, status: 'fail' }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});

test('original presentation preserves original order and introductions before additions', async (t) => {
  const f = await fixture(t);
  const original = {
    ...catalog,
    areas: [
      { id: 'ACC', title: 'Accesso', intro: 'Introduzione originale' },
      { ...catalog.areas[0], intro: 'API originale' },
    ],
    cases: [{ ...catalog.cases[0], id: 'ACC-01', area: 'ACC' }],
    presentation: { css: 'body{margin:0}', preparationHtml: '<p>Preparazione</p>' },
  };
  assert.equal(
    (await f.request('/api/import', { catalog: original, state: { cycles: [], results: {} } }))
      .status,
    200,
  );
  const merged = await (await f.request('/api/catalog')).json();
  assert.deepEqual(
    merged.areas.map((area) => area.id),
    ['ACC', 'API'],
  );
  assert.deepEqual(
    merged.cases.map((item) => item.id),
    ['ACC-01', 'API-01'],
  );
  assert.equal(merged.areas[1].intro, 'API originale');
});

test('prototype keys and external CSS imports cannot enter a backup', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request('/api/import', {
        catalog,
        state: { cycles: [{ id: '__proto__', name: 'Invalid' }], results: {} },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/import', {
        catalog: {
          ...catalog,
          presentation: { css: '@import "https://elsewhere.test";', preparationHtml: '' },
        },
        state: { cycles: [], results: {} },
      })
    ).status,
    400,
  );
  assert.deepEqual((await (await f.request('/api/state')).json()).cycles, []);
});

test('downloads provide restorable JSON and CSV with escaped formulas and quotes', async (t) => {
  const f = await fixture(t);
  const cycle = await (await f.request('/api/cycles', { name: 'Export' })).json();
  await f.request('/api/results', {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'block',
    note: '=SUM(1;2)\n"quoted"',
    tester: 'Marco',
    revision: 1,
  });
  const backup = await f.request('/api/backup');
  assert.match(backup.headers.get('content-disposition'), /attachment.*collaudo-backup.json/);
  assert.equal((await backup.json()).state.results[cycle.id]['API-01'].status, 'block');
  const csv = await f.request('/api/csv?cycle=' + cycle.id);
  assert.match(csv.headers.get('content-disposition'), /attachment.*collaudo.csv/);
  const text = await csv.text();
  assert.match(text, /"Bloccato"/);
  assert.ok(text.includes('"\'=SUM(1;2)\n""quoted"""'));
  assert.equal((await f.request('/api/csv?cycle=unknown')).status, 400);
});
