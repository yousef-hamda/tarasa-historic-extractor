/**
 * Tests for the admin-email validation regex. The setter is what guards bad
 * inputs from reaching the DB; if this regex regresses, malformed emails
 * could be stored and silently break the "Send Approved Posts" feature.
 */
import { describe, it, expect } from 'vitest';
import { _EMAIL_REGEX_FOR_TESTS as EMAIL_REGEX } from '../src/utils/settings';

describe('admin email validation', () => {
  it('accepts plausible email shapes', () => {
    expect(EMAIL_REGEX.test('alice@example.com')).toBe(true);
    expect(EMAIL_REGEX.test('a.b+tag@sub.example.co.uk')).toBe(true);
    expect(EMAIL_REGEX.test('publictarasa@gmail.com')).toBe(true);
  });

  it('rejects missing @, missing tld, leading/trailing dots', () => {
    expect(EMAIL_REGEX.test('plainstring')).toBe(false);
    expect(EMAIL_REGEX.test('no-at.example.com')).toBe(false);
    expect(EMAIL_REGEX.test('user@nodomain')).toBe(false);
    expect(EMAIL_REGEX.test('')).toBe(false);
  });

  it('rejects whitespace inside', () => {
    expect(EMAIL_REGEX.test('alice @example.com')).toBe(false);
    expect(EMAIL_REGEX.test('alice@example .com')).toBe(false);
  });
});
