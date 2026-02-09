import 'dotenv/config';
import logger from '../utils/logger';
import { URLS } from './constants';

interface EnvConfig {
  // Required
  FB_EMAIL: string;
  FB_PASSWORD: string;
  OPENAI_API_KEY: string;
  POSTGRES_URL: string;
  DATABASE_URL: string;

  // Optional with defaults
  PORT: number;
  NODE_ENV: string;
  GROUP_IDS: string[];
  MAX_MESSAGES_PER_DAY: number;
  BASE_TARASA_URL: string;
  HEADLESS: boolean;
  OPENAI_CLASSIFIER_MODEL: string;
  OPENAI_GENERATOR_MODEL: string;
  CLASSIFIER_BATCH_SIZE: number;
  GENERATOR_BATCH_SIZE: number;
  API_KEY?: string;
  SYSTEM_EMAIL_ALERT?: string;
  SYSTEM_EMAIL_PASSWORD?: string;

  // Apify scraper (replaces Playwright for Facebook scraping)
  APIFY_TOKEN?: string;
  APIFY_RESULTS_LIMIT: number;

  // Telegram Bot (optional)
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const requiredEnvVars = [
  'FB_EMAIL',
  'FB_PASSWORD',
  'OPENAI_API_KEY',
  'POSTGRES_URL',
] as const;

const validateEnv = (): void => {
  const missing: string[] = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(message);
    throw new Error(message);
  }

  // Warn about optional but recommended variables
  if (!process.env.GROUP_IDS) {
    logger.warn('GROUP_IDS is not set. Scraping will be skipped.');
  }

  if (!process.env.API_KEY) {
    logger.warn('API_KEY is not set. Trigger endpoints will be unprotected.');
  }

  // Warn about Apify configuration
  if (!process.env.APIFY_TOKEN) {
    logger.warn('APIFY_TOKEN is not set. Facebook scraping will use Playwright fallback (requires FB_EMAIL/FB_PASSWORD).');
  }

  if (!process.env.DATABASE_URL && process.env.POSTGRES_URL) {
    // Prisma expects DATABASE_URL for directUrl in schema; reuse POSTGRES_URL when absent
    process.env.DATABASE_URL = process.env.POSTGRES_URL;
    logger.warn('DATABASE_URL is not set. Falling back to POSTGRES_URL for Prisma compatibility.');
  } else if (process.env.DATABASE_URL && process.env.POSTGRES_URL && process.env.DATABASE_URL !== process.env.POSTGRES_URL) {
    logger.warn('DATABASE_URL differs from POSTGRES_URL. Ensure both point to the same database to avoid drift.');
  }

  logger.info('Environment validation passed');
};

const getEnvConfig = (): EnvConfig => {
  validateEnv();

  return {
    FB_EMAIL: process.env.FB_EMAIL!,
    FB_PASSWORD: process.env.FB_PASSWORD!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    POSTGRES_URL: process.env.POSTGRES_URL!,
    DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL!,

    PORT: Number(process.env.PORT) || 4000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    GROUP_IDS: (process.env.GROUP_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    MAX_MESSAGES_PER_DAY: Number(process.env.MAX_MESSAGES_PER_DAY) || 20,
    BASE_TARASA_URL: process.env.BASE_TARASA_URL || URLS.DEFAULT_TARASA,
    HEADLESS: process.env.HEADLESS !== 'false', // Default to true (headless) unless explicitly set to 'false'
    OPENAI_CLASSIFIER_MODEL: process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini',
    OPENAI_GENERATOR_MODEL: process.env.OPENAI_GENERATOR_MODEL || 'gpt-4o-mini',
    CLASSIFIER_BATCH_SIZE: Number(process.env.CLASSIFIER_BATCH_SIZE) || 25, // Increased for better throughput
    GENERATOR_BATCH_SIZE: Number(process.env.GENERATOR_BATCH_SIZE) || 20, // Increased for better throughput
    API_KEY: process.env.API_KEY,
    SYSTEM_EMAIL_ALERT: process.env.SYSTEM_EMAIL_ALERT,
    SYSTEM_EMAIL_PASSWORD: process.env.SYSTEM_EMAIL_PASSWORD,

    // Apify configuration
    APIFY_TOKEN: process.env.APIFY_TOKEN,
    APIFY_RESULTS_LIMIT: Number(process.env.APIFY_RESULTS_LIMIT) || 20,

    // Telegram Bot
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  };
};

export { validateEnv, getEnvConfig, EnvConfig };
