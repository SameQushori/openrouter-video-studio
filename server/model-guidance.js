const ratings = {
  "google/veo-3.1": 3,
  "bytedance/seedance-2.5": 3,
  "alibaba/wan-3.0": 3,
  "openai/sora-2-pro": 3,
  "black-forest-labs/flux-3-video": 3,
  "minimax/hailuo-3-max": 3,
  "alibaba/wan-3.0-prime": 2,
  "google/veo-3.1-fast": 2,
  "bytedance/seedance-2.0": 2,
  "bytedance/seedance-2.0-fast": 2,
  "kwaivgi/kling-v3.0-pro": 2,
  "runway/gen-4.5": 2,
};

export function modelGuidance(id) {
  const notes = [];
  if (id.startsWith("bytedance/seedance"))
    notes.push(
      "Generating people from text is supported. A reference containing an identifiable real person may be rejected by the provider's privacy or safety filter; false positives are possible.",
    );
  if (id === "bytedance/seedance-2.0-fast")
    notes.push(
      "Multimodal images and video are confirmed, but video references require a compatible provider route. One-to-one motion transfer is not guaranteed.",
    );
  if (id === "minimax/hailuo-3")
    notes.push(
      "OpenRouter explicitly lists video-to-video motion transfer. Upload the required motion video and an optional character image in Studio. The normalized API has no separately confirmed transfer-strength parameter.",
    );
  if (id === "minimax/hailuo-3-max")
    notes.push(
      "H3 Max supports text-to-video, image-to-video, and first/last frames, but OpenRouter does not list video-to-video Motion Control for it. Choose the standard MiniMax H3 for motion transfer.",
    );
  if (["bytedance/seedance-2.0", "bytedance/seedance-2.0-mini", "bytedance/seedance-2.5"].includes(id))
    notes.push(
      "Video can be supplied as a multimodal motion reference. This is reference guidance, not guaranteed frame-by-frame motion transfer; OpenRouter does not publish a separate strength parameter.",
    );
  if (id === "alibaba/wan-3.0")
    notes.push(
      "Reference-guided video with images is supported: Studio allows up to four image references. Video reference is not listed for this model.",
    );
  if (id === "alibaba/wan-3.0-prime")
    notes.push(
      "For Wan 3.0 Prime, OpenRouter lists text-to-video and first-frame image-to-video. Multiple image references and video reference are not confirmed, so first-frame input is limited to 1/1.",
    );
  if (id === "bytedance/seedance-2.5")
    notes.push(
      "The model supports multimodal references. Studio allows up to four images or videos per job. The model page lists a higher provider limit, but Studio currently caps submissions at four.",
    );
  if (id.startsWith("kwaivgi/kling-"))
    notes.push(
      "The current Kling route has a 2,500-character prompt limit. Reduce long JSON to the scene, actions, camera, and lighting.",
    );
  if (id.startsWith("google/veo-3.1"))
    notes.push(
      "Duration can only be selected from published values. 4K and audio are available only when listed for the selected model version.",
    );
  if (id === "openai/sora-2-pro")
    notes.push(
      "The current catalog does not list first-frame input, so Studio only shows confirmed modes.",
    );
  return {
    stars: ratings[id] || 0,
    guidance: notes,
    guidanceSource: `https://openrouter.ai/${id}`,
  };
}
