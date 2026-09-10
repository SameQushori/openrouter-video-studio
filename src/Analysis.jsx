import { useState, useEffect, useRef } from "react";
import seedanceTemplate from "./analysis-prompt.txt?raw";
import universalTemplate from "./analysis-universal-prompt.txt?raw";
import { extractGenerationPrompts } from "./analysis-result.js";
const status = {
  analyzing: "Gemini анализирует…",
  completed: "Готово",
  failed: "Ошибка",
  submission_unknown: "Проверьте расходы перед повтором",
};
async function api(url, options) {
  const r = await fetch(url, options);
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Ошибка запроса");
  return b;
}
export function Analysis({ onUse }) {
  const [models, setModels] = useState([]),
    [modelId, setModel] = useState(""),
    [prompt, setPrompt] = useState(universalTemplate),
    [quality, setQuality] = useState("max"),
    [asset, setAsset] = useState(null),
    [jobs, setJobs] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [tiktok, setTikTok] = useState(""),
    [tiktokAsset, setTikTokAsset] = useState(null);
  const key = useRef(null);
  const model = models.find((m) => m.id === modelId),
    job = jobs.find((j) => j.id === selected) || jobs[0];
  useEffect(() => {
    let active = true,
      timer;
    api("/api/analysis/models")
      .then((b) => {
        if (active) {
          setModels(b.data);
          setModel(
            b.data.find((m) => m.id === "google/gemini-3.1-pro-preview")?.id ||
              b.data[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => setError(e.message));
    async function refresh() {
      try {
        const b = await api("/api/analysis/jobs");
        if (active) setJobs(b.data);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) timer = setTimeout(refresh, 2500);
      }
    }
    refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function upload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setError("Максимум 25 МБ.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const a = await api("/api/uploads", { method: "POST", body: form });
      if (a.kind !== "video") throw new Error("Нужен MP4.");
      setAsset(a);
      setTikTokAsset(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function importTikTok(download = false) {
    if (busy || !tiktok.trim()) return;
    setBusy(true);
    setError("");
    try {
      let imported = tiktokAsset;
      if (!imported || imported.sourceUrl !== tiktok.trim()) {
        imported = await api("/api/tiktok/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tiktok.trim() }),
        });
        imported = { ...imported, sourceUrl: tiktok.trim() };
        setTikTokAsset(imported);
        setAsset(imported);
      }
      if (download) {
        const link = document.createElement("a");
        link.href = `/api/tiktok/assets/${imported.id}/download`;
        link.download = "tiktok-video.mp4";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const j = await api("/api/analysis/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key.current || (key.current = crypto.randomUUID()),
        },
        body: JSON.stringify({
          model: modelId,
          prompt,
          assetId: asset.id,
          quality,
        }),
      });
      setJobs((v) => [j, ...v.filter((x) => x.id !== j.id)]);
      setSelected(j.id);
      key.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const input = Number(model?.pricing?.prompt),
    output = Number(model?.pricing?.completion);
  function estimate(seconds) {
    if (!Number.isFinite(input) || !Number.isFinite(output))
      return "Нет тарифа";
    const p = Math.ceil(prompt.length / 4);
    const outputLow = quality === "max" ? 3000 : 2000,
      outputHigh = quality === "max" ? 12000 : 6000,
      low = (p + seconds * 100) * input + outputLow * output,
      high = (p + seconds * 300) * input + outputHigh * output;
    return `$${low.toFixed(3)}–${high.toFixed(3)}`;
  }
  const active = jobs.some((j) => j.status === "analyzing");
  const generated = extractGenerationPrompts(job?.result);
  return (
    <div className="workspace analysisWorkspace">
      <section>
        <div className="sectionTitle">
          <span className="eyebrow">ВИДЕО → JSON-ПРОМПТ</span>
        </div>
        <h1>Разобрать референс.</h1>
        <form onSubmit={submit}>
          <label>
            Gemini
            <select
              value={modelId}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            >
              {!models.length && <option>Загрузка моделей…</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Точность анализа
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={busy}
            >
              <option value="max">Максимальная · больше времени и токенов</option>
              <option value="standard">Стандартная · дешевле</option>
            </select>
          </label>
          <label>
            Исходное видео · MP4 до 25 МБ
            <input
              type="file"
              accept="video/mp4"
              onChange={upload}
              disabled={busy}
            />
          </label>
          <div className="tiktokImport">
            <label>
              Или ссылка на видео TikTok
              <input
                type="url"
                inputMode="url"
                placeholder="https://www.tiktok.com/@user/video/…"
                value={tiktok}
                onChange={(e) => {
                  setTikTok(e.target.value);
                  if (tiktokAsset) setAsset(null);
                  setTikTokAsset(null);
                }}
                disabled={busy}
              />
            </label>
            <div className="tiktokActions">
              <button
                type="button"
                onClick={() => importTikTok(false)}
                disabled={busy || !tiktok.trim()}
              >
                Загрузить для анализа
              </button>
              <button
                type="button"
                onClick={() => importTikTok(true)}
                disabled={busy || !tiktok.trim()}
              >
                Скачать MP4
              </button>
            </div>
            <small>
              Работают публичные ролики. TikTok иногда ограничивает загрузку по
              региону или требует вход в аккаунт.
            </small>
          </div>
          {asset && (
            <>
              <p className="hint">{asset.name}</p>
              <video
                className="analysisVideo"
                src={asset.previewUrl}
                controls
              />
            </>
          )}
          <div className="promptToolbar">
            <span>Промпт для анализа</span>
            <div className="templateActions">
              <button type="button" onClick={() => setPrompt(universalTemplate)}>
                Универсальный · Wan + H3
              </button>
              <button type="button" onClick={() => setPrompt(seedanceTemplate)}>
                Старый Seedance
              </button>
            </div>
          </div>
          <textarea
            aria-label="Промпт для анализа"
            rows={12}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={20000}
            required
          />
          <p className="hint">
            Универсальный шаблон делает одну точную транскрипцию и сразу готовит
            отдельные промпты для Wan, MiniMax H3 с первым кадром и H3 Motion.
            Неясные слова должны помечаться как [inaudible], но результат всё
            равно стоит проверить перед платной генерацией.
          </p>
          <div className="estimate">
            <strong>Оценка одного анализа</strong>
            <div>
              {[5, 10, 15].map((s) => (
                <p key={s}>
                  {s} сек <b>{estimate(s)}</b>
                </p>
              ))}
            </div>
            <small>
              Ориентир: 100–300 входных токенов/сек видео, промпт ≈ символы/4,
              3000–12000 выходных токенов вместе с рассуждением. Это не лимит
              расходов; детализация и обработка видео меняют сумму.
            </small>
          </div>
          <button
            className="primary"
            disabled={busy || active || !model || !asset || !prompt.trim()}
          >
            {busy
              ? "Подождите…"
              : active
                ? "Идёт анализ…"
                : "Анализировать · платный запрос"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section>
        <div className="sectionTitle">
          <span className="eyebrow">РЕЗУЛЬТАТ GEMINI</span>
          <span aria-live="polite">
            {job ? status[job.status] : "Нет анализа"}
          </span>
        </div>
        {!job ? (
          <div className="empty">
            <h2>Здесь появится JSON</h2>
            <p>
              Загрузите видео и нажмите «Анализировать». Публичная ссылка не
              нужна.
            </p>
          </div>
        ) : (
          <>
            <p className="hint">
              {job.model} · {new Date(job.createdAt).toLocaleString("ru")}
            </p>
            {job.error && <p className="error">{job.error}</p>}
            {job.warning && <p className="error">{job.warning}</p>}
            {job.result && (
              <>
                <textarea
                  className="jsonResult"
                  aria-label="Результат анализа"
                  value={job.result}
                  readOnly
                  rows={24}
                />
                <div className="promptToolbar">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(job.result);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setError(
                          "Не удалось скопировать. Выделите текст результата вручную.",
                        );
                      }
                    }}
                  >
                    {copied ? "Скопировано" : "Копировать"}
                  </button>
                  {generated.wan && (
                    <button type="button" onClick={() => onUse(generated.wan, "wan")}>
                      В Wan →
                    </button>
                  )}
                  {generated.minimaxImage && (
                    <button
                      type="button"
                      onClick={() => onUse(generated.minimaxImage, "minimax-image")}
                    >
                      В H3 · кадр →
                    </button>
                  )}
                  {generated.minimaxMotion && (
                    <button
                      type="button"
                      onClick={() => onUse(generated.minimaxMotion, "minimax-motion")}
                    >
                      В H3 · Motion →
                    </button>
                  )}
                  {!generated.wan && !generated.minimaxImage && (
                    <button
                      type="button"
                      disabled={!job.jsonValid || job.result.length > 10000}
                      onClick={() => onUse(job.result)}
                    >
                      В генератор видео →
                    </button>
                  )}
                </div>
                {job.result.length > 10000 && (
                  <p className="hint">
                    JSON длиннее лимита промпта генератора (10000 символов).
                    Сократите его перед переносом.
                  </p>
                )}
              </>
            )}
            {job.usage && (
              <p className="hint">
                Стоимость:{" "}
                {typeof job.usage.cost === "number"
                  ? `$${job.usage.cost.toFixed(5)}`
                  : "не возвращена API"}{" "}
                · Вход: {job.usage.prompt_tokens ?? "—"} токенов · Выход:{" "}
                {job.usage.completion_tokens ?? "—"} · Рассуждение:{" "}
                {job.usage.completion_tokens_details?.reasoning_tokens ?? "—"}
              </p>
            )}
          </>
        )}
        <div className="history">
          <h2>История анализов</h2>
          <div className="historyList" tabIndex="0">
            {jobs.map((j) => (
              <button
                className="historyRow"
                key={j.id}
                onClick={() => {
                  setSelected(j.id);
                  setCopied(false);
                }}
              >
                <span className="historyText">
                  <strong>{j.model}</strong>
                  <small>{new Date(j.createdAt).toLocaleString("ru")}</small>
                </span>
                <span>{status[j.status]}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
