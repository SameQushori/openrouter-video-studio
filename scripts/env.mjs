import { readFile, writeFile } from "node:fs/promises";

export async function readEnv(file) {
  try {
    const text = await readFile(file, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((line) => line && !line.trimStart().startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator < 0) return [line.trim(), ""];
          const key = line.slice(0, separator).trim();
          let value = line.slice(separator + 1).trim();
          if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
          )
            value = value.slice(1, -1);
          return [key, value];
        }),
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function updateEnv(file, values) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const remaining = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${String(value).replace(/[\r\n]/g, "")}`;
  });
  for (const [key, value] of remaining)
    lines.push(`${key}=${String(value).replace(/[\r\n]/g, "")}`);
  await writeFile(file, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}
