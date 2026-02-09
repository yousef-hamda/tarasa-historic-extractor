import 'dotenv/config';
import prisma from '../database/prisma';

async function stats() {
  const groups = await prisma.groupInfo.findMany();
  const totalGroups = groups.length;
  const accessibleGroups = groups.filter((g: any) => g.isAccessible).length;
  const scrapedGroups = groups.filter((g: any) => g.lastScraped !== null).length;

  const totalPosts = await prisma.postRaw.count();
  const classifiedPosts = await prisma.postClassified.count();
  const historicPosts = await prisma.postClassified.count({ where: { isHistoric: true } });

  const recentLogs = await prisma.systemLog.findMany({
    where: {
      type: 'scrape',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('=== SCRAPING SUCCESS RATE ===\n');

  console.log('GROUP STATUS:');
  console.log(`  Total groups configured: ${totalGroups}`);
  console.log(`  Groups accessible: ${accessibleGroups} (${Math.round(accessibleGroups/totalGroups*100)}%)`);
  console.log(`  Groups ever scraped: ${scrapedGroups} (${Math.round(scrapedGroups/totalGroups*100)}%)`);
  console.log('');

  console.log('POST STATISTICS:');
  console.log(`  Total posts scraped: ${totalPosts}`);
  console.log(`  Posts classified: ${classifiedPosts}`);
  console.log(`  Historic posts found: ${historicPosts} (${Math.round(historicPosts/Math.max(classifiedPosts,1)*100)}% of classified)`);
  console.log(`  Avg posts per scraped group: ${Math.round(totalPosts / Math.max(scrapedGroups, 1))}`);
  console.log('');

  const orchestratedLogs = recentLogs.filter((l: any) => l.message.includes('Orchestrated scrape complete'));
  if (orchestratedLogs.length > 0) {
    console.log('RECENT SCRAPE RUNS (last 24h):');
    for (const log of orchestratedLogs.slice(0, 5)) {
      const match = log.message.match(/(\d+)\/(\d+) groups successful, (\d+) posts/);
      if (match) {
        const rate = Math.round(parseInt(match[1]) / parseInt(match[2]) * 100);
        console.log(`  ${log.createdAt.toLocaleString()}: ${match[1]}/${match[2]} groups (${rate}%), ${match[3]} posts`);
      }
    }
    console.log('');
  }

  console.log('PER-GROUP BREAKDOWN:');
  for (const g of groups) {
    const status = g.isAccessible ? 'OK' : 'FAIL';
    const lastScraped = g.lastScraped ? 'Scraped' : 'Never';
    const posts = await prisma.postRaw.count({ where: { groupId: g.groupId } });
    console.log(`  [${status}] ${g.groupId.substring(0, 18).padEnd(18)} | Posts: ${String(posts).padStart(3)} | ${lastScraped}`);
  }

  // Calculate overall success rate
  console.log('\n=== OVERALL SUCCESS RATE ===');
  const groupSuccessRate = Math.round(scrapedGroups / totalGroups * 100);
  console.log(`  Group scraping success: ${groupSuccessRate}% (${scrapedGroups}/${totalGroups} groups)`);

  if (orchestratedLogs.length > 0) {
    // Average from recent runs
    let totalSuccess = 0, totalAttempts = 0;
    for (const log of orchestratedLogs) {
      const match = log.message.match(/(\d+)\/(\d+) groups successful/);
      if (match) {
        totalSuccess += parseInt(match[1]);
        totalAttempts += parseInt(match[2]);
      }
    }
    if (totalAttempts > 0) {
      console.log(`  Recent runs average: ${Math.round(totalSuccess/totalAttempts*100)}% (${totalSuccess}/${totalAttempts} group attempts)`);
    }
  }

  await prisma.$disconnect();
}

stats().catch(console.error);
