# Multi-stage Dockerfile for PharmaStock Reference SaaS Module
# Optimized for monorepo root build context on DigitalOcean App Platform

# Stage 1: Build & Compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root manifest and workspace package directories
COPY package.json package-lock.json ./
COPY packages/sdk/ ./packages/sdk/
COPY modules/pharmastock/ ./modules/pharmastock/

# Install monorepo workspace dependencies and compile
RUN npm ci --ignore-scripts
RUN npm run build --workspace=packages/sdk
RUN npm run build --workspace=modules/pharmastock

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Ensure persistent volume mount directory exists and is writable by node user
RUN mkdir -p /data && chown -R node:node /data

# Security: run as non-root node user
USER node

# Copy compiled bundles and runtime node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --chown=node:node --from=builder /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --chown=node:node --from=builder /app/modules/pharmastock/dist ./modules/pharmastock/dist
COPY --chown=node:node --from=builder /app/modules/pharmastock/package.json ./modules/pharmastock/package.json

WORKDIR /app/modules/pharmastock

EXPOSE 3000

# Health check for DigitalOcean App Platform orchestrator
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:' + (process.env.PORT || 3000) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1));"

CMD ["node", "dist/server.js"]
