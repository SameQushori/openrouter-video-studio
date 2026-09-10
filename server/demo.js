import { randomUUID } from "node:crypto";
export function demoProvider() {
  return {
    models: async () => [
      {
        id: "demo/studio",
        name: "Studio Demo · без списаний",
        description:
          "Тестовая модель для проверки интерфейса. Реальная генерация отключена.",
        supported_durations: [4, 8],
        supported_resolutions: ["720p", "1080p"],
        supported_aspect_ratios: ["16:9", "9:16", "1:1"],
        supported_frame_images: ["first_frame"],
        generate_audio: true,
      },
    ],
    submit: async () => ({
      id: `demo-${Date.now()}-${randomUUID()}`,
      status: "pending",
    }),
    poll: async (id) => ({
      id,
      status:
        Date.now() - Number(id.split("-")[1]) > 5000
          ? "completed"
          : "in_progress",
      usage: { cost: 0 },
    }),
    content: async () => ({ demo: true }),
  };
}
