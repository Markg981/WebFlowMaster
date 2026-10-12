import fs from 'fs-extra';
import path from 'path';
import { asyncRouter } from '../../platform/middleware/async-router';
import { requireRole } from '../middleware/require-role';
import { APP_ROOT } from '../../platform/app-root';
import { changelogStamp, parseChangelog, type ChangelogRelease } from '../../platform/changelog';
import logger from '../../platform/logger';

/**
 * GET /api/whats-new — the "What's new" page: CHANGELOG.md as this installation ships it, so what a
 * member reads is what the server they use contains, not what the repository has since.
 *
 * Read once in production, where the file cannot change under a running server; elsewhere on every
 * request, so editing the changelog shows at once.
 */

const router = asyncRouter();

/** Enough history to see what came in the last releases, without sending years of it. */
const MAX_RELEASES = 5;

let cached: ChangelogRelease[] | null = null;

async function releases(): Promise<ChangelogRelease[]> {
  if (cached) return cached;
  const markdown = await fs.readFile(path.join(APP_ROOT, 'CHANGELOG.md'), 'utf8');
  const parsed = parseChangelog(markdown).slice(0, MAX_RELEASES);
  if (process.env.NODE_ENV === 'production') cached = parsed;
  return parsed;
}

router.get('/api/whats-new', requireRole('viewer'), async (_req, res) => {
  try {
    const list = await releases();
    res.json({ stamp: changelogStamp(list), releases: list });
  } catch (error) {
    // An image built without the file still serves the product: the page just has nothing to say.
    logger.warn({ message: 'CHANGELOG.md could not be read for the What’s new page', error });
    res.json({ stamp: null, releases: [] });
  }
});

export default router;
