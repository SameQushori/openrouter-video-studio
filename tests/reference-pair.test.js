import test from "node:test";
import assert from "node:assert/strict";
import { attachAssets } from "../server/assets.js";

test("motion control accepts one video and an optional character image", async () => {
  const image = { kind: "image", url: "https://media.example/character.png" };
  const video = { kind: "video", url: "https://media.example/motion.mp4" };
  const model = { frames: ["first_frame"], references: ["image", "video"], motionControl: "video_to_video" };
  const assets = { resolve: async (item) => item };
  const input = { referenceMode: "motion_control", references: [image, video] };
  const result = await attachAssets(input, model, {}, assets);
  assert.deepEqual(result.input_references, [
    { type: "image_url", image_url: { url: image.url } },
    { type: "video_url", video_url: { url: video.url } },
  ]);
  assert.equal(result.frame_images, undefined);
  assert.deepEqual(
    (await attachAssets({ ...input, references: [video] }, model, {}, assets)).input_references,
    [{ type: "video_url", video_url: { url: video.url } }],
  );
  for (const references of [[], [image], [image, image], [video, video], [video, image, image]]) {
    await assert.rejects(() => attachAssets({ ...input, references }, model, {}, assets), { status: 400 });
  }
  await assert.rejects(() => attachAssets({ ...input, firstFrame: image }, model, {}, assets), { status: 400 });
  await assert.rejects(() => attachAssets(input, { ...model, motionControl: null }, {}, assets), { status: 400 });
  await assert.rejects(() => attachAssets(input, { ...model, references: ["image"] }, {}, assets), { status: 400 });
  // Trust the actual uploaded file type, not a client's claimed kind.
  await assert.rejects(() => attachAssets(input, model, {}, { resolve: async () => video }), { status: 400 });
});
