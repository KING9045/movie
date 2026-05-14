# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source files
COPY . .

# Create a volume mount point for the SQLite database
RUN mkdir -p /data && chown -R node:node /data /app

# Run as non-root user
USER node

# Expose the API port
EXPOSE 3000

# Set database path to the persistent volume
ENV DB_PATH=/data/movies.sqlite

CMD ["node", "server.js"]
