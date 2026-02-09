/**
 * Telegram Bot Integration
 *
 * Provides notifications for high-quality stories and system alerts
 * Also supports basic remote monitoring commands
 */

import axios from 'axios';
import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_API_URL = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

/**
 * Check if Telegram is configured
 */
export const isTelegramConfigured = (): boolean => {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
};

/**
 * Send a message via Telegram
 */
export const sendTelegramMessage = async (
  message: string,
  options: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableNotification?: boolean;
  } = {}
): Promise<boolean> => {
  if (!TELEGRAM_API_URL || !TELEGRAM_CHAT_ID) {
    logger.debug('[Telegram] Not configured, skipping message');
    return false;
  }

  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: options.parseMode || 'HTML',
      disable_notification: options.disableNotification || false,
    });

    if (response.data.ok) {
      logger.debug('[Telegram] Message sent successfully');
      return true;
    } else {
      logger.error(`[Telegram] API error: ${response.data.description}`);
      return false;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Telegram] Failed to send message: ${message}`);
    return false;
  }
};

/**
 * Notify about a high-quality story
 */
export const notifyHighQualityStory = async (post: {
  id: number;
  authorName: string | null;
  text: string;
  groupId: string;
  rating: number;
}): Promise<void> => {
  const stars = '⭐'.repeat(post.rating);
  const preview = post.text.substring(0, 200).replace(/\n/g, ' ');
  const truncated = post.text.length > 200 ? '...' : '';

  const message = `
<b>🌟 High Quality Story Found!</b>

<b>Rating:</b> ${stars} (${post.rating}/5)
<b>Author:</b> ${escapeHtml(post.authorName || 'Unknown')}
<b>Group:</b> ${escapeHtml(post.groupId)}
<b>Post ID:</b> ${post.id}

<b>Preview:</b>
<i>${escapeHtml(preview)}${truncated}</i>

View in dashboard: /posts?id=${post.id}
`.trim();

  await sendTelegramMessage(message);
};

/**
 * Send system status alert
 */
export const sendSystemAlert = async (
  type: 'error' | 'warning' | 'info',
  title: string,
  details?: string
): Promise<void> => {
  const emoji = {
    error: '🚨',
    warning: '⚠️',
    info: 'ℹ️',
  }[type];

  const message = `
${emoji} <b>${escapeHtml(title)}</b>

${details ? escapeHtml(details) : ''}

Time: ${new Date().toLocaleString()}
`.trim();

  await sendTelegramMessage(message);
};

/**
 * Send daily stats summary
 */
export const sendDailyStats = async (): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [totalPosts, todayPosts, historicPosts, messagesSent, avgRating] = await Promise.all([
      prisma.postRaw.count(),
      prisma.postRaw.count({ where: { scrapedAt: { gte: today } } }),
      prisma.postClassified.count({ where: { isHistoric: true } }),
      prisma.messageSent.count({ where: { status: 'sent', sentAt: { gte: today } } }),
      prisma.qualityRating.aggregate({ _avg: { rating: true } }),
    ]);

    const message = `
<b>📊 Daily Stats Summary</b>

<b>Posts:</b>
• Total: ${totalPosts.toLocaleString()}
• Today: ${todayPosts.toLocaleString()}
• Historic: ${historicPosts.toLocaleString()}

<b>Messages:</b>
• Sent today: ${messagesSent.toLocaleString()}

<b>Quality:</b>
• Avg rating: ${avgRating._avg.rating?.toFixed(1) || 'N/A'} ⭐

${new Date().toLocaleDateString()}
`.trim();

    await sendTelegramMessage(message);
  } catch (error) {
    logger.error(`[Telegram] Failed to send daily stats: ${error}`);
  }
};

// ==========================================
// AI-Powered Chat
// ==========================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Conversation history per chat (keeps last N messages for context)
const conversationHistory: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();
const MAX_HISTORY = 20;

/**
 * Gather all live system data for AI context
 */
const gatherSystemContext = async (): Promise<string> => {
  try {
    const today = startOfToday();

    const [
      totalPosts,
      todayPosts,
      totalClassified,
      totalHistoric,
      pendingClassification,
      totalMessages,
      sentMessages,
      failedMessages,
      pendingMessages,
      todayMessages,
      avgRating,
      groups,
      session,
      recentErrors,
      recentPosts,
      topQuality,
    ] = await Promise.all([
      prisma.postRaw.count(),
      prisma.postRaw.count({ where: { scrapedAt: { gte: today } } }),
      prisma.postClassified.count(),
      prisma.postClassified.count({ where: { isHistoric: true } }),
      prisma.postRaw.count({ where: { classified: null } }),
      prisma.messageSent.count(),
      prisma.messageSent.count({ where: { status: 'sent' } }),
      prisma.messageSent.count({ where: { status: 'error' } }),
      prisma.messageSent.count({ where: { status: 'pending' } }),
      prisma.messageSent.count({ where: { status: 'sent', sentAt: { gte: today } } }),
      prisma.qualityRating.aggregate({ _avg: { rating: true } }),
      prisma.groupInfo.findMany({ orderBy: { groupName: 'asc' } }),
      prisma.sessionState.findFirst({ orderBy: { lastChecked: 'desc' } }),
      prisma.systemLog.findMany({ where: { type: 'error' }, orderBy: { createdAt: 'desc' }, take: 3 }),
      prisma.postClassified.findMany({
        where: { isHistoric: true },
        include: { post: { select: { authorName: true, text: true, groupId: true } } },
        orderBy: { classifiedAt: 'desc' },
        take: 5,
      }),
      prisma.qualityRating.findMany({
        where: { rating: { gte: 4 } },
        include: { post: { select: { authorName: true, text: true, groupId: true } } },
        orderBy: { rating: 'desc' },
        take: 5,
      }),
    ]);

    const historicRate = totalClassified > 0 ? Math.round((totalHistoric / totalClassified) * 100) : 0;

    const groupList = groups.map((g: any) => ({
      name: g.groupName || g.groupId,
      id: g.groupId,
      accessible: g.isAccessible,
      lastScraped: g.lastScraped ? timeSince(g.lastScraped) : 'never',
    }));

    const recentStoriesList = recentPosts.map((p: any) => ({
      author: p.post.authorName || 'Unknown',
      text: (p.post.text || '').substring(0, 150),
      group: p.post.groupId,
      confidence: Math.round((p.confidence || 0) * 100),
      date: p.classifiedAt?.toLocaleDateString() || 'Unknown',
    }));

    const topQualityList = topQuality.map((p: any) => ({
      author: p.post.authorName || 'Unknown',
      text: (p.post.text || '').substring(0, 150),
      rating: p.rating,
      group: p.post.groupId,
    }));

    const errorList = recentErrors.map((e: any) => ({
      message: (e.message || '').substring(0, 200),
      time: e.createdAt.toLocaleString(),
    }));

    return JSON.stringify({
      currentTime: new Date().toLocaleString(),
      posts: {
        total: totalPosts,
        scrapedToday: todayPosts,
        classified: totalClassified,
        historic: totalHistoric,
        historicRate: `${historicRate}%`,
        pendingClassification,
      },
      messages: {
        total: totalMessages,
        sent: sentMessages,
        failed: failedMessages,
        pending: pendingMessages,
        sentToday: todayMessages,
      },
      quality: {
        averageRating: avgRating._avg.rating?.toFixed(1) || 'N/A',
      },
      session: {
        status: session?.status || 'unknown',
        lastChecked: session?.lastChecked?.toLocaleString() || 'N/A',
        userId: session?.userId || 'N/A',
      },
      health: {
        database: 'connected',
        facebookSession: session?.status === 'valid' ? 'active' : session?.status || 'unknown',
        openaiApi: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
        apifyToken: process.env.APIFY_TOKEN ? 'configured' : 'missing',
      },
      groups: groupList,
      recentHistoricStories: recentStoriesList,
      topQualityStories: topQualityList,
      recentErrors: errorList,
    }, null, 0);
  } catch (error) {
    logger.error(`[Telegram] Error gathering system context: ${error}`);
    return '{"error": "Failed to gather system data"}';
  }
};

/**
 * Build the system prompt for the AI
 */
const SYSTEM_PROMPT = `You are the Tarasa Historic Story Extractor bot assistant on Telegram. You are a friendly, helpful, and conversational AI assistant.

ABOUT THE SYSTEM:
Tarasa Historic Story Extractor is a system that:
1. Scrapes Israeli Facebook history groups for posts
2. Uses AI (OpenAI) to classify if posts contain historic stories
3. Rates story quality on a 1-5 star scale
4. Generates and sends messages to post authors inviting them to submit their stories to Tarasa.me (a platform preserving community history)
5. Detects duplicate stories to avoid repetition
6. Has a web dashboard for management

The system runs on Node.js with Express, uses PostgreSQL database, Prisma ORM, and has cron jobs for automated scraping, classification, messaging, quality rating, and duplicate detection.

YOUR BEHAVIOR:
- Be conversational and natural, like a real person chatting
- Keep responses concise since this is Telegram (not walls of text)
- Use emojis naturally but don't overdo it
- You can respond in English, Hebrew, or Arabic depending on what language the user writes in
- When sharing data, present it in a clear readable way
- If the user asks about something you don't have data for, say so honestly
- You have access to LIVE system data that gets refreshed with each message
- When sharing post text/stories, share meaningful previews
- Be proactive - if you notice something interesting in the data, mention it
- Anyone can chat with you - be welcoming to all users

FORMATTING:
- You're on Telegram with HTML parsing
- Use <b>bold</b> for emphasis, <i>italic</i> for quotes/previews
- Do NOT use Markdown - only HTML tags
- Keep messages under 4000 characters (Telegram limit)`;

/**
 * Process incoming message with AI
 */
export const processCommand = async (command: string, chatId?: string): Promise<string> => {
  const key = chatId || 'default';

  // /start is special - reset conversation and welcome
  if (command.trim().toLowerCase() === '/start') {
    conversationHistory.delete(key);
    return `Hey! 👋 I'm your Tarasa system assistant.

I can tell you anything about how the system is running - just ask me naturally, like you'd chat with a colleague.

Try asking me things like:
• "How are we doing today?"
• "Any new historic stories?"
• "Is everything running okay?"
• "כמה פוסטים נאספו היום?"

Or use commands like /status, /today, /groups, /search [text]`;
  }

  // Gather live data
  const systemData = await gatherSystemContext();

  // Get or create conversation history
  let history = conversationHistory.get(key) || [];

  // Add user message
  history.push({ role: 'user', content: command });

  // Trim history if too long
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nCURRENT LIVE SYSTEM DATA:\n${systemData}`,
        },
        ...history,
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I couldn\'t generate a response.';

    // Save assistant reply to history
    history.push({ role: 'assistant', content: reply });
    conversationHistory.set(key, history);

    return reply;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[Telegram] OpenAI error: ${errMsg}`);

    // Fallback to basic response if AI fails
    return `I'm having trouble connecting to my AI brain right now 😅\n\nYou can still use these commands:\n/status - System overview\n/today - Today's activity\n/groups - Groups list\n/health - Health check\n/help - All commands`;
  }
};

/**
 * Search posts by text
 */
const searchPosts = async (query: string): Promise<string> => {
  const posts = await prisma.postRaw.findMany({
    where: {
      text: { contains: query, mode: 'insensitive' },
    },
    include: {
      classified: { select: { isHistoric: true, confidence: true } },
    },
    orderBy: { scrapedAt: 'desc' },
    take: 5,
  });

  if (posts.length === 0) {
    return `No posts found matching "${escapeHtml(query)}".`;
  }

  const list = posts
    .map((p: any, i: number) => {
      const preview = (p.text || '').substring(0, 80).replace(/\n/g, ' ');
      const historic = p.classified?.isHistoric ? '📜' : '📝';
      return `${i + 1}. ${historic} <b>${escapeHtml(p.authorName || 'Unknown')}</b>\n   <i>${escapeHtml(preview)}${(p.text || '').length > 80 ? '...' : ''}</i>`;
    })
    .join('\n\n');

  return `<b>🔍 Search: "${escapeHtml(query)}"</b>\nFound ${posts.length} result(s)\n\n${list}`;
};

/**
 * Get start of today (midnight)
 */
const startOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/**
 * Human-readable time since a date
 */
const timeSince = (date: Date): string => {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

// ==========================================
// Telegram Bot Polling
// ==========================================

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastUpdateId = 0;

// Authenticated chat IDs (password-verified users)
const BOT_PASSWORD = process.env.TELEGRAM_BOT_PASSWORD || 'tshuka';
const authenticatedChats: Set<string> = new Set();

// Auto-authenticate the admin chat
if (TELEGRAM_CHAT_ID) {
  authenticatedChats.add(String(TELEGRAM_CHAT_ID));
}

/**
 * Start polling for incoming messages
 */
export const startTelegramPolling = (): void => {
  if (!isTelegramConfigured()) {
    logger.info('[Telegram] Bot not configured, skipping polling');
    return;
  }

  if (pollingInterval) {
    logger.warn('[Telegram] Polling already running');
    return;
  }

  logger.info('[Telegram] Starting bot polling...');

  // Poll every 2 seconds
  pollingInterval = setInterval(async () => {
    try {
      const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 1, // short poll timeout
          allowed_updates: JSON.stringify(['message']),
        },
        timeout: 5000,
      });

      if (!response.data.ok || !response.data.result.length) return;

      for (const update of response.data.result) {
        lastUpdateId = update.update_id;

        if (!update.message?.text) continue;

        const chatId = update.message.chat.id;
        const text = update.message.text;
        const chatIdStr = String(chatId);
        logger.debug(`[Telegram] Received from ${chatIdStr}: ${text}`);

        try {
          // Check if user is authenticated
          if (!authenticatedChats.has(chatIdStr)) {
            // Check if this message is the password
            if (text.trim().toLowerCase() === BOT_PASSWORD) {
              authenticatedChats.add(chatIdStr);
              logger.info(`[Telegram] Chat ${chatIdStr} authenticated`);
              await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
                chat_id: chatId,
                text: 'Access granted! 🔓\n\nWelcome to Tarasa Historic Story Extractor. You can now ask me anything about the system.\n\nTry /start to see what I can do.',
                parse_mode: 'HTML',
                reply_to_message_id: update.message.message_id,
              });
              continue;
            }

            // Not authenticated - ask for password
            await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
              chat_id: chatId,
              text: '🔒 This bot requires a password to access.\n\nPlease enter the password:',
              reply_to_message_id: update.message.message_id,
            });
            continue;
          }

          const reply = await processCommand(text, chatIdStr);
          await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: reply,
            parse_mode: 'HTML',
            reply_to_message_id: update.message.message_id,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Telegram] Error processing command: ${errMsg}`);
          await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: `Error processing your request: ${errMsg}`,
          }).catch(() => {});
        }
      }
    } catch (error) {
      // Silently ignore network errors to avoid log spam
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(`[Telegram] Polling error: ${msg}`);
    }
  }, 2000);
};

/**
 * Stop polling
 */
export const stopTelegramPolling = (): void => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('[Telegram] Bot polling stopped');
  }
};

/**
 * Escape HTML special characters for Telegram
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

export default {
  isTelegramConfigured,
  sendTelegramMessage,
  notifyHighQualityStory,
  sendSystemAlert,
  sendDailyStats,
  processCommand,
  startTelegramPolling,
  stopTelegramPolling,
};
