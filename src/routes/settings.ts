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
  const baseTarasaUrl = process.env.BASE_TARASA_URL || 'https://tarasa.com/add-story';
  const emailConfigured = Boolean(process.env.SYSTEM_EMAIL_ALERT && process.env.SYSTEM_EMAIL_PASSWORD);

  res.json({
    groups,
    messageLimit,
    baseTarasaUrl,
    emailConfigured,
  });
});

export default router;
