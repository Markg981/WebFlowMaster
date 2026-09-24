import type { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { organizations } from '@shared/schema';
import { privilegedDb } from './db';

/**
 * Who may change what belongs to the whole installation rather than to one organization: the log
 * level and log retention every organization's requests are written with, and draining the
 * runners that serve all of them.
 *
 * These were open to the owner of any organization. On an installation shared by several
 * companies that meant one customer's owner could turn logging down for everybody, or take every
 * runner out of service. Now:
 *
 * - INSTALLATION_ADMINS, a comma-separated list of usernames, names who may. Nobody else can.
 * - Without it, an organization's owners may while the installation has a single organization —
 *   the usual case of one company running its own — which is how it behaved before. As soon as a
 *   second organization exists, nobody may until the operator names someone.
 */
export function installationAdmins(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.INSTALLATION_ADMINS?.trim();
  if (!raw) return null;
  return raw.split(',').map((name) => name.trim()).filter((name) => name !== '');
}

async function organizationCount(): Promise<number> {
  // Installation-wide by nature, and organizations has no row policy: privileged on purpose.
  const [row] = await privilegedDb.select({ count: sql<number>`count(*)::int` }).from(organizations);
  return Number(row?.count ?? 0);
}

export async function canManageInstallation(
  user: { username: string; role: string; kind?: string | null } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!user || (user.kind && user.kind !== 'person')) return false;
  const named = installationAdmins(env);
  if (named) return named.includes(user.username);
  return user.role === 'owner' && (await organizationCount()) === 1;
}

/** For routes that change installation-wide state. Mounted after requireRole('owner'). */
export async function requireInstallationAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (await canManageInstallation(req.user as { username: string; role: string; kind?: string })) return next();
    res.status(403).json({
      error:
        'This setting applies to the whole installation. It is changed by the people named in INSTALLATION_ADMINS, ' +
        'or by an owner while the installation has a single organization.',
      code: 'installation_admin_required',
    });
  } catch (error) {
    next(error);
  }
}
