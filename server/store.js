import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "studio.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updatedAt TEXT NOT NULL)",
  );
  return {
    listPrompts: () =>
      db.prepare("SELECT * FROM prompts ORDER BY updatedAt DESC").all(),
    getPrompt: (id) => db.prepare("SELECT * FROM prompts WHERE id=?").get(id),
    putPrompt: (p) =>
      db
        .prepare(
          "INSERT INTO prompts (id,title,content,updatedAt) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,updatedAt=excluded.updatedAt",
        )
        .run(p.id, p.title, p.content, p.updatedAt),
    deletePrompt: (id) => db.prepare("DELETE FROM prompts WHERE id=?").run(id),
    list: () =>
      db
        .prepare("SELECT body FROM jobs ORDER BY rowid DESC")
        .all()
        .map((x) => JSON.parse(x.body)),
    get: (id) => {
      const row = db.prepare("SELECT body FROM jobs WHERE id=?").get(id);
      return row && JSON.parse(row.body);
    },
    put: (job) =>
      db
        .prepare(
          "INSERT INTO jobs(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        )
        .run(job.id, JSON.stringify(job)),
    close: () => db.close(),
  };
}
