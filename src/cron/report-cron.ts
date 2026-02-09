/**
 * Automated Reports Cron Job
 *
 * Generates and sends periodic reports (daily/weekly/monthly)
 */

import cron from 'node-cron';
import nodemailer from 'nodemailer';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { acquireLock, releaseLock } from '../utils/cronLock';
import { sendTelegramMessage, isTelegramConfigured } from '../utils/telegram';

const LOCK_NAME = 'report-generation';

interface ReportStats {
  period: string;
  totalPosts: number;
  newPosts: number;
  historicPosts: number;
  newHistoric: number;
  messagesSent: number;
  avgConfidence: number | null;
  avgQuality: number | null;
  topGroups: Array<{ groupId: string; count: number }>;
  highQualityCount: number;
}

/**
 * Generate report statistics for a given period
 */
const generateReportStats = async (
  startDate: Date,
  endDate: Date,
  periodName: string
): Promise<ReportStats> => {
  const [
    totalPosts,
    newPosts,
    historicPosts,
    newHistoric,
    messagesSent,
    avgConfidence,
    avgQuality,
    topGroups,
    highQualityCount,
  ] = await Promise.all([
    // Total posts
    prisma.postRaw.count(),

    // New posts in period
    prisma.postRaw.count({
      where: { scrapedAt: { gte: startDate, lte: endDate } },
    }),

    // Total historic posts
    prisma.postClassified.count({ where: { isHistoric: true } }),

    // New historic in period
    prisma.postClassified.count({
      where: {
        isHistoric: true,
        classifiedAt: { gte: startDate, lte: endDate },
      },
    }),

    // Messages sent in period
    prisma.messageSent.count({
      where: {
        status: 'sent',
        sentAt: { gte: startDate, lte: endDate },
      },
    }),

    // Average confidence
    prisma.postClassified.aggregate({
      _avg: { confidence: true },
    }),

    // Average quality rating
    prisma.qualityRating.aggregate({
      _avg: { rating: true },
    }),

    // Top groups by post count
    prisma.postRaw.groupBy({
      by: ['groupId'],
      _count: { id: true },
      where: { scrapedAt: { gte: startDate, lte: endDate } },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    }),

    // High quality posts (4+ stars)
    prisma.qualityRating.count({
      where: {
        rating: { gte: 4 },
        ratedAt: { gte: startDate, lte: endDate },
      },
    }),
  ]);

  return {
    period: periodName,
    totalPosts,
    newPosts,
    historicPosts,
    newHistoric,
    messagesSent,
    avgConfidence: avgConfidence._avg.confidence,
    avgQuality: avgQuality._avg.rating,
    topGroups: topGroups.map((g) => ({ groupId: g.groupId, count: g._count.id })),
    highQualityCount,
  };
};

/**
 * Format report as HTML email
 */
const formatEmailReport = (stats: ReportStats): string => {
  const topGroupsList = stats.topGroups
    .map((g) => `<li>${g.groupId}: ${g.count} posts</li>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    h2 { color: #475569; margin-top: 20px; }
    .stat { background: #f8fafc; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .stat-label { color: #64748b; font-size: 14px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1e293b; }
    .highlight { color: #059669; }
    ul { padding-left: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Tarasa ${stats.period} Report</h1>

    <h2>Overview</h2>
    <div class="stat">
      <div class="stat-label">Total Posts</div>
      <div class="stat-value">${stats.totalPosts.toLocaleString()}</div>
    </div>
    <div class="stat">
      <div class="stat-label">New Posts (This Period)</div>
      <div class="stat-value highlight">+${stats.newPosts.toLocaleString()}</div>
    </div>

    <h2>Historic Stories</h2>
    <div class="stat">
      <div class="stat-label">Total Historic Posts</div>
      <div class="stat-value">${stats.historicPosts.toLocaleString()}</div>
    </div>
    <div class="stat">
      <div class="stat-label">New Historic (This Period)</div>
      <div class="stat-value highlight">+${stats.newHistoric.toLocaleString()}</div>
    </div>

    <h2>Quality Metrics</h2>
    <div class="stat">
      <div class="stat-label">Average Confidence</div>
      <div class="stat-value">${stats.avgConfidence?.toFixed(1) || 'N/A'}%</div>
    </div>
    <div class="stat">
      <div class="stat-label">Average Quality Rating</div>
      <div class="stat-value">${stats.avgQuality?.toFixed(1) || 'N/A'} ⭐</div>
    </div>
    <div class="stat">
      <div class="stat-label">High Quality Stories (4+ ⭐)</div>
      <div class="stat-value">${stats.highQualityCount}</div>
    </div>

    <h2>Messaging</h2>
    <div class="stat">
      <div class="stat-label">Messages Sent</div>
      <div class="stat-value">${stats.messagesSent.toLocaleString()}</div>
    </div>

    <h2>Top Groups</h2>
    <ul>
      ${topGroupsList || '<li>No activity this period</li>'}
    </ul>

    <div class="footer">
      Generated by Tarasa Historic Story Extractor<br>
      ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>
`;
};

/**
 * Send email report
 */
const sendEmailReport = async (recipients: string[], subject: string, html: string): Promise<boolean> => {
  const emailUser = process.env.SYSTEM_EMAIL_ALERT;
  const emailPass = process.env.SYSTEM_EMAIL_PASSWORD;

  if (!emailUser || !emailPass) {
    logger.warn('[Report] Email not configured');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    await transporter.sendMail({
      from: `"Tarasa Reports" <${emailUser}>`,
      to: recipients.join(', '),
      subject,
      html,
    });

    return true;
  } catch (error) {
    logger.error(`[Report] Failed to send email: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

/**
 * Generate and send weekly report
 */
export const generateWeeklyReport = async (): Promise<void> => {
  const hasLock = await acquireLock(LOCK_NAME);
  if (!hasLock) return;

  try {
    // Calculate period
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const periodName = `Weekly Report (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})`;

    // Generate stats
    const stats = await generateReportStats(startDate, endDate, periodName);

    // Get recipients
    const configs = await prisma.reportConfig.findMany({
      where: { isActive: true, frequency: 'weekly' },
    });

    const recipients = configs.map((c) => c.email);

    if (recipients.length > 0) {
      const html = formatEmailReport(stats);
      const sent = await sendEmailReport(
        recipients,
        `Tarasa Weekly Report - ${endDate.toLocaleDateString()}`,
        html
      );

      if (sent) {
        // Update last sent time
        await prisma.reportConfig.updateMany({
          where: { isActive: true, frequency: 'weekly' },
          data: { lastSentAt: new Date() },
        });

        // Save to history
        await prisma.reportHistory.create({
          data: {
            period: `${startDate.getFullYear()}-W${getISOWeekNumber(startDate)}`,
            recipients: JSON.stringify(recipients),
            stats: JSON.stringify(stats),
          },
        });

        await logSystemEvent('admin', `Weekly report sent to ${recipients.length} recipients`);
      }
    }

    // Also send to Telegram if configured
    if (isTelegramConfigured()) {
      const telegramMessage = `
<b>📊 Weekly Report</b>

<b>Posts:</b>
• Total: ${stats.totalPosts.toLocaleString()}
• New: +${stats.newPosts.toLocaleString()}
• Historic: ${stats.historicPosts.toLocaleString()}

<b>Quality:</b>
• Avg rating: ${stats.avgQuality?.toFixed(1) || 'N/A'} ⭐
• High quality: ${stats.highQualityCount}

<b>Messages:</b>
• Sent: ${stats.messagesSent.toLocaleString()}

${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}
      `.trim();

      await sendTelegramMessage(telegramMessage);
    }

    logger.info('[Report] Weekly report generated');
  } catch (error) {
    logger.error(`[Report] Error generating report: ${error}`);
    await logSystemEvent('error', `Report generation failed: ${error}`);
  } finally {
    await releaseLock(LOCK_NAME);
  }
};

// Schedule: Every Monday at 9:00 AM
const weeklySchedule = process.env.WEEKLY_REPORT_CRON_SCHEDULE || '0 9 * * 1';

export const startReportCron = () => {
  cron.schedule(weeklySchedule, () => {
    (async () => {
      try {
        logger.debug('[Report] Weekly report cron triggered');
        await generateWeeklyReport();
      } catch (error) {
        logger.error(`[Report] Unhandled cron error: ${(error as Error).message}`);
      }
    })();
  });

  logger.info(`[Report] Weekly report scheduled: ${weeklySchedule}`);
};

/**
 * Calculate ISO week number for a date
 */
const getISOWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

export default { generateWeeklyReport, startReportCron };
