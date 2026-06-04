import { Request, Response, Router } from 'express';
import { URLS } from '../config/constants';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { getActiveGroupIds } from '../scraper/groupRegistry';
import {
  getMessagingEnabledAsync,
  setMessagingEnabled as setMessagingEnabledInDb,
  getHistoricThreshold,
  setHistoricThreshold,
  HISTORIC_THRESHOLD_MIN,
  HISTORIC_THRESHOLD_MAX,
  HISTORIC_THRESHOLD_DEFAULT,
  getSpeedPreset,
  setSpeedPreset,
  isSpeedPreset,
  SPEED_PRESETS,
  SpeedPreset,
} from '../utils/settings';
import { applySpeedPreset } from '../cron/scheduler';
import logger from '../utils/logger';

const router = Router();

// Back-compat shim. messenger.ts and the test suite imported the sync
// `getMessagingEnabled` from this module. The flag now lives in the DB, so
// callers should prefer `getMessagingEnabledAsync()`. Re-exported here so
// existing imports don't break compile while we migrate.
export { getMessagingEnabledAsync as getMessagingEnabled };

router.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const [groups, messagingEnabled, historicThreshold, speedPreset] = await Promise.all([
      getActiveGroupIds(),
      getMessagingEnabledAsync(),
      getHistoricThreshold(),
      getSpeedPreset(),
    ]);
    const messageLimit = Number(process.env.MAX_MESSAGES_PER_DAY || 20);
    const baseTarasaUrl = process.env.BASE_TARASA_URL || URLS.DEFAULT_TARASA;
    const emailConfigured = Boolean(process.env.SYSTEM_EMAIL_ALERT && process.env.SYSTEM_EMAIL_PASSWORD);
    const apifyConfigured = Boolean(process.env.APIFY_TOKEN);

    res.json({
      groups,
      messageLimit,
      baseTarasaUrl,
      emailConfigured,
      apifyConfigured,
      messagingEnabled,
      historicThreshold: {
        value: historicThreshold,
        min: HISTORIC_THRESHOLD_MIN,
        max: HISTORIC_THRESHOLD_MAX,
        default: HISTORIC_THRESHOLD_DEFAULT,
      },
      speed: {
        preset: speedPreset,
        presets: SPEED_PRESETS,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get messaging status
router.get('/api/settings/messaging', async (_req: Request, res: Response) => {
  try {
    res.json({
      enabled: await getMessagingEnabledAsync(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messaging status', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Toggle messaging status (requires auth)
router.post('/api/settings/messaging', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  try {
    await setMessagingEnabledInDb(enabled);
    res.json({
      success: true,
      enabled,
      message: enabled ? 'Messaging enabled' : 'Messaging paused - messages will be queued',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update messaging status', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update the historic-confidence threshold (requires auth).
// Body: { value: number }. Clamped server-side to [50, 100].
router.post('/api/settings/threshold', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  const { value } = req.body || {};
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return res.status(400).json({ error: 'value must be a finite number' });
  }
  try {
    const stored = await setHistoricThreshold(value);
    res.json({
      success: true,
      historicThreshold: {
        value: stored,
        min: HISTORIC_THRESHOLD_MIN,
        max: HISTORIC_THRESHOLD_MAX,
        default: HISTORIC_THRESHOLD_DEFAULT,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update threshold', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Change the system-speed preset (requires auth). Persists to DB and applies
// the new cron schedules immediately via the scheduler registry.
router.post('/api/settings/speed', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  const { preset } = req.body || {};
  if (!isSpeedPreset(preset)) {
    return res.status(400).json({
      error: 'preset must be one of conservative | normal | fast | aggressive',
    });
  }
  try {
    await setSpeedPreset(preset as SpeedPreset);
    await applySpeedPreset(preset as SpeedPreset);
    logger.info(`[settings] System speed preset changed to ${preset}`);
    res.json({
      success: true,
      speed: {
        preset,
        presets: SPEED_PRESETS,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update speed preset', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
