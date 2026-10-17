import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { localDir } from './local-dir.mjs';
import {
  EXIT_NOT_READY,
  EXIT_OK,
  EXIT_TOOL_ERROR,
  pilotReport,
  reportMarkdown,
  validateDecision,
  validateLog,
  validatePilot,
} from './pilot-core.mjs';

/**
 * The pilot of P19: one report from the pilot file, the observer's log and the runs of the
 * pilot's plans, and the owner's adoption decision checked against that report.
 *
 *   node scripts/wfm-pilot.mjs report --pilot pilot.json --log observations.json [--runs runs.json]
 *   node scripts/wfm-pilot.mjs decide --report .local/pilot/<id>/report.json --decision decision.json
 *
 * Without --runs the report reads the runs from the installation of the pilot through /api/v1
 * (WFM_PILOT_URL and WFM_PILOT_API_KEY, a key with runs:read): never from a database, and the key
 * never goes in a file or an argument. What it writes lands in .local/pilot/<id>/.
 *
 * Exit codes: 0 ready for a decision / decision recorded, 1 incomplete, blocked or decision
 * refused, 2 the tool could not run.
 */

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'report' && command !== 'decide')
    return {
      error:
        'Usage: wfm-pilot report --pilot <file> --log <file> [--runs <file>] | decide --report <file> --decision <file>',
    };
  const options = { command };
  const flags = {
    '--pilot': 'pilot',
    '--log': 'log',
    '--runs': 'runs',
    '--report': 'report',
    '--decision': 'decision',
    '--out': 'out',
  };
  for (let i = 0; i < rest.length; i += 2) {
    const key = flags[rest[i]];
    if (!key || rest[i + 1] === undefined)
      return { error: `Unknown or incomplete option ${rest[i]}.` };
    options[key] = rest[i + 1];
  }
  const needed = command === 'report' ? ['pilot', 'log'] : ['report', 'decision'];
  for (const key of needed)
    if (!options[key]) return { error: `--${key} is required for ${command}.` };
  return options;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The runs of the pilot's plans in the window, each with its units, through /api/v1. */
export async function fetchRuns(pilot, env, fetchImpl = fetch) {
  const base = (env.WFM_PILOT_URL ?? '').replace(/\/+$/, '');
  const key = env.WFM_PILOT_API_KEY;
  if (!base || !key)
    throw new Error(
      'Give --runs <file>, or WFM_PILOT_URL and WFM_PILOT_API_KEY (scope runs:read).',
    );
  const call = async (route) => {
    const response = await fetchImpl(`${base}${route}`, { headers: { 'X-API-Key': key } });
    if (!response.ok) throw new Error(`${route}: ${response.status}`);
    return response.json();
  };
  const start = Date.parse(pilot.window.start);
  const runs = [];
  for (const flow of pilot.flows) {
    for (let offset = 0; ; offset += 100) {
      const page = await call(
        `/api/v1/runs?planId=${encodeURIComponent(flow.planId)}&limit=100&offset=${offset}`,
      );
      runs.push(...page.items);
      const oldest = page.items.at(-1);
      // Newest first: past the window's start there is nothing more of the pilot.
      if (page.items.length < 100 || Date.parse(oldest.startedAt ?? oldest.queuedAt) < start) break;
    }
  }
  for (const run of runs) {
    const units = [];
    for (let offset = 0; ; offset += 100) {
      const page = await call(
        `/api/v1/runs/${encodeURIComponent(run.id)}/units?limit=100&offset=${offset}`,
      );
      units.push(...page.items);
      if (!page.items.length || units.length >= page.total) break;
    }
    run.units = units;
  }
  return runs;
}

export async function main(argv, env = process.env, io = console, fetchImpl = fetch) {
  const options = parseArgs(argv);
  if (options.error) {
    io.error(options.error);
    return EXIT_TOOL_ERROR;
  }
  try {
    if (options.command === 'report') {
      const pilot = readJson(options.pilot);
      const log = readJson(options.log);
      const problems = [...validatePilot(pilot), ...validateLog(log, pilot)];
      if (problems.length) {
        io.error(`The pilot cannot be measured:\n- ${problems.join('\n- ')}`);
        return EXIT_TOOL_ERROR;
      }
      const runs = options.runs ? readJson(options.runs) : await fetchRuns(pilot, env, fetchImpl);
      const report = pilotReport(pilot, log, runs);
      const out = options.out ?? localDir('pilot', pilot.id);
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(path.join(out, 'report.md'), reportMarkdown(report));
      io.log(`Pilot ${pilot.id}: ${report.verdict} — ${path.join(out, 'report.md')}`);
      for (const id of report.reopenedIds) io.log(`  reopened: ${id}`);
      for (const missing of report.missing) io.log(`  missing: ${missing}`);
      return report.verdict === 'ready_for_decision' ? EXIT_OK : EXIT_NOT_READY;
    }
    const report = readJson(options.report);
    const decision = readJson(options.decision);
    const problems = validateDecision(decision, report);
    if (problems.length) {
      io.error(`The decision does not stand on this report:\n- ${problems.join('\n- ')}`);
      return EXIT_NOT_READY;
    }
    const out = options.out ?? path.dirname(options.report);
    writeFileSync(path.join(out, 'decision.json'), `${JSON.stringify(decision, null, 2)}\n`);
    io.log(
      `Pilot ${report.pilot}: ${decision.decision} by ${decision.decidedBy} on ${decision.decidedOn}.`,
    );
    return EXIT_OK;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return EXIT_TOOL_ERROR;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main(process.argv.slice(2));
