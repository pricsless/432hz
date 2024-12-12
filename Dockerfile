FROM node:18-slim

# Install FFmpeg and curl for health checks
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

# Expose port
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the bot
CMD ["npm", "start"]