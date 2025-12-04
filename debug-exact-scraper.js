const { chromium } = require('playwright');
const fs = require('fs');

const selectors = {
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
  
  const cookiesRaw = fs.readFileSync('./src/config/cookies.json', 'utf8');
  const cookies = JSON.parse(cookiesRaw);
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  await page.goto('https://www.facebook.com/groups/136596023614231', { 
    waitUntil: 'domcontentloaded',
    timeout: 60000 
  });
  
  console.log('Waiting 7 seconds for posts...');
  await page.waitForTimeout(7000);
  
  const containers = await page.$$('div[role="article"]');
  console.log(`\nFound ${containers.length} containers\n`);
  
  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    console.log(`\n=== CONTAINER ${i + 1}/${containers.length} ===`);
    
    let text = '';
    for (const textSelector of selectors.postTextCandidates) {
      const textHandle = await container.$(textSelector);
      if (textHandle) {
        const candidate = (await textHandle.innerText())?.trim();
        console.log(`  Selector "${textSelector}": ${candidate ? candidate.length + ' chars' : 'no text'}`);
        if (candidate && candidate.length > text.length) {
          text = candidate;
        }
      } else {
        console.log(`  Selector "${textSelector}": not found`);
      }
    }
    
    console.log(`\n  FINAL TEXT: ${text.length} chars`);
    if (text) {
      console.log(`  Preview: ${text.substring(0, 100)}...`);
    }
    
    if (!text || text.length < 30) {
      console.log(`  ❌ REJECTED: Text too short (${text.length} chars)`);
    } else {
      console.log(`  ✅ PASSED: ${text.length} characters`);
    }
  }
  
  console.log('\n\n=== Try alternatives ===\n');
  
  const container = containers[0];
  if (container) {
    const alternatives = [
      'div[dir="auto"][style*="text-align"]',
      'span[dir="auto"]',
      '[dir="auto"]',
    ];
    
    for (const alt of alternatives) {
      const handles = await container.$$(alt);
      let foundText = false;
      for (const h of handles.slice(0, 3)) {
        const txt = await h.innerText();
        if (txt && txt.trim().length > 30) {
          console.log(`  ✓ "${alt}" works! Found: ${txt.trim().substring(0, 80)}...`);
          foundText = true;
          break;
        }
      }
      if (!foundText) {
        console.log(`  ✗ "${alt}" - no text`);
      }
    }
  }
  
  await browser.close();
})();
