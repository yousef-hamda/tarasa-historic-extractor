# Deployment Guide

## ⚠️ Important: This is NOT a Cloudflare Workers Application

This is a **full-stack Node.js Express application** that requires:
- Long-running server process (Express)
- PostgreSQL database (Prisma ORM)
- Redis for caching and job queues
- Scheduled cron jobs
- Playwright browser automation
- File system access

**It CANNOT be deployed to:**
- ❌ Cloudflare Workers
- ❌ Cloudflare Pages
- ❌ Netlify (serverless only)
- ❌ Vercel (serverless only)

## ✅ Recommended Deployment Platforms

### Option 1: Render (Easiest)

1. Create account at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: tarasa-historic-extractor
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Node Version**: 20 or higher

5. Add Services:
   - Add PostgreSQL database (automatically sets `DATABASE_URL`)
   - Add Redis instance (set `REDIS_URL`)

6. Environment Variables (Settings → Environment):
   ```
   PORT=3000
   NODE_ENV=production
   OPENAI_API_KEY=your_key
   API_KEY=your_api_key
   GROUP_IDS=comma,separated,group,ids
   POSTGRES_URL=<from Render PostgreSQL>
   DATABASE_URL=<from Render PostgreSQL>
   REDIS_URL=<from Render Redis>
   ```

7. Deploy!

**Cost**: Free tier available with limitations, Pro plan ~$7/month

---

### Option 2: Railway

1. Create account at [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add PostgreSQL plugin (automatically connects)
5. Add Redis plugin (automatically connects)
6. Set environment variables
7. Deploy automatically on push

**Cost**: Pay-as-you-go, ~$5-10/month for small usage

---

### Option 3: Docker (Any Platform)

Use the included `docker-compose.yml`:

```bash
# Set environment variables
cp .env.example .env
# Edit .env with your values

# Start services
docker-compose up -d

# View logs
docker-compose logs -f app
```

Deploy to:
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances
- DigitalOcean App Platform
- Your own VPS

---

### Option 4: Heroku (Classic)

```bash
# Install Heroku CLI
heroku login

# Create app
heroku create tarasa-historic-extractor

# Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# Add Redis
heroku addons:create heroku-redis:mini

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set OPENAI_API_KEY=your_key
heroku config:set API_KEY=your_api_key

# Deploy
git push heroku main

# Run migrations
heroku run npm run prisma:migrate
```

**Cost**: $5-7/month minimum (no free tier since 2022)

---

## Build Process

The build process is already configured:

1. **Install**: `npm ci` (installs dependencies)
2. **Postinstall**: `prisma generate` (generates Prisma client)
3. **Build**: `npm run build` (compiles TypeScript → `dist/`)
4. **Start**: `npm start` (runs `dist/server.js`)

---

## Environment Variables Required

```bash
# Core
PORT=3000
NODE_ENV=production

# Authentication
API_KEY=your_secure_api_key_here

# Database
POSTGRES_URL=postgresql://user:password@host:5432/database
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis
REDIS_URL=redis://host:6379

# OpenAI
OPENAI_API_KEY=sk-your-openai-key

# Facebook Groups
GROUP_IDS=group1,group2,group3

# Optional
SENTRY_DSN=your_sentry_dsn
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

---

## Post-Deployment Steps

1. **Run database migrations**:
   ```bash
   npm run prisma:migrate
   ```

2. **Test the API**:
   ```bash
   curl https://your-app.com/api/health
   ```

3. **Set up cron jobs** (if your platform doesn't support them):
   - Use external cron service (cron-job.org, EasyCron)
   - Hit your cron endpoints on schedule

4. **Monitor logs** for any startup issues

---

## Troubleshooting

### "Cannot find Prisma Client"
Run: `npm run prisma:generate`

### "Database connection failed"
Check your `DATABASE_URL` and `POSTGRES_URL` environment variables

### "Redis connection failed"
Check your `REDIS_URL` environment variable

### "Port already in use"
Change the `PORT` environment variable

---

## Scaling Considerations

- **Horizontal scaling**: Use multiple instances behind a load balancer
- **Database**: Use connection pooling (already configured)
- **Redis**: Use Redis Cluster for high availability
- **File uploads**: Use S3/Cloud Storage instead of local filesystem
- **Browser automation**: Consider dedicated Playwright service

---

## Current Deployment Platform Issue

If you're seeing this message:
```
✘ [ERROR] Missing entry-point to Worker script or to assets directory
```

**Your platform is misconfigured.** You're trying to deploy to Cloudflare Workers/Pages, which doesn't support this application architecture.

**Solution**: Change your deployment platform to one of the recommended options above.
