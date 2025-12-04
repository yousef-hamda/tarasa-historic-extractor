const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://www.facebook.com/groups/136596023614231/posts/1876067333000416/', { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting 5 seconds...');
  await page.waitForTimeout(5000);
  
  console.log('\n=== FINDING AUTHOR INFO ===\n');
  
  // Find ALL links in the post
  const allLinks = await page.$$('a[href]');
  console.log(`Total links found: ${allLinks.length}`);
  
  console.log('\n=== First 10 links with their href and text ===\n');
  for (let i = 0; i < Math.min(10, allLinks.length); i++) {
    const href = await allLinks[i].getAttribute('href');
    const text = await allLinks[i].innerText().catch(() => '');
    const ariaLabel = await allLinks[i].getAttribute('aria-label');
    console.log(`${i + 1}. Text: "${text}" | Aria: "${ariaLabel}" | Href: ${href?.substring(0, 80)}`);
  }
  
  await page.waitForTimeout(300000);
  await browser.close();
})();
