/**
 * One-time / idempotent cleanup of duplicate PostRaw rows.
 *
 * Historical duplicates exist because the fallback fbPostId was a content hash
 * computed from the RAW author link (which carries volatile FB tracking params)
 * and un-normalized text — so the same post was re-inserted every scrape cycle
 * under a fresh `hash_…` id. The hashing is now fixed (see generateContentHash),
 * but the rows already written need collapsing.
 *
 * Strategy (only touches `hash_` fallback rows; real numeric/pfbid ids are
 * left untouched):
 *   1. Recompute the NEW stable id for every hash_ row from its stored text +
 *      (already-normalized) author link.
 *   2. Group rows that share the same (groupId, stableId).
 *   3. In each group keep ONE canonical row, preferring — in order — a row that
 *      already carries the stable id, then one that has outreach (MessageSent),
 *      then one that's been classified, then the oldest. This preserves
 *      downstream work; losers are deleted (their classified/message/rating
 *      rows cascade away per the schema's onDelete: Cascade).
 *   4. Rename the canonical to the stable id so the NEXT scrape upserts onto it
 *      instead of inserting yet another row. Cross-group id collisions (the same
 *      author posting identical text to two monitored groups) are rare and the
 *      rename is best-effort (skipped on unique conflict).
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { generateContentHash } from './extractors';

export interface DedupResult {
  scannedHashRows: number;
  duplicateGroups: number;
  rowsDeleted: number;
  canonicalsRenamed: number;
  renameConflicts: number;
  dryRun: boolean;
}

interface HashRow {
  id: number;
  groupId: string;
  fbPostId: string;
  text: string | null;
  authorLink: string | null;
}

const stableIdFor = (row: HashRow): string =>
  `hash_${generateContentHash(row.text || '', row.authorLink || undefined)}`;

export const dedupExistingPosts = async (
  opts: { dryRun?: boolean } = {}
): Promise<DedupResult> => {
  const dryRun = opts.dryRun !== false; // default to dry-run for safety

  const rows = (await prisma.postRaw.findMany({
    where: { fbPostId: { startsWith: 'hash_' } },
    select: { id: true, groupId: true, fbPostId: true, text: true, authorLink: true },
    orderBy: { id: 'asc' },
  })) as HashRow[];

  // Group by (groupId, stable id).
  const groups = new Map<string, { stable: string; members: HashRow[] }>();
  for (const r of rows) {
    const stable = stableIdFor(r);
    const key = `${r.groupId}::${stable}`;
    const g = groups.get(key);
    if (g) g.members.push(r);
    else groups.set(key, { stable, members: [r] });
  }

  // Which rows have downstream data (used to pick the canonical to keep).
  const allIds = rows.map((r) => r.id);
  const messaged = new Set<number>();
  const classified = new Set<number>();
  if (allIds.length > 0) {
    const [ms, cl] = await Promise.all([
      prisma.messageSent.findMany({ where: { postId: { in: allIds } }, select: { postId: true } }),
      prisma.postClassified.findMany({ where: { postId: { in: allIds } }, select: { postId: true } }),
    ]);
    ms.forEach((m) => messaged.add(m.postId));
    cl.forEach((c) => classified.add(c.postId));
  }

  const pickCanonical = (stable: string, members: HashRow[]): HashRow => {
    return (
      members.find((m) => m.fbPostId === stable) ||
      members.find((m) => messaged.has(m.id)) ||
      members.find((m) => classified.has(m.id)) ||
      members.reduce((a, b) => (a.id <= b.id ? a : b))
    );
  };

  let duplicateGroups = 0;
  let rowsDeleted = 0;
  let canonicalsRenamed = 0;
  let renameConflicts = 0;

  for (const { stable, members } of groups.values()) {
    if (members.length > 1) duplicateGroups++;
    const canonical = pickCanonical(stable, members);
    const losers = members.filter((m) => m.id !== canonical.id);

    if (dryRun) {
      rowsDeleted += losers.length;
      if (canonical.fbPostId !== stable) canonicalsRenamed++;
      continue;
    }

    try {
      // Delete losers first so a loser already holding `stable` can't block the
      // canonical rename via the unique constraint.
      if (losers.length > 0) {
        const del = await prisma.postRaw.deleteMany({ where: { id: { in: losers.map((l) => l.id) } } });
        rowsDeleted += del.count;
      }
      if (canonical.fbPostId !== stable) {
        try {
          await prisma.postRaw.update({ where: { id: canonical.id }, data: { fbPostId: stable } });
          canonicalsRenamed++;
        } catch (renameErr) {
          // Cross-group id collision (rare). Leave the canonical's id as-is.
          renameConflicts++;
          logger.warn(`[Dedup] Skipped rename of post ${canonical.id} -> ${stable}: ${(renameErr as Error).message}`);
        }
      }
    } catch (groupErr) {
      logger.error(`[Dedup] Failed to process group ${stable}: ${(groupErr as Error).message}`);
    }
  }

  const result: DedupResult = {
    scannedHashRows: rows.length,
    duplicateGroups,
    rowsDeleted,
    canonicalsRenamed,
    renameConflicts,
    dryRun,
  };
  logger.info(`[Dedup] ${dryRun ? '(dry-run) ' : ''}${JSON.stringify(result)}`);
  return result;
};
