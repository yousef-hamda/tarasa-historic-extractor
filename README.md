# tarasa-historic-extractor

Production-ready specification and starter implementation for the Tarasa Facebook Historic Story Extraction & Auto Messaging System.

## Features
- Playwright scraper with auto-login, cookie refresh, and challenge (2FA/captcha) detection.
- LLM classifier and message generator via OpenAI.
- Messenger automation with quota tracking, DB persistence, and operator alerts.
- Prisma/PostgreSQL schema and Node.js API with cron jobs.
- Next.js dashboard scaffold for monitoring posts, messages, logs, and settings.

## Getting Started
1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env` and fill in credentials.
3. Run Prisma migration: `npx prisma migrate dev`.
4. Start the API: `npm run dev`.
5. Start the API: `npm run dev`. The cron schedulers auto-register when the server boots, so scraping/classification/messaging/login refresh jobs start immediately.

## Manual API Triggers
- `POST /api/trigger-scrape` – immediately scrape configured groups.
- `POST /api/trigger-classification` – classify newly scraped posts.
- `POST /api/trigger-message` – generate and dispatch queued messages (respects quota).
- `GET /api/messages` – returns the queued message generation backlog, send history, and current throughput statistics for the dashboard.

## Operational Notes
- Configure `SYSTEM_EMAIL_ALERT`/`SYSTEM_EMAIL_PASSWORD` to receive automatic emails when Facebook requests 2FA or captcha resolution.
- `MAX_MESSAGES_PER_DAY` enforces a rolling 24-hour send quota.
- Login refresh cron (`src/cron/login-refresh.ts`) re-validates cookies daily to satisfy the 30-day session policy.

This repository now contains the **FINAL MASTER PROMPT v2** implementation blueprint needed by Codex/Devin/Claude Code.
