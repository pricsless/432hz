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
    // Use 'ffmpeg' directly as it will be in PATH for deployed environment
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
      const { stdout, stderr } = await execAsync(command);
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
      const outputPath = path.join(
        this.tempDir,
        `${originalMetadata.title || basename}_432hz${ext}`
      );

      // Build metadata arguments for FFmpeg
      const metadataArgs = this.buildMetadataArgs(originalMetadata);

      console.log("\nAttempting direct conversion...");
      // Remove quotes around FFmpeg path
      const directCommand =
        `${this.ffmpegPath} -i "${inputPath}" ` +
        `-af "asetrate=44100*0.981818,aresample=44100" ` +
        `-c:a libmp3lame -b:a 320k ` +
        `-map 0:a ${metadataArgs} ` +
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

        const toMp3Command =
          `${this.ffmpegPath} -i "${inputPath}" ` +
          `-af "asetrate=44100*0.981818,aresample=44100" ` +
          `-c:a libmp3lame -b:a 320k -ar 44100 ` +
          `${metadataArgs} "${outputPath}"`;

        await this.execWithLogging(toMp3Command, "MP3 Conversion");

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

    // Map common metadata fields
    const metadataMap = {
      title: "title",
      artist: "artist",
      album: "album",
      year: "date",
      track: "track",
      genre: "genre",
      composer: "composer",
      copyright: "copyright",
      description: "description",
    };

    // Build FFmpeg metadata arguments
    for (const [key, ffmpegKey] of Object.entries(metadataMap)) {
      if (metadata[key]) {
        args.push(`-metadata ${ffmpegKey}="${metadata[key]}"`);
      }
    }

    // If there's a title, append 432Hz to it
    if (metadata.title) {
      args.push(`-metadata title="${metadata.title} (432Hz)"`);
    }

    // Keep all other metadata
    args.push("-map_metadata 0");

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
