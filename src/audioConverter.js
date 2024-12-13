const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class AudioConverter {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.ensureTempDir();
    this.ffmpegPath = "ffmpeg"; // Ensure ffmpeg is in the system PATH
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

  buildMetadataArgs(metadata) {
    const args = [];
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

    for (const [key, ffmpegKey] of Object.entries(metadataMap)) {
      if (metadata[key]) {
        const sanitizedValue = metadata[key].replace(/"/g, "'"); // Replace double quotes with single quotes
        args.push(`-metadata ${ffmpegKey}="${sanitizedValue}"`);
      }
    }

    // Append "(432Hz)" to the title if it exists
    if (metadata.title) {
      const sanitizedTitle = metadata.title.replace(/"/g, "'");
      args.push(`-metadata title="${sanitizedTitle} (432Hz)"`);
    }

    args.push("-map_metadata 0"); // Copy all metadata from the input
    return args.join(" ");
  }

  async validateFile(inputPath) {
    try {
      await this.execWithLogging(
        `${this.ffmpegPath} -i "${inputPath}" -f null -`,
        "File Validation"
      );
      return true;
    } catch (error) {
      console.error("File validation failed:", error.message);
      return false;
    }
  }

  async convertTo432Hz(inputPath, metadata = {}) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const outputPath = path.join(this.tempDir, `${basename}_432hz${ext}`);

    // Fallback metadata
    const defaultMetadata = {
      title: "Unknown Title",
      artist: "Unknown Artist",
      album: "Unknown Album",
      year: new Date().getFullYear().toString(),
    };
    const finalMetadata = { ...defaultMetadata, ...metadata };

    if (!(await this.validateFile(inputPath))) {
      throw new Error("Invalid input file.");
    }

    const metadataArgs = this.buildMetadataArgs(finalMetadata);

    const command =
      `${this.ffmpegPath} -i "${inputPath}" ` +
      `-af "asetrate=44100*0.981818,aresample=44100" ` +
      `-c:a libmp3lame -b:a 320k ` +
      `${metadataArgs} "${outputPath}"`;

    await this.execWithLogging(command, "Convert to 432Hz");

    console.log("\nConversion completed successfully!");
    console.log(`Output saved as: ${outputPath}`);

    return {
      path: outputPath,
      filename: path.basename(outputPath),
    };
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
