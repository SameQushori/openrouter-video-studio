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
    if (file.size > 25 * 1024 * 1024) { setError("Максимум 25 МБ на файл."); return; }
    setBusy(true); onBusy(true);
    try {
      const data = new FormData(); data.append("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: data });
      const asset = await response.json();
      if (!response.ok) throw new Error(asset.error || "Ошибка загрузки.");
      if (asset.kind !== kind) throw new Error("Тип файла не соответствует выбранному полю.");
      replace(kind, { assetId: asset.id, kind, name: asset.name, size: asset.size, previewUrl: asset.previewUrl });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy(false); }
  }
  return <fieldset className="inputs" disabled={busy}>
    <p className="hint"><strong>{config.motionControl === "video_to_video" ? "Motion Control / video-to-video." : "Управление через видеореференс."}</strong> Видео движения обязательно. Изображение персонажа можно добавить для внешности и окружения. Это не точный первый кадр; сила переноса зависит от модели и провайдера.</p>
    <FileUploader kinds={["image", "video"]} maxFiles={2 - items.length}
      kindLimits={{ image: items.some((a) => a.kind === "image") ? 0 : 1, video: items.some((a) => a.kind === "video") ? 0 : 1 }}
      videoEnabled={config.videoUploadsConfigured} title="Выбрать видео движения и изображение"
      onBusy={(next) => { setBusy(next); onBusy(next); }}
      onUploaded={(added) => onChange({ referenceMode: "motion_control", references: [...items, ...added].sort((a, b) => a.kind === b.kind ? 0 : a.kind === "image" ? -1 : 1) })} />
    {[["image", "Изображение персонажа · необязательно"], ["video", "Видео движений · обязательно"]].map(([kind, label]) => {
      const item = items.find((a) => a.kind === kind);
      const canUpload = kind === "image" || config.videoUploadsConfigured;
      return <div className="referenceSlot" key={kind}>
        <label>{label}
          <input type="file" aria-label={label} disabled={!canUpload}
            accept={kind === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4"}
            onChange={(e) => upload(e, kind)} />
        </label>
        {!canUpload && <p className="hint">Локальная загрузка MP4 недоступна. Вставьте прямую публичную HTTPS-ссылку на видео.</p>}
        {kind === "video" && canUpload && config.videoUploadTransport === "cloudflare_worker" && <p className="hint">MP4 будет временно сохранён в Cloudflare на 24 часа и передан модели по HTTPS.</p>}
        <div className="urlInput">
          <input type="url" aria-label={`HTTPS-ссылка: ${label}`} placeholder="https://…"
            value={urls[kind]} onChange={(e) => setUrls({ ...urls, [kind]: e.target.value })} />
          <button type="button" disabled={!urls[kind]} onClick={() => {
            try {
              const url = new URL(urls[kind]);
              if (url.protocol !== "https:" || url.username || url.password) throw new Error();
              replace(kind, { kind, url: url.href, name: url.href });
              setUrls({ ...urls, [kind]: "" }); setError("");
            } catch { setError("Нужна прямая HTTPS-ссылка без пароля."); }
          }}>Добавить</button>
        </div>
        {item ? <MediaCard key={item.assetId || item.url} item={item} label={label} onRemove={() => replace(kind, null)} /> : <p className="attachmentEmpty">Файл ещё не добавлен</p>}
      </div>;
    })}
    <p className="hint">Видео обязательно, изображение персонажа опционально. Ограничения длительности и размера видео зависят от модели и провайдера.</p>
    <div className="promptToolbar"><button type="button" onClick={() => onTemplate(template)}>Вставить шаблон движений (заменяет промпт)</button></div>
    {error && <p className="error" role="alert">{error}</p>}
  </fieldset>;
}
