import { useState } from "react";
import { ReferencePair } from "./ReferencePair.jsx";
import { FileUploader, MediaCard } from "./MediaFiles.jsx";
export function Inputs({ model, config, value, onChange, onBusy, onTemplate }) {
  const [mode, setMode] = useState("text"), [url, setUrl] = useState(""), [kind, setKind] = useState("image"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const items = mode === "frame" ? (value.firstFrame ? [value.firstFrame] : []) : value.references || [];
  const limit = mode === "frame" ? 1 : (model.maxReferences ?? 4);
  const kinds = mode === "frame" ? ["image"] : model.references;
  function changeMode(next) {
    setMode(next); setUrl(""); setError("");
    setKind(next === "frame" ? "image" : model.references[0] || "image");
    onChange((previous) => {
      if (next === "frame") return { ...previous, references: [], referenceMode: undefined };
      if (next === "references") return { ...previous, firstFrame: undefined, referenceMode: undefined };
      if (next === "motion") return { ...previous, firstFrame: undefined, referenceMode: "motion_control", references: [] };
      return previous;
    });
  }
  function add(added) {
    onChange((previous) => mode === "frame"
      ? { ...previous, firstFrame: added[0], references: [], referenceMode: undefined }
      : { ...previous, firstFrame: undefined, references: [...(previous.references || []), ...added], referenceMode: undefined });
  }
  function uploading(next) { setBusy(next); onBusy(next); }
  return <fieldset className="inputs" disabled={busy}>
    <legend>Source material</legend>
    <div className="tabs inputTabs">
      {[["text", "Text"], ...(model.frames.includes("first_frame") ? [["frame", "First frame"]] : []),
        ...(model.references.length ? [["references", "Multiple files"]] : []),
        ...(model.motionControl ? [["motion", model.motionControl === "video_to_video" ? "Motion Control" : "Motion control"]] : [])].map(([key, label]) =>
        <button type="button" key={key} aria-pressed={mode === key} className={mode === key ? "active" : ""} onClick={() => changeMode(key)}>{label}</button>)}
    </div>
    {mode === "motion" && <ReferencePair value={value} onChange={onChange} config={{ ...config, motionControl: model.motionControl }} onBusy={uploading} onTemplate={onTemplate} />}
    {mode !== "text" && mode !== "motion" && <>
      <div className="attachmentHeading"><strong>{mode === "frame" ? "First frame" : "References"}</strong><span>{items.length} / {limit} files</span></div>
      <FileUploader key={mode} kinds={kinds} maxFiles={Math.max(0, limit - items.length)} videoEnabled={config.videoUploadsConfigured} onUploaded={add} onBusy={uploading} />
      <details className="attachmentLinks"><summary>Add by HTTPS URL</summary>
        <div className="urlInput">
          {mode === "references" && <select aria-label="Input mode" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{k === "video" ? "Video" : "Image"}</option>)}</select>}
          <input aria-label="Direct HTTPS asset URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <button type="button" disabled={!url || items.length >= limit} onClick={() => {
            try {
              const parsed = new URL(url);
              if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
              add([{ url: parsed.href, kind: mode === "frame" ? "image" : kind, name: parsed.href }]); setUrl(""); setError("");
            } catch { setError("Enter a direct HTTPS URL without credentials."); }
          }}>Add</button>
        </div>
      </details>
      <div className="mediaGrid">{items.map((item, i) => <MediaCard key={String(item.assetId || item.url) + i} item={item} label={"Reference " + (i + 1)} onRemove={() => onChange(mode === "frame" ? {} : { references: items.filter((_, n) => n !== i) })} />)}</div>
      {!items.length && <p className="attachmentEmpty">Attachments will appear here with an individual preview for each file.</p>}
      <p className="hint">Images can be uploaded directly.{kinds.includes("video") && (config.videoUploadTransport === "cloudflare_worker" ? " MP4 files are stored temporarily in Cloudflare for 24 hours and sent to the model over HTTPS." : " MP4 upload is available through a public media URL.")} Provider limits may be stricter.</p>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </fieldset>;
}
