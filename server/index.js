import "dotenv/config";
import { createStore } from "./store.js";
import { openRouter } from "./provider.js";
import { demoProvider } from "./demo.js";
import { createApp } from "./app.js";
import { readFileSync } from "node:fs";
import { createTransport } from "./transport.js";
import { createTikTokDownloader } from "./tiktok.js";
import { createMetadataProcessor } from "./metadata.js";
import path from "node:path";
const demo = process.env.DEMO_MODE === "true";
const dataRoot = path.resolve(process.env.DATA_DIR || "data");
const host = process.env.HOST || "127.0.0.1";
const transport = createTransport(demo ? "" : process.env.OPENROUTER_PROXY_URL);
const store = createStore(path.join(dataRoot, demo ? "demo" : "live"));
const collectionStore = createStore(path.join(dataRoot, "library"));
const overrides = JSON.parse(
  readFileSync(new URL("./reference-overrides.json", import.meta.url), "utf8"),
);
const runtime = createApp({
  provider: demo
    ? demoProvider()
    : openRouter(process.env.OPENROUTER_API_KEY, transport.fetcher),
  store,
  collectionStore,
  demo,
  overrides,
  pollMs: demo ? 2000 : 30000,
  assetDir: path.join(dataRoot, demo ? "demo/uploads" : "live/uploads"),
  assetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL,
  mediaWorker: {
    url: process.env.MEDIA_WORKER_URL,
    token: process.env.MEDIA_WORKER_TOKEN,
    fetcher: transport.fetcher,
  },
  tiktokDownloader: createTikTokDownloader(),
  metadataProcessor: createMetadataProcessor(),
  metadataDir: path.join(
    dataRoot,
    demo ? "demo/metadata" : "live/metadata",
  ),
});
const server = runtime.app.listen(
  Number(process.env.PORT) || 3001,
  host,
  () =>
    console.log(
      `Video Studio: http://127.0.0.1:${Number(process.env.PORT) || 3001} (${demo ? "DEMO" : "OpenRouter"})`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    runtime.close();
    server.close(() => {
      store.close();
      collectionStore.close();
      process.exit(0);
    });
  });
