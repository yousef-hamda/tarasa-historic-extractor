/**
 * Shared utilities for OpenAI API interactions
 */

// Pinned model versions to prevent behavior changes from OpenAI model updates.
// Update these explicitly when you want to upgrade.
export const PINNED_MODELS = {
  classifier: 'gpt-4o-mini-2024-07-18',
  generator: 'gpt-4o-mini-2024-07-18',
} as const;

/**
 * Get the model to use for a given role, respecting env overrides.
 * Falls back to pinned version if env is set to an unpinned alias.
 */
export const getModel = (role: 'classifier' | 'generator'): string => {
  const envKey = role === 'classifier' ? 'OPENAI_CLASSIFIER_MODEL' : 'OPENAI_GENERATOR_MODEL';
  return process.env[envKey] || PINNED_MODELS[role];
};

/**
 * Sanitize user-generated content before including it in AI prompts.
 * Prevents prompt injection by:
 * - Truncating excessively long text
 * - Stripping control characters
 * - Removing common prompt injection patterns
 */
export const sanitizeForPrompt = (text: string, maxLength = 4000): string => {
  if (!text) return '';

  let sanitized = text;

  // Truncate to max length to prevent token abuse
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '... [truncated]';
  }

  // Remove null bytes and other control characters (keep newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Defense-in-depth: filter common prompt injection patterns
  // (Structured output schemas already constrain responses, this raises the bar)
  sanitized = sanitized
    .replace(/\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi, '[filtered]')
    .replace(/\b(system|assistant)\s*:\s*/gi, '[filtered]: ')
    .replace(/\byou\s+are\s+now\b/gi, '[filtered]')
    .replace(/\bforget\s+(all\s+)?(previous|everything|above)\b/gi, '[filtered]')
    .replace(/\bnew\s+instructions?\s*:/gi, '[filtered]:');

  return sanitized;
};

/**
 * Normalize OpenAI message content which can be a string or array of content parts
 */
export const normalizeMessageContent = (
  content?: string | null | Array<{ type: string; text?: string }>,
): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  // Handle array of content parts (OpenAI format)
  if (Array.isArray(content)) {
    const textChunk = content.find((chunk) => chunk.type === 'text');
    return textChunk?.text ?? '';
  }
  // Handle unexpected object types gracefully
  return '';
};

/**
 * Classification result structure from OpenAI
 */
export interface ClassificationResult {
  is_historic: boolean;
  confidence: number;
  reason: string;
}

/**
 * Validate classification result structure
 */
export const validateClassificationResult = (
  data: unknown,
): ClassificationResult | null => {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  if (typeof obj.is_historic !== 'boolean') return null;
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 100) return null;
  if (typeof obj.reason !== 'string') return null;

  return {
    is_historic: obj.is_historic,
    confidence: Math.round(obj.confidence),
    reason: obj.reason,
  };
};

/**
 * Validate generated message contains required link
 *
 * Accepts both:
 * - Direct tarasa.me links (legacy)
 * - Landing page links with /submit/ pattern (new)
 */
export const validateGeneratedMessage = (
  message: string,
  expectedLinkBase: string,
): boolean => {
  if (!message || message.length < 50) return false;

  // Check for landing page submit link pattern (more precise than includes)
  if (/https?:\/\/[^\s]+\/submit\/\d+/.test(message)) return true;

  // Check for expected domain
  try {
    const expectedDomain = new URL(expectedLinkBase).hostname;
    return message.includes(expectedDomain);
  } catch {
    // If expectedLinkBase is not a valid URL, fall back to includes
    return message.includes(expectedLinkBase);
  }
};
