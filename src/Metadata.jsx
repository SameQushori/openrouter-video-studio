import { useEffect, useState } from "react";

async function send(form) {
  const response = await fetch("/api/metadata/apply", {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Не удалось перенести метаданные.");
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
        <img src={url} alt="Предпросмотр эталона" />
      ) : (
        <div className="metadataFallback">Предпросмотр недоступен</div>
      )}
      <div>
        <strong>{file.name}</strong>
        <span>{(file.size / 1024 / 1024).toFixed(2)} МБ</span>
        {onClear && (
          <button type="button" onClick={onClear}>
            Убрать файл
          </button>
        )}
      </div>
    </div>
  );
}

function MetadataList({ title, data }) {
  const labels = {
    camera: "Камера",
    capturedAt: "Дата съёмки",
    software: "Программа",
    author: "Автор",
    description: "Описание",
    location: "Геолокация",
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
        <span className="metadataCount">Полезных полей: {data.fieldCount}</span>
      )}
      {rows.length ? (
        rows.map(([key, value, label]) => (
          <p key={key}>
            <span>{label || labels[key] || key}</span>
            <strong>{value}</strong>
          </p>
        ))
      ) : (
        <p className="hint">Подходящих тегов не найдено.</p>
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
          {report.before.hasC2pa ? "Было" : "Не найдено"} →{" "}
          {report.after.hasC2pa ? "Осталось" : "Удалено / отсутствует"}
        </strong>
      </div>
      {report.kind !== "image" && (
        <div>
          <span>Аудиодорожка</span>
          <strong>
            {report.before.hasAudio ? "Была" : "Не было"} →{" "}
            {report.after.hasAudio ? "Сохранена" : "Отсутствует"}
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
          <span>ЛОКАЛЬНО</span>
        </div>
        <h1>Очистить или перенести метаданные.</h1>
        <p className="hint">
          Очищайте EXIF и C2PA из видео и фотографий. Оригинал не меняется:
          Studio создаёт отдельную копию. Эталон нужен только для переноса тегов.
        </p>
        <div className="metadataMode" aria-live="polite">
          <span>{reference ? "Режим переноса" : "Режим очистки"}</span>
          <strong>
            {reference ? "Эталон будет использован" : "Эталон не требуется"}
          </strong>
        </div>
        <form onSubmit={submit}>
          <label className="metadataPicker">
            1. Видео или изображение · до 50 МБ
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
            2. Эталон метаданных · необязательно
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
              Пропустите это поле для простой очистки EXIF/C2PA.
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
              Удалить C2PA / Content Credentials
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={removeSound}
                onChange={(e) => setRemoveSound(e.target.checked)}
                disabled={busy || !generatedIsVideo}
              />
              Удалить аудиодорожку из видео
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                disabled={busy}
              />
              Удалить EXIF, служебные метаданные и маркеры генератора
            </label>
            <label className="locationOption">
              <input
                type="checkbox"
                checked={includeLocation}
                onChange={(e) => setIncludeLocation(e.target.checked)}
                disabled={busy || !reference}
              />
              Копировать геолокацию GPS, если она есть
            </label>
          </div>
          <p className="hint">
            {reference
              ? "Старые записываемые теги очищаются, затем переносятся совместимые поля эталона."
              : "Будет создана очищенная копия без переноса чужих метаданных."}{" "}
            Содержимое изображения и параметры медиапотока не перекодируются.
          </p>
          <button className="primary" disabled={busy || !canProcess}>
            {busy
              ? "Обрабатываем файл…"
              : reference
                ? "Создать копию с метаданными"
                : "Очистить EXIF и C2PA"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
      <section>
        <div className="sectionTitle">
          <span className="eyebrow">РЕЗУЛЬТАТ</span>
          <span>{result ? "Готово" : "Ожидание"}</span>
        </div>
        {result ? (
          <>
            {result.kind === "image" ? (
              <img
                className="metadataResult"
                src={result.previewUrl}
                alt="Очищенное изображение"
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
                В эталоне найдено только {result.sourceMetadata.fieldCount || 0}{" "}
                полезных полей. Соцсети и мессенджеры часто удаляют данные
                камеры; для полного переноса выберите оригинал с телефона или
                камеры.
              </p>
            )}
            <div className="metadataCompare">
              <MetadataList title="До очистки" data={result.previousMetadata} />
              {result.sourceMetadata && (
                <MetadataList title="В эталоне" data={result.sourceMetadata} />
              )}
              <MetadataList
                title={`В готовом ${result.ext?.toUpperCase() || "файле"}`}
                data={result.outputMetadata}
              />
            </div>
            <a className="download metadataDownload" href={result.downloadUrl}>
              Скачать обработанный {result.ext?.toUpperCase() || "файл"} ↓
            </a>
          </>
        ) : (
          <div className="empty">
            <h2>Здесь появится новая копия</h2>
            <p>
              Добавьте MP4, JPEG, PNG, WebP, HEIC, AVIF, GIF или TIFF. Эталон
              требуется только для переноса метаданных.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
