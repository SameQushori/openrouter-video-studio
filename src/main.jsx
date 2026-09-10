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
      "Cannot connect to the local studio. Start the server and refresh the page. The request will not be retried automatically.",
    );
  }
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Request failed");
  return body;
}
const labels = {
  submitting: "Submitting",
  pending: "Queued",
  in_progress: "Generating",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  submission_unknown: "Check OpenRouter",
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
        ? " · no Motion Control"
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
      document.title = "● Video ready · Video Studio";
    else if (unseenEvent) document.title = "● Action required · Video Studio";
    else if (hasActiveJob) document.title = "⏳ Generating · Video Studio";
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
          {config.demo ? "● DEMO · no charges" : "● Local studio"}
        </span>
      </header>
      <Account />
      <nav className="tabs mainTabs" aria-label="Studio sections">
        <button
          aria-pressed={tab === "generate"}
          className={tab === "generate" ? "active" : ""}
          onClick={() => setTab("generate")}
        >
          Video generation
        </button>
        <button
          aria-pressed={tab === "analysis"}
          className={tab === "analysis" ? "active" : ""}
          onClick={() => setTab("analysis")}
        >
          Video analysis · Gemini
        </button>
        <button
          aria-pressed={tab === "collections"}
          className={tab === "collections" ? "active" : ""}
          onClick={() => setTab("collections")}
        >
          Collections
        </button>
        <button
          aria-pressed={tab === "metadata"}
          className={tab === "metadata" ? "active" : ""}
          onClick={() => setTab("metadata")}
        >
          EXIF metadata
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
              ? "Video ready"
              : "Generation needs attention"}
          </strong>
          <span>Open result →</span>
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
              <span className="eyebrow">NEW GENERATION</span>
              <span>01 / CREATE</span>
            </div>
            <h1>From idea to frame.</h1>
            <form onSubmit={submit}>
              <div className="modelPicker">
                <label>
                  Model
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={loading || busy}
                  >
                    <option value="" disabled>
                      {loading ? "Loading models…" : "Select a model"}
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
                  Model guide
                </button>
              </div>
              {model && (
                <p className="hint modelDescription">{model.description}</p>
              )}
              {modelId === "minimax/hailuo-3-max" &&
                models.some((m) => m.id === "minimax/hailuo-3") && (
                  <div className="motionSuggestion">
                    <span>Motion Control is available in the standard MiniMax H3 model.</span>
                    <button
                      type="button"
                      onClick={() => setModelId("minimax/hailuo-3")}
                    >
                      Select H3 →
                    </button>
                  </div>
                )}
              <label>
                Scene description
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  required
                  rows={5}
                  placeholder="What happens in the shot? Describe motion, lighting, and camera work…"
                />
                <span
                  className={`hint promptCount ${
                    promptLength > promptLimit ? "overLimit" : ""
                  }`}
                >
                  {promptLength.toLocaleString("en-US")} /{" "}
                  {promptLimit.toLocaleString("en-US")} characters
                  {modelId === "alibaba/wan-3.0-prime"
                    ? " · Wan 3.0 Prime limit"
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
                  ["duration", "Duration", model?.durations],
                  ["resolution", "Resolution", model?.resolutions],
                  ["aspect_ratio", "Aspect ratio", model?.aspectRatios],
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
                          <option value="">Auto</option>
                          {values.map((v) => (
                            <option key={v} value={v}>
                              {v}
                              {key === "duration" ? " sec" : ""}
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
                  Generate audio
                </label>
              )}
              <p className="hint">
                {config.demo
                  ? "Demo scenario. No model-generated video is created."
                  : "Generation uses your OpenRouter balance. Cost depends on the model and settings."}
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
                  {busy ? "Submitting…" : "Generate video"} <span>↗</span>
                </button>
                {busy && requestKey.current && (
                  <button
                    type="button"
                    className="cancelSubmit"
                    disabled={cancelBusy === requestKey.current}
                    onClick={() => cancelJob(requestKey.current)}
                  >
                    {cancelBusy === requestKey.current
                      ? "Cancelling…"
                      : "Cancel submission"}
                  </button>
                )}
              </div>
            </form>
            {error && (
              <div role="alert" className="error">
                {error}
                <button type="button" onClick={loadModels}>
                  Reload catalog
                </button>
              </div>
            )}
          </section>
          <section className="viewer">
            <div className="sectionTitle">
              <span className="eyebrow">PREVIEW</span>
              <span
                className={`viewerStatus ${job?.status || "idle"}`}
                aria-live="polite"
              >
                {job ? labels[job.status] : "Ready"}
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
                      "The video could not be loaded. Try downloading it or check the provider retention period.",
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
                    {job ? labels[job.status] : "Your video will appear here"}
                  </h2>
                  <p>
                    {!job
                      ? "Select a model, describe the scene, and start generation."
                      : job.status === "cancelled"
                        ? "The studio is no longer polling this job. A generation already accepted by OpenRouter may continue."
                        : activeStatuses.has(job.status)
                          ? "The result will appear automatically. You can close this tab; the server will keep polling."
                          : "Open the message below for details."}
                  </p>
                </div>
              )}
            </div>
            {job && (
              <div className="result">
                <div className="promptCard">
                  <div className="promptCardHeader">
                    <span>Prompt</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(job.prompt);
                          setCopiedPrompt(true);
                          setTimeout(() => setCopiedPrompt(false), 1800);
                        } catch {
                          setError("Could not copy the prompt.");
                        }
                      }}
                    >
                      {copiedPrompt ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre tabIndex="0">{job.prompt}</pre>
                </div>
                {job.demo && (
                  <p className="hint">
                    Demo MP4: a test card, not an AI-generated result.
                  </p>
                )}
                {job.pollPaused && (
                  <div className="error">
                    Automatic polling paused after 120 attempts.
                    <button
                      onClick={() =>
                        api(`/api/jobs/${job.id}/resume`, { method: "POST" })
                          .then(() => setError(""))
                          .catch((e) => setError(e.message))
                      }
                    >
                      Resume polling
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
                      Download MP4 ↓
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
                        ? "Stopping…"
                        : "Stop polling"}
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
                    {job.pollError} Polling will retry automatically.
                  </p>
                )}
              </div>
            )}
            <section className="history">
              <div className="sectionTitle">
                <h2>History</h2>
                <span>{jobs.length} generations</span>
              </div>
              {!jobs.length ? (
                <p className="hint">Your generations will be saved here.</p>
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
                          {new Date(j.createdAt).toLocaleString("en-US")}
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
        VIDEO STUDIO <span>Local history · API key stays on the server</span>
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
