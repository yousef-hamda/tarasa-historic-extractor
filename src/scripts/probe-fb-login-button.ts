/**
 * One-off probe: open facebook.com, dump every button-like element so we can
 * see what selector to use for the login submit button on the current FB DOM.
 */

import 'dotenv/config';

(async () => {
  const { createStealthBrowser, safeCloseBrowser } = await import('../scraper/stealthBrowser');
  const { context } = await createStealthBrowser({ headless: true, useRealChrome: false });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 3000));

    const candidates = await page.evaluate(() => {
      const items: Array<{ tag: string; type: string | null; name: string | null; value: string | null; text: string; ariaLabel: string | null; dataTestid: string | null; role: string | null }> = [];
      document.querySelectorAll('button, input[type="submit"], div[role="button"]').forEach((el) => {
        items.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          value: el.getAttribute('value'),
          text: (el.textContent || '').trim().slice(0, 60),
          ariaLabel: el.getAttribute('aria-label'),
          dataTestid: el.getAttribute('data-testid'),
          role: el.getAttribute('role'),
        });
      });
      return items;
    });

    console.log(JSON.stringify(candidates, null, 2));
  } finally {
    await safeCloseBrowser(context);
  }
})();
