import { useEffect } from "react";

const list = (values, suffix = "") =>
  values?.length ? values.map((v) => `${v}${suffix}`).join(", ") : "not published";

export function ModelGuide({ model, config, onClose }) {
  useEffect(() => {
    const key = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  const frames = [
    model.frames.includes("first_frame") && "first frame",
    model.frames.includes("last_frame") && "last frame",
  ].filter(Boolean);
  const refs = model.references.map((v) => (v === "video" ? "video" : "images"));
  return <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modelModal" role="dialog" aria-modal="true" aria-labelledby="model-guide-title">
      <div className="modalHeader">
        <div><span className="eyebrow">MODEL GUIDE</span><h2 id="model-guide-title">{model.name}</h2></div>
        <button type="button" className="modalClose" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modelRating">
        <span className="stars">{"★".repeat(model.stars || 0)}{"☆".repeat(3 - (model.stars || 0))}</span>
        <span>{model.stars ? "Studio rating based on quality and capabilities" : "This model has no Studio rating"}</span>
      </div>
      <p className="modelModalDescription">{model.description || "No model description has been published."}</p>
      <div className="capabilityGrid">
        <div><small>Duration</small><strong>{list(model.durations, " sec")}</strong></div>
        <div><small>Resolution</small><strong>{list(model.resolutions)}</strong></div>
        <div><small>Aspect ratios</small><strong>{list(model.aspectRatios)}</strong></div>
        <div><small>Audio</small><strong>{model.audio ? "supported" : "not listed"}</strong></div>
        <div><small>Frame controls</small><strong>{frames.length ? frames.join(", ") : "not listed"}</strong></div>
        <div><small>References</small><strong>{refs.length ? `${refs.join(", ")} · up to ${model.maxReferences ?? 4} in Studio` : "not confirmed"}</strong></div>
        <div><small>Motion control</small><strong>{model.motionControl === "video_to_video" ? "Motion Control / video-to-video" : model.motionControl === "video_reference" ? "via video reference" : "not listed"}</strong></div>
      </div>
      <h3>Limits</h3>
      <ul className="guideList">
        <li>Prompt: up to {model.promptMaxChars.toLocaleString("en-US")} characters.</li>
        <li>Studio uploads: PNG, JPEG, WebP, or MP4; up to 25 MB per file and up to four references.</li>
        <li>{config.videoUploadTransport === "cloudflare_worker" ? "Local MP4 files are stored temporarily in Cloudflare for 24 hours and made available to the model over HTTPS." : config.videoUploadsConfigured ? "Local MP4 files are available through a public media URL." : "Use a direct public HTTPS URL for the MP4."}</li>
        <li>Only capabilities confirmed by the catalog or documentation are shown. A specific provider route may impose additional limits.</li>
      </ul>
      {!!model.guidance.length && <><h3>Model notes</h3><ul className="guideList">{model.guidance.map((note) => <li key={note}>{note}</li>)}</ul></>}
      <div className="modalFooter"><a href={model.guidanceSource} target="_blank" rel="noreferrer">OpenRouter model page ↗</a><button type="button" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}
