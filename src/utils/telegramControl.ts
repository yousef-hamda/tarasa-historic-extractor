/**
 * Telegram Control Catalog
 * ========================
 *
 * Turns the Telegram bot from a read-only AI chat into a full remote-control
 * panel. The operator opens a MAIN CATALOG (one button per subject), each
 * button opens a DETAIL menu for that subject, and from there they can run
 * almost everything the web dashboard exposes:
 *
 *   Status · Posts · Messages · Groups · Session · Run Now ·
 *   Settings · Prompts · Search · Logs · System/Debug · Backup · Danger Zone
 *
 * Design principles (so this can never damage the system):
 *   1. ACTIONS CALL THE SAME INTERNAL FUNCTIONS THE API ROUTES CALL. We never
 *      re-implement business logic — we reuse `scrapeAllGroups`, `classifyPosts`,
 *      `generateMessages`/`dispatchMessages`, `stealthRefreshFacebookSession`,
 *      the `settings.ts` helpers, `withLock`, etc. Behaviour cannot drift from
 *      the website.
 *   2. ALL MUTATING/TRIGGER ACTIONS ARE ADMIN-ONLY (the chat whose id equals
 *      TELEGRAM_CHAT_ID). Reads are available to any authenticated chat.
 *   3. DESTRUCTIVE ACTIONS REQUIRE AN EXPLICIT CONFIRM TAP (data reset needs
 *      two). No Facebook password or API key is ever typed into chat — renewal
 *      uses the server's env credentials.
 *   4. LONG JOBS RUN FIRE-AND-FORGET with a follow-up "finished/failed" message,
 *      so the poll loop is never blocked. Concurrency is gated by the same
 *      Redis `withLock` the crons use.
 *
 * Wiring: `src/utils/telegram.ts` owns the poll loop + password auth. It hands
 * callback queries and (some) text messages to the three entrypoints exported
 * at the bottom of this file.
 */

import axios from 'axios';
import prisma from '../database/prisma';
import logger from './logger';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : null;

// ===========================================================================
// Low-level Telegram API helpers (support inline keyboards + arbitrary chat,
// which the existing sendTelegramMessage does not).
// ===========================================================================

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type InlineKeyboard = InlineButton[][];

const MAX_TG_LEN = 3800; // Telegram hard limit is 4096; leave headroom.

const truncate = (text: string): string =>
  text.length > MAX_TG_LEN ? `${text.slice(0, MAX_TG_LEN)}\n…(truncated)` : text;

const callTelegram = async (method: string, payload: Record<string, unknown>): Promise<any> => {
  if (!TELEGRAM_API_URL) return null;
  try {
    const res = await axios.post(`${TELEGRAM_API_URL}/${method}`, payload, { timeout: 15_000 });
    return res.data;
  } catch (error) {
    const msg = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? error.message)
      : (error as Error).message;
    logger.warn(`[TelegramControl] ${method} failed: ${msg}`);
    return null;
  }
};

export const sendMessage = async (
  chatId: string | number,
  text: string,
  keyboard?: InlineKeyboard,
  replyTo?: number,
): Promise<void> => {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: truncate(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(replyTo ? { reply_to_message_id: replyTo } : {}),
  });
};

const editMessage = async (
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> => {
  const result = await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: truncate(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  // If the edit fails (e.g. "message is not modified", or the message is too
  // old to edit), fall back to a fresh message so the user still gets a reply.
  if (!result || result.ok === false) {
    await sendMessage(chatId, text, keyboard);
  }
};

const answerCallback = async (
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> => {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
};

// ===========================================================================
// HTML escaping + small formatters
// ===========================================================================

export const esc = (text: unknown): string =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const timeAgo = (date: Date | string | null | undefined): string => {
  if (!date) return 'never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const preview = (text: string | null | undefined, len = 90): string => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > len ? `${esc(t.slice(0, len))}…` : esc(t);
};

// ===========================================================================
// Callback-data codec.
//
// Telegram caps callback_data at 64 bytes, so keys are short. Format:
//   m:<menuKey>            -> open a menu
//   a:<actionKey>          -> run an action
//   a:<actionKey>~<arg>    -> run an action with a short argument
//   x:<actionKey>[~<arg>]  -> run a CONFIRMED action (passed the confirm gate)
//   noop                   -> do nothing (just answer the callback)
// `~` separates the arg because `:` is the kind separator.
// ===========================================================================

export type CbKind = 'm' | 'a' | 'x' | 'noop';
export interface ParsedCb {
  kind: CbKind;
  key: string;
  arg?: string;
}

export const buildCb = (kind: CbKind, key = '', arg?: string): string => {
  if (kind === 'noop') return 'noop';
  const base = `${kind}:${key}`;
  const out = arg !== undefined && arg !== '' ? `${base}~${arg}` : base;
  if (out.length > 64) {
    // Should never happen with our keys/args, but guard so Telegram doesn't 400.
    logger.warn(`[TelegramControl] callback_data too long (${out.length}): ${out}`);
  }
  return out;
};

export const parseCb = (data: string): ParsedCb => {
  if (!data || data === 'noop') return { kind: 'noop', key: '' };
  const colon = data.indexOf(':');
  if (colon === -1) return { kind: 'noop', key: '' };
  const kind = data.slice(0, colon) as CbKind;
  const rest = data.slice(colon + 1);
  const tilde = rest.indexOf('~');
  if (tilde === -1) return { kind, key: rest };
  return { kind, key: rest.slice(0, tilde), arg: rest.slice(tilde + 1) };
};

// Convenience button builders
const mBtn = (text: string, menuKey: string): InlineButton => ({ text, callback_data: buildCb('m', menuKey) });
const aBtn = (text: string, actionKey: string, arg?: string): InlineButton => ({
  text,
  callback_data: buildCb('a', actionKey, arg),
});
const urlBtn = (text: string, url: string): InlineButton => ({ text, url });

const NAV_HOME = mBtn('🏠 Main menu', 'main');

// ===========================================================================
// Menu catalog (the static tree). Live data is injected by `menuSummary`.
// ===========================================================================

interface MenuDef {
  title: string;
  rows: InlineButton[][];
}

export const MENUS: Record<string, MenuDef> = {
  main: {
    title: '🎛 <b>Tarasa Control Panel</b>\nChoose a section to manage the system.',
    rows: [
      [mBtn('📊 Status & Health', 'status'), mBtn('⚡ Run Now', 'run')],
      [mBtn('📰 Posts', 'posts'), mBtn('✉️ Messages', 'messages')],
      [mBtn('👥 Groups', 'groups'), mBtn('🔐 Session', 'session')],
      [mBtn('⚙️ Settings', 'settings'), mBtn('🧠 Prompts', 'prompts')],
      [mBtn('🔍 Search', 'search'), mBtn('📜 Logs', 'logs')],
      [mBtn('🛠 System / Debug', 'system'), mBtn('💾 Backup', 'backup')],
      [mBtn('⚠️ Danger Zone', 'danger')],
    ],
  },

  status: {
    title: '📊 <b>Status &amp; Health</b>',
    rows: [
      [aBtn('📋 Overview', 'status_overview'), aBtn('📈 7-day activity', 'status_activity')],
      [aBtn('🔄 Pipeline (running jobs)', 'status_pipeline')],
      [NAV_HOME],
    ],
  },

  posts: {
    title: '📰 <b>Posts</b>',
    rows: [
      [aBtn('🆕 Recent posts', 'posts_recent'), aBtn('📜 Historic posts', 'posts_historic')],
      [aBtn('🔢 Counts', 'posts_stats'), aBtn('🔎 Find by ID', 'posts_find')],
      [aBtn('📧 Email approved posts', 'posts_email')],
      [aBtn('🗑 Delete post by ID', 'posts_delete')],
      [NAV_HOME],
    ],
  },

  messages: {
    title: '✉️ <b>Messages</b>',
    rows: [
      [aBtn('📥 Queue', 'msg_queue'), aBtn('📤 Sent history', 'msg_sent')],
      [aBtn('📊 Stats', 'msg_stats')],
      [aBtn('▶️ Enable sending', 'msg_enable'), aBtn('⏸ Pause sending', 'msg_disable')],
      [NAV_HOME],
    ],
  },

  groups: {
    title: '👥 <b>Groups</b>',
    rows: [
      [aBtn('📋 List groups', 'groups_list')],
      [aBtn('➕ Add group', 'groups_add'), aBtn('➖ Remove group', 'groups_remove')],
      [aBtn('♻️ Reset one', 'groups_reset_one'), aBtn('♻️ Reset all', 'groups_reset_all')],
      [NAV_HOME],
    ],
  },

  session: {
    title: '🔐 <b>Facebook Session</b>',
    rows: [
      [aBtn('ℹ️ Status', 'session_status'), aBtn('🍪 Cookie health', 'session_cookie_health')],
      [aBtn('✅ Validate now', 'session_validate')],
      [aBtn('🔁 Renew (server login)', 'session_renew')],
      [aBtn('📥 Upload cookies', 'session_upload')],
      [NAV_HOME],
    ],
  },

  run: {
    title:
      '⚡ <b>Run Now</b> — trigger a pipeline stage immediately.\nJobs run in the background and report back when done.',
    rows: [
      [aBtn('🕷 Scrape', 'run_scrape'), aBtn('🧮 Classify', 'run_classify')],
      [aBtn('✉️ Generate + send messages', 'run_message')],
      [aBtn('⭐ Quality rating', 'run_quality'), aBtn('🔁 Duplicate scan', 'run_dupes')],
      [aBtn('🔐 Session check', 'run_session_check')],
      [aBtn('💾 Backup', 'run_backup'), aBtn('📑 Weekly report', 'run_report')],
      [NAV_HOME],
    ],
  },

  settings: {
    title: '⚙️ <b>Settings &amp; Tuning</b>',
    rows: [
      [aBtn('📋 Show settings', 'settings_show')],
      [mBtn('🎯 Threshold', 'settings_threshold'), mBtn('🚀 Speed', 'settings_speed')],
      [aBtn('📧 Set admin email', 'set_email')],
      [aBtn('▶️ Enable sending', 'msg_enable'), aBtn('⏸ Pause sending', 'msg_disable')],
      [NAV_HOME],
    ],
  },

  settings_threshold: {
    title:
      '🎯 <b>Historic confidence threshold</b>\nPosts must score <i>strictly greater</i> than this to count as historic. Range 50–100.',
    rows: [
      [
        aBtn('60', 'set_threshold', '60'),
        aBtn('70', 'set_threshold', '70'),
        aBtn('75', 'set_threshold', '75'),
      ],
      [
        aBtn('80', 'set_threshold', '80'),
        aBtn('85', 'set_threshold', '85'),
        aBtn('90', 'set_threshold', '90'),
      ],
      [aBtn('✏️ Custom value', 'set_threshold_custom')],
      [mBtn('⬅️ Back', 'settings'), NAV_HOME],
    ],
  },

  settings_speed: {
    title:
      '🚀 <b>System speed preset</b>\nControls the scrape / classify / message cron cadence.',
    rows: [
      [aBtn('🐢 Conservative', 'set_speed', 'conservative'), aBtn('⚖️ Normal', 'set_speed', 'normal')],
      [aBtn('🐇 Fast', 'set_speed', 'fast'), aBtn('🔥 Aggressive', 'set_speed', 'aggressive')],
      [mBtn('⬅️ Back', 'settings'), NAV_HOME],
    ],
  },

  prompts: {
    title: '🧠 <b>AI Prompts</b> — these drive production classification & outreach.',
    rows: [
      [aBtn('👁 Active classifier', 'prompt_show', 'classifier'), aBtn('👁 Active generator', 'prompt_show', 'generator')],
      [aBtn('🗂 Classifier versions', 'prompt_list', 'classifier'), aBtn('🗂 Generator versions', 'prompt_list', 'generator')],
      [aBtn('✅ Activate a version', 'prompt_activate')],
      [aBtn('🧪 Test active classifier', 'prompt_test')],
      [NAV_HOME],
    ],
  },

  search: {
    title: '🔍 <b>Search</b>',
    rows: [
      [aBtn('🔎 Search post text', 'search_text')],
      [aBtn('📜 Search historic only', 'search_historic')],
      [NAV_HOME],
    ],
  },

  logs: {
    title: '📜 <b>Logs</b>',
    rows: [
      [aBtn('🕑 Recent', 'logs_recent'), aBtn('🚨 Errors', 'logs_errors')],
      [
        aBtn('🕷 scrape', 'logs_type', 'scrape'),
        aBtn('🧮 classify', 'logs_type', 'classify'),
        aBtn('✉️ message', 'logs_type', 'message'),
      ],
      [aBtn('🔐 auth', 'logs_type', 'auth'), aBtn('🛠 admin', 'logs_type', 'admin')],
      [NAV_HOME],
    ],
  },

  system: {
    title: '🛠 <b>System / Debug</b>',
    rows: [
      [aBtn('❤️ Health', 'sys_health'), aBtn('🖥 Runtime', 'sys_debug')],
      [aBtn('🐞 Recent errors', 'sys_errors')],
      [aBtn('🩺 Run diagnostics', 'sys_diag'), aBtn('🔧 Self-healing', 'sys_heal')],
      [aBtn('🔌 Reset circuit breakers', 'sys_cb_reset')],
      [NAV_HOME],
    ],
  },

  backup: {
    title: '💾 <b>Backup</b>\nNote: backups live on the ephemeral container disk — they do not survive a redeploy.',
    rows: [
      [aBtn('📋 List', 'backup_list')],
      [aBtn('⚡ Quick backup', 'backup_quick'), aBtn('📦 Full backup', 'backup_create')],
      [aBtn('🧹 Cleanup old', 'backup_cleanup')],
      [NAV_HOME],
    ],
  },

  danger: {
    title:
      '⚠️ <b>Danger Zone</b>\nDestructive operations. Admin-only, each needs explicit confirmation.',
    rows: [
      [aBtn('🧽 Cleanup phantom posts', 'danger_cleanup')],
      [aBtn('💣 Reset ALL data', 'danger_reset')],
      [NAV_HOME],
    ],
  },
};

// ===========================================================================
// Action registry metadata (admin gating + confirm gating). The runners live
// in `runAction`. Keeping the metadata as data makes it unit-testable and lets
// us verify every menu button points at a real action.
// ===========================================================================

export interface ActionMeta {
  /** Requires the admin chat (TELEGRAM_CHAT_ID). Defaults true for safety. */
  admin: boolean;
  /** If set, tapping shows this confirmation text + an execute button first. */
  confirm?: string;
  /** Human label (for confirm screens / logs). */
  label: string;
}

export const ACTIONS: Record<string, ActionMeta> = {
  // --- Status (reads) ---
  status_overview: { admin: false, label: 'Overview' },
  status_activity: { admin: false, label: '7-day activity' },
  status_pipeline: { admin: false, label: 'Pipeline status' },

  // --- Posts ---
  posts_recent: { admin: false, label: 'Recent posts' },
  posts_historic: { admin: false, label: 'Historic posts' },
  posts_stats: { admin: false, label: 'Post counts' },
  posts_find: { admin: false, label: 'Find post by ID' },
  posts_email: { admin: true, confirm: 'Email all approved posts to the admin address?', label: 'Email approved posts' },
  posts_delete: { admin: true, label: 'Delete post by ID' },

  // --- Messages ---
  msg_queue: { admin: false, label: 'Message queue' },
  msg_sent: { admin: false, label: 'Sent history' },
  msg_stats: { admin: false, label: 'Message stats' },
  msg_enable: { admin: true, confirm: 'Enable outbound messaging? Real Messenger messages will start being sent to real people.', label: 'Enable messaging' },
  msg_disable: { admin: true, label: 'Pause messaging' },

  // --- Groups ---
  groups_list: { admin: false, label: 'List groups' },
  groups_add: { admin: true, label: 'Add group' },
  groups_remove: { admin: true, label: 'Remove group' },
  groups_reset_one: { admin: true, label: 'Reset one group' },
  groups_reset_all: { admin: true, confirm: 'Reset detection cache for ALL groups?', label: 'Reset all groups' },

  // --- Session ---
  session_status: { admin: false, label: 'Session status' },
  session_cookie_health: { admin: false, label: 'Cookie health' },
  session_validate: { admin: true, label: 'Validate session' },
  session_renew: { admin: true, label: 'Renew session' },
  session_upload: { admin: true, label: 'Upload cookies' },

  // --- Run now (all admin) ---
  run_scrape: { admin: true, label: 'Scrape now' },
  run_classify: { admin: true, label: 'Classify now' },
  run_message: { admin: true, confirm: 'Generate AND send outreach messages now? (Only sends if messaging is enabled.)', label: 'Message now' },
  run_quality: { admin: true, label: 'Quality rating now' },
  run_dupes: { admin: true, label: 'Duplicate scan now' },
  run_session_check: { admin: true, label: 'Session check now' },
  run_backup: { admin: true, label: 'Backup now' },
  run_report: { admin: true, label: 'Weekly report now' },

  // --- Settings ---
  settings_show: { admin: false, label: 'Show settings' },
  set_threshold: { admin: true, label: 'Set threshold' },
  set_threshold_custom: { admin: true, label: 'Set custom threshold' },
  set_speed: { admin: true, label: 'Set speed preset' },
  set_email: { admin: true, label: 'Set admin email' },

  // --- Prompts ---
  prompt_show: { admin: false, label: 'Show active prompt' },
  prompt_list: { admin: false, label: 'List prompt versions' },
  prompt_activate: { admin: true, label: 'Activate prompt version' },
  prompt_test: { admin: true, label: 'Test active classifier' },

  // --- Search (reads) ---
  search_text: { admin: false, label: 'Search post text' },
  search_historic: { admin: false, label: 'Search historic' },

  // --- Logs (reads) ---
  logs_recent: { admin: false, label: 'Recent logs' },
  logs_errors: { admin: false, label: 'Error logs' },
  logs_type: { admin: false, label: 'Logs by type' },

  // --- System / Debug ---
  sys_health: { admin: false, label: 'Health' },
  sys_debug: { admin: false, label: 'Runtime metrics' },
  sys_errors: { admin: false, label: 'Debug errors' },
  sys_diag: { admin: true, label: 'Run diagnostics' },
  sys_heal: { admin: true, label: 'Run self-healing' },
  sys_cb_reset: { admin: true, confirm: 'Reset all circuit breakers to CLOSED?', label: 'Reset circuit breakers' },

  // --- Backup ---
  backup_list: { admin: false, label: 'List backups' },
  backup_quick: { admin: true, label: 'Quick backup' },
  backup_create: { admin: true, label: 'Full backup' },
  backup_cleanup: { admin: true, confirm: 'Delete old backups per the retention policy?', label: 'Cleanup backups' },

  // --- Danger ---
  danger_cleanup: { admin: true, confirm: 'Delete every post the live filter would reject (phantoms)? This cascades to their classifications/messages.', label: 'Cleanup phantoms' },
  danger_reset: { admin: true, confirm: '⚠️ This DELETES ALL posts, classifications, messages and logs. There is no undo.', label: 'Reset all data' },
};

// ===========================================================================
// Pending text-input state. When an action needs free text (a group URL, an
// ID, a search query, a TOTP code, …) we stash a marker keyed by chat id and
// consume the user's next text message as the input. In-memory on purpose:
// it's transient UX state, not durable data.
// ===========================================================================

interface PendingInput {
  action: string;
  arg?: string;
  prompt: string;
}
const pendingInput = new Map<string, PendingInput>();

const setPending = (chatId: string, action: string, prompt: string, arg?: string): void => {
  pendingInput.set(chatId, { action, prompt, arg });
};

// ===========================================================================
// Action result + dispatch
// ===========================================================================

interface ActionResult {
  /** Text to show. */
  text: string;
  /** Optional keyboard; defaults to a Back-to-section + Main nav. */
  keyboard?: InlineKeyboard;
  /** Short toast shown on the tapped button. */
  toast?: string;
  /** If true, the result was already sent (handler did its own messaging). */
  handled?: boolean;
}

const backRow = (sectionMenuKey: string): InlineButton[] =>
  sectionMenuKey === 'main' ? [NAV_HOME] : [mBtn('⬅️ Back', sectionMenuKey), NAV_HOME];

/** Which menu each action "belongs" to, for the Back button after a read. */
export const ACTION_PARENT: Record<string, string> = {
  status_overview: 'status', status_activity: 'status', status_pipeline: 'status',
  posts_recent: 'posts', posts_historic: 'posts', posts_stats: 'posts', posts_find: 'posts',
  posts_email: 'posts', posts_delete: 'posts',
  msg_queue: 'messages', msg_sent: 'messages', msg_stats: 'messages', msg_enable: 'messages', msg_disable: 'messages',
  groups_list: 'groups', groups_add: 'groups', groups_remove: 'groups', groups_reset_one: 'groups', groups_reset_all: 'groups',
  session_status: 'session', session_cookie_health: 'session', session_validate: 'session', session_renew: 'session', session_upload: 'session',
  run_scrape: 'run', run_classify: 'run', run_message: 'run', run_quality: 'run', run_dupes: 'run',
  run_session_check: 'run', run_backup: 'run', run_report: 'run',
  settings_show: 'settings', set_threshold: 'settings_threshold', set_threshold_custom: 'settings_threshold',
  set_speed: 'settings_speed', set_email: 'settings',
  prompt_show: 'prompts', prompt_list: 'prompts', prompt_activate: 'prompts', prompt_test: 'prompts',
  search_text: 'search', search_historic: 'search',
  logs_recent: 'logs', logs_errors: 'logs', logs_type: 'logs',
  sys_health: 'system', sys_debug: 'system', sys_errors: 'system', sys_diag: 'system', sys_heal: 'system', sys_cb_reset: 'system',
  backup_list: 'backup', backup_quick: 'backup', backup_create: 'backup', backup_cleanup: 'backup',
  danger_cleanup: 'danger', danger_reset: 'danger',
};

const parentMenu = (actionKey: string): string => ACTION_PARENT[actionKey] ?? 'main';

/** Run a fire-and-forget background job and report completion to the chat. */
const spawnJob = (
  chatId: string,
  label: string,
  job: () => Promise<string>,
): void => {
  void (async () => {
    try {
      const summary = await job();
      await sendMessage(chatId, `✅ <b>${esc(label)}</b> finished.\n${summary}`, [backRow('main')]);
    } catch (error) {
      const msg = (error as Error).message || String(error);
      await sendMessage(chatId, `❌ <b>${esc(label)}</b> failed:\n<code>${esc(msg)}</code>`, [backRow('main')]);
    }
  })();
};

/** Wrap a lockable job: skip with a message if a cron/another trigger holds it. */
const runLockable = async (
  chatId: string,
  lockName: string,
  label: string,
  fn: () => Promise<void>,
  summarize: () => Promise<string>,
): Promise<ActionResult> => {
  const { isLocked } = await import('./cronLock');
  if (await isLocked(lockName)) {
    return { text: `⏳ <b>${esc(label)}</b> is already running (cron or another trigger). Try again shortly.` };
  }
  await sendMessage(chatId, `⏳ <b>${esc(label)}</b> started…`);
  spawnJob(chatId, label, async () => {
    const { withLock } = await import('./cronLock');
    await withLock(lockName, fn);
    return summarize();
  });
  return { handled: true, text: '' };
};

/** Side effects after a Facebook session is restored (mirror of routes/session.ts). */
const onSessionRestored = async (): Promise<void> => {
  try {
    const { reactivateAllGroups } = await import('../scraper/groupRegistry');
    await reactivateAllGroups();
  } catch (e) {
    logger.warn(`[TelegramControl] reactivateAllGroups failed: ${(e as Error).message}`);
  }
  void (async () => {
    try {
      const { isLocked, withLock } = await import('./cronLock');
      if (await isLocked('scrape')) return;
      const { scrapeAllGroups } = await import('../scraper/scrapeApifyToDb');
      await withLock('scrape', async () => {
        await scrapeAllGroups();
      });
    } catch (e) {
      logger.warn(`[TelegramControl] post-restore scrape failed: ${(e as Error).message}`);
    }
  })();
};

// ===========================================================================
// THE ACTION RUNNER
// ===========================================================================

const runAction = async (
  actionKey: string,
  arg: string | undefined,
  chatId: string,
): Promise<ActionResult> => {
  switch (actionKey) {
    // ---------------------------------------------------------------- STATUS
    case 'status_overview': {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [posts, todayPosts, historic, classified, queue, sentToday, sess] = await Promise.all([
        prisma.postRaw.count(),
        prisma.postRaw.count({ where: { scrapedAt: { gte: today } } }),
        prisma.postClassified.count({ where: { isHistoric: true } }),
        prisma.postClassified.count(),
        prisma.messageGenerated.count(),
        prisma.messageSent.count({ where: { status: 'sent', sentAt: { gte: today } } }),
        prisma.sessionState.findFirst({ orderBy: { lastChecked: 'desc' } }),
      ]);
      const { getMessagingEnabledAsync, getHistoricThreshold } = await import('./settings');
      const [messaging, threshold] = await Promise.all([getMessagingEnabledAsync(), getHistoricThreshold()]);
      const text =
        `📊 <b>System Overview</b>\n\n` +
        `<b>Posts</b>: ${posts.toLocaleString()} total · ${todayPosts} today\n` +
        `<b>Classified</b>: ${classified.toLocaleString()} · <b>Historic</b>: ${historic.toLocaleString()}\n` +
        `<b>Threshold</b>: &gt; ${threshold}\n\n` +
        `<b>Queue</b>: ${queue} pending · <b>Sent today</b>: ${sentToday}\n` +
        `<b>Messaging</b>: ${messaging ? '▶️ ENABLED' : '⏸ paused'}\n\n` +
        `<b>FB session</b>: ${esc(sess?.status ?? 'unknown')} (checked ${timeAgo(sess?.lastChecked)})`;
      return { text };
    }

    case 'status_activity': {
      const days = 7;
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
      const [posts, msgs] = await Promise.all([
        prisma.postRaw.findMany({ where: { scrapedAt: { gte: start } }, select: { scrapedAt: true } }),
        prisma.messageSent.findMany({ where: { status: 'sent', sentAt: { gte: start } }, select: { sentAt: true } }),
      ]);
      const bucket = (rows: { d: Date | null }[]): Record<string, number> => {
        const m: Record<string, number> = {};
        for (const r of rows) { if (!r.d) continue; const k = r.d.toISOString().slice(0, 10); m[k] = (m[k] ?? 0) + 1; }
        return m;
      };
      const pB = bucket(posts.map((p) => ({ d: p.scrapedAt })));
      const mB = bucket(msgs.map((m) => ({ d: m.sentAt })));
      const lines: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const k = d.toISOString().slice(0, 10);
        lines.push(`<code>${k}</code>  📰 ${pB[k] ?? 0}  ✉️ ${mB[k] ?? 0}`);
      }
      return { text: `📈 <b>Last ${days} days</b> (posts · messages sent)\n\n${lines.join('\n')}` };
    }

    case 'status_pipeline': {
      const { isLocked } = await import('./cronLock');
      const names = ['scrape', 'classify', 'message', 'session-check', 'quality-rating', 'duplicate-detection', 'backup'];
      const states = await Promise.all(names.map((n) => isLocked(n)));
      const { getActiveSchedules } = await import('../cron/scheduler');
      const sch = getActiveSchedules();
      const lines = names.map((n, i) => `${states[i] ? '🟢 running' : '⚪️ idle'}  ${n}`);
      const text =
        `🔄 <b>Pipeline</b>\n\n${lines.join('\n')}\n\n` +
        `<b>Speed preset</b>: ${esc(sch.preset ?? 'n/a')}\n` +
        `scrape <code>${esc(sch.schedules.scrape ?? '?')}</code> · classify <code>${esc(sch.schedules.classify ?? '?')}</code> · message <code>${esc(sch.schedules.message ?? '?')}</code>`;
      return { text };
    }

    // ---------------------------------------------------------------- POSTS
    case 'posts_recent':
    case 'posts_historic': {
      const where = actionKey === 'posts_historic' ? { classified: { isHistoric: true } } : {};
      const rows = await prisma.postRaw.findMany({
        where, orderBy: { scrapedAt: 'desc' }, take: 5, include: { classified: true },
      });
      if (!rows.length) return { text: 'No posts found.' };
      const list = rows.map((p) => {
        const badge = p.classified?.isHistoric ? '📜' : p.classified ? '📝' : '⏳';
        const conf = p.classified ? ` (${p.classified.confidence}%)` : '';
        return `${badge} <b>#${p.id}</b> ${esc(p.authorName || 'Unknown')}${conf}\n<i>${preview(p.text)}</i>`;
      }).join('\n\n');
      const title = actionKey === 'posts_historic' ? '📜 <b>Recent historic posts</b>' : '🆕 <b>Recent posts</b>';
      return { text: `${title}\n\n${list}` };
    }

    case 'posts_stats': {
      const { getHistoricThreshold } = await import('./settings');
      const threshold = await getHistoricThreshold();
      const [total, classified, historic, approved, withLink, unclassified] = await Promise.all([
        prisma.postRaw.count(),
        prisma.postClassified.count(),
        prisma.postClassified.count({ where: { isHistoric: true } }),
        prisma.postClassified.count({ where: { isHistoric: true, confidence: { gt: threshold } } }),
        prisma.postRaw.count({ where: { authorLink: { not: null } } }),
        prisma.postRaw.count({ where: { classified: null } }),
      ]);
      return {
        text:
          `🔢 <b>Post counts</b>\n\n` +
          `Total: ${total.toLocaleString()}\nClassified: ${classified.toLocaleString()}\n` +
          `Unclassified: ${unclassified.toLocaleString()}\nHistoric: ${historic.toLocaleString()}\n` +
          `Approved (&gt;${threshold}): ${approved.toLocaleString()}\nWith author link: ${withLink.toLocaleString()}`,
      };
    }

    case 'posts_find': {
      setPending(chatId, 'posts_find', 'Send me the post <b>ID</b> (a number).');
      return { text: '🔎 Send me the post <b>ID</b> (a number).', keyboard: [[mBtn('⬅️ Cancel', 'posts')]] };
    }

    case 'posts_delete': {
      setPending(chatId, 'posts_delete', 'Send the post <b>ID</b> to delete.');
      return { text: '🗑 Send the post <b>ID</b> to delete. You will be asked to confirm.', keyboard: [[mBtn('⬅️ Cancel', 'posts')]] };
    }

    case 'posts_email': {
      const { getAdminEmail } = await import('./settings');
      const email = await getAdminEmail();
      if (!email) return { text: '⚠️ No admin email is set. Use Settings → Set admin email first.' };
      await sendMessage(chatId, `📧 Emailing approved posts to <b>${esc(email)}</b>…`);
      spawnJob(chatId, 'Email approved posts', async () => {
        const { sendApprovedPostsEmail } = await import('./telegramActions');
        const r = await sendApprovedPostsEmail();
        return `Sent ${r.postsCount} posts to ${r.recipient}.`;
      });
      return { handled: true, text: '' };
    }

    // ---------------------------------------------------------------- MESSAGES
    case 'msg_queue': {
      const rows = await prisma.messageGenerated.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { post: true } });
      if (!rows.length) return { text: '📥 Queue is empty.' };
      const list = rows.map((m) => `<b>#${m.postId}</b> ${esc(m.post?.authorName || 'Unknown')}\n<i>${preview(m.messageText, 110)}</i>`).join('\n\n');
      return { text: `📥 <b>Message queue</b> (newest 5)\n\n${list}` };
    }

    case 'msg_sent': {
      const rows = await prisma.messageSent.findMany({ orderBy: { sentAt: 'desc' }, take: 5, include: { post: true } });
      if (!rows.length) return { text: '📤 No messages sent yet.' };
      const list = rows.map((m) => {
        const icon = m.status === 'sent' ? '✅' : m.status === 'error' ? '❌' : '⏳';
        return `${icon} <b>#${m.postId}</b> ${esc(m.post?.authorName || 'Unknown')} · ${timeAgo(m.sentAt)}${m.error ? `\n<code>${esc(m.error)}</code>` : ''}`;
      }).join('\n\n');
      return { text: `📤 <b>Sent history</b> (newest 5)\n\n${list}` };
    }

    case 'msg_stats': {
      const since = new Date(Date.now() - 86400_000);
      const [queue, sent, failed, pending, sent24] = await Promise.all([
        prisma.messageGenerated.count(),
        prisma.messageSent.count({ where: { status: 'sent' } }),
        prisma.messageSent.count({ where: { status: 'error' } }),
        prisma.messageSent.count({ where: { status: 'pending' } }),
        prisma.messageSent.count({ where: { status: 'sent', sentAt: { gte: since } } }),
      ]);
      const { getMessagingEnabledAsync } = await import('./settings');
      const enabled = await getMessagingEnabledAsync();
      return {
        text:
          `📊 <b>Message stats</b>\n\nQueue: ${queue}\nSent (total): ${sent}\nSent (24h): ${sent24}\n` +
          `Failed: ${failed}\nPending: ${pending}\n\nSending: ${enabled ? '▶️ ENABLED' : '⏸ paused'}`,
      };
    }

    case 'msg_enable':
    case 'msg_disable': {
      const enable = actionKey === 'msg_enable';
      const { setMessagingEnabled } = await import('./settings');
      await setMessagingEnabled(enable);
      const { logSystemEvent } = await import('./systemLog');
      await logSystemEvent('admin', `Messaging ${enable ? 'ENABLED' : 'paused'} via Telegram`).catch(() => {});
      return { text: enable ? '▶️ Messaging is now <b>ENABLED</b>. Outreach will be sent on the next cycle.' : '⏸ Messaging is now <b>paused</b>. Messages are queued, not sent.' };
    }

    // ---------------------------------------------------------------- GROUPS
    case 'groups_list': {
      const groups = await prisma.groupInfo.findMany({ where: { isEnabled: true }, orderBy: { groupName: 'asc' } });
      if (!groups.length) return { text: 'No enabled groups.' };
      const list = groups.map((g) => {
        const acc = g.isAccessible ? '🟢' : '🔴';
        return `${acc} <b>${esc(g.groupName || g.groupId)}</b>\n   id <code>${esc(g.groupId)}</code> · ${esc(g.groupType)} · scraped ${timeAgo(g.lastScraped)}${g.errorMessage ? `\n   ⚠️ ${esc(g.errorMessage)}` : ''}`;
      }).join('\n\n');
      return { text: `👥 <b>Groups</b> (${groups.length})\n\n${list}` };
    }

    case 'groups_add': {
      setPending(chatId, 'groups_add', 'Send the Facebook group <b>URL</b> or <b>ID</b>.');
      return { text: '➕ Send the Facebook group <b>URL</b> or <b>ID</b> to add.', keyboard: [[mBtn('⬅️ Cancel', 'groups')]] };
    }

    case 'groups_remove': {
      setPending(chatId, 'groups_remove', 'Send the group <b>ID</b> to remove (disable).');
      return { text: '➖ Send the group <b>ID</b> to remove (it is soft-disabled, history kept).', keyboard: [[mBtn('⬅️ Cancel', 'groups')]] };
    }

    case 'groups_reset_one': {
      setPending(chatId, 'groups_reset_one', 'Send the group <b>ID</b> to reset.');
      return { text: '♻️ Send the group <b>ID</b> whose detection cache to reset.', keyboard: [[mBtn('⬅️ Cancel', 'groups')]] };
    }

    case 'groups_reset_all': {
      const groups = await prisma.groupInfo.findMany({ where: { isEnabled: true }, select: { groupId: true } });
      for (const g of groups) {
        await prisma.groupInfo.update({
          where: { groupId: g.groupId },
          data: { groupType: 'unknown', accessMethod: 'none', isAccessible: true, errorMessage: null, lastChecked: new Date() },
        });
      }
      const { logSystemEvent } = await import('./systemLog');
      await logSystemEvent('scrape', `Reset detection cache for all ${groups.length} groups via Telegram`).catch(() => {});
      return { text: `♻️ Reset ${groups.length} groups. All marked accessible.` };
    }

    // ---------------------------------------------------------------- SESSION
    case 'session_status': {
      const { getSessionStatus } = await import('../session/sessionManager');
      const s = await getSessionStatus();
      return {
        text:
          `🔐 <b>Facebook session</b>\n\nStatus: <b>${esc(s.status)}</b>\nLogged in: ${s.loggedIn ? 'yes' : 'no'}\n` +
          `User: ${esc(s.userName || s.userId || 'n/a')}\nPrivate groups: ${s.canAccessPrivateGroups ? 'yes' : 'no'}\n` +
          `Checked: ${timeAgo(s.lastChecked)}${s.requiresAction ? '\n\n⚠️ <b>Needs attention</b> — try Renew or Upload cookies.' : ''}`,
      };
    }

    case 'session_cookie_health': {
      const { getCookieHealth } = await import('../facebook/session');
      const h = await getCookieHealth();
      return {
        text: `🍪 <b>Cookie health</b>\n\nValid session: ${h.ok ? '✅ yes' : '❌ no'}\nCookies: ${h.valid}/${h.total} valid\nUser id: ${esc(h.userId || 'n/a')}`,
      };
    }

    case 'session_validate': {
      await sendMessage(chatId, '✅ Validating session…');
      spawnJob(chatId, 'Session validation', async () => {
        const { withLock } = await import('./cronLock');
        let summary = 'done';
        await withLock('session-check', async () => {
          const { checkAndUpdateSession } = await import('../session/sessionManager');
          const r = await checkAndUpdateSession();
          summary = `Status: ${r.status}${r.userId ? ` · user ${r.userId}` : ''}`;
        });
        return summary;
      });
      return { handled: true, text: '' };
    }

    case 'session_renew': {
      await sendMessage(chatId, '🔁 Renewing Facebook session with server credentials… this can take ~30–60s.');
      void (async () => {
        try {
          const { stealthRefreshFacebookSession } = await import('../facebook/session');
          const r = await stealthRefreshFacebookSession();
          if (r.success) {
            await onSessionRestored();
            await sendMessage(chatId, `✅ Session renewed (user ${esc(r.userId || '?')}). Groups reconnected + scrape kicked.`, [backRow('session')]);
          } else if (r.challenge === '2fa') {
            setPending(chatId, 'session_renew_2fa', 'Send the 6-digit 2FA code from your authenticator app.');
            await sendMessage(chatId, '🔐 Facebook wants a 2FA code. Send the current 6-digit code from your authenticator app.', [[mBtn('⬅️ Cancel', 'session')]]);
          } else {
            await sendMessage(chatId, `❌ Renewal failed${r.challenge ? ` (${r.challenge})` : ''}: ${esc(r.error || 'unknown')}\n\nTry <b>Upload cookies</b> instead.`, [backRow('session')]);
          }
        } catch (e) {
          await sendMessage(chatId, `❌ Renewal error: <code>${esc((e as Error).message)}</code>`, [backRow('session')]);
        }
      })();
      return { handled: true, text: '' };
    }

    case 'session_upload': {
      setPending(chatId, 'session_upload', 'Paste your Cookie-Editor JSON export (the whole array).');
      return {
        text: '📥 Paste your <b>Cookie-Editor JSON export</b> (the whole array, or <code>{"cookies":[…]}</code>). It must contain <code>c_user</code> and <code>xs</code>.',
        keyboard: [[mBtn('⬅️ Cancel', 'session')]],
      };
    }

    // ---------------------------------------------------------------- RUN NOW
    case 'run_scrape':
      return runLockable(chatId, 'scrape', 'Scrape', async () => {
        const { scrapeAllGroups } = await import('../scraper/scrapeApifyToDb');
        await scrapeAllGroups();
      }, async () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const n = await prisma.postRaw.count({ where: { scrapedAt: { gte: today } } });
        return `Posts scraped today: ${n}.`;
      });

    case 'run_classify':
      return runLockable(chatId, 'classify', 'Classify', async () => {
        const { classifyPosts } = await import('../ai/classifier');
        await classifyPosts();
      }, async () => {
        const pending = await prisma.postRaw.count({ where: { classified: null } });
        return `Remaining unclassified: ${pending}.`;
      });

    case 'run_message':
      return runLockable(chatId, 'message', 'Generate + send messages', async () => {
        const { generateMessages } = await import('../ai/generator');
        const { dispatchMessages } = await import('../messenger/messenger');
        await generateMessages();
        await dispatchMessages();
      }, async () => {
        const since = new Date(Date.now() - 3600_000);
        const n = await prisma.messageSent.count({ where: { status: 'sent', sentAt: { gte: since } } });
        return `Messages sent in the last hour: ${n}.`;
      });

    case 'run_quality': {
      await sendMessage(chatId, '⭐ Quality rating started…');
      spawnJob(chatId, 'Quality rating', async () => {
        const { rateQuality } = await import('../cron/quality-rating-cron');
        await rateQuality();
        return 'Done.';
      });
      return { handled: true, text: '' };
    }

    case 'run_dupes': {
      await sendMessage(chatId, '🔁 Duplicate scan started…');
      spawnJob(chatId, 'Duplicate scan', async () => {
        const { detectDuplicates } = await import('../cron/duplicate-detection-cron');
        await detectDuplicates();
        return 'Done.';
      });
      return { handled: true, text: '' };
    }

    case 'run_session_check':
      return runAction('session_validate', undefined, chatId);

    case 'run_backup':
    case 'backup_quick': {
      await sendMessage(chatId, '💾 Backup started…');
      spawnJob(chatId, 'Backup', async () => {
        const { triggerBackup } = await import('../cron/backup-cron');
        await triggerBackup();
        return 'Backup created.';
      });
      return { handled: true, text: '' };
    }

    case 'run_report': {
      await sendMessage(chatId, '📑 Generating weekly report…');
      spawnJob(chatId, 'Weekly report', async () => {
        const { generateWeeklyReport } = await import('../cron/report-cron');
        await generateWeeklyReport();
        return 'Report generated and delivered.';
      });
      return { handled: true, text: '' };
    }

    // ---------------------------------------------------------------- SETTINGS
    case 'settings_show': {
      const { getHistoricThreshold, getSpeedPreset, getMessagingEnabledAsync, getAdminEmail } = await import('./settings');
      const [th, sp, msg, email] = await Promise.all([
        getHistoricThreshold(), getSpeedPreset(), getMessagingEnabledAsync(), getAdminEmail(),
      ]);
      return {
        text:
          `⚙️ <b>Settings</b>\n\nThreshold: &gt; ${th}\nSpeed preset: ${esc(sp)}\n` +
          `Messaging: ${msg ? '▶️ enabled' : '⏸ paused'}\nAdmin email: ${esc(email || '(not set)')}`,
      };
    }

    case 'set_threshold': {
      const value = Number(arg);
      const { setHistoricThreshold } = await import('./settings');
      const clamped = await setHistoricThreshold(value);
      return { text: `🎯 Historic threshold set to <b>&gt; ${clamped}</b>.`, toast: `Threshold = ${clamped}` };
    }

    case 'set_threshold_custom': {
      setPending(chatId, 'set_threshold_custom', 'Send a number between 50 and 100.');
      return { text: '✏️ Send a threshold value between <b>50</b> and <b>100</b>.', keyboard: [[mBtn('⬅️ Cancel', 'settings_threshold')]] };
    }

    case 'set_speed': {
      const { isSpeedPreset, setSpeedPreset, SPEED_PRESETS } = await import('./settings');
      if (!isSpeedPreset(arg)) return { text: '⚠️ Unknown preset.' };
      await setSpeedPreset(arg);
      const { applySpeedPreset } = await import('../cron/scheduler');
      await applySpeedPreset(arg);
      const def = SPEED_PRESETS[arg];
      const warn = def.danger ? `\n\n🔥 ${esc(def.danger)}` : def.warning ? `\n\n⚠️ ${esc(def.warning)}` : '';
      return {
        text: `🚀 Speed preset set to <b>${esc(def.label)}</b>.\nscrape <code>${def.schedules.scrape}</code> · classify <code>${def.schedules.classify}</code> · message <code>${def.schedules.message}</code>${warn}`,
        toast: `Speed = ${def.label}`,
      };
    }

    case 'set_email': {
      setPending(chatId, 'set_email', 'Send the admin email address (or "clear" to unset).');
      return { text: '📧 Send the admin email address (or type <b>clear</b> to unset).', keyboard: [[mBtn('⬅️ Cancel', 'settings')]] };
    }

    // ---------------------------------------------------------------- PROMPTS
    case 'prompt_show': {
      const type = arg === 'generator' ? 'generator' : 'classifier';
      const { getActivePrompt } = await import('../ai/promptStore');
      const content = await getActivePrompt(type);
      const active = await prisma.promptTemplate.findFirst({ where: { type, isActive: true } });
      const head = active ? `<b>${esc(active.name)}</b> (v${active.version})` : '<i>built-in default</i>';
      return { text: `🧠 <b>Active ${type}</b>: ${head}\n\n<code>${esc(content.slice(0, 3200))}</code>` };
    }

    case 'prompt_list': {
      const type = arg === 'generator' ? 'generator' : 'classifier';
      const rows = await prisma.promptTemplate.findMany({ where: { type }, orderBy: { version: 'desc' }, take: 10 });
      if (!rows.length) return { text: `No saved ${type} versions (using built-in default).` };
      const list = rows.map((p) => `${p.isActive ? '✅' : '▫️'} <b>id ${p.id}</b> · ${esc(p.name)} (v${p.version}) · ${timeAgo(p.createdAt)}`).join('\n');
      return { text: `🗂 <b>${type} versions</b>\n\n${list}\n\nUse <b>Activate a version</b> and send an id.` };
    }

    case 'prompt_activate': {
      setPending(chatId, 'prompt_activate', 'Send the prompt version <b>id</b> to activate.');
      return { text: '✅ Send the prompt version <b>id</b> to activate (see the version lists).', keyboard: [[mBtn('⬅️ Cancel', 'prompts')]] };
    }

    case 'prompt_test': {
      setPending(chatId, 'prompt_test', 'Send a sample post text to test the active classifier on.');
      return { text: '🧪 Send a <b>sample post text</b>; I will run the active classifier prompt on it.', keyboard: [[mBtn('⬅️ Cancel', 'prompts')]] };
    }

    // ---------------------------------------------------------------- SEARCH
    case 'search_text': {
      setPending(chatId, 'search_text', 'Send the text to search for.');
      return { text: '🔎 Send the text to search posts for.', keyboard: [[mBtn('⬅️ Cancel', 'search')]] };
    }
    case 'search_historic': {
      setPending(chatId, 'search_historic', 'Send the text to search (historic posts only).');
      return { text: '📜 Send the text to search (historic posts only).', keyboard: [[mBtn('⬅️ Cancel', 'search')]] };
    }

    // ---------------------------------------------------------------- LOGS
    case 'logs_recent':
    case 'logs_errors':
    case 'logs_type': {
      const type = actionKey === 'logs_errors' ? 'error' : actionKey === 'logs_type' ? arg : undefined;
      const rows = await prisma.systemLog.findMany({
        where: type ? { type: type as any } : {}, orderBy: { createdAt: 'desc' }, take: 8,
      });
      if (!rows.length) return { text: 'No logs.' };
      const list = rows.map((l) => `<code>${esc(l.type)}</code> ${timeAgo(l.createdAt)}\n${preview(l.message, 140)}`).join('\n\n');
      const title = type ? `📜 <b>Logs · ${esc(type)}</b>` : '📜 <b>Recent logs</b>';
      return { text: `${title}\n\n${list}` };
    }

    // ---------------------------------------------------------------- SYSTEM
    case 'sys_health': {
      const [db, sess] = await Promise.all([
        prisma.postRaw.count().then(() => true).catch(() => false),
        prisma.sessionState.findFirst({ orderBy: { lastChecked: 'desc' } }),
      ]);
      const up = Math.floor(process.uptime());
      return {
        text:
          `❤️ <b>Health</b>\n\nDatabase: ${db ? '✅' : '❌'}\nOpenAI key: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}\n` +
          `FB session: ${sess?.status === 'valid' ? '✅ valid' : `⚠️ ${esc(sess?.status ?? 'unknown')}`}\n` +
          `Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`,
      };
    }

    case 'sys_debug': {
      const mem = process.memoryUsage();
      const mb = (n: number): string => `${Math.round(n / 1048576)}MB`;
      const up = Math.floor(process.uptime());
      return {
        text:
          `🖥 <b>Runtime</b>\n\nRSS: ${mb(mem.rss)}\nHeap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)}\n` +
          `Node: ${esc(process.version)}\nUptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`,
      };
    }

    case 'sys_errors': {
      const rows = await prisma.systemLog.findMany({ where: { type: 'error' }, orderBy: { createdAt: 'desc' }, take: 5 });
      if (!rows.length) return { text: '✅ No recent errors.' };
      return { text: `🐞 <b>Recent errors</b>\n\n${rows.map((e) => `${timeAgo(e.createdAt)}\n${preview(e.message, 160)}`).join('\n\n')}` };
    }

    case 'sys_diag': {
      await sendMessage(chatId, '🩺 Running diagnostics…');
      spawnJob(chatId, 'Diagnostics', async () => {
        const { runDiagnostics } = await import('./telegramActions');
        return runDiagnostics();
      });
      return { handled: true, text: '' };
    }

    case 'sys_heal': {
      await sendMessage(chatId, '🔧 Running self-healing checks…');
      spawnJob(chatId, 'Self-healing', async () => {
        const { runHealing } = await import('./telegramActions');
        return runHealing();
      });
      return { handled: true, text: '' };
    }

    case 'sys_cb_reset': {
      const { resetAllCircuitBreakers, getCircuitBreakerStatus } = await import('./circuitBreaker');
      resetAllCircuitBreakers();
      const s = getCircuitBreakerStatus();
      return { text: `🔌 Circuit breakers reset.\nApify: ${esc(s.apify.state)} · OpenAI: ${esc(s.openai.state)}` };
    }

    // ---------------------------------------------------------------- BACKUP
    case 'backup_list': {
      const { listBackups } = await import('./telegramActions');
      const r = await listBackups();
      if (!r.count) return { text: '💾 No backups found.' };
      return {
        text: `💾 <b>Backups</b> (${r.count})\n\n${r.items.map((b) => `<code>${esc(b.id)}</code> · ${esc(b.type)} · ${timeAgo(b.createdAt)}`).join('\n')}`,
      };
    }

    case 'backup_create': {
      await sendMessage(chatId, '📦 Full backup started…');
      spawnJob(chatId, 'Full backup', async () => {
        const { triggerBackup } = await import('../cron/backup-cron');
        await triggerBackup();
        return 'Backup created.';
      });
      return { handled: true, text: '' };
    }

    case 'backup_cleanup': {
      const { cleanupBackups } = await import('./telegramActions');
      const deleted = await cleanupBackups();
      return { text: `🧹 Cleanup done. Removed ${deleted} old backup(s).` };
    }

    // ---------------------------------------------------------------- DANGER
    case 'danger_cleanup': {
      await sendMessage(chatId, '🧽 Cleaning up phantom posts…');
      spawnJob(chatId, 'Phantom cleanup', async () => {
        const { cleanupPhantomPosts } = await import('./telegramActions');
        const r = await cleanupPhantomPosts();
        return `Deleted ${r.deleted} phantom posts.`;
      });
      return { handled: true, text: '' };
    }

    case 'danger_reset': {
      // Second confirm — make the operator type the phrase.
      setPending(chatId, 'danger_reset_confirm', 'Type exactly: DELETE ALL DATA');
      return {
        text: '💣 To wipe ALL data, type exactly:\n\n<code>DELETE ALL DATA</code>\n\nThere is no undo.',
        keyboard: [[mBtn('⬅️ Cancel', 'danger')]],
      };
    }

    default:
      return { text: `Unknown action: <code>${esc(actionKey)}</code>` };
  }
};

// ===========================================================================
// Pending text-input handlers
// ===========================================================================

const handlePendingInput = async (chatId: string, text: string, pending: PendingInput): Promise<void> => {
  const value = text.trim();
  const reply = (msg: string, kb?: InlineKeyboard): Promise<void> => sendMessage(chatId, msg, kb ?? [backRow('main')]);

  switch (pending.action) {
    case 'posts_find': {
      const id = parseInt(value, 10);
      if (!Number.isFinite(id) || id <= 0) return reply('⚠️ That is not a valid id. Open Posts → Find by ID again.');
      const post = await prisma.postRaw.findUnique({ where: { id }, include: { classified: true, quality: true } });
      if (!post) return reply(`No post with id ${id}.`);
      const c = post.classified;
      return reply(
        `📰 <b>Post #${post.id}</b>\nAuthor: ${esc(post.authorName || 'Unknown')}\nGroup: <code>${esc(post.groupId)}</code>\n` +
        `Scraped: ${timeAgo(post.scrapedAt)}\n` +
        `${c ? `Classified: ${c.isHistoric ? '📜 historic' : '📝 not historic'} (${c.confidence}%)\nReason: ${esc(c.reason)}` : 'Not classified yet'}\n` +
        `${post.quality ? `Quality: ${'⭐'.repeat(post.quality.rating)}` : ''}\n\n<i>${preview(post.text, 600)}</i>`,
        [backRow('posts')],
      );
    }

    case 'posts_delete': {
      const id = parseInt(value, 10);
      if (!Number.isFinite(id) || id <= 0) return reply('⚠️ Not a valid id.');
      const post = await prisma.postRaw.findUnique({ where: { id } });
      if (!post) return reply(`No post with id ${id}.`);
      // confirm before delete
      return reply(
        `🗑 Delete <b>post #${id}</b> by ${esc(post.authorName || 'no-author')}? This cascades to its messages/classification.`,
        [[{ text: '✅ Yes, delete', callback_data: buildCb('x', 'posts_delete', String(id)) }], [mBtn('⬅️ Cancel', 'posts')]],
      );
    }

    case 'groups_add': {
      const id = extractGroupId(value);
      if (!id || !/^[a-zA-Z0-9._-]{1,100}$/.test(id)) return reply('⚠️ Could not parse a valid group id/URL.');
      const existing = await prisma.groupInfo.findUnique({ where: { groupId: id } });
      if (existing?.isEnabled) return reply(`Group <code>${esc(id)}</code> is already active.`, [backRow('groups')]);
      await prisma.groupInfo.upsert({
        where: { groupId: id },
        update: { isEnabled: true, lastChecked: new Date() },
        create: { groupId: id, isEnabled: true, groupType: 'unknown', accessMethod: 'none', isAccessible: true },
      });
      const { logSystemEvent } = await import('./systemLog');
      await logSystemEvent('scrape', `Added group ${id} via Telegram`).catch(() => {});
      return reply(`✅ Added group <code>${esc(id)}</code>.`, [backRow('groups')]);
    }

    case 'groups_remove': {
      const id = extractGroupId(value);
      const existing = id ? await prisma.groupInfo.findUnique({ where: { groupId: id } }) : null;
      if (!existing || !existing.isEnabled) return reply(`Group <code>${esc(id || value)}</code> is not active.`, [backRow('groups')]);
      await prisma.groupInfo.update({ where: { groupId: id! }, data: { isEnabled: false } });
      const { logSystemEvent } = await import('./systemLog');
      await logSystemEvent('scrape', `Disabled group ${id} via Telegram`).catch(() => {});
      return reply(`✅ Disabled group <code>${esc(id!)}</code>.`, [backRow('groups')]);
    }

    case 'groups_reset_one': {
      const id = extractGroupId(value);
      const existing = id ? await prisma.groupInfo.findUnique({ where: { groupId: id } }) : null;
      if (!existing) return reply(`No group <code>${esc(id || value)}</code>.`, [backRow('groups')]);
      await prisma.groupInfo.update({
        where: { groupId: id! },
        data: { groupType: 'unknown', accessMethod: 'none', isAccessible: true, errorMessage: null, lastChecked: new Date() },
      });
      return reply(`♻️ Reset group <code>${esc(id!)}</code>.`, [backRow('groups')]);
    }

    case 'set_threshold_custom': {
      const n = Number(value);
      if (!Number.isFinite(n)) return reply('⚠️ Not a number.');
      const { setHistoricThreshold } = await import('./settings');
      const clamped = await setHistoricThreshold(n);
      return reply(`🎯 Threshold set to <b>&gt; ${clamped}</b>.`, [backRow('settings')]);
    }

    case 'set_email': {
      try {
        const { setAdminEmail } = await import('./settings');
        const saved = await setAdminEmail(value.toLowerCase() === 'clear' ? '' : value);
        return reply(saved ? `📧 Admin email set to <b>${esc(saved)}</b>.` : '📧 Admin email cleared.', [backRow('settings')]);
      } catch (e) {
        return reply(`⚠️ ${esc((e as Error).message)}`, [backRow('settings')]);
      }
    }

    case 'prompt_activate': {
      const id = parseInt(value, 10);
      if (!Number.isFinite(id)) return reply('⚠️ Not a valid id.');
      const target = await prisma.promptTemplate.findUnique({ where: { id } });
      if (!target) return reply(`No prompt version id ${id}.`, [backRow('prompts')]);
      await prisma.promptTemplate.updateMany({ where: { type: target.type, isActive: true }, data: { isActive: false } });
      await prisma.promptTemplate.update({ where: { id }, data: { isActive: true } });
      const { logSystemEvent } = await import('./systemLog');
      await logSystemEvent('admin', `Activated ${target.type} prompt v${target.version} (id ${id}) via Telegram`).catch(() => {});
      return reply(`✅ Activated <b>${esc(target.name)}</b> (v${target.version}) for <b>${target.type}</b>. Live on the next cron tick.`, [backRow('prompts')]);
    }

    case 'prompt_test': {
      await reply('🧪 Testing… one moment.');
      try {
        const { getActivePrompt } = await import('../ai/promptStore');
        const content = await getActivePrompt('classifier');
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content },
            { role: 'user', content: `Post by Unknown:\n${value}` },
          ],
          max_tokens: 300, temperature: 0,
        });
        const out = completion.choices[0]?.message?.content || '(no output)';
        return reply(`🧪 <b>Classifier output</b>\n\n<code>${esc(out.slice(0, 3000))}</code>`, [backRow('prompts')]);
      } catch (e) {
        return reply(`⚠️ Test failed: ${esc((e as Error).message)}`, [backRow('prompts')]);
      }
    }

    case 'search_text':
    case 'search_historic': {
      const where: any = { text: { contains: value, mode: 'insensitive' } };
      if (pending.action === 'search_historic') where.classified = { isHistoric: true };
      const rows = await prisma.postRaw.findMany({ where, orderBy: { scrapedAt: 'desc' }, take: 6, include: { classified: true } });
      if (!rows.length) return reply(`No results for “${esc(value)}”.`, [backRow('search')]);
      const list = rows.map((p) => {
        const badge = p.classified?.isHistoric ? '📜' : '📝';
        return `${badge} <b>#${p.id}</b> ${esc(p.authorName || 'Unknown')}\n<i>${preview(p.text, 100)}</i>`;
      }).join('\n\n');
      return reply(`🔍 <b>“${esc(value)}”</b> — ${rows.length} result(s)\n\n${list}`, [backRow('search')]);
    }

    case 'session_renew_2fa': {
      const code = value.replace(/\s+/g, '');
      if (!/^\d{6,8}$/.test(code)) return reply('⚠️ That is not a 6-digit code. Try Renew again.', [backRow('session')]);
      await reply('🔐 Submitting 2FA code…');
      try {
        const { stealthRefreshFacebookSession } = await import('../facebook/session');
        const r = await stealthRefreshFacebookSession({ totpCode: code });
        if (r.success) {
          await onSessionRestored();
          return reply(`✅ Session renewed (user ${esc(r.userId || '?')}).`, [backRow('session')]);
        }
        return reply(`❌ Still failing: ${esc(r.error || 'unknown')}\nTry <b>Upload cookies</b>.`, [backRow('session')]);
      } catch (e) {
        return reply(`❌ Error: ${esc((e as Error).message)}`, [backRow('session')]);
      }
    }

    case 'session_upload': {
      try {
        // The upload-cookies endpoint itself runs the reactivate-groups +
        // kick-scrape side effects, so we don't call onSessionRestored again.
        const { uploadCookiesFromJson } = await import('./telegramActions');
        const r = await uploadCookiesFromJson(value);
        return reply(`✅ Cookies saved (${r.cookieCount}) for user ${esc(r.userId)}. Session is valid; groups reconnected.`, [backRow('session')]);
      } catch (e) {
        return reply(`⚠️ ${esc((e as Error).message)}`, [backRow('session')]);
      }
    }

    case 'danger_reset_confirm': {
      if (value !== 'DELETE ALL DATA') return reply('Cancelled — phrase did not match.', [backRow('danger')]);
      await reply('💣 Wiping all data…');
      const { resetAllData } = await import('./telegramActions');
      const r = await resetAllData();
      return reply(`✅ Done. Deleted: ${esc(JSON.stringify(r))}`, [backRow('main')]);
    }

    default:
      return reply('That input is no longer expected. Open /menu to start again.');
  }
};

const extractGroupId = (input: string): string | null => {
  const patterns = [/facebook\.com\/groups\/(\d+)/, /facebook\.com\/groups\/([a-zA-Z0-9._-]+)/, /fb\.com\/groups\/([a-zA-Z0-9._-]+)/];
  for (const p of patterns) { const m = input.match(p); if (m) return m[1]; }
  const trimmed = input.trim();
  return /^[a-zA-Z0-9._-]{1,100}$/.test(trimmed) ? trimmed : null;
};

// ===========================================================================
// Render a menu (with live summary where useful)
// ===========================================================================

const menuSummary = async (menuKey: string): Promise<string> => {
  try {
    if (menuKey === 'main') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [posts, sess] = await Promise.all([
        prisma.postRaw.count({ where: { scrapedAt: { gte: today } } }),
        prisma.sessionState.findFirst({ orderBy: { lastChecked: 'desc' } }),
      ]);
      const sIcon = sess?.status === 'valid' ? '✅' : '⚠️';
      return `\n\n${sIcon} session: ${esc(sess?.status ?? 'unknown')} · 📰 ${posts} posts today`;
    }
    if (menuKey === 'settings') {
      const { getHistoricThreshold, getSpeedPreset, getMessagingEnabledAsync } = await import('./settings');
      const [th, sp, msg] = await Promise.all([getHistoricThreshold(), getSpeedPreset(), getMessagingEnabledAsync()]);
      return `\n\nthreshold &gt; ${th} · speed ${esc(sp)} · messaging ${msg ? 'on' : 'off'}`;
    }
    if (menuKey === 'messages') {
      const { getMessagingEnabledAsync } = await import('./settings');
      const [q, enabled] = await Promise.all([prisma.messageGenerated.count(), getMessagingEnabledAsync()]);
      return `\n\nqueue ${q} · sending ${enabled ? 'ON' : 'paused'}`;
    }
    if (menuKey === 'session') {
      const s = await prisma.sessionState.findFirst({ orderBy: { lastChecked: 'desc' } });
      return `\n\nstatus: ${esc(s?.status ?? 'unknown')} (${timeAgo(s?.lastChecked)})`;
    }
  } catch { /* summaries are best-effort */ }
  return '';
};

const renderMenu = async (menuKey: string): Promise<{ text: string; keyboard: InlineKeyboard }> => {
  const def = MENUS[menuKey] ?? MENUS.main;
  const summary = await menuSummary(menuKey);
  return { text: `${def.title}${summary}`, keyboard: def.rows };
};

// ===========================================================================
// PUBLIC ENTRYPOINTS (called by telegram.ts)
// ===========================================================================

/** Is this chat the privileged admin chat? */
export const isAdminChat = (chatId: string | number): boolean =>
  ADMIN_CHAT_ID !== null && String(chatId) === ADMIN_CHAT_ID;

/** Send the main catalog to a chat (used by /menu and the welcome). */
export const sendMainMenu = async (chatId: string | number, replyTo?: number): Promise<void> => {
  const { text, keyboard } = await renderMenu('main');
  await sendMessage(chatId, text, keyboard, replyTo);
};

/**
 * Handle an inline-button tap. `isAdmin` is computed by the caller from the
 * chat id so this module doesn't need the auth set.
 */
export const handleControlCallback = async (cbq: any, isAdmin: boolean): Promise<void> => {
  const chatId = String(cbq.message?.chat?.id ?? cbq.from?.id);
  const messageId = cbq.message?.message_id as number | undefined;
  const data = String(cbq.data ?? '');
  const parsed = parseCb(data);

  try {
    if (parsed.kind === 'noop') {
      await answerCallback(cbq.id);
      return;
    }

    if (parsed.kind === 'm') {
      await answerCallback(cbq.id);
      const { text, keyboard } = await renderMenu(parsed.key);
      if (messageId) await editMessage(chatId, messageId, text, keyboard);
      else await sendMessage(chatId, text, keyboard);
      return;
    }

    // Action (a:) or confirmed action (x:)
    const meta = ACTIONS[parsed.key];
    if (!meta) {
      await answerCallback(cbq.id, 'Unknown action');
      return;
    }

    if (meta.admin && !isAdmin) {
      await answerCallback(cbq.id, '🔒 Admin only', true);
      await sendMessage(chatId, '🔒 That action is restricted to the admin chat.');
      return;
    }

    // Confirm gate: an `a:` tap on a confirm action shows the confirm screen.
    if (parsed.kind === 'a' && meta.confirm) {
      await answerCallback(cbq.id);
      const kb: InlineKeyboard = [
        [{ text: '✅ Confirm', callback_data: buildCb('x', parsed.key, parsed.arg) }],
        [mBtn('⬅️ Cancel', parentMenu(parsed.key))],
      ];
      if (messageId) await editMessage(chatId, messageId, `❓ ${esc(meta.confirm)}`, kb);
      else await sendMessage(chatId, `❓ ${esc(meta.confirm)}`, kb);
      return;
    }

    // Execute (either a non-confirm `a:` or a confirmed `x:`). Answer the
    // callback exactly once (with an optional toast) so Telegram clears the
    // button's loading spinner.
    const result = await runAction(parsed.key, parsed.arg, chatId);
    await answerCallback(cbq.id, result.toast);
    if (result.handled) return; // handler already messaged the user

    const keyboard = result.keyboard ?? [backRow(parentMenu(parsed.key))];
    if (messageId) await editMessage(chatId, messageId, result.text, keyboard);
    else await sendMessage(chatId, result.text, keyboard);
  } catch (error) {
    logger.error(`[TelegramControl] callback error: ${(error as Error).message}`);
    await answerCallback(cbq.id, 'Something went wrong').catch(() => undefined);
    await sendMessage(chatId, `❌ Error: <code>${esc((error as Error).message)}</code>`).catch(() => undefined);
  }
};

/**
 * Give the control layer first refusal on a text message. Returns true if it
 * consumed the message (pending input, or a control command like /menu), so
 * the caller can skip the AI chat fallback.
 */
export const tryHandleControlMessage = async (
  chatId: string,
  text: string,
  isAdmin: boolean,
  messageId?: number,
): Promise<boolean> => {
  const trimmed = text.trim();

  // /cancel clears any pending input
  if (/^\/cancel\b/i.test(trimmed)) {
    pendingInput.delete(chatId);
    await sendMessage(chatId, 'Cancelled.', [backRow('main')]);
    return true;
  }

  // Pending input takes precedence over everything else.
  const pending = pendingInput.get(chatId);
  if (pending) {
    pendingInput.delete(chatId);
    // Re-check admin gating for the pending action (defence in depth).
    const meta = ACTIONS[pending.action] ?? ACTIONS[pending.action.replace(/_confirm$/, '')] ?? ACTIONS[pending.action.replace(/_2fa$/, '')];
    if (meta?.admin && !isAdmin) {
      await sendMessage(chatId, '🔒 That action is restricted to the admin chat.');
      return true;
    }
    try {
      await handlePendingInput(chatId, text, pending);
    } catch (e) {
      await sendMessage(chatId, `❌ ${esc((e as Error).message)}`, [backRow('main')]);
    }
    return true;
  }

  // Control commands
  if (/^\/(menu|panel|control)\b/i.test(trimmed)) {
    await sendMainMenu(chatId, messageId);
    return true;
  }

  return false; // not consumed — let the AI chat handle it
};

export default {
  sendMainMenu,
  handleControlCallback,
  tryHandleControlMessage,
  isAdminChat,
};
