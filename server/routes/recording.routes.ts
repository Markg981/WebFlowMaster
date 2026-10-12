import { asyncRouter } from '../platform/middleware/async-router';
import { z } from 'zod';
import { asyncHandler } from '../platform/middleware/async-handler';
import { sharedHeavyRateLimit } from '../middleware/rate-limits';
import { requireRole } from '../middleware/require-role';
import { playwrightService } from '../web/playwright-service';

/**
 * Recording a test: a visible browser window on the machine running this server, whose
 * actions are polled back into the editor as a sequence.
 */

const router = asyncRouter();
// After requireRole, so it counts for the user the role check has already established.
const heavyLimit = sharedHeavyRateLimit();

const startRecordingSchema = z.object({ url: z.string().url('Invalid URL format') });
const sessionSchema = z.object({ sessionId: z.string().min(1, 'Session ID is required') });
const loginStateSchema = sessionSchema.extend({ environmentId: z.number().int().positive() });

function invalidRequest(error: z.ZodError) {
  return { error: 'Invalid request data', details: error.flatten() };
}

/**
 * Whether this server can open the visible browser window a recording needs.
 *
 * Recording is inherently local: Playwright launches the window on the machine running
 * this process, not in the user's browser. The one thing the server can check for certain
 * is whether it has a display at all — a Linux container without DISPLAY never will — so
 * the UI can disable the button with a real reason instead of failing at launch time.
 */
router.get('/api/recording-capability', requireRole('viewer'), (_req, res) => {
  const headlessOnly = process.platform === 'linux' && !process.env.DISPLAY;
  res.json({
    supported: !headlessOnly,
    reason: headlessOnly ? 'no-display' : undefined,
    // Always reported: the window appears here, which is only useful to the user when
    // the server runs on their own machine.
    serverPlatform: process.platform,
  });
});

router.post(
  '/api/start-recording',
  requireRole('editor'),
  heavyLimit,
  asyncHandler(async (req, res) => {
    const parseResult = startRecordingSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json(invalidRequest(parseResult.error));

    const result = await playwrightService.startRecordingSession(
      parseResult.data.url,
      req.user!.id,
    );
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to start recording session',
      });
    }
    res.json({ success: true, sessionId: result.sessionId });
  }),
);

/**
 * Saves the recorder browser's current session against an environment.
 *
 * Called after the tester has signed in inside the recorder window, so runs against that
 * environment start authenticated instead of replaying the login every time.
 */
router.post(
  '/api/recording-login-state',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const parseResult = loginStateSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json(invalidRequest(parseResult.error));

    const { sessionId, environmentId } = parseResult.data;
    // organizationId comes from the session: the environment written to has to be one
    // this caller's tenant owns, whatever id the body names.
    const saved = await playwrightService.captureLoginState(sessionId, {
      environmentId,
      organizationId: req.user!.organizationId,
    });
    if (!saved) {
      return res.status(404).json({
        success: false,
        error: 'That recording session is not open, so there was no browser session to save.',
      });
    }
    res.json({ success: true });
  }),
);

router.post(
  '/api/stop-recording',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const parseResult = sessionSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json(invalidRequest(parseResult.error));

    const result = await playwrightService.stopRecordingSession(
      parseResult.data.sessionId,
      req.user!.id,
    );
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error || 'Recording session not found',
      });
    }
    res.json({ success: true, sequence: result.sequence || [] });
  }),
);

router.get(
  '/api/get-recorded-actions',
  requireRole('editor'),
  asyncHandler(async (req, res) => {
    const parseResult = sessionSchema.safeParse(req.query);
    if (!parseResult.success) return res.status(400).json(invalidRequest(parseResult.error));

    const result = await playwrightService.getRecordedActions(
      parseResult.data.sessionId,
      req.user!.id,
    );
    // The field is `sequence` on every recording endpoint — start, stop and poll — so the
    // client has one shape to parse. It used to be `actions` only here, which is why the
    // live action list stayed empty for the whole recording.
    if (!result.success) {
      return res.status(404).json({
        success: false,
        sequence: [],
        sessionEnded: result.sessionEnded || false,
        error: result.error || 'Recording session not found',
      });
    }
    res.json({
      success: true,
      sequence: result.sequence || [],
      sessionEnded: result.sessionEnded || false,
      error: result.error,
    });
  }),
);

export default router;
