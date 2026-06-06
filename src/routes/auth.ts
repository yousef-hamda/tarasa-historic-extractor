/**
 * Site Access (password gate) routes.
 *
 * A lightweight front-door password for the dashboard, separate from the
 * `API_KEY` that protects write endpoints. The password is validated
 * server-side against `SITE_PASSWORD` (it NEVER ships in the client bundle).
 * If `SITE_PASSWORD` is unset the gate self-disables and the site stays open —
 * so this is fully backwards compatible until the operator sets the env var.
 *
 * Threat model: this is a UX/obscurity gate (the client stores an "unlocked"
 * flag on success). Sensitive mutations remain protected by `API_KEY`.
 */
import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { triggerRateLimiter } from '../middleware/rateLimiter';

const router = Router();

/** Timing-safe equality (same approach as middleware/apiAuth.ts). */
const timingSafeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * GET /api/auth/required
 * Tells the frontend whether a site password is configured. Public.
 */
router.get('/api/auth/required', (_req: Request, res: Response) => {
  res.json({ required: Boolean(process.env.SITE_PASSWORD) });
});

/**
 * POST /api/auth/login  { password }
 * Validates the site password. Rate-limited to blunt brute-force. Public.
 */
router.post('/api/auth/login', triggerRateLimiter, (req: Request, res: Response) => {
  const expected = process.env.SITE_PASSWORD;

  // Gate disabled — accept anything so the site is usable without a password.
  if (!expected) {
    return res.json({ success: true, required: false });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const provided = typeof body.password === 'string' ? body.password : '';

  if (!provided) {
    return res.status(400).json({ success: false, message: 'Password is required.' });
  }

  if (!timingSafeEqual(provided, expected)) {
    return res.status(401).json({ success: false, message: 'Incorrect password.' });
  }

  res.json({ success: true });
});

export default router;
