import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
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

test('catalogue updates keep cycle definitions, fingerprints and CSV frozen', async (t) => {
  const f = await fixture(t);
  const cycle = await (await f.request('/api/cycles', { name: 'Old' })).json();
  await f.request('/api/results', {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'pass',
    note: 'Original note',
    tester: 'Marco',
    revision: 1,
  });
  const updated = {
    ...catalog,
    version: 17,
    cases: [
      { ...catalog.cases[0], title: 'Changed title' },
      { ...catalog.cases[0], id: 'API-02', title: 'New case' },
    ],
  };
  const reopened = await createCollaudoServer({ directory: f.directory, initialCatalog: updated });
  await new Promise((resolve) => reopened.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => reopened.close(resolve)));
  const base = `http://127.0.0.1:${reopened.address().port}`;
  const request = (path, body) =>
    fetch(
      base + path,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: base },
            body: JSON.stringify(body),
          }
        : {},
    );
  assert.deepEqual(await (await request('/api/catalog?cycle=' + cycle.id)).json(), catalog);
  assert.equal((await (await request('/api/catalog')).json()).cases.length, 2);
  const csv = await (await request('/api/csv?cycle=' + cycle.id)).text();
  assert.match(csv, /Una richiesta/);
  assert.doesNotMatch(csv, /Changed title|API-02/);
  const state = await (await request('/api/state')).json();
  assert.match(state.cycles[0].catalogHash, /^[a-f0-9]{64}$/);
  assert.match(state.results[cycle.id]['API-01'].caseHash, /^[a-f0-9]{64}$/);
  assert.equal(state.results[cycle.id]['API-01'].note, 'Original note');
  assert.equal(
    (
      await request('/api/results', {
        cycleId: cycle.id,
        caseId: 'API-02',
        status: 'pass',
        note: '',
        tester: '',
        revision: state.revision,
      })
    ).status,
    400,
  );
  const newer = await (await request('/api/cycles', { name: 'New' })).json();
  assert.deepEqual(await (await request('/api/catalog?cycle=' + newer.id)).json(), updated);
  assert.equal((await request('/api/catalog?cycle=unknown')).status, 400);
  const exported = await (await request('/api/backup')).json();
  const fresh = await fixture(t);
  assert.equal((await fresh.request('/api/import', exported)).status, 200);
  assert.deepEqual(await (await fresh.request('/api/catalog?cycle=' + cycle.id)).json(), catalog);
  assert.equal((await fresh.request('/api/import', exported)).status, 200);
  exported.state.snapshots[cycle.catalogHash].cases[0].title = 'Tampered';
  assert.equal((await fresh.request('/api/import', exported)).status, 400);
});

test('legacy migration freezes the saved catalogue before applying repository updates', async (t) => {
  const f = await fixture(t);
  const legacy = {
    catalog,
    revision: 7,
    cycles: [{ id: 'legacy', name: 'Legacy' }],
    results: { legacy: { 'API-01': { status: 'block', note: 'Historical note' } } },
  };
  await writeFile(join(f.directory, 'state.json'), JSON.stringify(legacy));
  const updated = {
    ...catalog,
    version: 17,
    cases: [{ ...catalog.cases[0], expected: 'New expected' }],
  };
  const reopened = await createCollaudoServer({ directory: f.directory, initialCatalog: updated });
  await new Promise((resolve) => reopened.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => reopened.close(resolve)));
  const base = `http://127.0.0.1:${reopened.address().port}`;
  assert.deepEqual(await (await fetch(base + '/api/catalog?cycle=legacy')).json(), catalog);
  const files = await readdir(join(f.directory, 'backups'));
  assert.equal(files.length, 1);
  const backup = JSON.parse(await readFile(join(f.directory, 'backups', files[0]), 'utf8'));
  assert.deepEqual(backup.state.results, legacy.results);
  assert.deepEqual(backup.catalog, catalog);
});

test('automatic backups retain the last 30 valid pre-write states and can be imported', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'backups'));
  await writeFile(join(f.directory, 'backups', 'manual.json'), '{"manual":true}');
  for (let n = 0; n < 33; n++)
    assert.equal((await f.request('/api/cycles', { name: 'Cycle ' + n })).status, 200);
  const allFiles = await readdir(join(f.directory, 'backups'));
  assert.ok(allFiles.includes('manual.json'));
  const files = allFiles.filter((name) => name.startsWith('auto-'));
  assert.equal(files.length, 30);
  const backups = await Promise.all(
    files.map(async (name) =>
      JSON.parse(await readFile(join(f.directory, 'backups', name), 'utf8')),
    ),
  );
  assert.deepEqual(
    backups.map((item) => item.state.cycles.length).sort((a, b) => a - b),
    Array.from({ length: 30 }, (_, n) => n + 3),
  );
  const fresh = await fixture(t);
  assert.equal((await fresh.request('/api/import', backups[0])).status, 200);
  const before = await readdir(join(f.directory, 'backups'));
  assert.equal((await f.request('/api/cycles', { name: '' })).status, 400);
  assert.deepEqual(await readdir(join(f.directory, 'backups')), before);
});

test('a backup failure refuses the write without modifying history', async (t) => {
  const f = await fixture(t);
  const cycle = await (await f.request('/api/cycles', { name: 'Protected' })).json();
  const before = await readFile(join(f.directory, 'state.json'), 'utf8');
  await rm(join(f.directory, 'backups'), { recursive: true });
  await writeFile(join(f.directory, 'backups'), 'not a directory');
  assert.equal(
    (
      await f.request('/api/results', {
        cycleId: cycle.id,
        caseId: 'API-01',
        status: 'fail',
        note: '',
        tester: '',
        revision: 1,
      })
    ).status,
    500,
  );
  assert.equal(await readFile(join(f.directory, 'state.json'), 'utf8'), before);
  assert.equal((await (await f.request('/api/state')).json()).revision, 1);
});

test('snapshot imports reject missing definitions, altered case hashes and conflicting history', async (t) => {
  const f = await fixture(t);
  const cycle = await (await f.request('/api/cycles', { name: 'Immutable' })).json();
  await f.request('/api/results', {
    cycleId: cycle.id,
    caseId: 'API-01',
    status: 'pass',
    note: '',
    tester: '',
    revision: 1,
  });
  const backup = await (await f.request('/api/backup')).json();
  const missing = structuredClone(backup);
  delete missing.state.snapshots[cycle.catalogHash];
  assert.equal((await f.request('/api/import', missing)).status, 400);
  const altered = structuredClone(backup);
  altered.state.results[cycle.id]['API-01'].caseHash = '0'.repeat(64);
  assert.equal((await f.request('/api/import', altered)).status, 400);
  const conflicting = structuredClone(backup);
  conflicting.state.results[cycle.id]['API-01'].status = 'fail';
  assert.equal((await f.request('/api/import', conflicting)).status, 409);
  assert.deepEqual(await (await f.request('/api/backup')).json(), backup);
  // Property order does not change the definition's identity.
  backup.state.snapshots[cycle.catalogHash].cases[0] = Object.fromEntries(
    Object.entries(backup.state.snapshots[cycle.catalogHash].cases[0]).reverse(),
  );
  assert.equal((await f.request('/api/import', backup)).status, 200);
});
