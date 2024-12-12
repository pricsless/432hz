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

# Start the bot
CMD ["npm", "start"]