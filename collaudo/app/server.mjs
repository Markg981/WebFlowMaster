import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(appDirectory, '..');
const statuses = ['todo', 'pass', 'fail', 'block', 'na'];
const safeId = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{1,120}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const string = (value, max = 20000) => typeof value === 'string' && value.length <= max;
function invalid(message = 'Dati non validi', status = 400) {
  throw Object.assign(new Error(message), { status });
}
function validateCatalog(catalog) {
  if (
    !catalog ||
    !Number.isInteger(catalog.version) ||
    !Array.isArray(catalog.areas) ||
    !Array.isArray(catalog.cases) ||
    catalog.cases.length > 5000
  )
    invalid();
  const areas = new Set();
  const ids = new Set();
  for (const area of catalog.areas) {
    if (!safeId(area.id) || areas.has(area.id) || !string(area.title, 300) || !string(area.intro))
      invalid();
    areas.add(area.id);
  }
  for (const item of catalog.cases) {
    if (
      !/^[A-Z]+-\d{2,4}$/.test(item.id) ||
      ids.has(item.id) ||
      !areas.has(item.area) ||
      !string(item.title, 500) ||
      !['P1', 'P2', 'P3'].includes(item.priority) ||
      !string(item.actor, 500) ||
      !string(item.preconditions) ||
      !string(item.expected) ||
      !Array.isArray(item.steps) ||
      !item.steps.every((step) => string(step)) ||
      (item.detailHtml !== undefined && !string(item.detailHtml, 50000))
    )
      invalid();
    ids.add(item.id);
  }
  if (catalog.presentation) {
    if (
      !string(catalog.presentation.css, 60000) ||
      /@import|url\s*\(|expression\s*\(/i.test(catalog.presentation.css) ||
      !string(catalog.presentation.preparationHtml, 100000)
    )
      invalid('Presentazione non valida');
  }
  return catalog;
}
function validateState(state, catalog) {
  if (
    !state ||
    !Array.isArray(state.cycles) ||
    state.cycles.length > 2000 ||
    !state.results ||
    typeof state.results !== 'object' ||
    Array.isArray(state.results)
  )
    invalid();
  const cycles = new Set();
  const cases = new Set(catalog.cases.map((item) => item.id));
  for (const cycle of state.cycles) {
    if (
      !safeId(cycle.id) ||
      cycles.has(cycle.id) ||
      !string(cycle.name, 500) ||
      !cycle.name.trim() ||
      (cycle.version !== undefined && !string(cycle.version, 200)) ||
      (cycle.environment !== undefined && !string(cycle.environment, 1000))
    )
      invalid();
    cycles.add(cycle.id);
  }
  for (const [cycle, results] of Object.entries(state.results)) {
    if (!cycles.has(cycle) || !results || typeof results !== 'object' || Array.isArray(results))
      invalid();
    for (const [id, result] of Object.entries(results)) {
      if (
        !cases.has(id) ||
        !result ||
        !statuses.includes(result.status) ||
        (result.note !== undefined && !string(result.note)) ||
        (result.tester !== undefined && !string(result.tester, 300)) ||
        (result.recordedLabel !== undefined && !string(result.recordedLabel, 1000)) ||
        (result.whoShort !== undefined && !string(result.whoShort, 1000)) ||
        (result.updatedAt !== undefined &&
          (!string(result.updatedAt, 100) || !Number.isFinite(Date.parse(result.updatedAt))))
      )
        invalid();
    }
  }
  return state;
}
function mergeCatalog(current, incoming) {
  const cases = new Map(current.cases.map((item) => [item.id, item]));
  for (const item of incoming.cases) {
    if (cases.has(item.id) && JSON.stringify(cases.get(item.id)) !== JSON.stringify(item))
      invalid(`Il caso ${item.id} esiste con contenuto diverso`, 409);
    cases.set(item.id, item);
  }
  const areas = new Map(current.areas.map((area) => [area.id, area]));
  for (const area of incoming.areas) if (!areas.has(area.id)) areas.set(area.id, area);
  if (incoming.presentation) {
    return {
      version: Math.max(current.version, incoming.version),
      areas: [
        ...new Map(
          [
            ...incoming.areas,
            ...current.areas.filter(
              (area) => !incoming.areas.some((source) => source.id === area.id),
            ),
          ].map((area) => [area.id, area]),
        ).values(),
      ],
      cases: [
        ...incoming.cases,
        ...current.cases.filter((item) => !incoming.cases.some((source) => source.id === item.id)),
      ],
      presentation: incoming.presentation,
    };
  }
  return {
    version: Math.max(current.version, incoming.version),
    areas: [...areas.values()],
    cases: [...cases.values()],
    ...(incoming.presentation || current.presentation
      ? { presentation: incoming.presentation || current.presentation }
      : {}),
  };
}
export async function createCollaudoServer({
  directory = resolve(root, '.local'),
  initialCatalog,
} = {}) {
  const seed = validateCatalog(
    initialCatalog || JSON.parse(await readFile(resolve(root, 'casi.json'), 'utf8')),
  );
  await mkdir(directory, { recursive: true });
  const stateFile = resolve(directory, 'state.json');
  let store;
  try {
    store = JSON.parse(await readFile(stateFile, 'utf8'));
    validateCatalog(store.catalog);
    validateState(store, store.catalog);
    if (!Number.isSafeInteger(store.revision) || store.revision < 0)
      invalid('Revisione locale non valida');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    store = { catalog: seed, revision: 0, cycles: [], results: {} };
  }
  // Repository updates change the catalogue, never the recorded outcomes.
  const existing = new Map(store.catalog.cases.map((item) => [item.id, item]));
  for (const item of seed.cases) existing.set(item.id, item);
  store.catalog = {
    ...store.catalog,
    version: Math.max(seed.version, store.catalog.version),
    cases: [...existing.values()],
    areas: [
      ...new Map([...store.catalog.areas, ...seed.areas].map((area) => [area.id, area])).values(),
    ],
    presentation: seed.presentation || store.catalog.presentation,
  };
  let writes = Promise.resolve();
  async function persist(next) {
    const temporary = `${stateFile}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n');
    await rename(temporary, stateFile);
    store = next;
  }
  const server = createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      const hosts = [expectedHost, `localhost:${server.address().port}`];
      if (!hosts.includes(req.headers.host)) return send(403, { error: 'Host non consentito' });
      const requestUrl = new URL(req.url, `http://${expectedHost}`);
      const path = requestUrl.pathname;
      if (req.method === 'GET') {
        if (path === '/api/catalog') return send(200, store.catalog);
        if (path === '/api/state')
          return send(200, {
            revision: store.revision,
            cycles: store.cycles,
            results: store.results,
          });
        if (path === '/api/backup') {
          res.setHeader('Content-Disposition', 'attachment; filename="collaudo-backup.json"');
          return send(200, {
            catalog: store.catalog,
            state: { cycles: store.cycles, results: store.results },
          });
        }
        if (path === '/api/csv') {
          const cycleId = requestUrl.searchParams.get('cycle');
          const cycle = store.cycles.find((item) => item.id === cycleId);
          if (!cycle) invalid('Ciclo sconosciuto');
          const labels = {
            todo: 'Da eseguire',
            pass: 'Superato',
            fail: 'Fallito',
            block: 'Bloccato',
            na: 'N/A',
          };
          const cell = (value) => {
            const text = String(value ?? '');
            return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"';
          };
          const rows = [
            [
              'Ciclo',
              'Versione',
              'Ambiente',
              'ID',
              'Area',
              'Priorità',
              'Titolo',
              'Esito',
              'Nota',
              'Collaudatore',
              'Data',
            ],
          ];
          for (const item of store.catalog.cases) {
            const result = store.results[cycleId]?.[item.id] || {};
            rows.push([
              cycle.name,
              cycle.version,
              cycle.environment,
              item.id,
              item.area,
              item.priority,
              item.title,
              labels[result.status || 'todo'],
              result.note,
              result.tester || result.whoShort,
              result.updatedAt || result.recordedLabel,
            ]);
          }
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="collaudo.csv"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end('\ufeff' + rows.map((row) => row.map(cell).join(';')).join('\r\n'));
        }
        const files = {
          '/': ['index.html', 'text/html'],
          '/app.js': ['app.js', 'text/javascript'],
          '/style.css': ['style.css', 'text/css'],
        };
        if (!files[path]) return send(404, { error: 'Non trovato' });
        const [file, type] = files[path];
        res.writeHead(200, {
          'Content-Type': `${type}; charset=utf-8`,
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(await readFile(resolve(appDirectory, file)));
      }
      if (req.method !== 'POST') return send(405, { error: 'Metodo non consentito' });
      if (!hosts.some((host) => req.headers.origin === `http://${host}`))
        return send(403, { error: 'Origine non consentita' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(415, { error: 'JSON richiesto' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) invalid('File troppo grande', 413);
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        invalid('JSON non valido');
      }
      const mutate = async () => {
        const next = structuredClone(store);
        next.revision++;
        let response;
        if (path === '/api/cycles') {
          if (!string(body.name, 500) || !body.name.trim()) invalid('Nome del ciclo richiesto');
          const cycle = {
            id: randomUUID(),
            name: body.name.trim(),
            version: body.version || '',
            environment: body.environment || '',
          };
          next.cycles.push(cycle);
          next.results[cycle.id] = {};
          response = cycle;
        } else if (path === '/api/results') {
          if (body.revision !== store.revision)
            invalid('Esiti modificati da un’altra finestra. Ricaricare e riprovare.', 409);
          if (
            !next.cycles.some((cycle) => cycle.id === body.cycleId) ||
            !next.catalog.cases.some((item) => item.id === body.caseId)
          )
            invalid('Ciclo o caso sconosciuto');
          const { status, note, tester } = body;
          next.results[body.cycleId] ||= {};
          next.results[body.cycleId][body.caseId] = {
            status,
            note,
            tester,
            updatedAt: new Date().toISOString(),
          };
          response = { revision: next.revision, result: next.results[body.cycleId][body.caseId] };
        } else if (path === '/api/import') {
          validateCatalog(body.catalog);
          validateState(body.state, body.catalog);
          next.catalog = mergeCatalog(next.catalog, body.catalog);
          for (const cycle of body.state.cycles) {
            const old = next.cycles.find((item) => item.id === cycle.id);
            if (old && JSON.stringify(old) !== JSON.stringify(cycle))
              invalid(`Ciclo ${cycle.id} già presente con dati diversi`, 409);
            if (!old) next.cycles.push(cycle);
            next.results[cycle.id] ||= {};
            for (const [id, result] of Object.entries(body.state.results[cycle.id] || {})) {
              const oldResult = next.results[cycle.id][id];
              if (oldResult && JSON.stringify(oldResult) !== JSON.stringify(result))
                invalid(`Esito ${id} già presente con dati diversi`, 409);
              next.results[cycle.id][id] = result;
            }
          }
          response = { cases: next.catalog.cases.length, cycles: next.cycles.length };
        } else invalid('Non trovato', 404);
        validateCatalog(next.catalog);
        validateState(next, next.catalog);
        await persist(next);
        return response;
      };
      const operation = writes.then(mutate);
      writes = operation.catch(() => {});
      send(200, await operation);
    } catch (error) {
      send(error.status || 500, {
        error: error.status ? error.message : 'Impossibile leggere o salvare i dati locali',
      });
    }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.COLLAUDO_PORT || 4322);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('COLLAUDO_PORT non valida');
  const server = await createCollaudoServer();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Porta ${port} occupata: scegliere COLLAUDO_PORT.`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(
      `Collaudo WebFlowMaster: http://localhost:${port}\nCasi: collaudo/casi.json · Esiti locali: collaudo/.local/state.json`,
    ),
  );
}
