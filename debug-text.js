const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const cookiesPath = './data/cookies.json';
  let cookies = [];
  
  if (fs.existsSync(cookiesPath)) {
    cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    console.log('✅ Loaded saved cookies');
  }
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  if (cookies.length) {
    await context.addCookies(cookies);
  }
  
  const page = await context.newPage();
  
  console.log('Navigating to Facebook group...');
  await page.goto('https://www.facebook.com/groups/136596023614231', { waitUntil: 'domcontentloaded' });
  
  await page.waitForTimeout(5000);
  
  const articles = await page.$$('div[role="article"]');
  console.log(`\nFound ${articles.length} articles`);
  
  if (articles.length > 0) {
    console.log('\n=== FIRST POST ANALYSIS ===\n');
    const first = articles[0];
    
    // Try all text selectors
    const selectors = [
      'div[data-ad-comet-preview]',
      'div[dir="auto"]',
      'div[data-ad-preview="message"]',
      'div[role="main"] span[dir="auto"]',
      'span[dir="auto"]',
      '[dir="auto"]',
      'div',
    ];
    
    for (const sel of selectors) {
      const elements = await first.$$(sel);
      console.log(`Selector: ${sel} → Found ${elements.length} elements`);
      
      if (elements.length > 0 && elements.length < 50) {
        for (let i = 0; i < Math.min(3, elements.length); i++) {
          const text = await elements[i].innerText().catch(() => '');
          if (text.length > 20) {
            console.log(`  → Element ${i+1}: "${text.substring(0, 80)}..."`);
          }
        }
      }
    }
  }
  
  console.log('\n=== Browser will stay open for 2 minutes ===');
  await page.waitForTimeout(120000);
  
  await browser.close();
})();
