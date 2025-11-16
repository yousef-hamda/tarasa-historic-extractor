# tarasa-historic-extractor

Production-ready specification and starter implementation for the Tarasa Facebook Historic Story Extraction & Auto Messaging System.

## Features
- Playwright scraper with auto-login, cookie refresh, and challenge (2FA/captcha) detection.
- LLM classifier and message generator via OpenAI.
- Messenger automation with quota tracking, DB persistence, and operator alerts.
- Prisma/PostgreSQL schema and Node.js API with cron jobs.
- Next.js dashboard scaffold for monitoring posts, messages, logs, settings, and firing manual control actions.

## Prerequisites
- Node.js 20+
- PostgreSQL 14+
- OpenAI API key with GPT-4 access
- Facebook account that can access the configured public groups

## Getting Started (API + Services)
1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env` and fill in credentials (the server will now validate that the required keys are present on boot).
3. Run Prisma migrations: `npx prisma migrate dev`.
4. Start the API: `npm run dev`. The cron schedulers auto-register when the server boots, so scraping/classification/messaging/login refresh jobs start immediately.

## Getting Started (Dashboard)
1. `cd ui/dashboard`
2. Install dependencies: `npm install`.
3. Start the dashboard: `npm run dev` (rewrites proxy API calls to `http://localhost:4000`).
4. Visit `http://localhost:3000` to access the overview, posts, messages, logs, and settings views with full navigation.

## Manual API Triggers & Dashboard Controls
- `POST /api/trigger-scrape` – immediately scrape configured groups.
- `POST /api/trigger-classification` – classify newly scraped posts.
- `POST /api/trigger-message` – generate and dispatch queued messages (respects quota).
- The dashboard overview page now exposes buttons for these three endpoints. Operators can validate the pipeline without touching curl or Postman and see per-action statuses (idle/running/success/error) after each trigger.
- The Posts view now includes an **Export CSV** button that downloads the currently filtered slice of posts using the `/api/posts/export` endpoint.
- `GET /api/posts?limit=50&page=1&group=<id>&historic=true|false|pending` – paginated posts feed with optional group and classification filters used by the dashboard.
- `GET /api/posts/export?group=<id>&historic=true|false|pending&limit=500` – CSV export of the filtered posts list (max 1,000 rows) for manual analysis or backfilling.
- `GET /api/messages` – returns the queued message generation backlog, send history, and current throughput/quota statistics for the dashboard.
- `GET /api/stats` – aggregates total posts, classifications, queue depth, logs, and last-run timestamps for the dashboard overview.
- `GET /api/settings` – exposes the configured group IDs, Tarasa submission link, and alert email configuration for the dashboard settings page.
- `GET /api/logs?type=error&search=captcha&page=2&limit=50` – paginated logs API with optional type and free-text search filters. The dashboard log viewer uses these controls so operators can zero in on scrape/classify/message/auth issues quickly.

## Operational Notes
- Configure `SYSTEM_EMAIL_ALERT`/`SYSTEM_EMAIL_PASSWORD` to receive automatic emails when Facebook requests 2FA or captcha resolution.
- `MAX_MESSAGES_PER_DAY` enforces a rolling 24-hour send quota.
- The dashboard and `/api/stats` expose remaining quota (e.g., `12/20` messages left) so operators can see how much capacity is available before Messenger automation pauses.
- Login refresh cron (`src/cron/login-refresh.ts`) re-validates cookies daily to satisfy the 30-day session policy.

This repository now contains the **FINAL MASTER PROMPT v2** implementation blueprint needed by Codex/Devin/Claude Code.
