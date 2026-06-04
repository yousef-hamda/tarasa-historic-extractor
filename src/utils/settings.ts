/**
 * DB-backed key/value settings store.
 *
 * Railway wipes the container filesystem on every redeploy, so anything stored
 * in a JSON file on disk (the old `messaging-state.json` path) gets lost. This
 * module centralizes operator-facing settings in Postgres via the
 * `SystemSetting` model. Values are JSON-encoded in a TEXT column so we can
 * store numbers, booleans, strings, or small objects through one column.
 *
 * Reads go through a 60-second in-memory cache. The cron hot paths (generator,
 * classifier-quality, duplicate-detection) read settings on every tick — without
 * caching this would hit Postgres ~1× per second under aggressive presets.
 * Writes invalidate the cache for the affected key so changes take effect on
 * the next read.
 */
import prisma from '../database/prisma';
import logger from '../utils/logger';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

const now = (): number => Date.now();

/** Visible for tests — production code should not touch the cache directly. */
export const _clearSettingsCache = (): void => {
  cache.clear();
};

const readCache = <T>(key: string): { hit: true; value: T } | { hit: false } => {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt < now()) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value as T };
};

const writeCache = (key: string, value: unknown): void => {
  cache.set(key, { value, expiresAt: now() + CACHE_TTL_MS });
};

/**
 * Get a setting from the DB, falling back to `defaultValue` if absent. All
 * JSON-decoding lives here so callers always work with the native type.
 */
export const getSetting = async <T>(key: string, defaultValue: T): Promise<T> => {
  const cached = readCache<T>(key);
  if (cached.hit) return cached.value;

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) {
      writeCache(key, defaultValue);
      return defaultValue;
    }
    const parsed = JSON.parse(row.value) as T;
    writeCache(key, parsed);
    return parsed;
  } catch (error) {
    // Don't let a DB blip take down hot paths. Log and fall back to default —
    // the next call will retry.
    logger.warn(`[settings] Failed to read setting '${key}', returning default: ${(error as Error).message}`);
    return defaultValue;
  }
};

/**
 * Synchronous variant for routes that don't want to make their handlers async
 * just to read one setting. Returns the cached value or `defaultValue` if not
 * cached — does NOT touch the DB. Prime the cache by calling `getSetting` on
 * the relevant keys during startup if you need this.
 */
export const getSettingSyncCached = <T>(key: string, defaultValue: T): T => {
  const cached = readCache<T>(key);
  return cached.hit ? cached.value : defaultValue;
};

/**
 * Upsert a setting. Invalidates the cache so the next read returns the new
 * value immediately.
 */
export const setSetting = async <T>(key: string, value: T): Promise<void> => {
  const serialized = JSON.stringify(value);
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });
  // Update the cache instead of just invalidating so the writer sees their
  // own change on the next read, even within the same TTL window.
  writeCache(key, value);
};

// ---------------------------------------------------------------------------
// Typed helpers for known keys. New settings should add a helper here so the
// key string is canonical and the default is colocated with the consumers.
// ---------------------------------------------------------------------------

/** Posts must score STRICTLY GREATER than this confidence to count as historic. */
export const HISTORIC_THRESHOLD_KEY = 'historic_confidence_threshold';
export const HISTORIC_THRESHOLD_DEFAULT = 75;
export const HISTORIC_THRESHOLD_MIN = 50;
export const HISTORIC_THRESHOLD_MAX = 100;

export const getHistoricThreshold = async (): Promise<number> => {
  const raw = await getSetting<number>(HISTORIC_THRESHOLD_KEY, HISTORIC_THRESHOLD_DEFAULT);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return HISTORIC_THRESHOLD_DEFAULT;
  return Math.max(HISTORIC_THRESHOLD_MIN, Math.min(HISTORIC_THRESHOLD_MAX, Math.round(raw)));
};

export const setHistoricThreshold = async (value: number): Promise<number> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('historic threshold must be a finite number');
  }
  const clamped = Math.max(HISTORIC_THRESHOLD_MIN, Math.min(HISTORIC_THRESHOLD_MAX, Math.round(value)));
  await setSetting<number>(HISTORIC_THRESHOLD_KEY, clamped);
  return clamped;
};

/** Cron-speed preset name (see SPEED_PRESETS below for the actual schedule tuples). */
export const SPEED_PRESET_KEY = 'system_speed_preset';
export type SpeedPreset = 'conservative' | 'normal' | 'fast' | 'aggressive';
export const SPEED_PRESET_DEFAULT: SpeedPreset = 'normal';

export interface SpeedPresetDefinition {
  preset: SpeedPreset;
  label: string;
  description: string;
  warning?: string;
  danger?: string;
  schedules: {
    scrape: string;
    classify: string;
    message: string;
  };
}

export const SPEED_PRESETS: Record<SpeedPreset, SpeedPresetDefinition> = {
  conservative: {
    preset: 'conservative',
    label: 'Conservative',
    description: 'Safe baseline — uses well under Facebook\'s tolerance budget.',
    schedules: {
      scrape: '*/30 * * * *',
      classify: '*/10 * * * *',
      message: '*/15 * * * *',
    },
  },
  normal: {
    preset: 'normal',
    label: 'Normal',
    description: 'Recommended cadence — battle-tested production default.',
    schedules: {
      scrape: '*/10 * * * *',
      classify: '*/3 * * * *',
      message: '*/5 * * * *',
    },
  },
  fast: {
    preset: 'fast',
    label: 'Fast',
    description: 'Higher throughput.',
    warning: 'May approach Facebook rate limits. Watch /logs for errors.',
    schedules: {
      scrape: '*/5 * * * *',
      classify: '*/2 * * * *',
      message: '*/3 * * * *',
    },
  },
  aggressive: {
    preset: 'aggressive',
    label: 'Aggressive',
    description: 'Maximum throughput.',
    warning: 'May approach Facebook rate limits. Watch /logs for errors.',
    danger: 'Likely to trigger Facebook anti-bot. Use only for short bursts.',
    schedules: {
      scrape: '*/2 * * * *',
      classify: '* * * * *',
      message: '*/2 * * * *',
    },
  },
};

export const isSpeedPreset = (v: unknown): v is SpeedPreset =>
  v === 'conservative' || v === 'normal' || v === 'fast' || v === 'aggressive';

export const getSpeedPreset = async (): Promise<SpeedPreset> => {
  const raw = await getSetting<unknown>(SPEED_PRESET_KEY, SPEED_PRESET_DEFAULT);
  return isSpeedPreset(raw) ? raw : SPEED_PRESET_DEFAULT;
};

export const setSpeedPreset = async (preset: SpeedPreset): Promise<void> => {
  if (!isSpeedPreset(preset)) {
    throw new Error(`Invalid speed preset: ${String(preset)}`);
  }
  await setSetting<SpeedPreset>(SPEED_PRESET_KEY, preset);
};

/**
 * Recipient email for operator reports (the "Send Approved Posts" button).
 * Stored as a plain string; empty string means "not set".
 *
 * Validation is intentionally loose — `<local>@<domain>.<tld>` is enough. We
 * don't try to verify deliverability; the user will know within seconds
 * whether the test email arrives.
 */
export const ADMIN_EMAIL_KEY = 'admin_email_recipient';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getAdminEmail = async (): Promise<string> => {
  const raw = await getSetting<string>(ADMIN_EMAIL_KEY, '');
  return typeof raw === 'string' ? raw : '';
};

/**
 * Returns the stored value (trimmed, lowercased). Pass an empty string to
 * clear. Throws if the input is non-empty but not a valid email shape so the
 * caller can surface the error to the UI.
 */
export const setAdminEmail = async (raw: string | null | undefined): Promise<string> => {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed && !EMAIL_REGEX.test(trimmed)) {
    throw new Error('That doesn\'t look like an email address.');
  }
  await setSetting<string>(ADMIN_EMAIL_KEY, trimmed);
  return trimmed;
};

/** Visible for tests. */
export const _EMAIL_REGEX_FOR_TESTS = EMAIL_REGEX;

/**
 * Messaging on/off — migrated from messaging-state.json so it survives redeploys.
 *
 * DEFAULT IS FALSE on purpose. Outreach messages go to real people's Messenger
 * inboxes; the cost of sending one accidentally (wrong threshold, wrong
 * filter, mistaken classification) is much higher than the cost of an operator
 * having to flip a toggle. New installs and fresh containers default to
 * "paused" so messages only flow after a deliberate human enable.
 */
export const MESSAGING_ENABLED_KEY = 'messaging_enabled';
export const MESSAGING_ENABLED_DEFAULT = false;

export const getMessagingEnabledAsync = async (): Promise<boolean> => {
  const raw = await getSetting<boolean>(MESSAGING_ENABLED_KEY, MESSAGING_ENABLED_DEFAULT);
  return raw === true;
};

export const setMessagingEnabled = async (enabled: boolean): Promise<void> => {
  await setSetting<boolean>(MESSAGING_ENABLED_KEY, Boolean(enabled));
};

/**
 * Telegram bot's authenticated chat ids — persisted across redeploys so
 * non-admin users don't have to re-enter the password every time we push.
 * Stored as a JSON-encoded `string[]` under `telegram_authenticated_chats`.
 */
export const TELEGRAM_AUTH_KEY = 'telegram_authenticated_chats';

export const getAuthenticatedTelegramChats = async (): Promise<string[]> => {
  const raw = await getSetting<string[]>(TELEGRAM_AUTH_KEY, []);
  return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
};

/**
 * Add a chat-id to the persisted authenticated list. Idempotent — if the
 * id is already present, this is a no-op (avoids unnecessary DB writes
 * under a spam-auth pattern).
 */
export const addAuthenticatedTelegramChat = async (chatId: string): Promise<void> => {
  if (!chatId || typeof chatId !== 'string') return;
  const current = await getAuthenticatedTelegramChats();
  if (current.includes(chatId)) return;
  await setSetting<string[]>(TELEGRAM_AUTH_KEY, [...current, chatId]);
};
