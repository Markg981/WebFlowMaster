import { asyncRouter } from '../middleware/async-router';
import { AUDIT_ACTIONS, insertSystemSettingSchema } from '@shared/schema';
import { auditActor, recordAudit } from '../tenancy/audit';
import { requireInstallationAdmin } from '../tenancy/installation-admin';
import logger, { updateLogLevel } from '../logger';
import { asyncHandler } from '../middleware/async-handler';
import { requireRole, roleAllows } from '../middleware/require-role';
import { withTenantTransaction } from '../middleware/tenancy';
import { getSystemSetting, listSystemSettings, upsertSystemSetting } from '../system-settings';
import {
  getOrCreateUserSettings,
  saveUserSettings,
  userSettingsBodySchema,
} from '../user-settings';

/**
 * The two kinds of settings: a person's own (/api/settings) and the installation's
 * (/api/system-settings). Neither belongs to an organization, so both are read and written
 * by server/user-settings.ts and server/system-settings.ts, which hold the privileged handle
 * this module may not.
 */

const router = asyncRouter();

router.get(
  '/api/settings',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    res.json(await getOrCreateUserSettings(req.user!.id));
  }),
);

router.post(
  '/api/settings',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    const parseResult = userSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
    }
    res.json(await saveUserSettings(req.user!.id, parseResult.data));
  }),
);

// Owners only, like changing them: nothing in the client lists them, and the keys everyone
// needs (workspaceName, clientLogLevel) are read one at a time below.
router.get(
  '/api/system-settings',
  requireRole('owner'),
  asyncHandler(async (_req, res) => {
    res.json(await listSystemSettings());
  }),
);

// The keys any signed-in user may read: the sidebar shows workspaceName and every browser
// reads clientLogLevel. Anything else is owners only, like the list, so a key added to this
// global table later is not readable by every user of every organization by default. The
// refusal is a 404, as for a missing key, so a non-owner cannot probe which keys exist.
const PUBLIC_SYSTEM_SETTINGS = new Set(['workspaceName', 'clientLogLevel']);

router.get(
  '/api/system-settings/:key',
  requireRole('viewer'),
  asyncHandler(async (req, res) => {
    if (!PUBLIC_SYSTEM_SETTINGS.has(req.params.key) && !roleAllows(req.user!.role, 'owner')) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    const setting = await getSystemSetting(req.params.key);
    if (!setting) return res.status(404).json({ error: 'Setting not found' });
    res.json(setting);
  }),
);

// system_settings is deliberately global (logRetentionDays, logLevel, clientLogLevel), so
// this is gated to owners rather than any authenticated user of any organization: a viewer
// or editor should not be able to reconfigure logging for every tenant.
router.post(
  '/api/system-settings',
  requireRole('owner'),
  requireInstallationAdmin,
  asyncHandler(async (req, res) => {
    const parseResult = insertSystemSettingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
    }
    const { key, value } = parseResult.data;
    const saved = await upsertSystemSetting(key, value ?? null);

    // In the owner's organization, since that is where an owner looks. Not in the same
    // transaction as the change: system_settings is installation-wide and has no tenant, so
    // the upsert above cannot run under one. The key and not the value, which may be anything.
    await withTenantTransaction((tx) =>
      recordAudit(tx, {
        action: AUDIT_ACTIONS.SYSTEM_SETTINGS_CHANGED,
        actor: auditActor(req),
        targetType: 'system_settings',
        targetId: key,
        metadata: { key },
      }),
    );

    res.status(200).json(saved);

    if (saved.key === 'logLevel' && saved.value) {
      try {
        updateLogLevel(saved.value);
        logger.info({
          message: `Log level dynamically updated to: ${saved.value} via API`,
          userId: req.user!.id,
        });
      } catch (error) {
        // The setting is saved; the logger picks the level up on the next restart.
        logger.error({
          message: `Failed to dynamically update log level to ${saved.value} after saving setting`,
          error: (error as Error).message,
          userId: req.user!.id,
        });
      }
    }
  }),
);

export default router;
