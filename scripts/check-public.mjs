import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const excluded = new Set([".git", ".wrangler", "data", "dist", "node_modules"]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name === ".env" || entry.name === "wrangler.user.jsonc") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(full);
  }
}
await walk(root);

const findings = [];
for (const file of files) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue;
  }
  const relative = path.relative(root, file);
  if (/sk-or-v1-[A-Za-z0-9_-]{20,}/.test(text)) findings.push(`${relative}: possible OpenRouter key`);
  if (/C:\\Users\\[^\\\r\n]+/i.test(text)) findings.push(`${relative}: absolute Windows user path`);
  if (/"id"\s*:\s*"[a-f0-9]{32}"/i.test(text)) findings.push(`${relative}: personal Cloudflare resource ID`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else console.log(`✓ Checked ${files.length} public files: no secrets or personal paths found.`);
