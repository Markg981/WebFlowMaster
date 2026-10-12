import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { sharedStore } from '../../platform/middleware/rate-limit-store';
import { asyncRouter } from '../../platform/middleware/async-router';
import { requireRole } from '../middleware/require-role';
import { APP_ROOT } from '../../platform/app-root';
import { changelogStamp, parseChangelog, type ChangelogRelease } from '../../platform/changelog';
import logger from '../../platform/logger';

/**
 * GET /api/whats-new — the "What's new" page: CHANGELOG.md as this installation ships it, so what a
 * member reads is what the server they use contains, not what the repository has since.
 *
 * Read once, when the server starts: the file ships with the build and does not change under a
 * running server, and a request then never touches the disk.
 */

const router = asyncRouter();

/** Enough history to see what came in the last releases, without sending years of it. */
const MAX_RELEASES = 5;

function loadReleases(): ChangelogRelease[] {
  try {
    const markdown = fs.readFileSync(path.join(APP_ROOT, 'CHANGELOG.md'), 'utf8');
    return parseChangelog(markdown).slice(0, MAX_RELEASES);
  } catch (error) {
    // An image built without the file still serves the product: the page just has nothing to say.
    logger.warn({ message: 'CHANGELOG.md could not be read for the What’s new page', error });
    return [];
  }
}

const releases = loadReleases();
const stamp = changelogStamp(releases);

/**
 * The page asks once an hour at most (the client keeps the answer); 60 a minute for each member is
 * far above that and below the global session limit, which counts every other request too.
 */
const whatsNewLimiter = rateLimit({
  windowMs: 60_000,
  limit: process.env.NODE_ENV === 'test' ? 100_000 : 60,
  store: sharedStore('whats-new'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${(req.user as { id?: number } | undefined)?.id ?? 'anonymous'}`,
  message: { error: 'Too many requests, slow down.' },
});

router.get('/api/whats-new', whatsNewLimiter, requireRole('viewer'), (_req, res) => {
  res.json({ stamp, releases });
});

export default router;
