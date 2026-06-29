import { Page } from 'playwright';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import {
  selectors,
  clickFirstMatchingSelector,
  waitForFirstMatchingSelector,
  fillFirstMatchingSelector,
} from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import { withRetries } from '../utils/retry';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { hardCloseBrowser } from '../utils/browserReaper';
import { logSystemEvent } from '../utils/systemLog';
import { TIMEOUTS, QUOTA } from '../config/constants';
import { getMessagingEnabledAsync } from '../utils/settings';
import { withLock, isLocked } from '../utils/cronLock';

// Maximum retry attempts before marking a message as permanently failed
const MAX_RETRY_ATTEMPTS = 3;

// Defensive: don't message the same authorLink twice within this window,
// regardless of which post triggered the second attempt. Catches both
// "phantom duplicate post" cases (where the dedup hash fails) and the
// genuine "same author posted two historic things" case where we shouldn't
// spam them.
const AUTHOR_COOLDOWN_DAYS = Number(process.env.MESSAGE_AUTHOR_COOLDOWN_DAYS) || 30;

const getRemainingMessageQuota = async (): Promise<number> => {
  const max = Number(process.env.MAX_MESSAGES_PER_DAY) || QUOTA.DEFAULT_MAX_PER_DAY;
  const since = new Date(Date.now() - QUOTA.WINDOW_MS);
  // Count ALL message attempts (sent + error + pending), not just sent
  const count = await prisma.messageSent.count({
    where: { sentAt: { gte: since } },
  });
  return Math.max(0, max - count);
};

/**
 * Check if a message has already been sent or has exceeded retry limits.
 *
 * Two layers of "should skip":
 *   1. Per-(post, author) — already sent OR exceeded retry count
 *   2. Per-author within cooldown window — protects against duplicate
 *      messages to the same person across different posts (incl. phantom
 *      duplicates produced by content-hash drift)
 */
const shouldSkipMessage = async (postId: number, authorLink: string): Promise<{ skip: boolean; reason?: string }> => {
  // Layer 1: same (post, author) — already sent or maxed out retries.
  const existing = await prisma.messageSent.findUnique({
    where: { postId_authorLink: { postId, authorLink } },
  });
  if (existing) {
    if (existing.status === 'sent') {
      return { skip: true, reason: 'already sent' };
    }
    if (existing.retryCount >= MAX_RETRY_ATTEMPTS) {
      return { skip: true, reason: `exceeded ${MAX_RETRY_ATTEMPTS} retry attempts` };
    }
  }

  // Layer 2: same authorLink, sent within cooldown window.
  // We DON'T want to spam the same person — once per cooldown, ever.
  const cooldownSince = new Date(Date.now() - AUTHOR_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const recentToAuthor = await prisma.messageSent.findFirst({
    where: {
      authorLink,
      status: 'sent',
      sentAt: { gte: cooldownSince },
    },
    orderBy: { sentAt: 'desc' },
  });
  if (recentToAuthor && recentToAuthor.postId !== postId) {
    return {
      skip: true,
      reason: `already messaged this author within last ${AUTHOR_COOLDOWN_DAYS} days (post ${recentToAuthor.postId})`,
    };
  }

  return { skip: false };
};

/**
 * After pressing Enter, Facebook's composer clears the textarea ONLY if the
 * message was actually sent. Reading the textarea's value/innerText back is
 * the most reliable confirmation we can get without a network probe.
 *
 * Returns true if the textarea is now empty (= message sent). Returns false
 * if it still contains text (= Enter was swallowed and we need to click).
 */
const wasTextareaCleared = async (
  textAreaHandle: import('playwright').ElementHandle
): Promise<boolean> => {
  try {
    // The composer uses a contenteditable div, not a real <textarea>. Both
    // .value (real textarea) and innerText (contenteditable) are checked so
    // we don't care which variant Facebook is serving today.
    const remaining = await textAreaHandle.evaluate((el) => {
      const node = el as HTMLElement & { value?: string };
      const value = (node.value || '').trim();
      const text = (node.innerText || '').trim();
      return (value + text).trim();
    });
    return remaining.length === 0;
  } catch {
    // If we can't read the textarea at all (it might've been detached after a
    // successful send), treat that as "cleared" — the optimistic-by-default
    // call is to trust the Enter press worked.
    return true;
  }
};

/**
 * Find a Send button SCOPED to the composer container. We walk up from the
 * textarea handle to find the nearest dialog / form / role=presentation
 * container and search for a Send-labeled button inside that subtree only.
 *
 * Returns null if no scoped Send button is found. We do NOT fall back to a
 * page-wide selector — that's exactly the bug we're fixing. If Enter didn't
 * work and there's no scoped button, the message attempt fails fast and the
 * outer retry loop decides what to do.
 */
const findSendButtonNearTextarea = async (
  page: import('playwright').Page,
  textAreaHandle: import('playwright').ElementHandle
): Promise<import('playwright').ElementHandle | null> => {
  try {
    // Resolve the closest container. We use evaluateHandle so we can return
    // a DOM node back to Node. Prefer dialog > form > the textarea's parent.
    const containerHandle = await textAreaHandle.evaluateHandle((el) => {
      const node = el as HTMLElement;
      const dialog = node.closest('[role="dialog"]');
      if (dialog) return dialog;
      const form = node.closest('form');
      if (form) return form;
      // Fall back to a couple of levels up so we have a useful subtree.
      return node.parentElement?.parentElement?.parentElement || node.parentElement || node;
    });
    const container = containerHandle.asElement();
    if (!container) {
      return null;
    }

    // Look for a Send-labeled actionable element WITHIN the container.
    // Order matters: prefer aria-label hits (most reliable), then specific
    // role=button with text, then plain submit buttons.
    const candidates = [
      'div[role="button"][aria-label="Send"]',
      'button[aria-label="Send"]',
      'div[role="button"]:has-text("Send")',
      'button:has-text("Send")',
      'button[type="submit"]',
    ];
    for (const sel of candidates) {
      const found = await container.$(sel).catch(() => null);
      if (found) return found;
    }
    return null;
  } catch (err) {
    logger.debug(`[Messenger] findSendButtonNearTextarea error: ${(err as Error).message}`);
    return null;
  }
};

/**
 * Deliver one message to an author's chat on an already-open page. Navigates to
 * the author profile, opens the Messenger composer, types the text, sends (Enter
 * with a scoped Send-button fallback), and verifies. Retries up to 3×. Throws on
 * failure. Shared by the cron dispatch loop and the manual single-send endpoint
 * so both go through the exact same, battle-tested send sequence.
 */
const deliverMessageOnPage = async (
  page: Page,
  authorLink: string,
  messageText: string,
  postId: number,
): Promise<void> => {
  await withRetries(
    async (attempt) => {
      await page.goto(authorLink, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });
      await humanDelay();

      // Open message composer
      await clickFirstMatchingSelector(page, selectors.messengerButtons);
      const { handle: textAreaHandle } = await waitForFirstMatchingSelector(
        page,
        selectors.messengerTextarea,
        { timeout: TIMEOUTS.SHORT_WAIT }
      );

      if (!textAreaHandle) {
        throw new Error('Messenger text area not found');
      }

      logger.debug(
        `[Messenger] Sending message for post ${postId} to ${authorLink} (first 200 chars): ${messageText.slice(0, 200)}`
      );

      await fillFirstMatchingSelector(page, selectors.messengerTextarea, messageText);
      await humanDelay();

      // Send strategy: press Enter first (succeeds ~95% of the time), then
      // VERIFY by checking whether the textarea was cleared. Only if it wasn't
      // cleared do we fall back to a Send-button click — scoped to the same
      // container as the textarea so we never click an unrelated "Send".
      await page.keyboard.press('Enter');
      await humanDelay();

      const enterWorked = await wasTextareaCleared(textAreaHandle).catch(() => false);
      let sentVia: 'enter' | 'send-button' | 'unknown' = enterWorked ? 'enter' : 'unknown';

      if (!enterWorked) {
        logger.info(`[Messenger] Enter did not clear textarea for post ${postId}; trying Send button (scoped)`);
        const sendButton = await findSendButtonNearTextarea(page, textAreaHandle);
        if (!sendButton) {
          throw new Error('Enter did not send the message and no Send button was found near the composer');
        }
        try {
          await sendButton.click({ force: true, timeout: 5_000 });
          sentVia = 'send-button';
        } catch (clickErr) {
          throw new Error(`Send button click failed: ${(clickErr as Error).message}`);
        }
      }

      await humanDelay();
      logger.info(`[Messenger] Message attempt ${attempt} sent for post ${postId} (via ${sentVia})`);
    },
    {
      attempts: 3,
      delayMs: 3000,
      operationName: `Send message to ${authorLink}`,
      onRetry: (error, attempt) => {
        logger.warn(`Retrying message for ${postId} after error on attempt ${attempt}: ${error.message}`);
      },
    }
  );
};

/**
 * Manually send ONE generated message immediately (admin pressed "Send" on a
 * specific queued message in the dashboard). Bypasses the global messaging
 * pause and the daily quota — it's an explicit, deliberate operator action —
 * but still records the result in MessageSent and removes the queued row on
 * success, exactly like the cron path. Serialized under the 'message' lock so
 * it can't run a second browser concurrently with the dispatch cron.
 */
/**
 * HARD kill switch for all outbound messaging.
 *
 * Automated cold DMs to non-friends are what got the operator's account
 * disabled (a Community Standards / spam action that cannot be made compliant).
 * This switch is ON by default — sending requires DELIBERATELY setting
 * MESSAGING_HARD_DISABLED=false in the environment, so the dashboard toggle
 * ALONE can never resume cold outreach. Belt-and-suspenders on top of the
 * existing dashboard messaging toggle.
 */
const isMessagingHardDisabled = (): boolean =>
  (process.env.MESSAGING_HARD_DISABLED ?? 'true').toLowerCase() !== 'false';

export const sendGeneratedMessageNow = async (
  messageId: number,
): Promise<{ success: boolean; error?: string }> => {
  if (isMessagingHardDisabled()) {
    return {
      success: false,
      error:
        'Messaging is hard-disabled (MESSAGING_HARD_DISABLED). Cold DMs to non-friends violate ' +
        'Facebook policy and previously got the account disabled. Set MESSAGING_HARD_DISABLED=false ' +
        'in the environment only if you fully understand the risk.',
    };
  }
  if (await isLocked('message')) {
    return { success: false, error: 'A message dispatch is already running. Try again in a moment.' };
  }

  let result: { success: boolean; error?: string } = { success: false, error: 'Did not run' };

  await withLock('message', async () => {
    const candidate = await prisma.messageGenerated.findUnique({
      where: { id: messageId },
      include: { post: true },
    });
    if (!candidate) {
      result = { success: false, error: 'Message not found — it may have already been sent.' };
      return;
    }
    const post = candidate.post;
    if (!post?.authorLink) {
      result = { success: false, error: 'This post has no author link to message.' };
      return;
    }

    let browser;
    let context;
    let page;
    try {
      const fc = await createFacebookContext();
      browser = fc.browser;
      context = fc.context;
      page = await context.newPage();
    } catch (e) {
      result = { success: false, error: `Failed to open browser: ${(e as Error).message}` };
      return;
    }

    try {
      await deliverMessageOnPage(page, post.authorLink, candidate.messageText, candidate.postId);
      await prisma.messageSent.upsert({
        where: { postId_authorLink: { postId: candidate.postId, authorLink: post.authorLink } },
        update: { status: 'sent', error: null, sentAt: new Date(), messageText: candidate.messageText },
        create: { postId: candidate.postId, authorLink: post.authorLink, status: 'sent', messageText: candidate.messageText },
      });
      await prisma.messageGenerated.delete({ where: { id: candidate.id } });
      await logSystemEvent('message', `Message manually sent for post ${candidate.postId}`);
      result = { success: true };
    } catch (sendError) {
      const msg = (sendError as Error).message;
      logger.error(`Manual message send failed for post ${candidate.postId}: ${msg}`);
      await prisma.messageSent
        .upsert({
          where: { postId_authorLink: { postId: candidate.postId, authorLink: post.authorLink } },
          update: { status: 'error', error: msg, retryCount: { increment: 1 }, sentAt: new Date(), messageText: candidate.messageText },
          create: { postId: candidate.postId, authorLink: post.authorLink, status: 'error', error: msg, retryCount: 1, messageText: candidate.messageText },
        })
        .catch(() => undefined);
      await logSystemEvent('error', `Manual message send failed for post ${candidate.postId}: ${msg}`).catch(() => undefined);
      result = { success: false, error: msg };
    } finally {
      try { if (context) await saveCookies(context); } catch {}
      try { if (page) await page.close(); } catch {}
      await hardCloseBrowser(browser);
    }
  });

  return result;
};

export const dispatchMessages = async (): Promise<void> => {
  // HARD kill switch first — cannot be overridden from the dashboard.
  if (isMessagingHardDisabled()) {
    logger.warn(
      '[Messenger] Messaging is hard-disabled (MESSAGING_HARD_DISABLED). Nothing will be sent. ' +
        'Cold DMs to non-friends are what got the account disabled.'
    );
    await logSystemEvent(
      'message',
      'Messaging hard-disabled (kill switch) — nothing sent.'
    ).catch(() => undefined);
    return;
  }
  // Check if messaging is enabled (DB-backed — survives Railway redeploys).
  if (!(await getMessagingEnabledAsync())) {
    logger.info('Messaging is paused by admin. Messages will be queued.');
    await logSystemEvent('message', 'Messaging paused - messages queued but not sent.');
    return;
  }

  let remaining = await getRemainingMessageQuota();
  if (remaining <= 0) {
    logger.warn('Daily message quota reached');
    await logSystemEvent('message', 'Daily message quota reached. Dispatch aborted.');
    return;
  }

  // Clean up any generated messages that cannot be sent due to missing author link
  const cleaned = await prisma.messageGenerated.deleteMany({
    where: { post: { authorLink: null } },
  });
  if (cleaned.count > 0) {
    await logSystemEvent('message', `Removed ${cleaned.count} generated messages without author links`);
  }

  const pending = await prisma.messageGenerated.findMany({
    orderBy: { createdAt: 'asc' },
    take: remaining,
    include: { post: true },
  });

  if (!pending.length) {
    logger.info('No generated messages to dispatch');
    return;
  }

  let browser;
  let context;
  let page;

  try {
    const facebookContext = await createFacebookContext();
    browser = facebookContext.browser;
    context = facebookContext.context;
    page = await context.newPage();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to create Facebook context: ${errorMessage}`);
    // telegram: true — messenger failed to even initialize means outreach
    // is fully paused until the operator looks at it.
    await logSystemEvent('error', `Messenger failed to initialize: ${errorMessage}`, { telegram: true });
    // Clean up browser if it was created but page creation failed
    await hardCloseBrowser(browser);
    return;
  }

  try {
    for (const candidate of pending) {
      const post = candidate.post;
      if (!post?.authorLink) {
        // Remove from queue to avoid repeated retries with no target
        await logSystemEvent('message', `Removed queued message for post ${candidate.postId}; missing author link.`);
        try {
          await prisma.messageGenerated.delete({ where: { id: candidate.id } });
        } catch (queueError) {
          logger.error(`Failed to delete orphaned generated message ${candidate.id}: ${(queueError as Error).message}`);
        }
        continue;
      }
      // Skip if message already sent or exceeded retry limits
      const skipCheck = await shouldSkipMessage(candidate.postId, post.authorLink);
      if (skipCheck.skip) {
        await logSystemEvent('message', `Skipped dispatch for post ${candidate.postId}; ${skipCheck.reason}.`);
        try {
          await prisma.messageGenerated.delete({ where: { id: candidate.id } });
        } catch (queueError) {
          logger.error(`Failed to delete generated message ${candidate.id}: ${(queueError as Error).message}`);
        }
        continue;
      }

      if (remaining <= 0) {
        break;
      }

      let messageSentSuccessfully = false;
      let sendError: Error | null = null;

      try {
        await deliverMessageOnPage(page, post.authorLink, candidate.messageText, candidate.postId);
        messageSentSuccessfully = true;
      } catch (error) {
        sendError = error as Error;
        logger.error(`Failed to send message for post ${candidate.postId}: ${sendError.message}`);
      }

      // Record result in database using upsert (handles unique constraint)
      try {
        if (messageSentSuccessfully) {
          await prisma.messageSent.upsert({
            where: { postId_authorLink: { postId: candidate.postId, authorLink: post.authorLink } },
            update: {
              status: 'sent',
              error: null,
              sentAt: new Date(),
              // Snapshot the text we actually sent so Sent History can show it
              // (the MessageGenerated row is deleted right below).
              messageText: candidate.messageText,
            },
            create: {
              postId: candidate.postId,
              authorLink: post.authorLink,
              status: 'sent',
              messageText: candidate.messageText,
            },
          });
          await prisma.messageGenerated.delete({ where: { id: candidate.id } });
          remaining -= 1;
          await logSystemEvent('message', `Message sent for post ${candidate.postId}`);
        } else {
          // Increment retry count on failure
          await prisma.messageSent.upsert({
            where: { postId_authorLink: { postId: candidate.postId, authorLink: post.authorLink } },
            update: {
              status: 'error',
              error: sendError?.message || 'Unknown error',
              retryCount: { increment: 1 },
              sentAt: new Date(),
              messageText: candidate.messageText,
            },
            create: {
              postId: candidate.postId,
              authorLink: post.authorLink,
              status: 'error',
              error: sendError?.message || 'Unknown error',
              retryCount: 1,
              messageText: candidate.messageText,
            },
          });
          // Keep the generated message for retry (up to MAX_RETRY_ATTEMPTS)
          await logSystemEvent('error', `Message dispatch failed for post ${candidate.postId}: ${sendError?.message}`);
        }
      } catch (dbError) {
        logger.error(`Database error recording message status for post ${candidate.postId}: ${(dbError as Error).message}`);
      }

      if (remaining <= 0) {
        logger.info('Message quota exhausted during dispatch loop');
        break;
      }

      await humanDelay();
    }
  } finally {
    if (context) {
      await saveCookies(context).catch((err) => {
        logger.warn(`Failed to save cookies: ${err.message}`);
      });
    }
    await hardCloseBrowser(browser);
  }
};

// Execute when run directly via npm run message
if (require.main === module) {
  require('dotenv/config');
  dispatchMessages()
    .then(() => {
      logger.info('Message dispatch completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`Message dispatch failed: ${error.message}`);
      process.exit(1);
    });
}
