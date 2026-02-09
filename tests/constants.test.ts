/**
 * Comprehensive tests for configuration constants
 */

import { describe, it, expect } from 'vitest';
import {
  TIMEOUTS,
  DELAYS,
  API_TIMEOUTS,
  BATCH_SIZES,
  QUOTA,
  URLS,
} from '../src/config/constants';

describe('TIMEOUTS', () => {
  describe('PAGE_DEFAULT', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.PAGE_DEFAULT).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.PAGE_DEFAULT).toBe('number');
      expect(TIMEOUTS.PAGE_DEFAULT).toBeGreaterThan(0);
    });

    it('should be at least 30 seconds', () => {
      expect(TIMEOUTS.PAGE_DEFAULT).toBeGreaterThanOrEqual(30000);
    });

    it('should not exceed 5 minutes', () => {
      expect(TIMEOUTS.PAGE_DEFAULT).toBeLessThanOrEqual(300000);
    });
  });

  describe('NAVIGATION', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.NAVIGATION).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.NAVIGATION).toBe('number');
      expect(TIMEOUTS.NAVIGATION).toBeGreaterThan(0);
    });

    it('should be equal to or greater than PAGE_DEFAULT', () => {
      expect(TIMEOUTS.NAVIGATION).toBeGreaterThanOrEqual(TIMEOUTS.PAGE_DEFAULT);
    });
  });

  describe('ELEMENT_WAIT', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.ELEMENT_WAIT).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.ELEMENT_WAIT).toBe('number');
      expect(TIMEOUTS.ELEMENT_WAIT).toBeGreaterThan(0);
    });

    it('should be less than PAGE_DEFAULT', () => {
      expect(TIMEOUTS.ELEMENT_WAIT).toBeLessThan(TIMEOUTS.PAGE_DEFAULT);
    });
  });

  describe('SHORT_WAIT', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.SHORT_WAIT).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.SHORT_WAIT).toBe('number');
      expect(TIMEOUTS.SHORT_WAIT).toBeGreaterThan(0);
    });

    it('should be less than ELEMENT_WAIT', () => {
      expect(TIMEOUTS.SHORT_WAIT).toBeLessThan(TIMEOUTS.ELEMENT_WAIT);
    });
  });

  describe('DEBUG', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.DEBUG).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.DEBUG).toBe('number');
      expect(TIMEOUTS.DEBUG).toBeGreaterThan(0);
    });
  });

  describe('FEED_LOAD', () => {
    it('should be defined', () => {
      expect(TIMEOUTS.FEED_LOAD).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof TIMEOUTS.FEED_LOAD).toBe('number');
      expect(TIMEOUTS.FEED_LOAD).toBeGreaterThan(0);
    });
  });

  describe('Timeout hierarchy', () => {
    it('should have sensible timeout progression', () => {
      expect(TIMEOUTS.SHORT_WAIT).toBeLessThan(TIMEOUTS.ELEMENT_WAIT);
      expect(TIMEOUTS.ELEMENT_WAIT).toBeLessThanOrEqual(TIMEOUTS.FEED_LOAD);
      expect(TIMEOUTS.FEED_LOAD).toBeLessThan(TIMEOUTS.DEBUG);
      expect(TIMEOUTS.DEBUG).toBeLessThanOrEqual(TIMEOUTS.PAGE_DEFAULT);
    });
  });
});

describe('DELAYS', () => {
  describe('MIN and MAX', () => {
    it('MIN should be defined and positive', () => {
      expect(DELAYS.MIN).toBeDefined();
      expect(typeof DELAYS.MIN).toBe('number');
      expect(DELAYS.MIN).toBeGreaterThan(0);
    });

    it('MAX should be defined and positive', () => {
      expect(DELAYS.MAX).toBeDefined();
      expect(typeof DELAYS.MAX).toBe('number');
      expect(DELAYS.MAX).toBeGreaterThan(0);
    });

    it('MAX should be greater than or equal to MIN', () => {
      expect(DELAYS.MAX).toBeGreaterThanOrEqual(DELAYS.MIN);
    });
  });

  describe('SHORT delays', () => {
    it('SHORT_MIN should be defined', () => {
      expect(DELAYS.SHORT_MIN).toBeDefined();
      expect(typeof DELAYS.SHORT_MIN).toBe('number');
    });

    it('SHORT_MAX should be defined', () => {
      expect(DELAYS.SHORT_MAX).toBeDefined();
      expect(typeof DELAYS.SHORT_MAX).toBe('number');
    });

    it('SHORT_MAX should be greater than SHORT_MIN', () => {
      expect(DELAYS.SHORT_MAX).toBeGreaterThan(DELAYS.SHORT_MIN);
    });

    it('SHORT delays should be less than standard delays', () => {
      expect(DELAYS.SHORT_MAX).toBeLessThanOrEqual(DELAYS.MAX);
    });
  });

  describe('MEDIUM delays', () => {
    it('MEDIUM_MIN should be defined', () => {
      expect(DELAYS.MEDIUM_MIN).toBeDefined();
      expect(typeof DELAYS.MEDIUM_MIN).toBe('number');
    });

    it('MEDIUM_MAX should be defined', () => {
      expect(DELAYS.MEDIUM_MAX).toBeDefined();
      expect(typeof DELAYS.MEDIUM_MAX).toBe('number');
    });

    it('MEDIUM_MAX should be greater than MEDIUM_MIN', () => {
      expect(DELAYS.MEDIUM_MAX).toBeGreaterThan(DELAYS.MEDIUM_MIN);
    });

    it('MEDIUM delays should be between SHORT and LONG', () => {
      expect(DELAYS.MEDIUM_MIN).toBeGreaterThanOrEqual(DELAYS.SHORT_MIN);
      expect(DELAYS.MEDIUM_MAX).toBeLessThanOrEqual(DELAYS.LONG_MAX);
    });
  });

  describe('LONG delays', () => {
    it('LONG_MIN should be defined', () => {
      expect(DELAYS.LONG_MIN).toBeDefined();
      expect(typeof DELAYS.LONG_MIN).toBe('number');
    });

    it('LONG_MAX should be defined', () => {
      expect(DELAYS.LONG_MAX).toBeDefined();
      expect(typeof DELAYS.LONG_MAX).toBe('number');
    });

    it('LONG_MAX should be greater than LONG_MIN', () => {
      expect(DELAYS.LONG_MAX).toBeGreaterThan(DELAYS.LONG_MIN);
    });

    it('LONG delays should be the longest', () => {
      expect(DELAYS.LONG_MIN).toBeGreaterThanOrEqual(DELAYS.MEDIUM_MIN);
    });
  });

  describe('Delay progression', () => {
    it('should have sensible delay progression', () => {
      expect(DELAYS.SHORT_MIN).toBeLessThanOrEqual(DELAYS.MEDIUM_MIN);
      expect(DELAYS.MEDIUM_MIN).toBeLessThanOrEqual(DELAYS.LONG_MIN);
      expect(DELAYS.SHORT_MAX).toBeLessThanOrEqual(DELAYS.MEDIUM_MAX);
      expect(DELAYS.MEDIUM_MAX).toBeLessThanOrEqual(DELAYS.LONG_MAX);
    });
  });
});

describe('API_TIMEOUTS', () => {
  describe('FETCH', () => {
    it('should be defined', () => {
      expect(API_TIMEOUTS.FETCH).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof API_TIMEOUTS.FETCH).toBe('number');
      expect(API_TIMEOUTS.FETCH).toBeGreaterThan(0);
    });

    it('should be at least 10 seconds', () => {
      expect(API_TIMEOUTS.FETCH).toBeGreaterThanOrEqual(10000);
    });

    it('should not exceed 2 minutes', () => {
      expect(API_TIMEOUTS.FETCH).toBeLessThanOrEqual(120000);
    });
  });

  describe('OPENAI', () => {
    it('should be defined', () => {
      expect(API_TIMEOUTS.OPENAI).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof API_TIMEOUTS.OPENAI).toBe('number');
      expect(API_TIMEOUTS.OPENAI).toBeGreaterThan(0);
    });

    it('should be greater than or equal to FETCH timeout', () => {
      expect(API_TIMEOUTS.OPENAI).toBeGreaterThanOrEqual(API_TIMEOUTS.FETCH);
    });
  });
});

describe('BATCH_SIZES', () => {
  describe('SCRAPE_MIN and SCRAPE_MAX', () => {
    it('SCRAPE_MIN should be defined and positive', () => {
      expect(BATCH_SIZES.SCRAPE_MIN).toBeDefined();
      expect(typeof BATCH_SIZES.SCRAPE_MIN).toBe('number');
      expect(BATCH_SIZES.SCRAPE_MIN).toBeGreaterThan(0);
    });

    it('SCRAPE_MAX should be defined and positive', () => {
      expect(BATCH_SIZES.SCRAPE_MAX).toBeDefined();
      expect(typeof BATCH_SIZES.SCRAPE_MAX).toBe('number');
      expect(BATCH_SIZES.SCRAPE_MAX).toBeGreaterThan(0);
    });

    it('SCRAPE_MAX should be greater than or equal to SCRAPE_MIN', () => {
      expect(BATCH_SIZES.SCRAPE_MAX).toBeGreaterThanOrEqual(BATCH_SIZES.SCRAPE_MIN);
    });

    it('SCRAPE_MIN should be at least 1', () => {
      expect(BATCH_SIZES.SCRAPE_MIN).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CLASSIFY', () => {
    it('should be defined and positive', () => {
      expect(BATCH_SIZES.CLASSIFY).toBeDefined();
      expect(typeof BATCH_SIZES.CLASSIFY).toBe('number');
      expect(BATCH_SIZES.CLASSIFY).toBeGreaterThan(0);
    });
  });

  describe('GENERATE', () => {
    it('should be defined and positive', () => {
      expect(BATCH_SIZES.GENERATE).toBeDefined();
      expect(typeof BATCH_SIZES.GENERATE).toBe('number');
      expect(BATCH_SIZES.GENERATE).toBeGreaterThan(0);
    });
  });
});

describe('QUOTA', () => {
  describe('DEFAULT_MAX_PER_DAY', () => {
    it('should be defined', () => {
      expect(QUOTA.DEFAULT_MAX_PER_DAY).toBeDefined();
    });

    it('should be a positive integer', () => {
      expect(typeof QUOTA.DEFAULT_MAX_PER_DAY).toBe('number');
      expect(QUOTA.DEFAULT_MAX_PER_DAY).toBeGreaterThan(0);
      expect(Number.isInteger(QUOTA.DEFAULT_MAX_PER_DAY)).toBe(true);
    });
  });

  describe('WINDOW_MS', () => {
    it('should be defined', () => {
      expect(QUOTA.WINDOW_MS).toBeDefined();
    });

    it('should be a positive number', () => {
      expect(typeof QUOTA.WINDOW_MS).toBe('number');
      expect(QUOTA.WINDOW_MS).toBeGreaterThan(0);
    });

    it('should equal 24 hours in milliseconds', () => {
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      expect(QUOTA.WINDOW_MS).toBe(twentyFourHoursMs);
    });
  });
});

describe('URLS', () => {
  describe('DEFAULT_TARASA', () => {
    it('should be defined', () => {
      expect(URLS.DEFAULT_TARASA).toBeDefined();
    });

    it('should be a string', () => {
      expect(typeof URLS.DEFAULT_TARASA).toBe('string');
    });

    it('should be a valid URL', () => {
      expect(() => new URL(URLS.DEFAULT_TARASA)).not.toThrow();
    });

    it('should use HTTPS protocol', () => {
      const url = new URL(URLS.DEFAULT_TARASA);
      expect(url.protocol).toBe('https:');
    });

    it('should contain tarasa.me domain', () => {
      const url = new URL(URLS.DEFAULT_TARASA);
      expect(url.hostname).toBe('tarasa.me');
    });
  });
});

describe('Constants type safety', () => {
  it('TIMEOUTS should have readonly properties', () => {
    // TypeScript's "as const" makes properties readonly at compile time
    // We verify the values exist and are correct types
    expect(typeof TIMEOUTS.PAGE_DEFAULT).toBe('number');
    expect(typeof TIMEOUTS.NAVIGATION).toBe('number');
    expect(typeof TIMEOUTS.ELEMENT_WAIT).toBe('number');
  });

  it('DELAYS should have readonly properties', () => {
    expect(typeof DELAYS.MIN).toBe('number');
    expect(typeof DELAYS.MAX).toBe('number');
  });

  it('API_TIMEOUTS should have readonly properties', () => {
    expect(typeof API_TIMEOUTS.FETCH).toBe('number');
    expect(typeof API_TIMEOUTS.OPENAI).toBe('number');
  });

  it('BATCH_SIZES should have readonly properties', () => {
    expect(typeof BATCH_SIZES.SCRAPE_MIN).toBe('number');
    expect(typeof BATCH_SIZES.CLASSIFY).toBe('number');
  });

  it('QUOTA should have readonly properties', () => {
    expect(typeof QUOTA.DEFAULT_MAX_PER_DAY).toBe('number');
    expect(typeof QUOTA.WINDOW_MS).toBe('number');
  });

  it('URLS should have readonly properties', () => {
    expect(typeof URLS.DEFAULT_TARASA).toBe('string');
  });
});

describe('Constants sanity checks', () => {
  it('all timeout values should be reasonable for web scraping', () => {
    // Timeouts should not be too short (would cause failures)
    expect(TIMEOUTS.PAGE_DEFAULT).toBeGreaterThanOrEqual(30000);
    expect(TIMEOUTS.NAVIGATION).toBeGreaterThanOrEqual(30000);
    expect(TIMEOUTS.ELEMENT_WAIT).toBeGreaterThanOrEqual(5000);

    // Timeouts should not be too long (would waste resources)
    expect(TIMEOUTS.PAGE_DEFAULT).toBeLessThanOrEqual(600000);
    expect(TIMEOUTS.NAVIGATION).toBeLessThanOrEqual(600000);
  });

  it('all delay values should provide human-like behavior', () => {
    // Delays should be at least 1 second for human simulation
    expect(DELAYS.MIN).toBeGreaterThanOrEqual(1000);

    // Delays should not be too long (would be too slow)
    expect(DELAYS.MAX).toBeLessThanOrEqual(30000);
  });

  it('batch sizes should be practical', () => {
    // Should process at least 1 item
    expect(BATCH_SIZES.SCRAPE_MIN).toBeGreaterThanOrEqual(1);
    expect(BATCH_SIZES.CLASSIFY).toBeGreaterThanOrEqual(1);
    expect(BATCH_SIZES.GENERATE).toBeGreaterThanOrEqual(1);

    // Should not be too large (memory/API limits)
    expect(BATCH_SIZES.SCRAPE_MAX).toBeLessThanOrEqual(1000);
    expect(BATCH_SIZES.CLASSIFY).toBeLessThanOrEqual(100);
    expect(BATCH_SIZES.GENERATE).toBeLessThanOrEqual(100);
  });

  it('quota should be reasonable for daily operation', () => {
    // Should allow at least 1 message per day
    expect(QUOTA.DEFAULT_MAX_PER_DAY).toBeGreaterThanOrEqual(1);

    // Should not allow spam (too many messages)
    expect(QUOTA.DEFAULT_MAX_PER_DAY).toBeLessThanOrEqual(1000);
  });
});

console.log('Constants test suite loaded');
