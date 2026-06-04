/**
 * CSV building helpers, extracted from the search-export route so the same
 * escaping (including formula-injection guard) is reused by the email-export
 * route. Pure — no external deps, easy to unit-test, no side effects.
 */

/**
 * Escape a single CSV cell value. Handles:
 *   - null/undefined → empty string
 *   - leading `=+-@\t\r` → prefix with `'` to defuse Excel formula injection
 *   - embedded comma / quote / newline → wrap in quotes and double inner quotes
 */
export const escapeCSV = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes("'")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Render headers + rows into a CSV string. Each row is an array of cell
 * values (any shape — they get coerced via String()). Includes a trailing
 * newline so common parsers handle the last row cleanly.
 */
export const buildCsv = (headers: string[], rows: unknown[][]): string => {
  const lines: string[] = [headers.map(escapeCSV).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(','));
  }
  return lines.join('\n') + '\n';
};
