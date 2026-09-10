import { useRef, useState } from "react";

export function MediaCard({ item, label, onRemove }) {
  const [failed, setFailed] = useState(false);
  const source = item.previewUrl || item.url;
  return <article className="mediaCard">
    <div className="mediaPreview">
      {!failed && source ? (item.kind === "video"
        ? <video src={source} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={item.name} />
        : <img src={source} alt={item.name || "Reference"} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />)
        : <span className="mediaFallback">{item.kind === "video" ? "▷ Video" : "▧ Image"}<small>Preview unavailable</small></span>}
    </div>
    <div className="mediaDetails"><small>{label} · {item.kind === "video" ? "Video" : "Image"}</small>
      <strong title={item.name}>{item.name}</strong>
      <span>{item.size != null ? `${(item.size / 1024 / 1024).toFixed(2)} MB` : "Remote URL"}</span>
      <button type="button" onClick={onRemove} aria-label={`Delete ${item.name}`}>Delete</button>
    </div>
  </article>;
}

export function FileUploader({ kinds, maxFiles, kindLimits = {}, videoEnabled, onUploaded, onBusy, title = "Add files" }) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [pickerVersion, setPickerVersion] = useState(0);
  const inputRef = useRef(null);
  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || busy) return;
    const states = files.map((f) => ({ name: f.name, status: "Queued" }));
    setRows([...states]); setBusy(true); onBusy(true);
    const uploaded = [];
    try {
      for (const [i, file] of files.entries()) {
        try {
          if (uploaded.length >= maxFiles) throw new Error(`Attachment limit: you can add ${maxFiles}.`);
          const kind = file.type.startsWith("video/") ? "video" : "image";
          if (!kinds.includes(kind)) throw new Error("This file type is not available in the selected mode.");
          if (uploaded.filter((a) => a.kind === kind).length >= (kindLimits[kind] ?? Infinity)) throw new Error("This input already has a file. Remove it before adding another.");
          if (kind === "video" && !videoEnabled) throw new Error("MP4 uploads require a public HTTPS URL; video upload is not configured.");
          if (file.size > 25 * 1024 * 1024) throw new Error("The file is larger than 25 MB.");
          states[i] = { name: file.name, status: "Uploading…" }; setRows([...states]);
          const form = new FormData(); form.append("file", file);
          const response = await fetch("/api/uploads", { method: "POST", body: form });
          const asset = await response.json();
          if (!response.ok) throw new Error(asset.error || "Upload failed.");
          if (!kinds.includes(asset.kind)) throw new Error("The detected file format is not supported.");
          uploaded.push({ assetId: asset.id, name: asset.name, kind: asset.kind, size: asset.size, previewUrl: asset.previewUrl });
          states[i] = { name: file.name, status: "Added" };
        } catch (e) { states[i] = { name: file.name, status: e.message, error: true }; }
        setRows([...states]);
      }
      if (uploaded.length) onUploaded(uploaded);
    } finally {
      setBusy(false);
      onBusy(false);
      // Recreate the native picker after every selection. This lets the user
      // choose the same filename again and prevents browsers from retaining a
      // stale selection after React has rendered new media cards.
      setPickerVersion((v) => v + 1);
    }
  }
  const canPick = !busy && maxFiles > 0;
  return <div className="uploadPanel">
    <div className="fileInput">
      <strong>{busy ? "Uploading files…" : title}</strong>
      <span>Files remaining: {maxFiles} · up to 25 MB each</span>
      <button type="button" className="pickFilesButton" disabled={!canPick}
        onClick={() => { inputRef.current?.click(); }}>
        {maxFiles > 1 ? "＋ Add files" : "＋ Add file"}
      </button>
      <input key={pickerVersion} ref={inputRef} className="nativeFilePicker" type="file"
        multiple={maxFiles > 1} disabled={!canPick} aria-label={title}
        accept={kinds.flatMap((k) => k === "video" ? ["video/mp4"] : ["image/png", "image/jpeg", "image/webp"]).join(",")}
        onChange={upload} />
    </div>
    {!!rows.length && <ul className="uploadStatus" aria-live="polite">{rows.map((r, i) => <li key={i} className={r.error ? "uploadFailed" : ""}><span title={r.name}>{r.name}</span><small>{r.status}</small></li>)}</ul>}
  </div>;
}
