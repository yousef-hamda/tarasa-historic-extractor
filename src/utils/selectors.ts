import type { Page, ElementHandle } from 'playwright';

export type SelectorList = string | readonly string[];

type QueryRoot = Page | ElementHandle<unknown>;

type WaitOptions = Parameters<Page['waitForSelector']>[1];

const toArray = (input: SelectorList): string[] => {
  if (Array.isArray(input)) {
    return [...input];
  }
  return [input as string];
};

const querySingle = (root: QueryRoot, selector: string) => root.$(selector);

export const selectors = {
  loginEmail: ['input[name="email"]', '#email'],
  loginPassword: ['input[name="pass"]', '#pass'],
  loginButton: ['button[name="login"]', 'button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Log In")'],
  loginText: ['text="Log into Facebook"', 'text="Log in to Facebook"', 'text="Log In"'],
  twoFactorInput: ['input[name="approvals_code"]', 'input[autocomplete="one-time-code"]'],
  twoFactorText: ['text="Two-factor authentication"', 'text="Enter security code"', 'text="Enter the code"'],
  captchaText: ['text="security check"', 'text="captcha"', 'text="Confirm your identity"'],
  // Facebook Group Feed selectors (broadened for 2025 DOM changes)
  postContainer: [
    // Primary: explicit article roles within feed
    'div[role="feed"] div[role="article"]',
    // Alternate: pagelet feed units often wrap posts
    '[data-pagelet^="FeedUnit"] div[role="article"]',
    '[data-pagelet^="FeedUnit"] article',
    '[data-pagelet*="GroupFeed"] div[role="article"]',
    // Fallback: any article-like container that holds message preview content
    'div[role="feed"] div:has([data-ad-preview="message"])',
    'div[role="feed"] div:has([data-ad-comet-preview="message"])',
    // Last resort: generic article role anywhere in the page
    'article[role="article"]',
  ],
  postTextCandidates: [
    'div[data-ad-comet-preview="message"]',
    'div[data-ad-preview="message"]',
    'div[data-lexical-text="true"]',
    'div[dir="auto"][style*="text-align"]',
    'div.xdj266r.x11i5rnm.xat24cr.x1mh8g0r.x1vvkbs',
    'div[dir="auto"]',
    'span[dir="auto"]',
    'div[role="article"] div[dir="auto"]',
  ],
  // Author link selectors for Facebook profiles
  authorLink: [
    'h2 a[href*="/user/"]',
    'h2 a[href*="/profile.php"]',
    'h2 a[href^="https://www.facebook.com/profile.php?id="]',
    'h2 a[href^="/profile.php?id="]',
    'h3 a[href*="/user/"]',
    'h3 a[href*="/profile.php"]',
    'a[role="link"][href*="/people/"]',
    'a[role="link"][href*="/profile.php?id="]',
    'a[href*="facebook.com/people/"][href*="?id="]',
    'a[href*="facebook.com/people/"]',
    'a[role="link"][href*="/user/"]',
    'a[role="link"][href*="/profile.php"]',
    'a[role="link"][href*="/profile/"]',
    'a[href*="facebook.com/profile/"]',
    'span a[href*="facebook.com"][role="link"]',
    'strong a[href*="facebook.com"]',
    'a[href*="/groups/"][href*="/user/"]',
    'a[aria-label][href*="facebook.com"][href*="profile"]',
  ],
  // Author name selectors
  authorName: [
    'h2 a[role="link"] span',
    'h2 a span',
    'h3 a[role="link"] span',
    'h3 a span',
    'strong a',
    'span a[role="link"]',
    'a[role="link"] strong',
  ],
  messengerButtons: [
    '[aria-label="Message"]',
    '[aria-label="Send message"]',
    'div[role="button"]:has-text("Message")',
    'button:has-text("Message")',
    'button:has-text("Send message")',
    '[role="button"][aria-label*="message"]',
    'a[href*="/messages/"]',
    'a[href*="messenger.com"]',
  ],
  messengerTextarea: [
    'div[role="textbox"][contenteditable="true"]',
    'div[aria-label*="Message"]',
    'div[aria-label="Type a message"]',
    'div[aria-label="Type your message"]',
    'div[aria-label="Send a message"]',
    '[role="textbox"]',
    'div[role="textbox"][data-lexical-editor]',
    'textarea',
  ],
} as const;

export const findFirstHandle = async (root: QueryRoot, selectorList: SelectorList) => {
  for (const selector of toArray(selectorList)) {
    const handle = await querySingle(root, selector);
    if (handle) {
      return { selector, handle };
    }
  }
  return { selector: null, handle: null };
};

export const queryAllOnPage = async (page: Page, selectorList: SelectorList) => {
  for (const selector of toArray(selectorList)) {
    const handles = await page.$$(selector);
    if (handles.length) {
      return { selector, handles };
    }
  }
  return { selector: null, handles: [] };
};

export const waitForFirstMatchingSelector = async (
  page: Page,
  selectorList: SelectorList,
  options?: WaitOptions,
) => {
  for (const selector of toArray(selectorList)) {
    try {
      const handle = await page.waitForSelector(selector, options ?? {});
      if (handle) {
        return { selector, handle };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Unable to find selectors: ${toArray(selectorList).join(', ')}`);
};

export const clickFirstMatchingSelector = async (page: Page, selectorList: SelectorList) => {
  const errors: string[] = [];
  for (const selector of toArray(selectorList)) {
    try {
      await page.click(selector);
      return selector;
    } catch (error) {
      // Try next selector - expected when selector doesn't match
      errors.push(`${selector}: ${(error as Error).message}`);
      continue;
    }
  }
  throw new Error(`Unable to click selectors: ${toArray(selectorList).join(', ')}. Errors: ${errors.join('; ')}`);
};

export const fillFirstMatchingSelector = async (page: Page, selectorList: SelectorList, value: string) => {
  const errors: string[] = [];
  for (const selector of toArray(selectorList)) {
    try {
      await page.fill(selector, value);
      return selector;
    } catch (error) {
      // Try next selector - expected when selector doesn't match
      errors.push(`${selector}: ${(error as Error).message}`);
      continue;
    }
  }
  throw new Error(`Unable to fill selectors: ${toArray(selectorList).join(', ')}. Errors: ${errors.join('; ')}`);
};
