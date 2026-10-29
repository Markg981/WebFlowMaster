import { resolvePort } from './platform/config';
import { registrationMode } from './identity/registration';
import { trustProxySetting } from './platform/trust-proxy';
import { cspMode } from './platform/security-headers';

/**
 * Every environment setting that can be wrong without touching the network, checked before
 * anything does.
 *
 * Each of these already threw on a bad value, but from wherever it was first read — setupAuth,
 * securityHeaders, the listen call — and the start reaches those only after PostgreSQL and
 * Redis have answered. With either of them down, or not yet up, the operator saw
 * ECONNREFUSED and never the misspelt variable that would have stopped the start anyway.
 * All problems are reported at once, so fixing one does not just reveal the next.
 */
export function startupConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];
  if (!env.SESSION_SECRET) errors.push('SESSION_SECRET must be set for session security.');
  if (env.NODE_ENV === 'production') errors.push(...publishedSecretErrors(env));
  if (env.NODE_ENV === 'production') errors.push(...publicUrlErrors(env));
  for (const check of [
    () => registrationMode(env),
    () => cspMode(env),
    () => resolvePort(env),
    () => trustProxySetting(env),
  ]) {
    try {
      check();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (env.NODE_ENV === 'production' && sharedInstallation(env) && !egressExplicitlyDeny(env)) {
    errors.push(
      'EGRESS_PRIVATE_TARGETS must be "deny" while REGISTRATION=open (anyone can create an organization): "allow" lets their tests reach this server\'s private network. Set it to "deny" and list intranet hosts in EGRESS_ALLOW_HOSTS.',
    );
  }
  return errors;
}

/** Self-service organization creation is the codebase's signal for a shared (multi-organization) installation. */
function sharedInstallation(env: NodeJS.ProcessEnv): boolean {
  try {
    return registrationMode(env) === 'open';
  } catch {
    return false; // reported by its own check
  }
}

function egressExplicitlyDeny(env: NodeJS.ProcessEnv): boolean {
  return env.EGRESS_PRIVATE_TARGETS?.trim().toLowerCase() === 'deny';
}

/** Non-fatal findings, logged at startup. */
export function startupConfigWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return warnings;
  if (!env.EGRESS_PRIVATE_TARGETS?.trim()) {
    warnings.push(
      'EGRESS_PRIVATE_TARGETS is not set: it defaults to "allow", so tests can reach loopback and private addresses of this server\'s network. Set it explicitly ("deny" unless tests must reach an intranet).',
    );
  }
  if (!env.TRUST_PROXY?.trim()) {
    warnings.push(
      'TRUST_PROXY is not set: assuming exactly 1 reverse proxy in front. Set it to the real proxy chain (hop count, false when none, or proxy IPs/CIDRs), or client IPs and per-IP rate limits can be forged via X-Forwarded-For.',
    );
  }
  const key = env.ENCRYPTION_KEY ?? '';
  if (key && !/^[0-9a-fA-F]{64}$/.test(key) && key.length < 32) {
    warnings.push(
      'ENCRYPTION_KEY is not a 64-character hex string and is shorter than 32 characters: it is hashed with plain SHA-256 and is easy to guess. Use `openssl rand -hex 32`; changing it needs ENCRYPTION_KEY_PREVIOUS for the old value.',
    );
  }
  return warnings;
}

/**
 * Values anyone can read in this repository: the placeholders of .env.example and what
 * docker-compose.yml shipped before it required its own. A stack started with one of them and
 * then exposed signs its sessions, and encrypts its stored secrets, with a key that is public.
 */
const PUBLISHED_SECRETS: Record<string, string[]> = {
  SESSION_SECRET: ['change-me', '7G823eU1afEmmjSg73Juk_wRoVPt6mqbjBXliA6XXNg'],
  ENCRYPTION_KEY: ['change-me-64-hex-characters', '0'.repeat(64)],
  AGENT_RELAY_SECRET: ['change-me', '4Qm9zR2vX7cL1pT8wK3nB6yH5dF0sJ'],
};

function publishedSecretErrors(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(PUBLISHED_SECRETS)
    .filter(([name, published]) => published.includes(env[name]?.trim() ?? ''))
    .map(
      ([name]) =>
        `${name} is a published example value; generate your own: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
}

export function assertStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors = startupConfigErrors(env);
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Connects the session store's Redis before the first request. In production a failure stops
 * the start with the reason Redis gave: the shared store is mandatory there (several web
 * processes and the worker read the same sessions), and the message "logins will not persist"
 * that the start used to log hid the cause behind the generic refusal createSessionStore()
 * raised a moment later. Elsewhere the in-memory store is a local convenience, so it only warns.
 */
export async function connectSessionStore(
  connect: () => Promise<void>,
  warn: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    await connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (env.NODE_ENV === 'production') {
      throw new Error(
        `Session Redis is not reachable (${reason}). Production needs the shared session store: check REDIS_URL and that Redis is up.`,
      );
    }
    warn(
      `Session Redis is not reachable (${reason}); using an in-memory session store: logins will not survive a restart.`,
    );
  }
}

/** Emailed links must name this installation, never the Host header of whoever asked. */
function publicUrlErrors(env: NodeJS.ProcessEnv): string[] {
  const value = env.WEBFLOW_PUBLIC_URL?.trim();
  const hint =
    'WEBFLOW_PUBLIC_URL must be set in production to the absolute http(s) address users reach WebFlowMaster at.';
  if (!value) return [hint];
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return [];
  } catch {
    // fall through
  }
  return [`${hint} Got "${value}".`];
}
