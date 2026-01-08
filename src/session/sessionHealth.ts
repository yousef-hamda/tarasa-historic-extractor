/**
 * Session Health Monitor
 *
 * Monitors the health of the Facebook session and provides
 * status information for the scraping system.
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';

// Path to browser data directory
const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const SESSION_HEALTH_FILE = path.join(BROWSER_DATA_DIR, 'session-health.json');

export type SessionStatus =
  | 'valid'       // Session is working
  | 'expired'     // Session expired, may be refreshable
  | 'invalid'     // Session invalid, needs manual login
  | 'refreshing'  // Currently refreshing
  | 'blocked'     // Blocked by 2FA/Captcha
  | 'unknown';    // Status not yet determined

export interface SessionHealthData {
  status: SessionStatus;
  lastChecked: string;
  lastValid: string | null;
  userId: string | null;
  userName: string | null;
  errorMessage: string | null;
  expiresAt: string | null;
  canAccessPrivateGroups: boolean;
}

const DEFAULT_HEALTH: SessionHealthData = {
  status: 'unknown',
  lastChecked: new Date().toISOString(),
  lastValid: null,
  userId: null,
  userName: null,
  errorMessage: null,
  expiresAt: null,
  canAccessPrivateGroups: false,
};

/**
 * Load session health data from file
 */
export const loadSessionHealth = async (): Promise<SessionHealthData> => {
  try {
    const data = await fs.readFile(SESSION_HEALTH_FILE, 'utf-8');
    return JSON.parse(data) as SessionHealthData;
  } catch (error) {
    // File doesn't exist or is invalid
    logger.debug(`No session health file found, using defaults`);
    return { ...DEFAULT_HEALTH };
  }
};

/**
 * Save session health data to file
 */
export const saveSessionHealth = async (health: SessionHealthData): Promise<void> => {
  try {
    // Ensure directory exists
    await fs.mkdir(BROWSER_DATA_DIR, { recursive: true });
    await fs.writeFile(SESSION_HEALTH_FILE, JSON.stringify(health, null, 2));
    logger.debug(`Session health saved: ${health.status}`);
  } catch (error) {
    logger.error(`Failed to save session health: ${(error as Error).message}`);
  }
};

/**
 * Update session health status
 */
export const updateSessionHealth = async (
  updates: Partial<SessionHealthData>
): Promise<SessionHealthData> => {
  const current = await loadSessionHealth();
  const updated: SessionHealthData = {
    ...current,
    ...updates,
    lastChecked: new Date().toISOString(),
  };

  // If status changed to valid, update lastValid
  if (updates.status === 'valid') {
    updated.lastValid = new Date().toISOString();
  }

  await saveSessionHealth(updated);
  return updated;
};

/**
 * Mark session as valid with user info
 */
export const markSessionValid = async (
  userId: string,
  userName?: string
): Promise<SessionHealthData> => {
  return updateSessionHealth({
    status: 'valid',
    userId,
    userName: userName || null,
    errorMessage: null,
    canAccessPrivateGroups: true,
  });
};

/**
 * Mark session as expired
 */
export const markSessionExpired = async (
  reason?: string
): Promise<SessionHealthData> => {
  return updateSessionHealth({
    status: 'expired',
    errorMessage: reason || 'Session expired',
    canAccessPrivateGroups: false,
  });
};

/**
 * Mark session as invalid (needs manual login)
 */
export const markSessionInvalid = async (
  reason?: string
): Promise<SessionHealthData> => {
  return updateSessionHealth({
    status: 'invalid',
    errorMessage: reason || 'Session invalid - manual login required',
    canAccessPrivateGroups: false,
  });
};

/**
 * Mark session as blocked (2FA/Captcha)
 */
export const markSessionBlocked = async (
  reason: string
): Promise<SessionHealthData> => {
  return updateSessionHealth({
    status: 'blocked',
    errorMessage: reason,
    canAccessPrivateGroups: false,
  });
};

/**
 * Check if session is healthy enough for scraping
 */
export const isSessionHealthy = async (): Promise<boolean> => {
  const health = await loadSessionHealth();
  return health.status === 'valid';
};

/**
 * Check if session can access private groups
 */
export const canAccessPrivateGroups = async (): Promise<boolean> => {
  const health = await loadSessionHealth();
  return health.status === 'valid' && health.canAccessPrivateGroups;
};

/**
 * Get a summary of session health for logging/display
 */
export const getSessionHealthSummary = async (): Promise<string> => {
  const health = await loadSessionHealth();
  const parts = [
    `Status: ${health.status}`,
    `Last Checked: ${health.lastChecked}`,
  ];

  if (health.userId) {
    parts.push(`User: ${health.userName || health.userId}`);
  }

  if (health.errorMessage) {
    parts.push(`Error: ${health.errorMessage}`);
  }

  return parts.join(' | ');
};

/**
 * Check if browser data directory exists and has content
 */
export const hasBrowserProfile = async (): Promise<boolean> => {
  try {
    const files = await fs.readdir(BROWSER_DATA_DIR);
    // Check for actual browser profile data (not just our metadata files)
    const profileFiles = files.filter(f =>
      f !== '.gitignore' &&
      f !== 'README.md' &&
      f !== 'session-health.json'
    );
    return profileFiles.length > 0;
  } catch {
    return false;
  }
};

/**
 * Get time since last successful session
 */
export const getTimeSinceLastValid = async (): Promise<number | null> => {
  const health = await loadSessionHealth();
  if (!health.lastValid) return null;

  const lastValid = new Date(health.lastValid).getTime();
  const now = Date.now();
  return now - lastValid;
};

/**
 * Check if session needs refresh (valid but old)
 */
export const sessionNeedsRefresh = async (maxAgeMs: number = 12 * 60 * 60 * 1000): Promise<boolean> => {
  const health = await loadSessionHealth();
  if (health.status !== 'valid') return true;

  const timeSinceValid = await getTimeSinceLastValid();
  if (timeSinceValid === null) return true;

  return timeSinceValid > maxAgeMs;
};
