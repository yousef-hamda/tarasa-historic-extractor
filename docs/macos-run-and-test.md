# macOS Run & Test Commands (Terminal-by-Terminal)

Use the following commands on macOS. Each line shows the exact command plus a short description. Run commands in separate terminals where indicated.

## Prerequisites
```
brew install node@20 postgresql@15 git                 # Install Node.js 20, PostgreSQL 15, and Git via Homebrew
brew services start postgresql@15                      # Start PostgreSQL as a background service
psql -d postgres -c "CREATE DATABASE tarasa_db;"       # Create the development database (safe to re-run)
```

## Project Setup (run once)
```
git clone https://github.com/yourusername/tarasa-historic-extractor.git  # Clone the repo
cd tarasa-historic-extractor                                             # Enter the project
cp .env.example .env                                                     # Copy environment template
npm install                                                              # Install root dependencies
cd ui/dashboard && npm install && cd ../..                                # Install dashboard dependencies
npx prisma generate --schema=src/database/schema.prisma                  # Generate Prisma client
npx prisma migrate dev --name init --schema=src/database/schema.prisma   # Apply database migrations
```

## Terminal 1 — API Server (backend with cron jobs)
```
cd tarasa-historic-extractor   # Ensure you are in the project root
npm run dev                    # Start Express API + cron jobs on http://localhost:4000
```

## Terminal 2 — Dashboard (Next.js frontend)
```
cd tarasa-historic-extractor/ui/dashboard  # Go to the dashboard app
npm run dev                                # Start Next.js on http://localhost:3000
```

## Terminal 3 — Health Check & On-Demand Jobs (optional)
```
curl http://localhost:4000/api/health           # Verify API is healthy
curl -X POST http://localhost:4000/api/trigger-scrape        # Manually trigger scraping
curl -X POST http://localhost:4000/api/trigger-classification # Manually trigger classification
curl -X POST http://localhost:4000/api/trigger-message        # Manually trigger message generation/sending
```

## Testing & Builds
```
cd tarasa-historic-extractor   # From anywhere, return to project root
npm run build                  # Type-check and build the backend
cd ui/dashboard && npm run build && cd ../..  # Build the dashboard
```
