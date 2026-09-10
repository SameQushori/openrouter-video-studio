import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { publicUrl } from "../server/assets.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
test("uploads, references, validation and persistent history", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-assets-"));
  let store = createStore(dir),
    payload;
  const provider = {
    models: async () => [{ id: "a", supported_frame_images: ["first_frame"] }],
    submit: async (p) => {
      payload = p;
      return { id: "remote", status: "pending" };
    },
  };
  const args = {
    provider,
    store,
    assetDir: path.join(dir, "uploads"),
    assetBaseUrl: "https://media.example",
    overrides: {
      a: { references: ["image", "video"], source: "test fixture" },
    },
  };
  let runtime = createApp(args);
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const file = await request(runtime.app)
    .post("/api/uploads")
    .attach("file", png, "frame.png");
  assert.equal(file.status, 201);
  assert.equal(
    (await request(runtime.app).get(file.body.previewUrl)).status,
    200,
  );
  assert.equal(
    (await request(runtime.app).get(`/media/${file.body.id}.json`)).status,
    404,
  );
  assert.equal(
    (
      await request(runtime.app)
        .post("/api/uploads")
        .attach("file", Buffer.from("<script>"), "fake.png")
    ).status,
    400,
  );
  const submit = (body) =>
    request(runtime.app)
      .post("/api/jobs")
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ model: "a", prompt: "test", ...body });
  assert.equal(
    (await submit({ firstFrame: { assetId: file.body.id } })).status,
    202,
  );
  assert.equal(payload.frame_images[0].frame_type, "first_frame");
  assert.match(
    payload.frame_images[0].image_url.url,
    /https:\/\/media.example\/media\//,
  );
  assert.equal(
    (
      await submit({
        references: [{ kind: "video", url: "https://media.example/video.mp4" }],
      })
    ).status,
    202,
  );
  assert.equal(payload.input_references[0].type, "video_url");
  assert.equal(
    (
      await submit({
        firstFrame: { assetId: file.body.id },
        references: [{ kind: "image", url: "https://a.example/ref.png" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await submit({
        references: [{ kind: "audio", url: "https://a.example/ref.mp3" }],
      })
    ).status,
    400,
  );
  runtime.close();
  store.close();
  store = createStore(dir);
  runtime = createApp({ ...args, store });
  assert.equal(
    (await request(runtime.app).get("/api/jobs")).body.data.length,
    2,
  );
});
test("reject local and credential-bearing URLs", () => {
  for (const url of [
    "http://x.example/a",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://user:pass@cdn.example/a",
  ])
    assert.throws(() => publicUrl(url));
});
