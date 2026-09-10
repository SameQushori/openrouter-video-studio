import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const bad = (message) => Object.assign(new Error(message), { status: 400 });
export function publicUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw bad("Введите прямую HTTPS-ссылку на файл.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !u.hostname.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      u.hostname,
    ) ||
    u.hostname.endsWith(".local") ||
    u.hostname.includes(":")
  )
    throw bad("Нужна публичная HTTPS-ссылка без пароля.");
  return u.href;
}
export function createAssets(dir, baseUrl = "", demo = false, mediaWorker = {}) {
  const root = path.resolve(dir);
  const base = baseUrl ? publicUrl(baseUrl).replace(/\/$/, "") : "";
  const workerBase = mediaWorker.url
    ? publicUrl(mediaWorker.url).replace(/\/$/, "")
    : "";
  const workerReady = Boolean(workerBase && mediaWorker.token && mediaWorker.fetcher);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 0 },
  }).single("file");
  async function saveVideo(buffer, name, extra = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12)
      throw bad("Скачанный файл пуст или повреждён.");
    if (buffer.length > 25 * 1024 * 1024)
      throw bad("Максимальный размер видео — 25 МБ.");
    if (
      buffer.toString("ascii", 4, 8) !== "ftyp" ||
      !/^(isom|iso2|mp41|mp42|avc1|M4V )$/.test(
        buffer.toString("ascii", 8, 12),
      )
    )
      throw bad("TikTok вернул файл не в формате MP4.");
    const id = randomUUID();
    const asset = {
      id,
      name: String(name || "tiktok-video.mp4").slice(0, 160),
      mime: "video/mp4",
      kind: "video",
      size: buffer.length,
      file: `${id}.mp4`,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, asset.file), buffer);
    await writeFile(path.join(root, `${id}.json`), JSON.stringify(asset));
    return { ...asset, previewUrl: `/media/${asset.file}` };
  }
  async function accept(req, res) {
    const f = req.file;
    if (!f) throw bad("Выберите файл.");
    const b = f.buffer;
    let mime, ext, kind;
    if (
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      mime = "image/png";
      ext = "png";
      kind = "image";
    } else if (b[0] === 255 && b[1] === 216 && b[2] === 255) {
      mime = "image/jpeg";
      ext = "jpg";
      kind = "image";
    } else if (
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP"
    ) {
      mime = "image/webp";
      ext = "webp";
      kind = "image";
    } else if (
      b.toString("ascii", 4, 8) === "ftyp" &&
      /^(isom|iso2|mp41|mp42|avc1|M4V )$/.test(b.toString("ascii", 8, 12))
    ) {
      mime = "video/mp4";
      ext = "mp4";
      kind = "video";
    } else
      throw bad(
        "Поддерживаются PNG, JPEG, WebP и MP4. Формат файла не распознан.",
      );
    const id = randomUUID();
    const asset = {
      id,
      name: f.originalname.slice(0, 160),
      mime,
      kind,
      size: f.size,
      file: `${id}.${ext}`,
      createdAt: new Date().toISOString(),
    };
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, asset.file), b);
    await writeFile(path.join(root, `${id}.json`), JSON.stringify(asset));
    res.status(201).json({ ...asset, previewUrl: `/media/${asset.file}` });
  }
  async function resolve(item) {
    if (item.url) return { kind: item.kind, url: publicUrl(item.url) };
    if (!/^[a-f0-9-]{36}$/.test(item.assetId || ""))
      throw bad("Некорректный ID файла.");
    let asset;
    try {
      asset = JSON.parse(
        await readFile(path.join(root, `${item.assetId}.json`), "utf8"),
      );
    } catch {
      throw bad("Файл не найден. Загрузите его снова.");
    }
    if (!base && asset.kind === "image") {
      const bytes = await readFile(path.join(root, asset.file));
      return {
        kind: asset.kind,
        url: `data:${asset.mime};base64,${bytes.toString("base64")}`,
      };
    }
    if (!base && asset.kind === "video" && workerReady) {
      const bytes = await readFile(path.join(root, asset.file));
      let response;
      try {
        response = await mediaWorker.fetcher(`${workerBase}/upload/${asset.id}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${mediaWorker.token}`,
            "Content-Type": "video/mp4",
            "Content-Length": String(bytes.length),
          },
          body: bytes,
          signal: AbortSignal.timeout(120000),
        });
      } catch {
        throw bad("Не удалось загрузить MP4 в защищённое временное хранилище Cloudflare.");
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url)
        throw bad(result.error || "Cloudflare не принял MP4.");
      return { kind: asset.kind, url: publicUrl(result.url) };
    }
    if (!base && asset.kind === "video")
      throw bad("Для локального MP4 нужен PUBLIC_ASSET_BASE_URL или MEDIA_WORKER_URL.");
    return {
      kind: asset.kind,
      url: `${base || "https://demo.invalid"}/media/${asset.file}`,
    };
  }
  return {
    root,
    upload,
    accept,
    saveVideo,
    resolve,
    configured: Boolean(base) || workerReady || demo,
    publicBaseUrl: base || workerBase || null,
    transport: base ? "public_url" : workerReady ? "cloudflare_worker" : null,
  };
}
export async function attachAssets(input, model, payload, assets) {
  const items = input.references || [];
  const maxReferences = model.maxReferences ?? 4;
  if (!Array.isArray(items) || items.length > maxReferences)
    throw bad(`Максимум ${maxReferences} референса(ов) для этой модели в Studio.`);
  const legacyMotion = input.referenceMode === "character_motion";
  const motion = input.referenceMode === "motion_control";
  const imageCount = Array.isArray(items)
    ? items.filter((item) => item?.kind === "image").length
    : 0;
  const videoCount = Array.isArray(items)
    ? items.filter((item) => item?.kind === "video").length
    : 0;
  if (legacyMotion && (input.firstFrame || items.length !== 2 ||
      !model.references.includes("image") || !model.references.includes("video")))
    throw bad("Для старого режима «Персонаж + видео» нужны два референса и модель с поддержкой изображений и видео.");
  if (motion && (input.firstFrame || !model.motionControl ||
      !model.references.includes("video") || videoCount !== 1 ||
      imageCount > 1 || items.length !== imageCount + videoCount))
    throw bad("Для управления движением нужно ровно одно видео; можно дополнительно добавить одно изображение персонажа.");
  if (input.firstFrame && items.length)
    throw bad(
      "Выберите первый кадр или референсы, не оба режима одновременно.",
    );
  if (input.firstFrame) {
    if (!model.frames.includes("first_frame"))
      throw bad("Модель не поддерживает первый кадр.");
    const a = await assets.resolve(input.firstFrame);
    if (a.kind !== "image") throw bad("Первый кадр должен быть изображением.");
    payload.frame_images = [
      {
        type: "image_url",
        image_url: { url: a.url },
        frame_type: "first_frame",
      },
    ];
  }
  if (items.length) {
    payload.input_references = [];
    for (const item of items) {
      const a = await assets.resolve(item);
      if (!model.references.includes(a.kind))
        throw bad("Поддержка этого типа референса не подтверждена для модели.");
      const type = `${a.kind}_url`;
      payload.input_references.push({ type, [type]: { url: a.url } });
    }
    if (legacyMotion && (payload.input_references[0].type !== "image_url" ||
        payload.input_references[1].type !== "video_url"))
      throw bad("Первый референс должен быть изображением персонажа, второй — видео движений.");
    if (motion) {
      const resolvedVideos = payload.input_references.filter((item) => item.type === "video_url").length;
      const resolvedImages = payload.input_references.filter((item) => item.type === "image_url").length;
      if (resolvedVideos !== 1 || resolvedImages > 1 ||
          resolvedVideos + resolvedImages !== payload.input_references.length)
        throw bad("Фактические типы файлов не подходят для управления движением.");
    }
  }
  return payload;
}
