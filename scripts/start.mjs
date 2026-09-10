import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "./env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const envPath = path.join(root, ".env");
const noBrowser = process.argv.includes("--no-browser");

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(envPath))) {
  const setup = spawnSync(process.execPath, [path.join(root, "scripts/setup.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (setup.status !== 0) process.exit(setup.status || 1);
}
if (!(await exists(path.join(root, "dist", "index.html")))) {
  console.log("Building the interface…");
  const build = spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status || 1);
}

const settings = await readEnv(envPath);
const port = Number(settings.PORT) || 3001;
const url = `http://127.0.0.1:${port}`;

async function ready() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    return response.ok && ["openrouter-video-studio", "personal-video-studio"].includes(body.app);
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noBrowser) return;
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const opener = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
  });
  opener.unref();
}

if (await ready()) {
  console.log(`Video Studio is already running: ${url}`);
  openBrowser();
  process.exit(0);
}

const server = spawn(process.execPath, [path.join(root, "server/index.js")], {
  cwd: root,
  stdio: "inherit",
});
let started = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (await ready()) {
    started = true;
    break;
  }
  if (server.exitCode != null) break;
}
if (!started) {
  server.kill();
  throw new Error("The server did not start. Check the port and configuration with npm run doctor.");
}
console.log(`Opening ${url}`);
openBrowser();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code || 0));
