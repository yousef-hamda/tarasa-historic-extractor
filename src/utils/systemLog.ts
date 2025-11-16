import prisma from '../database/prisma';
import logger from './logger';

export const logSystemEvent = async (type: string, message: string) => {
  try {
    await prisma.systemLog.create({
      data: { type, message },
    });
  } catch (error) {
    logger.error(`Failed to persist system log (${type}): ${error}`);
  }
};
