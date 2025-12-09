/**
 * Shared utilities for OpenAI API interactions
 */

/**
 * Normalize OpenAI message content which can be a string or array of content parts
 */
export const normalizeMessageContent = (
  content?: string | null | Array<{ type: string; text?: string }>,
): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const textChunk = content.find((chunk) => chunk.type === 'text');
  return textChunk?.text ?? '';
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
 */
export const validateGeneratedMessage = (
  message: string,
  expectedLinkBase: string,
): boolean => {
  if (!message || message.length < 50) return false;
  // Message should contain the tarasa link
  return message.includes(expectedLinkBase) || message.includes('tarasa.com') || message.includes('tarasa.me');
};
