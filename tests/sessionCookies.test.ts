/**
 * Tests for the cookie-save guard that prevents self-inflicted Facebook
 * session loss (the "session dies after ~1 day" bug).
 *
 * Root cause being guarded: saveCookies() ran after every scrape/message and
 * blindly overwrote the canonical cookie store (and its DB mirror) with
 * whatever the live context held — including logged-out responses Facebook
 * serves to datacenter IPs, and public-group scrapes that carry no auth
 * cookies. That destroyed the good session until a manual re-upload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted so the vi.mock factories can reference them) -------------
const { prismaMock, fsMock } = vi.hoisted(() => ({
  prismaMock: {
    sessionState: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
  fsMock: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/utils/systemLog', () => ({ logSystemEvent: vi.fn() }));
vi.mock('../src/utils/alerts', () => ({ sendAlertEmail: vi.fn() }));
vi.mock('../src/database/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { cookiesCarryValidSession, saveCookies } from '../src/facebook/session';

const FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // +30 days
const PAST = Math.floor(Date.now() / 1000) - 60; // 1 min ago

const cookie = (name: string, value: string, expires?: number) => ({
  name,
  value,
  domain: '.facebook.com',
  path: '/',
  ...(expires !== undefined ? { expires } : {}),
});

const LOGGED_IN = [
  cookie('c_user', '61590486385909', FUTURE),
  cookie('xs', 'abc123sessionsecret', FUTURE),
  cookie('datr', 'datrvalue', FUTURE),
  cookie('sb', 'sbvalue', FUTURE),
];

// What Facebook leaves behind after a logged-out / checkpoint response: the
// account/session cookies are gone, but anon fingerprint cookies remain.
const LOGGED_OUT = [
  cookie('datr', 'datrvalue', FUTURE),
  cookie('sb', 'sbvalue', FUTURE),
  cookie('fr', 'frvalue', FUTURE),
];

const fakeContext = (cookies: unknown[]) =>
  ({ cookies: vi.fn().mockResolvedValue(cookies) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sessionState.findFirst.mockResolvedValue(null);
  fsMock.writeFile.mockResolvedValue(undefined);
});

describe('cookiesCarryValidSession', () => {
  it('accepts a set with non-expired c_user + xs', () => {
    expect(cookiesCarryValidSession(LOGGED_IN as never)).toBe(true);
  });

  it('accepts session cookies with no expiry field (session-scoped)', () => {
    expect(
      cookiesCarryValidSession([cookie('c_user', '12345'), cookie('xs', 'secret')] as never)
    ).toBe(true);
  });

  it('rejects a logged-out set (no c_user / xs)', () => {
    expect(cookiesCarryValidSession(LOGGED_OUT as never)).toBe(false);
  });

  it('rejects when xs is expired', () => {
    expect(
      cookiesCarryValidSession([
        cookie('c_user', '61590486385909', FUTURE),
        cookie('xs', 'secret', PAST),
      ] as never)
    ).toBe(false);
  });

  it('rejects when c_user is missing', () => {
    expect(
      cookiesCarryValidSession([cookie('xs', 'secret', FUTURE)] as never)
    ).toBe(false);
  });

  it('rejects empty / non-array input', () => {
    expect(cookiesCarryValidSession([] as never)).toBe(false);
    expect(cookiesCarryValidSession(undefined as never)).toBe(false);
  });

  it('rejects when xs value is empty even if present', () => {
    expect(
      cookiesCarryValidSession([
        cookie('c_user', '61590486385909', FUTURE),
        cookie('xs', '', FUTURE),
      ] as never)
    ).toBe(false);
  });
});

describe('saveCookies guard', () => {
  it('persists when the live context still has a valid session', async () => {
    await saveCookies(fakeContext(LOGGED_IN));
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    // DB mirror attempted too
    expect(prismaMock.sessionState.findFirst).toHaveBeenCalled();
  });

  it('does NOT overwrite a stored good session with a logged-out context', async () => {
    // Stored cookies on disk ARE a valid session.
    fsMock.readFile.mockResolvedValue(JSON.stringify(LOGGED_IN));
    await saveCookies(fakeContext(LOGGED_OUT));
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(prismaMock.sessionState.update).not.toHaveBeenCalled();
    expect(prismaMock.sessionState.create).not.toHaveBeenCalled();
  });

  it('still saves a logged-out/public set when no good session is stored', async () => {
    // No file on disk and no DB cookies → nothing valuable to protect.
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'));
    prismaMock.sessionState.findFirst.mockResolvedValue(null);
    await saveCookies(fakeContext(LOGGED_OUT));
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the context has zero cookies', async () => {
    await saveCookies(fakeContext([]));
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });
});
