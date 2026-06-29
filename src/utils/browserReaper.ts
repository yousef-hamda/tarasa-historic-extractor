/**
 * Browser Reaper — guarantee Chromium processes never outlive their scrape.
 *
 * ---------------------------------------------------------------------------
 * ROOT-CAUSE FIX for the recurring "site dies after ~23h" outage.
 *
 *   The scraper launches a fresh Chromium per group and tore it down ONLY via
 *   `await browser.close()`. Under Railway memory pressure a wedged Chromium's
 *   close() hangs forever, so the OS process (+ its zygote/gpu/renderer
 *   children and their file descriptors) LEAKS. Over a day these accumulate
 *   until the container runs out of PIDs / FDs / memory:
 *       fork() -> EAGAIN, new DB sockets fail, accept() fails -> the port
 *       stops answering entirely (curl returns http_code=000, not a 502).
 *
 *   The self-heal memory watchdog never caught it because it measured
 *   process.memoryUsage().rss — the NODE process only — while the leak lived
 *   in separate chrome OS processes it could not see.
 *
 *   Playwright's public `Browser` type does NOT expose the underlying process,
 *   so we capture the chrome MAIN pid ourselves at launch (via launchTracked)
 *   and SIGKILL its process group on a wedged close. Playwright spawns chrome
 *   `detached` (a process-group leader), so killing the negated pid reaps the
 *   whole tree — main + gpu + zygote + renderers — with no orphans.
 *
 *   Mechanisms:
 *     • launchTracked()     — wrap a chromium.launch / launchPersistentContext
 *                              so we record the new chrome MAIN pid(s) for the
 *                              returned Browser/Context.
 *     • hardCloseBrowser()  — race close() against a timeout, then group-SIGKILL
 *                              the tracked pid(s) so a hung close() can never
 *                              leave a zombie behind.
 *     • reapStrayChromium() — kill ONLY untracked strays/orphans (chrome whose
 *                              parent is this node process but is no longer a
 *                              live tracked browser, or chrome reparented to
 *                              init). Safe to call anytime — it never touches a
 *                              legitimately-active tracked browser.
 *     • countStrayChromium()/countOpenFds() — the real leak signals the health
 *                              watchdog now restarts on.
 * ---------------------------------------------------------------------------
 */

import { promises as fsp } from 'fs';
import type { Browser, BrowserContext } from 'playwright';
import logger from './logger';

export type ClosableBrowser = Browser | BrowserContext | null | undefined;

// How long to wait for a graceful close() before we SIGKILL the chrome process.
const HARD_CLOSE_TIMEOUT_MS = Number(process.env.HARD_CLOSE_TIMEOUT_MS) || 10_000;

// Matches the chrome family of process names seen in the Playwright Docker image.
const CHROMIUM_NAME_RE = /(chrome|chromium|headless_shell)/i;

const isLinux = process.platform === 'linux';
const SELF_PID = process.pid;

// Main chrome pids for currently-live, properly-tracked browsers. A browser's
// pids are added on launchTracked and removed on hardCloseBrowser. The reaper
// uses this to distinguish "leaked stray" from "legitimately running".
const livePids = new Set<number>();
// Map a Browser/Context object -> its main chrome pid(s), so hardCloseBrowser
// knows exactly which process group to kill on a wedged close.
const pidMap = new WeakMap<object, number[]>();

// -------------------------------------------------------------------------
// /proc helpers (Linux only; all return safe defaults elsewhere)
// -------------------------------------------------------------------------

/** Read a process's parent pid from /proc/<pid>/stat (field 4). */
const getPpid = async (pid: number): Promise<number> => {
  try {
    const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf-8');
    // comm (field 2) is wrapped in parens and may contain spaces/parens, so
    // parse the fields AFTER the final ')'. Then [0]=state, [1]=ppid.
    const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return Number(after[1]) || 0;
  } catch {
    return 0;
  }
};

/** List all live chrome-family pids in this container (excludes self). */
const listChromiumPids = async (): Promise<number[]> => {
  if (!isLinux) return [];
  let dirs: string[];
  try {
    dirs = await fsp.readdir('/proc');
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const d of dirs) {
    const pid = Number(d);
    if (!Number.isInteger(pid) || pid === SELF_PID) continue;
    try {
      const comm = (await fsp.readFile(`/proc/${pid}/comm`, 'utf-8')).trim();
      if (CHROMIUM_NAME_RE.test(comm)) pids.push(pid);
    } catch {
      // vanished between readdir and read — fine
    }
  }
  return pids;
};

/** Chrome MAIN browser processes: direct children of this node process. */
const listChromiumMainPids = async (): Promise<number[]> => {
  const pids = await listChromiumPids();
  const out: number[] = [];
  for (const pid of pids) {
    if ((await getPpid(pid)) === SELF_PID) out.push(pid);
  }
  return out;
};

// -------------------------------------------------------------------------
// Killing
// -------------------------------------------------------------------------

/**
 * SIGKILL a chrome MAIN process and its whole process group. Playwright spawns
 * chrome detached, so the negated-pid kill reaps gpu/zygote/renderers too.
 * Killing an already-dead pid throws ESRCH, which we swallow.
 */
const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGKILL'); // whole group (main + helpers)
  } catch {
    // not a group leader / already gone — fall back to the bare pid
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
};

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

// Serialize launches so the pid-diff window of one launch can't overlap
// another's (which would mis-attribute a new chrome to the wrong Browser).
let launchChain: Promise<unknown> = Promise.resolve();

/**
 * Wrap a chromium launch so we can attribute its chrome MAIN pid(s) to the
 * returned Browser/BrowserContext. Use for every browser the long-running
 * service opens. Returns exactly what `launch` returns.
 *
 * Falls back gracefully on non-Linux / if the diff captures nothing — in that
 * case hardCloseBrowser still does a bounded graceful close and the watchdog's
 * stray reaper is the backstop.
 */
export const launchTracked = async <T extends Browser | BrowserContext>(
  launch: () => Promise<T>,
): Promise<T> => {
  const run = async (): Promise<T> => {
    const before = new Set(isLinux ? await listChromiumMainPids() : []);
    const obj = await launch();
    if (isLinux) {
      const after = await listChromiumMainPids();
      const fresh = after.filter((p) => !before.has(p));
      if (fresh.length) {
        pidMap.set(obj, fresh);
        fresh.forEach((p) => livePids.add(p));
      }
    }
    return obj;
  };
  // Chain so launches run one-at-a-time through the diff window. Keep the chain
  // alive even when a launch rejects, so one failure can't poison the queue.
  const result = launchChain.then(run, run) as Promise<T>;
  launchChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

/** Forget a browser's tracked pids (call when we know it is gone). */
const forget = (browser: object | null | undefined): number[] => {
  if (!browser) return [];
  const pids = pidMap.get(browser) ?? [];
  pidMap.delete(browser);
  pids.forEach((p) => livePids.delete(p));
  return pids;
};

/**
 * Close a browser/context and GUARANTEE its chrome process group is dead.
 *
 * Races browser.close() against HARD_CLOSE_TIMEOUT_MS. If close() wins, trust it
 * (and drop the tracked pids). If the timeout wins (a wedged chrome), SIGKILL
 * the tracked process group so the chrome can never leak. Always resolves.
 */
export const hardCloseBrowser = async (
  browser: ClosableBrowser,
  opts: { timeoutMs?: number } = {},
): Promise<void> => {
  if (!browser) return;
  const timeoutMs = opts.timeoutMs ?? HARD_CLOSE_TIMEOUT_MS;
  const trackedPids = pidMap.get(browser) ?? [];

  let timer: NodeJS.Timeout | undefined;
  const closedGracefully = await Promise.race([
    Promise.resolve(browser.close())
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  if (!closedGracefully) {
    if (trackedPids.length) {
      logger.warn(
        `[Reaper] browser.close() did not finish within ${timeoutMs}ms — ` +
          `SIGKILLing chrome process group(s) ${trackedPids.join(',')} to prevent a leak.`,
      );
      trackedPids.forEach(killGroup);
    } else {
      logger.warn(
        `[Reaper] browser.close() did not finish within ${timeoutMs}ms and no pid was ` +
          `tracked — the watchdog stray reaper will collect it.`,
      );
    }
  }

  // Whether it closed or we killed it, the browser is no longer live.
  forget(browser);
};

/**
 * Count open file descriptors for this process (/proc/self/fd). -1 if unknown.
 */
export const countOpenFds = async (): Promise<number> => {
  if (!isLinux) return -1;
  try {
    return (await fsp.readdir('/proc/self/fd')).length;
  } catch {
    return -1;
  }
};

/** Soft limit for open files from /proc/self/limits. -1 if unknown. */
export const getOpenFdSoftLimit = async (): Promise<number> => {
  if (!isLinux) return -1;
  try {
    const text = await fsp.readFile('/proc/self/limits', 'utf-8');
    const line = text.split('\n').find((l) => l.startsWith('Max open files'));
    if (!line) return -1;
    const soft = line.replace('Max open files', '').trim().split(/\s+/)[0];
    if (soft === 'unlimited') return -1;
    const n = Number(soft);
    return Number.isFinite(n) && n > 0 ? n : -1;
  } catch {
    return -1;
  }
};

/**
 * Identify leaked stray chrome MAIN processes: chrome whose parent is this node
 * process but which is NOT a live tracked browser (lost/leftover), OR chrome
 * reparented to init (ppid===1, an orphan whose parent died). A tracked live
 * browser's main pid is excluded, and its helper/renderer children have a chrome
 * parent (not node, not init) so they are never miscounted.
 */
const listStrayChromiumMains = async (): Promise<number[]> => {
  if (!isLinux) return [];
  const pids = await listChromiumPids();
  const strays: number[] = [];
  for (const pid of pids) {
    if (livePids.has(pid)) continue;
    const ppid = await getPpid(pid);
    if (ppid === SELF_PID || ppid === 1) strays.push(pid);
  }
  return strays;
};

/** Count leaked stray chrome processes. The watchdog's primary leak signal. */
export const countStrayChromium = async (): Promise<number> => {
  return (await listStrayChromiumMains()).length;
};

/** Total live chrome-family processes (for logging/diagnostics only). */
export const countChromiumProcesses = async (): Promise<number> => {
  return (await listChromiumPids()).length;
};

/**
 * Kill leaked stray chrome processes (and their groups). SAFE to call anytime:
 * it never targets a live tracked browser, so a concurrent legitimate scrape /
 * messenger / session-check browser is untouched. Returns the count killed.
 */
export const reapStrayChromium = async (): Promise<number> => {
  const strays = await listStrayChromiumMains();
  if (strays.length === 0) return 0;
  for (const pid of strays) killGroup(pid);
  logger.warn(`[Reaper] reapStrayChromium SIGKILLed ${strays.length} stray chrome process group(s).`);
  return strays.length;
};
