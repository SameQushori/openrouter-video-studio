import { useEffect, useState } from "react";

async function send(form) {
  const response = await fetch("/api/metadata/apply", {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not process metadata.");
  return body;
}

const isVideoFile = (file) =>
  Boolean(file) &&
  (file.type === "video/mp4" || /\.mp4$/i.test(file.name || ""));

function FilePreview({ file, onClear }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return setUrl("");
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!file) return null;
  return (
    <div className="metadataFile">
      {file.type.startsWith("video/") ? (
        <video src={url} muted controls />
      ) : file.type.startsWith("image/") ? (
        <img src={url} alt="Reference preview" />
      ) : (
        <div className="metadataFallback">Preview unavailable</div>
      )}
      <div>
        <strong>{file.name}</strong>
        <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        {onClear && (
          <button type="button" onClick={onClear}>
            Remove file
          </button>
        )}
      </div>
    </div>
  );
}

function MetadataList({ title, data }) {
  const labels = {
    camera: "Camera",
    capturedAt: "Capture date",
    software: "Software",
    author: "Author",
    description: "Description",
    location: "Location",
  };
  const rows = Array.isArray(data?.fields)
    ? data.fields.map(({ key, label, value }) => [key, value, label])
    : Object.entries(data || {}).filter(
        ([key, value]) =>
          value && !["fields", "fieldCount", "hasAiMarker"].includes(key),
      );
  return (
    <div className="metadataList">
      <h3>{title}</h3>
      {Number.isInteger(data?.fieldCount) && (
        <span className="metadataCount">Useful fields: {data.fieldCount}</span>
      )}
      {rows.length ? (
        rows.map(([key, value, label]) => (
          <p key={key}>
            <span>{label || labels[key] || key}</span>
            <strong>{value}</strong>
          </p>
        ))
      ) : (
        <p className="hint">No compatible tags found.</p>
      )}
    </div>
  );
}

function MediaReport({ report }) {
  if (!report) return null;
  return (
    <div className="mediaReport">
      <div>
        <span>C2PA / Content Credentials</span>
        <strong>
          {report.before.hasC2pa ? "Present" : "Not found"} →{" "}
          {report.after.hasC2pa ? "Still present" : "Removed / absent"}
        </strong>
      </div>
      {report.kind !== "image" && (
        <div>
          <span>Audio track</span>
          <strong>
            {report.before.hasAudio ? "Present" : "Absent"} →{" "}
            {report.after.hasAudio ? "Preserved" : "Absent"}
          </strong>
        </div>
      )}
    </div>
  );
}

export function Metadata() {
  const [generated, setGenerated] = useState(null);
  const [reference, setReference] = useState(null);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [clearExisting, setClearExisting] = useState(true);
  const [removeC2pa, setRemoveC2pa] = useState(true);
  const [removeSound, setRemoveSound] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canProcess =
    generated && (reference || clearExisting || removeC2pa || removeSound);
  const generatedIsVideo = isVideoFile(generated);

  async function submit(event) {
    event.preventDefault();
    if (!canProcess || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("generated", generated);
      if (reference) form.append("reference", reference);
      form.append("includeLocation", String(includeLocation));
      form.append("clearExisting", String(clearExisting));
      form.append("removeC2pa", String(removeC2pa));
      form.append("removeSound", String(removeSound));
      setResult(await send(form));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace metadataWorkspace">
      <section>
        <div className="sectionTitle">
          <span className="eyebrow">EXIF / XMP / QUICKTIME</span>
          <span>LOCAL</span>
        </div>
        <h1>Clean or transfer metadata.</h1>
        <p className="hint">
          Remove EXIF and C2PA from videos and photos. The original remains
          unchanged: Studio creates a separate copy. A reference is needed only
          when transferring tags.
        </p>
        <div className="metadataMode" aria-live="polite">
          <span>{reference ? "Transfer mode" : "Cleanup mode"}</span>
          <strong>
            {reference ? "Reference will be used" : "No reference required"}
          </strong>
        </div>
        <form onSubmit={submit}>
          <label className="metadataPicker">
            1. Video or image · up to 50 MB
            <input
              type="file"
              accept="video/mp4,image/jpeg,image/png,image/webp,image/heic,image/avif,image/gif,image/tiff"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setGenerated(file);
                if (!isVideoFile(file)) setRemoveSound(false);
              }}
              disabled={busy}
            />
          </label>
          <FilePreview file={generated} onClear={() => setGenerated(null)} />
          <label className="metadataPicker">
            2. Metadata reference · optional
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/avif,image/gif,image/tiff,video/mp4"
              onChange={(e) => setReference(e.target.files?.[0] || null)}
              disabled={busy}
            />
          </label>
          <FilePreview file={reference} onClear={() => setReference(null)} />
          {!reference && (
            <p className="optionalFileHint">
              Leave this empty for a basic EXIF/C2PA cleanup.
            </p>
          )}
          <div className="metadataOptions">
            <label className="locationOption">
              <input
                type="checkbox"
                checked={removeC2pa}
                onChange={(e) => setRemoveC2pa(e.target.checked)}
                disabled={busy}
              />
              Delete C2PA / Content Credentials
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={removeSound}
                onChange={(e) => setRemoveSound(e.target.checked)}
                disabled={busy || !generatedIsVideo}
              />
              Remove the video's audio track
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                disabled={busy}
              />
              Remove EXIF, service metadata, and generator markers
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={includeLocation}
                onChange={(e) => setIncludeLocation(e.target.checked)}
                disabled={busy || !reference}
              />
              Copy GPS location when available
            </label>
          </div>
          <p className="hint">
            {reference
              ? "Existing writable tags are cleared, then compatible reference fields are copied."
              : "A cleaned copy will be created without importing metadata from another file."}{" "}
            Image content and media stream settings are preserved without re-encoding.
          </p>
          <button className="primary" disabled={busy || !canProcess}>
            {busy
              ? "Processing file…"
              : reference
                ? "Create copy with metadata"
                : "Clean EXIF and C2PA"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
      <section>
        <div className="sectionTitle">
          <span className="eyebrow">RESULT</span>
          <span>{result ? "Completed" : "Waiting"}</span>
        </div>
        {result ? (
          <>
            {result.kind === "image" ? (
              <img
                className="metadataResult"
                src={result.previewUrl}
                alt="Cleaned image"
              />
            ) : (
              <video
                className="metadataResult"
                src={result.previewUrl}
                controls
              />
            )}
            <MediaReport report={result.mediaReport} />
            {result.sourceMetadata && result.sourceMetadata.fieldCount <= 1 && (
              <p className="metadataNotice">
                Only {result.sourceMetadata.fieldCount || 0} useful fields were
                found in the reference. Social networks and messengers often
                strip camera data; use the original file from the phone or
                camera for a fuller transfer.
              </p>
            )}
            <div className="metadataCompare">
              <MetadataList title="Before cleanup" data={result.previousMetadata} />
              {result.sourceMetadata && (
                <MetadataList title="In reference" data={result.sourceMetadata} />
              )}
              <MetadataList
                title={`In output ${result.ext?.toUpperCase() || "file"}`}
                data={result.outputMetadata}
              />
            </div>
            <a className="download metadataDownload" href={result.downloadUrl}>
              Download processed {result.ext?.toUpperCase() || "file"} ↓
            </a>
          </>
        ) : (
          <div className="empty">
            <h2>The processed copy will appear here</h2>
            <p>
              Add an MP4, JPEG, PNG, WebP, HEIC, AVIF, GIF, or TIFF file. A
              reference is required only for metadata transfer.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
