FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 4000

CMD ["npm", "run", "dev"]
