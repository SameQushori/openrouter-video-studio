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
    "Конфигурация",
    demo || Boolean(env.OPENROUTER_API_KEY),
    demo ? "demo без списаний" : env.OPENROUTER_API_KEY ? "ключ задан" : "нет ключа",
  );
}

try {
  await access(ffmpegPath, constants.X_OK);
  add("FFmpeg", true, "встроен");
} catch {
  add("FFmpeg", false, "исполняемый файл не найден");
}

try {
  await import("exiftool-vendored");
  add("ExifTool", true, "встроен");
} catch {
  add("ExifTool", false, "пакет не загружается");
}

try {
  const dataRoot = path.resolve(root, env.DATA_DIR || "data");
  await mkdir(dataRoot, { recursive: true });
  const probe = path.join(dataRoot, ".write-test");
  await writeFile(probe, "ok");
  await rm(probe);
  add("Локальные данные", true, dataRoot);
} catch (error) {
  add("Локальные данные", false, error.message);
}

try {
  await access(path.join(root, "dist", "index.html"));
  add("Интерфейс", true, "собран");
} catch {
  add("Интерфейс", ci, ci ? "сборка проверяется отдельно" : "выполните npm run build");
}

for (const check of checks)
  console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
if (checks.some((check) => !check.ok)) process.exitCode = 1;
