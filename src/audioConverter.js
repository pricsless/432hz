const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const config = require("./config");

class AudioConverter {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.ensureTempDir();
    this.ffmpegPath = "ffmpeg";
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async execWithLogging(command, step) {
    console.log(`\n[${step}] Executing command:`, command);
    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 50 * 1024 * 1024,
      }); // 50MB buffer
      if (stdout) console.log(`[${step}] stdout:`, stdout);
      if (stderr) console.log(`[${step}] stderr:`, stderr);
      return { stdout, stderr };
    } catch (error) {
      console.error(`[${step}] Error:`, error.message);
      if (error.stdout) console.error(`[${step}] Error stdout:`, error.stdout);
      if (error.stderr) console.error(`[${step}] Error stderr:`, error.stderr);
      throw error;
    }
  }

  async convertTo432Hz(inputPath, originalMetadata = {}) {
    try {
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }
      console.log("Input file exists and is readable");

      const ext = path.extname(inputPath);
      const basename = path.basename(inputPath, ext);
      const timestamp = Date.now();

      // Use timestamp in filename if no title available
      const outputPath = path.join(
        this.tempDir,
        `${originalMetadata.title || `audio_${timestamp}`}_432hz${ext}`
      );

      // Build metadata arguments for FFmpeg
      const metadataArgs = this.buildMetadataArgs(originalMetadata);

      console.log("\nAttempting direct conversion...");
      // Command that preserves cover art and handles missing metadata
      const directCommand =
        `${this.ffmpegPath} -i "${inputPath}" ` +
        `-af "asetrate=44100*0.981818,aresample=44100" ` +
        `-c:a libmp3lame -b:a 320k ` +
        `-c:v copy ` + // Copy video stream (cover art)
        `-id3v2_version 3 ` + // Ensure ID3v2 tag compatibility
        `-map 0:a ` + // Map audio stream
        `-map 0:v? ` + // Map video stream (cover art) if it exists
        `-map_metadata 0 ` + // Copy existing metadata
        `${metadataArgs} ` +
        `"${outputPath}"`;

      try {
        await this.execWithLogging(directCommand, "Direct Conversion");
        console.log("Conversion successful!");
        return {
          path: outputPath,
          filename: path.basename(outputPath),
        };
      } catch (directError) {
        console.log("Direct conversion failed, trying alternative method...");

        // Alternative method with different audio filter chain
        const toMp3Command =
          `${this.ffmpegPath} -i "${inputPath}" ` +
          `-af "asetrate=44100*0.981818,aresample=44100:filter_type=kaiser" ` +
          `-c:a libmp3lame -b:a 320k ` +
          `-c:v copy ` + // Still try to preserve cover art
          `-map 0:a ` +
          `-map 0:v? ` +
          `-id3v2_version 3 ` +
          `${metadataArgs} ` +
          `"${outputPath}"`;

        await this.execWithLogging(toMp3Command, "Alternative Conversion");
        return {
          path: outputPath,
          filename: path.basename(outputPath),
        };
      }
    } catch (error) {
      console.error("Final conversion error:", error);
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  buildMetadataArgs(metadata) {
    const args = [];

    // Map common metadata fields with fallbacks
    const metadataMap = {
      title: metadata.title || `Audio_${Date.now()}`,
      artist: metadata.artist || "Unknown Artist",
      album: metadata.album || "Unknown Album",
    };

    // Add basic metadata
    Object.entries(metadataMap).forEach(([key, value]) => {
      const safeValue = value.replace(/"/g, '\\"'); // Escape quotes
      args.push(`-metadata ${key}="${safeValue}"`);
    });

    // Add additional metadata if available
    if (metadata.year) args.push(`-metadata date="${metadata.year}"`);
    if (metadata.track) args.push(`-metadata track="${metadata.track}"`);
    if (metadata.genre) args.push(`-metadata genre="${metadata.genre}"`);
    if (metadata.composer)
      args.push(`-metadata composer="${metadata.composer}"`);
    if (metadata.copyright)
      args.push(`-metadata copyright="${metadata.copyright}"`);
    if (metadata.description)
      args.push(`-metadata description="${metadata.description}"`);

    // Always append 432Hz to title
    args.push(
      `-metadata title="${metadata.title || `Audio_${Date.now()}`} (432Hz)"`
    );

    return args.join(" ");
  }

  cleanup(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Cleanup failed for ${filePath}:`, error);
    }
  }
}

module.exports = AudioConverter;
