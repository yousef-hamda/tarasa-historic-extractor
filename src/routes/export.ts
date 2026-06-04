/**
 * Email-export route. Builds an HTML email + CSV attachment summarizing every
 * post that passed the operator's historic-confidence threshold, and ships it
 * to the admin email saved in Settings.
 *
 * The button on the Posts page and Admin page POST here. Returns informative
 * 4xx/5xx bodies so the UI can surface the precise reason if it doesn't work
 * (no admin email set, SMTP not configured on the server, SMTP rejected, etc).
 */

import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { getAdminEmail, getHistoricThreshold } from '../utils/settings';
import { sendHtmlEmail } from '../utils/alerts';
import { buildCsv } from '../utils/csvHelpers';

const router = Router();

// Hard cap to keep an accidentally-loose threshold from producing a 10MB+
// email. If a real operator ever hits this, we can paginate; for now this is
// a safety guardrail, not a feature.
const MAX_POSTS_PER_EXPORT = 1000;

const escapeHtml = (s: string | null | undefined): string =>
  (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const truncate = (s: string | null | undefined, max: number): string => {
  const v = (s ?? '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1) + '…';
};

const formatDate = (d: Date): string =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const formatDateForFilename = (d: Date): string =>
  // YYYY-MM-DD, safe for filenames + chronological sort.
  d.toISOString().slice(0, 10);

interface PostRow {
  authorName: string;
  authorLink: string | null;
  groupName: string;
  confidence: number;
  scrapedAt: Date;
  postText: string;
  postUrl: string | null;
}

const renderHtmlBody = (rows: PostRow[], threshold: number, today: Date): string => {
  const headerCell =
    'text-align:left; padding:8px 12px; border:1px solid #e2e8f0; background:#f1f5f9; font-weight:600; color:#0f172a;';
  const cellBase =
    'padding:8px 12px; border:1px solid #e2e8f0; vertical-align:top; color:#1e293b; font-size:14px;';

  const tableRows = rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      const confColor = r.confidence >= 90 ? '#15803d' : r.confidence >= 80 ? '#0369a1' : '#7c2d12';
      const links: string[] = [];
      if (r.postUrl) {
        links.push(
          `<a href="${escapeHtml(r.postUrl)}" style="color:#2563eb; text-decoration:none;">View post</a>`,
        );
      }
      if (r.authorLink) {
        links.push(
          `<a href="${escapeHtml(r.authorLink)}" style="color:#2563eb; text-decoration:none;">Profile</a>`,
        );
      }
      const linksHtml = links.length ? links.join(' · ') : '<span style="color:#94a3b8;">—</span>';

      return `<tr style="background:${bg};">
  <td style="${cellBase}">${escapeHtml(r.authorName) || '<span style="color:#94a3b8;">Unknown</span>'}</td>
  <td style="${cellBase}">${escapeHtml(r.groupName)}</td>
  <td style="${cellBase} text-align:right; color:${confColor}; font-weight:600; white-space:nowrap;">${r.confidence}%</td>
  <td style="${cellBase} white-space:nowrap; color:#475569;">${escapeHtml(r.scrapedAt.toISOString().slice(0, 10))}</td>
  <td style="${cellBase} max-width:480px;">${escapeHtml(truncate(r.postText, 500))}</td>
  <td style="${cellBase} white-space:nowrap;">${linksHtml}</td>
</tr>`;
    })
    .join('\n');

  const titleDate = formatDate(today);
  const now = today.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#f1f5f9;">
  <div style="font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px;">
    <h1 style="margin:0 0 6px 0; color:#0f172a; font-size:22px;">Approved Posts — ${escapeHtml(titleDate)}</h1>
    <p style="margin:0 0 18px 0; color:#475569; font-size:14px;">
      ${rows.length} post${rows.length === 1 ? '' : 's'} above ${threshold}% confidence threshold.
      ${rows.length === MAX_POSTS_PER_EXPORT ? ' Capped at the first 1000 for email size — see attached CSV for full data.' : ''}
    </p>

    ${rows.length === 0
      ? `<div style="padding:24px; background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; color:#78350f;">
           No posts currently meet the threshold. Try lowering it in Settings if you expected results.
         </div>`
      : `<table style="border-collapse: collapse; width: 100%; table-layout: auto;">
           <thead>
             <tr>
               <th style="${headerCell}">Author</th>
               <th style="${headerCell}">Group</th>
               <th style="${headerCell} text-align:right;">Confidence</th>
               <th style="${headerCell}">Posted</th>
               <th style="${headerCell}">Post text</th>
               <th style="${headerCell}">Links</th>
             </tr>
           </thead>
           <tbody>
${tableRows}
           </tbody>
         </table>`}

    <p style="margin-top:28px; color:#94a3b8; font-size:12px;">
      Generated by Tarasa Historic Extractor on ${escapeHtml(now)}. Full data attached as <code>posts-${escapeHtml(formatDateForFilename(today))}.csv</code>.
    </p>
  </div>
</body></html>`;
};

router.post('/api/export/approved-posts', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    const [adminEmail, threshold] = await Promise.all([getAdminEmail(), getHistoricThreshold()]);

    if (!adminEmail) {
      return res.status(400).json({
        error: 'No admin email configured',
        message: 'Set an admin email in Settings → Email Reports before sending exports.',
      });
    }

    if (!process.env.SYSTEM_EMAIL_ALERT || !process.env.SYSTEM_EMAIL_PASSWORD) {
      return res.status(503).json({
        error: 'SMTP not configured on server',
        message:
          'The operator needs to set SYSTEM_EMAIL_ALERT and SYSTEM_EMAIL_PASSWORD env vars in Railway before exports can be emailed.',
      });
    }

    const posts = await prisma.postRaw.findMany({
      where: {
        classified: {
          isHistoric: true,
          confidence: { gt: threshold },
        },
      },
      include: { classified: true },
      orderBy: { scrapedAt: 'desc' },
      take: MAX_POSTS_PER_EXPORT,
    });

    // One-shot group-name lookup so we don't N+1.
    const groupIds = Array.from(new Set(posts.map((p) => p.groupId)));
    const groupRows = groupIds.length
      ? await prisma.groupInfo.findMany({
          where: { groupId: { in: groupIds } },
          select: { groupId: true, groupName: true },
        })
      : [];
    const groupNameById = new Map<string, string>();
    for (const g of groupRows) {
      if (g.groupName) groupNameById.set(g.groupId, g.groupName);
    }

    const rows: PostRow[] = posts.map((p) => ({
      authorName: p.authorName || '',
      authorLink: p.authorLink,
      groupName: groupNameById.get(p.groupId) || p.groupId,
      confidence: p.classified?.confidence ?? 0,
      scrapedAt: p.scrapedAt,
      postText: p.text || '',
      postUrl: p.postUrl,
    }));

    const today = new Date();
    const html = renderHtmlBody(rows, threshold, today);
    const csv = buildCsv(
      ['Author', 'Author Profile Link', 'Group', 'Confidence %', 'Scraped At (UTC)', 'Post Link', 'Post Text'],
      rows.map((r) => [
        r.authorName,
        r.authorLink ?? '',
        r.groupName,
        r.confidence,
        r.scrapedAt.toISOString(),
        r.postUrl ?? '',
        r.postText,
      ]),
    );

    const subject = `Tarasa — ${rows.length} approved post${rows.length === 1 ? '' : 's'} (${formatDate(today)})`;

    const result = await sendHtmlEmail({
      to: adminEmail,
      subject,
      html,
      // Plaintext fallback for clients that don't render HTML.
      text: `${rows.length} approved posts above ${threshold}% confidence. See attached CSV for the full table.`,
      attachments: [
        {
          filename: `posts-${formatDateForFilename(today)}.csv`,
          content: csv,
          contentType: 'text/csv',
        },
      ],
    });

    if (!result.ok) {
      // Mirror the failure to systemLog so /api/logs surfaces it. Without
      // this, Railway edge-proxy timeouts (502 with no body) become opaque —
      // we can't tell whether the SMTP itself failed or the request never
      // even reached our handler.
      await logSystemEvent('error', `Email export failed (SMTP): ${result.error}`).catch(() => undefined);
      return res.status(502).json({
        error: 'Email send failed',
        message: result.error,
      });
    }

    await logSystemEvent(
      'admin',
      `Approved-posts email sent to ${adminEmail} (${rows.length} posts, threshold >${threshold}%)`,
    );

    return res.json({
      success: true,
      recipient: adminEmail,
      postsCount: rows.length,
      threshold,
      capped: rows.length === MAX_POSTS_PER_EXPORT,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[export] approved-posts failed: ${msg}`);
    await logSystemEvent('error', `Email export crashed: ${msg}`).catch(() => undefined);
    return res.status(500).json({ error: 'Export failed', message: msg });
  }
});

/**
 * Diagnostic-only endpoint. Just runs nodemailer's transporter.verify(),
 * which opens a connection to smtp.gmail.com:587, authenticates, and
 * disconnects — no email is sent. Tells us in seconds whether SMTP is
 * reachable + credentials work, without waiting for a full send + 1000-row
 * attachment. Logs the result to systemLog so it's visible at /api/logs.
 */
router.post('/api/export/verify-smtp', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  if (!process.env.SYSTEM_EMAIL_ALERT || !process.env.SYSTEM_EMAIL_PASSWORD) {
    return res.status(503).json({
      ok: false,
      error: 'SMTP env vars not set',
      message: 'SYSTEM_EMAIL_ALERT and SYSTEM_EMAIL_PASSWORD must be set in Railway.',
    });
  }

  // Dynamic import so we get the *current* transporter (in case the user
  // just rotated credentials and we want to make sure we're using the new
  // ones, not a cached stale connection).
  const { resetMailTransporter } = await import('../utils/alerts');
  resetMailTransporter();

  const nodemailer = await import('nodemailer');
  const t = nodemailer.default.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SYSTEM_EMAIL_ALERT,
      pass: process.env.SYSTEM_EMAIL_PASSWORD,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const started = Date.now();
  try {
    await t.verify();
    const elapsed = Date.now() - started;
    await logSystemEvent('admin', `SMTP verify OK in ${elapsed}ms (smtp.gmail.com:587)`);
    return res.json({
      ok: true,
      message: `SMTP reachable + credentials valid (verified in ${elapsed}ms)`,
      host: 'smtp.gmail.com',
      port: 587,
      elapsedMs: elapsed,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code;
    const elapsed = Date.now() - started;
    await logSystemEvent('error', `SMTP verify FAILED in ${elapsed}ms (code=${code ?? 'none'}): ${msg}`).catch(() => undefined);
    return res.status(502).json({
      ok: false,
      error: 'SMTP verify failed',
      message: msg,
      code,
      elapsedMs: elapsed,
      hint:
        code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ECONNREFUSED'
          ? 'Railway is blocking outbound SMTP (port 587). Switch to an HTTP-based transactional email service like Resend or SendGrid.'
          : code === 'EAUTH'
            ? 'Gmail rejected the credentials. Re-generate the App Password at https://myaccount.google.com/apppasswords and update SYSTEM_EMAIL_PASSWORD.'
            : undefined,
    });
  } finally {
    t.close();
  }
});

export default router;
