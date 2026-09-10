import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";
test("image upload works inline without public origin and base64 is not stored in history", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-inline-")),
    store = createStore(dir);
  let sent;
  const runtime = createApp({
    store,
    assetDir: path.join(dir, "uploads"),
    provider: {
      models: async () => [
        { id: "test/image", supported_frame_images: ["first_frame"] },
      ],
      submit: async (p) => {
        sent = p;
        return { id: "remote-1", status: "pending" };
      },
    },
  });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const a = await request(runtime.app)
    .post("/api/uploads")
    .attach("file", png, "frame.png");
  assert.equal(a.status, 201);
  const r = await request(runtime.app)
    .post("/api/jobs")
    .set("Idempotency-Key", "inline-image-test")
    .send({
      model: "test/image",
      prompt: "Move",
      firstFrame: { assetId: a.body.id },
    });
  assert.equal(r.status, 202);
  assert.match(
    sent.frame_images[0].image_url.url,
    /^data:image\/png;base64,/,
  );
  assert.ok(!JSON.stringify(r.body).includes("base64"));
  const config = await request(runtime.app).get("/api/config");
  assert.equal(config.body.uploadsConfigured, true);
  assert.equal(config.body.videoUploadsConfigured, false);
  assert.equal(config.body.videoUploadTransport, null);
});

test("local MP4 is staged through the configured media worker", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-worker-"));
  const store = createStore(dir);
  let uploadRequest;
  let providerPayload;
  const runtime = createApp({
    store,
    assetDir: path.join(dir, "uploads"),
    overrides: { "test/video": { references: ["video"], source: "test" } },
    mediaWorker: {
      url: "https://video-studio-media.example.workers.dev",
      token: "private-token",
      fetcher: async (url, options) => {
        uploadRequest = { url, options };
        return Response.json(
          { url: url.replace("/upload/", "/media/") },
          { status: 201 },
        );
      },
    },
    provider: {
      models: async () => [{ id: "test/video", supported_frame_images: [] }],
      submit: async (payload) => {
        providerPayload = payload;
        return { id: "remote-video", status: "pending" };
      },
    },
  });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 20]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(24),
  ]);
  const asset = await request(runtime.app)
    .post("/api/uploads")
    .attach("file", mp4, "motion.mp4");
  assert.equal(asset.status, 201);
  const job = await request(runtime.app)
    .post("/api/jobs")
    .set("Idempotency-Key", "worker-video-test")
    .send({
      model: "test/video",
      prompt: "Follow motion",
      references: [{ assetId: asset.body.id, kind: "video" }],
    });
  assert.equal(job.status, 202);
  assert.match(uploadRequest.url, /\/upload\/[a-f0-9-]{36}$/);
  assert.equal(uploadRequest.options.headers.Authorization, "Bearer private-token");
  assert.equal(uploadRequest.options.headers["Content-Type"], "video/mp4");
  assert.equal(
    providerPayload.input_references[0].video_url.url,
    uploadRequest.url.replace("/upload/", "/media/"),
  );
  const config = await request(runtime.app).get("/api/config");
  assert.equal(config.body.videoUploadsConfigured, true);
  assert.equal(config.body.videoUploadTransport, "cloudflare_worker");
});
