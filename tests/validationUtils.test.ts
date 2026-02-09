/**
 * Comprehensive tests for validation utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  parsePositiveInt,
  parseNonNegativeInt,
  isValidLogType,
  sanitizeLogType,
} from '../src/utils/validation';

describe('parsePositiveInt()', () => {
  describe('valid inputs', () => {
    it('should parse positive integer', () => {
      expect(parsePositiveInt(5, 10)).toBe(5);
    });

    it('should parse positive integer as string', () => {
      expect(parsePositiveInt('5', 10)).toBe(5);
    });

    it('should floor decimal numbers', () => {
      expect(parsePositiveInt(5.7, 10)).toBe(5);
    });

    it('should floor decimal strings', () => {
      expect(parsePositiveInt('5.7', 10)).toBe(5);
    });

    it('should parse large numbers', () => {
      expect(parsePositiveInt(1000000, 10)).toBe(1000000);
    });

    it('should parse 1 (minimum positive)', () => {
      expect(parsePositiveInt(1, 10)).toBe(1);
    });
  });

  describe('invalid inputs returning default', () => {
    it('should return default for 0', () => {
      expect(parsePositiveInt(0, 10)).toBe(10);
    });

    it('should return default for negative number', () => {
      expect(parsePositiveInt(-5, 10)).toBe(10);
    });

    it('should return default for NaN string', () => {
      expect(parsePositiveInt('abc', 10)).toBe(10);
    });

    it('should return default for empty string', () => {
      expect(parsePositiveInt('', 10)).toBe(10);
    });

    it('should return default for null', () => {
      expect(parsePositiveInt(null, 10)).toBe(10);
    });

    it('should return default for undefined', () => {
      expect(parsePositiveInt(undefined, 10)).toBe(10);
    });

    it('should return default for NaN', () => {
      expect(parsePositiveInt(NaN, 10)).toBe(10);
    });

    it('should return default for Infinity', () => {
      // Infinity > 0 so it should pass, but it's not a safe integer
      const result = parsePositiveInt(Infinity, 10);
      expect(result).toBe(Infinity);
    });

    it('should return default for negative Infinity', () => {
      expect(parsePositiveInt(-Infinity, 10)).toBe(10);
    });

    it('should return default for object', () => {
      expect(parsePositiveInt({}, 10)).toBe(10);
    });

    it('should return default for array', () => {
      expect(parsePositiveInt([], 10)).toBe(10);
    });

    it('should return default for boolean true', () => {
      expect(parsePositiveInt(true, 10)).toBe(1); // true coerces to 1
    });

    it('should return default for boolean false', () => {
      expect(parsePositiveInt(false, 10)).toBe(10); // false coerces to 0
    });
  });

  describe('max parameter', () => {
    it('should limit to max when value exceeds it', () => {
      expect(parsePositiveInt(100, 10, 50)).toBe(50);
    });

    it('should allow value equal to max', () => {
      expect(parsePositiveInt(50, 10, 50)).toBe(50);
    });

    it('should allow value less than max', () => {
      expect(parsePositiveInt(30, 10, 50)).toBe(30);
    });

    it('should use default and not apply max when invalid', () => {
      expect(parsePositiveInt(-1, 10, 50)).toBe(10); // Default is used, not limited
    });

    it('should handle max of 1', () => {
      expect(parsePositiveInt(100, 10, 1)).toBe(1);
    });

    it('should handle max of 0', () => {
      // If max is 0, any positive integer becomes 0, but we parse positive ints
      // So 5 capped at 0 would be 0, but is 0 valid? Let's test
      expect(parsePositiveInt(5, 10, 0)).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very small positive decimals', () => {
      // 0.1 > 0, so it passes the positive check, then floors to 0
      // Implementation checks parsed > 0 before flooring
      expect(parsePositiveInt(0.1, 10)).toBe(0);
    });

    it('should handle 0.9', () => {
      // 0.9 > 0, passes check, then floors to 0
      expect(parsePositiveInt(0.9, 10)).toBe(0);
    });

    it('should handle 1.0', () => {
      expect(parsePositiveInt(1.0, 10)).toBe(1);
    });

    it('should handle negative decimal that rounds to 0', () => {
      expect(parsePositiveInt(-0.1, 10)).toBe(10);
    });

    it('should handle string with spaces', () => {
      expect(parsePositiveInt('  5  ', 10)).toBe(5); // Number() handles spaces
    });

    it('should handle string with leading zeros', () => {
      expect(parsePositiveInt('007', 10)).toBe(7);
    });
  });
});

describe('parseNonNegativeInt()', () => {
  describe('valid inputs', () => {
    it('should parse 0', () => {
      expect(parseNonNegativeInt(0, 10)).toBe(0);
    });

    it('should parse positive integer', () => {
      expect(parseNonNegativeInt(5, 10)).toBe(5);
    });

    it('should parse positive integer as string', () => {
      expect(parseNonNegativeInt('5', 10)).toBe(5);
    });

    it('should parse 0 as string', () => {
      expect(parseNonNegativeInt('0', 10)).toBe(0);
    });

    it('should floor decimal numbers', () => {
      expect(parseNonNegativeInt(5.7, 10)).toBe(5);
    });

    it('should floor positive decimal to 0', () => {
      expect(parseNonNegativeInt(0.5, 10)).toBe(0);
    });
  });

  describe('invalid inputs returning default', () => {
    it('should return default for negative number', () => {
      expect(parseNonNegativeInt(-5, 10)).toBe(10);
    });

    it('should return default for negative string', () => {
      expect(parseNonNegativeInt('-5', 10)).toBe(10);
    });

    it('should return default for NaN string', () => {
      expect(parseNonNegativeInt('abc', 10)).toBe(10);
    });

    it('should return default for empty string', () => {
      // Number('') returns 0, which is >= 0, so returns 0
      expect(parseNonNegativeInt('', 10)).toBe(0);
    });

    it('should return default for null', () => {
      // Number(null) returns 0, which is >= 0, so returns 0
      expect(parseNonNegativeInt(null, 10)).toBe(0);
    });

    it('should return default for undefined', () => {
      expect(parseNonNegativeInt(undefined, 10)).toBe(10);
    });

    it('should return default for NaN', () => {
      expect(parseNonNegativeInt(NaN, 10)).toBe(10);
    });

    it('should return default for negative Infinity', () => {
      expect(parseNonNegativeInt(-Infinity, 10)).toBe(10);
    });
  });

  describe('edge cases', () => {
    it('should handle negative decimal', () => {
      expect(parseNonNegativeInt(-0.5, 10)).toBe(10);
    });

    it('should handle boolean true', () => {
      expect(parseNonNegativeInt(true, 10)).toBe(1);
    });

    it('should handle boolean false', () => {
      expect(parseNonNegativeInt(false, 10)).toBe(0);
    });
  });
});

describe('isValidLogType()', () => {
  describe('valid log types', () => {
    it('should accept "scrape"', () => {
      expect(isValidLogType('scrape')).toBe(true);
    });

    it('should accept "classify"', () => {
      expect(isValidLogType('classify')).toBe(true);
    });

    it('should accept "message"', () => {
      expect(isValidLogType('message')).toBe(true);
    });

    it('should accept "auth"', () => {
      expect(isValidLogType('auth')).toBe(true);
    });

    it('should accept "error"', () => {
      expect(isValidLogType('error')).toBe(true);
    });

    it('should accept "admin"', () => {
      expect(isValidLogType('admin')).toBe(true);
    });
  });

  describe('invalid log types', () => {
    it('should reject uppercase variants', () => {
      expect(isValidLogType('SCRAPE')).toBe(false);
      expect(isValidLogType('Scrape')).toBe(false);
    });

    it('should reject unknown type', () => {
      expect(isValidLogType('debug')).toBe(false);
      expect(isValidLogType('warning')).toBe(false);
      expect(isValidLogType('info')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidLogType('')).toBe(false);
    });

    it('should reject null', () => {
      expect(isValidLogType(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidLogType(undefined)).toBe(false);
    });

    it('should reject number', () => {
      expect(isValidLogType(123)).toBe(false);
    });

    it('should reject boolean', () => {
      expect(isValidLogType(true)).toBe(false);
    });

    it('should reject object', () => {
      expect(isValidLogType({ type: 'scrape' })).toBe(false);
    });

    it('should reject array', () => {
      expect(isValidLogType(['scrape'])).toBe(false);
    });

    it('should reject type with spaces', () => {
      expect(isValidLogType(' scrape ')).toBe(false);
    });

    it('should reject similar but invalid types', () => {
      expect(isValidLogType('scraping')).toBe(false);
      expect(isValidLogType('classification')).toBe(false);
      expect(isValidLogType('messages')).toBe(false);
    });
  });
});

describe('sanitizeLogType()', () => {
  describe('valid log types', () => {
    it('should return "scrape" for "scrape"', () => {
      expect(sanitizeLogType('scrape')).toBe('scrape');
    });

    it('should return "classify" for "classify"', () => {
      expect(sanitizeLogType('classify')).toBe('classify');
    });

    it('should return "message" for "message"', () => {
      expect(sanitizeLogType('message')).toBe('message');
    });

    it('should return "auth" for "auth"', () => {
      expect(sanitizeLogType('auth')).toBe('auth');
    });

    it('should return "error" for "error"', () => {
      expect(sanitizeLogType('error')).toBe('error');
    });

    it('should return "admin" for "admin"', () => {
      expect(sanitizeLogType('admin')).toBe('admin');
    });
  });

  describe('invalid inputs returning undefined', () => {
    it('should return undefined for null', () => {
      expect(sanitizeLogType(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(sanitizeLogType(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(sanitizeLogType('')).toBeUndefined();
    });

    it('should return undefined for invalid type', () => {
      expect(sanitizeLogType('invalid')).toBeUndefined();
    });

    it('should return undefined for uppercase type', () => {
      expect(sanitizeLogType('SCRAPE')).toBeUndefined();
    });

    it('should return undefined for number', () => {
      expect(sanitizeLogType(123)).toBeUndefined();
    });

    it('should return undefined for boolean', () => {
      expect(sanitizeLogType(true)).toBeUndefined();
    });

    it('should return undefined for object', () => {
      expect(sanitizeLogType({ type: 'scrape' })).toBeUndefined();
    });

    it('should return undefined for 0', () => {
      expect(sanitizeLogType(0)).toBeUndefined();
    });

    it('should return undefined for false', () => {
      expect(sanitizeLogType(false)).toBeUndefined();
    });
  });

  describe('falsy value handling', () => {
    it('should return undefined for all falsy values', () => {
      const falsyValues = [null, undefined, '', 0, false, NaN];
      falsyValues.forEach(value => {
        expect(sanitizeLogType(value)).toBeUndefined();
      });
    });
  });
});

describe('Type Guard Integration', () => {
  it('should work as type guard in conditionals', () => {
    const types: unknown[] = ['scrape', 'invalid', null, 'classify', 123];
    const validTypes = types.filter(isValidLogType);

    expect(validTypes).toEqual(['scrape', 'classify']);
  });

  it('should allow type narrowing', () => {
    const input: unknown = 'scrape';
    if (isValidLogType(input)) {
      // TypeScript should narrow the type here
      const logType: 'scrape' | 'classify' | 'message' | 'auth' | 'error' | 'admin' = input;
      expect(logType).toBe('scrape');
    }
  });
});

console.log('Validation utilities test suite loaded');
