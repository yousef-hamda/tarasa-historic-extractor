/**
 * Prompts Management API
 *
 * Allows admins to customize AI classification and message generation prompts
 */

import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { safeErrorMessage } from '../middleware/errorHandler';
import { apiKeyAuth } from '../middleware/apiAuth';
import { logSystemEvent } from '../utils/systemLog';
import OpenAI from 'openai';
import { getModel, sanitizeForPrompt, normalizeMessageContent } from '../utils/openaiHelpers';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Default prompts
const DEFAULT_CLASSIFIER_PROMPT = `You are an expert community moderator for Tarasa, a historical storytelling preservation project.
Classify whether the supplied Facebook post clearly references historical events, personal memories from the past, or stories about community history.
Look for posts about: old photographs, family memories, local history, historical buildings/places, past events, cultural traditions, or nostalgic recollections.
Respond with JSON matching the schema.`;

const DEFAULT_GENERATOR_PROMPT = `You write short, friendly messages to people on Facebook who shared a historical story or memory.

CRITICAL: You MUST write the message in the SAME LANGUAGE as the original post:
- If the post is in Hebrew (עברית) → write the message in Hebrew
- If the post is in Arabic (العربية) → write the message in Arabic
- If the post is in English → write the message in English

Rules:
1) Address the person by their first name warmly and naturally.
2) Compliment what they shared specifically (reference their story or memories).
3) Briefly introduce Tarasa platform:
   - Hebrew: "פלטפורמת טראסא מוקדשת לשימור ההיסטוריה הקהילתית והזכרונות האישיים לדורות הבאים"
   - Arabic: "منصة تراسا مخصصة لحفظ التاريخ المجتمعي والذكريات الشخصية للأجيال القادمة"
   - English: "Tarasa platform is dedicated to preserving community history and personal memories for future generations"
4) Invite them to share their full story via the provided link, making the link a natural part of the text.
5) Keep the message human and not robotic, varied in phrasing, 3-5 short sentences.
6) Don't use repetitive emojis or overly formal phrases.

Return ONLY the final message text in the SAME LANGUAGE as the original post, including the provided link.`;

/**
 * GET /api/prompts
 * Get all prompts (active and history)
 */
router.get('/api/prompts', async (_req: Request, res: Response) => {
  try {
    const prompts = await prisma.promptTemplate.findMany({
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });

    // Get active prompts for each type
    const activeClassifier = prompts.find((p: any) => p.type === 'classifier' && p.isActive);
    const activeGenerator = prompts.find((p: any) => p.type === 'generator' && p.isActive);

    res.json({
      active: {
        classifier: activeClassifier || {
          id: 0,
          type: 'classifier',
          name: 'Default Classifier',
          content: DEFAULT_CLASSIFIER_PROMPT,
          isActive: true,
          version: 0,
          createdAt: new Date(),
        },
        generator: activeGenerator || {
          id: 0,
          type: 'generator',
          name: 'Default Generator',
          content: DEFAULT_GENERATOR_PROMPT,
          isActive: true,
          version: 0,
          createdAt: new Date(),
        },
      },
      history: {
        classifier: prompts.filter((p: any) => p.type === 'classifier'),
        generator: prompts.filter((p: any) => p.type === 'generator'),
      },
      defaults: {
        classifier: DEFAULT_CLASSIFIER_PROMPT,
        generator: DEFAULT_GENERATOR_PROMPT,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Prompts API] Error fetching prompts: ${message}`);
    res.status(500).json({
      error: 'Failed to fetch prompts',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * POST /api/prompts
 * Create a new prompt version
 */
router.post('/api/prompts', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { type, name, content, setActive } = req.body;

    if (!type || !['classifier', 'generator'].includes(type)) {
      return res.status(400).json({ error: 'Invalid prompt type. Must be "classifier" or "generator".' });
    }

    if (!content || typeof content !== 'string' || content.trim().length < 50) {
      return res.status(400).json({ error: 'Prompt content must be at least 50 characters.' });
    }

    // Get the latest version for this type
    const latestVersion = await prisma.promptTemplate.findFirst({
      where: { type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const newVersion = (latestVersion?.version || 0) + 1;

    // If setActive is true, deactivate current active prompt
    if (setActive) {
      await prisma.promptTemplate.updateMany({
        where: { type, isActive: true },
        data: { isActive: false },
      });
    }

    // Create new prompt
    const newPrompt = await prisma.promptTemplate.create({
      data: {
        type,
        name: name || `${type} v${newVersion}`,
        content: content.trim(),
        isActive: setActive || false,
        version: newVersion,
      },
    });

    await logSystemEvent('admin', `Created new ${type} prompt v${newVersion}${setActive ? ' (active)' : ''}`);

    res.json({
      success: true,
      prompt: newPrompt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Prompts API] Error creating prompt: ${message}`);
    res.status(500).json({
      error: 'Failed to create prompt',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * POST /api/prompts/:id/activate
 * Activate a specific prompt version
 */
router.post('/api/prompts/:id/activate', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid prompt ID' });
    }

    const prompt = await prisma.promptTemplate.findUnique({ where: { id } });

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    // Deactivate current active prompt of the same type
    await prisma.promptTemplate.updateMany({
      where: { type: prompt.type, isActive: true },
      data: { isActive: false },
    });

    // Activate the selected prompt
    await prisma.promptTemplate.update({
      where: { id },
      data: { isActive: true },
    });

    await logSystemEvent('admin', `Activated ${prompt.type} prompt v${prompt.version}`);

    res.json({
      success: true,
      message: `Prompt v${prompt.version} is now active`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Prompts API] Error activating prompt: ${message}`);
    res.status(500).json({
      error: 'Failed to activate prompt',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * POST /api/prompts/test
 * Test a prompt with a sample post
 */
router.post('/api/prompts/test', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { type, content, sampleText, sampleAuthor } = req.body;

    if (!type || !['classifier', 'generator'].includes(type)) {
      return res.status(400).json({ error: 'Invalid prompt type' });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Prompt content is required' });
    }

    if (!sampleText || typeof sampleText !== 'string') {
      return res.status(400).json({ error: 'Sample text is required' });
    }

    const model = getModel(type);

    if (type === 'classifier') {
      // Test classifier prompt
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'classification_schema',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                is_historic: { type: 'boolean' },
                confidence: { type: 'integer', minimum: 0, maximum: 100 },
                reason: { type: 'string' },
              },
              required: ['is_historic', 'confidence', 'reason'],
            },
          },
        },
        messages: [
          { role: 'system', content },
          { role: 'user', content: sanitizeForPrompt(sampleText) },
        ],
      });

      const resultText = normalizeMessageContent(completion.choices[0]?.message?.content);
      const result = JSON.parse(resultText || '{}');

      res.json({
        success: true,
        result: {
          is_historic: result.is_historic,
          confidence: result.confidence,
          reason: result.reason,
        },
        usage: completion.usage,
      });
    } else {
      // Test generator prompt
      const link = 'https://tarasa.me/submit/test';
      const authorName = sampleAuthor || 'Friend';

      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.8,
        messages: [
          { role: 'system', content },
          {
            role: 'user',
            content: `Author name: ${sanitizeForPrompt(authorName, 100)}\nOriginal post: ${sanitizeForPrompt(sampleText)}\nLink to share story: ${link}`,
          },
        ],
      });

      const messageText = normalizeMessageContent(completion.choices[0]?.message?.content).trim();

      res.json({
        success: true,
        result: {
          message: messageText,
        },
        usage: completion.usage,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Prompts API] Error testing prompt: ${message}`);
    res.status(500).json({
      error: 'Failed to test prompt',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * DELETE /api/prompts/:id
 * Delete a prompt (only if not active)
 */
router.delete('/api/prompts/:id', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid prompt ID' });
    }

    const prompt = await prisma.promptTemplate.findUnique({ where: { id } });

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    if (prompt.isActive) {
      return res.status(400).json({ error: 'Cannot delete active prompt. Activate another prompt first.' });
    }

    await prisma.promptTemplate.delete({ where: { id } });

    await logSystemEvent('admin', `Deleted ${prompt.type} prompt v${prompt.version}`);

    res.json({
      success: true,
      message: 'Prompt deleted',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Prompts API] Error deleting prompt: ${message}`);
    res.status(500).json({
      error: 'Failed to delete prompt',
      message: safeErrorMessage(error, 'Internal server error'),
    });
  }
});

/**
 * Helper function to get active prompt content
 * Used by classifier.ts and generator.ts
 */
export const getActivePrompt = async (type: 'classifier' | 'generator'): Promise<string> => {
  const activePrompt = await prisma.promptTemplate.findFirst({
    where: { type, isActive: true },
    select: { content: true },
  });

  if (activePrompt) {
    return activePrompt.content;
  }

  // Return default
  return type === 'classifier' ? DEFAULT_CLASSIFIER_PROMPT : DEFAULT_GENERATOR_PROMPT;
};

export { DEFAULT_CLASSIFIER_PROMPT, DEFAULT_GENERATOR_PROMPT };
export default router;
