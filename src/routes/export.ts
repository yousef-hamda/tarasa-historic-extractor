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

const formatDate = (d: Date): string =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const formatDateForFilename = (d: Date): string =>
  // YYYY-MM-DD, safe for filenames + chronological sort.
  d.toISOString().slice(0, 10);

/**
 * Construct a Facebook URL for the post when the scraper didn't capture a
 * canonical postUrl. Mirrors the dashboard's effectivePostUrl helper so the
 * two surfaces agree on when a link is shown.
 *
 * Returns null for the hash-fallback id case — we can't link to a post we
 * never got a real id for.
 */
const buildPostUrl = (postUrl: string | null, fbPostId: string | null, groupId: string | null): string | null => {
  if (postUrl) return postUrl;
  if (!fbPostId || !groupId) return null;
  if (fbPostId.startsWith('hash_')) return null;
  if (!/^\d+$/.test(fbPostId)) return null;
  return `https://www.facebook.com/groups/${groupId}/posts/${fbPostId}`;
};

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
    'text-align:left; padding:8px 12px; border:1px solid #e2e8f0; background:#f1f5f9; font-weight:600; color:#0f172a; vertical-align:bottom;';
  const cellBase =
    'padding:10px 12px; border:1px solid #e2e8f0; vertical-align:top; color:#1e293b; font-size:14px;';

  const tableRows = rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      const confColor = r.confidence >= 90 ? '#15803d' : r.confidence >= 80 ? '#0369a1' : '#7c2d12';

      // Two separate link cells (Post / Profile) so the columns can be sorted
      // and copy-pasted independently. postLink is already resolved by the
      // caller via buildPostUrl, so it falls back to a constructed FB URL
      // for any post we have a numeric fbPostId for.
      const postLinkCell = r.postUrl
        ? `<a href="${escapeHtml(r.postUrl)}" style="color:#2563eb; text-decoration:none;">View post</a>`
        : '<span style="color:#94a3b8;">—</span>';
      const profileLinkCell = r.authorLink
        ? `<a href="${escapeHtml(r.authorLink)}" style="color:#2563eb; text-decoration:none;">View profile</a>`
        : '<span style="color:#94a3b8;">—</span>';

      // Preserve newlines + paragraph breaks from the original post. Posts
      // often have meaningful structure (Hebrew/Arabic blocks, lists,
      // quoted lines) and a single-paragraph render destroys readability.
      const renderedText = escapeHtml(r.postText).replace(/\n/g, '<br>');

      return `<tr style="background:${bg};">
  <td style="${cellBase} white-space:nowrap;">${escapeHtml(r.authorName) || '<span style="color:#94a3b8;">Unknown</span>'}</td>
  <td style="${cellBase} white-space:nowrap;">${escapeHtml(r.groupName)}</td>
  <td style="${cellBase} text-align:right; color:${confColor}; font-weight:600; white-space:nowrap;">${r.confidence}%</td>
  <td style="${cellBase} white-space:nowrap; color:#475569;">${escapeHtml(r.scrapedAt.toISOString().slice(0, 10))}</td>
  <td style="${cellBase} line-height:1.5;" dir="auto">${renderedText || '<span style="color:#94a3b8;">(empty)</span>'}</td>
  <td style="${cellBase} white-space:nowrap;">${postLinkCell}</td>
  <td style="${cellBase} white-space:nowrap;">${profileLinkCell}</td>
</tr>`;
    })
    .join('\n');

  const titleDate = formatDate(today);
  const now = today.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Table-sizing strategy:
  //   - `table-layout: auto` + no explicit width on the table → each column
  //     grows to fit its widest content, except the "Post text" column,
  //     which gets the remaining horizontal room and wraps long lines.
  //   - All the metadata cells use `white-space: nowrap` so they never
  //     line-break (cleaner read across the row).
  //   - The text cell does NOT cap with max-width — full text comes through,
  //     wrapping at the natural width the rest of the table allows.
  // Some email clients (Outlook desktop) ignore CSS `max-width` anyway, so
  // we rely on whitespace + table-layout to do the right thing.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#f1f5f9;">
  <div style="font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 1400px; margin: 0 auto; padding: 24px;">
    <h1 style="margin:0 0 6px 0; color:#0f172a; font-size:22px;">Approved Posts — ${escapeHtml(titleDate)}</h1>
    <p style="margin:0 0 6px 0; color:#475569; font-size:14px;">
      ${rows.length} post${rows.length === 1 ? '' : 's'} above ${threshold}% confidence threshold.
      ${rows.length === MAX_POSTS_PER_EXPORT ? ' Capped at the first 1000 for email size — see attached CSV for full data.' : ''}
    </p>
    <p style="margin:0 0 18px 0; color:#94a3b8; font-size:12px;">
      &ldquo;Scraped on&rdquo; is the date Tarasa first saw the post. Facebook&rsquo;s own post date is not yet captured.
    </p>

    ${rows.length === 0
      ? `<div style="padding:24px; background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; color:#78350f;">
           No posts currently meet the threshold. Try lowering it in Settings if you expected results.
         </div>`
      : `<table style="border-collapse: collapse; table-layout: auto;">
           <thead>
             <tr>
               <th style="${headerCell}">Author</th>
               <th style="${headerCell}">Group</th>
               <th style="${headerCell} text-align:right;">Confidence</th>
               <th style="${headerCell}">Scraped on</th>
               <th style="${headerCell}">Post text</th>
               <th style="${headerCell}">Post link</th>
               <th style="${headerCell}">Profile link</th>
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
      // Resolve postUrl with the same fallback the dashboard uses so the
      // "View post" link shows for any post we have a real fbPostId for,
      // not only the ones the scraper captured a postUrl for directly.
      postUrl: buildPostUrl(p.postUrl, p.fbPostId, p.groupId),
    }));

    const today = new Date();
    const html = renderHtmlBody(rows, threshold, today);
    const csv = buildCsv(
      ['Author', 'Author Profile Link', 'Group', 'Confidence %', 'Scraped On (UTC)', 'Post Link', 'Post Text'],
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
      await logSystemEvent('error', `Email export failed: ${result.error}`).catch(() => undefined);

      // Map provider-side error categories to appropriate HTTP statuses.
      // Returning 502 for everything was hiding the actual message: Railway's
      // edge proxy can swap a 5xx response body for its own generic page,
      // leaving the user with an opaque "HTTP 502" toast. 4xx responses are
      // passed through with the body intact, so client-side fixable errors
      // (Resend validation, wrong API key, sandbox-mode restrictions) become
      // readable to the user.
      const err = result.error.toLowerCase();
      let status = 502;
      let hint: string | undefined;
      if (err.includes('validation_error') || err.includes('you can only send testing emails')) {
        status = 400;
        hint =
          'Resend\'s free tier only lets you send to the email you signed up with. Either change the admin email in Settings to your Resend signup email, OR verify a domain at https://resend.com/domains and set RESEND_FROM_EMAIL in Railway env.';
      } else if (err.includes('invalid api key') || err.includes('authentication')) {
        status = 401;
        hint = 'The RESEND_API_KEY env var is missing or wrong. Generate a new one at https://resend.com/api-keys and update Railway.';
      } else if (err.includes('rate_limit') || err.includes('too many')) {
        status = 429;
        hint = 'Resend rate limit hit. Wait a minute and try again.';
      }

      return res.status(status).json({
        error: 'Email send failed',
        message: result.error,
        ...(hint ? { hint } : {}),
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
