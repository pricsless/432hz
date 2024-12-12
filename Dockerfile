# Dockerfile
FROM node:18-slim

# Install FFmpeg with additional codecs
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libmp3lame0 \
    libavcodec-extra \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy all files (including package.json and source)
COPY . .

# Install dependencies
RUN npm ci --only=production

# Create temp directory and set permissions
RUN mkdir -p /app/temp && \
    chmod 777 /app/temp

# Set environment variables
ENV NODE_ENV=production \
    TEMP_DIR=/app/temp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PORT=8080

# Expose port
EXPOSE 8080

# Run as non-root user
USER node

# Start the bot
CMD ["npm", "start"]

# render.yaml
services:
  - type: web
    name: telegram-432hz-bot
    env: docker
    region: singapore  # Choose the region closest to your users
    plan: free
    healthCheckPath: /health
    envVars:
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: NODE_ENV
        value: production
    disk:
      name: temp
      mountPath: /app/temp
      sizeGB: 1

