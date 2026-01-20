# Tarasa Historic Story Extractor

An intelligent, fully automated system that discovers historical stories on Facebook, analyzes them using AI, and reaches out to authors via Messenger to preserve their stories on the Tarasa platform.

## 📖 Overview

This project automates the entire workflow of:
1. **Scraping** Facebook groups for posts containing historical content
2. **Classifying** posts using AI (OpenAI GPT) to identify historic stories
3. **Generating** personalized multilingual messages for post authors (in the same language as their post)
4. **Sending** messages automatically via Facebook Messenger
5. **Monitoring** all activities through a real-time dashboard

The system runs completely autonomously with scheduled cron jobs and includes robust error handling, session management, and quota controls.

---

## 🏗️ Architecture

### Tech Stack

**Backend:**
- Node.js 20+ with TypeScript
- Express.js for REST API
- Prisma ORM with PostgreSQL
- Playwright for browser automation
- OpenAI API (GPT-4o-mini) for classification and message generation
- Winston for logging
- Node-cron for scheduled tasks

**Frontend:**
- Next.js 14.2.15 (React 18.3.1)
- Tailwind CSS 3.4.3
- Server-side rendering with API integration

**Database:**
- PostgreSQL 15+ (local or hosted)

---

## 📁 Project Structure

```
tarasa-historic-extractor/
├── src/                           # Backend TypeScript source
│   ├── ai/                        # AI classification & message generation
│   │   ├── classifier.ts          # OpenAI-based post classification
│   │   ├── generator.ts           # Personalized multilingual message generation
│   │   └── structuredClassifier.ts # Alternative structured output classifier
│   ├── backup/                    # Database backup system
│   │   ├── backupManager.ts       # Full/incremental backup logic
│   │   └── index.ts               # Module exports
│   ├── config/                    # Configuration modules
│   │   ├── constants.ts           # Timeouts, delays, quotas, batch sizes
│   │   ├── cookies.json           # Facebook session cookies (auto-generated)
│   │   ├── env.ts                 # Environment validation with Zod
│   │   ├── playwright.config.ts   # Browser automation settings
│   │   ├── redis.ts               # Redis connection management
│   │   └── sentry.ts              # Sentry error tracking initialization
│   ├── cron/                      # Scheduled cron jobs
│   │   ├── index.ts               # Cron job registration & session init
│   │   ├── scrape-cron.ts         # Every 10 minutes
│   │   ├── classify-cron.ts       # Every 3 minutes
│   │   ├── message-cron.ts        # Every 5 minutes
│   │   ├── login-refresh.ts       # Daily session refresh
│   │   ├── session-check-cron.ts  # Session health monitoring
│   │   └── backup-cron.ts         # Daily backups at midnight
│   ├── database/
│   │   ├── schema.prisma          # Prisma database schema
│   │   ├── prisma.ts              # Prisma client instance
│   │   └── migrations/            # Database migrations
│   │       ├── 0001_init/
│   │       ├── 0002_enum_alignment/
│   │       ├── 20260101_add_session_and_group_tracking/
│   │       ├── 20260112_add_author_photo/
│   │       ├── 20260113_add_message_deduplication/
│   │       └── 20260113_add_mbasic_access_method/
│   ├── debug/                     # Real-time monitoring & diagnostics
│   │   ├── diagnostics.ts         # 11 automated system health tests
│   │   ├── errorTracker.ts        # Error categorization & deduplication
│   │   ├── eventEmitter.ts        # Central event bus
│   │   ├── metricsCollector.ts    # CPU, memory, heap monitoring
│   │   ├── queryProfiler.ts       # Database query profiling
│   │   ├── requestTracker.ts      # HTTP request profiling
│   │   ├── selfHealing.ts         # Auto-recovery engine
│   │   ├── websocket.ts           # Real-time WebSocket server
│   │   ├── index.ts               # Debug module exports
│   │   └── types.ts               # Type definitions
│   ├── facebook/
│   │   └── session.ts             # Facebook login, cookies, session mgmt
│   ├── messenger/
│   │   └── messenger.ts           # Messenger bot for automated messaging
│   ├── middleware/                # Express middleware
│   │   ├── apiAuth.ts             # API key authentication
│   │   ├── errorHandler.ts        # Global error handler
│   │   ├── rateLimiter.ts         # Rate limiting with Redis fallback
│   │   └── security.ts            # Security headers, CORS, sanitization
│   ├── queues/
│   │   └── jobQueue.ts            # BullMQ job queue management
│   ├── routes/                    # API endpoint handlers
│   │   ├── backup.ts              # Backup management API
│   │   ├── debug.ts               # Debug console endpoints
│   │   ├── groups.ts              # Group management endpoints
│   │   ├── health.ts              # Health check endpoint
│   │   ├── logs.ts                # System logs endpoint
│   │   ├── messages.ts            # Message queue endpoints
│   │   ├── posts.ts               # Posts API endpoints
│   │   ├── session.ts             # Session management endpoints
│   │   └── stats.ts               # Activity statistics endpoints
│   ├── scraper/                   # Facebook scraping logic
│   │   ├── extractors.ts          # Post data extraction (7 strategies)
│   │   ├── fullTextExtractor.ts   # Full text & "See more" expansion
│   │   ├── apifyScraper.ts        # Apify-based scraper for public groups
│   │   ├── mbasicScraper.ts       # m.facebook.com plain HTML scraper
│   │   ├── playwrightScraper.ts   # Playwright browser automation scraper
│   │   ├── groupDetector.ts       # Group type detection (public/private)
│   │   ├── orchestrator.ts        # Smart scraper method selector
│   │   ├── scrapeApifyToDb.ts     # Apify integration & storage
│   │   ├── stealthBrowser.ts      # Browser stealth mode config
│   │   └── scraper.ts             # Legacy main scraper entry point
│   ├── scripts/                   # Utility scripts
│   │   ├── facebook-login.ts      # Manual login & cookie save
│   │   ├── facebook-auto-login.ts # Automated login helper
│   │   ├── check-stats.ts         # Stats checker script
│   │   ├── test-scrapers.ts       # Scraper testing script
│   │   ├── cleanup-orphans.ts     # Cleanup orphaned records
│   │   ├── smoke-tests.ts         # Smoke tests
│   │   └── debug-*.ts             # Various debug scripts
│   ├── session/
│   │   ├── sessionManager.ts      # Session initialization & validation
│   │   └── sessionHealth.ts       # Session health tracking
│   ├── types/
│   │   └── global.d.ts            # Global type definitions
│   ├── utils/                     # Utility functions
│   │   ├── alerts.ts              # Email alert system
│   │   ├── browserPool.ts         # Browser instance pool manager
│   │   ├── circuitBreaker.ts      # Circuit breaker pattern
│   │   ├── cronLock.ts            # Cron job locking (prevent overlap)
│   │   ├── delays.ts              # Human-like delay functions
│   │   ├── logger.ts              # Winston logger configuration
│   │   ├── openaiHelpers.ts       # OpenAI response helpers
│   │   ├── openaiRetry.ts         # OpenAI API retry logic
│   │   ├── quota.ts               # Message quota tracking
│   │   ├── retry.ts               # Retry with backoff utilities
│   │   ├── selectors.ts           # Facebook DOM selectors
│   │   ├── systemLog.ts           # Database logging utilities
│   │   └── validation.ts          # Input validation helpers
│   ├── validation/
│   │   └── schemas.ts             # Zod validation schemas
│   └── server.ts                  # Express server entry point
├── ui/                            # Frontend - Next.js Dashboard
│   └── dashboard/
│       ├── components/            # React components
│       │   ├── Card.tsx           # Statistics card
│       │   ├── Layout.tsx         # Navigation wrapper
│       │   ├── Modal.tsx          # Modal dialog
│       │   ├── Pagination.tsx     # Table pagination
│       │   ├── PostDetailModal.tsx # Post detail viewer
│       │   ├── StatusBadge.tsx    # Status badge
│       │   ├── SystemFlowDiagram.tsx # Visual flow diagram
│       │   ├── SystemStatusCard.tsx
│       │   ├── SystemStatusIndicator.tsx # Animated status indicator
│       │   ├── Table.tsx          # Reusable table component
│       │   ├── TriggerButton.tsx  # Manual trigger buttons
│       │   ├── ErrorBoundary.tsx  # Error boundary
│       │   ├── GroupStatusTable.tsx # Group status display
│       │   ├── Skeleton.tsx       # Loading skeleton
│       │   └── charts/            # Chart components
│       │       ├── ActivityChart.tsx      # Daily activity line chart
│       │       ├── ConfidenceDistribution.tsx # Confidence bar chart
│       │       └── ClassificationPieChart.tsx # Historic vs non-historic
│       ├── hooks/                 # Custom React hooks
│       ├── pages/                 # Next.js pages
│       │   ├── _app.tsx           # App wrapper
│       │   ├── _error.tsx         # Error page
│       │   ├── index.tsx          # Dashboard home
│       │   ├── posts.tsx          # Posts management page
│       │   ├── messages.tsx       # Message queue & history
│       │   ├── logs.tsx           # System logs viewer
│       │   ├── settings.tsx       # Configuration page
│       │   ├── debug.tsx          # Debug console
│       │   ├── backup.tsx         # Backup manager
│       │   ├── groups.tsx         # Group management
│       │   └── admin.tsx          # Admin page
│       ├── styles/
│       │   └── globals.css        # Global Tailwind styles
│       ├── types/                 # TypeScript types
│       ├── utils/                 # Utility functions
│       │   ├── api.ts             # API fetch wrapper
│       │   └── formatters.ts      # Data formatters
│       ├── next.config.mjs        # Next.js configuration
│       ├── tailwind.config.js     # Tailwind CSS config
│       ├── postcss.config.js      # PostCSS config
│       └── package.json           # Dashboard dependencies
├── tests/                         # Test suite
│   ├── setup.ts                   # Global test setup
│   ├── validation.test.ts         # Schema validation tests
│   └── security.test.ts           # Security middleware tests
├── docs/                          # Documentation
├── .env                           # Environment variables (gitignored)
├── .env.example                   # Environment variables template
├── .gitignore                     # Git ignore rules
├── docker-compose.yml             # Docker Compose configuration
├── Dockerfile                     # Docker build file
├── package.json                   # Root dependencies
├── tsconfig.json                  # TypeScript config
├── vitest.config.ts               # Vitest test config
├── tailwind.config.js             # Tailwind config
├── postcss.config.js              # PostCSS config
└── README.md                      # This file
```

---

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20+** ([Download](https://nodejs.org/))
- **PostgreSQL 14+** ([Download](https://www.postgresql.org/download/))
- **Git** ([Download](https://git-scm.com/))
- **Facebook Account** (for scraping groups)
- **OpenAI API Key** ([Get one here](https://platform.openai.com/api-keys))

### Installation

#### Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/tarasa-historic-extractor.git
cd tarasa-historic-extractor
```

#### Step 2: Install Dependencies

Install root project dependencies:

```bash
npm install
```

Install dashboard dependencies:

```bash
cd ui/dashboard
npm install
cd ../..
```

#### Step 3: Set Up PostgreSQL Database

**Option A: Local PostgreSQL (Recommended for Development)**

1. Start PostgreSQL service:
   ```bash
   # macOS (with Homebrew)
   brew services start postgresql@15
   
   # Linux
   sudo systemctl start postgresql
   
   # Windows
   # Start via Services or pgAdmin
   ```

2. Create the database:
   ```bash
   createdb tarasa_db
   ```

**Option B: Cloud PostgreSQL (Supabase, Neon, Railway)**

1. Create a free account on [Supabase](https://supabase.com), [Neon](https://neon.tech), or [Railway](https://railway.app)
2. Create a new PostgreSQL database
3. Copy the connection string (it will look like: `postgresql://user:password@host:5432/database`)

#### Step 4: Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` in your text editor and fill in the values:

```bash
# Facebook Credentials
FB_EMAIL=your_facebook_email@example.com
FB_PASSWORD=your_facebook_password

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-your-openai-api-key-here
OPENAI_CLASSIFIER_MODEL=gpt-4o-mini
OPENAI_GENERATOR_MODEL=gpt-4o-mini
CLASSIFIER_BATCH_SIZE=10
GENERATOR_BATCH_SIZE=10

# Database (use your PostgreSQL connection string)
# For local: postgresql://yourusername:@localhost:5432/tarasa_db
# For cloud: use the connection string provided by your service
POSTGRES_URL=postgresql://yourusername:@localhost:5432/tarasa_db
DATABASE_URL=postgresql://yourusername:@localhost:5432/tarasa_db

# Application Settings
PORT=4000
NODE_ENV=development
BASE_TARASA_URL=https://tarasa.com/add-story

# Facebook Groups to Scrape (comma-separated group IDs)
# To get group ID: open the group URL and copy the number after /groups/
GROUP_IDS=136596023614231,987654321,123456789

# Message Quota (prevents Facebook from flagging spam)
MAX_MESSAGES_PER_DAY=20

# Email Alerts (Optional - for 2FA/Captcha notifications)
# Use Gmail App Password: https://support.google.com/accounts/answer/185833
SYSTEM_EMAIL_ALERT=your_email@gmail.com
SYSTEM_EMAIL_PASSWORD=your_app_password
```

#### Step 5: Generate Prisma Client

```bash
npx prisma generate --schema=src/database/schema.prisma
```

#### Step 6: Run Database Migrations

This creates all the necessary tables in your database:

```bash
npx prisma migrate dev --name init --schema=src/database/schema.prisma
```

You should see output like:
```
✔ Generated Prisma Client
The following migration(s) have been applied:
migrations/
  └─ 0001_init/
    └─ migration.sql
Your database is now in sync with your schema.
```

---

## 🎮 Running the Project

### Development Mode

You need to run **two** processes simultaneously:

#### Terminal 1: API Server (Backend)

From the project root directory:

```bash
npm run dev
```

Expected output:
```
[info] Cron schedules registered
[info] API listening on port 4000
```

This starts:
- Express API server on `http://localhost:4000`
- All cron jobs (scraping, classification, messaging, login refresh)
- Database connection
- Logging system

**Keep this terminal running.**

#### Terminal 2: Dashboard (Frontend)

Open a new terminal and run:

```bash
cd ui/dashboard
npm run dev
```

Expected output:
```
▲ Next.js 16.0.3
- Local:    http://localhost:3000
✓ Ready in 2s
```

**Keep this terminal running.**

Now open your browser and navigate to:
- **Dashboard:** http://localhost:3000
- **API:** http://localhost:4000/api/health

#### Optional: Prisma Studio (Database Viewer)

```bash
npx prisma studio --schema=src/database/schema.prisma --port 5556
```

Opens a visual database browser at http://localhost:5556

### Quick Reference Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API server in development mode |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run scrape` | Manually trigger scraping |
| `npm run classify` | Manually trigger classification |
| `npm run generate` | Generate messages |
| `npm run message` | Send queued messages |
| `npm run fb:login` | Interactive Facebook login |
| `npm run session:check` | Check session status |
| `npm run cleanup:orphans` | Clean orphaned database records |
| `npm run smoke` | Run smoke tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Run pending migrations |

---

## 🔄 How It Works

### 1. Scraping Process (Every 10 Minutes)

The system uses an intelligent **Multi-Scraper Architecture** with automatic method selection:

```
Orchestrator (scrapeGroup)
    ↓
Check Cached Method for Group
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Try Scraping Methods (in priority order):                   │
│ 1. Known Working Method (skip detection if cached)          │
│ 2. MBasic Scraper (plain HTML, fastest)                     │
│ 3. Apify Scraper (public groups, circuit-breaker protected) │
│ 4. Playwright Scraper (authenticated, for private groups)   │
└─────────────────────────────────────────────────────────────┘
    ↓
Extract Posts Using Multi-Strategy Extractor (7 strategies)
    ↓
Upsert to Database (update if exists, create if new)
```

#### Scraper Methods Comparison

| Method | Use Case | Speed | Reliability | Requires Auth |
|--------|----------|-------|-------------|---------------|
| **MBasic** | Public groups | Very Fast | Medium | No |
| **Apify** | Public groups | Fast | High | No (via Apify API) |
| **Playwright** | Private groups | Slow | High | Yes |

The orchestrator:
1. Checks if a working method is cached for the group
2. Tries MBasic first (fastest, plain HTML parsing of m.facebook.com)
3. Falls back to Apify if MBasic fails (circuit-breaker protected)
4. Uses Playwright as final fallback (authenticated browser automation)
5. Caches the working method to skip detection on future scrapes

#### 7-Strategy Post Extraction

The extractor uses multiple fallback strategies to maximize data extraction:

| Strategy | Description | Reliability |
|----------|-------------|-------------|
| 1. Photo URL Pattern | Extract post ID from `set=pcb.XXXXX` in photo URLs | Highest (photo posts) |
| 2. __cft__ Matching | Correlate author links with post URLs via tracking params | High |
| 3. GraphQL Interception | Capture network requests during page load | Medium |
| 4. Data Attributes | Parse `data-ft` and similar Facebook attributes | Medium |
| 5. Author Link Patterns | Infer post ID from author profile link structure | Medium |
| 6. Post Container Analysis | Parse DOM structure for implicit IDs | Low |
| 7. Content Hash Fallback | SHA-256 hash of content + author for uniqueness | Always works |

#### Data Extracted Per Post

- **Post ID**: Real Facebook ID or content hash
- **Post Text**: Full content with "See more" expanded
- **Post URL**: Direct link to the Facebook post (when available)
- **Author Name**: From profile link text
- **Author Link**: Profile URL with 7 extraction strategies
- **Author Photo**: SVG `<image href="">` or `<img src="">` with position-based matching
- **Group ID**: Source group identifier

**Selectors Used:**
- Post containers: `div[role="article"]`
- Post text: `div[data-ad-comet-preview]`, `div[dir="auto"]`
- Author name: `strong a`, `h2 a`, `h3 a`, `h4 a`
- Author link: 7 different extraction strategies
- Author photo: SVG `<image>` elements, position-based matching

### 2. Classification Process (Every 3 Minutes)

The classifier:
1. Fetches unclassified posts from database
2. Sends each post to OpenAI with classification prompt
3. Receives structured JSON response:
   ```json
   {
     "is_historic": true,
     "confidence": 95,
     "reason": "Post describes personal memory of 1948 events"
   }
   ```
4. Only posts with confidence ≥ 75% proceed to message generation
5. Saves classification results to database

**Classification Criteria:**
- Historical events
- Personal memories related to past events
- Narratives referencing history or old times

### 3. Message Generation (Every 5 Minutes)

For valid historic posts (confidence ≥ 75%):
1. Detects the language of the original post
2. Generates personalized message **in the same language** using OpenAI
3. Creates pre-filled Tarasa submission link with post data
4. Stores message in queue (`MessageGenerated` table)
5. Validates message quality and naturalness

**Multilingual Support:**
- Hebrew (עברית)
- Arabic (العربية)
- English
- Any language detected in the original post

**Message Generation Rules:**
- Write in the **SAME LANGUAGE** as the original post
- Address author by first name warmly
- Compliment specific content they shared
- Introduce Tarasa platform mission
- Include pre-filled submission link
- Keep human-like (3-5 short sentences)
- No repetitive emojis or formal phrases

**Pre-filled Submission Link:**
```
https://tarasa.me/...?refPost=POST_ID&text=ENCODED_POST_TEXT
```
- `refPost`: Links submission back to original Facebook post
- `text`: Pre-fills story text field for easy submission

### 4. Message Sending (Every 5 Minutes)

The messenger bot:
1. Checks daily quota (respects `MAX_MESSAGES_PER_DAY`)
2. Opens author's Facebook profile
3. Clicks "Message" button
4. Waits for Messenger interface
5. Pastes generated message
6. Presses Enter to send
7. Records status in database
8. Updates quota counter

**Safety Features:**
- Rolling 24-hour quota tracking
- Human-like delays between actions (2-6 seconds)
- Browser fingerprint masking
- Cookie-based session persistence

### 5. Auto-Login System (Daily)

Maintains Facebook session:
1. Checks if cookies are still valid
2. Detects login screen, 2FA, or captcha
3. Auto-fills credentials if needed
4. Saves fresh cookies
5. Sends email alert if manual intervention required (2FA/Captcha)

---

## 📈 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     COMPLETE DATA FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

SCRAPING PHASE (every 10 min):
══════════════════════════════
Facebook Groups
    ↓
Orchestrator (method selection)
    ├→ MBasic Scraper (fast, public)
    ├→ Apify Scraper (reliable, public)
    └→ Playwright Scraper (auth, private)
    ↓
Multi-Strategy Extractor (7 strategies)
    ↓
┌──────────────────────────────────────────┐
│ Database: PostRaw table                  │
│ (posts with author info, text, URLs)     │
└──────────────────────────────────────────┘


CLASSIFICATION PHASE (every 3 min):
════════════════════════════════════
PostRaw (unclassified)
    ↓
OpenAI GPT-4o-mini
    ↓
Classification Result
{is_historic, confidence, reason}
    ↓
┌──────────────────────────────────────────┐
│ Database: PostClassified table           │
│ (linked to PostRaw)                      │
└──────────────────────────────────────────┘


MESSAGE GENERATION PHASE (every 5 min):
════════════════════════════════════════
PostClassified (is_historic=true, confidence≥75%)
    ↓
OpenAI GPT-4o-mini (same language as post)
    ↓
Personalized Message + Pre-filled Link
    ↓
┌──────────────────────────────────────────┐
│ Database: MessageGenerated queue         │
└──────────────────────────────────────────┘


MESSAGE DISPATCH PHASE (every 5 min):
═════════════════════════════════════
MessageGenerated (queued)
    ↓
Check: Quota OK? Session valid?
    ↓
Playwright → Author Profile → Messenger
    ↓
┌──────────────────────────────────────────┐
│ Database: MessageSent (status: sent/error│
└──────────────────────────────────────────┘


MONITORING (continuous):
════════════════════════
All Operations → SystemLog table
Session Health → SessionState table
Group Status → GroupInfo table
    ↓
WebSocket → Dashboard (real-time updates)
```

---

## 📊 Database Schema

### PostRaw
Stores scraped Facebook posts:
```prisma
model PostRaw {
  id          Int       @id @default(autoincrement())
  groupId     String    // Facebook group ID
  fbPostId    String    @unique // Facebook post ID (or hash if unavailable)
  authorName  String?   // Author's display name
  authorLink  String?   // Link to author's profile
  authorPhoto String?   // Author's profile photo URL
  text        String    // Post content
  postUrl     String?   // Direct link to the Facebook post
  scrapedAt   DateTime  @default(now())
  classified  PostClassified? // One-to-one relationship
}
```

**Note on fbPostId:**
- For posts with photos: Real Facebook post ID (e.g., `2298971240564729`)
- For text-only posts: Hash-based ID (e.g., `hash_eebadab68e59f13...`)
- Real IDs allow constructing valid post URLs

### PostClassified
AI classification results:
```prisma
model PostClassified {
  id           Int      @id @default(autoincrement())
  postId       Int      @unique
  isHistoric   Boolean  // True if post is historical
  confidence   Int      // 0-100 confidence score
  reason       String   // AI's explanation
  classifiedAt DateTime @default(now())
  post         PostRaw  @relation(fields: [postId], references: [id])
}
```

### MessageGenerated
Queued messages ready to send:
```prisma
model MessageGenerated {
  id          Int      @id @default(autoincrement())
  postId      Int
  messageText String   // English message content
  link        String   // Pre-filled Tarasa submission URL
  createdAt   DateTime @default(now())
}
```

### MessageSent
Message delivery history:
```prisma
model MessageSent {
  id          Int      @id @default(autoincrement())
  postId      Int
  authorLink  String   // Recipient's profile
  status      String   // 'sent' or 'error'
  sentAt      DateTime @default(now())
  error       String?  // Error message if failed
}
```

### SystemLog
All system events and errors:
```prisma
model SystemLog {
  id        Int      @id @default(autoincrement())
  type      String   // 'scrape', 'auth', 'classify', 'message', 'error'
  message   String   // Log description
  createdAt DateTime @default(now())
}
```

### SessionState
Facebook session health tracking:
```prisma
model SessionState {
  id           Int           @id @default(autoincrement())
  status       SessionStatus // valid, expired, invalid, refreshing, blocked, unknown
  lastChecked  DateTime      // When session was last checked
  lastValid    DateTime?     // Last time session was confirmed valid
  expiresAt    DateTime?     // Estimated expiration time
  userId       String?       // Facebook user ID
  userName     String?       // Facebook display name
  errorMessage String?       // Error details if any
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}

enum SessionStatus {
  valid
  expired
  invalid
  refreshing
  blocked
  unknown
}
```

### GroupInfo
Group metadata and scraping status:
```prisma
model GroupInfo {
  id           Int          @id @default(autoincrement())
  groupId      String       @unique  // Facebook group ID
  groupType    GroupType    // public, private, unknown
  groupName    String?      // Display name
  memberCount  Int?         // Number of members
  lastChecked  DateTime     // When group was last probed
  lastScraped  DateTime?    // When successfully scraped
  accessMethod AccessMethod // mbasic, apify, playwright, none
  isAccessible Boolean      @default(true)
  errorMessage String?      // Last error if any
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}

enum GroupType {
  public
  private
  unknown
}

enum AccessMethod {
  mbasic
  apify
  playwright
  none
}
```

---

## 🛠️ API Endpoints

All endpoints are available at `http://localhost:4000/api/`

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-17T15:30:00.000Z"
}
```

### GET /api/posts
Retrieve all scraped posts with classification data.

**Response:**
```json
[
  {
    "id": 1,
    "groupId": "https://www.facebook.com/groups/136596023614231",
    "fbPostId": "generated_155194473_495",
    "authorName": "David Matlow",
    "authorLink": "https://facebook.com/david.matlow",
    "text": "Historical post content...",
    "scrapedAt": "2025-11-17T15:12:51.368Z",
    "classified": {
      "id": 1,
      "postId": 1,
      "isHistoric": true,
      "confidence": 95,
      "reason": "Post describes historical treasure collection"
    }
  }
]
```

### GET /api/messages
View message queue and send history.

**Response:**
```json
{
  "queue": [
    {
      "id": 1,
      "postId": 1,
      "messageText": "English message content...",
      "link": "https://tarasa.com/add-story?refPost=1&text=...",
      "createdAt": "2025-11-17T15:20:00.000Z"
    }
  ],
  "sent": [
    {
      "id": 1,
      "postId": 2,
      "authorLink": "https://facebook.com/author",
      "status": "sent",
      "sentAt": "2025-11-17T15:25:00.000Z",
      "error": null
    }
  ],
  "stats": {
    "queue": 5,
    "sentLast24h": 12
  }
}
```

### GET /api/logs
System event logs (last 200).

**Response:**
```json
[
  {
    "id": 1,
    "type": "scrape",
    "message": "Captured 4 posts from https://www.facebook.com/groups/136596023614231",
    "createdAt": "2025-11-17T15:12:51.380Z"
  },
  {
    "id": 2,
    "type": "auth",
    "message": "Facebook session verified.",
    "createdAt": "2025-11-17T15:12:21.618Z"
  }
]
```

### POST /api/trigger-scrape
Manually trigger scraping process.

**Response:**
```json
{
  "status": "completed"
}
```

### POST /api/trigger-classification
Manually trigger classification process.

**Response:**
```json
{
  "status": "completed"
}
```

### POST /api/trigger-message
Manually trigger message generation and sending.

**Response:**
```json
{
  "status": "completed"
}
```

### GET /api/stats
Get overall system statistics.

**Response:**
```json
{
  "posts": {
    "total": 1034,
    "today": 45,
    "classified": 1000,
    "historic": 234,
    "pending": 34
  },
  "messages": {
    "generated": 150,
    "sent": 120,
    "sentToday": 15,
    "quota": {
      "used": 15,
      "limit": 20,
      "remaining": 5
    }
  },
  "groups": {
    "total": 3,
    "accessible": 3
  },
  "session": {
    "status": "valid",
    "lastChecked": "2025-11-17T15:00:00.000Z"
  }
}
```

### GET /api/stats/activity
Get daily activity data for charts (posts scraped, classified, messages sent).

**Query Parameters:**
- `days` (optional): Number of days to include (default: 7)

**Response:**
```json
[
  {
    "date": "Jan 11",
    "posts": 150,
    "classified": 145,
    "messages": 12
  },
  {
    "date": "Jan 12",
    "posts": 200,
    "classified": 198,
    "messages": 15
  }
]
```

### DELETE /api/data/reset
Delete all scraped data from the database. This is a destructive operation.

**Response:**
```json
{
  "success": true,
  "message": "All data has been deleted successfully",
  "deleted": {
    "posts": 1034,
    "classifications": 1034,
    "generatedMessages": 450,
    "sentMessages": 120,
    "logs": 3000
  }
}
```

### GET /api/session/status
Get current Facebook session status.

**Response:**
```json
{
  "status": "valid",
  "lastChecked": "2025-11-17T15:00:00.000Z",
  "lastValid": "2025-11-17T15:00:00.000Z",
  "userId": "100012345678901",
  "userName": "John Doe",
  "expiresAt": "2025-11-24T15:00:00.000Z",
  "canAccessPrivateGroups": true
}
```

### POST /api/session/renew
Manually renew/refresh the Facebook session.

**Response:**
```json
{
  "success": true,
  "message": "Session renewed successfully",
  "session": {
    "status": "valid",
    "userId": "100012345678901"
  }
}
```

### GET /api/groups
Get all configured groups with their scraping status.

**Response:**
```json
{
  "groups": [
    {
      "id": 1,
      "groupId": "136596023614231",
      "groupName": "Israeli History Group",
      "groupType": "public",
      "accessMethod": "apify",
      "isAccessible": true,
      "lastScraped": "2025-11-17T15:10:00.000Z",
      "lastChecked": "2025-11-17T15:10:00.000Z",
      "postsCount": 450,
      "errorMessage": null
    }
  ],
  "summary": {
    "total": 3,
    "accessible": 3,
    "public": 2,
    "private": 1
  }
}
```

### POST /api/groups/:groupId/refresh
Force refresh group metadata and access method detection.

**Response:**
```json
{
  "success": true,
  "group": {
    "groupId": "136596023614231",
    "groupType": "public",
    "accessMethod": "apify",
    "isAccessible": true
  }
}
```

### GET /api/settings
Get current system configuration.

**Response:**
```json
{
  "groups": ["136596023614231", "987654321"],
  "messaging": {
    "enabled": true,
    "dailyQuota": 20,
    "used": 15
  },
  "classification": {
    "model": "gpt-4o-mini",
    "batchSize": 25,
    "confidenceThreshold": 75
  },
  "scraping": {
    "interval": "*/10 * * * *",
    "maxBrowserInstances": 2
  },
  "session": {
    "status": "valid"
  }
}
```

---

## 🎨 Dashboard Features

Access the dashboard at http://localhost:3000

### Home Page
- **Posts scraped:** Total posts in database
- **Messages sent:** Messages delivered in last 24 hours
- **System logs:** Total system events logged

### Posts Page
View all scraped posts with:
- Author name
- Group source
- Classification status (Historic: Yes/No)
- Confidence score
- Post preview (first 120 characters)
- Scraped timestamp

### Messages Page
Two sections:

**Generated Queue:**
- Posts awaiting message delivery
- Message preview
- Tarasa submission link
- Creation timestamp

**Sent History:**
- Delivery status (sent/error)
- Recipient profile link
- Error details (if failed)
- Send timestamp

**Statistics:**
- Current queue size
- Messages sent in last 24 hours

### Logs Page
Chronological event log showing:
- Event type (scrape, auth, classify, message, error)
- Detailed message
- Timestamp

Useful for debugging and monitoring system health.

### Settings Page
View and manage configuration:

**Configuration Cards:**
- Configured Facebook groups
- Daily message limit
- Tarasa submission URL
- Email alerts status

**Facebook Session Management:**
- Real-time session status (Active/Expired with color indicator)
- User details: ID, Last Checked, Private Groups access
- One-click **"Renew Session"** button
- Automatic browser-based login refresh
- Helpful error messages for 2FA/captcha issues

**Manual Triggers:**
- Trigger Scrape
- Trigger Classification
- Trigger Messages
- All require API key authentication

**Danger Zone (Reset All Data):**
- One-click data reset for testing/debugging
- Two-step confirmation process:
  1. Click "Reset All Data" button
  2. Type `DELETE ALL DATA` to confirm
- Deletes ALL: posts, classifications, messages (generated & sent), logs
- Shows detailed summary of deleted items
- Useful for starting fresh or testing the system

### Groups Page (/groups)
Manage and monitor Facebook groups:

**Group Status Table:**
- Group ID and name
- Group type (public/private/unknown)
- Access method (MBasic/Apify/Playwright)
- Accessibility status
- Last scraped timestamp
- Post count from group
- Error messages (if any)

**Actions:**
- Refresh group detection
- Force re-probe access method
- View group on Facebook

**Summary Cards:**
- Total configured groups
- Accessible groups count
- Public vs private breakdown

### Debug Console (/debug)
Advanced real-time system monitoring with visual status indicators:

**Visual Status Indicator:**
The Debug Console features a prominent status indicator at the top that shows system health:

| Status | Color | Meaning |
|--------|-------|---------|
| **Healthy** | Green gradient with pulse animation | All systems operational, normal performance |
| **Degraded** | Yellow/orange gradient with bounce animation | Memory > 80% or CPU > 70%, needs attention |
| **Critical** | Red gradient with shake animation | System under stress, high error rate (> 10%), immediate action needed |
| **Offline** | Gray gradient, no animation | Unable to connect to server |

**Overview Tab:**
- **CPU Usage**: Real-time CPU percentage with progress bar
- **Memory Usage**: RAM consumption with visual indicator
- **Heap Usage**: Node.js heap memory statistics
- **Uptime**: How long the server has been running
- **Event Loop**: Latency monitoring (detects blocked event loop)
- **System Stress**: Automatic detection of performance issues
- **Request Statistics**: Requests/minute, average response time, error rate

**Requests Tab:**
- Live feed of HTTP requests
- Response times highlighted (slow requests marked in yellow/red)
- Method, path, status code, and timing for each request

**Errors Tab:**
- Categorized error tracking with fingerprinting
- Occurrence count for repeated errors
- One-click error resolution
- Error types: scraper, auth, api, database, external, unknown

**Healing Tab:**
- **Self-Healing Actions**: Automatic recovery attempts with status
- **Circuit Breakers**: Status of protection for external services (OpenAI, Apify)
  - Closed (green): Normal operation
  - Open (red): Service blocked due to failures
  - Half-open (yellow): Testing recovery

**Diagnostics Tab:**
- **Run Full Diagnostics**: One-click comprehensive system health check
- **11 Automated Tests** covering:
  - Database connection and table integrity
  - Facebook session validity
  - OpenAI API connectivity
  - Apify service status
  - Browser pool availability
  - Memory usage (RSS-based)
  - Environment variables
  - Group configuration
  - Classification queue
  - Recent scraping activity
- **Real-time Progress**: Watch tests run with live SSE streaming
- **Auto-Fix**: Automatically repairs issues when possible
- **Test Categories**: Color-coded by type (database, auth, services, etc.)
- **Result Persistence**: View last diagnostic run results

**Quick Actions:**
- **Trigger GC**: Force garbage collection to free memory
- **Run Healing**: Manually trigger self-healing checks
- **Auto-refresh Toggle**: Enable/disable real-time updates

### Backup Manager (/backup)
Complete database backup and restore system:

**Quick Backup:**
- One-click full database backup
- Creates compressed `.sql.gz` file with timestamp
- SHA-256 checksum verification

**Backup Types:**

| Type | Description | Contents |
|------|-------------|----------|
| **Full** | Complete database dump | All tables: PostRaw, PostClassified, MessageGenerated, MessageSent, SystemLog |
| **Incremental** | Changes since last backup | Only new/modified records (faster, smaller) |
| **Config** | Configuration only | Environment variables, session data, cookies |

**Backup History:**
- List of all backups with metadata
- File size, creation date, checksum
- Download and delete options

**Restore System:**
- Select backup to restore
- **Dry Run**: Preview what will be restored without making changes
- Full restore with automatic backup of current state
- Progress tracking during restore

**Scheduled Backups:**
- Automatic daily full backup at midnight
- Configurable via cron settings

---

## 🛡️ Self-Healing System

The system includes an intelligent self-healing engine that automatically detects and fixes common issues:

### Health Monitoring
The engine continuously monitors:
- Memory pressure (triggers GC when > 85% usage)
- Database connectivity (auto-reconnects on failure)
- External service availability (Apify, OpenAI)
- Event loop blocking (alerts on high latency)

### Automatic Recovery Actions

| Issue | Detection | Recovery Action |
|-------|-----------|-----------------|
| High Memory | Memory > 85% | Force garbage collection |
| Database Connection | Failed queries | Reconnect Prisma client |
| External Service Down | Circuit breaker open | Automatic retry after cooldown |
| Stale Session | Login failures | Clear cookies, re-authenticate |

### Circuit Breaker Pattern
External services are protected by circuit breakers:

```
CLOSED → OPEN → HALF_OPEN → CLOSED
   ↑        |        ↓
   └────────┴────────┘
```

- **Closed**: Normal operation, requests pass through
- **Open**: Too many failures, requests blocked (prevents cascade failures)
- **Half-Open**: Testing if service recovered, limited requests allowed

**Configuration:**
- Apify: Opens after 5 failures, resets after 1 hour
- OpenAI: Opens after 10 failures, resets after 15 minutes

---

## 📡 Real-Time Updates (WebSocket)

The system provides real-time updates to the dashboard via WebSocket:

### Event Types

| Event | Description | Payload |
|-------|-------------|---------|
| `metrics` | System metrics update | CPU, memory, heap, uptime |
| `scrape:start` | Scraping started | group, method |
| `scrape:complete` | Scraping finished | group, postsCount |
| `classify:complete` | Classification done | count, historic |
| `message:sent` | Message delivered | postId, authorLink |
| `error` | Error occurred | type, message |
| `session:status` | Session changed | status, userId |

### Connection

```typescript
// Dashboard connects automatically
const ws = new WebSocket('ws://localhost:4000');

ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  // Handle event...
};
```

### Event Emitter (Backend)

Central event bus for internal communication:

```typescript
import { eventEmitter } from './debug/eventEmitter';

// Emit events
eventEmitter.emit('scrape:complete', { group, postsCount });

// Listen for events
eventEmitter.on('error', (error) => {
  // Handle error...
});
```

---

## ⚠️ Known Limitations

### Post URL Extraction
- **Photo posts**: 100% post URL extraction (ID from `set=pcb.XXXXX`)
- **Text-only posts**: Use hash-based IDs (Facebook doesn't expose IDs in DOM)

### Apify Scraper
- Doesn't work reliably for Israeli/certain group types
- Falls back to Playwright automatically
- Circuit breaker prevents repeated failures

### Author Photo Extraction
- ~71% coverage (up from 47%)
- Facebook uses SVG images with `<image href="">` format
- Position-based matching as fallback

### Memory Usage
- Node.js heap usage of 80-97% is **normal**
- V8 intentionally fills heap before garbage collection
- RSS-based monitoring used instead (alerts only >1.5GB)

### Rate Limiting
- Facebook may block after too many messages
- Rolling 24-hour quota prevents spam detection
- Manual 2FA/Captcha solving may be required

---

## 🔒 Security Features

The system implements multiple layers of security:

### API Authentication
All sensitive endpoints require API key authentication:

```typescript
// Header-based authentication
Authorization: Bearer YOUR_API_KEY
// or
X-API-Key: YOUR_API_KEY
```

- API key is **mandatory** in production mode
- Set via `API_KEY` environment variable
- Dashboard requests include key automatically

### Rate Limiting
Prevents abuse and protects against DoS:

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| General API | 100 requests | 1 minute |
| Trigger endpoints | 30 requests | 1 minute |
| Login/Auth | 5 requests | 15 minutes |

- Uses Redis for distributed rate limiting (if configured)
- Falls back to in-memory limiting without Redis
- Returns `429 Too Many Requests` when exceeded

### Security Headers (Helmet)
```typescript
// Applied headers:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security (production)
- Content-Security-Policy
```

### CORS Protection
```typescript
// Configured origins (set via CORS_ORIGINS env var)
- http://localhost:3000 (development)
- https://yourdomain.com (production)
```

### Request Sanitization
Protects against:
- **Prototype pollution**: Strips `__proto__`, `constructor`, `prototype` from requests
- **SQL injection**: Uses Prisma ORM with parameterized queries
- **XSS**: Input validation and output encoding
- **Path traversal**: Validates file paths

### Message Quota System
Prevents Facebook spam detection:

```typescript
// Rolling 24-hour quota (not calendar day)
MAX_MESSAGES_PER_DAY=20

// Quota counts ALL attempts:
- Successful sends
- Failed attempts
- Pending messages
```

---

## 🧰 Utility Scripts

Located in `src/scripts/`, these help with development and debugging:

### Facebook Login Script
```bash
npm run fb:login
# Or directly:
npx ts-node src/scripts/facebook-login.ts
```
Opens a browser for manual Facebook login and saves cookies.

### Session Check Script
```bash
npm run session:check
```
Validates current session status and reports health.

### Test Scrapers Script
```bash
npx ts-node src/scripts/test-scrapers.ts
```
Tests each scraper method (MBasic, Apify, Playwright) independently.

### Cleanup Orphans Script
```bash
npm run cleanup:orphans
```
Removes orphaned database records (messages without posts, etc.).

### Check Stats Script
```bash
npx ts-node src/scripts/check-stats.ts
```
Displays current database statistics and system health.

### Smoke Tests
```bash
npm run smoke
```
Runs basic functionality tests to verify system is working.

### Debug Scripts
Various debug scripts for specific issues:
```bash
npx ts-node src/scripts/debug-extraction.ts  # Test post extraction
npx ts-node src/scripts/debug-session.ts     # Debug session issues
```

---

## 📡 Debug API Endpoints

### GET /api/debug/overview
Complete system status overview.

**Response:**
```json
{
  "timestamp": "2025-11-17T15:30:00.000Z",
  "system": {
    "metrics": {
      "cpu": { "usage": 12.5, "cores": 8 },
      "memory": { "usagePercent": 45.2, "heapUsed": 52428800 },
      "eventLoop": { "latency": 1.2, "isBlocked": false }
    },
    "stressStatus": { "stressed": false, "reasons": [] }
  },
  "requests": {
    "stats": { "totalRequests": 1500, "errorRate": 0.5 }
  },
  "healing": {
    "enabled": true,
    "activeIssues": [],
    "actionsExecuted": 5
  }
}
```

### GET /api/debug/requests
Recent HTTP request logs with performance data.

### GET /api/debug/errors
Unresolved errors with categorization and occurrence counts.

### POST /api/debug/gc
Trigger manual garbage collection.

### POST /api/debug/healing/run
Run self-healing checks manually.

### GET /api/backup/list
List all available backups.

### POST /api/backup/quick
Create a one-click full backup.

**Response:**
```json
{
  "success": true,
  "backup": {
    "id": "backup-2025-11-17-153000",
    "type": "full",
    "size": 1048576,
    "checksum": "sha256:abc123...",
    "createdAt": "2025-11-17T15:30:00.000Z"
  }
}
```

### POST /api/backup/restore
Restore from a backup file.

**Request:**
```json
{
  "backupId": "backup-2025-11-17-153000",
  "dryRun": true
}
```

---

## 🔧 Troubleshooting

### Issue: "Can't reach database server"

**Solution:**
1. Ensure PostgreSQL is running:
   ```bash
   # macOS
   brew services list | grep postgresql
   
   # Linux
   sudo systemctl status postgresql
   ```

2. Test connection manually:
   ```bash
   psql -d tarasa_db -c "SELECT 1;"
   ```

3. Verify `POSTGRES_URL` in `.env` matches your setup

### Issue: "OpenAI API quota exceeded"

**Solution:**
1. Go to https://platform.openai.com/account/billing
2. Add payment method
3. Purchase credits ($5-10 recommended for testing)
4. Wait 1-2 minutes for credits to activate

### Issue: Facebook login fails

**Solutions:**

**A. Cookies expired:**
- Delete `src/config/cookies.json`
- System will re-login automatically on next run

**B. 2FA required:**
- Check your email for alert notification
- Open browser manually, complete 2FA
- Let system save new cookies

**C. Captcha appeared:**
- Manually solve captcha in the browser window
- System will continue automatically after

### Issue: No posts scraped

**Check these:**

1. **Verify group ID is correct:**
   - Open group in browser: `https://facebook.com/groups/YOUR_GROUP_ID`
   - Check if group is public/accessible

2. **Check selectors:**
   - Facebook may have changed their HTML
   - Check logs for "Found 0 post containers"
   - May need to update `src/utils/selectors.ts`

3. **Posts too short:**
   - System ignores posts < 30 characters
   - Check `src/scraper/extractors.ts` minimum length setting

### Issue: Dashboard not loading

**Solutions:**

1. **Ensure API is running:**
   ```bash
   curl http://localhost:4000/api/health
   ```

2. **Check both servers are running:**
   - Terminal 1: API on port 4000
   - Terminal 2: Dashboard on port 3000

3. **Clear Next.js cache:**
   ```bash
   cd ui/dashboard
   rm -rf .next
   npm run dev
   ```

### Issue: Cron jobs not running

**Check:**
1. Look for "Cron schedules registered" in API server logs
2. Cron jobs only work when API server is running
3. Check system time is correct (cron uses system clock)

---

## 🧪 Testing

The project includes a comprehensive test suite using Vitest:

### Running Tests

```bash
# Run all tests
npm run test:unit

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Structure

```
tests/
├── setup.ts              # Global test setup and mocks
├── validation.test.ts    # Zod validation schema tests
└── security.test.ts      # Security middleware tests
```

### Test Categories

| Category | Description |
|----------|-------------|
| **Validation** | Tests for Zod schemas (pagination, filters, classification results) |
| **Security** | Tests for rate limiting, CORS, request sanitization |
| **Integration** | End-to-end tests for API endpoints (when database available) |

### Writing Tests

Tests use Vitest with the following patterns:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Feature Name', () => {
  it('should do something specific', () => {
    // Arrange
    const input = { ... };

    // Act
    const result = someFunction(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

---

## 📝 Configuration Reference

### System Constants

The system uses centralized constants defined in `src/config/constants.ts`:

#### Timeouts
| Constant | Value | Description |
|----------|-------|-------------|
| `PAGE_LOAD_TIMEOUT` | 60000ms | Maximum time to wait for page load |
| `NAVIGATION_TIMEOUT` | 30000ms | Maximum time for navigation |
| `ELEMENT_TIMEOUT` | 10000ms | Maximum time to find elements |
| `API_TIMEOUT` | 30000ms | External API request timeout |

#### Delays (Human-like)
| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_ACTION_DELAY` | 2000ms | Minimum delay between actions |
| `MAX_ACTION_DELAY` | 6000ms | Maximum delay between actions |
| `SCROLL_DELAY` | 1500ms | Delay after scrolling |
| `TYPE_DELAY` | 50-150ms | Delay between keystrokes |

#### Batch Sizes
| Constant | Default | Description |
|----------|---------|-------------|
| `CLASSIFIER_BATCH_SIZE` | 25 | Posts classified per run |
| `GENERATOR_BATCH_SIZE` | 20 | Messages generated per run |
| `SCRAPE_SCROLL_COUNT` | 5 | Number of scrolls per group |

#### Quotas
| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_MESSAGES_PER_DAY` | 20 | Rolling 24-hour message limit |
| `MAX_BROWSER_INSTANCES` | 2 | Concurrent browser limit |
| `MAX_RETRY_ATTEMPTS` | 3 | Message retry attempts |

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FB_EMAIL` | Yes | Facebook login email | `user@example.com` |
| `FB_PASSWORD` | Yes | Facebook login password | `mySecurePass123` |
| `OPENAI_API_KEY` | Yes | OpenAI API key | `sk-proj-abc123...` |
| `OPENAI_CLASSIFIER_MODEL` | No | Model for classification | `gpt-4o-mini` (default) |
| `OPENAI_GENERATOR_MODEL` | No | Model for message gen | `gpt-4o-mini` (default) |
| `CLASSIFIER_BATCH_SIZE` | No | Posts to classify at once | `10` (default) |
| `GENERATOR_BATCH_SIZE` | No | Messages to generate at once | `10` (default) |
| `POSTGRES_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/tarasa_db` |
| `DATABASE_URL` | Yes | Same as POSTGRES_URL | (same value) |
| `PORT` | No | API server port | `4000` (default) |
| `NODE_ENV` | No | Environment | `development` or `production` |
| `BASE_TARASA_URL` | Yes | Tarasa submission URL | `https://tarasa.com/add-story` |
| `GROUP_IDS` | Yes | Comma-separated group IDs | `123,456,789` |
| `MAX_MESSAGES_PER_DAY` | No | Daily message quota | `20` (default) |
| `SYSTEM_EMAIL_ALERT` | No | Email for alerts (2FA/captcha) | `alerts@example.com` |
| `SYSTEM_EMAIL_PASSWORD` | No | Email app password | (Gmail app password) |
| `API_KEY` | Prod | API key for authenticated requests | (random hash) |
| `MAX_BROWSER_INSTANCES` | No | Maximum concurrent browser instances | `2` (default) |
| `APIFY_TOKEN` | No | Apify API token for public group scraping | `apify_api_xxx...` |
| `APIFY_RESULTS_LIMIT` | No | Max results from Apify per scrape | `100` (default) |
| `HEADLESS` | No | Run browser in headless mode | `true` (default) |
| `REDIS_URL` | No | Redis connection for caching/queues | `redis://localhost:6379` |
| `SENTRY_DSN` | No | Sentry DSN for error tracking | `https://xxx@sentry.io/xxx` |
| `CORS_ORIGINS` | No | Allowed CORS origins (comma-separated) | `http://localhost:3000` |
| `TRIGGER_RATE_LIMIT_PER_MINUTE` | No | Rate limit for trigger endpoints | `30` (default) |
| `SCRAPE_CRON_SCHEDULE` | No | Cron schedule for scraping | `*/10 * * * *` (every 10 min) |
| `CLASSIFY_CRON_SCHEDULE` | No | Cron schedule for classification | `*/3 * * * *` (every 3 min) |
| `MESSAGE_CRON_SCHEDULE` | No | Cron schedule for messaging | `*/5 * * * *` (every 5 min) |
| `BACKUP_CRON_SCHEDULE` | No | Cron schedule for backups | `0 0 * * *` (midnight) |
| `CONFIDENCE_THRESHOLD` | No | Minimum confidence for message generation | `75` (default) |

### Cron Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| Scrape | `*/10 * * * *` | Every 10 minutes |
| Classify | `*/3 * * * *` | Every 3 minutes |
| Message | `*/5 * * * *` | Every 5 minutes |
| Login Refresh | `0 0 * * *` | Daily at midnight |

To modify schedules, edit files in `src/cron/`

---

## 🚀 Production Deployment

### Recommended Stack

- **Hosting:** Railway, Render, Heroku, or DigitalOcean
- **Database:** Supabase, Neon, or Railway PostgreSQL
- **Redis:** Redis Cloud, Upstash, or Railway Redis (optional but recommended)
- **Process Manager:** PM2 (for keeping server alive)
- **Error Tracking:** Sentry (optional)

### Docker Deployment

The project includes Docker support for easy deployment:

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t tarasa-extractor .
docker run -d \
  --env-file .env \
  -p 4000:4000 \
  tarasa-extractor
```

**Docker Compose** (`docker-compose.yml`) includes:
- Application container
- PostgreSQL database (optional - can use external)
- Redis for caching (optional)

### Redis Configuration (Optional)

Redis provides:
- **Caching**: Faster API responses
- **Rate Limiting**: Distributed rate limiting across instances
- **Job Queues**: BullMQ for reliable job processing

```bash
# Local development
REDIS_URL=redis://localhost:6379

# Cloud (Upstash, Redis Cloud)
REDIS_URL=redis://username:password@host:port

# If Redis is unavailable, the system falls back to in-memory alternatives
```

### Sentry Error Tracking (Optional)

Monitor production errors with Sentry:

1. Create a Sentry project at https://sentry.io
2. Get your DSN from Project Settings > Client Keys
3. Set environment variable:
   ```bash
   SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```

Features:
- Automatic error capture with stack traces
- Performance monitoring (10% sample in production)
- Error filtering for expected errors (network issues, etc.)
- Release tracking

### Deployment Steps

1. **Prepare environment variables:**
   ```bash
   # Set NODE_ENV to production
   NODE_ENV=production
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Start with PM2:**
   ```bash
   npm install -g pm2
   pm2 start dist/server.js --name tarasa-api
   pm2 startup
   pm2 save
   ```

4. **Deploy dashboard:**
   ```bash
   cd ui/dashboard
   npm run build
   npm start
   ```

5. **Set up reverse proxy (Nginx example):**
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       
       location /api {
           proxy_pass http://localhost:4000;
       }
       
       location / {
           proxy_pass http://localhost:3000;
       }
   }
   ```

### Production Checklist

- [ ] Environment variables configured (`NODE_ENV=production`)
- [ ] Database connection secured (SSL mode enabled)
- [ ] Database backups enabled
- [ ] `API_KEY` set to a secure random value
- [ ] `CORS_ORIGINS` set to your frontend domains only
- [ ] Redis configured for distributed rate limiting (optional)
- [ ] Sentry DSN configured for error tracking (optional)
- [ ] SSL certificates installed (HTTPS)
- [ ] Rate limiting configured
- [ ] Log rotation enabled
- [ ] Cron jobs running
- [ ] Health checks responding (`/api/health`)
- [ ] Monitoring/alerting set up

---

## 🔌 External Dependencies & APIs

### OpenAI API
Used for AI-powered classification and message generation.

| Feature | Model | Purpose |
|---------|-------|---------|
| Classification | gpt-4o-mini | Determine if posts are historic |
| Message Generation | gpt-4o-mini | Create personalized outreach messages |

**Rate Limiting:**
- Circuit breaker opens after 10 failures
- Resets after 15 minutes
- Exponential backoff on retries

**Cost Estimate:** ~$0.01 per 100 posts classified

### Apify API
Used for public group scraping without authentication.

**Actor:** `apify/facebook-groups-scraper`

| Setting | Value |
|---------|-------|
| Results Limit | Configurable (default: 100) |
| Circuit Breaker | Opens after 5 failures |
| Reset Time | 1 hour |

**Limitations:**
- Doesn't work for all group types
- May fail for Israeli history groups
- Falls back to Playwright automatically

### Playwright
Browser automation for authenticated scraping and messaging.

**Features:**
- Stealth mode (puppeteer-extra plugins)
- Persistent browser profile
- Cookie-based session management
- Human-like delays and interactions

**Browser Pool:**
- Default: 2 concurrent instances
- Configurable via `MAX_BROWSER_INSTANCES`
- Automatic cleanup on shutdown

### Email (Nodemailer)
Used for alert notifications (2FA, captcha, errors).

**Configuration:**
```bash
SYSTEM_EMAIL_ALERT=your@gmail.com
SYSTEM_EMAIL_PASSWORD=app-password  # Gmail App Password
```

### Redis (Optional)
Used for distributed rate limiting and caching.

**Features:**
- Rate limiting across instances
- Session caching
- Job queue backing (BullMQ)

**Fallback:** In-memory alternatives when Redis unavailable

### Sentry (Optional)
Error tracking and performance monitoring.

**Features:**
- Automatic exception capture
- Performance sampling (10% in production)
- Release tracking

---

## 🤝 Contributing

This is a private project for Tarasa, but if you'd like to contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is proprietary and confidential. All rights reserved.

---

## 🙏 Acknowledgments

- **Playwright** for robust browser automation
- **OpenAI** for powerful AI classification
- **Prisma** for excellent TypeScript ORM
- **Next.js** for modern React framework

---

## 📞 Support

For issues or questions:
- Create an issue in the repository
- Contact the development team
- Check the troubleshooting section above

---

## 🔄 Version History

### v1.5.0 (Current)
Major update with post URL extraction improvements, activity chart fixes, and data management features:

**Post URL Extraction Enhancement:**
- ✅ New extraction strategy using `set=pcb.XXXXX` pattern from photo URLs
- ✅ Added `__cft__` parameter matching to correlate author links with post URLs
- ✅ Priority-based post ID extraction:
  1. Extract from post URL (most reliable)
  2. Try intercepted GraphQL data
  3. Fallback to content hash
- ✅ Post URLs now extracted for posts with photos (100% coverage for photo posts)
- ✅ Construct post URLs from valid `fbPostId` + `groupId` when not stored

**Activity Chart Fix:**
- ✅ Fixed graph showing incorrect data (was limited to 500 posts)
- ✅ New `/api/stats/activity` endpoint queries database directly
- ✅ Accurate daily counts for posts scraped, classified, and messages sent
- ✅ Configurable date range (default: 7 days)

**Reset All Data Feature:**
- ✅ New "Danger Zone" section in Settings page
- ✅ "Reset All Data" button with two-step confirmation
- ✅ Requires typing "DELETE ALL DATA" to confirm
- ✅ Deletes: posts, classifications, generated messages, sent messages, logs
- ✅ Shows detailed deletion summary after completion
- ✅ New API endpoint: `DELETE /api/data/reset`

**Post Detail Modal Enhancement:**
- ✅ "View Original Post on Facebook" button
- ✅ Computes `effectivePostUrl` from `fbPostId` + `groupId` when URL not stored
- ✅ Post link badge in metadata section

**API Endpoints Added:**
- `GET /api/stats/activity?days=7` - Get daily activity data for charts
- `DELETE /api/data/reset` - Delete all scraped data (requires confirmation)

**Known Limitations:**
- Post URLs only available for posts with photos (text-only posts don't expose IDs in DOM)
- Facebook's modern DOM doesn't expose post IDs in data attributes for text-only posts

### v1.4.0
Major update with comprehensive diagnostics, session management, and critical bug fixes:

**System Diagnostics:**
- ✅ New comprehensive diagnostic system with 11 automated tests
- ✅ Real-time SSE streaming for live progress updates
- ✅ Auto-fix capabilities for common issues:
  - Database reconnection on failure
  - Circuit breaker reset for OpenAI/Apify
  - Memory monitoring (RSS-based, not heap percentage)
- ✅ New "Diagnostics" tab in Debug Console with animated UI
- ✅ Category-based test organization (database, auth, services, scraping, ai, system)
- ✅ Test result persistence for viewing last diagnostic run

**Facebook Session Management:**
- ✅ New "Facebook Session" section in Settings page
- ✅ Real-time session status display (Active/Expired)
- ✅ Session details: User ID, Last Checked, Private Groups access
- ✅ One-click "Renew Session" button
- ✅ New API endpoint: `POST /api/session/renew`
- ✅ Helpful error hints for 2FA and captcha issues

**Author Photo Extraction Fix:**
- ✅ Fixed critical bug where 53% of posts were missing author photos
- ✅ Adapted to Facebook's new DOM structure (SVG `<image href="">` instead of `<img src="">`)
- ✅ Implemented position-based photo matching for alternative extraction
- ✅ Conditional upsert logic to preserve existing photos when new extraction fails
- ✅ Photo coverage improved from 47% to 71.4% for active groups

**Memory Monitoring Fix:**
- ✅ Fixed false "Memory Critical" alerts in diagnostics
- ✅ Changed from heap percentage (misleading) to RSS total (accurate)
- ✅ Node.js naturally uses most of its heap - this is normal behavior
- ✅ Only alerts when total memory exceeds 1.5GB (indicates real leak)

**API Endpoints Added:**
- `GET /api/debug/diagnostics` - Get last diagnostic result
- `GET /api/debug/diagnostics/stream` - Run diagnostics with SSE streaming
- `POST /api/debug/diagnostics/run` - Run diagnostics (non-streaming)
- `POST /api/session/renew` - Manually renew Facebook session

**UI Improvements:**
- New Diagnostics tab with gradient hero section
- Animated test cards with category icons
- Real-time progress indicators
- Color-coded status (passed=green, fixed=blue, failed=red)
- Session status cards in Settings page

### v1.3.0
Maintenance release with improved configuration and documentation:

**Configuration:**
- Fixed Vitest 4 deprecation warning (migrated `poolOptions` to new format)
- Expanded `.env.example` with all configuration options
- Added Redis, Sentry, CORS, and rate limiting documentation
- Improved environment variable documentation

**Documentation:**
- Added comprehensive Testing section with Vitest usage examples
- Added Docker deployment section with docker-compose support
- Added Redis configuration guide
- Added Sentry error tracking setup guide
- Updated Production Checklist with security best practices
- Enhanced Environment Variables table with all new options

**Dependencies:**
- Updated Vitest configuration for v4 compatibility
- Addressed low-severity security advisories (documented)

### v1.2.0
Major update with advanced debugging and backup system:

**Debug Console:**
- Real-time system monitoring dashboard with WebSocket updates
- Visual status indicator with animated states (healthy/degraded/critical/offline)
- CPU, memory, heap, and event loop monitoring
- HTTP request tracking with response time analysis
- Error tracking with categorization and deduplication
- Self-healing engine with automatic problem detection and recovery
- Circuit breaker status monitoring for external services
- One-click garbage collection trigger
- Manual healing run capability

**Backup System:**
- One-click full database backup
- Incremental backup support (changes only)
- Configuration backup (env vars, cookies)
- Gzip compression with SHA-256 checksums
- Backup restoration with dry-run preview
- Scheduled daily backups at midnight
- Backup history with download/delete options

**Self-Healing Engine:**
- Memory pressure detection and automatic GC
- Database reconnection on failures
- External service monitoring
- Event loop blocking detection
- Automated recovery actions with logging

**UI Improvements:**
- Animated status indicators with CSS animations
- Glass effect styling
- Progress bars for system metrics
- Tab-based navigation in debug console
- Real-time WebSocket updates

### v1.1.0
Major reliability and performance improvements:

**Circuit Breaker Pattern:**
- ✅ Added circuit breaker for Apify API (opens after 5 failures, resets after 1 hour)
- ✅ Added circuit breaker for OpenAI API (opens after 10 failures, resets after 15 minutes)
- ✅ Prevents cascade failures when external services are down
- ✅ Automatic recovery with half-open state testing

**Browser Resource Management:**
- ✅ New `BrowserPool` utility limits concurrent browser instances (default: 2)
- ✅ Prevents memory exhaustion during parallel scraping
- ✅ Queuing system for requests when pool is full
- ✅ Configurable via `MAX_BROWSER_INSTANCES` environment variable

**Message Deduplication:**
- ✅ Added unique constraint on `(postId, authorLink)` in MessageSent table
- ✅ Added `retryCount` field to track message retry attempts
- ✅ Maximum 3 retry attempts per message to prevent spam
- ✅ Fixed quota calculation to count ALL message attempts (not just successful)

**Session Management:**
- ✅ Added startup session validation before cron jobs begin
- ✅ Session health synced with database on every validation
- ✅ Automatic lock file cleanup on browser launch
- ✅ Better handling of stale browser profiles

**Performance Optimizations:**
- ✅ Increased classifier batch size from 10 to 25
- ✅ Increased message generator batch size from 10 to 20
- ✅ Reduced scroll wait times for faster scraping
- ✅ Optimized page load detection

**Security Improvements:**
- ✅ API_KEY is now mandatory in production mode
- ✅ Proper API authentication for all dashboard endpoints

**Bug Fixes:**
- ✅ Fixed confidence validation (0-100 range check)
- ✅ Fixed browser launch errors with persistent profiles
- ✅ Fixed message quota calculation including all attempts

### v1.0.0
- ✅ Facebook scraping with auto-login
- ✅ AI classification (OpenAI GPT-4o-mini)
- ✅ English message generation
- ✅ Messenger automation
- ✅ Real-time dashboard
- ✅ Cron job scheduling
- ✅ Error handling & logging
- ✅ Session management
- ✅ Daily quota controls

---

## 🧗 Development Challenges & Solutions

This section documents significant technical challenges encountered during development and how they were resolved. Useful for understanding design decisions and troubleshooting similar issues.

### Challenge 1: Dashboard Causing Rate Limiting Issues

**Problem:** The dashboard was polling the API every 10 seconds, which triggered rate limiting and caused "Too Many Requests" errors. The `/api/debug/overview` endpoint was being called excessively.

**Root Cause:**
- Dashboard auto-refresh interval was too aggressive
- The orchestrator's `getScrapingStatus()` was calling `detectGroupType()` for each group on every poll
- This triggered session validation and Apify probes repeatedly

**Solution:**
- Changed `getScrapingStatus()` to read from cache only (no fresh detection)
- Added batch fetching for group info to reduce database queries
- Optimized dashboard polling to avoid unnecessary API calls

**Files Modified:** `src/scraper/orchestrator.ts`, `src/routes/session.ts`

---

### Challenge 2: Author Photos Missing (53% of Posts)

**Problem:** Author profile photos stopped appearing for many posts. Analysis showed 53% of posts were missing photos, correlating with missing author names.

**Root Cause:**
Facebook changed their DOM structure:
- **Before:** `<img src="photo_url" alt="author">`
- **After:** `<svg><image href="photo_url" /></svg>`

The extractors were looking for `img` tags but Facebook switched to SVG images with `href` attributes.

**Solution:**
1. Updated photo extraction to handle SVG images:
   ```typescript
   // Strategy 1: SVG image elements
   const svgImages = el.querySelectorAll('svg image');
   for (const img of svgImages) {
     const href = img.getAttribute('href') ||
                  img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
     if (href && href.includes('scontent')) return href;
   }
   ```

2. Implemented position-based photo matching for alternative extraction:
   - Collect ALL profile photos on the page first
   - Match photos to posts based on y-coordinate proximity (within 100px)

3. Modified upsert logic to preserve existing photos:
   ```typescript
   // Only update author fields if we have new data
   if (post.authorName) updateData.authorName = post.authorName;
   if (post.authorPhoto) updateData.authorPhoto = post.authorPhoto;
   ```

**Result:** Photo coverage improved from 47% to 71.4%

**Files Modified:** `src/scraper/extractors.ts`, `src/scraper/orchestrator.ts`

---

### Challenge 3: False "Memory Critical" Alerts

**Problem:** The diagnostic system was showing "Memory Critical: 97%" even when the system was running fine.

**Root Cause:**
Node.js heap memory behavior was misunderstood:
- Node.js uses V8's garbage collector which intentionally fills the heap before collecting
- High heap percentage (80-97%) is **normal** and **expected**
- The diagnostic was using heap percentage as a health indicator (incorrect)

**Solution:**
Changed memory monitoring from heap percentage to RSS (Resident Set Size):
```typescript
// OLD (incorrect):
const usagePercent = (heapUsed / heapTotal) * 100;
if (usagePercent > 95) { /* fail */ }

// NEW (correct):
const rssMB = Math.round(memUsage.rss / 1024 / 1024);
if (rssMB > 1500) { /* fail - only if RSS exceeds 1.5GB */ }
```

**Key Learning:** Node.js memory management is different from traditional apps. High heap usage is a feature, not a bug.

**Files Modified:** `src/debug/diagnostics.ts`

---

### Challenge 4: Prisma Studio Port Conflict

**Problem:** Running `npx prisma studio` failed with "Address already in use" errors.

**Root Cause:** Prisma Studio defaults to port 5555, but something was already using it (or confusion with port 4000).

**Solution:** Use explicit port flag:
```bash
npx prisma studio --schema=src/database/schema.prisma --port 5556
```

---

### Challenge 5: Classification Appearing Stuck

**Problem:** User reported seeing many posts "waiting for classification" and suspected the classifier was broken.

**Investigation:**
1. Checked SystemLog for classification events
2. Found regular entries: "Classified 10 posts", "Classified 5 posts"
3. Classifier was actually working fine

**Root Cause:** Console logging was minimal, making it seem like nothing was happening.

**Solution:** Confirmed via database query that classification was processing correctly. No code changes needed - just needed better visibility (which the new Diagnostics system now provides).

---

### Challenge 6: Circuit Breaker Issues with Apify

**Problem:** Apify was failing for Israeli history groups, triggering circuit breaker and blocking all Apify requests.

**Root Cause:**
- Facebook blocks Apify's scrapers for certain group types
- Apify returns "Empty or private data" even for public groups
- Circuit breaker correctly opened after repeated failures

**Solution:**
1. Skip Apify entirely for groups where it's known to fail
2. Cache the working method per group to avoid re-probing
3. Go directly to Playwright for groups where Apify doesn't work:
   ```typescript
   if (knownWorkingMethod === 'playwright') {
     // Skip directly to Playwright
   }
   ```

**Files Modified:** `src/scraper/orchestrator.ts`

---

### Challenge 7: Port Already In Use Errors

**Problem:** Frequent "EADDRINUSE: address already in use :::4000" errors when starting the server.

**Root Cause:** Previous server process didn't shut down cleanly, leaving the port bound.

**Solution:** Kill orphaned processes before starting:
```bash
# Kill any process using port 4000
lsof -ti:4000 | xargs kill -9

# Or kill ts-node processes
pkill -f "ts-node.*server"
```

**Tip:** Add to package.json scripts for convenience:
```json
"predev": "lsof -ti:4000 | xargs kill -9 2>/dev/null || true"
```

---

### Challenge 8: SSE Streaming for Real-Time Diagnostics

**Problem:** Need to show real-time progress as diagnostic tests run, not just final results.

**Solution:** Implemented Server-Sent Events (SSE) for streaming:

**Backend:**
```typescript
router.get('/api/debug/diagnostics/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  await runFullDiagnostics((progress) => {
    res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
  });

  res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
  res.end();
});
```

**Frontend:**
```typescript
const eventSource = new EventSource('/api/debug/diagnostics/stream');
eventSource.addEventListener('progress', (event) => {
  setDiagnosticResult(JSON.parse(event.data));
});
```

**Key Learning:** SSE is simpler than WebSockets for one-way server-to-client streaming.

---

### Challenge 9: Post URLs Not Being Extracted

**Problem:** Post URLs were missing for 100% of scraped posts. Users couldn't click through to view the original Facebook post.

**Root Cause:**
Facebook's modern DOM structure doesn't expose post IDs in data attributes. The old `data-ft` attributes with `story_fbid` are no longer present in the React-based SPA.

**Investigation:**
1. Created debug scripts to analyze DOM structure
2. Found that GraphQL interception wasn't working (Facebook renders server-side)
3. Discovered that photo URLs contain post IDs in `set=pcb.XXXXX` parameter

**Solution:**
Implemented multiple extraction strategies:

1. **Photo URL Pattern** (most reliable for photo posts):
   ```typescript
   // Extract post ID from photo URL
   const pcbMatch = href.match(/set=pcb\.(\d+)/);
   if (pcbMatch && groupId) {
     postUrl = `https://www.facebook.com/groups/${groupId}/posts/${pcbMatch[1]}`;
   }
   ```

2. **__cft__ Parameter Matching**:
   ```typescript
   // All links in a post share the same __cft__ tracking parameter
   const cftMatch = authorLink.match(/__cft__\[0\]=([^&]+)/);
   // Find post URLs with matching __cft__
   ```

3. **Priority-Based ID Extraction**:
   - First: Extract from post URL if available
   - Second: Try intercepted GraphQL data
   - Third: Fallback to content hash

4. **Frontend Fallback** (for existing data):
   ```typescript
   const effectivePostUrl = post.postUrl || (
     !post.fbPostId.startsWith('hash_') && /^\d+$/.test(post.fbPostId)
       ? `https://www.facebook.com/groups/${post.groupId}/posts/${post.fbPostId}`
       : null
   );
   ```

**Result:**
- Posts with photos: 100% post URL extraction
- Text-only posts: Still use hash-based IDs (Facebook limitation)

**Key Learning:** Facebook intentionally hides post IDs in the DOM for privacy. Photo URLs are currently the only reliable source of post IDs.

**Files Modified:** `src/scraper/extractors.ts`, `ui/dashboard/components/PostDetailModal.tsx`

---

### Challenge 10: Activity Chart Showing Wrong Data

**Problem:** Dashboard activity chart showed incorrect numbers. Total posts (1,034) didn't match sum of daily values shown in graph.

**Root Cause:**
The chart was calculating data from only 500 posts (API fetch limit), not the entire database.

```typescript
// OLD: Limited to 500 posts
const postsRes = await apiFetch('/api/posts?limit=500');
const activityData = generateActivityData(recentPosts, recentLogs); // Only 500 posts!
```

**Solution:**
Created dedicated API endpoint that queries database directly:

```typescript
// NEW: Query database for accurate totals
router.get('/api/stats/activity', async (req, res) => {
  const posts = await prisma.postRaw.findMany({
    where: { scrapedAt: { gte: startDate } },
    select: { scrapedAt: true, classified: { select: { classifiedAt: true } } }
  });
  // Aggregate by day...
});
```

**Result:** Chart now shows accurate daily totals from database.

**Files Modified:** `src/routes/stats.ts`, `ui/dashboard/pages/index.tsx`

---

### Summary of Technical Decisions

| Challenge | Initial Approach | Final Solution |
|-----------|------------------|----------------|
| Rate limiting | Reduce polling interval | Cache-only reads, batch fetches |
| Photo extraction | Look for `<img>` tags | Handle SVG `<image href="">`, position matching |
| Memory monitoring | Heap percentage | RSS total with high threshold |
| Classification visibility | Console logs | Full diagnostic system with UI |
| Apify failures | Retry with circuit breaker | Cache working method, skip known failures |
| Real-time updates | WebSocket | SSE (simpler for one-way streaming) |
| Post URLs missing | Search for `/posts/` links | Extract from `set=pcb.` in photo URLs |
| Chart wrong data | Calculate from fetched posts | New API endpoint queries database directly |

---

**Built with ❤️ for preserving historical stories**