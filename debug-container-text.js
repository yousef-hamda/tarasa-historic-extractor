const { chromium } = require('playwright');
const fs = require('fs');

const selectors = {
  postContainer: ['div[role="article"]'],
  postTextCandidates: [
    'div[data-ad-comet-preview]',
    'div[dir="auto"]',
    'div[data-ad-preview="message"]',
    'div[role="main"] span[dir="auto"]',
  ],
};

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  // Load cookies
  const cookiesRaw = fs.readFileSync('./src/config/cookies.json', 'utf8');
  const cookies = JSON.parse(cookiesRaw);
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  await page.goto('https://www.facebook.com/groups/136596023614231', { waitUntil: 'networkidle' });
  
  console.log('Waiting for posts to load...');
  await page.waitForTimeout(5000);
  
  // Find containers exactly like the scraper does
  const containers = await page.$$('div[role="article"]');
  console.log(`\nFound ${containers.length} containers\n`);
  
  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    console.log(`\n=== CONTAINER ${i + 1} ===`);
    
    // Try each text selector inside this container
    let foundText = false;
    for (const textSelector of selectors.postTextCandidates) {
      const textHandle = await container.$(textSelector);
      if (textHandle) {
        const text = await textHandle.innerText();
        if (text && text.trim()) {
          console.log(`✓ Selector "${textSelector}" found: ${text.trim().substring(0, 100)}...`);
          foundText = true;
        } else {
          console.log(`✗ Selector "${textSelector}" found element but no text`);
        }
      } else {
        console.log(`✗ Selector "${textSelector}" not found`);
      }
    }
    
    if (!foundText) {
      console.log('\n⚠️  NO TEXT FOUND IN THIS CONTAINER');
      
      // Try to find ANY div with text
      const allDivs = await container.$$('div');
      console.log(`Container has ${allDivs.length} divs total`);
      
      // Sample a few
      for (let j = 0; j < Math.min(5, allDivs.length); j++) {
        const div = allDivs[j];
        const text = await div.innerText();
        const dir = await div.getAttribute('dir');
        const dataPreview = await div.getAttribute('data-ad-comet-preview');
        const dataMsg = await div.getAttribute('data-ad-preview');
        
        if (text && text.trim().length > 10) {
          console.log(`  Div ${j}: dir="${dir}" data-ad-comet-preview="${dataPreview}" data-ad-preview="${dataMsg}"`);
          console.log(`  Text: ${text.trim().substring(0, 80)}...`);
        }
      }
    }
  }
  
  await browser.close();
})();
