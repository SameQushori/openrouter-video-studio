import { useRef, useState } from "react";

export function MediaCard({ item, label, onRemove }) {
  const [failed, setFailed] = useState(false);
  const source = item.previewUrl || item.url;
  return <article className="mediaCard">
    <div className="mediaPreview">
      {!failed && source ? (item.kind === "video"
        ? <video src={source} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={item.name} />
        : <img src={source} alt={item.name || "Референс"} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />)
        : <span className="mediaFallback">{item.kind === "video" ? "▷ Видео" : "▧ Изображение"}<small>Предпросмотр недоступен</small></span>}
    </div>
    <div className="mediaDetails"><small>{label} · {item.kind === "video" ? "Видео" : "Изображение"}</small>
      <strong title={item.name}>{item.name}</strong>
      <span>{item.size != null ? `${(item.size / 1024 / 1024).toFixed(2)} МБ` : "По ссылке"}</span>
      <button type="button" onClick={onRemove} aria-label={`Удалить ${item.name}`}>Удалить</button>
    </div>
  </article>;
}

export function FileUploader({ kinds, maxFiles, kindLimits = {}, videoEnabled, onUploaded, onBusy, title = "Добавить файлы" }) {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [pickerVersion, setPickerVersion] = useState(0);
  const inputRef = useRef(null);
  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || busy) return;
    const states = files.map((f) => ({ name: f.name, status: "В очереди" }));
    setRows([...states]); setBusy(true); onBusy(true);
    const uploaded = [];
    try {
      for (const [i, file] of files.entries()) {
        try {
          if (uploaded.length >= maxFiles) throw new Error(`Лимит вложений: можно добавить ещё ${maxFiles}.`);
          const kind = file.type.startsWith("video/") ? "video" : "image";
          if (!kinds.includes(kind)) throw new Error("Этот тип файла недоступен в выбранном режиме.");
          if (uploaded.filter((a) => a.kind === kind).length >= (kindLimits[kind] ?? Infinity)) throw new Error("Для этого типа уже заполнено поле. Сначала удалите прежний файл.");
          if (kind === "video" && !videoEnabled) throw new Error("Для MP4 нужна публичная HTTPS-ссылка; загрузка видео пока не настроена.");
          if (file.size > 25 * 1024 * 1024) throw new Error("Файл больше 25 МБ.");
          states[i] = { name: file.name, status: "Загружается…" }; setRows([...states]);
          const form = new FormData(); form.append("file", file);
          const response = await fetch("/api/uploads", { method: "POST", body: form });
          const asset = await response.json();
          if (!response.ok) throw new Error(asset.error || "Ошибка загрузки.");
          if (!kinds.includes(asset.kind)) throw new Error("Фактический формат файла не поддерживается.");
          uploaded.push({ assetId: asset.id, name: asset.name, kind: asset.kind, size: asset.size, previewUrl: asset.previewUrl });
          states[i] = { name: file.name, status: "Добавлен" };
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
      <strong>{busy ? "Загрузка файлов…" : title}</strong>
      <span>Можно добавить ещё: {maxFiles} · до 25 МБ каждый</span>
      <button type="button" className="pickFilesButton" disabled={!canPick}
        onClick={() => { inputRef.current?.click(); }}>
        {maxFiles > 1 ? "＋ Добавить файлы" : "＋ Добавить файл"}
      </button>
      <input key={pickerVersion} ref={inputRef} className="nativeFilePicker" type="file"
        multiple={maxFiles > 1} disabled={!canPick} aria-label={title}
        accept={kinds.flatMap((k) => k === "video" ? ["video/mp4"] : ["image/png", "image/jpeg", "image/webp"]).join(",")}
        onChange={upload} />
    </div>
    {!!rows.length && <ul className="uploadStatus" aria-live="polite">{rows.map((r, i) => <li key={i} className={r.error ? "uploadFailed" : ""}><span title={r.name}>{r.name}</span><small>{r.status}</small></li>)}</ul>}
  </div>;
}
