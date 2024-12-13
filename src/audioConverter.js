const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class AudioConverter {
  constructor(tempDir) {
    this.tempDir = tempDir;
    this.ensureTempDir();
    this.ffmpegPath = "ffmpeg"; // Ensure FFmpeg is available in the system PATH
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async execCommand(command, step) {
    console.log(`\n[${step}] Running command: ${command}`);
    try {
      const { stdout, stderr } = await execAsync(command);
      if (stdout) console.log(`[${step}] stdout: ${stdout}`);
      if (stderr) console.log(`[${step}] stderr: ${stderr}`);
      return { stdout, stderr };
    } catch (error) {
      console.error(`[${step}] Error: ${error.message}`);
      throw error;
    }
  }

  async convertTo432Hz(inputPath, metadata = {}) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const outputPath = path.join(this.tempDir, `${basename}_432hz${ext}`);

    // Add default metadata if fields are missing
    const defaultMetadata = {
      title: basename,
      artist: "Unknown Artist",
      album: "Unknown Album",
    };
    const finalMetadata = { ...defaultMetadata, ...metadata };

    // Build FFmpeg metadata arguments
    const metadataArgs = this.buildMetadataArgs(finalMetadata);

    const command =
      `${this.ffmpegPath} -i "${inputPath}" ` +
      `-af "asetrate=44100*0.981818,aresample=44100" ` +
      `-c:a libmp3lame -b:a 320k ` +
      `${metadataArgs} "${outputPath}"`;

    console.log("\nStarting conversion...");
    await this.execCommand(command, "Convert to 432Hz");
    console.log("Conversion completed successfully!");
    console.log(`Output file: ${outputPath}`);

    return {
      path: outputPath,
      filename: path.basename(outputPath),
    };
  }

  buildMetadataArgs(metadata) {
    const args = [];
    for (const [key, value] of Object.entries(metadata)) {
      if (value) {
        const sanitizedValue = value.replace(/"/g, "'"); // Replace quotes to avoid FFmpeg errors
        args.push(`-metadata ${key}="${sanitizedValue}"`);
      }
    }
    args.push("-map_metadata 0"); // Retain original metadata when available
    return args.join(" ");
  }

  cleanup(filePath) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted temporary file: ${filePath}`);
    }
  }
}

module.exports = AudioConverter;
