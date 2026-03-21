# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

# Security: don't run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install deps — use build arg to control dev vs prod
ARG INSTALL_DEV=true
COPY package*.json ./
RUN if [ "$INSTALL_DEV" = "false" ]; then \
      npm ci --omit=dev && npm cache clean --force; \
    else \
      npm ci && npm cache clean --force; \
    fi

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY src/templates/*.json ./dist/templates/
COPY src/db/migrations/*.sql ./dist/db/migrations/
COPY public/ ./public/
COPY scripts/start.sh ./start.sh

# Own files by non-root user
RUN chmod +x start.sh && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["./start.sh"]
