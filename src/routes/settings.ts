import { Request, Response, Router } from 'express';

const router = Router();

const getGroups = (): string[] =>
  (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id): id is string => Boolean(id));

router.get('/api/settings', (_req: Request, res: Response) => {
  const groups = getGroups();
  const messageLimit = Number(process.env.MAX_MESSAGES_PER_DAY || 20);
  const baseTarasaUrl = process.env.BASE_TARASA_URL || 'https://tarasa.me/he/premium/5d5252bf574a2100368f9833';
  const emailConfigured = Boolean(process.env.SYSTEM_EMAIL_ALERT && process.env.SYSTEM_EMAIL_PASSWORD);
  const apifyConfigured = Boolean(process.env.APIFY_TOKEN);

  res.json({
    groups,
    messageLimit,
    baseTarasaUrl,
    emailConfigured,
    apifyConfigured,
  });
});

export default router;
