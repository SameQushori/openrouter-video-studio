import { useEffect } from "react";

const list = (values, suffix = "") =>
  values?.length ? values.map((v) => `${v}${suffix}`).join(", ") : "не опубликовано";

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
    model.frames.includes("first_frame") && "первый кадр",
    model.frames.includes("last_frame") && "последний кадр",
  ].filter(Boolean);
  const refs = model.references.map((v) => (v === "video" ? "видео" : "изображения"));
  return <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modelModal" role="dialog" aria-modal="true" aria-labelledby="model-guide-title">
      <div className="modalHeader">
        <div><span className="eyebrow">ИНСТРУКЦИЯ К МОДЕЛИ</span><h2 id="model-guide-title">{model.name}</h2></div>
        <button type="button" className="modalClose" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      <div className="modelRating">
        <span className="stars">{"★".repeat(model.stars || 0)}{"☆".repeat(3 - (model.stars || 0))}</span>
        <span>{model.stars ? "Редакционная оценка Studio по качеству и возможностям" : "Модель без редакционной оценки Studio"}</span>
      </div>
      <p className="modelModalDescription">{model.description || "Описание модели не опубликовано."}</p>
      <div className="capabilityGrid">
        <div><small>Длительность</small><strong>{list(model.durations, " сек")}</strong></div>
        <div><small>Разрешение</small><strong>{list(model.resolutions)}</strong></div>
        <div><small>Форматы кадра</small><strong>{list(model.aspectRatios)}</strong></div>
        <div><small>Звук</small><strong>{model.audio ? "поддерживается" : "не заявлен"}</strong></div>
        <div><small>Управление кадрами</small><strong>{frames.length ? frames.join(", ") : "не заявлено"}</strong></div>
        <div><small>Референсы</small><strong>{refs.length ? `${refs.join(", ")} · до ${model.maxReferences ?? 4} в Studio` : "не подтверждены"}</strong></div>
        <div><small>Управление движением</small><strong>{model.motionControl === "video_to_video" ? "Motion Control / video-to-video" : model.motionControl === "video_reference" ? "через видеореференс" : "не заявлено"}</strong></div>
      </div>
      <h3>Ограничения</h3>
      <ul className="guideList">
        <li>Промпт: до {model.promptMaxChars.toLocaleString("ru-RU")} символов.</li>
        <li>Загрузка Studio: PNG, JPEG, WebP или MP4, до 25 МБ на файл и до 4 референсов.</li>
        <li>{config.videoUploadTransport === "cloudflare_worker" ? "Локальные MP4 временно хранятся в Cloudflare 24 часа и доступны модели по HTTPS." : config.videoUploadsConfigured ? "Локальные MP4 доступны через публичный media URL." : "Используйте прямую публичную HTTPS-ссылку на MP4."}</li>
        <li>Показываются только возможности, подтверждённые каталогом или документацией; конкретный маршрут провайдера может иметь дополнительные ограничения.</li>
      </ul>
      {!!model.guidance.length && <><h3>Особенности модели</h3><ul className="guideList">{model.guidance.map((note) => <li key={note}>{note}</li>)}</ul></>}
      <div className="modalFooter"><a href={model.guidanceSource} target="_blank" rel="noreferrer">Страница модели OpenRouter ↗</a><button type="button" onClick={onClose}>Понятно</button></div>
    </section>
  </div>;
}
