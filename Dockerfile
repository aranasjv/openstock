# --- deps: install with the lockfile so builds are reproducible ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at compile time, so they must
# be present during the build. Server-only secrets (COINGECKO_API_KEY, BETTER_AUTH_SECRET,
# MONGODB_URI) are intentionally NOT build args — they are read at runtime.
ARG NEXT_PUBLIC_FINNHUB_API_KEY
ENV NEXT_PUBLIC_FINNHUB_API_KEY=$NEXT_PUBLIC_FINNHUB_API_KEY

RUN npm run build

# --- runner: slim image running the standalone server as a non-root user ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The analysis playbooks the assistant reads at runtime (lib/analysis-skills.ts). Next's
# standalone tracing only follows imported modules, not directories read with fs — without
# this COPY the container has no .agents at all and the assistant silently loses its
# playbooks while working fine in dev.
COPY --from=builder --chown=nextjs:nodejs /app/.agents ./.agents

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
