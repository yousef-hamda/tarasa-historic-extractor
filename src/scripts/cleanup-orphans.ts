import prisma from '../database/prisma';
import logger from '../utils/logger';

/**
 * Removes generated messages that cannot be sent because the post has no author link.
 * Useful for cleaning old queues after selector changes.
 */
const run = async () => {
  try {
    const removed = await prisma.messageGenerated.deleteMany({
      where: {
        OR: [
          { post: { authorLink: null } },
          { post: { authorLink: '' } },
        ],
      },
    });

    logger.info(`Cleanup complete. Removed ${removed.count} generated messages without author links.`);
  } catch (error) {
    logger.error(`Cleanup failed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

run();
