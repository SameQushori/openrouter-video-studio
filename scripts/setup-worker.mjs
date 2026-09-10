import { randomBytes } from "node:crypto";
import { writeFile, access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateEnv } from "./env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerDir = path.join(root, "media-worker");
const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";

async function ensureEnv() {
  try {
    await access(path.join(root, ".env"), constants.F_OK);
  } catch {
    throw new Error("Run npm run setup first.");
  }
}

function run(args, options = {}) {
  const result = spawnSync(wrangler, ["wrangler", ...args], {
    cwd: workerDir,
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : "pipe",
    input: options.input,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0) throw new Error(output.trim() || "Wrangler exited with an error.");
  return output;
}

await ensureEnv();
console.log("Checking Cloudflare authentication…");
try {
  const identity = run(["whoami"]);
  if (/not authenticated|not logged in/i.test(identity)) throw new Error("login required");
} catch {
  const login = spawnSync(wrangler, ["wrangler", "login"], {
    cwd: workerDir,
    stdio: "inherit",
  });
  if (login.status !== 0) throw new Error("Could not sign in to Cloudflare.");
}

console.log("Deploying the Media Worker…");
const deployOutput = run(["deploy", "--config", "wrangler.jsonc"]);
const workerUrl = deployOutput.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
if (!workerUrl) throw new Error("The Worker was deployed, but Wrangler did not return a public URL.");

const token = randomBytes(32).toString("hex");
const secretDir = path.join(root, "data", "runtime");
const secretFile = path.join(secretDir, "media-worker-secrets.json");
await mkdir(secretDir, { recursive: true });
try {
  await writeFile(secretFile, JSON.stringify({ MEDIA_UPLOAD_TOKEN: token }), {
    encoding: "utf8",
    mode: 0o600,
  });
  run(["secret", "bulk", secretFile, "--config", "wrangler.jsonc"]);
} finally {
  await rm(secretFile, { force: true });
}
let healthy = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const response = await fetch(`${workerUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!healthy)
  throw new Error("The Worker was deployed, but the /health check failed. Try setup again later.");
await updateEnv(path.join(root, ".env"), {
  MEDIA_WORKER_URL: workerUrl,
  MEDIA_WORKER_TOKEN: token,
});
console.log(`Media Worker is ready: ${workerUrl}`);
console.log("The URL and secret were saved only in the local .env. Restart Video Studio.");
