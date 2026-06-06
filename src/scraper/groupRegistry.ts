/**
 * Group Registry
 *
 * Single source of truth for "which Facebook groups should we scrape."
 *
 * Group identity now lives in the GroupInfo table, not the GROUP_IDS env var.
 * The env var is consulted exactly once, at first boot, to seed an empty DB.
 * After that, the dashboard's add/remove endpoints mutate GroupInfo directly.
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';

/**
 * Return the list of group IDs the scraper should currently process.
 * Reads from GroupInfo.isEnabled=true, ordered for deterministic runs.
 */
export const getActiveGroupIds = async (): Promise<string[]> => {
  const rows = await prisma.groupInfo.findMany({
    where: { isEnabled: true },
    select: { groupId: true },
    orderBy: { groupId: 'asc' },
  });
  return rows.map((r: { groupId: string }) => r.groupId);
};

/**
 * Re-arm all enabled groups after the Facebook session has been restored.
 *
 * While the session was down, repeated scrape failures bump `consecutiveErrors`
 * and eventually flip `isAccessible` to false (see `markGroupError`). On its own
 * the system recovers only on the NEXT successful scrape — so the Groups page
 * keeps showing "Inaccessible" for up to a full scrape interval after the
 * operator renews. Calling this the moment a session goes valid clears the
 * failure streak immediately, so the UI (which auto-refreshes every 15s) flips
 * back to accessible right away and the next scrape treats every group as live.
 *
 * Deliberately leaves `accessMethod` untouched (a group we previously reached
 * via Playwright should keep that hint) and only resets the failure bookkeeping.
 * Returns the number of group rows updated.
 */
export const reactivateAllGroups = async (): Promise<number> => {
  try {
    const result = await prisma.groupInfo.updateMany({
      where: { isEnabled: true },
      data: { isAccessible: true, consecutiveErrors: 0, errorMessage: null },
    });
    if (result.count > 0) {
      logger.info(`[GroupRegistry] Reactivated ${result.count} group(s) after session restore`);
    }
    return result.count;
  } catch (error) {
    logger.warn(`[GroupRegistry] reactivateAllGroups failed: ${(error as Error).message}`);
    return 0;
  }
};

/**
 * One-time seed of GroupInfo from the GROUP_IDS env var.
 *
 * Idempotent + concurrency-safe:
 * - Runs inside a transaction that re-checks the row count, so two boots
 *   racing each other won't double-insert.
 * - Uses upsert per group, so partial state (some groups already present)
 *   is handled cleanly without clobbering existing cached metadata.
 *
 * Behavior:
 * - If GroupInfo is non-empty → no-op. The DB is the source of truth.
 * - If GroupInfo is empty and GROUP_IDS is empty/missing → no-op + log.
 * - If GroupInfo is empty and GROUP_IDS has values → insert one row per
 *   group with isEnabled=true and the usual defaults.
 */
export const seedGroupsFromEnv = async (): Promise<{ seeded: number; skipped: boolean }> => {
  const envIds = (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.groupInfo.count();
    if (existing > 0) {
      logger.info(`[GroupRegistry] Seed skipped: GroupInfo already has ${existing} rows`);
      return { seeded: 0, skipped: true };
    }

    if (envIds.length === 0) {
      logger.warn('[GroupRegistry] Seed skipped: GroupInfo empty and GROUP_IDS env var is empty');
      return { seeded: 0, skipped: true };
    }

    for (const groupId of envIds) {
      await tx.groupInfo.upsert({
        where: { groupId },
        update: { isEnabled: true },
        create: {
          groupId,
          isEnabled: true,
        },
      });
    }

    logger.info(`[GroupRegistry] Seeded ${envIds.length} groups from GROUP_IDS env`);
    return { seeded: envIds.length, skipped: false };
  });
};
