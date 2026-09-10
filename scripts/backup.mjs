import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(root, ".studio-backups", stamp);
const dataSource = path.join(root, "data");
await mkdir(destination, { recursive: true });

await cp(dataSource, path.join(destination, "data"), {
  recursive: true,
  force: false,
  filter: (source) => {
    const relative = path.relative(dataSource, source);
    const first = relative.split(path.sep)[0];
    return !["backups", "npm-cache"].includes(first);
  },
});
await mkdir(path.join(destination, "prompts"), { recursive: true });
for (const name of ["analysis-prompt.txt", "analysis-universal-prompt.txt"])
  await cp(path.join(root, "src", name), path.join(destination, "prompts", name));
await writeFile(
  path.join(destination, "README.txt"),
  "Backup of local Video Studio data and bundled prompts. The .env file and API keys are intentionally excluded.\n",
  "utf8",
);
console.log(`Backup created: ${destination}`);
console.log("The API key and .env were intentionally excluded.");
