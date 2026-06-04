/**
 * Central cron scheduler for the three operator-tunable jobs (scrape /
 * classify / message). Owns the live `ScheduledTask` handles so a settings
 * change can `.stop()` the old schedule and re-register with a new one
 * without restarting the process — Railway redeploys take 4-10 minutes, so
 * runtime rescheduling is meaningfully faster than env-var-and-redeploy.
 *
 * Why a registry instead of letting each cron file own its handle: the
 * settings POST endpoint needs to stop and re-create all three at once
 * (presets are coordinated tuples), and the existing cron files registered
 * themselves at import time with no handle stored anywhere. The cleanest fix
 * is to invert: cron files export a `register*Cron(schedule)` factory; the
 * scheduler calls them and remembers the handles.
 */
import type { ScheduledTask } from 'node-cron';
import logger from '../utils/logger';
import {
  getSpeedPreset,
  SPEED_PRESETS,
  SpeedPreset,
} from '../utils/settings';
import { registerScrapeCron } from './scrape-cron';
import { registerClassifyCron } from './classify-cron';
import { registerMessageCron } from './message-cron';

// Live handles. `null` means not yet registered.
const handles: Record<'scrape' | 'classify' | 'message', ScheduledTask | null> = {
  scrape: null,
  classify: null,
  message: null,
};

let currentPreset: SpeedPreset | null = null;

const stopAll = (): void => {
  for (const key of Object.keys(handles) as Array<keyof typeof handles>) {
    const task = handles[key];
    if (task) {
      try {
        task.stop();
      } catch (err) {
        logger.warn(`[scheduler] Failed to stop ${key} cron: ${(err as Error).message}`);
      }
      handles[key] = null;
    }
  }
};

/**
 * Apply a speed preset. Stops the live handles (if any), re-registers each
 * cron with the new schedule, and updates the in-memory preset state.
 * Idempotent — calling with the current preset is a no-op except for the log.
 */
export const applySpeedPreset = async (preset: SpeedPreset): Promise<void> => {
  const def = SPEED_PRESETS[preset];
  if (!def) {
    throw new Error(`Unknown speed preset: ${preset}`);
  }

  stopAll();

  handles.scrape = registerScrapeCron(def.schedules.scrape);
  handles.classify = registerClassifyCron(def.schedules.classify);
  handles.message = registerMessageCron(def.schedules.message);

  currentPreset = preset;
  logger.info(
    `[scheduler] Applied speed preset '${preset}' — scrape=${def.schedules.scrape}, classify=${def.schedules.classify}, message=${def.schedules.message}`
  );
};

/**
 * Boot-time entry point. Called once from `src/cron/index.ts`. Reads the
 * persisted preset from DB (default 'normal' if no row), then registers all
 * three crons.
 */
export const initializeScheduler = async (): Promise<void> => {
  const preset = await getSpeedPreset().catch((err: Error) => {
    logger.warn(`[scheduler] Could not load speed preset from DB, using 'normal': ${err.message}`);
    return 'normal' as SpeedPreset;
  });
  await applySpeedPreset(preset);
};

/** Snapshot of currently-active schedules — useful for /api/health surfaces. */
export const getActiveSchedules = (): {
  preset: SpeedPreset | null;
  schedules: { scrape: string | null; classify: string | null; message: string | null };
} => ({
  preset: currentPreset,
  schedules: currentPreset
    ? {
        scrape: SPEED_PRESETS[currentPreset].schedules.scrape,
        classify: SPEED_PRESETS[currentPreset].schedules.classify,
        message: SPEED_PRESETS[currentPreset].schedules.message,
      }
    : { scrape: null, classify: null, message: null },
});

/** Visible for tests only. */
export const _resetSchedulerForTests = (): void => {
  stopAll();
  currentPreset = null;
};
