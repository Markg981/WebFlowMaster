import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// How many organizations the installation has is the one thing read from the database.
let organizationCount = 1;
vi.mock('./db', () => ({
  privilegedDb: { select: () => ({ from: async () => [{ count: organizationCount }] }) },
}));

const { canManageInstallation, installationAdmins, requireInstallationAdmin } = await import('./installation-admin');

const owner = { username: 'olivia', role: 'owner', kind: 'person' };

beforeEach(() => {
  organizationCount = 1;
});

describe('canManageInstallation', () => {
  it('lets the owner of the only organization, as before', async () => {
    expect(await canManageInstallation(owner, {})).toBe(true);
    expect(await canManageInstallation({ ...owner, role: 'admin' }, {})).toBe(false);
  });

  it('lets nobody once a second organization exists and nobody is named', async () => {
    organizationCount = 2;
    expect(await canManageInstallation(owner, {})).toBe(false);
  });

  it('lets exactly the people named in INSTALLATION_ADMINS', async () => {
    organizationCount = 5;
    const env = { INSTALLATION_ADMINS: ' ops , olivia ' };
    expect(installationAdmins(env)).toEqual(['ops', 'olivia']);
    expect(await canManageInstallation(owner, env)).toBe(true);
    expect(await canManageInstallation({ ...owner, username: 'oscar' }, env)).toBe(false);
    // The list replaces the single-organization rule, it does not add to it.
    organizationCount = 1;
    expect(await canManageInstallation({ ...owner, username: 'oscar' }, env)).toBe(false);
  });

  it('never lets a service account or nobody', async () => {
    expect(await canManageInstallation({ ...owner, kind: 'service' }, { INSTALLATION_ADMINS: 'olivia' })).toBe(false);
    expect(await canManageInstallation(undefined, {})).toBe(false);
  });
});

describe('requireInstallationAdmin', () => {
  function res() {
    const r = { statusCode: 0, body: undefined as any };
    return Object.assign(r, {
      status(code: number) { r.statusCode = code; return this; },
      json(payload: unknown) { r.body = payload; return this; },
    }) as unknown as Response & typeof r;
  }

  it('passes an installation admin through', async () => {
    const next = vi.fn();
    await requireInstallationAdmin({ user: owner } as unknown as Request, res(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('answers 403 with a code the client can act on', async () => {
    organizationCount = 2;
    const next = vi.fn();
    const r = res();
    await requireInstallationAdmin({ user: owner } as unknown as Request, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('installation_admin_required');
  });
});
