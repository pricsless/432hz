const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const https = require("https");
const config = require("./config");
const AudioConverter = require("./audioConverter");

// Fix deprecation warning
process.env.NTBA_FIX_350 = 1;

// Shutdown and error tracking flags
let isShuttingDown = false;
let pollingErrorCount = 0;
const MAX_POLLING_ERRORS = 3;
const POLLING_ERROR_RESET_TIME = 60000; // 1 minute
let pollingErrorTimeout;

// Constants
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB in bytes
const SUPPORTED_FORMATS = [".mp3", ".m4a", ".wav", ".ogg"];

// Create temp directory for file processing
const converter = new AudioConverter(config.tempDir);

// Create bot instance with improved options
const bot = new TelegramBot(config.telegramToken, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
  filepath: false,
  request: {
    timeout: 60000,
  },
  baseApiUrl: "https://api.telegram.org",
});

// Keep server alive function
// Keep server alive function
// function keepServerAlive() {
//   setInterval(() => {
//     https
//       .get("https://four32hz.onrender.com/health", (resp) => {
//         if (resp.statusCode === 200) {
//           console.log("Server pinged successfully");
//         }
//       })
//       .on("error", (err) => {
//         console.error("Ping error:", err);
//       });
//   }, PING_INTERVAL);
// }

// function keepServerAlive() {
//   setInterval(() => {
//     https
//       .get(`${process.env.RAILWAY_STATIC_URL}/health`, (resp) => {
//         if (resp.statusCode === 200) {
//           console.log("Server pinged successfully");
//         }
//       })
//       .on("error", (err) => {
//         console.error("Ping error:", err);
//       });
//   }, PING_INTERVAL);
// }

// Start keeping server alive
// keepServerAlive();

// Error reset function
function resetPollingErrors() {
  pollingErrorCount = 0;
  if (pollingErrorTimeout) {
    clearTimeout(pollingErrorTimeout);
    pollingErrorTimeout = null;
  }
}

// Graceful shutdown handler
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Initiating graceful shutdown...");
  try {
    console.log("Stopping bot polling...");
    await bot.stopPolling();
    console.log("Bot polling stopped");

    // Wait a bit to ensure all processes are complete
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Clean up temp directory
    if (fs.existsSync(config.tempDir)) {
      const files = fs.readdirSync(config.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(config.tempDir, file));
      }
    }

    console.log("Shutdown complete");
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

// Health check endpoint
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

    // Check file size (20MB limit)
    if (msg.audio.file_size > MAX_FILE_SIZE) {
      await bot.sendMessage(
        chatId,
        `❌ File too large (${(msg.audio.file_size / 1024 / 1024).toFixed(
          1
        )}MB). Maximum size is 20MB for seamless processing.`
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

    // Extract metadata with fallbacks
    const metadata = {
      title:
        msg.audio.title ||
        path.basename(
          msg.audio.file_name,
          path.extname(msg.audio.file_name || "")
        ),
      artist: msg.audio.performer || "Unknown Artist",
      album: msg.audio.album || "Unknown Album",
      duration: msg.audio.duration,
    };

    // Download file
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

    // Convert to 432 Hz
    const result = await converter.convertTo432Hz(inputPath, metadata);

    // Update status before upload
    await bot.editMessageText("📤 Almost done! Uploading converted file...", {
      chat_id: chatId,
      message_id: statusMessage.message_id,
    });

    // Send converted file
    await bot.sendAudio(chatId, fs.createReadStream(result.path), {
      caption: "🎼 Here's your audio converted to 432 Hz frequency",
      parse_mode: "HTML",
      title: metadata.title
        ? `${metadata.title} (432Hz)`
        : `Audio_${Date.now()}_432hz`,
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
      "📦 Maximum file size: 20MB\n\n" +
      "🎵 Simply send me an audio file and I'll do the magic!"
  );
});

// Error handling for bot polling
bot.on("polling_error", async (error) => {
  console.error("Polling error:", error.message || error);

  if (error.code === "ETELEGRAM" && error.response?.statusCode === 409) {
    console.log("Detected duplicate instance, initiating graceful shutdown...");
    await gracefulShutdown();
    return;
  }

  pollingErrorCount++;
  console.log(`Polling error count: ${pollingErrorCount}`);

  if (pollingErrorCount >= MAX_POLLING_ERRORS) {
    console.log("Maximum polling errors reached, restarting polling...");
    try {
      await bot.stopPolling();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await bot.startPolling();
      resetPollingErrors();
    } catch (e) {
      console.error("Error during polling restart:", e);
      await gracefulShutdown();
    }
  } else {
    if (!pollingErrorTimeout) {
      pollingErrorTimeout = setTimeout(
        resetPollingErrors,
        POLLING_ERROR_RESET_TIME
      );
    }
  }
});

console.log("Bot is running...");
