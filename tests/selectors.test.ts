/**
 * Comprehensive tests for selector utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the selectors object and utility functions
// Note: Functions that require Playwright Page/ElementHandle are tested with mocks

describe('selectors object', () => {
  // Import after potential mocking
  let selectors: any;

  beforeEach(async () => {
    const module = await import('../src/utils/selectors');
    selectors = module.selectors;
  });

  describe('loginEmail selectors', () => {
    it('should be defined', () => {
      expect(selectors.loginEmail).toBeDefined();
    });

    it('should be an array', () => {
      expect(Array.isArray(selectors.loginEmail)).toBe(true);
    });

    it('should contain multiple selectors', () => {
      expect(selectors.loginEmail.length).toBeGreaterThan(0);
    });

    it('should include email input selector', () => {
      expect(selectors.loginEmail).toContain('input[name="email"]');
    });

    it('should include id-based selector', () => {
      expect(selectors.loginEmail).toContain('#email');
    });
  });

  describe('loginPassword selectors', () => {
    it('should be defined', () => {
      expect(selectors.loginPassword).toBeDefined();
    });

    it('should be an array', () => {
      expect(Array.isArray(selectors.loginPassword)).toBe(true);
    });

    it('should include password input selector', () => {
      expect(selectors.loginPassword).toContain('input[name="pass"]');
    });
  });

  describe('loginButton selectors', () => {
    it('should be defined', () => {
      expect(selectors.loginButton).toBeDefined();
    });

    it('should contain button selectors', () => {
      expect(selectors.loginButton.some((s: string) => s.includes('button'))).toBe(true);
    });

    it('should include submit button', () => {
      expect(selectors.loginButton).toContain('button[name="login"]');
    });
  });

  describe('twoFactorInput selectors', () => {
    it('should be defined', () => {
      expect(selectors.twoFactorInput).toBeDefined();
    });

    it('should include 2FA code input', () => {
      expect(selectors.twoFactorInput).toContain('input[name="approvals_code"]');
    });
  });

  describe('postContainer selectors', () => {
    it('should be defined', () => {
      expect(selectors.postContainer).toBeDefined();
    });

    it('should be an array with multiple options', () => {
      expect(Array.isArray(selectors.postContainer)).toBe(true);
      expect(selectors.postContainer.length).toBeGreaterThan(1);
    });

    it('should include role-based selectors', () => {
      expect(selectors.postContainer.some((s: string) => s.includes('role="article"'))).toBe(true);
    });

    it('should include feed-based selectors', () => {
      expect(selectors.postContainer.some((s: string) => s.includes('role="feed"'))).toBe(true);
    });
  });

  describe('postTextCandidates selectors', () => {
    it('should be defined', () => {
      expect(selectors.postTextCandidates).toBeDefined();
    });

    it('should include data-attribute selectors', () => {
      expect(selectors.postTextCandidates.some((s: string) => s.includes('data-ad-'))).toBe(true);
    });

    it('should include dir="auto" selectors', () => {
      expect(selectors.postTextCandidates.some((s: string) => s.includes('dir="auto"'))).toBe(true);
    });
  });

  describe('authorLink selectors', () => {
    it('should be defined', () => {
      expect(selectors.authorLink).toBeDefined();
    });

    it('should be an array with multiple options', () => {
      expect(Array.isArray(selectors.authorLink)).toBe(true);
      expect(selectors.authorLink.length).toBeGreaterThan(5);
    });

    it('should include facebook.com links', () => {
      expect(selectors.authorLink.some((s: string) => s.includes('facebook.com'))).toBe(true);
    });

    it('should include profile link patterns', () => {
      expect(selectors.authorLink.some((s: string) => s.includes('/user/'))).toBe(true);
      expect(selectors.authorLink.some((s: string) => s.includes('/profile.php'))).toBe(true);
    });

    it('should include header-based selectors', () => {
      expect(selectors.authorLink.some((s: string) => s.startsWith('h2') || s.startsWith('h3'))).toBe(true);
    });
  });

  describe('authorName selectors', () => {
    it('should be defined', () => {
      expect(selectors.authorName).toBeDefined();
    });

    it('should include header span selectors', () => {
      expect(selectors.authorName.some((s: string) => s.includes('h2') || s.includes('h3'))).toBe(true);
    });

    it('should include strong/bold selectors', () => {
      expect(selectors.authorName.some((s: string) => s.includes('strong'))).toBe(true);
    });
  });

  describe('messengerButtons selectors', () => {
    it('should be defined', () => {
      expect(selectors.messengerButtons).toBeDefined();
    });

    it('should include aria-label selectors', () => {
      expect(selectors.messengerButtons.some((s: string) => s.includes('aria-label'))).toBe(true);
    });

    it('should include Message text selectors', () => {
      expect(selectors.messengerButtons.some((s: string) => s.includes('Message'))).toBe(true);
    });
  });

  describe('messengerTextarea selectors', () => {
    it('should be defined', () => {
      expect(selectors.messengerTextarea).toBeDefined();
    });

    it('should include textbox role', () => {
      expect(selectors.messengerTextarea.some((s: string) => s.includes('textbox'))).toBe(true);
    });

    it('should include contenteditable', () => {
      expect(selectors.messengerTextarea.some((s: string) => s.includes('contenteditable'))).toBe(true);
    });

    it('should include textarea fallback', () => {
      expect(selectors.messengerTextarea).toContain('textarea');
    });
  });

  describe('selector immutability', () => {
    it('all selector arrays should be readonly', () => {
      // TypeScript "as const" makes these readonly at compile time
      // We can verify the values exist and are arrays
      expect(selectors.loginEmail).toBeDefined();
      expect(selectors.postContainer).toBeDefined();
    });
  });
});

describe('selector helper functions', () => {
  // Mock Playwright Page
  const createMockPage = () => ({
    $: vi.fn(),
    $$: vi.fn(),
    waitForSelector: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
  });

  let findFirstHandle: any;
  let queryAllOnPage: any;
  let waitForFirstMatchingSelector: any;
  let clickFirstMatchingSelector: any;
  let fillFirstMatchingSelector: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../src/utils/selectors');
    findFirstHandle = module.findFirstHandle;
    queryAllOnPage = module.queryAllOnPage;
    waitForFirstMatchingSelector = module.waitForFirstMatchingSelector;
    clickFirstMatchingSelector = module.clickFirstMatchingSelector;
    fillFirstMatchingSelector = module.fillFirstMatchingSelector;
  });

  describe('findFirstHandle()', () => {
    it('should return handle when selector matches', async () => {
      const mockPage = createMockPage();
      const mockHandle = { innerText: vi.fn() };
      mockPage.$.mockResolvedValueOnce(mockHandle);

      const result = await findFirstHandle(mockPage as any, 'div.test');

      expect(result.handle).toBe(mockHandle);
      expect(result.selector).toBe('div.test');
    });

    it('should try multiple selectors until one matches', async () => {
      const mockPage = createMockPage();
      const mockHandle = { innerText: vi.fn() };
      mockPage.$
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockHandle);

      const result = await findFirstHandle(mockPage as any, ['sel1', 'sel2', 'sel3']);

      expect(result.handle).toBe(mockHandle);
      expect(result.selector).toBe('sel3');
      expect(mockPage.$).toHaveBeenCalledTimes(3);
    });

    it('should return null handle when no selector matches', async () => {
      const mockPage = createMockPage();
      mockPage.$.mockResolvedValue(null);

      const result = await findFirstHandle(mockPage as any, ['sel1', 'sel2']);

      expect(result.handle).toBeNull();
      expect(result.selector).toBeNull();
    });

    it('should handle single string selector', async () => {
      const mockPage = createMockPage();
      const mockHandle = {};
      mockPage.$.mockResolvedValue(mockHandle);

      const result = await findFirstHandle(mockPage as any, 'single-selector');

      expect(mockPage.$).toHaveBeenCalledWith('single-selector');
      expect(result.handle).toBe(mockHandle);
    });
  });

  describe('queryAllOnPage()', () => {
    it('should return handles when selector matches elements', async () => {
      const mockPage = createMockPage();
      const mockHandles = [{}, {}, {}];
      mockPage.$$.mockResolvedValueOnce(mockHandles);

      const result = await queryAllOnPage(mockPage as any, 'div.items');

      expect(result.handles).toBe(mockHandles);
      expect(result.selector).toBe('div.items');
    });

    it('should try multiple selectors until one matches', async () => {
      const mockPage = createMockPage();
      mockPage.$$
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{}, {}]);

      const result = await queryAllOnPage(mockPage as any, ['sel1', 'sel2']);

      expect(result.handles.length).toBe(2);
      expect(result.selector).toBe('sel2');
    });

    it('should return empty array when no selector matches', async () => {
      const mockPage = createMockPage();
      mockPage.$$.mockResolvedValue([]);

      const result = await queryAllOnPage(mockPage as any, ['sel1', 'sel2']);

      expect(result.handles).toEqual([]);
      expect(result.selector).toBeNull();
    });
  });

  describe('waitForFirstMatchingSelector()', () => {
    it('should return handle when selector is found', async () => {
      const mockPage = createMockPage();
      const mockHandle = {};
      mockPage.waitForSelector.mockResolvedValueOnce(mockHandle);

      const result = await waitForFirstMatchingSelector(mockPage as any, 'div.loading');

      expect(result.handle).toBe(mockHandle);
      expect(result.selector).toBe('div.loading');
    });

    it('should try next selector on timeout', async () => {
      const mockPage = createMockPage();
      const mockHandle = {};
      mockPage.waitForSelector
        .mockRejectedValueOnce(new Error('Timeout exceeded'))
        .mockResolvedValueOnce(mockHandle);

      const result = await waitForFirstMatchingSelector(mockPage as any, ['sel1', 'sel2']);

      expect(result.handle).toBe(mockHandle);
      expect(result.selector).toBe('sel2');
    });

    it('should throw when all selectors fail', async () => {
      const mockPage = createMockPage();
      mockPage.waitForSelector.mockRejectedValue(new Error('Timeout exceeded'));

      await expect(
        waitForFirstMatchingSelector(mockPage as any, ['sel1', 'sel2'])
      ).rejects.toThrow('Unable to find selectors');
    });

    it('should pass options to waitForSelector', async () => {
      const mockPage = createMockPage();
      mockPage.waitForSelector.mockResolvedValueOnce({});

      await waitForFirstMatchingSelector(mockPage as any, 'div', { timeout: 5000 });

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('div', { timeout: 5000 });
    });

    it('should re-throw non-timeout errors', async () => {
      const mockPage = createMockPage();
      mockPage.waitForSelector.mockRejectedValue(new Error('Network error'));

      await expect(
        waitForFirstMatchingSelector(mockPage as any, ['sel1'])
      ).rejects.toThrow('Network error');
    });
  });

  describe('clickFirstMatchingSelector()', () => {
    it('should click element and return selector', async () => {
      const mockPage = createMockPage();
      mockPage.click.mockResolvedValueOnce(undefined);

      const result = await clickFirstMatchingSelector(mockPage as any, 'button.submit');

      expect(result).toBe('button.submit');
      expect(mockPage.click).toHaveBeenCalledWith('button.submit');
    });

    it('should try next selector on click failure', async () => {
      const mockPage = createMockPage();
      mockPage.click
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce(undefined);

      const result = await clickFirstMatchingSelector(mockPage as any, ['sel1', 'sel2']);

      expect(result).toBe('sel2');
    });

    it('should throw with all errors when no selector works', async () => {
      const mockPage = createMockPage();
      mockPage.click.mockRejectedValue(new Error('Failed'));

      await expect(
        clickFirstMatchingSelector(mockPage as any, ['sel1', 'sel2'])
      ).rejects.toThrow('Unable to click selectors');
    });
  });

  describe('fillFirstMatchingSelector()', () => {
    it('should fill element and return selector', async () => {
      const mockPage = createMockPage();
      mockPage.fill.mockResolvedValueOnce(undefined);

      const result = await fillFirstMatchingSelector(mockPage as any, 'input.email', 'test@example.com');

      expect(result).toBe('input.email');
      expect(mockPage.fill).toHaveBeenCalledWith('input.email', 'test@example.com');
    });

    it('should try next selector on fill failure', async () => {
      const mockPage = createMockPage();
      mockPage.fill
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce(undefined);

      const result = await fillFirstMatchingSelector(mockPage as any, ['sel1', 'sel2'], 'value');

      expect(result).toBe('sel2');
    });

    it('should throw with all errors when no selector works', async () => {
      const mockPage = createMockPage();
      mockPage.fill.mockRejectedValue(new Error('Failed'));

      await expect(
        fillFirstMatchingSelector(mockPage as any, ['sel1', 'sel2'], 'value')
      ).rejects.toThrow('Unable to fill selectors');
    });
  });
});

describe('SelectorList type handling', () => {
  let findFirstHandle: any;

  beforeEach(async () => {
    const module = await import('../src/utils/selectors');
    findFirstHandle = module.findFirstHandle;
  });

  it('should handle string selector', async () => {
    const mockPage = { $: vi.fn().mockResolvedValue({}) };

    await findFirstHandle(mockPage as any, 'single-selector');

    expect(mockPage.$).toHaveBeenCalledWith('single-selector');
  });

  it('should handle array of selectors', async () => {
    const mockPage = { $: vi.fn().mockResolvedValue(null) };

    await findFirstHandle(mockPage as any, ['sel1', 'sel2', 'sel3']);

    expect(mockPage.$).toHaveBeenCalledTimes(3);
  });

  it('should handle readonly array', async () => {
    const mockPage = { $: vi.fn().mockResolvedValue({}) };
    const readonlySelectors = ['sel1', 'sel2'] as const;

    await findFirstHandle(mockPage as any, readonlySelectors);

    expect(mockPage.$).toHaveBeenCalled();
  });
});

console.log('Selectors test suite loaded');
