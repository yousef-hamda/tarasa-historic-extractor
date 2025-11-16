import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const validateQuery = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.query);
      next();
    } catch (error) {
      res.status(400).json({ error: 'Invalid query parameters', details: error });
    }
  };
};

export const postsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  group: z.string().optional(),
  historic: z.enum(['true', 'false', 'pending', 'all']).optional(),
});

export const logsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  type: z.string().optional(),
  search: z.string().optional(),
});
