/**
 * A/B Testing API
 *
 * Manages message variants for A/B testing
 */

import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { safeErrorMessage } from '../middleware/errorHandler';
import { apiKeyAuth } from '../middleware/apiAuth';
import { logSystemEvent } from '../utils/systemLog';

const router = Router();

/**
 * GET /api/ab-testing/variants
 * Get all message variants with metrics
 */
router.get('/api/ab-testing/variants', async (_req: Request, res: Response) => {
  try {
    const variants = await prisma.messageVariant.findMany({
      include: { metrics: true },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate rates for each variant
    const variantsWithRates = variants.map((v: any) => {
      const metrics = v.metrics;
      const responseRate = metrics && metrics.totalSent > 0
        ? ((metrics.responses / metrics.totalSent) * 100).toFixed(1)
        : null;
      const clickRate = metrics && metrics.totalSent > 0
        ? ((metrics.clicks / metrics.totalSent) * 100).toFixed(1)
        : null;

      return {
        ...v,
        responseRate,
        clickRate,
      };
    });

    res.json({
      variants: variantsWithRates,
      total: variants.length,
      activeCount: variants.filter((v: any) => v.isActive).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[A/B Testing] Error fetching variants: ${message}`);
    res.status(500).json({
      error: 'Failed to fetch variants',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * POST /api/ab-testing/variants
 * Create a new message variant
 */
router.post('/api/ab-testing/variants', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { name, promptTemplate, weight } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Variant name must be at least 2 characters' });
    }

    if (!promptTemplate || typeof promptTemplate !== 'string' || promptTemplate.trim().length < 50) {
      return res.status(400).json({ error: 'Prompt template must be at least 50 characters' });
    }

    const parsedWeight = parseInt(weight, 10) || 50;
    if (parsedWeight < 0 || parsedWeight > 100) {
      return res.status(400).json({ error: 'Weight must be between 0 and 100' });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        name: name.trim(),
        promptTemplate: promptTemplate.trim(),
        weight: parsedWeight,
        isActive: true,
        metrics: {
          create: {
            totalSent: 0,
            responses: 0,
            clicks: 0,
          },
        },
      },
      include: { metrics: true },
    });

    await logSystemEvent('admin', `Created A/B test variant: ${name}`);

    res.json({
      success: true,
      variant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[A/B Testing] Error creating variant: ${message}`);
    res.status(500).json({
      error: 'Failed to create variant',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * PATCH /api/ab-testing/variants/:id
 * Update a variant
 */
router.patch('/api/ab-testing/variants/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid variant ID' });
    }

    const { name, promptTemplate, weight, isActive } = req.body;
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'Variant name must be at least 2 characters' });
      }
      updateData.name = name.trim();
    }

    if (promptTemplate !== undefined) {
      if (typeof promptTemplate !== 'string' || promptTemplate.trim().length < 50) {
        return res.status(400).json({ error: 'Prompt template must be at least 50 characters' });
      }
      updateData.promptTemplate = promptTemplate.trim();
    }

    if (weight !== undefined) {
      const parsedWeight = parseInt(weight, 10);
      if (parsedWeight < 0 || parsedWeight > 100) {
        return res.status(400).json({ error: 'Weight must be between 0 and 100' });
      }
      updateData.weight = parsedWeight;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const existing = await prisma.messageVariant.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    const variant = await prisma.messageVariant.update({
      where: { id },
      data: updateData,
      include: { metrics: true },
    });

    await logSystemEvent('admin', `Updated A/B test variant: ${variant.name}`);

    res.json({
      success: true,
      variant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[A/B Testing] Error updating variant: ${message}`);
    res.status(500).json({
      error: 'Failed to update variant',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * DELETE /api/ab-testing/variants/:id
 * Delete a variant
 */
router.delete('/api/ab-testing/variants/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid variant ID' });
    }

    const variant = await prisma.messageVariant.findUnique({ where: { id } });
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    await prisma.messageVariant.delete({ where: { id } });

    await logSystemEvent('admin', `Deleted A/B test variant: ${variant.name}`);

    res.json({
      success: true,
      message: 'Variant deleted',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[A/B Testing] Error deleting variant: ${message}`);
    res.status(500).json({
      error: 'Failed to delete variant',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * POST /api/ab-testing/variants/:id/record
 * Record a metric event (sent, response, click)
 */
router.post('/api/ab-testing/variants/:id/record', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { event } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid variant ID' });
    }

    if (!event || !['sent', 'response', 'click'].includes(event)) {
      return res.status(400).json({ error: 'Invalid event type. Use: sent, response, click' });
    }

    const updateData: Record<string, { increment: number }> = {};

    switch (event) {
      case 'sent':
        updateData.totalSent = { increment: 1 };
        break;
      case 'response':
        updateData.responses = { increment: 1 };
        break;
      case 'click':
        updateData.clicks = { increment: 1 };
        break;
    }

    // Verify variant exists
    const variant = await prisma.messageVariant.findUnique({ where: { id } });
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    await prisma.variantMetrics.upsert({
      where: { variantId: id },
      update: updateData,
      create: { variantId: id, totalSent: 0, responses: 0, clicks: 0, ...Object.fromEntries(Object.entries(updateData).map(([k, v]) => [k, v.increment])) },
    });

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[A/B Testing] Error recording metric: ${message}`);
    res.status(500).json({
      error: 'Failed to record metric',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * Select a variant for sending a message (weighted random selection)
 */
export const selectVariant = async (): Promise<{
  id: number;
  name: string;
  promptTemplate: string;
} | null> => {
  const variants = await prisma.messageVariant.findMany({
    where: { isActive: true },
    select: { id: true, name: true, promptTemplate: true, weight: true },
  });

  if (variants.length === 0) return null;

  // Weighted random selection
  const totalWeight = variants.reduce((sum: number, v: any) => sum + v.weight, 0);
  if (totalWeight === 0) return variants[0];

  let random = Math.random() * totalWeight;

  for (const variant of variants) {
    random -= variant.weight;
    if (random <= 0) {
      return {
        id: variant.id,
        name: variant.name,
        promptTemplate: variant.promptTemplate,
      };
    }
  }

  return variants[0];
};

export default router;
