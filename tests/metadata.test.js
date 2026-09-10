import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import {
  createMetadataProcessor,
  metadataSummary,
} from "../server/metadata.js";
import { createTikTokDownloader } from "../server/tiktok.js";

const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 20]),
  Buffer.from("ftypisom000000000"),
]);
const jpg = Buffer.from([
  255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 3, 4, 5,
]);

test("metadata processor clears generated tags and hides GPS unless explicitly enabled", async () => {
  let copiedOptions;
  const processor = createMetadataProcessor({
    read: async (file) =>
      file.endsWith("reference.jpg")
        ? {
            Make: "Apple",
            Model: "iPhone",
            DateTimeOriginal: "2026:09:10 12:00:00",
            GPSLatitude: 56.8,
            GPSLongitude: 60.6,
          }
        : { Make: "Apple", Model: "iPhone" },
    copy: async (source, target, options) => {
      copiedOptions = options;
      assert.match(source, /reference\.jpg$/);
      assert.match(target, /output\.mp4$/);
    },
    inspectC2pa: async () => false,
  });
  const result = await processor({
    generated: { buffer: mp4 },
    reference: { buffer: jpg },
    includeLocation: false,
  });
  assert.deepEqual(result.buffer, mp4);
  assert.deepEqual(copiedOptions, {
    includeLocation: false,
    clearExisting: true,
    removeC2pa: true,
    outputType: { ext: "mp4", mime: "video/mp4" },
  });
  assert.equal(result.sourceMetadata.camera, "Apple iPhone");
  assert.equal(result.sourceMetadata.fieldCount, 3);
  assert.equal(result.sourceMetadata.location, null);
  assert.equal(
    metadataSummary({ GPSLatitude: 1, GPSLongitude: 2 }, false).location,
    null,
  );
});

test("metadata processor removes audio and reports C2PA status", async () => {
  let audioRemoved = false;
  const processor = createMetadataProcessor({
    read: async (file) => {
      if (file.endsWith("generated.mp4")) return { AudioFormat: "mp4a" };
      if (file.endsWith("reference.jpg")) return { Make: "Apple" };
      return {};
    },
    copy: async () => {},
    inspectC2pa: async (file) => file.endsWith("generated.mp4"),
    removeAudio: async (binary, source, target) => {
      assert.ok(binary);
      audioRemoved = true;
      await copyFile(source, target);
    },
  });
  const result = await processor({
    generated: { buffer: mp4 },
    reference: { buffer: jpg },
    includeLocation: false,
    removeC2pa: true,
    removeSound: true,
  });
  assert.equal(audioRemoved, true);
  assert.deepEqual(result.mediaReport.before, {
    hasAudio: true,
    hasC2pa: true,
  });
  assert.deepEqual(result.mediaReport.after, {
    hasAudio: false,
    hasC2pa: false,
  });
});

test("metadata processor clears EXIF and C2PA without a reference", async () => {
  let copiedFrom;
  let copiedOptions;
  const processor = createMetadataProcessor({
    read: async (file) =>
      file.endsWith("generated.mp4")
        ? { Make: "Generated Camera", Software: "AI Generator" }
        : {},
    copy: async (source, target, options) => {
      copiedFrom = source;
      copiedOptions = options;
      assert.match(target, /output\.mp4$/);
    },
    inspectC2pa: async (file) => file.endsWith("generated.mp4"),
  });
  const result = await processor({
    generated: { buffer: mp4 },
    includeLocation: false,
    clearExisting: true,
    removeC2pa: true,
  });
  assert.equal(copiedFrom, null);
  assert.deepEqual(copiedOptions, {
    includeLocation: false,
    clearExisting: true,
    removeC2pa: true,
    outputType: { ext: "mp4", mime: "video/mp4" },
  });
  assert.equal(result.sourceMetadata, null);
  assert.equal(result.previousMetadata.software, "AI Generator");
  assert.equal(result.mediaReport.before.hasC2pa, true);
  assert.equal(result.mediaReport.after.hasC2pa, false);
});

test("metadata processor cleans an image without re-encoding or audio work", async () => {
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from("image-data"),
  ]);
  let copiedOptions;
  let audioCalled = false;
  const processor = createMetadataProcessor({
    read: async (file) =>
      file.includes("generated") ? { Software: "AI image tool" } : {},
    copy: async (source, target, options) => {
      assert.equal(source, null);
      assert.match(target, /output\.png$/);
      copiedOptions = options;
    },
    inspectC2pa: async (file) => file.includes("generated"),
    removeAudio: async () => {
      audioCalled = true;
    },
  });
  const result = await processor({
    generated: { buffer: png },
    includeLocation: false,
    clearExisting: true,
    removeC2pa: true,
    removeSound: true,
  });
  assert.deepEqual(result.buffer, png);
  assert.equal(result.kind, "image");
  assert.equal(result.ext, "png");
  assert.equal(result.mime, "image/png");
  assert.equal(audioCalled, false);
  assert.equal(result.mediaReport.kind, "image");
  assert.equal(result.mediaReport.requested.removeSound, false);
  assert.deepEqual(copiedOptions.outputType, {
    ext: "png",
    mime: "image/png",
  });
});

test("vendored ExifTool can clean a real PNG", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const result = await createMetadataProcessor()({
    generated: { buffer: png },
    includeLocation: false,
    clearExisting: true,
    removeC2pa: true,
  });
  assert.equal(result.kind, "image");
  assert.equal(result.mime, "image/png");
  assert.deepEqual(
    result.buffer.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});

test("metadata API returns a cleaned image with its original media type", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-metadata-image-"));
  const store = createStore(dir);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from("cleaned-image"),
  ]);
  const runtime = createApp({
    provider: {},
    store,
    assetDir: path.join(dir, "uploads"),
    metadataDir: path.join(dir, "metadata"),
    metadataProcessor: async () => ({
      buffer: png,
      ext: "png",
      mime: "image/png",
      kind: "image",
      previousMetadata: { software: "generator" },
      sourceMetadata: null,
      outputMetadata: {},
      mediaReport: {
        kind: "image",
        before: { hasAudio: false, hasC2pa: true },
        after: { hasAudio: false, hasC2pa: false },
      },
    }),
  });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const response = await request(runtime.app)
    .post("/api/metadata/apply")
    .attach("generated", png, "generated.png");
  assert.equal(response.status, 201);
  assert.equal(response.body.kind, "image");
  assert.equal(response.body.ext, "png");
  const preview = await request(runtime.app).get(response.body.previewUrl);
  assert.equal(preview.status, 200);
  assert.match(preview.headers["content-type"], /^image\/png/);
  assert.deepEqual(preview.body, png);
});

test("metadata API stores a separate downloadable MP4", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-metadata-api-"));
  const store = createStore(dir);
  let receivedOptions;
  const runtime = createApp({
    provider: {},
    store,
    assetDir: path.join(dir, "uploads"),
    metadataDir: path.join(dir, "metadata"),
    metadataProcessor: async (options) => {
      receivedOptions = options;
      return {
        buffer: mp4,
        sourceMetadata: {
          camera: "Phone",
          location: options.includeLocation ? "1, 2" : null,
        },
        outputMetadata: { camera: "Phone", location: null },
        mediaReport: {
          before: { hasAudio: true, hasC2pa: true },
          after: { hasAudio: false, hasC2pa: false },
        },
      };
    },
  });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const response = await request(runtime.app)
    .post("/api/metadata/apply")
    .field("includeLocation", "false")
    .field("removeC2pa", "true")
    .field("removeSound", "true")
    .attach("generated", mp4, "generated.mp4")
    .attach("reference", jpg, "reference.jpg");
  assert.equal(response.status, 201);
  assert.equal(response.body.outputMetadata.camera, "Phone");
  assert.equal(receivedOptions.removeC2pa, true);
  assert.equal(receivedOptions.removeSound, true);
  assert.equal(response.body.mediaReport.after.hasAudio, false);
  const downloaded = await request(runtime.app).get(response.body.downloadUrl);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, mp4);
});

test("metadata API accepts cleanup with only the generated MP4", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-metadata-clean-"));
  const store = createStore(dir);
  let receivedOptions;
  const runtime = createApp({
    provider: {},
    store,
    assetDir: path.join(dir, "uploads"),
    metadataDir: path.join(dir, "metadata"),
    metadataProcessor: async (options) => {
      receivedOptions = options;
      return {
        buffer: mp4,
        previousMetadata: { software: "generator" },
        sourceMetadata: null,
        outputMetadata: {},
        mediaReport: {
          before: { hasAudio: false, hasC2pa: true },
          after: { hasAudio: false, hasC2pa: false },
        },
      };
    },
  });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const response = await request(runtime.app)
    .post("/api/metadata/apply")
    .field("clearExisting", "true")
    .field("removeC2pa", "true")
    .attach("generated", mp4, "generated.mp4");
  assert.equal(response.status, 201);
  assert.equal(receivedOptions.reference, undefined);
  assert.equal(response.body.sourceMetadata, null);
});

test("TikTok downloader requests H.264 and normalizes the downloaded MP4", async () => {
  let sort;
  let normalized = false;
  const downloader = createTikTokDownloader({
    binary: "yt-dlp-test",
    ffmpeg: "ffmpeg-test",
    run: async (binary, args) => {
      assert.equal(binary, "yt-dlp-test");
      sort = args[args.indexOf("--format-sort") + 1];
      const output = args[args.indexOf("--output") + 1].replace(
        "%(ext)s",
        "mp4",
      );
      await writeFile(output, mp4);
    },
    normalize: async (binary, source, output) => {
      assert.equal(binary, "ffmpeg-test");
      normalized = true;
      await copyFile(source, output);
    },
  });
  const result = await downloader("https://www.tiktok.com/@user/video/123");
  assert.equal(sort, "+codec:h264");
  assert.equal(normalized, true);
  assert.deepEqual(result.buffer, mp4);
});
