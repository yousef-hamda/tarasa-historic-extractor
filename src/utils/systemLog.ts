import prisma from '../database/prisma';
import logger from './logger';

export type LogType = 'scrape' | 'classify' | 'message' | 'auth' | 'error';

const VALID_LOG_TYPES: LogType[] = ['scrape', 'classify', 'message', 'auth', 'error'];

export const logSystemEvent = async (type: LogType, message: string): Promise<void> => {
  if (!VALID_LOG_TYPES.includes(type)) {
    logger.error(`Invalid log type: ${type}`);
    return;
  }

  try {
    await prisma.systemLog.create({
      data: { type, message },
    });
  } catch (error) {
    logger.error(`Failed to persist system log (${type}): ${error}`);
  }
};
