const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const https = require("https");
const config = require("./config");
const AudioConverter = require("./audioConverter");

// Fix deprecation warning
process.env.NTBA_FIX_350 = 1;

// Shutdown flag
let isShuttingDown = false;

// Constants
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
const SUPPORTED_FORMATS = [".mp3", ".m4a", ".wav", ".ogg"];

// Create temp directory for file processing
const converter = new AudioConverter(config.tempDir);

// Create bot instance with improved options
const bot = new TelegramBot(config.telegramToken, {
  polling: true,
  filepath: false,
  request: {
    timeout: 60000,
  },
});

// Graceful shutdown handler
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Shutting down gracefully...");
  try {
    await bot.stopPolling();
    console.log("Bot polling stopped");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Process termination handlers
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown();
});

// Download file from Telegram with progress tracking
async function downloadFile(
  fileUrl,
  destinationPath,
  totalSize,
  statusMessage,
  chatId
) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);
    let downloadedSize = 0;
    let lastProgressUpdate = Date.now();

    https
      .get(fileUrl, (response) => {
        response.pipe(file);

        response.on("data", (chunk) => {
          downloadedSize += chunk.length;

          // Update progress every 2 seconds
          const now = Date.now();
          if (now - lastProgressUpdate > 2000) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            bot
              .editMessageText(
                `⬇️ Downloading: ${progress}% complete...\n(${(
                  downloadedSize /
                  1024 /
                  1024
                ).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
                {
                  chat_id: chatId,
                  message_id: statusMessage.message_id,
                }
              )
              .catch(console.error);
            lastProgressUpdate = now;
          }
        });

        file.on("finish", () => {
          file.close();
          console.log("File downloaded successfully");
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(destinationPath, () => {}); // Delete partial file
        console.error("Download error:", err);
        reject(err);
      });
  });
}

// Add health check endpoint
const http = require("http");
http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("OK");
    }
  })
  .listen(process.env.PORT || 8080);

// Handle incoming audio files
bot.on("audio", async (msg) => {
  const chatId = msg.chat.id;

  try {
    if (isShuttingDown) {
      await bot.sendMessage(
        chatId,
        "❌ Bot is currently shutting down. Please try again in a few moments."
      );
      return;
    }

    // Check file size
    if (msg.audio.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(
        chatId,
        `❌ File too large (${(msg.audio.file_size / 1024 / 1024).toFixed(
          1
        )}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      );
      return;
    }

    // Check file format
    const fileExt = path.extname(msg.audio.file_name || "").toLowerCase();
    if (!SUPPORTED_FORMATS.includes(fileExt)) {
      await bot.sendMessage(
        chatId,
        `❌ Unsupported file format. Supported formats: ${SUPPORTED_FORMATS.join(
          ", "
        )}`
      );
      return;
    }

    // Send initial status
    const statusMessage = await bot.sendMessage(
      chatId,
      "🎵 Starting the conversion process..."
    );

    // Get file information
    const file = await bot.getFile(msg.audio.file_id);
    const inputPath = path.join(
      config.tempDir,
      `input_${Date.now()}${path.extname(msg.audio.file_name || ".mp3")}`
    );

    // Extract metadata from the message
    const metadata = {
      title: msg.audio.title,
      artist: msg.audio.performer,
      album: msg.audio.album,
      duration: msg.audio.duration,
    };

    // Download file with progress tracking
    await downloadFile(
      `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`,
      inputPath,
      msg.audio.file_size,
      statusMessage,
      chatId
    );

    // Update status before conversion
    await bot.editMessageText("🔄 Converting to 432 Hz...", {
      chat_id: chatId,
      message_id: statusMessage.message_id,
    });

    // Convert to 432 Hz with metadata
    const result = await converter.convertTo432Hz(inputPath, metadata);

    // Update status before upload
    await bot.editMessageText("📤 Almost done! Uploading converted file...", {
      chat_id: chatId,
      message_id: statusMessage.message_id,
    });

    // Send converted file with metadata
    await bot.sendAudio(chatId, fs.createReadStream(result.path), {
      caption: "🎼 Here's your audio converted to 432 Hz frequency",
      parse_mode: "HTML",
      title: metadata.title
        ? `${metadata.title} (432Hz)`
        : path.basename(result.filename),
      performer: metadata.artist,
      album: metadata.album,
      duration: metadata.duration,
    });

    // Final status update
    await bot.editMessageText("✅ Conversion complete!", {
      chat_id: chatId,
      message_id: statusMessage.message_id,
    });

    // Cleanup
    converter.cleanup(inputPath);
    converter.cleanup(result.path);
  } catch (error) {
    console.error("Error processing audio:", error);

    // Send appropriate error message based on error type
    let errorMessage =
      "❌ Sorry, there was an error processing your audio file.";

    if (error.code === "ENOENT") {
      errorMessage =
        "❌ File processing error: The file was not found or accessible.";
    } else if (error.message.includes("format")) {
      errorMessage =
        "❌ File format error: The file format is not supported or is corrupted.";
    } else if (error.message.includes("space")) {
      errorMessage = "❌ Storage error: Not enough space to process the file.";
    } else if (error.message.includes("ffmpeg")) {
      errorMessage =
        "❌ Conversion error: There was a problem converting the audio.";
    }

    await bot.sendMessage(
      chatId,
      `${errorMessage}\n\nPlease try again with a different file.`
    );
  }
});

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    "👋 Welcome to the 432 Hz Converter Bot!\n\n" +
      "I can convert your audio files to 432 Hz frequency.\n\n" +
      "📝 Supported formats: " +
      SUPPORTED_FORMATS.join(", ") +
      "\n" +
      "📦 Maximum file size: " +
      MAX_FILE_SIZE / 1024 / 1024 +
      "MB\n\n" +
      "🎵 Simply send me an audio file and I'll do the magic!"
  );
});

// Error handling for bot polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
  if (
    error.code === "ETELEGRAM" &&
    error.response &&
    error.response.statusCode === 409
  ) {
    console.log("Detected duplicate instance, shutting down...");
    gracefulShutdown();
  }
});

console.log("Bot is running...");
