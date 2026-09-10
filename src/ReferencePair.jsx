import { useState } from "react";
import { FileUploader, MediaCard } from "./MediaFiles.jsx";

const template = `Use reference image 1 for the adult character's identity, clothing, and background. Use reference video 2 as guidance for body movements, gestures, timing, and facial expressions only. Do not copy the character or environment from the video. Preserve the image character consistently throughout the clip. Use natural posture, realistic balance, subtle facial expressions and believable movement. Keep the camera static and match the lighting and perspective of the image. Avoid flicker, warping and identity drift.`;

export function ReferencePair({ value, onChange, onBusy, config, onTemplate }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState({ image: "", video: "" });
  const items = value.references || [];
  function replace(kind, item) {
    const next = items.filter((a) => a.kind !== kind);
    if (item) next.push(item);
    next.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1));
    onChange({ referenceMode: "motion_control", references: next });
  }
  async function upload(event, kind) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > 25 * 1024 * 1024) { setError("Maximum 25 MB per file."); return; }
    setBusy(true); onBusy(true);
    try {
      const data = new FormData(); data.append("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: data });
      const asset = await response.json();
      if (!response.ok) throw new Error(asset.error || "Upload failed.");
      if (asset.kind !== kind) throw new Error("The file type does not match this input.");
      replace(kind, { assetId: asset.id, kind, name: asset.name, size: asset.size, previewUrl: asset.previewUrl });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy(false); }
  }
  return <fieldset className="inputs" disabled={busy}>
    <p className="hint"><strong>{config.motionControl === "video_to_video" ? "Motion Control / video-to-video." : "Video-reference motion control."}</strong> A motion video is required. A character image can be added to guide appearance and environment. It is not treated as an exact first frame; transfer strength depends on the model and provider.</p>
    <FileUploader kinds={["image", "video"]} maxFiles={2 - items.length}
      kindLimits={{ image: items.some((a) => a.kind === "image") ? 0 : 1, video: items.some((a) => a.kind === "video") ? 0 : 1 }}
      videoEnabled={config.videoUploadsConfigured} title="Select a motion video and character image"
      onBusy={(next) => { setBusy(next); onBusy(next); }}
      onUploaded={(added) => onChange({ referenceMode: "motion_control", references: [...items, ...added].sort((a, b) => a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1) })} />
    {[["image", "Character image · optional"], ["video", "Motion video · required"]].map(([kind, label]) => {
      const item = items.find((a) => a.kind === kind);
      const canUpload = kind === "image" || config.videoUploadsConfigured;
      return <div className="referenceSlot" key={kind}>
        <label>{label}
          <input type="file" aria-label={label} disabled={!canUpload}
            accept={kind === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4"}
            onChange={(e) => upload(e, kind)} />
        </label>
        {!canUpload && <p className="hint">Local MP4 upload is unavailable. Paste a direct public HTTPS video URL.</p>}
        {kind === "video" && canUpload && config.videoUploadTransport === "cloudflare_worker" && <p className="hint">The MP4 will be stored temporarily in Cloudflare for 24 hours and sent to the model over HTTPS.</p>}
        <div className="urlInput">
          <input type="url" aria-label={`HTTPS URL: ${label}`} placeholder="https://…"
            value={urls[kind]} onChange={(e) => setUrls({ ...urls, [kind]: e.target.value })} />
          <button type="button" disabled={!urls[kind]} onClick={() => {
            try {
              const url = new URL(urls[kind]);
              if (url.protocol !== "https:" || url.username || url.password) throw new Error();
              replace(kind, { kind, url: url.href, name: url.href });
              setUrls({ ...urls, [kind]: "" }); setError("");
            } catch { setError("Enter a direct HTTPS URL without credentials."); }
          }}>Add</button>
        </div>
        {item ? <MediaCard key={item.assetId || item.url} item={item} label={label} onRemove={() => replace(kind, null)} /> : <p className="attachmentEmpty">No file added</p>}
      </div>;
    })}
    <p className="hint">A video is required; the character image is optional. Duration and file-size limits depend on the model and provider.</p>
    <div className="promptToolbar"><button type="button" onClick={() => onTemplate(template)}>Insert motion template (replaces prompt)</button></div>
    {error && <p className="error" role="alert">{error}</p>}
  </fieldset>;
}
