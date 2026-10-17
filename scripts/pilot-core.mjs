// The pilot of P19, measured from what the pilot leaves behind and nothing else: the pilot file
// (team, flows, operator, observation window, the team's current tool measured on the same
// flows), the observer's log (timed events: installation, first test, parametrization, CI run,
// diagnosis of a failure, recorder corrections, locator fixes, incidents) and the runs the
// installation recorded in the window. No number here is a default or a vendor figure: what was
// not observed stays missing, and a missing measure keeps the gate closed.
//
// Two verdicts, kept apart on purpose. The pilot report says whether there is enough evidence to
// decide (`ready_for_decision`), or why not (`incomplete`, `blocked`). The decision record is the
// owner's adoption decision on that evidence and on the support capacity; it never derives from
// the build's technical approval (P18), which it only cites.

export const EXIT_OK = 0;
export const EXIT_NOT_READY = 1;
export const EXIT_TOOL_ERROR = 2;

/** What the operator does in the pilot, in order; each has a start and an end event. */
export const PILOT_TASKS = ['install', 'first_test', 'parametrize', 'ci_run', 'diagnosis'];

/** Measures compared with the team's current tool, on the same flow. */
export const COMPARED_MEASURES = [
  'timeToFirstGreenMin',
  'recorderCorrections',
  'diagnosisMin',
  'locatorFixes',
  'retries',
  'runMinutes',
];

/**
 * Incidents that reopen an audit ID instead of counting as noise: one is enough. Each names the
 * ID it reopens, so the fix goes to that lot's tests, not to a statistic.
 */
export const INCIDENT_KINDS = {
  false_green: 'a run reported passed although a step, result or check had failed or was missing',
  lost_evidence: 'a result, screenshot, video, trace or log the run promised is not reachable',
  authorization: 'someone read or changed what their role or key scope does not allow',
  blocker: 'the operator could not go on without help from who wrote the product',
};

export const AUDIT_IDS = [
  'C01',
  'C02',
  'C03',
  'C04',
  'C05',
  'C06',
  'C07',
  'C08',
  'C09',
  'C10',
  'C11',
  'M01',
  'M02',
  'M03',
  'M04',
  'Release',
];

/** Where a baseline figure may come from: measured by the team, never a vendor's claim. */
export const BASELINE_SOURCES = ['measured'];

export const DECISIONS = ['adopt', 'adopt_limited', 'extend_pilot', 'reject'];

const EVENT_KINDS = new Set([
  ...PILOT_TASKS.flatMap((task) => [`${task}_start`, `${task}_end`]),
  'first_green',
  'recorder_correction',
  'locator_fix',
  'incident',
  'note',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const time = (value) => (isText(value) ? Date.parse(value) : Number.NaN);
const minutes = (from, to) => Math.round(((to - from) / 60000) * 10) / 10;

/** The pilot file's problems, as sentences; empty when it can be used. */
export function validatePilot(pilot) {
  if (!isObject(pilot)) return ['The pilot file is not a JSON object.'];
  const problems = [];
  if (!isText(pilot.id)) problems.push('id: name the pilot.');
  if (!isText(pilot.owner)) problems.push('owner: the person who selected team and flows.');
  if (!isObject(pilot.team) || !isText(pilot.team.name))
    problems.push('team.name: the team or customer of the pilot.');
  if (!isText(pilot.team?.currentTool))
    problems.push('team.currentTool: the tool the team uses today, to compare with.');
  const start = time(pilot.window?.start);
  const end = time(pilot.window?.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start)
    problems.push('window: start and end as ISO dates, end after start.');
  const operator = pilot.operator;
  if (!isObject(operator) || !isText(operator.name))
    problems.push('operator.name: who runs the pilot tasks.');
  else if (operator.wroteProduct !== false)
    problems.push(
      'operator.wroteProduct: must be false — the tasks are run by someone who did not write the product.',
    );
  if (!Array.isArray(pilot.flows) || pilot.flows.length === 0)
    problems.push('flows: at least one representative flow.');
  const seen = new Set();
  for (const [i, flow] of (Array.isArray(pilot.flows) ? pilot.flows : []).entries()) {
    const at = `flows[${i}]`;
    if (!isObject(flow)) {
      problems.push(`${at}: not an object.`);
      continue;
    }
    if (!isText(flow.id)) problems.push(`${at}.id: name the flow.`);
    else if (seen.has(flow.id)) problems.push(`${at}.id: ${flow.id} appears twice.`);
    else seen.add(flow.id);
    if (!isText(flow.planId)) problems.push(`${at}.planId: the WFM plan that runs the flow.`);
    if (!isText(flow.why)) problems.push(`${at}.why: why the flow is representative.`);
    const baseline = flow.baseline;
    if (!isObject(baseline)) {
      problems.push(
        `${at}.baseline: the same flow measured with ${pilot.team?.currentTool ?? 'the current tool'}.`,
      );
      continue;
    }
    if (!BASELINE_SOURCES.includes(baseline.source))
      problems.push(
        `${at}.baseline.source: "${baseline.source ?? ''}" — only figures the team measured on this flow ("measured"), not vendor percentages.`,
      );
    if (Number.isNaN(time(baseline.measuredOn)))
      problems.push(`${at}.baseline.measuredOn: when the team measured it.`);
    for (const measure of COMPARED_MEASURES)
      if (baseline[measure] !== undefined && baseline[measure] !== null) {
        if (typeof baseline[measure] !== 'number' || baseline[measure] < 0)
          problems.push(`${at}.baseline.${measure}: a number of zero or more, or left out.`);
      }
  }
  return problems;
}

/** The observation log's problems, as sentences; empty when it can be used. */
export function validateLog(log, pilot) {
  if (!Array.isArray(log)) return ['The observation log is not a JSON array of events.'];
  const flows = new Set((pilot?.flows ?? []).map((flow) => flow.id));
  const problems = [];
  for (const [i, event] of log.entries()) {
    const at = `log[${i}]`;
    if (!isObject(event)) {
      problems.push(`${at}: not an object.`);
      continue;
    }
    if (!EVENT_KINDS.has(event.kind)) problems.push(`${at}.kind: unknown "${event.kind}".`);
    if (Number.isNaN(time(event.at))) problems.push(`${at}.at: an ISO timestamp.`);
    if (event.flow !== undefined && !flows.has(event.flow))
      problems.push(`${at}.flow: "${event.flow}" is not a flow of the pilot.`);
    if (event.kind === 'incident') {
      if (!Object.hasOwn(INCIDENT_KINDS, event.incident))
        problems.push(`${at}.incident: one of ${Object.keys(INCIDENT_KINDS).join(', ')}.`);
      if (!AUDIT_IDS.includes(event.reopens))
        problems.push(`${at}.reopens: the audit ID it reopens (${AUDIT_IDS.join(', ')}).`);
      if (!isText(event.what)) problems.push(`${at}.what: what happened, with the run or unit.`);
    }
    if (
      (event.kind === 'recorder_correction' || event.kind === 'locator_fix') &&
      event.count !== undefined &&
      !(Number.isInteger(event.count) && event.count > 0)
    )
      problems.push(`${at}.count: a whole number above zero, or left out for one.`);
  }
  return problems;
}

/** Runs of the plan inside the window, from /api/v1/runs records. */
function runsOf(runs, flow, start, end) {
  return runs.filter((run) => {
    const at = time(run.startedAt ?? run.queuedAt);
    return run.planId === flow.planId && at >= start && at <= end;
  });
}

/** Measures of one flow from the log and the runs; a measure nobody observed is null. */
export function measureFlow(flow, log, runs, pilot) {
  const start = time(pilot.window.start);
  const end = time(pilot.window.end);
  const events = log.filter((event) => event.flow === flow.id || event.flow === undefined);
  const first = (kind) =>
    events
      .filter((event) => event.kind === kind)
      .map((event) => time(event.at))
      .sort((a, b) => a - b)[0];
  const count = (kind) =>
    events
      .filter((event) => event.flow === flow.id && event.kind === kind)
      .reduce((sum, event) => sum + (event.count ?? 1), 0);

  const tasks = {};
  for (const task of PILOT_TASKS) {
    const from = first(`${task}_start`);
    const to = events
      .filter((event) => event.kind === `${task}_end` && time(event.at) >= (from ?? Infinity))
      .map((event) => time(event.at))
      .sort((a, b) => a - b)[0];
    tasks[task] = from !== undefined && to !== undefined ? minutes(from, to) : null;
  }

  const flowRuns = runsOf(runs, flow, start, end);
  const passed = flowRuns
    .filter((run) => run.status === 'completed')
    .map((run) => time(run.completedAt ?? run.startedAt))
    .sort((a, b) => a - b)[0];
  const firstTest = first('first_test_start');
  const observedGreen = first('first_green');
  const green = observedGreen ?? passed;
  const unitRetries = flowRuns.reduce(
    (sum, run) =>
      sum +
      (run.units ?? []).reduce(
        (units, unit) => units + Math.max(0, (unit.result?.attempts ?? 1) - 1),
        0,
      ),
    0,
  );
  const runRetries = flowRuns.reduce((sum, run) => sum + Math.max(0, (run.attempt ?? 1) - 1), 0);
  const runMs = flowRuns.reduce((sum, run) => sum + (run.durationMs ?? 0), 0);

  return {
    flow: flow.id,
    tasks,
    timeToFirstGreenMin:
      firstTest !== undefined && green !== undefined && green >= firstTest
        ? minutes(firstTest, green)
        : null,
    recorderCorrections: count('recorder_correction'),
    diagnosisMin: tasks.diagnosis,
    locatorFixes: count('locator_fix'),
    retries: flowRuns.length ? unitRetries + runRetries : null,
    runMinutes: flowRuns.length ? Math.round((runMs / 60000) * 10) / 10 : null,
    runs: {
      total: flowRuns.length,
      byStatus: flowRuns.reduce((all, run) => {
        all[run.status] = (all[run.status] ?? 0) + 1;
        return all;
      }, {}),
      withoutUnits: flowRuns.filter((run) => !Array.isArray(run.units)).length,
    },
  };
}

/** Pilot against the team's tool, measure by measure: lower is better for every one of them. */
export function compareFlow(measures, baseline) {
  return COMPARED_MEASURES.map((measure) => {
    const pilot = measures[measure];
    const current = baseline?.[measure];
    const known = typeof pilot === 'number' && typeof current === 'number';
    return {
      measure,
      pilot: pilot ?? null,
      current: current ?? null,
      delta: known ? Math.round((pilot - current) * 10) / 10 : null,
      outcome: !known
        ? 'not_comparable'
        : pilot < current
          ? 'better'
          : pilot > current
            ? 'worse'
            : 'same',
    };
  });
}

/** Every incident reopens its ID until a change that closes it is named. */
export function reviewRegister(log) {
  return log
    .filter((event) => event.kind === 'incident')
    .map((event) => ({
      at: event.at,
      flow: event.flow ?? null,
      incident: event.incident,
      reopens: event.reopens,
      what: event.what,
      run: event.run ?? null,
      closedBy: isText(event.closedBy) ? event.closedBy : null,
      state: isText(event.closedBy) ? 'closed' : 'reopened',
    }));
}

/** The pilot report: measures, comparison, review register and whether a decision can be taken. */
export function pilotReport(pilot, log, runs = []) {
  const flows = pilot.flows.map((flow) => {
    const measures = measureFlow(flow, log, runs, pilot);
    return { ...measures, why: flow.why, comparison: compareFlow(measures, flow.baseline) };
  });
  const register = reviewRegister(log);
  const missing = [];
  for (const task of PILOT_TASKS)
    if (flows.every((flow) => flow.tasks[task] === null))
      missing.push(`task ${task}: no start and end observed`);
  for (const flow of flows) {
    if (flow.timeToFirstGreenMin === null) missing.push(`${flow.flow}: no first green observed`);
    if (flow.runs.total === 0) missing.push(`${flow.flow}: no run of plan in the window`);
    if (flow.comparison.every((row) => row.outcome === 'not_comparable'))
      missing.push(`${flow.flow}: nothing comparable with ${pilot.team.currentTool}`);
  }
  const open = register.filter((entry) => entry.state === 'reopened');
  const verdict = open.length ? 'blocked' : missing.length ? 'incomplete' : 'ready_for_decision';
  return {
    pilot: pilot.id,
    owner: pilot.owner,
    team: pilot.team,
    operator: { name: pilot.operator.name, wroteProduct: pilot.operator.wroteProduct },
    window: pilot.window,
    flows,
    register,
    reopenedIds: [...new Set(open.map((entry) => entry.reopens))].sort(),
    missing,
    verdict,
  };
}

/** The decision record's problems against the report it rests on; empty when it stands. */
export function validateDecision(decision, report) {
  if (!isObject(decision)) return ['The decision file is not a JSON object.'];
  const problems = [];
  if (report.verdict !== 'ready_for_decision')
    problems.push(
      `The pilot report is ${report.verdict}: decide on a report that is ready_for_decision (${[
        ...(report.reopenedIds ?? []).map((id) => `${id} reopened`),
        ...(report.missing ?? []),
      ].join('; ')}).`,
    );
  if (decision.pilot !== report.pilot)
    problems.push(`pilot: "${decision.pilot ?? ''}" is not the report's pilot "${report.pilot}".`);
  if (!DECISIONS.includes(decision.decision))
    problems.push(`decision: one of ${DECISIONS.join(', ')}.`);
  if (!isText(decision.decidedBy)) problems.push('decidedBy: the owner who decides.');
  if (Number.isNaN(time(decision.decidedOn))) problems.push('decidedOn: an ISO date.');
  if (!isText(decision.target))
    problems.push('target: the commercial target the data supports (who, which installation).');
  const matrix = decision.matrix;
  if (!isObject(matrix) || !Array.isArray(matrix.supported) || matrix.supported.length === 0)
    problems.push('matrix.supported: the browsers, surfaces and installations to support.');
  if (!Array.isArray(decision.evidence) || decision.evidence.length === 0)
    problems.push('evidence: the report measures or register entries the decision rests on.');
  const support = decision.support;
  if (
    !isObject(support) ||
    !isText(support.owner) ||
    !(typeof support.hoursPerWeek === 'number' && support.hoursPerWeek > 0) ||
    !isText(support.channel)
  )
    problems.push('support: owner, hoursPerWeek above zero and channel of who supports the team.');
  if (!isText(decision.buildApproval))
    problems.push('buildApproval: the release qualified in P18 — cited, not the decision itself.');
  if (decision.decision === 'adopt_limited' && !isText(decision.limits))
    problems.push('limits: what adopt_limited leaves out.');
  if (decision.featureFreezeUntilGate !== true)
    problems.push('featureFreezeUntilGate: true — no new functional scope before this gate.');
  return problems;
}

function cell(value) {
  return value === null || value === undefined ? '—' : String(value);
}

/** The report in Markdown, for the owner and the pilot's evidence folder. */
export function reportMarkdown(report) {
  const lines = [
    `# Pilot ${report.pilot}`,
    '',
    `Owner: ${report.owner} · team: ${report.team.name} · current tool: ${report.team.currentTool}`,
    `Operator: ${report.operator.name} (did not write the product) · window: ${report.window.start} → ${report.window.end}`,
    '',
    `**Verdict: ${report.verdict}**`,
    '',
  ];
  for (const flow of report.flows) {
    lines.push(`## ${flow.flow}`, '', flow.why, '');
    lines.push('| Task | Minutes |', '| --- | --- |');
    for (const task of PILOT_TASKS) lines.push(`| ${task} | ${cell(flow.tasks[task])} |`);
    lines.push('', `| Measure | Pilot | ${report.team.currentTool} | Delta | Outcome |`);
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of flow.comparison)
      lines.push(
        `| ${row.measure} | ${cell(row.pilot)} | ${cell(row.current)} | ${cell(row.delta)} | ${row.outcome} |`,
      );
    const statuses = Object.entries(flow.runs.byStatus)
      .map(([status, n]) => `${status} ${n}`)
      .join(', ');
    lines.push(
      '',
      `Runs in the window: ${flow.runs.total}${statuses ? ` (${statuses})` : ''}.`,
      '',
    );
  }
  lines.push('## Review register', '');
  if (!report.register.length)
    lines.push('No false green, lost evidence, authorization incident or blocker.');
  else {
    lines.push('| When | Incident | Reopens | What | State |', '| --- | --- | --- | --- | --- |');
    for (const entry of report.register)
      lines.push(
        `| ${entry.at} | ${entry.incident} | ${entry.reopens} | ${entry.what.replace(/\|/g, '\\|')} | ${entry.state}${entry.closedBy ? ` (${entry.closedBy})` : ''} |`,
      );
  }
  if (report.missing.length)
    lines.push('', '## Missing', '', ...report.missing.map((m) => `- ${m}`));
  lines.push('');
  return lines.join('\n');
}
