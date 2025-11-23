import prisma from '../database/prisma';

const getLimit = () => Number(process.env.MAX_MESSAGES_PER_DAY || 20);

export const getDailyMessageUsage = async () => {
  const limit = getLimit();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentLast24h = await prisma.messageSent.count({
    where: { sentAt: { gte: since }, status: 'sent' },
  });

  const remaining = Math.max(0, limit - sentLast24h);

  return { limit, sentLast24h, remaining };
};

export const getRemainingMessageQuota = async () => {
  const usage = await getDailyMessageUsage();
  return usage.remaining;
};
