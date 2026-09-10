import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { normalizeModel, validateRequest, terminal } from "./capabilities.js";
import { createAssets, attachAssets } from "./assets.js";
import { installAnalysis } from "./analysis.js";
import { installCollections } from "./collections.js";
import { installTikTok } from "./tiktok.js";
import { installMetadata } from "./metadata.js";
export function createApp({
  provider,
  store,
  demo = false,
  overrides = {},
  pollMs = 30000,
  distDir = path.resolve("dist"),
  assetDir = path.resolve("data/uploads"),
  assetBaseUrl = "",
  mediaWorker = {},
  collectionStore = store,
  tiktokDownloader = async () => {
    throw Object.assign(new Error("Загрузчик TikTok не установлен."), {
      status: 503,
    });
  },
  metadataProcessor = async () => {
    throw Object.assign(new Error("ExifTool не установлен."), { status: 503 });
  },
  metadataDir = path.resolve("data/metadata"),
}) {
  const app = express();
  const assets = createAssets(assetDir, assetBaseUrl, demo, mediaWorker);
  app.disable("x-powered-by");
  // A public proxy may expose only these opaque media URLs; the app remains local.
  app.use(
    "/media",
    (req, res, next) =>
      /\/[a-f0-9-]{36}\.(png|jpg|webp|mp4)$/.test(req.path)
        ? next()
        : res.sendStatus(404),
    express.static(assets.root, {
      dotfiles: "deny",
      index: false,
      setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
    }),
  );
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host))
      return res.status(403).json({ error: "Только локальный доступ." });
    const origin = req.get("origin");
    if (
      origin &&
      ![
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        `http://${req.get("host")}`,
      ].includes(origin)
    )
      return res.status(403).json({ error: "Недопустимый источник запроса." });
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (req, res) =>
    res.json({ app: "openrouter-video-studio", ready: true }),
  );
  installCollections(app, collectionStore);
  let catalog,
    catalogAt = 0;
  async function models() {
    if (!catalog || Date.now() - catalogAt > 300000) {
      const raw = await provider.models();
      if (!Array.isArray(raw))
        throw new Error("Некорректный каталог OpenRouter.");
      catalog = raw.map((m) => normalizeModel(m, overrides));
      catalogAt = Date.now();
    }
    return catalog;
  }
  app.get("/api/config", (req, res) =>
    res.json({
      demo,
      pollMs,
      uploadsConfigured: true,
      videoUploadsConfigured: assets.configured,
      publicAssetBaseUrl: assets.publicBaseUrl,
      videoUploadTransport: assets.transport,
    }),
  );
  app.post("/api/uploads", assets.upload, assets.accept);
  installTikTok(app, { assets, downloader: tiktokDownloader });
  installMetadata(app, {
    processor: metadataProcessor,
    outputDir: metadataDir,
  });
  app.get("/api/models", async (req, res) =>
    res.json({ data: await models() }),
  );
  const earlyCancellations = new Set();
  app.get("/api/jobs", (req, res) =>
    res.json({ data: store.list().filter((j) => j.kind !== "analysis") }),
  );
  installAnalysis(app, { provider, store, assets, demo });
  let accountCache,
    accountAt = 0,
    accountPending;
  app.get("/api/account", async (req, res) => {
    if (!accountCache || Date.now() - accountAt > 30000) {
      if (!accountPending)
        accountPending = (
          demo
            ? Promise.resolve({
                balance: null,
                keyUsage: 0,
                keyDaily: 0,
                keyMonthly: 0,
                errors: [],
                checkedAt: new Date().toISOString(),
              })
            : provider.account()
        )
          .then((data) => {
            accountCache = data;
            accountAt = Date.now();
          })
          .finally(() => {
            accountPending = null;
          });
      await accountPending;
    }
    const jobs = store.list();
    const billed = jobs.filter((j) => typeof j.usage?.cost === "number");
    res.json({
      ...accountCache,
      demo,
      studioUsage: billed.reduce((sum, j) => sum + j.usage.cost, 0),
      unreportedJobs: jobs.filter(
        (j) => j.status === "completed" && typeof j.usage?.cost !== "number",
      ).length,
      tokens: null,
    });
  });
  app.post("/api/jobs/:id/resume", (req, res) => {
    const job = store.get(req.params.id);
    if (!job || !job.remoteId || terminal.has(job.status))
      return res
        .status(400)
        .json({ error: "Нет активного задания для проверки." });
    Object.assign(job, {
      pollPaused: false,
      pollCount: 0,
      retries: 0,
      nextPollAt: Date.now(),
    });
    store.put(job);
    res.json(job);
  });
  app.post("/api/jobs/:id/cancel", (req, res) => {
    const job = store.get(req.params.id);
    if (!job) {
      if (!/^[a-zA-Z0-9-]{10,100}$/.test(req.params.id))
        return res.status(404).json({ error: "Задание не найдено." });
      if (earlyCancellations.size >= 100)
        earlyCancellations.delete(earlyCancellations.values().next().value);
      earlyCancellations.add(req.params.id);
      return res.status(202).json({
        id: req.params.id,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationScope: "before_submission",
        cancellationNote:
          "Отправка остановлена до передачи задания провайдеру.",
      });
    }
    if (job.status === "cancelled") return res.json(job);
    if (terminal.has(job.status))
      return res.status(400).json({
        error: "Завершённое задание уже нельзя отменить.",
      });
    Object.assign(job, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      pollPaused: true,
      cancellationScope: "local_tracking",
      cancellationNote:
        "Studio прекратила проверку. OpenRouter не предоставляет API отмены video job, поэтому уже принятая генерация может продолжиться и списать средства.",
    });
    store.put(job);
    res.json(job);
  });
  app.post("/api/jobs", async (req, res) => {
    const key = req.get("Idempotency-Key");
    if (!key || !/^[a-zA-Z0-9-]{10,100}$/.test(key))
      return res.status(400).json({ error: "Требуется ключ запроса." });
    const existing = store.get(key);
    if (existing) return res.json(existing);
    const model = (await models()).find((m) => m.id === req.body.model);
    const payload = validateRequest(req.body, model);
    await attachAssets(req.body, model, payload, assets);
    // Recheck after async catalog loading to serialize concurrent duplicate submits.
    const duplicate = store.get(key);
    if (duplicate) return res.json(duplicate);
    const cancelledBeforeSubmit = earlyCancellations.delete(key);
    const job = {
      id: key,
      model: payload.model,
      prompt: payload.prompt,
      parameters: JSON.parse(
        JSON.stringify(payload, (key, value) =>
          typeof value === "string" && value.startsWith("data:")
            ? "[uploaded media]"
            : value,
        ),
      ),
      createdAt: new Date().toISOString(),
      status: cancelledBeforeSubmit ? "cancelled" : "submitting",
      demo,
      ...(cancelledBeforeSubmit
        ? {
            cancelledAt: new Date().toISOString(),
            cancellationScope: "before_submission",
            cancellationNote:
              "Отправка остановлена до передачи задания провайдеру.",
          }
        : {}),
    };
    store.put(job);
    if (cancelledBeforeSubmit) return res.status(202).json(job);
    try {
      const remote = await provider.submit(payload);
      if (typeof remote.id !== "string" || !remote.id)
        throw Object.assign(
          new Error(
            "OpenRouter не вернул ID. Проверьте кабинет перед повтором.",
          ),
          { uncertain: true },
        );
      const current = store.get(job.id);
      if (current?.status === "cancelled") {
        Object.assign(current, {
          remoteId: remote.id,
          providerStatusAtCancel: remote.status || "pending",
        });
        store.put(current);
        return res.status(202).json(current);
      }
      Object.assign(job, {
        remoteId: remote.id,
        status: remote.status || "pending",
        nextPollAt: Date.now() + pollMs,
      });
    } catch (error) {
      const current = store.get(job.id);
      if (current?.status === "cancelled") return res.status(202).json(current);
      Object.assign(job, {
        status: error.uncertain ? "submission_unknown" : "failed",
        error: error.message,
      });
    }
    store.put(job);
    res.status(202).json(job);
  });
  app.get("/api/jobs/:id/content", async (req, res) => {
    const job = store.get(req.params.id);
    if (!job || job.status !== "completed")
      return res.status(404).json({ error: "Готовое видео не найдено." });
    const result = await provider.content(job.remoteId, req.get("range"));
    if (result.demo) {
      if (req.query.download === "1")
        return res.download(path.resolve("server/demo.mp4"), "studio-demo.mp4");
      return res.sendFile(path.resolve("server/demo.mp4"));
    }
    if (result.redirect) return res.redirect(result.redirect);
    const upstream = result.response;
    res.status(upstream.status);
    for (const header of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ])
      if (upstream.headers.has(header))
        res.set(header, upstream.headers.get(header));
    if (req.query.download === "1") res.attachment(`video-${job.id}.mp4`);
    await pipeline(Readable.fromWeb(upstream.body), res);
  });
  app.use(express.static(distDir));
  app.get("/", (req, res) => res.sendFile(path.join(distDir, "index.html")));
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Маршрут не найден." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.code?.startsWith("LIMIT_") ? 413 : err.status || 500;
    res.status(status).json({
      error:
        status === 413
          ? req.originalUrl.startsWith("/api/metadata/")
            ? "Можно загрузить два медиафайла размером до 50 МБ каждый."
            : "Максимум один файл размером до 25 МБ."
          : err.status
            ? err.message
            : "Ошибка сервера. Проверьте настройки и повторите чтение.",
    });
  });
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const job of store.list()) {
        if (
          job.kind === "analysis" ||
          terminal.has(job.status) ||
          !job.remoteId ||
          job.pollPaused ||
          Date.now() < (job.nextPollAt || 0)
        )
          continue;
        if ((job.pollCount || 0) >= 120) {
          job.pollPaused = true;
          store.put(job);
          continue;
        }
        job.pollCount = (job.pollCount || 0) + 1;
        try {
          const remote = await provider.poll(job.remoteId);
          if (
            ![
              "pending",
              "in_progress",
              "completed",
              "failed",
              "cancelled",
              "expired",
            ].includes(remote.status)
          )
            throw new Error("Неизвестный статус OpenRouter.");
          Object.assign(job, {
            status: remote.status,
            usage: remote.usage,
            error: remote.error,
            pollError: null,
            retries: 0,
          });
        } catch (error) {
          job.pollError = error.message;
          job.retries = (job.retries || 0) + 1;
        }
        // A cancel request can arrive while the provider poll is in flight.
        // Never overwrite the user's local cancellation with that late reply.
        if (store.get(job.id)?.status === "cancelled") continue;
        job.nextPollAt =
          Date.now() +
          Math.min(pollMs * 2 ** Math.min(job.retries || 0, 4), 300000);
        store.put(job);
      }
    } finally {
      busy = false;
    }
  }
  // A crash between submit and saving remote ID must never cause an automatic second charge.
  for (const job of store.list())
    if (job.status === "submitting") {
      job.status = "submission_unknown";
      job.error =
        "Отправка прервана. Проверьте кабинет OpenRouter перед повтором.";
      store.put(job);
    }
  const timer = setInterval(
    () => void tick().catch(() => {}),
    Math.min(pollMs, 3000),
  );
  timer.unref();
  return { app, tick, close: () => clearInterval(timer) };
}
