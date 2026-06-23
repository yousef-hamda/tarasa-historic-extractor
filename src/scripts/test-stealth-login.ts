/**
 * One-off probe: run stealthRefreshFacebookSession() and report the outcome.
 *
 * Run with:
 *   npx ts-node src/scripts/test-stealth-login.ts
 *
 * Outputs JSON on success, exits non-zero on failure. Deliberately verbose so
 * we can diagnose exactly where FB rejects (if it does).
 */

import 'dotenv/config';
import { stealthRefreshFacebookSession } from '../facebook/session';

(async () => {
  const t0 = Date.now();
  console.log('[TEST] Calling stealthRefreshFacebookSession()...');
  try {
    const result = await stealthRefreshFacebookSession();
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[TEST] Returned after ${elapsedSec}s:`, JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[TEST] Threw after ${elapsedSec}s:`, err);
    process.exit(2);
  }
})();
