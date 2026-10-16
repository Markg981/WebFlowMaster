/**
 * Which browsers a run uses: the ones its plan names, on the grid or agent pool it names, less
 * the ones this runner cannot start.
 */
import { eq } from 'drizzle-orm';
import { browserGrids } from '@shared/schema';
import { BROWSER_GRID_LABELS, type BrowserGridProvider } from '@shared/browser-grids';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { AgentHttp } from '../../runtime/agents/agent-fetch';
import { gridWarnings } from '../../runtime/browser-grids';
import {
  browsersForRun,
  describeBrowser,
  hasConfiguredBrowsers,
  launchBrowser,
  onAgents,
  onGrid,
  type BrowserChoice,
} from '../../runtime/browsers';
import type { PassTarget } from '../execution-units';
import { emit, report, type PlanRun } from './context';
import type { RunInputs } from './inputs';

/** A pass is the whole plan on one browser; `undefined` is "whatever the runner would have used". */
export type Pass = BrowserChoice | undefined;

export interface RunBrowsers {
  /** The plan's browsers, before a grid or agent pool was applied. */
  matrix: BrowserChoice[];
  passes: Pass[];
  /** Where a plan on an agent pool sends its API requests; null for any other plan. */
  agentHttp: AgentHttp | null;
}

export async function resolveBrowsers(run: PlanRun, inputs: RunInputs): Promise<RunBrowsers> {
  const { snapshot, organizationId } = inputs;
  const configuredBrowsers =
    hasConfiguredBrowsers(snapshot.browsers.requested) ||
    hasConfiguredBrowsers(snapshot.browsers.testMachines);
  // A plan on a browser grid (shared/browser-grids.ts). A pool of agents wins if both were ever
  // set; the plan routes refuse to save both.
  const gridId = snapshot.runOn?.agentPool ? null : (snapshot.runOn?.browserGridId ?? null);
  const [gridRow] = gridId
    ? await withTenantTransaction((tx) =>
        tx
          .select({
            id: browserGrids.id,
            name: browserGrids.name,
            provider: browserGrids.provider,
          })
          .from(browserGrids)
          .where(eq(browserGrids.id, gridId))
          .limit(1),
      )
    : [];
  // Gone between the snapshot and now: each test says so when its browser cannot be opened.
  const grid = gridId
    ? {
        id: gridId,
        name: gridRow?.name ?? gridId,
        provider: (gridRow?.provider ?? 'playwright_server') as BrowserGridProvider,
      }
    : null;
  const { browsers: matrix, warnings } = browsersForRun({
    executionBrowsers: snapshot.browsers.requested,
    testMachines: snapshot.browsers.testMachines,
    onGrid: !!grid,
  });
  // `undefined` means "whatever the runner would have used", which is the user's own setting
  // — exactly what every plan did before its browser configuration was honoured.
  const basePasses: Pass[] = configuredBrowsers ? matrix : [undefined];
  // A plan set to a pool of local agents borrows its browsers from them (shared/agents.ts).
  const agentPool = snapshot.runOn?.agentPool ?? null;
  const passes: Pass[] = agentPool
    ? onAgents(basePasses, { organizationId, pool: agentPool })
    : grid
      ? onGrid(basePasses, grid)
      : basePasses;
  if (grid) {
    warnings.push(
      ...new Set(
        passes.flatMap((pass) =>
          pass?.grid
            ? gridWarnings(grid.provider, { label: pass.grid.browserName, ...pass.machine })
            : [],
        ),
      ),
    );
    emit(run, {
      level: 'info',
      message: `Browsers for this run come from the ${BROWSER_GRID_LABELS[grid.provider]} grid "${grid.name}": ${passes.map((pass) => pass?.label).join(', ')}.`,
      metadata: { browserGrid: grid.name, provider: grid.provider },
    });
  }
  // Its API requests go out from the same agents, so they reach what its pages reach. Nothing is
  // borrowed until the first request: a plan without API tests or preconditions never asks.
  const agentHttp = agentPool ? new AgentHttp({ organizationId, pool: agentPool }) : null;
  if (agentPool) {
    emit(run, {
      level: 'info',
      message:
        `Browsers for this run come from the local agents of pool "${agentPool}", so pages open from their network. ` +
        `Its API tests, API preconditions and OAuth token requests are sent from those agents too.`,
      metadata: { agentPool },
    });
  }
  for (const warning of warnings) report(run, { level: 'warn', message: warning });
  if (configuredBrowsers) {
    emit(run, {
      level: 'info',
      message: `Running this plan on ${passes.length} browser(s): ${matrix.map(describeBrowser).join(', ')}.`,
      metadata: { browsers: matrix.map((b) => b.label) },
    });
  }
  return { matrix, passes, agentHttp };
}

/**
 * Browsers the plan asked for that this runner cannot start.
 *
 * Checked once, before any test runs, rather than discovered by every test in turn: "Edge
 * is not installed here" is one fact about the machine, and reporting it as forty failed
 * logins sends forty people to read the login test.
 */
export interface UsableBrowsers {
  passes: Pass[];
  startupFailures: string[];
  /**
   * Every browser the plan asked for and what became of it, in order: the run's manifest expects
   * the units of one that would not start too (server/execution/execution-units.ts).
   */
  targets: PassTarget[];
}

export async function probeBrowsers(
  run: PlanRun,
  passes: Pass[],
  { onlyBdd }: { onlyBdd: boolean },
): Promise<UsableBrowsers> {
  const startupFailures: string[] = [];
  const usable: Pass[] = [];
  const targets: PassTarget[] = [];
  if (onlyBdd) {
    usable.push(undefined);
    targets.push({ requested: undefined, started: undefined });
  }
  // A helper runs the browsers the coordinator resolved, as its work items say.
  for (const pass of run.helper || onlyBdd ? [] : passes) {
    if (!pass) {
      usable.push(pass);
      targets.push({ requested: pass, started: pass });
      continue;
    }
    const failuresBefore = startupFailures.length;
    const started = await startablePass(pass);
    if (started) usable.push(started);
    targets.push({
      requested: pass,
      started,
      ...(started ? {} : { failure: startupFailures[failuresBefore] }),
    });
  }
  return { passes: usable, startupFailures, targets };

  /** The pass as it can start here, or null after saying why it cannot. */
  async function startablePass(pass: BrowserChoice): Promise<BrowserChoice | null> {
    try {
      const probe = await launchBrowser(pass);
      await probe.close();
      return pass;
    } catch (error: unknown) {
      // The plan wizard's machine configuration defaults to headed, and a runner in a
      // container has no display to be headed on. Falling back is better than failing the
      // whole pass over a checkbox nobody deliberately ticked — as long as the report says
      // that is what happened.
      if (pass.headless === false) {
        try {
          const probe = await launchBrowser({ ...pass, headless: true });
          await probe.close();
          report(run, {
            level: 'warn',
            message: `${pass.label} could not start headed on this runner; it ran headless instead.`,
            metadata: { browser: pass.label },
          });
          return { ...pass, headless: true };
        } catch {
          // Fall through to reporting the original failure.
        }
      }
      // A branded build (Google Chrome, Microsoft Edge) is a channel of an engine, and a runner
      // installed from the Playwright image has the engine but not the brand. "chrome" is what the
      // plan wizard offers first, so failing the pass left most plans with no results at all and
      // a run_incomplete nobody could explain. The engine underneath runs the same tests; the
      // report says that is what happened.
      if (pass.channel) {
        const onEngine: BrowserChoice = { ...pass, channel: undefined };
        for (const headless of pass.headless === false ? [false, true] : [true]) {
          try {
            const probe = await launchBrowser({ ...onEngine, headless });
            await probe.close();
            report(run, {
              level: 'warn',
              message:
                `${pass.label} (channel "${pass.channel}") is not installed on this runner; ` +
                `its tests ran on Playwright's bundled ${pass.engine} instead.`,
              metadata: { browser: pass.label, channel: pass.channel, engine: pass.engine },
            });
            return { ...onEngine, headless };
          } catch {
            // Try headless next, then report the original failure.
          }
        }
      }
      const message = (error as Error)?.message ?? String(error);
      startupFailures.push(message);
      report(run, { level: 'error', message, metadata: { browser: pass.label } });
      return null;
    }
  }
}
