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
  loginButton: ['button[name="login"]', 'button:has-text("Log in")'],
  loginText: ['text="Log into Facebook"', 'text="Log in to Facebook"'],
  twoFactorInput: ['input[name="approvals_code"]'],
  twoFactorText: ['text="Two-factor authentication"', 'text="Enter security code"'],
  captchaText: ['text="security check"', 'text="captcha"'],
  postContainer: ['div[role="article"]', 'div[data-pagelet^="FeedUnit_"]'],
  postTextCandidates: ['div[data-ad-comet-preview]', 'div[dir="auto"]', 'div[data-ad-preview="message"]'],
  authorLink: ['strong a[href*="facebook.com"]', 'a[href*="/people/"]'],
  authorName: ['strong a', 'h4 a', 'span a[role="link"]'],
  messengerButtons: ['[aria-label="Message"]', 'button:has-text("Message")', 'a[href*="messages"]'],
  messengerTextarea: ['textarea', '[role="textbox"]'],
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
  for (const selector of toArray(selectorList)) {
    try {
      await page.click(selector);
      return selector;
    } catch {
      continue;
    }
  }
  throw new Error(`Unable to click selectors: ${toArray(selectorList).join(', ')}`);
};

export const fillFirstMatchingSelector = async (page: Page, selectorList: SelectorList, value: string) => {
  for (const selector of toArray(selectorList)) {
    try {
      await page.fill(selector, value);
      return selector;
    } catch {
      continue;
    }
  }
  throw new Error(`Unable to fill selectors: ${toArray(selectorList).join(', ')}`);
};
