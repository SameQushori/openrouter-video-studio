import { readFile } from "node:fs/promises";
import path from "node:path";
const bad = (message) => Object.assign(new Error(message), { status: 400 });
export function selectGeminiModels(raw) {
  return raw
    .filter(
      (m) =>
        m.id.startsWith("google/gemini-") &&
        !m.id.includes(":") &&
        m.architecture?.input_modalities?.includes("video") &&
        m.architecture?.output_modalities?.includes("text"),
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing,
      supported: m.supported_parameters || [],
    }));
}
export async function analysisPayload(body, model, root) {
  if (!model) throw bad("Выберите Gemini с поддержкой видео.");
  if (
    typeof body.prompt !== "string" ||
    !body.prompt.trim() ||
    body.prompt.length > 20000
  )
    throw bad("Промпт должен содержать от 1 до 20000 символов.");
  if (!/^[a-f0-9-]{36}$/.test(body.assetId || "")) throw bad("Загрузите MP4.");
  if (body.quality && !["standard", "max"].includes(body.quality))
    throw bad("Неизвестный режим точности.");
  let metadata;
  try {
    metadata = JSON.parse(
      await readFile(path.join(root, body.assetId + ".json"), "utf8"),
    );
  } catch {
    throw bad("Файл не найден.");
  }
  if (
    metadata.kind !== "video" ||
    metadata.mime !== "video/mp4" ||
    metadata.file !== body.assetId + ".mp4"
  )
    throw bad("Для анализа нужен MP4.");
  const buffer = await readFile(path.join(root, metadata.file));
  if (buffer.length > 25 * 1024 * 1024)
    throw bad("Максимальный размер — 25 МБ.");
  const payload = {
    model: model.id,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "video_url",
            video_url: {
              url: `data:video/mp4;base64,${buffer.toString("base64")}`,
            },
          },
          { type: "text", text: body.prompt },
        ],
      },
    ],
    max_tokens: body.quality === "max" ? 12000 : 8192,
  };
  if (model.supported.includes("response_format"))
    payload.response_format = { type: "json_object" };
  if (model.supported.includes("reasoning"))
    payload.reasoning = { effort: body.quality === "max" ? "high" : "low" };
  if (model.supported.includes("temperature")) payload.temperature = 0.1;
  return payload;
}
export function analysisResult(response) {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p) => p.text || "").join("")
        : "";
  let json = null;
  try {
    const parsed = JSON.parse(
      raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      json = parsed;
  } catch {}
  return {
    result: json ? JSON.stringify(json, null, 2) : raw,
    jsonValid: !!json,
    usage: response.usage,
    warning:
      choice?.finish_reason === "length"
        ? "Ответ обрезан лимитом токенов. Повторный анализ платный."
        : !json
          ? "Gemini не вернул корректный JSON. Сохранён исходный ответ; автоматического повтора нет."
          : null,
  };
}
export function installAnalysis(app, { provider, store, assets, demo }) {
  let catalog,
    at = 0;
  async function models() {
    if (!catalog || Date.now() - at > 300000) {
      catalog = demo
        ? [
            {
              id: "google/gemini-demo",
              name: "Gemini Demo",
              supported: [],
              pricing: { prompt: "0", completion: "0" },
            },
          ]
        : selectGeminiModels(await provider.analysisModels());
      at = Date.now();
    }
    return catalog;
  }
  app.get("/api/analysis/models", async (req, res) =>
    res.json({ data: await models() }),
  );
  app.get("/api/analysis/jobs", (req, res) =>
    res.json({ data: store.list().filter((j) => j.kind === "analysis") }),
  );
  for (const job of store.list())
    if (job.kind === "analysis" && job.status === "analyzing") {
      job.status = "submission_unknown";
      job.error =
        "Сервер перезапущен во время анализа. Проверьте расходы перед повтором.";
      store.put(job);
    }
  app.post("/api/analysis/jobs", async (req, res) => {
    const id = req.get("Idempotency-Key");
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(id || ""))
      throw bad("Требуется ключ запроса.");
    const existing = store.get(id);
    if (existing) {
      if (existing.kind !== "analysis")
        throw bad("Ключ уже использован для другого запроса.");
      return res.json(existing);
    }
    const model = (await models()).find((m) => m.id === req.body.model);
    const payload = await analysisPayload(req.body, model, assets.root);
    const duplicate = store.get(id);
    if (duplicate) return res.json(duplicate);
    if (
      store
        .list()
        .some((j) => j.kind === "analysis" && j.status === "analyzing")
    )
      return res
        .status(409)
        .json({ error: "Дождитесь завершения текущего анализа." });
    const job = {
      id,
      kind: "analysis",
      model: model.id,
      prompt: req.body.prompt,
      assetId: req.body.assetId,
      quality: req.body.quality || "standard",
      createdAt: new Date().toISOString(),
      status: "analyzing",
      demo,
    };
    store.put(job);
    res.status(202).json(job);
    void (async () => {
      try {
        const response = demo
          ? {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      demo: true,
                      note: "Тестовый JSON; видео не анализировалось.",
                    }),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { cost: 0, prompt_tokens: 0, completion_tokens: 0 },
            }
          : await provider.analyze(payload);
        Object.assign(job, {
          status: "completed",
          ...analysisResult(response),
        });
      } catch (e) {
        Object.assign(job, {
          status: e.uncertain ? "submission_unknown" : "failed",
          error: e.message,
        });
      }
      store.put(job);
    })().catch(() => {});
  });
}
