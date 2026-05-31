#!/bin/sh
# Container start script for Tarasa Historic Extractor
# Baked into the Docker image so the Railway UI start-command cannot break it.
set -e

echo "[START] start.sh launched"
echo "[START] running prisma migrate deploy"
npx prisma migrate deploy
echo "[START] migrations complete, exec-ing node server"
exec node --max-old-space-size=1024 dist/server.js
