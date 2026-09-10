import { useEffect, useState } from "react";
async function api(url, options) {
  const r = await fetch(url, options);
  if (r.status === 204) return null;
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Ошибка запроса");
  return b;
}
export function Collections() {
  const [items, setItems] = useState([]),
    [id, setId] = useState(null),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setItems((await api("/api/collections")).data);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function select(item) {
    if (dirty && !window.confirm("Перейти без сохранения изменений?")) return;
    setId(item?.id || null);
    setTitle(item?.title || "");
    setContent(item?.content || "");
    setDirty(false);
    setError("");
    setMessage("");
  }
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const p = await api(id ? `/api/collections/${id}` : "/api/collections", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      setId(p.id);
      setDirty(false);
      setMessage("Сохранено");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Удалить «${title}» из коллекции?`)) return;
    setBusy(true);
    try {
      await api(`/api/collections/${id}`, { method: "DELETE" });
      setId(null);
      setTitle("");
      setContent("");
      setDirty(false);
      setMessage("Удалено");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <section>
        <div className="sectionTitle">
          <h2>Коллекции</h2>
          <span>{items.length} промптов</span>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => select(null)}
        >
          + Новый промпт
        </button>
        <p className="hint">
          Личная библиотека. Сохраняется на компьютере и доступна в обычном и
          деморежиме.
        </p>
        <div className="collectionList">
          {items.map((p) => (
            <button
              key={p.id}
              className={`historyRow ${p.id === id ? "selected" : ""}`}
              disabled={busy}
              onClick={() => select(p)}
            >
              <span className="historyText">
                <strong>{p.title}</strong>
                <small>{p.content.slice(0, 110)}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>{id ? "Редактировать промпт" : "Новый промпт"}</h2>
        <form onSubmit={save}>
          <fieldset disabled={busy} className="inputs">
            <label>
              Название
              <input
                value={title}
                maxLength={160}
                required
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                  setMessage("");
                }}
              />
            </label>
            <label>
              Содержание
              <textarea
                rows={18}
                value={content}
                maxLength={50000}
                required
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                  setMessage("");
                }}
                placeholder="Ваш промпт…"
              />
            </label>
            <button
              className="primary"
              disabled={!title.trim() || !content.trim()}
            >
              {busy ? "Сохраняется…" : "Сохранить"}
            </button>
            <div className="promptToolbar">
              <button
                type="button"
                disabled={!content}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(content);
                    setMessage("Скопировано");
                  } catch {
                    setError("Выделите и скопируйте текст вручную.");
                  }
                }}
              >
                Копировать
              </button>
              {id && (
                <button type="button" onClick={remove}>
                  Удалить
                </button>
              )}
            </div>
          </fieldset>
        </form>
        <p className="hint" role="status">
          {dirty ? "Есть несохранённые изменения" : message}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
