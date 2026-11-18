# Use Node.js 20 slim
FROM node:20-slim

# App version, set via --build-arg at build time (defaults to DEV for local builds)
ARG APP_VERSION=DEV
ENV APP_VERSION=${APP_VERSION}

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Sync package.json's version with the build-time APP_VERSION for introspection
# (e.g. `docker exec <container> npm pkg get version`); does not affect the repo.
RUN npm pkg set version="${APP_VERSION}"

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
