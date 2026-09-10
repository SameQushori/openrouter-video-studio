import { useEffect, useState } from "react";
const usd = (value) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value)
    : "Недоступно";
export function Account() {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      timer;
    async function refresh() {
      try {
        const r = await fetch("/api/account");
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (active) {
          setData(b);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) timer = setTimeout(refresh, 30000);
      }
    }
    refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="account" aria-label="Баланс и расходы">
      <div className="accountGrid">
        <div>
          <small>
            {data?.demo ? "Демо · без списаний" : "Баланс аккаунта"}
          </small>
          <strong>{data ? usd(data.balance) : "Загрузка…"}</strong>
        </div>
        <div>
          <small>Расход ключа · сегодня UTC</small>
          <strong>{data ? usd(data.keyDaily) : "—"}</strong>
        </div>
        <div>
          <small>Расход ключа · всего</small>
          <strong>{data ? usd(data.keyUsage) : "—"}</strong>
        </div>
        <div>
          <small>Видео и анализы студии</small>
          <strong>{data ? usd(data.studioUsage) : "—"}</strong>
        </div>
      </div>
      <details>
        <summary>Учёт расходов и токенов</summary>
        <p>
          Расход ключа за месяц: {usd(data?.keyMonthly)}. Остаток лимита ключа:{" "}
          {data?.keyRemaining == null
            ? "не задан или недоступен"
            : usd(data.keyRemaining)}
          .
        </p>
        <p>
          Для видео API возвращает стоимость в $, но не счётчик текстовых
          токенов. Стоимость каждого ролика появится после генерации. Сумма
          студии учитывает только сохранённые задания с известной стоимостью;
          расходы ключа включают другие приложения.
        </p>
        {data?.unreportedJobs > 0 && (
          <p>
            Без отчёта о стоимости: {data.unreportedJobs} завершённых заданий.
          </p>
        )}
        {data?.errors?.map((e, i) => (
          <p key={i}>{e.message}</p>
        ))}
        {data?.checkedAt && (
          <p>
            Обновлено: {new Date(data.checkedAt).toLocaleTimeString("ru")}.
            Проверка каждые 30 секунд.
          </p>
        )}
      </details>
      {error && (
        <p className="error" role="alert">
          Не удалось обновить баланс: {error}
        </p>
      )}
    </section>
  );
}
