import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createStore } from "../server/store.js";
import { createApp } from "../server/app.js";
import { openRouter } from "../server/provider.js";
import { normalizeModel } from "../server/capabilities.js";
const raw = {
  id: "test/video",
  supported_durations: [4],
  supported_resolutions: ["720p"],
  supported_aspect_ratios: ["16:9"],
};
function fixture(t, custom = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
  const store = createStore(dir);
  let submissions = 0;
  const provider = {
    models: async () => [raw],
    submit: async () => {
      submissions++;
      return { id: "remote-1", status: "pending" };
    },
    poll: async () => ({ status: "completed", usage: { cost: 0.1 } }),
    content: async () => ({
      response: new Response(Buffer.from("test-video"), {
        headers: { "content-type": "video/mp4" },
      }),
    }),
    ...custom,
  };
  const runtime = createApp({ provider, store, pollMs: 1e9 });
  t.after(() => {
    runtime.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...runtime, store, submissions: () => submissions };
}
const send = (app, key = "test-request-1234", body = {}) =>
  request(app)
    .post("/api/jobs")
    .set("Idempotency-Key", key)
    .send({ model: raw.id, prompt: "A moving camera", duration: 4, ...body });
test("vertical slice: models, submit, deduplication, polling, download", async (t) => {
  const f = fixture(t);
  const models = await request(f.app).get("/api/models");
  assert.equal(models.body.data[0].durations[0], 4);
  const first = await send(f.app);
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "pending");
  await send(f.app);
  assert.equal(f.submissions(), 1);
  const job = f.store.get(first.body.id);
  job.nextPollAt = 0;
  f.store.put(job);
  await f.tick();
  const history = await request(f.app).get("/api/jobs");
  assert.equal(history.body.data[0].status, "completed");
  const video = await request(f.app).get(
    `/api/jobs/${job.id}/content?download=1`,
  );
  assert.equal(video.status, 200);
  assert.match(video.headers["content-disposition"], /attachment/);
});
test("reject unsupported parameters and cross-origin submits before spending", async (t) => {
  const f = fixture(t);
  assert.equal(
    (await send(f.app, "test-invalid-123", { duration: 99 })).status,
    400,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/jobs")
        .set("Origin", "https://evil.example")
        .send({})
    ).status,
    403,
  );
  assert.equal(f.submissions(), 0);
});
test("Wan 3.0 Prime exposes and enforces its documented 20k prompt limit", async (t) => {
  const wan = { ...raw, id: "alibaba/wan-3.0-prime" };
  const f = fixture(t, { models: async () => [wan] });
  const catalog = await request(f.app).get("/api/models");
  assert.equal(catalog.body.data[0].promptMaxChars, 20_000);
  assert.equal(
    (
      await request(f.app)
        .post("/api/jobs")
        .set("Idempotency-Key", "wan-at-limit-123")
        .send({ model: wan.id, prompt: "a".repeat(20_000), duration: 4 })
    ).status,
    202,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/jobs")
        .set("Idempotency-Key", "wan-over-limit-123")
        .send({ model: wan.id, prompt: "a".repeat(20_001), duration: 4 })
    ).status,
    400,
  );
});
test("catalog exposes model guidance, favorites and observed provider limits", async (t) => {
  const kling = { ...raw, id: "kwaivgi/kling-v3.0-pro" };
  const f = fixture(t, { models: async () => [kling] });
  const model = (await request(f.app).get("/api/models")).body.data[0];
  assert.equal(model.promptMaxChars, 2_500);
  assert.equal(model.stars, 2);
  assert.ok(model.guidance.some((note) => note.includes("2,500")));
  assert.match(model.guidanceSource, /^https:\/\/openrouter\.ai\//);
  assert.equal(
    (
      await request(f.app)
        .post("/api/jobs")
        .set("Idempotency-Key", "kling-over-limit")
        .send({ model: kling.id, prompt: "a".repeat(2_501), duration: 4 })
    ).status,
    400,
  );
});
test("Wan 3.0 exposes four image references while Prime stays first-frame only", () => {
  const overrides = {
    "alibaba/wan-3.0": {
      source: "OpenRouter model page",
      references: ["image"],
      maxReferences: 4,
    },
  };
  const wan = normalizeModel({ ...raw, id: "alibaba/wan-3.0" }, overrides);
  const prime = normalizeModel(
    { ...raw, id: "alibaba/wan-3.0-prime" },
    overrides,
  );
  assert.deepEqual(wan.references, ["image"]);
  assert.equal(wan.maxReferences, 4);
  assert.deepEqual(prime.references, []);
});
test("ambiguous submission is persisted and not retried", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    submit: async () => {
      calls++;
      throw Object.assign(new Error("Timeout"), { uncertain: true });
    },
  });
  assert.equal((await send(f.app)).body.status, "submission_unknown");
  await send(f.app);
  await f.tick();
  assert.equal(calls, 1);
});
test("provider uses documented endpoint and does not follow authenticated redirects", async () => {
  const calls = [];
  const p = openRouter("secret-key", async (url, opts) => {
    calls.push({ url, opts });
    return new Response(null, {
      status: 302,
      headers: { location: "https://cdn.example/video.mp4" },
    });
  });
  assert.deepEqual(await p.content("a/b"), {
    redirect: "https://cdn.example/video.mp4",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /a%2Fb\/content/);
  assert.equal(calls[0].opts.redirect, "manual");
});
test("temporary polling error preserves active job, bounded polling can resume", async (t) => {
  let polls = 0;
  const f = fixture(t, {
    poll: async () => {
      polls++;
      throw new Error("Rate limited");
    },
  });
  const first = await send(f.app);
  let job = f.store.get(first.body.id);
  job.nextPollAt = 0;
  f.store.put(job);
  await f.tick();
  job = f.store.get(job.id);
  assert.equal(job.status, "pending");
  assert.equal(job.pollError, "Rate limited");
  job.pollCount = 120;
  job.nextPollAt = 0;
  f.store.put(job);
  await f.tick();
  assert.equal(f.store.get(job.id).pollPaused, true);
  assert.equal(polls, 1);
  assert.equal(
    (await request(f.app).post(`/api/jobs/${job.id}/resume`)).status,
    200,
  );
  assert.equal(f.store.get(job.id).pollCount, 0);
});
test("cancel stops local polling and is idempotent", async (t) => {
  let polls = 0;
  const f = fixture(t, {
    poll: async () => {
      polls++;
      return { status: "completed" };
    },
  });
  const submitted = await send(f.app, "cancel-request-1234");
  const cancelled = await request(f.app).post(
    `/api/jobs/${submitted.body.id}/cancel`,
  );
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, "cancelled");
  assert.equal(cancelled.body.cancellationScope, "local_tracking");
  assert.match(cancelled.body.cancellationNote, /may continue/);
  assert.equal(
    (await request(f.app).post(`/api/jobs/${submitted.body.id}/cancel`)).status,
    200,
  );
  await f.tick();
  assert.equal(polls, 0);
  assert.equal(f.store.get(submitted.body.id).status, "cancelled");
});
test("cancel can stop a submission before it reaches the provider", async (t) => {
  const f = fixture(t);
  const key = "cancel-before-submit-1234";
  const reserved = await request(f.app).post(`/api/jobs/${key}/cancel`);
  assert.equal(reserved.status, 202);
  assert.equal(reserved.body.cancellationScope, "before_submission");
  const submitted = await send(f.app, key);
  assert.equal(submitted.body.status, "cancelled");
  assert.equal(f.submissions(), 0);
});
test("invalid JSON after accepted POST remains ambiguous; provider errors redact key", async () => {
  const invalid = openRouter("secret", async () => new Response("broken"));
  await assert.rejects(
    () => invalid.submit({}),
    (e) => e.uncertain === true,
  );
  const denied = openRouter(
    "secret",
    async () =>
      new Response(JSON.stringify({ error: { message: "secret denied" } }), {
        status: 401,
      }),
  );
  await assert.rejects(
    () => denied.models(),
    (e) => e.status === 401 && !e.message.includes("secret"),
  );
});
test("concurrent duplicate submissions spend once", async (t) => {
  const f = fixture(t);
  const results = await Promise.all([send(f.app), send(f.app)]);
  assert.equal(f.submissions(), 1);
  assert.ok(results.every((r) => [200, 202].includes(r.status)));
});
