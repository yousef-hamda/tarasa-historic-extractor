# tarasa-historic-extractor

Production-ready specification and starter implementation for the Tarasa Facebook Historic Story Extraction & Auto Messaging System.

## Features
- Playwright scraper with auto-login and cookie management.
- LLM classifier and message generator via OpenAI.
- Messenger automation with quota tracking.
- Prisma/PostgreSQL schema and Node.js API with cron jobs.
- Next.js dashboard scaffold for monitoring posts, messages, logs, and settings.

## Getting Started
1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env` and fill in credentials.
3. Run Prisma migration: `npx prisma migrate dev`.
4. Start the API: `npm run dev`.
5. Use cron entry points under `src/cron` for automation.

This repository now contains the **FINAL MASTER PROMPT v2** implementation blueprint needed by Codex/Devin/Claude Code.
