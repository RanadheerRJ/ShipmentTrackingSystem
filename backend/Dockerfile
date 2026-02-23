FROM node:20-slim

WORKDIR /app

# Install system deps required to build native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential python3 libsqlite3-dev pkg-config ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Use development env during install so devDeps (tsc) are available for build
ENV NODE_ENV=development

# Copy package manifests first to leverage layer caching
COPY package.json package-lock.json* ./

# Install all deps (including dev deps for TypeScript build)
RUN npm install --no-audit --no-fund

# Copy source (we'll run using ts-node-dev for dev runtime inside container)
COPY . .

# Persist database under /data
VOLUME ["/data"]
ENV DATA_DIR=/data

EXPOSE 4000
CMD ["npm", "run", "dev"]
