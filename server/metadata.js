import multer from "multer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exiftool, exiftoolPath } from "exiftool-vendored";
import ffmpegPath from "ffmpeg-static";

const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const idPattern = /^[a-f0-9-]{36}$/;
const mimeByExt = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  avif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
};

function fileType(buffer, videoOnly = false) {
  if (buffer.length < 12) return null;
  const brand = buffer.toString("ascii", 8, 12);
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand))
      return videoOnly ? null : { ext: "heic", mime: "image/heic" };
    if (/^(avif|avis)$/.test(brand))
      return videoOnly ? null : { ext: "avif", mime: "image/avif" };
    return { ext: "mp4", mime: "video/mp4" };
  }
  if (videoOnly) return null;
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { ext: "png", mime: "image/png" };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { ext: "jpg", mime: "image/jpeg" };
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return { ext: "webp", mime: "image/webp" };
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6)))
    return { ext: "gif", mime: "image/gif" };
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  )
    return { ext: "tiff", mime: "image/tiff" };
  return null;
}

function show(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && typeof value.toString === "function")
    return value.toString();
  return String(value);
}

const visibleFields = [
  ["make", "Производитель", ["Make", "DeviceManufacturer"]],
  ["model", "Модель устройства", ["Model", "DeviceModelName"]],
  ["lensMake", "Производитель объектива", ["LensMake"]],
  ["lensModel", "Объектив", ["LensModel"]],
  ["dateTimeOriginal", "Дата оригинала", ["DateTimeOriginal"]],
  ["creationDate", "Дата создания с часовым поясом", ["CreationDate"]],
  ["createDate", "Дата создания", ["CreateDate"]],
  ["modifyDate", "Дата изменения", ["ModifyDate"]],
  ["mediaCreateDate", "Дата медиапотока", ["MediaCreateDate"]],
  ["trackCreateDate", "Дата видеодорожки", ["TrackCreateDate"]],
  ["software", "Программа", ["Software"]],
  ["encoder", "Кодировщик", ["Encoder", "Decoder"]],
  ["artist", "Автор", ["Artist", "Author"]],
  ["copyright", "Авторские права", ["Copyright"]],
  ["title", "Название", ["Title"]],
  ["description", "Описание", ["Description"]],
  ["comment", "Комментарий", ["Comment"]],
  ["keywords", "Ключевые слова", ["Keywords", "Subject"]],
  ["orientation", "Ориентация", ["Orientation", "Rotation"]],
  ["location", "Геолокация", ["GPSCoordinates", "GPSPosition"]],
  ["aiMarker", "Маркер AI", ["AIGC", "DigitalSourceType"]],
];

function firstTag(tags, names) {
  for (const name of names) {
    const value = show(tags[name]);
    if (value) return value;
  }
  return null;
}

export function metadataFields(tags = {}, includeLocation = true) {
  const fields = visibleFields.flatMap(([key, label, names]) => {
    if (!includeLocation && key === "location") return [];
    let value = firstTag(tags, names);
    if (key === "location" && !value) {
      const latitude = show(tags.GPSLatitude);
      const longitude = show(tags.GPSLongitude);
      if (latitude && longitude) value = `${latitude}, ${longitude}`;
    }
    return value ? [{ key, label, value }] : [];
  });
  return fields;
}

export function metadataSummary(tags = {}, includeLocation = true) {
  const capturedAt =
    tags.DateTimeOriginal ||
    tags.CreationDate ||
    tags.CreateDate ||
    tags.MediaCreateDate;
  const latitude = show(tags.GPSLatitude);
  const longitude = show(tags.GPSLongitude);
  const fields = metadataFields(tags, includeLocation);
  return {
    camera:
      [show(tags.Make), show(tags.Model)].filter(Boolean).join(" ") || null,
    capturedAt: show(capturedAt),
    software: show(tags.Software || tags.Encoder),
    author: show(tags.Artist || tags.Author || tags.Copyright),
    description: show(tags.Description || tags.Comment || tags.Title),
    location:
      includeLocation && latitude && longitude
        ? `${latitude}, ${longitude}`
        : includeLocation
          ? show(tags.GPSCoordinates)
          : null,
    fields,
    fieldCount: fields.length,
    hasAiMarker: Boolean(firstTag(tags, ["AIGC", "DigitalSourceType"])),
  };
}

export function createMetadataProcessor({
  read = (file) => exiftool.read(file),
  copy = copyMetadata,
  inspectC2pa = hasC2pa,
  removeAudio = removeAudioTrack,
} = {}) {
  return async function process({
    generated,
    reference,
    includeLocation,
    clearExisting = true,
    removeC2pa = true,
    removeSound = false,
  }) {
    const generatedType = fileType(generated.buffer, false);
    const referenceType = reference ? fileType(reference.buffer, false) : null;
    if (!generatedType)
      throw bad(
        "Поддерживаются MP4, JPEG, PNG, WebP, HEIC, AVIF, GIF и TIFF.",
      );
    if (reference && !referenceType)
      throw bad("Эталоном может быть JPEG, PNG, WebP, HEIC или MP4.");
    const isVideo = generatedType.mime === "video/mp4";
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "video-studio-metadata-"),
    );
    const sourcePath = path.join(temp, `generated.${generatedType.ext}`);
    const referencePath = referenceType
      ? path.join(temp, `reference.${referenceType.ext}`)
      : null;
    const outputPath = path.join(temp, `output.${generatedType.ext}`);
    try {
      await writeFile(sourcePath, generated.buffer);
      if (referencePath) await writeFile(referencePath, reference.buffer);
      if (removeSound && isVideo)
        await removeAudio(ffmpegPath, sourcePath, outputPath);
      else await copyFile(sourcePath, outputPath);
      const [generatedTags, sourceTags, generatedHasC2pa] = await Promise.all([
        read(sourcePath),
        referencePath ? read(referencePath) : Promise.resolve(null),
        inspectC2pa(sourcePath),
      ]);
      if (referencePath || clearExisting || removeC2pa)
        await copy(referencePath, outputPath, {
          includeLocation,
          clearExisting,
          removeC2pa,
          outputType: generatedType,
        });
      const [outputTags, outputHasC2pa] = await Promise.all([
        read(outputPath),
        inspectC2pa(outputPath),
      ]);
      return {
        buffer: await readFile(outputPath),
        ext: generatedType.ext,
        mime: generatedType.mime,
        kind: isVideo ? "video" : "image",
        previousMetadata: metadataSummary(generatedTags, includeLocation),
        sourceMetadata: sourceTags
          ? metadataSummary(sourceTags, includeLocation)
          : null,
        outputMetadata: metadataSummary(outputTags, includeLocation),
        clearExisting,
        mediaReport: {
          kind: isVideo ? "video" : "image",
          before: {
            hasAudio: hasAudio(generatedTags),
            hasC2pa: generatedHasC2pa,
          },
          after: {
            hasAudio: hasAudio(outputTags),
            hasC2pa: outputHasC2pa,
          },
          requested: { removeSound: removeSound && isVideo, removeC2pa },
        },
      };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  };
}

async function copyMetadata(
  reference,
  output,
  { includeLocation, clearExisting, removeC2pa, outputType },
) {
  const binary = await exiftoolPath();
  const args = ["-overwrite_original"];
  if (clearExisting) args.push("-all=");
  if (reference) {
    args.push("-TagsFromFile", reference, "-all:all");
    if (!includeLocation)
      args.push("--GPS*", "--Location*", "--Keys:GPSCoordinates");
    if (outputType?.mime === "video/mp4") {
      args.push(
        "-Keys:Make<Make",
        "-Keys:Model<Model",
        "-Keys:Software<Software",
        "-Keys:Artist<Artist",
        "-Keys:Copyright<Copyright",
        "-Keys:Title<Title",
        "-Keys:Description<Description",
        "-Keys:Comment<Comment",
        "-QuickTime:CreateDate<CreateDate",
        "-QuickTime:ModifyDate<CreateDate",
        "-Keys:CreationDate<CreateDate",
        "-QuickTime:CreateDate<DateTimeOriginal",
        "-QuickTime:ModifyDate<DateTimeOriginal",
        "-Keys:CreationDate<DateTimeOriginal",
      );
      if (includeLocation)
        args.push(
          "-Keys:GPSCoordinates<GPSPosition",
          "-Keys:GPSCoordinates<GPSCoordinates",
        );
    }
  }
  if (removeC2pa) args.push("-JUMBF:all=");
  args.push(output);
  await run(binary, args);
}

function hasAudio(tags = {}) {
  return Boolean(
    tags.AudioFormat ||
    tags.AudioCodec ||
    tags.AudioChannels ||
    tags.AudioSampleRate,
  );
}

async function hasC2pa(file) {
  const binary = await exiftoolPath();
  const stdout = await runCapture(binary, [
    "-JUMBF:all",
    "-G3",
    "-j",
    "-u",
    "-struct",
    file,
  ]);
  try {
    const [result = {}] = JSON.parse(stdout);
    return Object.keys(result).some(
      (key) => !["SourceFile", "errors", "warnings"].includes(key),
    );
  } catch {
    return /\b(?:c2pa|jumbf|manifest)\b/i.test(stdout);
  }
}

async function removeAudioTrack(binary, input, output) {
  if (!binary)
    throw bad("Видеоконвертер не установлен. Выполните npm install.", 503);
  await run(
    binary,
    [
      "-y",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-an",
      "-map_metadata",
      "0",
      "-movflags",
      "+faststart",
      output,
    ],
    "Не удалось удалить аудиодорожку из MP4.",
  );
}

function run(
  binary,
  args,
  fallback = "ExifTool не смог обработать метаданные файла.",
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 3000) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        bad(
          signal
            ? `${fallback} Превышено время ожидания.`
            : stderr.trim() || fallback,
        ),
      );
    });
  });
}

function runCapture(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 3000) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(bad(stderr.trim() || "Не удалось проверить C2PA.")),
    );
  });
}

export function installMetadata(app, { processor, outputDir }) {
  const root = path.resolve(outputDir);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 2, fields: 4 },
  }).fields([
    { name: "generated", maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]);
  app.post("/api/metadata/apply", upload, async (req, res) => {
    const generated = req.files?.generated?.[0];
    const reference = req.files?.reference?.[0];
    if (!generated) throw bad("Добавьте видео или изображение для обработки.");
    const includeLocation = req.body.includeLocation === "true";
    const clearExisting = req.body.clearExisting !== "false";
    const removeC2pa = req.body.removeC2pa !== "false";
    const removeSound = req.body.removeSound === "true";
    const result = await processor({
      generated,
      reference,
      includeLocation,
      clearExisting,
      removeC2pa,
      removeSound,
    });
    if (result.buffer.length > 60 * 1024 * 1024)
      throw bad("Готовый файл превышает лимит 60 МБ.");
    const id = randomUUID();
    const ext = result.ext || "mp4";
    const mime = result.mime || "video/mp4";
    const kind = result.kind || (mime.startsWith("image/") ? "image" : "video");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, `${id}.${ext}`), result.buffer);
    await writeFile(
      path.join(root, `${id}.json`),
      JSON.stringify({
        id,
        ext,
        mime,
        kind,
        createdAt: new Date().toISOString(),
      }),
    );
    res.status(201).json({
      id,
      ext,
      mime,
      kind,
      previewUrl: `/api/metadata/${id}/content`,
      downloadUrl: `/api/metadata/${id}/content?download=1`,
      previousMetadata: result.previousMetadata,
      sourceMetadata: result.sourceMetadata,
      outputMetadata: result.outputMetadata,
      clearExisting: result.clearExisting,
      mediaReport: result.mediaReport,
    });
  });
  app.get("/api/metadata/:id/content", async (req, res) => {
    if (!idPattern.test(req.params.id)) throw bad("Файл не найден.", 404);
    try {
      var metadata = JSON.parse(
        await readFile(path.join(root, `${req.params.id}.json`), "utf8"),
      );
    } catch {
      throw bad("Файл не найден.", 404);
    }
    const ext = metadata.ext || "mp4";
    const mime = mimeByExt[ext];
    if (!mime)
      throw bad("Файл не найден.", 404);
    const file = path.join(root, `${req.params.id}.${ext}`);
    if (req.query.download === "1")
      return res.download(file, `cleaned-media.${ext}`);
    res.type(mime).sendFile(file);
  });
}
