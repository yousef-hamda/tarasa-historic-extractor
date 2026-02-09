import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Returns a safe error message for API responses.
 * In production, returns the fallback to avoid leaking internal details.
 * In development, returns the actual error message for debugging.
 */
export const safeErrorMessage = (error: unknown, fallback: string = 'Internal server error'): string => {
  if (isProduction) return fallback;
  return error instanceof Error ? error.message : fallback;
};

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  logger.error(`API Error: ${error.message}`, {
    path: req.path,
    method: req.method,
    stack: error.stack,
  });

  // In production, don't expose internal error details to clients
  const clientMessage = isProduction
    ? 'An internal error occurred'
    : error.message;

  res.status(500).json({ status: 'error', message: clientMessage });
};
