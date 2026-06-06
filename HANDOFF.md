# Tarasa Historic Extractor — Handoff Notes

A snapshot of the project's deployment state, recent work, and known caveats,
so a fresh chat (or a new developer) can pick up exactly where the current
session ended.

Last updated: 2026-06-06

---

## 1. What this project is

- Node.js / TypeScript backend + Next.js 14 dashboard, single Docker image.
- Scrapes posts from Israeli Facebook history groups → classifies them with
  OpenAI as **substantive historical stories** vs. not → generates outreach
  messages in the same language as the post → sends them via Messenger.
- PostgreSQL via Prisma, Redis for cron locks & rate limiting.
- ~30 source modules, 897 unit tests, multi-language dashboard (en / he / ar).

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

## 3. The work shipped in the 2026-06-02 → 2026-06-03 session

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
| `82ff677` | Docs: refreshed HANDOFF + README for the session-renewal + scraper-quality work above. |

---

## 3.5 The work shipped in the 2026-06-04 session

This session fixed a silent "zombie-valid" session bug, made operator settings
survive redeploys, built the approved-posts **email export** end-to-end (and
fought Railway's SMTP block all the way to a Resend HTTP transport), drove the
`fbPostId` "hash fallback" rate down with new extraction + permalink-resolution
strategies, hardened the phantom-post filter, and fixed a global rate-limit that
was breaking the dashboard. Commits in order:

| Commit | What it does |
|---|---|
| `0b7f1a1` | **The big one — 8 phases (A–H).** **(A) Session zombie-valid bug:** the session-check cron was accepting `"USER_ID":"0"` from Facebook's logged-out homepage as a real user, marking the session valid every 30 min while the scraper saw no session and failed 9/9 groups — the dashboard showed green health for ~19h while the pipeline was idle. `isValidFbUserId` now rejects `0`/non-numeric/<5-digit; `validateSession` cross-checks the page `USER_ID` against the context's actual `c_user` cookie; `checkAndUpdateSession` cross-checks `getCookieHealth()` so the two reporting paths can't diverge. **(B)** New `SystemSetting` key/value Prisma table + `src/utils/settings.ts` (60s read-through cache) so operator settings survive redeploys; messaging on/off moved off the file path it was losing on every push. **(C)** Configurable historic-confidence threshold (default 75) threaded through generator/quality/dedup crons, stats, posts payload, badges, and a Settings slider (50–100). **(D)** Configurable system speed — `src/cron/scheduler.ts` owns the scrape/classify/message handles and `applySpeedPreset()` re-registers them live (Conservative/Normal/Fast/Aggressive) via `POST /api/settings/speed`, no restart. **(E)** Phantom-post filter grew 3 → 6 layers (chrome-suffix names, exact `SessionState.userName` match, skeptical hash+no-URL+self-link bundle, extended `GROUP_RULE_PATTERNS`). **(F/G)** Posts-page group pill + shared `effectivePostUrl`; navbar health pill reads `/api/health.checks` and degrades on any failing check. **(H)** `DELETE /api/posts/:id` (per-row trash) and `POST /api/admin/cleanup-phantoms` (runs the live `shouldSkipPost` against existing rows so cleanup can't drift from the filter). **Messaging now defaults OFF.** |
| `d4a211c` | **Live auto-refresh + compact navbar + email-export feature.** `useAutoRefresh` hook polls Posts/Messages/Logs/Groups every 15s (pauses on hidden tab, errors degrade to a non-blocking banner so a deploy blip doesn't wipe the view). Navbar collapses to icon-only at md..xl. Cron strings render as "every 5 minutes" not `*/5 * * * *`. **Messaging default is FALSE.** Email export scaffolding: `admin_email_recipient` SystemSetting, `sendHtmlEmail()` in `alerts.ts`, `escapeCSV`/`buildCsv` extracted to `src/utils/csvHelpers.ts`, and `POST /api/export/approved-posts`. |
| `447843a` | Moved the language switcher out of the navbar (it was overlapping Settings at the user's width) into a "Language" card on the Settings page. |
| `261077c` | **Global rate-limit was breaking the dashboard.** `TRIGGER_RATE_LIMIT_PER_MINUTE` (default 30) was being used as the GLOBAL limit; with the new 15s auto-refresh hooks + health polls, normal use blew past 30 req/min and the IP got blocked for 5 min → every GET returned 429 → "Failed to fetch posts". New `GLOBAL_RATE_LIMIT_PER_MINUTE` (default 600) drives the global limiter; `TRIGGER_RATE_LIMIT_PER_MINUTE` is back to gating only trigger POSTs. Block duration 5 min → 1 min. `apiFetch` does ONE retry on 429/5xx for idempotent GET/HEAD (honors `Retry-After`, capped 3s); mutations are never retried. |
| `6d37d16` | Email button hung 30s with no log: nodemailer's `service:'gmail'` defaults to port 465, which Railway blocks. Switched to explicit `smtp.gmail.com:587` STARTTLS + connection/greeting/socket timeouts; bumped the export button's `apiFetch` timeout to 90s. |
| `924bd75` | SMTP still 502'd with no trace because the export route only logged on success. Now logs an `error` `systemLog` entry on `ok:false` or a handler crash, and adds `POST /api/export/verify-smtp` (runs `transporter.verify()` — diagnoses ETIMEDOUT/ECONNREFUSED/EAUTH with a `hint`). |
| `012c6b7` | **Railway blocks outbound SMTP on 587 too** (confirmed: "Connection timeout"). Switched the email transport to **Resend** (HTTP API over 443, free tier 100/day). Selection rule in `sendHtmlEmail`: `RESEND_API_KEY` → Resend; else `SYSTEM_EMAIL_ALERT`+`SYSTEM_EMAIL_PASSWORD` → SMTP; else a clear error. `/api/settings` returns `emailTransport: 'resend'\|'smtp'\|'none'`. SMTP path kept as a local-dev fallback. |
| `a7ee467` | Railway's edge proxy swaps 5xx bodies for a generic page, hiding the real Resend message behind "HTTP 502". Export route now returns 4xx for client-fixable errors (validation/auth/rate-limit) so the body passes through, plus a `hint` for the common free-tier testing-mode case. |
| `850da7e` | Email report polish from real feedback: "Posted" → "Scraped on" (we don't store FB's actual post date — honest fix), full post text (dropped the 500-char truncation, newlines → `<br>`), `buildPostUrl()` fallback link, auto-sized cells (removed the 480px cap, `white-space:nowrap` on metadata cells). |
| `f909c5e` | **`postUrl` was dropped on every insert** — `orchestrator.ts upsertPost` built the update+create objects without `postUrl`, so every DB row had `postUrl=null` even when a real numeric id would have constructed cleanly. Fixed (`resolvePostUrl()` first, included in both blocks only when non-null). Added `POST /api/admin/backfill-post-urls` to construct URLs for existing numeric-id rows. Email table "Links" split into "Post link" / "Profile link". Removed the Email Reports settings card (recipient is fixed by Resend's free tier). |
| `968bca7` | Dropped the editable admin-email input from Settings — Resend's free tier locks the recipient to the signup email, so an editable field just produced 400s. Replaced with a read-only display + a note on how to lift the restriction (verify a domain, set `RESEND_FROM_EMAIL`). Backend endpoint stays for power users. |
| `b0d553f` | **88% of prod rows had `fbPostId='hash_<sha>'`** (the content-hash fallback) → no "View post" link. New `extractPostIdFromContainer()` runs upstream of `normalizePostId` with 5 DOM strategies (timestamp/permalink anchor, photo album `set=pcb.<id>`, `aria-labelledby`, 5-level `data-ft` ancestor walk, inline JSON scan), all gated by a strict `isValidFbPostId` (≥10 digits OR `pfbid<base62>`). Purely additive — if all return null, behavior is byte-for-byte identical. +7 tests. |
| `08cdfcc` | **(A) Permalink-fetch resolver** (Option B for the hash problem): `resolveHashIdsViaPermalink()` runs after the in-DOM extractor, opens a sub-page in the same context for posts with a partial URL fragment, reads the canonical id from the post-redirect URL, and patches both `fbPostId` and `postUrl`. Bounded hard (60s total, 8s/page, 3 concurrent, 50 posts/pass); any failure leaves the post as `hash_`. New `parseFbPostIdFromUrl()` centralizes the URL regexes. **(B) 4 Telegram fixes:** removed the hardcoded `'tshuka'` fallback password; persisted `authenticatedChats` to a `telegram_authenticated_chats` SystemSetting (survives redeploys); wired `notifyHighQualityStory` into the quality cron (5-star → operator ping); wired `sendSystemAlert` into 5 critical error sites via a `{telegram:true}` flag on `logSystemEvent` (captcha/2FA, scrape-cycle abort, email failure, messenger init failure, quality-cron crash) with a 5-min in-memory dedup. |
| `d039827` | **Filter 7 — the bullet-rules phantom pattern.** Six prod rows were group-rules chrome with the triple-null signature `authorName=null && fbPostId=hash_… && postUrl=null` — which all 6 existing filters missed because each required one of those fields. New Filter 7 skips on that exact conjunction (structurally guaranteed to be chrome, never a real post in current data), plus 6 Hebrew rule-opener patterns + a generic bullet-prefix regex added to `GROUP_RULE_PATTERNS`. +13 tests. |

---

## 3.6 The work shipped in the 2026-06-06 session

A large dashboard-focused pass: fixed the Messages page end-to-end, wired the
Prompts page to actually drive production, made groups auto-reconnect on session
restore, removed clutter panels, made the whole dashboard multi-language
(en/he/ar) with a fixed switcher + RTL, fixed the Debug WebSocket, and added a
site-wide password gate.

| Area | What changed |
|---|---|
| **Messages page** | Both tables now render the author **photo** (avatar with icon fallback). The queue's old "View" link was the raw outreach URL — on the legacy path that embedded the **entire post text** in the query string, so clicking it returned **HTTP 414 (URI Too Long)**. Root fix: `buildLink` (`src/ai/generator.ts`) no longer embeds post text (`?refPost=<id>` only). The dashboard now links **Post #id → `/posts?postId=<id>`** (opens the detail modal) + an external FB-post link. **Sent History** was rebuilt to show author+photo, the **message that was actually sent**, status, a **Messenger chat link** (`/messages/t/<id>` when a numeric id is resolvable, else the profile link), the clickable **Post #id**, sent-at, and error. |
| **`MessageSent.messageText`** | New nullable column (migration `20260606120000_add_message_text_to_sent`). The generated message is deleted on dispatch, so without this the Sent History had nothing to show. `messenger.ts` now snapshots the text on send. Rows sent before this column render "—". |
| **`GET /api/posts/:id`** | New public endpoint so the Posts page can open a deep-linked post that isn't on the current page (used by the Messages "Post #id" links). |
| **Prompts page was cosmetic** | `classifier.ts`/`generator.ts` used hardcoded prompts and **never read the active DB prompt** — "Save & Activate" changed nothing. New `src/ai/promptStore.ts` holds the canonical defaults + `getActivePrompt()`; both crons now call it, and `routes/prompts.ts` delegates to it. The page's stale "default classifier prompt" was replaced with the real shipped prompt. Activating a prompt now actually changes production. |
| **Groups auto-reconnect** | New `reactivateAllGroups()` (`groupRegistry.ts`) clears `isAccessible=false`/`consecutiveErrors`/`errorMessage` for all enabled groups. Called whenever the session goes valid: in `checkAndUpdateSession` (cron path) and in the renew + cookie-upload routes, which also kick an **immediate guarded scrape**. The Groups page (15s auto-refresh) flips back to accessible within seconds of a renewal instead of waiting a full scrape interval. |
| **Admin page cleanup** | Removed **Manual Triggers**, **Trigger History**, **Recent Logs**, **Recent Errors**. **Send approved posts** moved to the page header (top). |
| **Settings page cleanup** | Removed the **Facebook Groups** card and the manual **trigger buttons**. The API-key card was kept (renamed "Dashboard API Key") since it's how the dashboard authenticates; "Reset OpenAI Breaker" stays as a maintenance action. |
| **Full multi-language UI** | Language switcher rebuilt as an inline **segmented selector** (was an absolute dropdown that overflowed off-screen). Added a consolidated `ui.*` translation namespace (en/he/ar) and wired every page (Dashboard, Posts, Messages, Groups, Logs, Admin, Debug, Settings; Prompts/Search already used `t()`). `getNestedValue` now falls back to **English** for any untranslated key so a gap never shows a raw `a.b.c` path. RTL flips via `document.dir`. |
| **Debug WebSocket** | The WS URL hardcoded `:4000`, which never connects behind Railway's 443 proxy (page silently fell back to polling). Now uses `window.location.host` (same origin). |
| **Site password gate** | New `LoginGate` + `POST /api/auth/login` / `GET /api/auth/required` (`src/routes/auth.ts`). Password validated server-side against `SITE_PASSWORD` (never in the bundle); on success a localStorage flag unlocks the app. **Self-disables when `SITE_PASSWORD` is unset** (backwards compatible). The public `/submit/[postId]` pages bypass the gate so message recipients are never blocked. |

**New env var to set on Railway:** `SITE_PASSWORD` (any value enables the gate;
leave unset to keep the site open). Current intended value handed to the user.

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

   > As of the 06-04 work, `shouldSkipPost` is a **7-layer** filter (was 3):
   > the three above, plus chrome-suffix author names ("X's profile/timeline"),
   > an exact match against `SessionState.userName`, a skeptical
   > hash-id + no-`postUrl` + self-link bundle, and **Filter 7** — the
   > triple-null structural signature
   > (`!authorName && fbPostId.startsWith('hash_') && !postUrl`) that catches
   > group-rules chrome in any language. `POST /api/admin/cleanup-phantoms`
   > re-runs this exact logic against rows already in the DB.

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

Optional knobs added in the 2026-06-03 session:
- `MESSAGE_AUTHOR_COOLDOWN_DAYS` — default 30. How long to wait before
  messaging the same FB authorLink again.
- `FB_TOTP_SECRET` — optional. If set, the credentials modal's 2FA flow
  becomes hands-off. Most users won't need this.

Optional knobs added in the 2026-06-04 session:
- `GLOBAL_RATE_LIMIT_PER_MINUTE` — default 600. Per-IP cap on ALL requests
  (was conflated with `TRIGGER_RATE_LIMIT_PER_MINUTE`, which now gates only
  the trigger POST endpoints). Set high enough for the 15s auto-refresh hooks.
- `RESEND_API_KEY` — **the email transport now in use.** If set, the
  approved-posts email export sends via Resend (HTTP, port 443). This is
  required for email export to work on Railway — see the SMTP note below.
- `RESEND_FROM_EMAIL` — optional. Defaults to `onboarding@resend.dev`
  (Resend's no-domain-needed testing sender). Override once a custom domain
  is verified in Resend (also lifts the free-tier recipient lock).

Optional knob added in the 2026-06-06 session:
- `SITE_PASSWORD` — if set, the dashboard shows a password gate on entry
  (validated server-side via `POST /api/auth/login`). Leave **unset** to keep
  the site open (the gate self-disables). The public `/submit/<id>` landing
  pages are never gated.

Email transport selection (in `sendHtmlEmail`): `RESEND_API_KEY` → Resend;
else `SYSTEM_EMAIL_ALERT` + `SYSTEM_EMAIL_PASSWORD` → SMTP; else a clear
error telling the operator what to set. **Railway blocks outbound SMTP on
both 465 and 587**, so on Railway only the Resend path works — `SYSTEM_EMAIL_*`
are effectively local-dev-only now.

Intentionally unset (still):
- `SENTRY_DSN`

---

## 7. Database additions

### Migration `20260603163232_resilience_fields`
- `SessionState.cookiesJson TEXT` — durable cookie storage across deploys.
- `GroupInfo.consecutiveErrors INTEGER NOT NULL DEFAULT 0` — strike counter
  so a single transient failure doesn't permanently mute a group.

Both are nullable / defaulted so the migration is safe on rollback.

### Migration `20260604113000_add_system_settings` (2026-06-04)
- New `SystemSetting` key/value table — durable operator settings that
  survive Railway redeploys (the file-based path was wiped on every push).
  Read through `src/utils/settings.ts` with a 60s cache for cron hot paths.

Keys written to `SystemSetting` so far:
- `messaging_enabled` — outreach on/off (now **defaults FALSE**).
- `historic_confidence_threshold` — default 75, settable via Settings slider.
- `system_speed` — Conservative/Normal/Fast/Aggressive cron preset.
- `admin_email_recipient` — email-export recipient.
- `telegram_authenticated_chats` — persisted Telegram auth set.

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
  old `4m`/`13m`-suffix dedup bug. They won't get re-messaged (author cooldown).
  As of 06-04 there's a targeted **Clean phantom posts** button (Settings →
  Danger Zone, `POST /api/admin/cleanup-phantoms`) that re-runs the live
  `shouldSkipPost` filter against existing rows — prefer it over Delete All
  Data when you only want the chrome/phantom rows gone.
- **`fbPostId` hash-fallback rate.** Even after the 06-04 extraction +
  permalink work, a meaningful share of rows still carry `fbPostId='hash_<sha>'`
  (no canonical FB id readable from their feed DOM) and therefore can't render a
  "View post" link. Existing `hash_` rows are irrecoverable — only fresh scrapes
  benefit.
- **Email export depends on Resend on Railway.** SMTP is blocked outbound
  (both 465 and 587), so without `RESEND_API_KEY` set, the "Email approved
  posts" button returns a clear "no transport configured" error. Recipient is
  locked to the Resend signup address until a custom domain is verified.

---

## 9. Operational quick reference

```bash
# Local dev
npm run dev                    # Start Express in dev mode
npm run dashboard:dev          # Start Next.js dashboard (port 3000)
npm run test:unit              # 897 unit tests (was 846 before the 06-04 work)

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

Dashboard buttons that work (06-03 + 06-04):
- Settings → **Renew Session** (credentials modal)
- Settings → **Reset OpenAI Breaker** (manual recovery from 429 outages)
- Settings → **Trigger Scrape / Classification / Message** (existing)
- Settings → **Yes, Delete Everything** (Danger Zone — now sends the right header)
- Settings → **Clean phantom posts** (Danger Zone — runs live `shouldSkipPost`
  against existing rows; 06-04)
- Settings → **historic-confidence threshold slider** (50–100; 06-04)
- Settings → **system-speed presets** (Conservative/Normal/Fast/Aggressive; 06-04)
- Settings → **Language** card (switcher moved here from the navbar; 06-04)
- Posts/Admin → **Email approved posts** (Resend transport; 06-04) + per-row
  trash (`DELETE /api/posts/:id`; 06-04)
- Groups → **Refresh** (now with spinner + last-refreshed timestamp)
- Debug → **Run Full Diagnostics** (now via POST instead of broken SSE)

---

## 10. How to continue in a new chat

Open a new chat with Claude Code and paste this as the opening message:

> I'm continuing work on the tarasa-historic-extractor project. Please read
> `HANDOFF.md` at the repo root for full context. The system is in a working
> state — recent commits hardened session renewal, post dedup, and
> classifier accuracy. Tell me what to focus on before making changes.

The 06-04 session resolved more of the open issues: the zombie-valid session
bug, settings persistence across redeploys, the email-export pipeline (now on
Resend), the `postUrl`/`fbPostId` data quality (extraction + permalink
resolution), and the dashboard-breaking rate limit. If you don't see new bugs
reported, plausible next-direction work:

- Optimize Dockerfile to cache Playwright Chromium layer (cut deploy from
  10 min → ~4 min).
- Capture Facebook's **actual post date** from the DOM (currently the email
  export honestly labels the column "Scraped on" because we don't store
  `postedAt`).
- Push the `fbPostId` numeric-id rate further. The extractor strategies
  (`b0d553f`) + permalink resolver (`08cdfcc`) took a clean baseline from
  ~12.5% → ~30% numeric ids; the remaining rows still fall back to `hash_`.
  Backfilling existing `hash_` rows is irrecoverable (their DOM is gone).
- Add a UI to view/edit `GROUP_RULE_PATTERNS` so the user can extend the
  filter list without a code push (it has grown several times now).
- Add a "force re-classify" button to re-score existing posts under the new
  prompt / new threshold (currently they keep their old scores; clearing data
  or `cleanup-phantoms` is the only way to rebuild).
- Verify a custom domain in Resend so the email recipient isn't locked to the
  signup address, then re-enable the editable admin-email input.
- Build the residential-proxy integration (separate work, ~$5-15/mo OpEx).

None of these are blocking — they're optimizations.

---

## 11. The honest summary

The system works. The user can renew the session in two ways, the scraper
correctly uses cookies, posts are deduplicated at the content-hash level,
authors don't get spammed, and only substantive historical stories survive to
the messaging step. The four broken UI buttons (Delete All Data, Run
Diagnostics, Groups Refresh, Logs error message) are fixed.

The 06-04 session closed the most dangerous remaining bug — the "zombie-valid"
session that showed green health for ~19h while the pipeline was idle — and
made operator settings durable across redeploys, shipped working email export
(via Resend, since Railway blocks SMTP), fixed the `postUrl`-dropped-on-insert
bug, improved `fbPostId` capture, and stopped the global rate-limit from
breaking the dashboard. **Messaging now defaults OFF** — a deliberate safety
posture, so a fresh container won't send outreach until the operator turns it on.

The remaining real-world frictions are mostly out of code's control:
1. Facebook's anti-bot from Railway IPs means some credentials-flow renewals
   will fail — Plan B (Cookie Editor paste) is the always-works fallback.
2. Some long posts still get truncated by the scraper's "See more"
   expansion — improved but not perfect.
3. A share of rows still carry `hash_` post ids (no canonical FB id in their
   DOM) and can't render a "View post" link.

The 897-test suite passes; both backend and dashboard builds are clean.
