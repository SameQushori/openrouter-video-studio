import test from "node:test";
import assert from "node:assert/strict";
import { extractGenerationPrompts } from "../src/analysis-result.js";

test("extracts model-specific prompts from universal analysis", () => {
  const value = extractGenerationPrompts(
    JSON.stringify({
      generation_prompts: {
        wan: { prompt: "Generate single shot.", negative_prompt: "warping" },
        minimax_h3: {
          image_to_video_prompt: "For the target video...",
          full_reference_motion_prompt: "subject_definitions: ...",
        },
      },
    }),
  );
  assert.equal(value.wan, "Generate single shot.\n\nNegative prompt: warping");
  assert.equal(value.minimaxImage, "For the target video...");
  assert.equal(value.minimaxMotion, "subject_definitions: ...");
});

test("returns no derived prompts for legacy or invalid output", () => {
  assert.deepEqual(extractGenerationPrompts("not-json"), {});
  assert.equal(
    extractGenerationPrompts('{"scene_events":[]}').wan,
    null,
  );
});
