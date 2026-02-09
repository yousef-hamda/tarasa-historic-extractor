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

# Install dependencies (postinstall runs prisma generate)
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Builder
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/ui/dashboard/node_modules ./ui/dashboard/node_modules

# Copy source code
COPY . .

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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

# Start command
CMD ["node", "--max-old-space-size=1024", "dist/server.js"]
