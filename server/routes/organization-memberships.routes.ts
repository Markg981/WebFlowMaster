import { type Request, type Response, type NextFunction } from 'express';
import { asyncRouter } from '../middleware/async-router';
import { z } from 'zod';
import { AUDIT_ACTIONS, type User as SelectUser } from '@shared/schema';
import { requireRole } from '../middleware/require-role';
import { publicUser, recordAuthEvent } from '../auth';
import { ssoRequiredFor } from '../sso';
import {
  acceptInvitationAsMember,
  describeInvitation,
  membershipsOf,
  switchOrganization,
} from '../tenancy/organization-memberships';

/**
 * A person's organizations (migration 0086): which they belong to, moving between them, and
 * joining one more by invitation.
 *
 * Sessions only. An API key acts as its user in one organization and cannot switch: a pipeline's
 * key that could act anywhere its owner may would be a wider credential than the one that was
 * issued. The switch starts a new session (req.login regenerates it), as a sign-in does.
 */
const router = asyncRouter();

function sessionOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as Request & { apiKeyId?: string }).apiKeyId) {
    return res.status(403).json({
      error: 'Organizations are switched from a signed-in session, not with an API key.',
      code: 'session_required',
    });
  }
  next();
}

router.get(
  '/api/organizations/mine',
  requireRole('viewer'),
  async (req: Request, res: Response) => {
    res.json(await membershipsOf(req.user as SelectUser));
  },
);

router.post(
  '/api/organizations/switch',
  requireRole('viewer'),
  sessionOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = z.object({ organizationId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid organizationId' });
    const user = req.user as SelectUser;
    const from = user.organizationId;
    if (parsed.data.organizationId === from) return res.json(await publicUser(user));

    // Said before anything changes: a password session cannot move into an organization that
    // signs in through its provider, since requireSso would end it on the next request.
    const memberships = await membershipsOf(user);
    const target = memberships.find((m) => m.id === parsed.data.organizationId);
    if (!target)
      return res.status(403).json({ error: 'You are not a member of that organization.' });
    const signedInWithSso = req.session?.signedInWith === 'sso';
    if (
      !signedInWithSso &&
      (await ssoRequiredFor({ role: target.role, organizationId: target.id, kind: user.kind }))
    ) {
      return res.status(403).json({
        error:
          'That organization signs in with single sign-on. Sign in to it with "Sign in with SSO".',
        code: 'sso_required',
      });
    }

    const switched = await switchOrganization(user.id, parsed.data.organizationId);
    if (!switched)
      return res.status(403).json({ error: 'You are not a member of that organization.' });

    // keepSessionInfo: how this session was opened (password or provider, and the SAML identity
    // to log out of) is still true of it; only the organization it acts in changed.
    req.login(switched, { session: true, keepSessionInfo: true }, async (loginError) => {
      if (loginError) return next(loginError);
      await recordAuthEvent(switched, AUDIT_ACTIONS.ORGANIZATION_SWITCHED, req.ip, {
        fromOrganizationId: from,
      });
      try {
        res.json(await publicUser(switched, signedInWithSso));
      } catch (error) {
        next(error);
      }
    });
  },
);

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** What the link is for, before joining. Null is one answer for every way it is not usable. */
router.get(
  '/api/invitations/preview',
  requireRole('viewer'),
  sessionOnly,
  async (req: Request, res: Response) => {
    const token = tokenSchema.safeParse(req.query.token);
    if (!token.success) return res.status(400).json({ error: 'Invalid invitation' });
    const described = await describeInvitation(req.user as SelectUser, token.data);
    if (!described) return res.status(404).json({ error: 'That invitation is not valid.' });
    res.json(described);
  },
);

router.post(
  '/api/invitations/accept',
  requireRole('viewer'),
  sessionOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = z.object({ token: tokenSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid invitation' });
    const user = req.user as SelectUser;
    const result = await acceptInvitationAsMember(user, parsed.data.token);
    if ('error' in result) {
      if (result.error === 'member')
        return res.status(409).json({ error: 'You are already a member of that organization.' });
      if (result.error === 'other_account')
        return res.status(403).json({ error: 'That invitation is for another account.' });
      // One message for unknown, used and expired, as registration gives: telling them apart
      // would help someone probing the token space.
      return res.status(400).json({ error: 'That invitation is not valid.' });
    }
    const signedInWithSso = req.session?.signedInWith === 'sso';
    req.login(result, { session: true, keepSessionInfo: true }, async (loginError) => {
      if (loginError) return next(loginError);
      await recordAuthEvent(result, AUDIT_ACTIONS.ORGANIZATION_SWITCHED, req.ip, {
        fromOrganizationId: user.organizationId,
        byInvitation: true,
      });
      try {
        res.json(await publicUser(result, signedInWithSso));
      } catch (error) {
        next(error);
      }
    });
  },
);

export default router;
