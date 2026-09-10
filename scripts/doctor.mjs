import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { readEnv } from "./env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const ci = process.argv.includes("--ci");
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

const [major, minor] = process.versions.node.split(".").map(Number);
add("Node.js", major > 22 || (major === 22 && minor >= 13), `v${process.versions.node}`);

const env = await readEnv(path.join(root, ".env"));
if (!ci) {
  const demo = env.DEMO_MODE === "true";
  add(
    "Configuration",
    demo || Boolean(env.OPENROUTER_API_KEY),
    demo ? "no-charge demo" : env.OPENROUTER_API_KEY ? "key configured" : "no key",
  );
}

try {
  await access(ffmpegPath, constants.X_OK);
  add("FFmpeg", true, "bundled");
} catch {
  add("FFmpeg", false, "executable not found");
}

try {
  await import("exiftool-vendored");
  add("ExifTool", true, "bundled");
} catch {
  add("ExifTool", false, "package could not be loaded");
}

try {
  const dataRoot = path.resolve(root, env.DATA_DIR || "data");
  await mkdir(dataRoot, { recursive: true });
  const probe = path.join(dataRoot, ".write-test");
  await writeFile(probe, "ok");
  await rm(probe);
  add("Local data", true, dataRoot);
} catch (error) {
  add("Local data", false, error.message);
}

try {
  await access(path.join(root, "dist", "index.html"));
  add("Interface", true, "built");
} catch {
  add("Interface", ci, ci ? "build is validated separately" : "run npm run build");
}

for (const check of checks)
  console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
if (checks.some((check) => !check.ok)) process.exitCode = 1;
