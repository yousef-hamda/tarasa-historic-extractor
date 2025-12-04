const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to Facebook group...');
  await page.goto('https://www.facebook.com/groups/136596023614231', { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting 10 seconds for you to see the page...');
  await page.waitForTimeout(10000);
  
  console.log('\n=== CHECKING SELECTORS ===\n');
  
  // Check post containers
  const articles = await page.$$('div[role="article"]');
  console.log(`Found ${articles.length} div[role="article"] elements`);
  
  const feedUnits = await page.$$('div[data-pagelet^="FeedUnit_"]');
  console.log(`Found ${feedUnits.length} div[data-pagelet^="FeedUnit_"] elements`);
  
  if (articles.length > 0) {
    console.log('\n=== INSPECTING FIRST POST ===\n');
    const firstPost = articles[0];
    
    // Check author link
    const authorLinks = await firstPost.$$('a[href*="/user/"], a[href*="/profile.php"], a[href*="/people/"]');
    console.log(`Author links found: ${authorLinks.length}`);
    
    if (authorLinks.length > 0) {
      const href = await authorLinks[0].getAttribute('href');
      console.log(`First author link: ${href}`);
    }
    
    // Check author name
    const strongLinks = await firstPost.$$('strong a, h4 a');
    console.log(`Strong/H4 links found: ${strongLinks.length}`);
    
    if (strongLinks.length > 0) {
      const text = await strongLinks[0].innerText();
      console.log(`First strong link text: ${text}`);
    }
    
    // Check post ID
    const postLinks = await firstPost.$$('a[href*="/posts/"], a[href*="/permalink/"]');
    console.log(`Post ID links found: ${postLinks.length}`);
    
    if (postLinks.length > 0) {
      const href = await postLinks[0].getAttribute('href');
      console.log(`First post link: ${href}`);
    }
  }
  
  console.log('\n=== Press Ctrl+C to exit ===');
  await page.waitForTimeout(300000);
  
  await browser.close();
})();
