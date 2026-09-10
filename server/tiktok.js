import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function tiktokUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bad("Paste a TikTok video URL.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(host === "tiktok.com" || host.endsWith(".tiktok.com"))
  )
    throw bad("Only public TikTok HTTPS URLs are allowed.");
  return url.href;
}

export function createTikTokDownloader({
  binary = path.resolve("tools/yt-dlp.exe"),
  run = runProcess,
  ffmpeg = ffmpegPath,
  normalize = normalizeH264,
} = {}) {
  return async function download(value) {
    const url = tiktokUrl(value);
    const dir = await mkdtemp(path.join(os.tmpdir(), "video-studio-tiktok-"));
    const output = path.join(dir, "video.%(ext)s");
    try {
      await run(binary, [
        "--no-playlist",
        "--max-filesize",
        "25M",
        "--no-progress",
        "--no-warnings",
        "--no-part",
        "--format-sort",
        "+codec:h264",
        "--format",
        "best[ext=mp4]/best",
        "--output",
        output,
        url,
      ]);
      const file = (await readdir(dir)).find((name) => name.endsWith(".mp4"));
      if (!file)
        throw bad(
          "TikTok did not return an MP4. The video may be private, deleted, or region-restricted.",
        );
      const source = path.join(dir, file);
      const normalized = path.join(dir, "normalized.mp4");
      await normalize(ffmpeg, source, normalized);
      const buffer = await readFile(normalized);
      if (buffer.length > 25 * 1024 * 1024)
        throw bad("The video is larger than 25 MB. Choose a shorter clip.");
      return { buffer, name: "tiktok-video.mp4", sourceUrl: url };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

export async function normalizeH264(binary, input, output) {
  if (!binary)
    throw bad("The video converter is not installed. Run npm install.", 503);
  await runProcess(binary, [
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "0",
    output,
  ]);
}

function runProcess(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? bad("The TikTok downloader is not installed. Run setup-tiktok.ps1.", 503)
          : error,
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const detail = stderr
        .split(/\r?\n/)
        .find((line) => line.startsWith("ERROR:"));
      reject(
        bad(
          signal
            ? "TikTok did not respond within two minutes. Try again later."
            : detail?.replace(/^ERROR:\s*/, "") ||
                "Could not download the TikTok video. Make sure it is public.",
          code === 127 ? 503 : 400,
        ),
      );
    });
  });
}

export function installTikTok(app, { assets, downloader }) {
  app.post("/api/tiktok/import", async (req, res) => {
    const result = await downloader(req.body.url);
    const asset = await assets.saveVideo(result.buffer, result.name, {
      source: "tiktok",
    });
    res.status(201).json(asset);
  });
  app.get("/api/tiktok/assets/:id/download", async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) throw bad("File not found.");
    const metadataPath = path.join(assets.root, `${req.params.id}.json`);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch {
      throw bad("File not found.", 404);
    }
    if (metadata.source !== "tiktok" || metadata.file !== `${req.params.id}.mp4`)
      throw bad("File not found.", 404);
    res.download(path.join(assets.root, metadata.file), "tiktok-video.mp4");
  });
}
