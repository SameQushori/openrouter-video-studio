import { randomUUID } from "node:crypto";
export function installCollections(app, store) {
  const validate = (body) => {
    if (
      typeof body?.title !== "string" ||
      !body.title.trim() ||
      body.title.length > 160 ||
      typeof body.content !== "string" ||
      !body.content.trim() ||
      body.content.length > 50000
    )
      throw Object.assign(
        new Error(
          "Укажите название (до 160 символов) и промпт (до 50000 символов).",
        ),
        { status: 400 },
      );
    return {
      title: body.title.trim(),
      content: body.content,
      updatedAt: new Date().toISOString(),
    };
  };
  app.get("/api/collections", (req, res) =>
    res.json({ data: store.listPrompts() }),
  );
  app.post("/api/collections", (req, res) => {
    const p = { id: randomUUID(), ...validate(req.body) };
    store.putPrompt(p);
    res.status(201).json(p);
  });
  app.put("/api/collections/:id", (req, res) => {
    if (!store.getPrompt(req.params.id))
      return res.status(404).json({ error: "Промпт не найден." });
    const p = { id: req.params.id, ...validate(req.body) };
    store.putPrompt(p);
    res.json(p);
  });
  app.delete("/api/collections/:id", (req, res) => {
    if (!store.getPrompt(req.params.id))
      return res.status(404).json({ error: "Промпт не найден." });
    store.deletePrompt(req.params.id);
    res.sendStatus(204);
  });
}
