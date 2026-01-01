# Tarasa Historic Story Extractor

An intelligent, fully automated system that discovers historical stories on Facebook, analyzes them using AI, and reaches out to authors via Messenger to preserve their stories on the Tarasa platform.

## 📖 Overview

This project automates the entire workflow of:
1. **Scraping** Facebook groups for posts containing historical content
2. **Classifying** posts using AI (OpenAI GPT) to identify historic stories
3. **Generating** personalized English messages for post authors
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
├── src/
│   ├── ai/
│   │   ├── classifier.ts          # AI-powered post classification
│   │   └── generator.ts           # English message generation
│   ├── config/
│   │   ├── cookies.json           # Facebook session cookies (auto-generated)
│   │   └── playwright.config.ts   # Browser automation settings
│   ├── cron/
│   │   ├── scrape-cron.ts        # Scheduled scraping (every 10 min)
│   │   ├── classify-cron.ts      # Scheduled classification (every 3 min)
│   │   ├── message-cron.ts       # Scheduled messaging (every 5 min)
│   │   ├── login-refresh.ts      # Daily session refresh
│   │   └── index.ts              # Cron job registration
│   ├── database/
│   │   ├── schema.prisma         # Database schema
│   │   ├── prisma.ts             # Prisma client instance
│   │   └── migrations/           # Database migrations
│   ├── facebook/
│   │   └── session.ts            # Facebook login & session management
│   ├── messenger/
│   │   └── messenger.ts          # Messenger bot for sending messages
│   ├── routes/
│   │   ├── posts.ts              # Posts API endpoints
│   │   ├── messages.ts           # Messages API endpoints
│   │   ├── logs.ts               # System logs endpoint
│   │   └── health.ts             # Health check endpoint
│   ├── scraper/
│   │   ├── scraper.ts            # Facebook group scraper
│   │   └── extractors.ts         # Post data extraction logic
│   ├── utils/
│   │   ├── logger.ts             # Winston logger configuration
│   │   ├── delays.ts             # Human-like delay utilities
│   │   ├── selectors.ts          # Facebook DOM selectors
│   │   ├── alerts.ts             # Email alert system
│   │   ├── systemLog.ts          # Database logging utilities
│   │   └── openaiRetry.ts        # OpenAI API retry logic
│   └── server.ts                 # Express server entry point
├── ui/
│   └── dashboard/
│       ├── components/
│       │   ├── Card.tsx          # Statistics card component
│       │   ├── Table.tsx         # Reusable table component
│       │   └── Layout.tsx        # Navigation layout wrapper
│       ├── pages/
│       │   ├── _app.tsx          # Next.js app wrapper
│       │   ├── index.tsx         # Dashboard home page
│       │   ├── posts.tsx         # Posts management page
│       │   ├── messages.tsx      # Messages queue & history
│       │   ├── logs.tsx          # System logs viewer
│       │   └── settings.tsx      # Configuration page
│       ├── styles/
│       │   └── globals.css       # Global styles with Tailwind
│       ├── next.config.mjs       # Next.js configuration
│       ├── tailwind.config.js    # Tailwind CSS configuration
│       ├── postcss.config.js     # PostCSS configuration
│       └── package.json          # Dashboard dependencies
├── .env                          # Environment variables (create from .env.example)
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore rules
├── package.json                  # Root project dependencies
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # This file
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

---

## 🔄 How It Works

### 1. Scraping Process (Every 10 Minutes)

The scraper automatically:
1. Logs into Facebook using saved cookies (or credentials if first time)
2. Navigates to each configured group
3. Scrolls to load posts
4. Extracts post data:
   - Post text content
   - Author name
   - Author profile link
   - Generated unique ID (based on content hash)
5. Saves posts to database (avoiding duplicates)
6. Updates session cookies

**Selectors Used:**
- Post containers: `div[role="article"]`
- Post text: `div[data-ad-comet-preview]`, `div[dir="auto"]`
- Author name: `strong a`
- Author link: `strong a[href*="facebook.com"]`

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

For valid historic posts:
1. Generates personalized English message using OpenAI
2. Creates pre-filled Tarasa submission link with post data
3. Stores message in queue (`MessageGenerated` table)
4. Ensures message is unique and natural (not AI-sounding)

**Message Structure:**
- Compliment to the author
- Explanation of Tarasa's mission
- Encouragement to submit story
- Pre-filled link for easy submission

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

## 📊 Database Schema

### PostRaw
Stores scraped Facebook posts:
```prisma
model PostRaw {
  id          Int       @id @default(autoincrement())
  groupId     String    // Facebook group URL
  fbPostId    String    @unique // Generated from content hash
  authorName  String?   // Author's display name
  authorLink  String?   // Link to author's profile
  text        String    // Post content
  scrapedAt   DateTime  @default(now())
  classified  PostClassified? // One-to-one relationship
}
```

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
View configuration:
- Configured Facebook groups
- Daily message limit
- System status

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

## 📝 Configuration Reference

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
- **Process Manager:** PM2 (for keeping server alive)

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

- [ ] Environment variables configured
- [ ] Database backups enabled
- [ ] Monitoring/alerting set up
- [ ] SSL certificates installed
- [ ] Rate limiting configured
- [ ] Log rotation enabled
- [ ] Cron jobs running
- [ ] Health checks responding

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

### v1.0.0 (Current)
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

**Built with ❤️ for preserving historical stories**