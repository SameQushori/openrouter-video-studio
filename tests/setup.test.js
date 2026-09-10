import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readEnv, updateEnv } from "../scripts/env.mjs";

test("setup updates selected values without deleting local configuration", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "video-studio-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  await writeFile(
    file,
    "# local settings\nOPENROUTER_API_KEY=existing-secret\nPORT=3456\nCUSTOM_VALUE=keep-me\n",
  );

  await updateEnv(file, { DEMO_MODE: "true", PORT: "3001" });

  const parsed = await readEnv(file);
  assert.equal(parsed.OPENROUTER_API_KEY, "existing-secret");
  assert.equal(parsed.CUSTOM_VALUE, "keep-me");
  assert.equal(parsed.PORT, "3001");
  assert.equal(parsed.DEMO_MODE, "true");
  assert.match(await readFile(file, "utf8"), /^# local settings/m);
});
