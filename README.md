# Tarasa Historic Story Extraction & Messaging System

Production-ready specification and reference implementation for scraping Facebook groups, classifying historic stories, messaging authors, and monitoring operations through a dashboard.

## ✨ Features
- Playwright scraper with auto-login, cookie refresh, and challenge (2FA/captcha) detection.
- LLM classifier and message generator via OpenAI with retry/backoff safeguards.
- Messenger automation with quota tracking, DB persistence, and operator alerts.
- Prisma/PostgreSQL schema, cron jobs, and Express REST API.
- Next.js dashboard for monitoring posts, messages, logs, settings, stats, CSV exports, and manual pipeline triggers.

## 🚀 Quick Start Guide

### Step 1: Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Facebook account that can access the configured public groups
- OpenAI API key (GPT-4o / GPT-4o mini)

### Step 2: Clone & Install
```bash
git clone <repo-url>
cd tarasa-historic-extractor
npm install
cd ui/dashboard && npm install && cd ../..
```

### Step 3: Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials (Facebook login, OpenAI key, DB URL, Tarasa URL, etc.)
```
Required keys are validated on server startup. `GROUP_IDS` should be a comma-separated list of Facebook group IDs.

### Step 4: Database Setup
```bash
createdb tarasa # or use psql to create manually
npx prisma migrate dev --name init
```
This applies the schema and generates Prisma Client.

### Step 5: Run Services
```bash
# Terminal 1 - API & cron schedulers
npm run dev

# Terminal 2 - Dashboard
cd ui/dashboard && npm run dev
```
- API listens on `http://localhost:4000` and automatically registers scrape/classify/message/login-refresh cron jobs.
- Dashboard runs on `http://localhost:3000` (Next.js rewrites proxy API calls).

### Step 6: Verify
- Open `http://localhost:3000` – ensure you can navigate Overview, Posts, Messages, Logs, and Settings.
- Call `http://localhost:4000/api/health` – confirm status is `ok` (or `degraded` with details if something needs attention).

## 🔧 Configuration Details

### Facebook Setup
1. Use an account with access to the public groups you plan to scrape.
2. Temporarily disable 2FA for first login or prepare to complete it manually.
3. First successful login stores cookies in `src/config/cookies.json` – subsequent runs reuse them until refresh cron renews the session.

### OpenAI Setup
1. Create an API key at [platform.openai.com](https://platform.openai.com/).
2. Ensure billing is enabled and your model (e.g., `gpt-4o`) is accessible.
3. Set `OPENAI_MODEL` in `.env` if you prefer a different model than the default `gpt-4o-mini`.

### Group IDs
Find IDs by visiting `https://facebook.com/groups/<ID>` and copy the numeric portion. Example: `https://facebook.com/groups/123456789` ⇒ `123456789`.

## 🛠 Running the Pipeline
- Dashboard Overview page includes **Trigger Scrape**, **Trigger Classification**, and **Trigger Messaging** buttons that call `/api/trigger-*` endpoints (protected by API key when configured).
- Posts view exposes filtering (group, classification status), pagination, and **Export CSV** which downloads up to 1,000 filtered rows via `/api/posts/export`.
- Messages view shows queued generations, send history, and 24-hour quota consumption.
- Logs page offers pagination, log-type filters, keyword search, and manual refresh backed by `/api/logs` query params.

## 📡 API Reference
- `GET /api/health` – system health + dependency checks.
- `GET /api/posts` – paginated posts with filters (`limit`, `page`, `group`, `historic`).
- `GET /api/posts/export` – CSV export of current filters (max 1,000 rows).
- `GET /api/messages` – queued messages, send history, quota usage.
- `GET /api/logs` – filtered logs with pagination and search.
- `GET /api/settings` – runtime configuration (groups, Tarasa link, email alerts).
- `GET /api/stats` – aggregated counts, queue size, quota remaining, last-run timestamps.
- `POST /api/trigger-scrape` – immediate scrape (requires API key if configured).
- `POST /api/trigger-classification` – run classifier manually.
- `POST /api/trigger-message` – run messenger queue respecting quotas.

## 🐛 Troubleshooting
| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `Missing required environment variables` | `.env` incomplete | Copy from `.env.example` and fill required keys |
| `OpenAI request failed` | Invalid key, billing, or model access | Verify `OPENAI_API_KEY`, confirm model availability, retry later |
| `Cookies not loading / login required` | Session expired or file deleted | Remove `src/config/cookies.json` and restart server to trigger login flow |
| `Message button not found` | Facebook DOM changed or messaging disabled | Update selectors in `src/utils/selectors.ts` and retry |
| `Exceeded quota` | `MAX_MESSAGES_PER_DAY` reached | Wait for 24-hour rolling window to reset, adjust env var if appropriate |

## 🔒 Security Checklist
- Set a random `ADMIN_API_KEY` and keep it secret (used for manual trigger endpoints and dashboard controls).
- Use HTTPS/SSL in production and restrict API access by IP or VPN.
- Store `.env` secrets securely (e.g., secrets manager) and never commit them.
- Regularly rotate Facebook and email credentials; consider app-specific passwords.

## 📦 Docker Deployment
```bash
docker-compose up -d
```
Services:
- `postgres` – PostgreSQL 15 with persistent volume.
- `api` – Node/Playwright service (shares cookies file, depends on DB health).
- `dashboard` – Production Next.js build served on port 3000.

Check logs:
```bash
docker-compose logs -f api
docker-compose logs -f dashboard
```

## 📊 Monitoring & Metrics
- System logs stored in `SystemLog` table and exposed through `/api/logs` + dashboard viewer.
- Health endpoint reports DB connectivity, OpenAI key presence, and cookie freshness.
- Quota helper calculates sent count for the last 24 hours and remaining capacity; surfaced in `/api/messages` + `/api/stats`.

## 🧪 Testing
```bash
npm test            # run Jest suite
npm run test:watch  # watch mode
npm run test:coverage
```
Sample tests live under `src/__tests__/` (e.g., retry utility). Extend coverage to routes, helpers, and cron logic as features stabilize.

## 🧱 Architecture Overview
```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Dashboard  │─────▶│  REST API    │─────▶│ PostgreSQL  │
│  (Next.js)  │      │  (Express)   │      │  Database   │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            ├─▶ Scraper Service ─▶ Facebook
                            ├─▶ Classifier (OpenAI)
                            ├─▶ Message Generator (OpenAI)
                            └─▶ Messenger Bot ──▶ Facebook Messenger
```
Cron jobs (`src/cron/*.ts`) orchestrate scraping, classifying, message generation/sending, and session refresh automatically.

## 🐘 Database Schema
Prisma schema defines `PostRaw`, `PostClassified`, `MessageGenerated`, `MessageSent`, and `SystemLog`. Migration files live in `src/database/migrations/` and should accompany every schema change.

## 🤝 Contributing
1. Fork the repository.
2. Create a feature branch.
3. Run formatting/tests locally.
4. Submit a PR describing changes, tests, and screenshots (if UI changes).

## 📄 License
MIT
