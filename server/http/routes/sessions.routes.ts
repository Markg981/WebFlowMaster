import { asyncRouter } from '../../platform/middleware/async-router';
import { requireRole } from '../middleware/require-role';
import { sessionRateLimit } from '../middleware/rate-limits';
import { AUDIT_ACTIONS } from '@shared/schema';
import { recordAuthEvent } from '../../identity/auth';
import { listSessions, revokeOtherSessions, revokeSession } from '../../identity/session-registry';

/**
 * A member's own signed-in sessions: list, end one, end all the others (audit R-5).
 * Browser sessions only: an API key has no session.
 */
const router = asyncRouter();
const sessionLimit = sessionRateLimit();

router.get('/api/me/sessions', sessionLimit, requireRole('viewer'), async (req, res) => {
  res.json(await listSessions(req.sessionStore, req.user!.id, req.sessionID));
});

router.delete('/api/me/sessions', sessionLimit, requireRole('viewer'), async (req, res) => {
  const count = await revokeOtherSessions(req.sessionStore, req.user!.id, req.sessionID);
  await recordAuthEvent(req.user!, AUDIT_ACTIONS.SESSIONS_REVOKED_OTHERS, req.ip, { count });
  res.json({ revoked: count });
});

router.delete('/api/me/sessions/:id', sessionLimit, requireRole('viewer'), async (req, res) => {
  const done = await revokeSession(req.sessionStore, req.user!.id, req.sessionID, req.params.id);
  if (!done) return res.status(404).json({ error: 'Session not found.' });
  await recordAuthEvent(req.user!, AUDIT_ACTIONS.SESSION_REVOKED, req.ip);
  res.status(204).end();
});

export default router;
