import { createRequire } from 'module';
import playwright, { type Browser } from 'playwright';
import { AGENT_PATHS } from '@shared/agents';
import { relaySecret, signTicket } from './agent-credentials';

/**
 * A browser borrowed from a local agent, as the runner sees it: a Playwright Browser like any
 * other. Connected through the relay (server/agents/relay.ts) with a ticket for this organization
 * and pool.
 */

export interface AgentTarget {
  organizationId: number;
  pool: string;
}

const require = createRequire(import.meta.url);
export const RUNNER_PLAYWRIGHT_VERSION: string = require('playwright/package.json').version;

/** Where runners reach the relay: AGENT_RELAY_URL, or this machine's own web server. */
export function relayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AGENT_RELAY_URL || `http://127.0.0.1:${env.PORT || 5000}`).replace(/\/+$/, '');
}

export async function connectToAgentBrowser(
  choice: { engine: 'chromium' | 'firefox' | 'webkit'; channel?: string; headless: boolean; agent: AgentTarget },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Browser> {
  const ticket = signTicket(
    {
      organizationId: choice.agent.organizationId,
      pool: choice.agent.pool,
      engine: choice.engine,
      ...(choice.channel ? { channel: choice.channel } : {}),
      headless: choice.headless,
      playwrightVersion: RUNNER_PLAYWRIGHT_VERSION,
    },
    relaySecret(env),
  );
  const base = relayBaseUrl(env);

  // Asked first, for an error that says which agent is missing rather than "WebSocket error 503".
  let availability: { available: boolean; reason?: string };
  try {
    const response = await fetch(`${base}/api/agent/v1/availability?ticket=${encodeURIComponent(ticket)}`);
    availability = await response.json();
  } catch (error) {
    throw new Error(`The agent relay at ${base} could not be reached: ${(error as Error).message}. Set AGENT_RELAY_URL on the runners.`);
  }
  if (!availability.available) throw new Error(availability.reason ?? 'No agent could lend a browser.');

  const endpoint = `${base.replace(/^http/i, 'ws')}${AGENT_PATHS.browser}?ticket=${encodeURIComponent(ticket)}`;
  return playwright[choice.engine].connect(endpoint, { timeout: 60_000 });
}
