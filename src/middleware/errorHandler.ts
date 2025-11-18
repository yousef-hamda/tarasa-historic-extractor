import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  logger.error(`API Error: ${error.message}`, {
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ status: 'error', message: error.message });
};
