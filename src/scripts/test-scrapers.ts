/**
 * Test Script for All Scraping Methods
 *
 * This script tests each scraping method individually and compares results.
 * Use this to verify the new mbasic scraper and compare success rates.
 */

import 'dotenv/config';
import logger from '../utils/logger';
import { scrapeGroupWithMBasic, isMBasicAvailable } from '../scraper/mbasicScraper';
import { scrapeGroupWithApify, isApifyConfigured } from '../scraper/apifyScraper';
import { scrapeGroupWithPlaywright } from '../scraper/playwrightScraper';
import { isSessionValid } from '../session/sessionManager';
import { NormalizedPost } from '../scraper/apifyScraper';

interface TestResult {
  method: string;
  success: boolean;
  postsFound: number;
  duration: number;
  error: string | null;
  samplePost: NormalizedPost | null;
}

const testGroup = async (groupId: string): Promise<TestResult[]> => {
  const results: TestResult[] = [];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing scraping methods for group: ${groupId}`);
  console.log(`${'='.repeat(60)}\n`);

  // Test 1: MBasic Scraper
  console.log('\n--- Test 1: MBasic Scraper ---');
  const mbasicAvailable = await isMBasicAvailable();
  console.log(`MBasic available: ${mbasicAvailable}`);

  if (mbasicAvailable) {
    const startTime = Date.now();
    try {
      const posts = await scrapeGroupWithMBasic(groupId);
      const duration = Date.now() - startTime;
      results.push({
        method: 'mbasic',
        success: posts.length > 0,
        postsFound: posts.length,
        duration,
        error: null,
        samplePost: posts[0] || null,
      });
      console.log(`MBasic: SUCCESS - ${posts.length} posts in ${duration}ms`);
      if (posts[0]) {
        console.log(`  Sample post ID: ${posts[0].fbPostId}`);
        console.log(`  Sample author: ${posts[0].authorName || 'Unknown'}`);
        console.log(`  Sample text: ${posts[0].text.substring(0, 100)}...`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        method: 'mbasic',
        success: false,
        postsFound: 0,
        duration,
        error: (error as Error).message,
        samplePost: null,
      });
      console.log(`MBasic: FAILED - ${(error as Error).message}`);
    }
  } else {
    results.push({
      method: 'mbasic',
      success: false,
      postsFound: 0,
      duration: 0,
      error: 'Not available (no session)',
      samplePost: null,
    });
    console.log('MBasic: SKIPPED - No valid session');
  }

  // Test 2: Apify Scraper
  console.log('\n--- Test 2: Apify Scraper ---');
  const apifyConfigured = isApifyConfigured();
  console.log(`Apify configured: ${apifyConfigured}`);

  if (apifyConfigured) {
    const startTime = Date.now();
    try {
      const posts = await scrapeGroupWithApify(groupId);
      const duration = Date.now() - startTime;
      results.push({
        method: 'apify',
        success: posts.length > 0,
        postsFound: posts.length,
        duration,
        error: null,
        samplePost: posts[0] || null,
      });
      console.log(`Apify: SUCCESS - ${posts.length} posts in ${duration}ms`);
      if (posts[0]) {
        console.log(`  Sample post ID: ${posts[0].fbPostId}`);
        console.log(`  Sample author: ${posts[0].authorName || 'Unknown'}`);
        console.log(`  Sample text: ${posts[0].text.substring(0, 100)}...`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        method: 'apify',
        success: false,
        postsFound: 0,
        duration,
        error: (error as Error).message,
        samplePost: null,
      });
      console.log(`Apify: FAILED - ${(error as Error).message}`);
    }
  } else {
    results.push({
      method: 'apify',
      success: false,
      postsFound: 0,
      duration: 0,
      error: 'Not configured (no APIFY_TOKEN)',
      samplePost: null,
    });
    console.log('Apify: SKIPPED - Not configured');
  }

  // Test 3: Playwright Scraper
  console.log('\n--- Test 3: Playwright Scraper ---');
  const sessionValid = await isSessionValid();
  console.log(`Session valid: ${sessionValid}`);

  if (sessionValid) {
    const startTime = Date.now();
    try {
      const posts = await scrapeGroupWithPlaywright(groupId);
      const duration = Date.now() - startTime;
      results.push({
        method: 'playwright',
        success: posts.length > 0,
        postsFound: posts.length,
        duration,
        error: null,
        samplePost: posts[0] || null,
      });
      console.log(`Playwright: SUCCESS - ${posts.length} posts in ${duration}ms`);
      if (posts[0]) {
        console.log(`  Sample post ID: ${posts[0].fbPostId}`);
        console.log(`  Sample author: ${posts[0].authorName || 'Unknown'}`);
        console.log(`  Sample text: ${posts[0].text.substring(0, 100)}...`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        method: 'playwright',
        success: false,
        postsFound: 0,
        duration,
        error: (error as Error).message,
        samplePost: null,
      });
      console.log(`Playwright: FAILED - ${(error as Error).message}`);
    }
  } else {
    results.push({
      method: 'playwright',
      success: false,
      postsFound: 0,
      duration: 0,
      error: 'Not available (no session)',
      samplePost: null,
    });
    console.log('Playwright: SKIPPED - No valid session');
  }

  return results;
};

const printSummary = (results: TestResult[]) => {
  console.log('\n');
  console.log('='.repeat(60));
  console.log('SCRAPER COMPARISON SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log('Method      | Success | Posts | Duration  | Error');
  console.log('-'.repeat(60));

  for (const r of results) {
    const success = r.success ? 'YES' : 'NO ';
    const posts = String(r.postsFound).padStart(5);
    const duration = r.duration > 0 ? `${r.duration}ms`.padStart(8) : 'N/A'.padStart(8);
    const error = r.error ? r.error.substring(0, 20) : '-';
    console.log(`${r.method.padEnd(11)} | ${success}     | ${posts} | ${duration} | ${error}`);
  }

  console.log('-'.repeat(60));

  // Find the best method
  const successfulMethods = results.filter(r => r.success);
  if (successfulMethods.length > 0) {
    const fastest = successfulMethods.reduce((a, b) => a.duration < b.duration ? a : b);
    const mostPosts = successfulMethods.reduce((a, b) => a.postsFound > b.postsFound ? a : b);
    console.log('');
    console.log(`Fastest method: ${fastest.method} (${fastest.duration}ms)`);
    console.log(`Most posts: ${mostPosts.method} (${mostPosts.postsFound} posts)`);
  } else {
    console.log('');
    console.log('No methods succeeded!');
  }
  console.log('');
};

async function main() {
  console.log('='.repeat(60));
  console.log('  SCRAPER TEST SUITE');
  console.log('  Testing all scraping methods for comparison');
  console.log('='.repeat(60));

  // Get test group from args or use default
  const testGroupId = process.argv[2] || process.env.GROUP_IDS?.split(',')[0]?.trim();

  if (!testGroupId) {
    console.error('Error: No group ID provided.');
    console.log('Usage: npx ts-node src/scripts/test-scrapers.ts <group_id>');
    console.log('Or set GROUP_IDS in .env');
    process.exit(1);
  }

  console.log(`\nTest group: ${testGroupId}`);

  // Check prerequisites
  console.log('\n--- Prerequisites ---');
  console.log(`MBasic available: ${await isMBasicAvailable()}`);
  console.log(`Apify configured: ${isApifyConfigured()}`);
  console.log(`Session valid: ${await isSessionValid()}`);

  // Run tests
  const results = await testGroup(testGroupId);

  // Print summary
  printSummary(results);

  // Exit
  process.exit(0);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
