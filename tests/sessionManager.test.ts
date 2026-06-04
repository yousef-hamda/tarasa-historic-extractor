/**
 * Tests for the session-validation helpers.
 *
 * The critical case here is `isValidFbUserId('0') === false`. Before this
 * guard existed, the session-check cron would scrape a logged-out Facebook
 * homepage, find `"USER_ID":"0"` in the inline marketing JS, accept "0" as a
 * valid user id, and mark the session valid every 30 minutes — while the
 * scraper (which relies on the actual c_user cookie) failed every cycle. The
 * dashboard reported green health while no real work was happening. These
 * tests pin the helper so the regression can't return silently.
 */

import { describe, it, expect } from 'vitest';
import { isValidFbUserId } from '../src/session/sessionManager';

describe('isValidFbUserId', () => {
  it('rejects "0" (the marketing-page placeholder that caused the zombie-valid bug)', () => {
    expect(isValidFbUserId('0')).toBe(false);
  });

  it('rejects null / undefined / non-string', () => {
    expect(isValidFbUserId(null)).toBe(false);
    expect(isValidFbUserId(undefined)).toBe(false);
    expect(isValidFbUserId(undefined as unknown as string)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidFbUserId('')).toBe(false);
  });

  it('rejects ids shorter than 5 digits', () => {
    expect(isValidFbUserId('1')).toBe(false);
    expect(isValidFbUserId('12')).toBe(false);
    expect(isValidFbUserId('1234')).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(isValidFbUserId('abc')).toBe(false);
    expect(isValidFbUserId('123abc')).toBe(false);
    expect(isValidFbUserId('123 456')).toBe(false);
  });

  it('accepts real-shaped Facebook user ids', () => {
    // The actual id we saw in prod author links during the QA pass.
    expect(isValidFbUserId('61590486385909')).toBe(true);
    // Another real-shaped id from the QA pass.
    expect(isValidFbUserId('100001297662050')).toBe(true);
  });

  it('accepts the 5-digit floor (legacy-account safety)', () => {
    expect(isValidFbUserId('12345')).toBe(true);
  });
});
