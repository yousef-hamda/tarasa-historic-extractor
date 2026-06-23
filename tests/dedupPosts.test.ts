/**
 * Tests for the duplicate-post cleanup (dedupExistingPosts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    postRaw: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    messageSent: { findMany: vi.fn() },
    postClassified: { findMany: vi.fn() },
  },
}));

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/database/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

import { dedupExistingPosts } from '../src/scraper/dedupPosts';
import { generateContentHash } from '../src/scraper/extractors';

const LINK = 'https://www.facebook.com/profile.php?id=1025935738';
const stable = (text: string, link = LINK) => `hash_${generateContentHash(text, link)}`;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.messageSent.findMany.mockResolvedValue([]);
  prismaMock.postClassified.findMany.mockResolvedValue([]);
  prismaMock.deleteMany?.mockReset?.();
  prismaMock.postRaw.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.postRaw.update.mockResolvedValue({});
});

describe('dedupExistingPosts', () => {
  it('dry run reports duplicates without deleting', async () => {
    // Three rows that are the SAME post (same text+author) but different
    // drifting hash ids, plus one distinct post.
    prismaMock.postRaw.findMany.mockResolvedValue([
      { id: 1, groupId: 'g1', fbPostId: 'hash_aaa', text: 'BODY', authorLink: LINK + '&__cft__[0]=x' },
      { id: 2, groupId: 'g1', fbPostId: 'hash_bbb', text: 'BODY', authorLink: LINK + '&__cft__[0]=y' },
      { id: 3, groupId: 'g1', fbPostId: 'hash_ccc', text: 'BODY', authorLink: LINK },
      { id: 4, groupId: 'g1', fbPostId: 'hash_ddd', text: 'OTHER', authorLink: LINK },
    ]);

    const r = await dedupExistingPosts({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.scannedHashRows).toBe(4);
    expect(r.duplicateGroups).toBe(1); // the BODY group
    expect(r.rowsDeleted).toBe(2); // 3 BODY rows -> keep 1, delete 2
    expect(prismaMock.postRaw.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.postRaw.update).not.toHaveBeenCalled();
  });

  it('applies cleanup: deletes losers and renames canonical to the stable id', async () => {
    prismaMock.postRaw.findMany.mockResolvedValue([
      { id: 1, groupId: 'g1', fbPostId: 'hash_aaa', text: 'BODY', authorLink: LINK + '&__cft__[0]=x' },
      { id: 2, groupId: 'g1', fbPostId: 'hash_bbb', text: 'BODY', authorLink: LINK + '&__cft__[0]=y' },
    ]);
    prismaMock.postRaw.deleteMany.mockResolvedValue({ count: 1 });

    const r = await dedupExistingPosts({ dryRun: false });
    expect(r.rowsDeleted).toBe(1);
    expect(r.canonicalsRenamed).toBe(1);
    // canonical is the oldest (id 1); loser (id 2) deleted
    expect(prismaMock.postRaw.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
    expect(prismaMock.postRaw.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { fbPostId: stable('BODY') },
    });
  });

  it('keeps the messaged row as canonical even if it is not the oldest', async () => {
    prismaMock.postRaw.findMany.mockResolvedValue([
      { id: 1, groupId: 'g1', fbPostId: 'hash_aaa', text: 'BODY', authorLink: LINK },
      { id: 2, groupId: 'g1', fbPostId: 'hash_bbb', text: 'BODY', authorLink: LINK },
    ]);
    prismaMock.messageSent.findMany.mockResolvedValue([{ postId: 2 }]); // id 2 was messaged
    prismaMock.postRaw.deleteMany.mockResolvedValue({ count: 1 });

    await dedupExistingPosts({ dryRun: false });
    // id 1 (oldest, not messaged) should be deleted; id 2 kept + renamed
    expect(prismaMock.postRaw.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
    expect(prismaMock.postRaw.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { fbPostId: stable('BODY') },
    });
  });

  it('does not rename when canonical already holds the stable id', async () => {
    prismaMock.postRaw.findMany.mockResolvedValue([
      { id: 1, groupId: 'g1', fbPostId: stable('BODY'), text: 'BODY', authorLink: LINK },
      { id: 2, groupId: 'g1', fbPostId: 'hash_bbb', text: 'BODY', authorLink: LINK },
    ]);
    prismaMock.postRaw.deleteMany.mockResolvedValue({ count: 1 });

    const r = await dedupExistingPosts({ dryRun: false });
    expect(r.canonicalsRenamed).toBe(0);
    expect(prismaMock.postRaw.update).not.toHaveBeenCalled();
    expect(prismaMock.postRaw.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
  });

  it('counts rename conflicts without throwing (cross-group collision)', async () => {
    prismaMock.postRaw.findMany.mockResolvedValue([
      { id: 1, groupId: 'g1', fbPostId: 'hash_aaa', text: 'BODY', authorLink: LINK },
    ]);
    prismaMock.postRaw.update.mockRejectedValue(new Error('Unique constraint failed'));

    const r = await dedupExistingPosts({ dryRun: false });
    expect(r.renameConflicts).toBe(1);
    expect(r.canonicalsRenamed).toBe(0);
  });

  it('handles an empty table', async () => {
    prismaMock.postRaw.findMany.mockResolvedValue([]);
    const r = await dedupExistingPosts({ dryRun: false });
    expect(r.scannedHashRows).toBe(0);
    expect(r.rowsDeleted).toBe(0);
  });
});
