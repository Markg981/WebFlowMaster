const $ = (id) => document.getElementById(id);
const labels = {
  todo: 'Da eseguire',
  pass: 'Superato',
  fail: 'Fallito',
  block: 'Bloccato',
  na: 'N/A',
};
let catalog,
  state,
  cycleId,
  expanded = new Set(),
  pending = new Map(),
  saveQueue = Promise.resolve(),
  noteTimers = new Map();
function escape(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set([
    'H3',
    'H4',
    'P',
    'UL',
    'OL',
    'LI',
    'CODE',
    'B',
    'STRONG',
    'EM',
    'I',
    'BR',
    'DIV',
    'SPAN',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TH',
    'TD',
    'A',
  ]);
  for (const node of [...doc.body.querySelectorAll('*')]) {
    if (!allowed.has(node.tagName)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes]) {
      const href = node.tagName === 'A' && attr.name === 'href' && /^https?:\/\//i.test(attr.value);
      if (attr.name !== 'class' && !href) node.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Operazione non riuscita');
  return result;
}
function error(err) {
  $('error').textContent = err.message;
  $('error').hidden = false;
  $('error').scrollIntoView({ block: 'nearest' });
}
function result(id) {
  return (
    pending.get(id) || state.results[cycleId]?.[id] || { status: 'todo', note: '', tester: '' }
  );
}
function count(items) {
  const totals = { todo: 0, pass: 0, fail: 0, block: 0, na: 0 };
  for (const item of items) totals[state.results[cycleId]?.[item.id]?.status || 'todo']++;
  return totals;
}
function segments(totals, total) {
  return ['pass', 'fail', 'block', 'na']
    .map(
      (status) =>
        `<span style="background:var(--${status});width:${total ? (totals[status] / total) * 100 : 0}%"></span>`,
    )
    .join('');
}
function progress() {
  const totals = count(catalog.cases),
    total = catalog.cases.length;
  $('meter').innerHTML = segments(totals, total);
  const p1 = catalog.cases.filter((item) => item.priority === 'P1');
  $('legend').innerHTML =
    `<span><b>${total - totals.todo}</b> di ${total} eseguiti</span>` +
    Object.entries(labels)
      .filter(([status]) => status !== 'todo')
      .map(
        ([status, label]) =>
          `<span><i class="dot" style="background:var(--${status})"></i>${label} <b>${totals[status]}</b></span>`,
      )
      .join('') +
    `<span><i class="dot" style="background:var(--todo)"></i>Da eseguire <b>${totals.todo}</b></span><span>P1 superati <b>${count(p1).pass}/${p1.length}</b></span>`;
  $('index').innerHTML = catalog.areas
    .map((area) => {
      const items = catalog.cases.filter((item) => item.area === area.id),
        counts = count(items);
      return `<a href="#area-${area.id}"><span class="code">${area.id}</span><span>${escape(area.title)}</span><span class="count">${items.length - counts.todo}/${items.length}</span><span class="mini">${segments(counts, items.length)}</span></a>`;
    })
    .join('');
}
function who(record) {
  return (
    record.recordedLabel ||
    (record.updatedAt
      ? `Registrato da ${record.tester || 'utente locale'}, ${new Date(record.updatedAt).toLocaleString('it-IT')}`
      : '')
  );
}
function row(item) {
  const r = result(item.id),
    open = expanded.has(item.id);
  const detail = item.detailHtml
    ? cleanHTML(item.detailHtml)
    : `<h4>Precondizioni</h4><p>${escape(item.preconditions)}</p><h4>Passi</h4><ol>${item.steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol><h4>Risultato atteso</h4><p class="expected">${escape(item.expected)}</p>`;
  return `<article class="case" id="${item.id}" data-status="${r.status}"><div class="case-row"><span class="stripe" aria-hidden="true"></span><span class="cid">${item.id}</span><button type="button" class="ctitle" data-expand="${item.id}" aria-expanded="${open}" aria-controls="${item.id}-detail"><span class="t">${escape(item.title)}</span><span class="meta"><span class="chip ${item.priority.toLowerCase()}">${item.priority}</span><span>${escape(item.actor)}</span><span data-who-short>${escape(r.whoShort || (r.updatedAt ? (r.tester || 'utente locale') + ' · ' + new Date(r.updatedAt).toLocaleString('it-IT') : ''))}</span></span></button><div class="stamps" role="group" aria-label="Esito di ${item.id}">${Object.entries(
    labels,
  )
    .filter(([s]) => s !== 'todo')
    .map(
      ([status, label]) =>
        `<button type="button" class="stamp ${status}" data-set="${status}" data-case="${item.id}" aria-pressed="${r.status === status}" ${cycleId ? '' : 'disabled'}>${label}</button>`,
    )
    .join(
      '',
    )}</div></div><div class="detail" id="${item.id}-detail" ${open ? '' : 'hidden'}><div>${detail}</div><div class="record"><h4><label for="${item.id}-note">Nota di esecuzione</label></h4><textarea id="${item.id}-note" data-note="${item.id}" maxlength="20000" placeholder="Cosa è successo, correlation id, link alla issue" ${cycleId ? '' : 'disabled'}>${escape(r.note)}</textarea><span class="saving" data-saving></span><span class="who" data-who>${escape(who(r))}</span></div></div></article>`;
}
function renderCases() {
  const q = $('q').value.toLocaleLowerCase();
  const items = catalog.cases.filter(
    (item) =>
      (!$('fArea').value || item.area === $('fArea').value) &&
      (!$('fPrio').value || item.priority === $('fPrio').value) &&
      (!$('fStatus').value ||
        (state.results[cycleId]?.[item.id]?.status || 'todo') === $('fStatus').value) &&
      JSON.stringify(item).toLocaleLowerCase().includes(q),
  );
  $('areas').innerHTML =
    catalog.areas
      .map((area) => {
        const filtered = items.filter((item) => item.area === area.id);
        if (!filtered.length) return '';
        const counts = count(filtered);
        return `<section class="area" id="area-${area.id}"><div class="area-head"><span class="code">${area.id}</span><h2>${escape(area.title)}</h2><span class="tally">${Object.entries(
          counts,
        )
          .filter(([, n]) => n)
          .map(
            ([s, n]) =>
              `${n} ${{ todo: 'da eseguire', pass: 'superati', fail: 'falliti', block: 'bloccati', na: 'non applicabili' }[s]}`,
          )
          .join(
            ' · ',
          )}</span></div><p class="area-intro">${escape(area.intro)}</p>${filtered.map(row).join('')}</section>`;
      })
      .join('') || '<p class="empty">Nessun caso corrisponde ai filtri.</p>';
  $('expandBtn').textContent = expanded.size ? 'Comprimi tutti' : 'Espandi tutti';
  progress();
}
async function load() {
  state = await api('/api/state');
  if (!state.cycles.some((c) => c.id === cycleId)) cycleId = state.cycles.at(-1)?.id || '';
  catalog = await api('/api/catalog' + (cycleId ? '?cycle=' + encodeURIComponent(cycleId) : ''));
  $('version').textContent = `Protocollo di collaudo manuale · versione ${catalog.version}`;
  $('cycleSelect').innerHTML = state.cycles.length
    ? state.cycles
        .map(
          (c) =>
            `<option value="${c.id}">${escape(c.name + (c.version ? ' — ' + c.version : '') + (c.environment ? ' · ' + c.environment : ''))}</option>`,
        )
        .join('')
    : '<option value="">Creare o importare un ciclo</option>';
  $('cycleSelect').value = cycleId;
  $('fArea').innerHTML =
    '<option value="">Tutte le aree</option>' +
    catalog.areas
      .map((a) => `<option value="${a.id}">${a.id} · ${escape(a.title)}</option>`)
      .join('');
  if (catalog.presentation) {
    let css = $('originalStyle');
    if (!css) {
      css = document.createElement('style');
      css.id = 'originalStyle';
      document.head.append(css);
    }
    css.textContent = catalog.presentation.css;
    $('prepBody').innerHTML = cleanHTML(catalog.presentation.preparationHtml);
  } else {
    $('originalStyle')?.remove();
    $('prepBody').textContent =
      'Procedura di preparazione in collaudo/README.md. I nuovi casi sono da eseguire.';
  }
  renderCases();
}
function save(id, status) {
  if (!cycleId) return Promise.resolve();
  clearTimeout(noteTimers.get(id));
  noteTimers.delete(id);
  const targetCycle = cycleId,
    record = {
      ...result(id),
      ...(status ? { status } : {}),
      tester: $('tester').value.trim() || 'utente locale',
    };
  pending.set(id, record);
  const operation = saveQueue.then(async () => {
    try {
      const response = await api('/api/results', {
        cycleId: targetCycle,
        caseId: id,
        status: record.status,
        note: record.note || '',
        tester: record.tester,
        revision: state.revision,
      });
      state.revision = response.revision;
      state.results[targetCycle] ||= {};
      state.results[targetCycle][id] = response.result;
      if (JSON.stringify(pending.get(id)) === JSON.stringify(record)) pending.delete(id);
      $('error').hidden = true;
      if (cycleId === targetCycle) {
        progress();
        const article = document.getElementById(id);
        if (article) {
          article.dataset.status = response.result.status;
          for (const stamp of article.querySelectorAll('.stamp'))
            stamp.setAttribute('aria-pressed', stamp.dataset.set === response.result.status);
          article.querySelector('[data-who]').textContent = who(response.result);
          article.querySelector('[data-who-short]').textContent =
            (record.tester || 'utente locale') +
            ' · ' +
            new Date(response.result.updatedAt).toLocaleString('it-IT');
        }
        if (status) renderCases();
      }
    } catch (err) {
      error(err);
      if (/Ricaricare/.test(err.message)) state = await api('/api/state');
    }
  });
  saveQueue = operation.catch(error);
  return operation;
}
async function flushNotes() {
  for (const id of [...pending.keys()]) await save(id);
  await saveQueue;
  return !pending.size;
}
$('areas').addEventListener('input', (event) => {
  const id = event.target.dataset.note;
  if (id) {
    pending.set(id, { ...result(id), note: event.target.value });
    clearTimeout(noteTimers.get(id));
    noteTimers.set(
      id,
      setTimeout(() => save(id), 650),
    );
  }
});
$('areas').addEventListener('focusout', (event) => {
  const id = event.target.dataset.note;
  if (id && pending.has(id)) save(id);
});
$('areas').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.expand) {
    const id = button.dataset.expand;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderCases();
  } else if (button.dataset.set) {
    const id = button.dataset.case;
    save(id, result(id).status === button.dataset.set ? 'todo' : button.dataset.set);
  } else if (button.dataset.save) save(button.dataset.save);
});
for (const id of ['q', 'fArea', 'fPrio', 'fStatus']) $(id).addEventListener('input', renderCases);
$('expandBtn').onclick = () => {
  expanded = expanded.size ? new Set() : new Set(catalog.cases.map((c) => c.id));
  renderCases();
};
$('cycleSelect').onchange = async () => {
  const selected = $('cycleSelect').value;
  if (!(await flushNotes())) {
    $('cycleSelect').value = cycleId;
    return;
  }
  cycleId = selected;
  try {
    await load();
  } catch (err) {
    error(err);
  }
};
$('newCycleBtn').onclick = async () => {
  if (await flushNotes()) $('cycleDialog').showModal();
};
for (const button of document.querySelectorAll('[data-close]'))
  button.onclick = () => button.closest('dialog').close();
$('cycleForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    const cycle = await api('/api/cycles', Object.fromEntries(new FormData(event.target)));
    cycleId = cycle.id;
    pending.clear();
    $('cycleDialog').close();
    await load();
  } catch (err) {
    error(err);
  }
};
function download(path) {
  const link = document.createElement('a');
  link.href = path;
  link.download = '';
  link.click();
}
$('backupBtn').onclick = async () => {
  if (await flushNotes()) download('/api/backup');
};
$('exportBtn').onclick = async () => {
  if (cycleId && (await flushNotes())) download('/api/csv?cycle=' + encodeURIComponent(cycleId));
};
$('pasteBtn').onclick = () => $('importDialog').showModal();
$('importBtn').onclick = () => $('importFile').click();
async function importBackup(text) {
  if (pending.size) throw new Error('Salvare le note prima di importare.');
  await api('/api/import', JSON.parse(text));
  $('error').hidden = true;
  await load();
}
$('importFile').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (file) await importBackup(await file.text());
  } catch (err) {
    error(err);
  }
  event.target.value = '';
};
$('importForm').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await importBackup($('importText').value);
    $('importDialog').close();
    $('importText').value = '';
  } catch (err) {
    error(err);
  }
};
window.addEventListener('beforeunload', (event) => {
  if (pending.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});
$('tester').value = localStorage.getItem('collaudo-tester') || 'utente locale';
$('tester').onchange = () => localStorage.setItem('collaudo-tester', $('tester').value);
load().catch(error);
