import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    logger.warn('ADMIN_API_KEY not configured - allowing request without auth');
    return next();
  }

  if (!apiKey || apiKey !== configuredKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};
