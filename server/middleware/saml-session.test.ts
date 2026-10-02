import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { requireActiveSamlSession } from './saml-session';
import { isSamlSessionActive } from '../sso-saml';
vi.mock('../sso-saml', () => ({ isSamlSessionActive: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe('SAML registry revocation', () => {
  it('passes password and OIDC sessions without a registry query', async () => {
    const next = vi.fn();
    await requireActiveSamlSession({ session: {}, user: { id: 1 } } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(isSamlSessionActive).not.toHaveBeenCalled();
  });
  it('ends revoked sessions even if their session store still contains them', async () => {
    vi.mocked(isSamlSessionActive).mockResolvedValue(false);
    const next = vi.fn();
    const req = { sessionID: 'old', user: { id: 1, organizationId: 2 }, session: { samlIdentity: { organizationId: 2 } },
      logout: vi.fn(callback => callback()), } as unknown as Request;
    await requireActiveSamlSession(req, {} as Response, next);
    expect(isSamlSessionActive).toHaveBeenCalledWith('old', 1, 2);
    expect(req.logout).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
  it('forwards registry failures instead of allowing unchecked access', async () => {
    const error = new Error('Registry unavailable');
    vi.mocked(isSamlSessionActive).mockRejectedValue(error);
    const next = vi.fn();
    await requireActiveSamlSession({ sessionID: 's', user: { id: 1, organizationId: 2 }, session: { samlIdentity: {} } } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
