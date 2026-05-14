# ---- Stage 1: Build Frontend ----
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Build the Vite app. Output goes to /app/frontend/dist
RUN npm run build

# ---- Stage 2: Setup Backend ----
FROM node:20-bookworm-slim AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ---- Stage 3: Final Production Image ----
FROM node:20-bookworm-slim

WORKDIR /app/backend

# Copy backend node_modules from backend-builder
COPY --from=backend-builder /app/backend/node_modules ./node_modules

# Copy backend source files
COPY backend/ ./

# Copy built frontend files from frontend-builder into the backend's 'public' directory
COPY --from=frontend-builder /app/frontend/dist ./public

# Create a volume mount point for the SQLite database
RUN mkdir -p /data && chown -R node:node /data /app

# Run as non-root user
USER node

# Expose the API and Web port
EXPOSE 3000

# Set database path to the persistent volume
ENV DB_PATH=/data/movies.sqlite

CMD ["node", "server.js"]
