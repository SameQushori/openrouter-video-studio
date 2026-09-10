import { modelGuidance } from "./model-guidance.js";

export const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "submission_unknown",
]);

// OpenRouter's video-model catalog does not currently publish this field. Keep
// documented upstream limits here as a capability decoration so the UI and the
// server enforce the same value without branching on model names elsewhere.
const promptLimitFor = (id) =>
  id.startsWith("kwaivgi/kling-")
    ? 2_500
    : /^alibaba\/wan-3\.0-prime(?:[-:]|$)/.test(id)
      ? 20_000
      : 10_000;

export function normalizeModel(raw, overrides = {}) {
  const extra = overrides[raw.id] || {};
  const guide = modelGuidance(raw.id);
  return {
    id: raw.id,
    name: raw.name || raw.id,
    description: raw.description || "",
    durations: raw.supported_durations || [],
    resolutions: raw.supported_resolutions || [],
    aspectRatios: raw.supported_aspect_ratios || [],
    frames: raw.supported_frame_images || [],
    audio: raw.generate_audio === true,
    seed: raw.seed === true,
    references: extra.source
      ? (extra.references || []).filter((x) => ["image", "video"].includes(x))
      : [],
    maxReferences: extra.source && Number.isInteger(extra.maxReferences)
      ? extra.maxReferences
      : 4,
    motionControl: ["video_reference", "video_to_video"].includes(extra.motionControl)
      ? extra.motionControl
      : null,
    referenceSource: extra.source || null,
    pricing: raw.pricing_skus || {},
    promptMaxChars: promptLimitFor(raw.id),
    ...guide,
  };
}
export function validateRequest(input, model) {
  if (!model)
    throw Object.assign(
      new Error("Модель отсутствует в актуальном каталоге."),
      { status: 400 },
    );
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  const promptLimit = model.promptMaxChars || promptLimitFor(model.id);
  const promptLength =
    typeof input.prompt === "string" ? Array.from(input.prompt).length : 0;
  if (
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    promptLength > promptLimit
  )
    fail(`Введите описание: от 1 до ${promptLimit} символов.`);
  const out = { model: model.id, prompt: input.prompt.trim() };
  for (const [key, values] of [
    ["duration", model.durations],
    ["resolution", model.resolutions],
    ["aspect_ratio", model.aspectRatios],
  ]) {
    if (input[key] !== undefined && input[key] !== "") {
      if (!values.includes(input[key]))
        fail(`Недопустимый параметр ${key}. Обновите каталог.`);
      out[key] = input[key];
    }
  }
  if (input.generate_audio !== undefined) {
    if (!model.audio || typeof input.generate_audio !== "boolean")
      fail("Настройка аудио не поддерживается.");
    out.generate_audio = input.generate_audio;
  }
  return out;
}
