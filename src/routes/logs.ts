import { Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/logs', async (_req, res) => {
  const logs = await prisma.systemLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(logs);
});

router.get('/api/messages', async (_req, res) => {
  const messages = await prisma.messageSent.findMany({ orderBy: { sentAt: 'desc' }, take: 200 });
  res.json(messages);
});

export default router;
