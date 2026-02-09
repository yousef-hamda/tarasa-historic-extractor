import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { URLS } from '../config/constants';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Messaging enabled/disabled state file
const MESSAGING_STATE_FILE = path.resolve(process.cwd(), 'messaging-state.json');

// Get messaging enabled state
const getMessagingEnabled = (): boolean => {
  try {
    if (fs.existsSync(MESSAGING_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(MESSAGING_STATE_FILE, 'utf-8'));
      return data.enabled !== false; // Default to true
    }
  } catch {
    // Default to enabled
  }
  return true;
};

// Set messaging enabled state
const setMessagingEnabled = (enabled: boolean): void => {
  fs.writeFileSync(MESSAGING_STATE_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }));
};

// Export for use in messenger
export { getMessagingEnabled };

const getGroups = (): string[] =>
  (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id): id is string => Boolean(id));

router.get('/api/settings', (_req: Request, res: Response) => {
  try {
    const groups = getGroups();
    const messageLimit = Number(process.env.MAX_MESSAGES_PER_DAY || 20);
    const baseTarasaUrl = process.env.BASE_TARASA_URL || URLS.DEFAULT_TARASA;
    const emailConfigured = Boolean(process.env.SYSTEM_EMAIL_ALERT && process.env.SYSTEM_EMAIL_PASSWORD);
    const apifyConfigured = Boolean(process.env.APIFY_TOKEN);
    const messagingEnabled = getMessagingEnabled();

    res.json({
      groups,
      messageLimit,
      baseTarasaUrl,
      emailConfigured,
      apifyConfigured,
      messagingEnabled,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get messaging status
router.get('/api/settings/messaging', (_req: Request, res: Response) => {
  try {
    res.json({
      enabled: getMessagingEnabled(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messaging status', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Toggle messaging status (requires auth)
router.post('/api/settings/messaging', apiKeyAuth, triggerRateLimiter, (req: Request, res: Response) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  try {
    setMessagingEnabled(enabled);

    res.json({
      success: true,
      enabled,
      message: enabled ? 'Messaging enabled' : 'Messaging paused - messages will be queued',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update messaging status', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
