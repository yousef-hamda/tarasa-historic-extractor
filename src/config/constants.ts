/**
 * Centralized timeout and configuration constants
 */

// Browser automation timeouts (in milliseconds)
export const TIMEOUTS = {
  /** Default page timeout for navigation and waits */
  PAGE_DEFAULT: 90000,
  /** Timeout for page navigation */
  NAVIGATION: 90000,
  /** Timeout for waiting for elements to appear */
  ELEMENT_WAIT: 30000,
  /** Timeout for short element waits (e.g., messenger textarea) */
  SHORT_WAIT: 15000,
  /** Timeout for debug/scrape operations */
  DEBUG: 60000,
  /** Timeout for feed content to load */
  FEED_LOAD: 30000,
} as const;

// Human-like delay ranges (in milliseconds)
export const DELAYS = {
  /** Minimum delay between actions */
  MIN: 2000,
  /** Maximum delay between actions */
  MAX: 6000,
  /** Short delay for quick actions */
  SHORT_MIN: 1500,
  SHORT_MAX: 2500,
  /** Medium delay for standard actions */
  MEDIUM_MIN: 3000,
  MEDIUM_MAX: 5000,
  /** Long delay for important actions */
  LONG_MIN: 5000,
  LONG_MAX: 7000,
} as const;

// API and network timeouts
export const API_TIMEOUTS = {
  /** Default API fetch timeout */
  FETCH: 30000,
  /** OpenAI API timeout */
  OPENAI: 60000,
} as const;

// Batch sizes
export const BATCH_SIZES = {
  /** Default posts to scrape per run */
  SCRAPE_MIN: 20,
  SCRAPE_MAX: 40,
  /** Default classification batch size */
  CLASSIFY: 10,
  /** Default message generation batch size */
  GENERATE: 10,
} as const;

// Message quota
export const QUOTA = {
  /** Default maximum messages per day */
  DEFAULT_MAX_PER_DAY: 20,
  /** Rolling window in milliseconds (24 hours) */
  WINDOW_MS: 24 * 60 * 60 * 1000,
} as const;
