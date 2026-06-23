import { Request, Response, Router } from 'express';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { safeErrorMessage } from '../middleware/errorHandler';
import { dedupExistingPosts } from '../scraper/dedupPosts';

const router = Router();

/**
 * POST /api/admin/dedup-posts
 *
 * Collapses historical duplicate PostRaw rows (same post re-inserted under
 * drifting content-hash ids). Defaults to a DRY RUN — pass {confirm: true} (or
 * ?confirm=true) to actually delete. Gated by the API key.
 */
router.post('/api/admin/dedup-posts', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const confirm = req.body?.confirm === true || req.query?.confirm === 'true';
    const dryRun = !confirm;

    logger.info(`[Admin] dedup-posts requested (dryRun=${dryRun})`);
    const result = await dedupExistingPosts({ dryRun });

    if (!dryRun) {
      await logSystemEvent(
        'admin',
        `Dedup-posts cleanup: deleted ${result.rowsDeleted} duplicate rows across ${result.duplicateGroups} groups, renamed ${result.canonicalsRenamed} canonicals`
      );
    }

    return res.json({
      success: true,
      dryRun,
      message: dryRun
        ? 'Dry run only — no rows changed. Re-run with {"confirm": true} to apply.'
        : 'Duplicate cleanup applied.',
      result,
    });
  } catch (error) {
    logger.error(`[Admin] dedup-posts failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: safeErrorMessage(error) });
  }
});

export default router;
