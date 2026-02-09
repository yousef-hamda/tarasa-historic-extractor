/**
 * Advanced Search API
 *
 * Provides advanced search and export capabilities for posts
 */

import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { safeErrorMessage } from '../middleware/errorHandler';
import { parsePositiveInt, parseNonNegativeInt } from '../utils/validation';

const router = Router();

interface SearchFilters {
  query?: string;
  authorName?: string;
  groupId?: string;
  isHistoric?: boolean | null;
  minConfidence?: number;
  maxConfidence?: number;
  fromDate?: Date;
  toDate?: Date;
  hasAuthorLink?: boolean;
  minRating?: number;
}

/**
 * GET /api/search/posts
 * Advanced search for posts with multiple filters
 */
router.get('/api/search/posts', async (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 50, 500);
    const offset = parseNonNegativeInt(req.query.offset, 0);

    // Parse filters
    const filters: SearchFilters = {};

    if (req.query.query && typeof req.query.query === 'string') {
      filters.query = req.query.query.trim();
    }

    if (req.query.authorName && typeof req.query.authorName === 'string') {
      filters.authorName = req.query.authorName.trim();
    }

    if (req.query.groupId && typeof req.query.groupId === 'string') {
      filters.groupId = req.query.groupId;
    }

    if (req.query.isHistoric !== undefined) {
      if (req.query.isHistoric === 'true') filters.isHistoric = true;
      else if (req.query.isHistoric === 'false') filters.isHistoric = false;
      else if (req.query.isHistoric === 'null') filters.isHistoric = null;
    }

    if (req.query.minConfidence) {
      const val = parseInt(req.query.minConfidence as string, 10);
      if (!isNaN(val)) filters.minConfidence = val;
    }

    if (req.query.maxConfidence) {
      const val = parseInt(req.query.maxConfidence as string, 10);
      if (!isNaN(val)) filters.maxConfidence = val;
    }

    if (req.query.fromDate) {
      const date = new Date(req.query.fromDate as string);
      if (!isNaN(date.getTime())) filters.fromDate = date;
    }

    if (req.query.toDate) {
      const date = new Date(req.query.toDate as string);
      if (!isNaN(date.getTime())) filters.toDate = date;
    }

    if (req.query.hasAuthorLink === 'true') {
      filters.hasAuthorLink = true;
    } else if (req.query.hasAuthorLink === 'false') {
      filters.hasAuthorLink = false;
    }

    if (req.query.minRating) {
      const val = parseInt(req.query.minRating as string, 10);
      if (!isNaN(val)) filters.minRating = val;
    }

    // Build where clause
    const where: Record<string, unknown> = {};

    // Text search (query or authorName)
    if (filters.query) {
      where.OR = [
        { text: { contains: filters.query, mode: 'insensitive' } },
        { authorName: { contains: filters.query, mode: 'insensitive' } },
      ];
    } else if (filters.authorName) {
      where.authorName = { contains: filters.authorName, mode: 'insensitive' };
    }

    // Group filter
    if (filters.groupId) {
      where.groupId = filters.groupId;
    }

    // Date range
    if (filters.fromDate || filters.toDate) {
      where.scrapedAt = {};
      if (filters.fromDate) {
        (where.scrapedAt as Record<string, Date>).gte = filters.fromDate;
      }
      if (filters.toDate) {
        (where.scrapedAt as Record<string, Date>).lte = filters.toDate;
      }
    }

    // Author link filter
    if (filters.hasAuthorLink === true) {
      where.authorLink = { not: null };
    } else if (filters.hasAuthorLink === false) {
      where.authorLink = null;
    }

    // Classification filter
    if (filters.isHistoric !== undefined) {
      if (filters.isHistoric === null) {
        where.classified = null;
      } else {
        where.classified = {
          isHistoric: filters.isHistoric,
          ...(filters.minConfidence !== undefined && { confidence: { gte: filters.minConfidence } }),
          ...(filters.maxConfidence !== undefined && { confidence: { lte: filters.maxConfidence } }),
        };
      }
    } else if (filters.minConfidence !== undefined || filters.maxConfidence !== undefined) {
      where.classified = {
        ...(filters.minConfidence !== undefined && { confidence: { gte: filters.minConfidence } }),
        ...(filters.maxConfidence !== undefined && { confidence: { lte: filters.maxConfidence } }),
      };
    }

    // Quality rating filter
    if (filters.minRating !== undefined) {
      where.quality = {
        rating: { gte: filters.minRating },
      };
    }

    // Execute query
    const [posts, total] = await Promise.all([
      prisma.postRaw.findMany({
        where,
        include: {
          classified: true,
          quality: true,
        },
        orderBy: { scrapedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.postRaw.count({ where }),
    ]);

    res.json({
      data: posts,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + posts.length < total,
      },
      filters: filters,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Search API] Error: ${message}`);
    res.status(500).json({
      error: 'Search failed',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * GET /api/search/export
 * Export search results to CSV format
 */
router.get('/api/search/export', async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';

    // Parse filters (same as search)
    const where: Record<string, unknown> = {};

    if (req.query.query && typeof req.query.query === 'string') {
      const query = req.query.query.trim();
      where.OR = [
        { text: { contains: query, mode: 'insensitive' } },
        { authorName: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (req.query.groupId && typeof req.query.groupId === 'string') {
      where.groupId = req.query.groupId;
    }

    if (req.query.isHistoric !== undefined) {
      if (req.query.isHistoric === 'true') {
        where.classified = { isHistoric: true };
      } else if (req.query.isHistoric === 'false') {
        where.classified = { isHistoric: false };
      } else if (req.query.isHistoric === 'null') {
        where.classified = null;
      }
    }

    if (req.query.fromDate) {
      const date = new Date(req.query.fromDate as string);
      if (!isNaN(date.getTime())) {
        where.scrapedAt = { ...((where.scrapedAt as object) || {}), gte: date };
      }
    }

    if (req.query.toDate) {
      const date = new Date(req.query.toDate as string);
      if (!isNaN(date.getTime())) {
        where.scrapedAt = { ...((where.scrapedAt as object) || {}), lte: date };
      }
    }

    // Fetch all matching posts (limited to 10000 for safety)
    const posts = await prisma.postRaw.findMany({
      where,
      include: {
        classified: true,
        quality: true,
      },
      orderBy: { scrapedAt: 'desc' },
      take: 10000,
    });

    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'ID',
        'Group ID',
        'Author Name',
        'Text',
        'Post URL',
        'Scraped At',
        'Is Historic',
        'Confidence',
        'Classification Reason',
        'Quality Rating',
      ];

      const escapeCSV = (value: string | null | undefined): string => {
        if (value === null || value === undefined) return '';
        let str = String(value);
        // Prevent CSV formula injection
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes("'")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const rows = posts.map((post) => [
        post.id,
        escapeCSV(post.groupId),
        escapeCSV(post.authorName),
        escapeCSV(post.text.substring(0, 500)), // Truncate text for CSV
        escapeCSV(post.postUrl),
        post.scrapedAt.toISOString(),
        post.classified?.isHistoric ?? '',
        post.classified?.confidence ?? '',
        escapeCSV(post.classified?.reason),
        post.quality?.rating ?? '',
      ]);

      const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=posts-export-${Date.now()}.csv`);
      res.send(csv);
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=posts-export-${Date.now()}.json`);
      res.json(posts);
    } else {
      res.status(400).json({ error: 'Invalid format. Use "csv" or "json".' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Search API] Export error: ${message}`);
    res.status(500).json({
      error: 'Export failed',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * GET /api/search/groups
 * Get list of groups for filter dropdown
 */
router.get('/api/search/groups', async (_req: Request, res: Response) => {
  try {
    const groups = await prisma.postRaw.groupBy({
      by: ['groupId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // Get group info if available
    const groupIds = groups.map((g) => g.groupId);
    const groupInfo = await prisma.groupInfo.findMany({
      where: { groupId: { in: groupIds } },
      select: { groupId: true, groupName: true },
    });

    const groupInfoMap = new Map(groupInfo.map((g) => [g.groupId, g.groupName]));

    res.json(
      groups.map((g) => ({
        groupId: g.groupId,
        groupName: groupInfoMap.get(g.groupId) || g.groupId,
        postCount: g._count.id,
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Search API] Groups error: ${message}`);
    res.status(500).json({
      error: 'Failed to fetch groups',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

export default router;
