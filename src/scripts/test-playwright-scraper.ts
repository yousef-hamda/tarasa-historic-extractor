/**
 * End-to-end test for the Playwright scraper
 */

import { scrapeGroupWithPlaywright, hasValidFacebookSession } from '../scraper/playwrightScraper';

async function main() {
  console.log('\n=== PLAYWRIGHT SCRAPER E2E TEST ===\n');

  // Check session
  console.log('1. Checking Facebook session...');
  const hasSession = await hasValidFacebookSession();
  if (!hasSession) {
    console.log('ERROR: No valid Facebook session. Run: npx ts-node src/scripts/facebook-login.ts');
    return;
  }

  // Run scraper
  console.log('\n2. Running scraper on test group...\n');
  const groupId = '1654282231298043'; // Test group

  try {
    const posts = await scrapeGroupWithPlaywright(groupId);

    console.log(`\n=== SCRAPER RESULTS ===`);
    console.log(`Total posts extracted: ${posts.length}\n`);

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      console.log(`--- POST ${i + 1} ---`);
      console.log(`  ID: ${post.fbPostId}`);
      console.log(`  Author: ${post.authorName || 'NOT FOUND'}`);
      console.log(`  Author Link: ${post.authorLink ? 'YES' : 'NO'}`);
      console.log(`  Author Photo: ${post.authorPhoto ? 'YES' : 'NO'}`);
      console.log(`  Post URL: ${post.postUrl || 'NOT FOUND'}`);
      console.log(`  Text (${post.text.length} chars): ${post.text.substring(0, 80)}...`);

      // Check for issues
      const issues: string[] = [];
      if (!post.authorName) issues.push('missing author');
      if (post.text.includes('See less')) issues.push('contains "See less"');
      if (post.text.includes('See more')) issues.push('contains "See more"');
      if (post.fbPostId.startsWith('hash_')) issues.push('hash-based ID');
      if (!post.authorPhoto) issues.push('no photo');
      if (!post.postUrl) issues.push('no URL');

      if (issues.length > 0) {
        console.log(`  ⚠️ Issues: ${issues.join(', ')}`);
      } else {
        console.log(`  ✅ All fields populated`);
      }
      console.log('');
    }

    // Summary
    const withPostUrl = posts.filter(p => p.postUrl).length;
    const withAuthorName = posts.filter(p => p.authorName).length;
    const withAuthorLink = posts.filter(p => p.authorLink).length;
    const withAuthorPhoto = posts.filter(p => p.authorPhoto).length;
    const withSeeLess = posts.filter(p => p.text.includes('See less')).length;
    const withSeeMore = posts.filter(p => p.text.includes('See more')).length;
    const withHashId = posts.filter(p => p.fbPostId.startsWith('hash_')).length;

    console.log(`=== SUMMARY ===`);
    console.log(`Total posts: ${posts.length}`);
    console.log(`With author name: ${withAuthorName} (${Math.round(withAuthorName/posts.length*100 || 0)}%)`);
    console.log(`With author link: ${withAuthorLink} (${Math.round(withAuthorLink/posts.length*100 || 0)}%)`);
    console.log(`With author photo: ${withAuthorPhoto} (${Math.round(withAuthorPhoto/posts.length*100 || 0)}%)`);
    console.log(`With post URL: ${withPostUrl} (${Math.round(withPostUrl/posts.length*100 || 0)}%)`);
    console.log(`With "See less" in text: ${withSeeLess}`);
    console.log(`With "See more" in text: ${withSeeMore}`);
    console.log(`With hash-based IDs: ${withHashId}`);

    console.log('\n=== QUALITY CHECK ===');
    if (withSeeLess > 0) {
      console.log('❌ Some posts contain "See less" - text cleaning needs work');
    } else {
      console.log('✅ No posts contain "See less"');
    }

    if (withSeeMore > 0) {
      console.log('❌ Some posts contain "See more" - expansion not working');
    } else {
      console.log('✅ No posts contain "See more" - expansion working');
    }

    if (withAuthorName === posts.length) {
      console.log('✅ All posts have author names');
    } else {
      console.log(`❌ ${posts.length - withAuthorName} posts missing author names`);
    }

    if (withAuthorPhoto >= posts.length * 0.8) {
      console.log('✅ 80%+ posts have author photos');
    } else {
      console.log(`⚠️ Only ${Math.round(withAuthorPhoto/posts.length*100)}% have author photos`);
    }

  } catch (error) {
    console.error('Scraper error:', error);
  }

  console.log('\nDone.');
}

main().catch(console.error);
