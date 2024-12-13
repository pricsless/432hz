FROM node:18-slim

# Install FFmpeg with additional codecs
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libmp3lame0 \
    libavcodec-extra \
    curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create temp directory and set permissions
RUN mkdir -p /app/temp && \
    chmod 777 /app/temp

# Environment variables
ENV NODE_ENV=production
ENV TEMP_DIR=/app/temp
ENV PORT=8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

# Start the bot
CMD ["npm", "start"]