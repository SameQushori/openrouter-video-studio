import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Inputs } from "./Inputs.jsx";
import { Account } from "./Account.jsx";
import { Analysis } from "./Analysis.jsx";
import { Collections } from "./Collections.jsx";
import { ModelGuide } from "./ModelGuide.jsx";
import { Metadata } from "./Metadata.jsx";
async function api(url, options) {
  let r;
  try {
    r = await fetch(url, options);
  } catch {
    throw new Error(
      "Нет соединения с локальной студией. Запустите сервер и обновите страницу. Запрос не будет повторён автоматически.",
    );
  }
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Ошибка запроса");
  return body;
}
const labels = {
  submitting: "Отправляется",
  pending: "В очереди",
  in_progress: "Создаётся",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
  expired: "Истекло",
  submission_unknown: "Проверьте OpenRouter",
};
const activeStatuses = new Set(["submitting", "pending", "in_progress"]);
const notificationStatuses = new Set([
  "completed",
  "failed",
  "expired",
  "submission_unknown",
]);
function modelLabel(model) {
  const capability =
    model.id === "minimax/hailuo-3"
      ? " · Motion Control"
      : model.id === "minimax/hailuo-3-max"
        ? " · без Motion Control"
        : "";
  return `${model.stars ? `${"★".repeat(model.stars)} ` : ""}${model.name}${capability}`;
}
function App() {
  const [tab, setTab] = useState("generate");
  const [models, setModels] = useState([]),
    [modelId, setModelId] = useState(""),
    [prompt, setPrompt] = useState(""),
    [params, setParams] = useState({});
  const [jobs, setJobs] = useState([]),
    [selected, setSelected] = useState(null),
    [config, setConfig] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [guideOpen, setGuideOpen] = useState(false),
    [cancelBusy, setCancelBusy] = useState(null),
    [copiedPrompt, setCopiedPrompt] = useState(false),
    [unseenEvent, setUnseenEvent] = useState(null);
  const requestKey = useRef(null);
  const previousStatuses = useRef(new Map());
  const statusSnapshotReady = useRef(false);
  const [inputs, setInputs] = useState({}),
    [uploading, setUploading] = useState(false);
  const model = models.find((m) => m.id === modelId);
  const promptLimit = model?.promptMaxChars ?? 10000;
  const promptLength = Array.from(prompt).length;
  const job = jobs.find((j) => j.id === selected) || jobs[0];
  async function loadModels() {
    setLoading(true);
    try {
      const data = await api("/api/models");
      setModels(data.data);
      setModelId((v) => v || data.data[0]?.id || "");
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadModels();
    api("/api/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    let active = true;
    let timer;
    async function refresh() {
      try {
        const data = await api("/api/jobs");
        if (active) setJobs(data.data);
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
  useEffect(() => {
    if (!statusSnapshotReady.current) {
      previousStatuses.current = new Map(
        jobs.map((item) => [item.id, item.status]),
      );
      statusSnapshotReady.current = true;
      return;
    }
    const finished = jobs.find(
      (item) =>
        activeStatuses.has(previousStatuses.current.get(item.id)) &&
        notificationStatuses.has(item.status),
    );
    previousStatuses.current = new Map(
      jobs.map((item) => [item.id, item.status]),
    );
    if (finished) setUnseenEvent({ id: finished.id, status: finished.status });
  }, [jobs]);
  const hasActiveJob = jobs.some((item) => activeStatuses.has(item.status));
  useEffect(() => {
    if (unseenEvent?.status === "completed")
      document.title = "● Видео готово · Video Studio";
    else if (unseenEvent) document.title = "● Нужна проверка · Video Studio";
    else if (hasActiveJob) document.title = "⏳ Идёт генерация · Video Studio";
    else document.title = "Video Studio";
    return () => {
      document.title = "Video Studio";
    };
  }, [hasActiveJob, unseenEvent]);
  useEffect(() => {
    const acknowledge = () => setUnseenEvent(null);
    window.addEventListener("pointerdown", acknowledge);
    window.addEventListener("keydown", acknowledge);
    return () => {
      window.removeEventListener("pointerdown", acknowledge);
      window.removeEventListener("keydown", acknowledge);
    };
  }, []);
  useEffect(() => {
    setParams({});
    setInputs({});
  }, [modelId]);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const newJob = await api("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key":
            requestKey.current || (requestKey.current = crypto.randomUUID()),
        },
        body: JSON.stringify({ model: modelId, prompt, ...params, ...inputs }),
      });
      setJobs((v) => [newJob, ...v.filter((j) => j.id !== newJob.id)]);
      setSelected(newJob.id);
      requestKey.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelJob(id) {
    if (cancelBusy) return;
    setCancelBusy(id);
    setError("");
    try {
      const cancelled = await api(`/api/jobs/${id}/cancel`, {
        method: "POST",
      });
      setJobs((items) => {
        const value = {
          model: modelId,
          prompt,
          createdAt: new Date().toISOString(),
          ...cancelled,
        };
        return items.some((item) => item.id === cancelled.id)
          ? items.map((item) => (item.id === cancelled.id ? value : item))
          : [value, ...items];
      });
      setSelected(cancelled.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setCancelBusy(null);
    }
  }
  return (
    <main>
      <header>
        <a className="brand" href="/">
          ▧ <span>Video Studio</span>
        </a>
        <span className="mode">
          {config.demo ? "● ДЕМО · без списаний" : "● Локальная студия"}
        </span>
      </header>
      <Account />
      <nav className="tabs mainTabs" aria-label="Разделы студии">
        <button
          aria-pressed={tab === "generate"}
          className={tab === "generate" ? "active" : ""}
          onClick={() => setTab("generate")}
        >
          Генерация видео
        </button>
        <button
          aria-pressed={tab === "analysis"}
          className={tab === "analysis" ? "active" : ""}
          onClick={() => setTab("analysis")}
        >
          Анализ видео · Gemini
        </button>
        <button
          aria-pressed={tab === "collections"}
          className={tab === "collections" ? "active" : ""}
          onClick={() => setTab("collections")}
        >
          Коллекции
        </button>
        <button
          aria-pressed={tab === "metadata"}
          className={tab === "metadata" ? "active" : ""}
          onClick={() => setTab("metadata")}
        >
          Метаданные EXIF
        </button>
      </nav>
      {unseenEvent && (
        <button
          type="button"
          className={`completionNotice ${unseenEvent.status}`}
          onClick={() => {
            setTab("generate");
            setSelected(unseenEvent.id);
            setUnseenEvent(null);
          }}
        >
          <span className="noticeDot" aria-hidden="true" />
          <strong>
            {unseenEvent.status === "completed"
              ? "Видео готово"
              : "Генерация требует внимания"}
          </strong>
          <span>Открыть результат →</span>
        </button>
      )}
      <div hidden={tab !== "metadata"}>
        <Metadata />
      </div>
      <div hidden={tab !== "collections"}>
        <Collections />
      </div>
      <div hidden={tab !== "analysis"}>
        <Analysis
          onUse={(text, target) => {
            setPrompt(text);
            const preferred =
              target === "wan"
                ? models.find((m) => m.id === "alibaba/wan-3.0-prime") ||
                  models.find((m) => m.id.startsWith("alibaba/wan-"))
                : target === "minimax-motion"
                  ? models.find((m) => m.id === "minimax/hailuo-3")
                  : target === "minimax-image"
                    ? models.find((m) => m.id === "minimax/hailuo-3-max") ||
                      models.find((m) => m.id === "minimax/hailuo-3")
                    : null;
            if (preferred) setModelId(preferred.id);
            setTab("generate");
          }}
        />
      </div>
      <div hidden={tab !== "generate"}>
        <div className="workspace">
          <section className="composer">
            <div className="sectionTitle">
              <span className="eyebrow">НОВАЯ ГЕНЕРАЦИЯ</span>
              <span>01 / CREATE</span>
            </div>
            <h1>От идеи к кадру.</h1>
            <form onSubmit={submit}>
              <div className="modelPicker">
                <label>
                  Модель
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={loading || busy}
                  >
                    <option value="" disabled>
                      {loading ? "Загрузка моделей…" : "Выберите модель"}
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="modelGuideButton"
                  disabled={!model}
                  onClick={() => setGuideOpen(true)}
                >
                  Инструкция
                </button>
              </div>
              {model && (
                <p className="hint modelDescription">{model.description}</p>
              )}
              {modelId === "minimax/hailuo-3-max" &&
                models.some((m) => m.id === "minimax/hailuo-3") && (
                  <div className="motionSuggestion">
                    <span>Motion Control доступен в обычной MiniMax H3.</span>
                    <button
                      type="button"
                      onClick={() => setModelId("minimax/hailuo-3")}
                    >
                      Выбрать H3 →
                    </button>
                  </div>
                )}
              <label>
                Описание сцены
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  required
                  rows={5}
                  placeholder="Что происходит в кадре? Опишите движение, свет и работу камеры…"
                />
                <span
                  className={`hint promptCount ${
                    promptLength > promptLimit ? "overLimit" : ""
                  }`}
                >
                  {promptLength.toLocaleString("ru-RU")} /{" "}
                  {promptLimit.toLocaleString("ru-RU")} символов
                  {modelId === "alibaba/wan-3.0-prime"
                    ? " · лимит Wan 3.0 Prime"
                    : ""}
                </span>
              </label>
              {model && (
                <Inputs
                  key={modelId}
                  model={model}
                  config={config}
                  value={inputs}
                  onChange={setInputs}
                  onBusy={setUploading}
                  onTemplate={setPrompt}
                />
              )}
              <div className="parameters">
                {[
                  ["duration", "Длительность", model?.durations],
                  ["resolution", "Разрешение", model?.resolutions],
                  ["aspect_ratio", "Формат", model?.aspectRatios],
                ].map(
                  ([key, label, values]) =>
                    values?.length > 0 && (
                      <label key={key}>
                        {label}
                        <select
                          value={params[key] ?? ""}
                          onChange={(e) =>
                            setParams((p) => ({
                              ...p,
                              [key]:
                                key === "duration" && e.target.value
                                  ? Number(e.target.value)
                                  : e.target.value,
                            }))
                          }
                        >
                          <option value="">Авто</option>
                          {values.map((v) => (
                            <option key={v} value={v}>
                              {v}
                              {key === "duration" ? " сек" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ),
                )}
              </div>
              {model?.audio && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={params.generate_audio ?? true}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        generate_audio: e.target.checked,
                      }))
                    }
                  />
                  Создать звук
                </label>
              )}
              <p className="hint">
                {config.demo
                  ? "Тестовый сценарий. Видео не генерируется моделью."
                  : "Генерация расходует баланс OpenRouter. Стоимость зависит от модели и настроек."}
              </p>
              <div className="submitActions">
                <button
                  className="primary"
                  disabled={
                    !model ||
                    !prompt.trim() ||
                    promptLength > promptLimit ||
                    (inputs.referenceMode === "motion_control" &&
                      inputs.references?.filter((a) => a.kind === "video")
                        .length !== 1) ||
                    busy ||
                    uploading
                  }
                >
                  {busy ? "Отправляется…" : "Создать видео"} <span>↗</span>
                </button>
                {busy && requestKey.current && (
                  <button
                    type="button"
                    className="cancelSubmit"
                    disabled={cancelBusy === requestKey.current}
                    onClick={() => cancelJob(requestKey.current)}
                  >
                    {cancelBusy === requestKey.current
                      ? "Отменяем…"
                      : "Отменить отправку"}
                  </button>
                )}
              </div>
            </form>
            {error && (
              <div role="alert" className="error">
                {error}
                <button type="button" onClick={loadModels}>
                  Обновить каталог
                </button>
              </div>
            )}
          </section>
          <section className="viewer">
            <div className="sectionTitle">
              <span className="eyebrow">ПРОСМОТР</span>
              <span
                className={`viewerStatus ${job?.status || "idle"}`}
                aria-live="polite"
              >
                {job ? labels[job.status] : "Готов к работе"}
              </span>
            </div>
            <div className="screen">
              {job?.status === "completed" ? (
                <video
                  key={job.id}
                  src={`/api/jobs/${job.id}/content`}
                  controls
                  playsInline
                  onError={() =>
                    setError(
                      "Видео не удалось загрузить. Попробуйте скачать или проверьте срок хранения у провайдера.",
                    )
                  }
                />
              ) : (
                <div className="empty">
                  <div
                    className={
                      job &&
                      !["failed", "submission_unknown"].includes(job.status)
                        ? "frame pulse"
                        : "frame"
                    }
                  >
                    ▷
                  </div>
                  <h2>
                    {job ? labels[job.status] : "Здесь появится ваше видео"}
                  </h2>
                  <p>
                    {!job
                      ? "Выберите модель, опишите сцену и начните генерацию."
                      : job.status === "cancelled"
                        ? "Studio больше не проверяет это задание. Уже принятая OpenRouter генерация может продолжиться."
                        : activeStatuses.has(job.status)
                          ? "Результат появится автоматически. Можно закрыть вкладку: сервер продолжит проверку."
                          : "Откройте сообщение ниже, чтобы проверить подробности."}
                  </p>
                </div>
              )}
            </div>
            {job && (
              <div className="result">
                <div className="promptCard">
                  <div className="promptCardHeader">
                    <span>Промпт</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(job.prompt);
                          setCopiedPrompt(true);
                          setTimeout(() => setCopiedPrompt(false), 1800);
                        } catch {
                          setError("Не удалось скопировать промпт.");
                        }
                      }}
                    >
                      {copiedPrompt ? "Скопировано" : "Копировать"}
                    </button>
                  </div>
                  <pre tabIndex="0">{job.prompt}</pre>
                </div>
                {job.demo && (
                  <p className="hint">
                    Демонстрационный MP4: тестовая таблица, не результат
                    AI-генерации.
                  </p>
                )}
                {job.pollPaused && (
                  <div className="error">
                    Автопроверка приостановлена после 120 попыток.
                    <button
                      onClick={() =>
                        api(`/api/jobs/${job.id}/resume`, { method: "POST" })
                          .then(() => setError(""))
                          .catch((e) => setError(e.message))
                      }
                    >
                      Продолжить проверку
                    </button>
                  </div>
                )}
                <div className="resultMeta">
                  <span>{job.model}</span>
                  {job.usage?.cost != null && (
                    <span>${Number(job.usage.cost).toFixed(4)}</span>
                  )}
                  {job.status === "completed" && (
                    <a
                      className="download"
                      href={`/api/jobs/${job.id}/content?download=1`}
                    >
                      Скачать MP4 ↓
                    </a>
                  )}
                  {activeStatuses.has(job.status) && (
                    <button
                      type="button"
                      className="cancelJob"
                      disabled={cancelBusy === job.id}
                      onClick={() => cancelJob(job.id)}
                    >
                      {cancelBusy === job.id
                        ? "Останавливаем…"
                        : "Отменить отслеживание"}
                    </button>
                  )}
                </div>
                {job.cancellationNote && (
                  <p className="cancelNote">{job.cancellationNote}</p>
                )}
                {job.error && (
                  <p className="error" role="alert">
                    {job.error}
                  </p>
                )}
                {job.pollError && (
                  <p className="error">
                    {job.pollError} Проверка повторится автоматически.
                  </p>
                )}
              </div>
            )}
            <section className="history">
              <div className="sectionTitle">
                <h2>История</h2>
                <span>{jobs.length} генераций</span>
              </div>
              {!jobs.length ? (
                <p className="hint">Ваши генерации сохранятся здесь.</p>
              ) : (
                <div className="historyList" tabIndex="0">
                  {jobs.map((j) => (
                    <button
                      type="button"
                      className={`historyRow ${job?.id === j.id ? "selected" : ""}`}
                      key={j.id}
                      onClick={() => {
                        setSelected(j.id);
                        setCopiedPrompt(false);
                      }}
                    >
                      <span className="miniFrame">
                        {j.status === "completed" ? "▷" : "◷"}
                      </span>
                      <span className="historyText">
                        <strong>{j.prompt}</strong>
                        <small>
                          {j.model} ·{" "}
                          {new Date(j.createdAt).toLocaleString("ru")}
                        </small>
                      </span>
                      <span className={`status ${j.status}`}>
                        {labels[j.status] || j.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      </div>
      <footer>
        VIDEO STUDIO <span>Локальная история · Ключ хранится на сервере</span>
      </footer>
      {guideOpen && model && (
        <ModelGuide
          model={model}
          config={config}
          onClose={() => setGuideOpen(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
