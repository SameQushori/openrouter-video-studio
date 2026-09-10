function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractGenerationPrompts(result) {
  if (typeof result !== "string") return {};
  try {
    const parsed = JSON.parse(result);
    const generated = parsed?.generation_prompts;
    const wanPrompt = text(generated?.wan?.prompt);
    const wanNegative = text(generated?.wan?.negative_prompt);
    return {
      wan: wanPrompt
        ? `${wanPrompt}${wanNegative ? `\n\nNegative prompt: ${wanNegative}` : ""}`
        : null,
      minimaxImage: text(generated?.minimax_h3?.image_to_video_prompt),
      minimaxMotion: text(
        generated?.minimax_h3?.full_reference_motion_prompt,
      ),
    };
  } catch {
    return {};
  }
}
