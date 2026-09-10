const ratings = {
  "google/veo-3.1": 3,
  "bytedance/seedance-2.5": 3,
  "alibaba/wan-3.0": 3,
  "openai/sora-2-pro": 3,
  "black-forest-labs/flux-3-video": 3,
  "minimax/hailuo-3-max": 3,
  "alibaba/wan-3.0-prime": 2,
  "google/veo-3.1-fast": 2,
  "bytedance/seedance-2.0": 2,
  "bytedance/seedance-2.0-fast": 2,
  "kwaivgi/kling-v3.0-pro": 2,
  "runway/gen-4.5": 2,
};

export function modelGuidance(id) {
  const notes = [];
  if (id.startsWith("bytedance/seedance"))
    notes.push(
      "Генерация людей из текста поддерживается. Референс с узнаваемым реальным человеком может быть отклонён privacy/safety-фильтром провайдера; возможны ложные срабатывания.",
    );
  if (id === "bytedance/seedance-2.0-fast")
    notes.push(
      "Мультимодальные изображения и видео подтверждены, но видеореференс требует поддерживающего маршрута провайдера. Перенос движения 1:1 не гарантируется.",
    );
  if (id === "minimax/hailuo-3")
    notes.push(
      "OpenRouter прямо указывает video-to-video motion transfer. В Studio загрузите обязательное видео движения и при необходимости изображение персонажа. Отдельного подтверждённого параметра силы переноса в нормализованном API нет.",
    );
  if (id === "minimax/hailuo-3-max")
    notes.push(
      "H3 Max поддерживает text-to-video, image-to-video и первый/последний кадр, но OpenRouter не заявляет для неё video-to-video Motion Control. Для переноса движения выберите обычную MiniMax H3.",
    );
  if (["bytedance/seedance-2.0", "bytedance/seedance-2.0-mini", "bytedance/seedance-2.5"].includes(id))
    notes.push(
      "Видео можно передать как мультимодальный референс для движения. Это reference guidance, а не гарантированный покадровый motion transfer; отдельный strength-параметр OpenRouter не публикует.",
    );
  if (id === "alibaba/wan-3.0")
    notes.push(
      "Поддерживается reference-guided video с изображениями: в Studio можно добавить до 4 image references. Видеореференс для этой модели не заявлен.",
    );
  if (id === "alibaba/wan-3.0-prime")
    notes.push(
      "Для Wan 3.0 Prime OpenRouter заявляет text-to-video и first-frame image-to-video. Несколько референсных изображений и видеореференс не подтверждены, поэтому первый кадр имеет лимит 1/1.",
    );
  if (id === "bytedance/seedance-2.5")
    notes.push(
      "Модель поддерживает многомодальные референсы; в Studio доступно до 4 изображений и видео на одну задачу. Страница модели указывает больший провайдерский предел, но Studio пока намеренно ограничивает отправку четырьмя.",
    );
  if (id.startsWith("kwaivgi/kling-"))
    notes.push(
      "На текущем маршруте Kling действует предел промпта 2 500 символов. Длинный JSON лучше сократить до сцены, действий, камеры и света.",
    );
  if (id.startsWith("google/veo-3.1"))
    notes.push(
      "Длительность выбирается только из опубликованных значений. 4K и звук доступны лишь там, где они показаны в параметрах выбранной версии.",
    );
  if (id === "openai/sora-2-pro")
    notes.push(
      "В текущем каталоге не опубликован first-frame input, поэтому Studio показывает только подтверждённые режимы.",
    );
  return {
    stars: ratings[id] || 0,
    guidance: notes,
    guidanceSource: `https://openrouter.ai/${id}`,
  };
}
