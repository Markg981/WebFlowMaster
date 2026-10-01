/**
 * The external services the collaudo cases talk to, simulated in one process, so those cases
 * run without accounts on TestRail, Jira, Xray, Zephyr Scale, Azure DevOps or Google.
 *
 *   http://simulatori:8080/testrail   TestRail          user collaudo@acme.test, token collaudo-testrail
 *   http://simulatori:8080/jira       Jira + Xray DC    user collaudo@acme.test, token collaudo-jira
 *   http://simulatori:8080/xray       Xray Cloud        client id collaudo, secret collaudo-xray
 *   http://simulatori:8080/zephyr     Zephyr Scale      token collaudo-zephyr
 *   http://simulatori:8080/ado        Azure DevOps      PAT collaudo-ado, project Shop
 *   http://simulatori:8080/gemini     Gemini            any key
 *
 * What each received is at http://localhost:8090/ (the tester's view: runs, issues, requests),
 * and POST /_admin/reset puts every service back to its starting data.
 *
 * In memory only: a restart is a reset. Never reachable from outside this machine.
 */
import { createServer } from 'node:http';

const USER = 'collaudo@acme.test';
const CREDENTIALS = {
  testrail: `Basic ${Buffer.from(`${USER}:collaudo-testrail`).toString('base64')}`,
  jira: `Basic ${Buffer.from(`${USER}:collaudo-jira`).toString('base64')}`,
  zephyr: 'Bearer collaudo-zephyr',
  ado: `Basic ${Buffer.from(':collaudo-ado').toString('base64')}`,
};
const PUBLIC = process.env.SIMULATORI_PUBLIC_URL ?? 'http://localhost:8090';

let state;
function reset() {
  state = {
    requests: [],
    testrail: { project: { id: 3, name: 'Collaudo Shop' }, cases: new Set([1, 2, 3]), runs: [] },
    jira: {
      issues: {
        'SHOP-1': { type: 'Epic', summary: 'Checkout', status: 'To Do', parent: null },
        'SHOP-10': { type: 'Story', summary: 'Pagare con carta', status: 'To Do', parent: 'SHOP-1' },
        'SHOP-11': { type: 'Story', summary: 'Pagare con bonifico', status: 'To Do', parent: 'SHOP-1' },
        'SHOP-45': { type: 'Test', summary: 'Login', status: 'Done', parent: null },
        'SHOP-46': { type: 'Test', summary: 'Checkout', status: 'Done', parent: null },
        'SHOP-100': { type: 'Test Plan', summary: 'Release 1.0', status: 'In Progress', parent: null },
      },
      next: 200,
      executions: [],
    },
    zephyr: { cases: new Set(['SHOP-T1', 'SHOP-T2']), cycles: [], next: 1 },
    ado: {
      items: {
        1: { type: 'Epic', title: 'Ordini', state: 'New', parent: null },
        2: { type: 'Feature', title: 'Carrello', state: 'New', parent: 1 },
        3: { type: 'User Story', title: 'Aggiungere al carrello', state: 'Active', parent: 2 },
      },
      next: 100,
    },
    gemini: { next: null },
  };
}
reset();

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const html = (res, title, body) =>
  send(res, 200, `<!doctype html><meta charset=utf-8><title>${title}</title><style>body{font:14px system-ui;margin:24px;max-width:1100px}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;background:#f5f5f5;padding:8px}</style><h1>${title}</h1>${body}`, 'text/html');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ─── TestRail ──────────────────────────────────────────────────────────────────
function testrail(req, res, api, body) {
  if (req.headers.authorization !== CREDENTIALS.testrail) return send(res, 401, { error: 'Authentication failed: invalid or missing user/password or session cookie.' });
  const { project, cases, runs } = state.testrail;
  let m;
  if ((m = /^get_project\/(\d+)$/.exec(api))) return Number(m[1]) === project.id ? send(res, 200, project) : send(res, 400, { error: 'Field :project_id is not a valid or accessible project.' });
  if ((m = /^add_run\/(\d+)$/.exec(api)) && req.method === 'POST') {
    if (Number(m[1]) !== project.id) return send(res, 400, { error: 'Field :project_id is not a valid or accessible project.' });
    const bad = (body.case_ids ?? []).filter((id) => !cases.has(id));
    if (bad.length) return send(res, 400, { error: 'Field :case_ids contains one or more invalid case IDs.' });
    const run = { id: runs.length + 1, name: body.name, description: body.description, case_ids: body.case_ids, results: [], created: new Date().toISOString() };
    runs.push(run);
    return send(res, 200, { id: run.id, name: run.name, url: `${PUBLIC}/testrail/runs/${run.id}` });
  }
  if ((m = /^add_results_for_cases\/(\d+)$/.exec(api)) && req.method === 'POST') {
    const run = runs.find((r) => r.id === Number(m[1]));
    if (!run) return send(res, 400, { error: 'Field :run_id is not a valid test run.' });
    run.results.push(...(body.results ?? []));
    return send(res, 200, body.results ?? []);
  }
  return send(res, 404, { error: `Unknown method ${api}` });
}
const TESTRAIL_STATUS = { 1: 'Passed', 2: 'Blocked', 3: 'Untested', 4: 'Retest', 5: 'Failed' };

// ─── Jira (and Xray Server/DC) ─────────────────────────────────────────────────
const jiraIssue = (key) => {
  const i = state.jira.issues[key];
  return {
    key,
    self: `http://simulatori:8080/jira/rest/api/3/issue/${key}`,
    fields: {
      summary: i.summary,
      issuetype: { name: i.type },
      status: { name: i.status },
      ...(i.parent ? { parent: { key: i.parent } } : {}),
      description: i.description ?? null,
    },
  };
};
function jiraSearch(jql) {
  const keys = /key in \(([^)]*)\)/i.exec(jql);
  if (keys) return keys[1].split(',').map((k) => k.trim().replace(/"/g, '').toUpperCase()).filter((k) => state.jira.issues[k]);
  const types = /issuetype in \(([^)]*)\)/i.exec(jql)?.[1].split(',').map((t) => t.trim().replace(/"/g, '').toLowerCase());
  return Object.keys(state.jira.issues).filter((k) => !types || types.includes(state.jira.issues[k].type.toLowerCase()));
}
function jira(req, res, path, query, body) {
  const xrayImport = /^\/rest\/raven\/[12]\.0\/import\/execution$/.test(path);
  if (req.headers.authorization !== CREDENTIALS.jira) return send(res, 401, { errorMessages: ['You are not authenticated.'] });
  let m;
  if ((m = /^\/rest\/api\/[23]\/project\/([^/]+)$/.exec(path))) return m[1] === 'SHOP' ? send(res, 200, { key: 'SHOP', name: 'Shop' }) : send(res, 404, { errorMessages: ['No project could be found.'] });
  if (/^\/rest\/api\/3\/search\/jql$/.test(path)) return send(res, 200, { issues: jiraSearch(query.get('jql') ?? '').map(jiraIssue), isLast: true });
  if ((m = /^\/rest\/api\/[23]\/issue\/([^/]+)\/comment$/.exec(path)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1]);
    if (!state.jira.issues[key]) return send(res, 404, { errorMessages: ['Issue does not exist.'] });
    (state.jira.issues[key].comments ??= []).push(body.body);
    return send(res, 201, { id: String(Date.now()) });
  }
  if ((m = /^\/rest\/api\/[23]\/issue\/([^/]+)$/.exec(path)) && req.method === 'GET') {
    const key = decodeURIComponent(m[1]);
    return state.jira.issues[key] ? send(res, 200, { ...jiraIssue(key), renderedFields: {}, names: {} }) : send(res, 404, { errorMessages: ['Issue does not exist.'] });
  }
  if (/^\/rest\/api\/[23]\/issue$/.test(path) && req.method === 'POST') {
    const key = `SHOP-${state.jira.next++}`;
    state.jira.issues[key] = { type: body.fields?.issuetype?.name ?? 'Bug', summary: body.fields?.summary ?? '', status: 'To Do', parent: null, description: body.fields?.description, createdBy: 'WebFlowMaster' };
    return send(res, 201, { key, self: `http://simulatori:8080/jira/rest/api/3/issue/${key}` });
  }
  if (xrayImport && req.method === 'POST') return xrayImportExecution(res, body, (key) => ({ testExecIssue: { key } }));
  return send(res, 404, { errorMessages: [`Not simulated: ${req.method} ${path}`] });
}

// ─── Xray Cloud ────────────────────────────────────────────────────────────────
function xrayImportExecution(res, body, answer) {
  const missing = (body.tests ?? []).map((t) => t.testKey).filter((k) => state.jira.issues[k]?.type !== 'Test');
  if (missing.length) return send(res, 400, { error: `Tests not found: ${missing.join(', ')}` });
  if (body.info?.testPlanKey && state.jira.issues[body.info.testPlanKey]?.type !== 'Test Plan') return send(res, 400, { error: `Test Plan ${body.info.testPlanKey} not found` });
  const key = `SHOP-${state.jira.next++}`;
  state.jira.issues[key] = { type: 'Test Execution', summary: body.info?.summary ?? '', status: 'Done', parent: null };
  state.jira.executions.push({ key, ...body, at: new Date().toISOString() });
  return send(res, 200, { ...answer(key), self: `http://simulatori:8080/jira/rest/api/2/issue/${key}` });
}
function xray(req, res, path, body, rawAuth) {
  if (path === '/api/v2/authenticate' && req.method === 'POST') {
    return body.client_id === 'collaudo' && body.client_secret === 'collaudo-xray' ? send(res, 200, 'collaudo-xray-token') : send(res, 401, { error: 'Authentication failed. Invalid client credentials!' });
  }
  if (rawAuth !== 'Bearer collaudo-xray-token') return send(res, 401, { error: 'Authentication required' });
  if (path === '/api/v2/import/execution' && req.method === 'POST') return xrayImportExecution(res, body, (key) => ({ id: key, key }));
  return send(res, 404, { error: `Not simulated: ${req.method} ${path}` });
}

// ─── Zephyr Scale ──────────────────────────────────────────────────────────────
function zephyr(req, res, path, body) {
  if (req.headers.authorization !== CREDENTIALS.zephyr) return send(res, 401, { message: 'Invalid token' });
  const z = state.zephyr;
  if (path === '/projects/SHOP') return send(res, 200, { key: 'SHOP', name: 'Shop' });
  if (path.startsWith('/projects/')) return send(res, 404, { message: 'Project not found' });
  if (path === '/statuses') return send(res, 200, { values: ['Pass', 'Fail', 'Blocked', 'Not Executed'].map((name, id) => ({ id, name, archived: false })) });
  if (path === '/testcycles' && req.method === 'POST') {
    const cycle = { key: `SHOP-R${z.next++}`, name: body.name, description: body.description, executions: [], at: new Date().toISOString() };
    z.cycles.push(cycle);
    return send(res, 201, { id: z.next, key: cycle.key });
  }
  if (path === '/testexecutions' && req.method === 'POST') {
    if (!z.cases.has(body.testCaseKey)) return send(res, 400, { errorCode: 400, message: `Test case '${body.testCaseKey}' not found.` });
    const cycle = z.cycles.find((c) => c.key === body.testCycleKey);
    if (!cycle) return send(res, 400, { errorCode: 400, message: `Test cycle '${body.testCycleKey}' not found.` });
    cycle.executions.push(body);
    return send(res, 201, { id: Date.now() });
  }
  return send(res, 404, { message: `Not simulated: ${req.method} ${path}` });
}

// ─── Azure DevOps ──────────────────────────────────────────────────────────────
const adoItem = (id) => {
  const i = state.ado.items[id];
  return { id: Number(id), fields: { 'System.Title': i.title, 'System.WorkItemType': i.type, 'System.State': i.state, ...(i.parent ? { 'System.Parent': i.parent } : {}) } };
};
function ado(req, res, path, query, body) {
  if (req.headers.authorization !== CREDENTIALS.ado) return send(res, 401, { message: 'TF400813: The user is not authorized to access this resource.' });
  let m;
  if (path === '/_apis/projects/Shop') return send(res, 200, { id: 'shop', name: 'Shop' });
  if (path.startsWith('/_apis/projects/')) return send(res, 404, { message: 'TF200016: The following project does not exist.' });
  if (path === '/Shop/_apis/wit/wiql' && req.method === 'POST') {
    const q = String(body.query ?? '');
    const single = /\[System\.WorkItemType\]\s*=\s*'([^']+)'/i.exec(q)?.[1];
    const list = /\[System\.WorkItemType\]\s*IN\s*\(([^)]*)\)/i.exec(q)?.[1]?.split(',').map((t) => t.trim().replace(/'/g, ''));
    const wanted = single ? [single] : list;
    const ids = Object.keys(state.ado.items).filter((id) => !wanted || wanted.some((t) => t.toLowerCase() === state.ado.items[id].type.toLowerCase()));
    return send(res, 200, { workItems: ids.map((id) => ({ id: Number(id) })) });
  }
  if (path === '/Shop/_apis/wit/workitems' && req.method === 'GET') {
    return send(res, 200, { value: (query.get('ids') ?? '').split(',').map((id) => (state.ado.items[id] ? adoItem(id) : null)) });
  }
  if ((m = /^\/Shop\/_apis\/wit\/workitems\/(\d+)$/i.exec(path))) return state.ado.items[m[1]] ? send(res, 200, adoItem(m[1])) : send(res, 404, { message: 'Work item does not exist.' });
  if ((m = /^\/Shop\/_apis\/wit\/workitems\/\$(.+)$/i.exec(path)) && req.method === 'POST') {
    const id = state.ado.next++;
    const title = (Array.isArray(body) ? body : []).find((op) => op.path === '/fields/System.Title')?.value ?? '';
    state.ado.items[id] = { type: decodeURIComponent(m[1]), title, state: 'New', parent: null, createdBy: 'WebFlowMaster' };
    return send(res, 200, { id, _links: { html: { href: `${PUBLIC}/ado/items/${id}` } } });
  }
  if ((m = /^\/Shop\/_apis\/wit\/workItems\/(\d+)\/comments$/i.exec(path)) && req.method === 'POST') return send(res, 200, { id: Date.now() });
  return send(res, 404, { message: `Not simulated: ${req.method} ${path}` });
}

// ─── Gemini ────────────────────────────────────────────────────────────────────
/** What a model would say about a failure, from the evidence in the prompt. */
function failureAnswer(prompt) {
  const italian = /in Italian/.test(prompt);
  const failedRequest = /^FAILED (\S+) (\S+) → (5\d\d)/m.exec(prompt);
  const failedStep = /^(\d+)\. \[failed\] [^|]*(?:\| selector: ([^|]+))?/m.exec(prompt);
  if (failedRequest) {
    return {
      category: 'application',
      confidence: 'high',
      summary: italian ? `L'applicazione ha risposto ${failedRequest[3]} a ${failedRequest[1]} ${failedRequest[2]}.` : `The application answered ${failedRequest[3]} to ${failedRequest[1]} ${failedRequest[2]}.`,
      explanation: italian ? `La richiesta ${failedRequest[2]} è fallita con ${failedRequest[3]}: la pagina non ha ricevuto i dati e lo step successivo non li ha trovati.` : `${failedRequest[2]} failed with ${failedRequest[3]}.`,
      suggestion: italian ? "Segnalare il difetto al team dell'applicazione con l'HAR del run." : 'Report it to the application team with the run HAR.',
      failedStep: failedStep ? Number(failedStep[1]) : null,
      proposedSelector: null,
    };
  }
  if (failedStep?.[2]) {
    const old = failedStep[2].trim();
    // A button found by a class that changed is found again by its role in a form.
    const proposed = /^button/i.test(old) || /\.btn/.test(old) ? 'button[type="submit"]' : `${old.split(/[.\s]/)[0] || '*'}[data-testid]`;
    return {
      category: 'locator',
      confidence: 'medium',
      summary: italian ? `Lo step ${failedStep[1]} non trova l'elemento con il selettore ${old}.` : `Step ${failedStep[1]} cannot find ${old}.`,
      explanation: italian ? `Nello screenshot l'elemento è presente, ma con attributi diversi da quelli del selettore ${old}.` : 'The element is on the page with other attributes.',
      suggestion: italian ? 'Usare un selettore che non dipenda dalle classi CSS.' : 'Use a selector that does not depend on CSS classes.',
      failedStep: Number(failedStep[1]),
      proposedSelector: proposed,
    };
  }
  return { category: 'unknown', confidence: 'low', summary: italian ? 'Le evidenze non bastano a dire la causa.' : 'Not enough evidence.', explanation: '', suggestion: '', failedStep: null, proposedSelector: null };
}
function gemini(req, res, path, body) {
  if (!/:generateContent$/.test(path)) return send(res, 404, { error: { code: 404, message: `Not simulated: ${path}` } });
  const prompt = (body.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('\n');
  let text;
  if (state.gemini.next) {
    text = state.gemini.next;
    state.gemini.next = null;
  } else if (/analysing why an automated end-to-end test failed/.test(prompt)) {
    text = JSON.stringify(failureAnswer(prompt));
  } else {
    // Authoring and proposals: nothing understood, which the product treats as "no AI answer".
    text = '[]';
  }
  return send(res, 200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: prompt.length, candidatesTokenCount: text.length } });
}

// ─── The tester's view ─────────────────────────────────────────────────────────
function viewer(res, path) {
  let m;
  if ((m = /^\/testrail\/runs\/(\d+)$/.exec(path))) {
    const run = state.testrail.runs.find((r) => r.id === Number(m[1]));
    if (!run) return send(res, 404, 'Run non trovata', 'text/plain');
    const rows = run.results.map((r) => `<tr><td>C${r.case_id}</td><td>${TESTRAIL_STATUS[r.status_id] ?? r.status_id}</td><td>${esc(r.elapsed)}</td><td><pre>${esc(r.comment)}</pre></td></tr>`).join('');
    return html(res, `TestRail R${run.id} — ${esc(run.name)}`, `<p>Casi: ${run.case_ids.map((c) => `C${c}`).join(', ')}</p><table><tr><th>Caso</th><th>Esito</th><th>Durata</th><th>Commento</th></tr>${rows}</table>`);
  }
  if ((m = /^\/jira\/browse\/([^/]+)$/.exec(path)) && state.jira.issues[m[1]]) {
    const i = state.jira.issues[m[1]];
    const exec = state.jira.executions.find((e) => e.key === m[1]);
    const tests = exec ? `<table><tr><th>Test</th><th>Esito</th><th>Commento</th></tr>${exec.tests.map((t) => `<tr><td>${t.testKey}</td><td>${t.status}</td><td><pre>${esc(t.comment)}</pre></td></tr>`).join('')}</table><p>Test Plan: ${esc(exec.info?.testPlanKey ?? '—')}</p>` : '';
    return html(res, `${m[1]} — ${esc(i.summary)}`, `<p>${i.type} · ${i.status}${i.parent ? ` · padre ${i.parent}` : ''}${i.createdBy ? ` · creata da ${i.createdBy}` : ''}</p>${tests}<p>Commenti: ${(i.comments ?? []).length}</p>`);
  }
  if ((m = /^\/ado\/items\/(\d+)$/.exec(path)) && state.ado.items[m[1]]) {
    const i = state.ado.items[m[1]];
    return html(res, `${i.type} ${m[1]} — ${esc(i.title)}`, `<p>${i.state}${i.parent ? ` · padre ${i.parent}` : ''}</p>`);
  }
  if (path === '/' || path === '') {
    const runs = state.testrail.runs.map((r) => `<li><a href="/testrail/runs/${r.id}">TestRail R${r.id}</a> ${esc(r.name)}</li>`);
    const execs = state.jira.executions.map((e) => `<li><a href="/jira/browse/${e.key}">Xray ${e.key}</a> ${esc(e.info?.summary)}</li>`);
    const cycles = state.zephyr.cycles.map((c) => `<li>Zephyr ${c.key} ${esc(c.name)}: ${c.executions.map((e) => `${e.testCaseKey} ${e.statusName}`).join(', ')}</li>`);
    const issues = Object.entries(state.jira.issues).map(([k, i]) => `<li><a href="/jira/browse/${k}">${k}</a> ${i.type} · ${esc(i.summary)} · ${i.status}</li>`);
    const items = Object.entries(state.ado.items).map(([id, i]) => `<li><a href="/ado/items/${id}">${id}</a> ${i.type} · ${esc(i.title)} · ${i.state}</li>`);
    const requests = state.requests.slice(-60).reverse().map((r) => `<tr><td>${r.at.slice(11, 19)}</td><td>${r.method}</td><td>${esc(r.path)}</td><td>${r.status}</td></tr>`).join('');
    return html(res, 'Servizi simulati del collaudo', `<h2>Pubblicazioni</h2><ul>${[...runs, ...execs, ...cycles].join('') || '<li>nessuna</li>'}</ul><h2>Jira</h2><ul>${issues.join('')}</ul><h2>Azure DevOps (progetto Shop)</h2><ul>${items.join('')}</ul><h2>Ultime richieste</h2><p>Corpi completi: <a href="/_admin/requests">/_admin/requests</a></p><table>${requests}</table>`);
  }
  return null;
}

// ─── Admin ─────────────────────────────────────────────────────────────────────
function admin(req, res, path, body) {
  if (path === '/_admin/reset' && req.method === 'POST') { reset(); return send(res, 200, { reset: true }); }
  if (path === '/_admin/requests') return send(res, 200, state.requests);
  if (path === '/_admin/gemini/next' && req.method === 'POST') { state.gemini.next = typeof body === 'string' ? body : JSON.stringify(body); return send(res, 200, { queued: true }); }
  let m;
  // A change made "in Jira" by the tester, as TRC-03 asks: { "summary": "...", "status": "In Progress" }.
  if ((m = /^\/_admin\/jira\/([^/]+)$/.exec(path)) && req.method === 'POST' && state.jira.issues[m[1]]) { Object.assign(state.jira.issues[m[1]], body); return send(res, 200, state.jira.issues[m[1]]); }
  if (path === '/_admin/health') return send(res, 200, { ok: true });
  return null;
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
    const url = new URL(req.url, 'http://simulatori');
    // TestRail puts its route in the query string: index.php?/api/v2/add_run/3
    const testrailApi = url.pathname === '/testrail/index.php' ? /^\/api\/v2\/([^&]+)/.exec(decodeURIComponent(url.search.slice(1)))?.[1] : null;
    const record = { at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, body };
    const originalEnd = res.end.bind(res);
    res.end = (...args) => { record.status = res.statusCode; if (!url.pathname.startsWith('/_admin') && url.pathname !== '/') state.requests.push(record); if (state.requests.length > 500) state.requests.shift(); return originalEnd(...args); };

    const [, service, ...rest] = url.pathname.split('/');
    const sub = '/' + rest.join('/');
    try {
      if (service === '_admin' && admin(req, res, url.pathname, body) !== null) return;
      if (req.method === 'GET' && viewer(res, url.pathname) !== null) return;
      if (testrailApi) return testrail(req, res, testrailApi, body);
      if (service === 'jira') return jira(req, res, sub, url.searchParams, body);
      if (service === 'xray') return xray(req, res, sub, body, req.headers.authorization);
      if (service === 'zephyr') return zephyr(req, res, sub, body);
      if (service === 'ado') return ado(req, res, sub, url.searchParams, body);
      if (service === 'gemini') return gemini(req, res, sub, body);
      send(res, 404, { error: `Not simulated: ${req.method} ${url.pathname}` });
    } catch (error) {
      send(res, 500, { error: error.message });
    }
  });
}).listen(8080, () => console.log('Simulated services on :8080'));
