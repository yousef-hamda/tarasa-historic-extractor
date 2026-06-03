# Tarasa Historic Extractor — Handoff Notes

A snapshot of the project's deployment state, recent work, and known caveats,
so a fresh chat (or a new developer) can pick up exactly where the current
session ended.

Last updated: 2026-06-03

---

## 1. What this project is

- Node.js / TypeScript backend + Next.js 14 dashboard, single Docker image.
- Scrapes posts from Israeli Facebook history groups → classifies them with
  OpenAI as **substantive historical stories** vs. not → generates outreach
  messages in the same language as the post → sends them via Messenger.
- PostgreSQL via Prisma, Redis for cron locks & rate limiting.
- ~30 source modules, 846 unit tests, multi-language dashboard (en / he / ar).

Full architecture details live in [`README.md`](./README.md).

---

## 2. Where it's deployed

- **Hosting:** Railway, single container, Dockerfile-based build.
- **Domain:** https://tarasa-history.com
- **Backup domain:** https://tarasa-historic-extractor-production.up.railway.app
- **Database:** Railway Postgres (referenced via `${{Postgres.DATABASE_URL}}`).
- **Cache:** Railway Redis (referenced via `${{Redis.REDIS_URL}}`).
- **GitHub:** https://github.com/yousef-hamda/tarasa-historic-extractor
- **Default branch:** `main`. Each push to `main` triggers a Railway redeploy
  (typical build time 4–10 min; 12+ min usually means a layer-cache miss
  triggering a fresh Playwright Chromium install).

---

## 3. The work shipped in the most recent session (2026-06-02 → 2026-06-03)

This session re-architected session renewal, fixed several scraper data-quality
bugs, and added cross-cutting reliability improvements. Commits in order:

| Commit | What it does |
|---|---|
| `512b6ec` | **Credentials modal for renewal.** Replaced the env-var-only renewal flow with an in-dashboard modal that takes FB email + password (+ optional 2FA code) per-attempt. Any user with the dashboard's API key can renew without Railway-side setup. |
| `f60d040` | Always-visible **"Plan B" escape hatch** in the credentials modal — small link "Don't want to log in here? Paste your Facebook cookies instead". Hands off to the Cookie-Editor paste modal at any time, including mid-2FA. |
| `7e19385` | **Three credentials-modal polish fixes:** (1) clear browser cookies before each stealth login attempt so stale state from a failed attempt doesn't bounce the next attempt to a 2FA page; (2) detect when FB rejects the submitted 2FA code (URL still on `/two_step_verification/`) and surface a clear "code was wrong" message; (3) render 2FA errors inside the yellow box next to the input, not as a separate red banner below. |
| `7472044` | **The scraper bug.** `playwrightScraper.ts:103` opened the FB context with `publicGroupMode: true`, which threw away the user's session cookies. FB then served login walls and the scraper silently extracted 0 posts. Now: probes `getCookieHealth()`, uses cookies when a session exists, falls back to public-only mode otherwise. Also added per-group failures to `systemLog` (previously stdout-only), and switched `orchestrator.ts` from `isSessionValid()` (in-memory flag) to `getCookieHealth()` (actual cookie probe). |
| `cff14ec` | **Session-check fix:** `createPersistentBrowser` in `sessionManager.ts` loaded cookies from `browser-data/storage-state.json` only — not from `src/config/cookies.json`. So 30 minutes after a successful renewal, the session-check cron would mark the session invalid because it launched a browser with no cookies. Now merges cookies.json into the persistent context. |
| `7c78263` | **System-wide reliability pass.** Messenger Send button: confirm Enter cleared the textarea, fall back to a Send button scoped to the active chat container with force-click + 5s timeout. `/api/trigger-scrape` now acquires the same `withLock('scrape')` lock the cron uses (no double-runs). `consecutiveErrors` counter on `GroupInfo` so a single transient blip doesn't mark a group inaccessible forever (threshold 3). **Cookies mirrored to Postgres `SessionState.cookiesJson`** — survive Railway's ephemeral container filesystem across redeploys. `POST /api/debug/circuit-breakers/reset` endpoint + "Reset OpenAI Breaker" button on the Settings page. Per-group scrape success now reaches `systemLog`. |
| `82b9dda` | **Post deduplication.** Investigation showed the same FB post was scraped twice (same author, same text body, only different "X minutes ago" timestamp at end). `generateContentHash` was hashing the full text including the timestamp, producing two different hashes for one real post. Now `stripTimeAgoSuffix()` strips the trailing time-indicator line (English `4m`/`13m`, Hebrew `לפני 5 דקות`, Arabic) before hashing. **Messenger gained a 30-day author-level cooldown** (`MESSAGE_AUTHOR_COOLDOWN_DAYS` env var) — never message the same authorLink twice within the window even if the dedup misses. |
| `589bec8` | **Scraper data quality + 4 UI bugs.** `shouldSkipPost()` filter before upsert: drops posts whose `authorLink` resolves to the logged-in user (the extractor was picking up the user's own avatar from page chrome), drops posts with no author at all, drops posts whose text starts with known group-rule patterns ("Please be respectful…", "When posting photographs…", "הקבוצה מיועדת…"). Improved "See more" expansion (whitespace normalization, 1500ms wait, 20-char prefix match instead of 30). Groups stuck at `accessMethod='none'` fixed — Playwright catch block now ALWAYS updates the cache, not just on access-keyword errors. **Delete All Data** fixed — frontend now sends the required `X-Confirm-Delete: DELETE-ALL-DATA` header. **Run Full Diagnostics** fixed — switched from broken SSE/EventSource (couldn't set auth header) to POST via apiFetch. **Groups Refresh** got visible spinner + "Last refreshed" timestamp + cache-bust query param. |
| `651fe0b` | Logs page error message: replaced misleading "Make sure API is running on port 4000" with "Usually transient — most often happens during a Railway redeploy. Click Retry." |
| `22ccef4` | **Tightened classifier prompt.** Old prompt was permissive ("references historical events, personal memories, stories about community history") and was scoring event announcements / "share your photos" requests / one-line captions as 80-90% historic. New prompt is explicit: confidence >75 requires ALL of narrative + specificity + substance + personal/community memory. Lists concrete NEGATIVE examples that must score ≤75 (event listings, group rules, share-requests, captions, etc.). Generator threshold also tightened from `>=75` to `>75`. |

---

## 4. Current state of session renewal (resolved as of this session)

The previous handoff described this as an "unresolved problem". It's now in
the best place it can be without paying for a residential proxy. There are
**two complementary paths**:

### Path A — Credentials modal (the primary path)

User clicks **Renew Session** on Settings → modal asks for FB email + password
(+ optional 2FA code, hidden by default behind an "I have 2FA enabled" link).
Backend uses `stealthRefreshFacebookSession(credentials)` to attempt login.

Realistic outcomes per attempt:
- ~40–70% succeed first try (FB accepts from Railway IP)
- If FB asks for 2FA, the yellow 2FA box appears (auto-focuses); user enters
  code, clicks again → high success rate
- If FB rejects the 2FA code (rotated mid-flight), the yellow box updates with
  "Facebook didn't accept that code — get a fresh one"
- If FB shows captcha/checkpoint, the credentials modal closes and the Cookie
  Editor paste modal opens automatically

### Path B — Cookie Editor paste (fallback)

The credentials modal has an always-visible *"Don't want to log in here? Paste
your Facebook cookies instead →"* link at the bottom. Works 100% of the time:
user installs the free Cookie Editor browser extension (one click from Chrome
Web Store, no developer mode), opens facebook.com, clicks Cookie Editor →
Export → Export as JSON, pastes into the modal. ~30 sec the first time, ~10 sec
on subsequent uses.

### What changed about cookie persistence

**Cookies now survive Railway redeploys.** Previously every code push wiped
`src/config/cookies.json` (Railway's container filesystem is ephemeral), forcing
the user to re-renew after every deploy. Now `saveCookies()` mirrors to
`SessionState.cookiesJson` (Postgres TEXT column) on every successful write,
and `loadCookies()` restores from DB if the file is missing.

### TOTP still optional but no longer needed

`FB_TOTP_SECRET` env var can still be set for hands-off automated 2FA, but the
modal's 2FA input field makes manual entry the default. Most users won't bother
with TOTP setup.

---

## 5. Data-quality filters now in place

Before any scraped post hits `PostRaw`:

1. **Self-author filter** — drops posts where `authorLink` resolves to the
   logged-in scraper account (page chrome was being misinterpreted as posts).
2. **No-author filter** — drops posts with neither `authorName` nor
   `authorLink` (these are virtually always extractor artifacts).
3. **Group-rule pattern filter** — drops posts starting with known
   moderator/description patterns. The list is in `orchestrator.ts`
   (`GROUP_RULE_PATTERNS`) — extend it as new patterns appear.

Before classification → message generation:

4. **Classifier threshold tightened.** Only posts with `confidence > 75`
   (strictly greater than) AND `isHistoric = true` proceed to message
   generation. The classifier prompt was rewritten to score event listings,
   captions, and one-liners at ≤75 — only substantive personal/community
   memory stories cross the threshold.

Before sending:

5. **Author cooldown.** Even if two posts by the same person both score >75,
   the messenger sends at most one message to that `authorLink` within
   `MESSAGE_AUTHOR_COOLDOWN_DAYS` (default 30).

---

## 6. Environment variables on Railway (current state)

Required:
- `FB_EMAIL`, `FB_PASSWORD` — used by cron `login-refresh` only. Per-renewal
  credentials now come from the dashboard modal.
- `OPENAI_API_KEY` — for classification + generation.
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `POSTGRES_URL` = `${{Postgres.DATABASE_URL}}`
- `REDIS_URL` = `${{Redis.REDIS_URL}}`
- `GROUP_IDS` — comma-separated FB group IDs (seed-only; runtime list is in
  the `GroupInfo` table).
- `API_KEY` — gates protected dashboard endpoints.
- `NODE_ENV=production`
- `APIFY_TOKEN`, `APIFY_RESULTS_LIMIT` (Apify path is disabled in code; the
  token is still validated at boot).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_BOT_PASSWORD`
- `CORS_ORIGINS=https://tarasa-history.com,https://tarasa-historic-extractor-production.up.railway.app`
- `MAX_BROWSER_INSTANCES=1`
- `BASE_TARASA_URL=https://tarasa.me/...`
- `TRIGGER_RATE_LIMIT_PER_MINUTE=30`

New optional knobs added this session:
- `MESSAGE_AUTHOR_COOLDOWN_DAYS` — default 30. How long to wait before
  messaging the same FB authorLink again.
- `FB_TOTP_SECRET` — optional. If set, the credentials modal's 2FA flow
  becomes hands-off. Most users won't need this.

Intentionally unset (still):
- `SYSTEM_EMAIL_ALERT`, `SYSTEM_EMAIL_PASSWORD`
- `SENTRY_DSN`

---

## 7. Database additions (migration `20260603163232_resilience_fields`)

- `SessionState.cookiesJson TEXT` — durable cookie storage across deploys.
- `GroupInfo.consecutiveErrors INTEGER NOT NULL DEFAULT 0` — strike counter
  so a single transient failure doesn't permanently mute a group.

Both are nullable / defaulted so the migration is safe on rollback.

---

## 8. Known caveats and limitations

- **Facebook anti-bot from Railway IPs.** Realistic per-attempt success rate
  on credentials-flow renewal is 40–70%. A residential proxy ($5-15/mo) would
  push this to 80–90%. Not added — out of scope for this work. Plan B (Cookie
  Editor paste) is the always-works backstop.
- **Truncated post text on some long posts.** The "See more" expansion was
  improved (whitespace normalization, longer wait, shorter prefix match) but
  some short posts still get saved with FB's preview text. Full fix would
  require navigating to each post's permalink — adds ~1 sec per post, deferred.
- **Apify is disabled** for these specific groups (FB blocks Apify for Israeli
  history groups). Code keeps the integration but every group routes through
  Playwright. Leave as-is.
- **mbasic.facebook.com is dead.** Endpoint deprecated by FB. Code has the
  path but it's never reached. Don't try to revive it.
- **Build time on Railway: 4–10 min typical, 12+ on cache miss.** Mostly the
  Playwright Chromium download (~250MB). Acceptable; not worth optimizing
  unless deploys become painful.
- **Phantom-duplicate posts left in DB from before the hash fix.** ~9 posts
  with the user's own profile as author and ~5 posts with content matching the
  old `4m`/`13m`-suffix dedup bug. They won't get re-messaged (author cooldown)
  but if you want clean tables, use the now-working **Delete All Data** flow
  on the Settings page.

---

## 9. Operational quick reference

```bash
# Local dev
npm run dev                    # Start Express in dev mode
npm run dashboard:dev          # Start Next.js dashboard (port 3000)
npm run test:unit              # 846 unit tests

# Builds
npm run build                  # tsc -> dist/
npm run dashboard:build        # next build

# Diagnostics (uncommitted, local-only)
ts-node src/scripts/test-stealth-login.ts
ts-node src/scripts/probe-fb-login-button.ts

# Prisma
npx prisma migrate deploy      # Runs on every deploy via start.sh
npx prisma generate            # Runs via postinstall
```

Dashboard buttons that actually work after this session:
- Settings → **Renew Session** (credentials modal)
- Settings → **Reset OpenAI Breaker** (manual recovery from 429 outages)
- Settings → **Trigger Scrape / Classification / Message** (existing)
- Settings → **Yes, Delete Everything** (Danger Zone — now sends the right header)
- Groups → **Refresh** (now with spinner + last-refreshed timestamp)
- Debug → **Run Full Diagnostics** (now via POST instead of broken SSE)

---

## 10. How to continue in a new chat

Open a new chat with Claude Code and paste this as the opening message:

> I'm continuing work on the tarasa-historic-extractor project. Please read
> `HANDOFF.md` at the repo root for full context. The system is in a working
> state — recent commits hardened session renewal, post dedup, and
> classifier accuracy. Tell me what to focus on before making changes.

The session that produced this handoff resolved the largest open issues:
session renewal UX, cookie persistence, scraper data quality, and classifier
accuracy. If you don't see new bugs reported, plausible next-direction work:

- Optimize Dockerfile to cache Playwright Chromium layer (cut deploy from
  10 min → ~4 min).
- Switch the "See more" expansion to permalink-fetching for posts that come
  back truncated.
- Add a UI to view/edit `GROUP_RULE_PATTERNS` so the user can extend the
  filter list without a code push.
- Add a "force re-classify" button to re-score existing posts under the new
  prompt (currently they keep their old scores; clearing data is the only way
  to rebuild).
- Build the residential-proxy integration (separate work, ~$5-15/mo OpEx).

None of these are blocking — they're optimizations.

---

## 11. The honest summary

The system works. The user can renew the session in two ways, the scraper
correctly uses cookies, posts are deduplicated at the content-hash level,
authors don't get spammed, and only substantive historical stories survive to
the messaging step. The four broken UI buttons (Delete All Data, Run
Diagnostics, Groups Refresh, Logs error message) are fixed.

The two remaining real-world frictions are out of code's control:
1. Facebook's anti-bot from Railway IPs means some credentials-flow renewals
   will fail — Plan B (Cookie Editor paste) is the always-works fallback.
2. Some long posts still get truncated by the scraper's "See more"
   expansion — improved but not perfect.

The 846-test suite passes; both backend and dashboard builds are clean.
