/**
 * Browser identity & egress configuration (anti-detection).
 *
 * Goal: present ONE consistent, Israel-resident desktop identity so the browser
 * fingerprint, the egress IP, and the Facebook account's own history all tell
 * the same story. Mismatches (e.g. a macOS UA on a Linux engine, or a US
 * datacenter IP under an Israeli account) are top-tier bot signals.
 *
 * Everything is env-overridable so the operator can match their real device /
 * proxy without code changes.
 */

// A clean desktop-Chrome User-Agent with NO "HeadlessChrome" token and NO OS
// lie — we report Linux, matching the actual engine. (A macOS UA on a Linux
// Chromium is a contradiction client-side JS can detect.) Override with
// FB_USER_AGENT to match your real device, e.g. a Windows or macOS Chrome UA if
// that is what you normally log in from.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const FB_USER_AGENT = process.env.FB_USER_AGENT || DEFAULT_USER_AGENT;
export const FB_TIMEZONE = process.env.FB_TIMEZONE || 'Asia/Jerusalem';
// Accept-Language is English-first ON PURPOSE so the FB UI stays in English and
// the scraper's English text checks ("See more", "Join group", "Content isn't
// available") keep working; Hebrew is still advertised as a secondary language.
export const FB_LOCALE = process.env.FB_LOCALE || 'en-US';
export const FB_ACCEPT_LANGUAGE =
  process.env.FB_ACCEPT_LANGUAGE || 'en-US,en;q=0.9,he;q=0.8';
// Jerusalem; harmless unless the page is granted geolocation permission.
export const FB_GEO = { latitude: 31.7683, longitude: 35.2137 };

/**
 * Optional egress proxy from env. Routes all browser traffic through an Israel
 * residential/mobile proxy instead of the raw datacenter IP. Returns undefined
 * (direct connection) when PROXY_SERVER is unset.
 */
export const getProxyConfig = ():
  | { server: string; username?: string; password?: string }
  | undefined => {
  const server = process.env.PROXY_SERVER;
  if (!server) return undefined;
  const username = process.env.PROXY_USERNAME;
  const password = process.env.PROXY_PASSWORD;
  return { server, ...(username ? { username } : {}), ...(password ? { password } : {}) };
};

/**
 * chromium.launch overrides that suppress the automation flags which make
 * navigator.webdriver === true, plus the optional proxy. Combined with the
 * --disable-blink-features=AutomationControlled launch arg, this removes the
 * single most reliable bot tell without the (itself-detectable)
 * navigator.webdriver getter-override hack.
 */
export const launchAntiDetectOverrides = () => {
  const proxy = getProxyConfig();
  return {
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
    ...(proxy ? { proxy } : {}),
  };
};

/** BrowserContext options that pin the Israel-resident desktop identity. */
export const israelContextOptions = () => ({
  userAgent: FB_USER_AGENT,
  locale: FB_LOCALE,
  timezoneId: FB_TIMEZONE,
  geolocation: FB_GEO,
  viewport: { width: 1366, height: 768 },
  extraHTTPHeaders: { 'Accept-Language': FB_ACCEPT_LANGUAGE },
});
