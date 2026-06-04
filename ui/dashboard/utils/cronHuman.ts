/**
 * Translate a cron expression into a short human phrase like "every 5 minutes".
 *
 * Only handles the shapes the speed presets actually emit:
 *   - `*\/N * * * *`   → "every N minutes" (every 1m → "every minute")
 *   - `* * * * *`      → "every minute"
 *   - `0 N * * *`      → "daily at HH:00"
 *   - `0 N * * D`      → "weekly on <day> at HH:00"
 *
 * Falls back to the raw expression for anything else. Raw cron strings are
 * confusing for operators ("what does `*\/5 * * * *` mean?") — translating
 * them is the difference between "I trust this UI" and "I'll ignore it".
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const cronToHuman = (expr: string): string => {
  if (!expr || typeof expr !== 'string') return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, mon, dow] = parts;

  // "every minute"
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'every minute';
  }

  // "every N minutes"
  const everyN = /^\*\/(\d+)$/.exec(min);
  if (everyN && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = parseInt(everyN[1], 10);
    if (n === 1) return 'every minute';
    return `every ${n} minutes`;
  }

  // "daily at HH:00" or "weekly on <day> at HH:00"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
    const m = parseInt(min, 10).toString().padStart(2, '0');
    const h = parseInt(hour, 10).toString().padStart(2, '0');
    if (dow === '*') return `daily at ${h}:${m}`;
    if (/^\d+$/.test(dow)) {
      const day = WEEKDAYS[parseInt(dow, 10) % 7] ?? dow;
      return `weekly on ${day} at ${h}:${m}`;
    }
  }

  return expr;
};
