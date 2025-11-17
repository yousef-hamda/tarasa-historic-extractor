# Tarasa Deployment Guide

## Prerequisites
- Node.js 20+
- PostgreSQL database
- Facebook account credentials
- OpenAI API key

## Setup Steps
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and fill in all values.
4. Run Prisma migrations: `npx prisma migrate dev --schema=src/database/schema.prisma`.
5. Start the API server: `npm run start` (after building with `npm run build`).
6. Launch the dashboard: follow the instructions in the README to run the Next.js app under `ui/dashboard`.

## Configuration
### Facebook Groups
Populate the `GROUP_IDS` environment variable with a comma-separated list of group IDs that should be scraped.

### Message Limits
`MAX_MESSAGES_PER_DAY` enforces the rolling 24-hour quota for Messenger outreach. Adjust this value to match Facebook safety limits.

### Email Alerts
Configure `SYSTEM_EMAIL_ALERT` and `SYSTEM_EMAIL_PASSWORD` to enable notifications when two-factor authentication or captchas interrupt automation.

## Troubleshooting
### "Two-factor authentication required"
The Facebook session needs manual approval. Review your alert email, resolve the challenge, and restart the worker.

### "Daily message quota reached"
The messenger service will pause after exhausting the daily quota. Wait 24 hours or increase `MAX_MESSAGES_PER_DAY` if safe.

### Prisma errors
Ensure the database URL is correct, run `npx prisma generate`, and rerun `npx prisma migrate deploy` on production to sync the schema.
