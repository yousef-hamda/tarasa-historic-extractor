/**
 * Tests for the browser reaper — the root-cause fix for leaked Chromium
 * processes that exhausted the container's PIDs/FDs/memory until the site
 * stopped accepting connections.
 *
 * Two things matter most and are covered here:
 *   1. hardCloseBrowser NEVER hangs, even when browser.close() never resolves.
 *   2. When close() wedges, the tracked chrome process GROUP is SIGKILLed
 *      (verified with a Linux-simulated /proc via fs mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('browserReaper — no-hang guarantee & safe counters (current platform)', () => {
  it('hardCloseBrowser resolves even when close() never resolves', async () => {
    const { hardCloseBrowser } = await import('../src/utils/browserReaper');
    const wedged = { close: () => new Promise<void>(() => undefined) } as any; // never resolves
    const start = Date.now();
    await hardCloseBrowser(wedged, { timeoutMs: 100 });
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('hardCloseBrowser awaits a graceful close() that resolves', async () => {
    const { hardCloseBrowser } = await import('../src/utils/browserReaper');
    const close = vi.fn(async () => undefined);
    await hardCloseBrowser({ close } as any, { timeoutMs: 5000 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('hardCloseBrowser(null) is a no-op', async () => {
    const { hardCloseBrowser } = await import('../src/utils/browserReaper');
    await expect(hardCloseBrowser(null)).resolves.toBeUndefined();
  });

  it('counters never throw and return safe values', async () => {
    const mod = await import('../src/utils/browserReaper');
    await expect(mod.countOpenFds()).resolves.toBeTypeOf('number');
    await expect(mod.getOpenFdSoftLimit()).resolves.toBeTypeOf('number');
    await expect(mod.countStrayChromium()).resolves.toBeTypeOf('number');
    await expect(mod.countChromiumProcesses()).resolves.toBeTypeOf('number');
  });

  it('launchTracked returns the launched object and serializes concurrent launches', async () => {
    const { launchTracked } = await import('../src/utils/browserReaper');
    const a = { id: 'a', close: async () => undefined } as any;
    const b = { id: 'b', close: async () => undefined } as any;
    const [ra, rb] = await Promise.all([
      launchTracked(async () => a),
      launchTracked(async () => b),
    ]);
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });
});

describe('browserReaper — SIGKILLs a wedged browser process group (Linux-simulated)', () => {
  const SELF = process.pid;
  const ORIGINAL_PLATFORM = process.platform;
  let killSpy: ReturnType<typeof vi.spyOn>;
  let launched = false;

  beforeEach(() => {
    vi.resetModules();
    launched = false;

    // Simulate a Linux /proc where a single chrome MAIN process (pid 4242,
    // child of this node process) appears only AFTER the launch runs.
    vi.doMock('fs', () => ({
      promises: {
        readdir: vi.fn(async (p: string) => {
          if (p === '/proc') return launched ? ['4242', 'self', 'cpuinfo'] : ['self', 'cpuinfo'];
          if (p === '/proc/self/fd') return ['0', '1', '2'];
          return [];
        }),
        readFile: vi.fn(async (p: string) => {
          if (p === '/proc/4242/comm') return 'chrome\n';
          if (p === '/proc/4242/stat') return `4242 (chrome) S ${SELF} 1 1 0 -1 0`;
          if (p === '/proc/self/limits') {
            return 'Limit    Soft Limit  Hard Limit  Units\nMax open files  1024  1048576  files\n';
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      },
    }));
    vi.doMock('../src/utils/logger', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
    vi.doUnmock('fs');
    vi.resetModules();
  });

  it('group-kills the tracked chrome pid when close() hangs', async () => {
    const mod = await import('../src/utils/browserReaper');
    const wedged = {
      close: () => new Promise<void>(() => undefined), // never resolves
    } as any;

    // launchTracked records pid 4242 as this browser's main chrome process.
    const tracked = await mod.launchTracked(async () => {
      launched = true;
      return wedged;
    });

    await mod.hardCloseBrowser(tracked, { timeoutMs: 50 });

    // The whole process group must be SIGKILLed (negated pid).
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('reapStrayChromium kills untracked stray chrome, but never a tracked live browser', async () => {
    const mod = await import('../src/utils/browserReaper');

    // pid 4242 exists but is NOT tracked (no launchTracked) → it is a stray.
    launched = true;
    const killed = await mod.reapStrayChromium();
    expect(killed).toBe(1);
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');

    // Now track 4242 via launchTracked (it must appear as "fresh", so hide it
    // for the before-snapshot then reveal it during the launch). Once tracked it
    // must no longer be considered a stray.
    killSpy.mockClear();
    launched = false;
    await mod.launchTracked(async () => {
      launched = true;
      return { close: async () => undefined } as any;
    });
    const killedAfter = await mod.reapStrayChromium();
    expect(killedAfter).toBe(0);
    expect(killSpy).not.toHaveBeenCalled();
  });
});
