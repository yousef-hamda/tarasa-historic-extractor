# ===========================================
# Tarasa Historic Extractor - Production Dockerfile
# ===========================================
# Multi-stage build for optimized production image
# Includes Playwright browsers for Facebook scraping

# Stage 1: Dependencies
FROM node:20-slim AS deps

WORKDIR /app

# Install dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and Prisma schema (needed for postinstall)
COPY package*.json ./
COPY prisma ./prisma
COPY ui/dashboard/package*.json ./ui/dashboard/

# Install ALL dependencies (dev deps needed for tsc + next build in builder stage).
# Workspaces share the root node_modules — npm ci handles all workspace packages.
RUN npm ci && npm cache clean --force

# Stage 2: Builder
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependencies from deps stage
# (Workspaces hoist all dashboard deps into the root node_modules,
# so there is no separate ui/dashboard/node_modules to copy.)
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Ensure ui/dashboard/public exists (Next.js doesn't require it, but the
# production stage COPYs it unconditionally — see below).
RUN mkdir -p ui/dashboard/public

# Generate Prisma client (already generated in deps stage, but regenerate to be sure)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Build dashboard
RUN npm run dashboard:build

# Stage 3: Production
FROM node:20-slim AS production

# Set environment
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install runtime dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r tarasa && useradd -r -g tarasa tarasa

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/ui/dashboard/.next ./ui/dashboard/.next
COPY --from=builder /app/ui/dashboard/public ./ui/dashboard/public
COPY --from=builder /app/ui/dashboard/package*.json ./ui/dashboard/

# Copy and prepare the container start script
COPY --from=builder /app/start.sh ./start.sh
RUN chmod +x ./start.sh

# Prune dev dependencies to slim the production image
RUN npm prune --omit=dev

# Install Playwright browsers
RUN npx playwright install chromium && \
    npx playwright install-deps chromium

# Create necessary directories
RUN mkdir -p /app/logs /app/browser-data /app/backups && \
    chown -R tarasa:tarasa /app

# Switch to non-root user
USER tarasa

# Expose ports
EXPOSE 4000 3000

# Health check — uses the runtime $PORT (Railway injects it), falls back to 4000.
# IMPORTANT: probe /api/health/live (pure liveness, always 200 while the process
# is up), NOT /api/health (which returns 503 when the DB is unreachable). Keying
# the healthcheck on the DB would mark the container unhealthy during an external
# Postgres blip and could block deploy promotion → a self-inflicted 502.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4000}/api/health/live" || exit 1

# Start command — runs ./start.sh which migrates then exec-s node.
# Baked into the image so it cannot be misconfigured via Railway's UI start-command field.
CMD ["./start.sh"]
