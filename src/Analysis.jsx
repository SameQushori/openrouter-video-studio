import { useState, useEffect, useRef } from "react";
import seedanceTemplate from "./analysis-prompt.txt?raw";
import universalTemplate from "./analysis-universal-prompt.txt?raw";
import { extractGenerationPrompts } from "./analysis-result.js";
const status = {
  analyzing: "Gemini is analyzing…",
  completed: "Completed",
  failed: "Failed",
  submission_unknown: "Check usage before retrying",
};
async function api(url, options) {
  const r = await fetch(url, options);
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Request failed");
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
      setError("Maximum 25 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const a = await api("/api/uploads", { method: "POST", body: form });
      if (a.kind !== "video") throw new Error("An MP4 file is required.");
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
      return "Pricing unavailable";
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
          <span className="eyebrow">VIDEO → JSON PROMPT</span>
        </div>
        <h1>Analyze a reference.</h1>
        <form onSubmit={submit}>
          <label>
            Gemini
            <select
              value={modelId}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            >
              {!models.length && <option>Loading models…</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Analysis quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={busy}
            >
              <option value="max">Maximum · more time and tokens</option>
              <option value="standard">Standard · lower cost</option>
            </select>
          </label>
          <label>
            Source video · MP4 up to 25 MB
            <input
              type="file"
              accept="video/mp4"
              onChange={upload}
              disabled={busy}
            />
          </label>
          <div className="tiktokImport">
            <label>
              Or a TikTok video URL
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
                Import for analysis
              </button>
              <button
                type="button"
                onClick={() => importTikTok(true)}
                disabled={busy || !tiktok.trim()}
              >
                Download MP4
              </button>
            </div>
            <small>
              Public videos are supported. TikTok may restrict downloads by
              region or require an account.
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
            <span>Analysis prompt</span>
            <div className="templateActions">
              <button type="button" onClick={() => setPrompt(universalTemplate)}>
                Universal · Wan + H3
              </button>
              <button type="button" onClick={() => setPrompt(seedanceTemplate)}>
                Legacy Seedance
              </button>
            </div>
          </div>
          <textarea
            aria-label="Analysis prompt"
            rows={12}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={20000}
            required
          />
          <p className="hint">
            The universal template produces one detailed transcription plus
            separate prompts for Wan, MiniMax H3 with a first frame, and H3
            Motion. Unclear speech is marked as [inaudible]; review the result
            before paid generation.
          </p>
          <div className="estimate">
            <strong>Estimated cost per analysis</strong>
            <div>
              {[5, 10, 15].map((s) => (
                <p key={s}>
                  {s} sec <b>{estimate(s)}</b>
                </p>
              ))}
            </div>
            <small>
              Estimate: 100–300 input tokens/sec of video, prompt ≈ characters/4,
              and 3,000–12,000 output tokens including reasoning. This is not a
              spending cap; detail level and video processing affect the total.
            </small>
          </div>
          <button
            className="primary"
            disabled={busy || active || !model || !asset || !prompt.trim()}
          >
            {busy
              ? "Please wait…"
              : active
                ? "Analyzing…"
                : "Analyze · paid request"}
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
          <span className="eyebrow">GEMINI RESULT</span>
          <span aria-live="polite">
            {job ? status[job.status] : "No analysis"}
          </span>
        </div>
        {!job ? (
          <div className="empty">
            <h2>The JSON result will appear here</h2>
            <p>Upload a video and select Analyze. No public URL is required.</p>
          </div>
        ) : (
          <>
            <p className="hint">
              {job.model} · {new Date(job.createdAt).toLocaleString("en-US")}
            </p>
            {job.error && <p className="error">{job.error}</p>}
            {job.warning && <p className="error">{job.warning}</p>}
            {job.result && (
              <>
                <textarea
                  className="jsonResult"
                  aria-label="Analysis result"
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
                          "Could not copy the result. Select and copy it manually.",
                        );
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  {generated.wan && (
                    <button type="button" onClick={() => onUse(generated.wan, "wan")}>
                      Use in Wan →
                    </button>
                  )}
                  {generated.minimaxImage && (
                    <button
                      type="button"
                      onClick={() => onUse(generated.minimaxImage, "minimax-image")}
                    >
                      Use in H3 · frame →
                    </button>
                  )}
                  {generated.minimaxMotion && (
                    <button
                      type="button"
                      onClick={() => onUse(generated.minimaxMotion, "minimax-motion")}
                    >
                      Use in H3 · Motion →
                    </button>
                  )}
                  {!generated.wan && !generated.minimaxImage && (
                    <button
                      type="button"
                      disabled={!job.jsonValid || job.result.length > 10000}
                      onClick={() => onUse(job.result)}
                    >
                      Use in video generator →
                    </button>
                  )}
                </div>
                {job.result.length > 10000 && (
                  <p className="hint">
                    The JSON exceeds the generator's 10,000-character prompt
                    limit. Shorten it before transferring.
                  </p>
                )}
              </>
            )}
            {job.usage && (
              <p className="hint">
                Cost:{" "}
                {typeof job.usage.cost === "number"
                  ? `$${job.usage.cost.toFixed(5)}`
                  : "not returned by the API"}{" "}
                · Input: {job.usage.prompt_tokens ?? "—"} tokens · Output:{" "}
                {job.usage.completion_tokens ?? "—"} · Reasoning:{" "}
                {job.usage.completion_tokens_details?.reasoning_tokens ?? "—"}
              </p>
            )}
          </>
        )}
        <div className="history">
          <h2>Analysis history</h2>
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
                  <small>{new Date(j.createdAt).toLocaleString("en-US")}</small>
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
