require("dotenv").config();

const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  tempDir: process.env.TEMP_DIR || "./temp",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
};

if (!config.telegramToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required in .env file");
}

module.exports = config;
