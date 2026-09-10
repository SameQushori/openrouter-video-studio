import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";
test("collections create/update/persist/delete, validate and stay out of job history", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-collections-"));
  let store = createStore(dir),
    runtime = createApp({ store, provider: {} });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(
    (
      await request(runtime.app)
        .post("/api/collections")
        .send({ title: " ", content: "test" })
    ).status,
    400,
  );
  let r = await request(runtime.app)
    .post("/api/collections")
    .send({ title: "Промпт", content: "строка 1\nстрока 2" });
  assert.equal(r.status, 201);
  const id = r.body.id;
  r = await request(runtime.app)
    .put("/api/collections/" + id)
    .send({ title: "Новое имя", content: "Обновлённый промпт" });
  assert.equal(r.status, 200);
  runtime.close();
  store.close();
  store = createStore(dir);
  runtime = createApp({ store, provider: {} });
  assert.equal(
    (await request(runtime.app).get("/api/collections")).body.data[0].content,
    "Обновлённый промпт",
  );
  assert.equal(
    (await request(runtime.app).get("/api/jobs")).body.data.length,
    0,
  );
  assert.equal(
    (await request(runtime.app).delete("/api/collections/" + id)).status,
    204,
  );
  assert.equal(
    (await request(runtime.app).get("/api/collections")).body.data.length,
    0,
  );
});
