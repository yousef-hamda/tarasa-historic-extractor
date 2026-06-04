import { useEffect, useRef } from 'react';

/**
 * Re-runs `callback` every `intervalMs` while the page is visible. Pauses
 * automatically when the tab is in the background and fires once immediately
 * on unhide so the user sees fresh data the moment they switch back.
 *
 * Use for any page that should show new posts / messages / logs without the
 * user needing to manually click Refresh. Default cadence (15s) is a good
 * baseline: long enough to avoid hammering the API, short enough that the
 * dashboard feels live.
 *
 *   useAutoRefresh(loadPosts);          // every 15s
 *   useAutoRefresh(loadPosts, 30_000);  // every 30s
 *
 * The callback is called via a ref so a re-render that produces a new
 * function identity doesn't reset the interval — important because pages
 * usually wrap their fetcher in useCallback whose deps change as state moves.
 */
export const useAutoRefresh = (
  callback: () => void,
  intervalMs: number = 15_000,
): void => {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => cbRef.current();

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Fire immediately on focus return so the user doesn't wait a full
        // interval to see fresh data.
        tick();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [intervalMs]);
};
