import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';
import { and, eq, isNotNull, type SQL } from 'drizzle-orm';
import { ssoDomains } from '@shared/schema';
import { domainVerificationRecord } from '@shared/sso-roles';

/**
 * Proving an e-mail domain with DNS. Each claimed domain has a token; the owner publishes it as the
 * TXT record _wfm-verification.<domain> and presses Verify.
 *
 * With SSO_REQUIRE_DOMAIN_VERIFICATION=true an unproven domain routes no sign-in and accepts no
 * address, and an unproven claim no longer keeps a domain from another organization: whoever proves
 * it first has it. Off (the default), domains work as soon as they are saved, as before, and
 * verification is shown as advice.
 */

export function domainVerificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SSO_REQUIRE_DOMAIN_VERIFICATION?.trim().toLowerCase() === 'true';
}

export function newVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

/** The condition for a domain row that may route sign-ins: any, or only proven ones. */
export function usableDomain(domain: string, organizationId?: number): SQL {
  const conditions = [eq(ssoDomains.domain, domain)];
  if (organizationId !== undefined) conditions.push(eq(ssoDomains.organizationId, organizationId));
  if (domainVerificationRequired()) conditions.push(isNotNull(ssoDomains.verifiedAt));
  return and(...conditions)!;
}

/** For the tests: a resolver in place of the system's. */
export const dnsDeps: { resolveTxt: (name: string) => Promise<string[][]> } = { resolveTxt: (name) => dns.resolveTxt(name) };

/** Whether the domain's TXT record carries the token. Null when it does; otherwise what was found. */
export async function checkDomainRecord(domain: string, token: string): Promise<string | null> {
  const { name, value } = domainVerificationRecord(domain, token);
  let records: string[][];
  try {
    records = await dnsDeps.resolveTxt(name);
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'ENOTFOUND' || code === 'ENODATA'
      ? `No TXT record at ${name} yet. Publish "${value}" there; DNS can take a while to answer with it.`
      : `DNS did not answer for ${name} (${code ?? (error as Error).message}).`;
  }
  const found = records.map((parts) => parts.join(''));
  if (found.some((record) => record.trim() === value)) return null;
  return `${name} has ${found.length} TXT record(s), none of them "${value}".`;
}
