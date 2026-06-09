FROM node:20-bookworm-slim

WORKDIR /app

# Native build for better-sqlite3; Playwright install-deps uses apt below.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# Install Node deps first; postinstall is skipped until OS libs are present.
ENV SKIP_PLAYWRIGHT_INSTALL=1
RUN npm ci --omit=dev

# Chromium browser + Linux system libraries (libglib, etc.)
RUN npx playwright install-deps chromium && npx playwright install chromium

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
