import { useEffect, useState } from "react";
const usd = (value) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value)
    : "Unavailable";
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
    <section className="account" aria-label="Balance and usage">
      <div className="accountGrid">
        <div>
          <small>
            {data?.demo ? "Demo · no charges" : "Account balance"}
          </small>
          <strong>{data ? usd(data.balance) : "Loading…"}</strong>
        </div>
        <div>
          <small>Key usage · today UTC</small>
          <strong>{data ? usd(data.keyDaily) : "—"}</strong>
        </div>
        <div>
          <small>Key usage · all time</small>
          <strong>{data ? usd(data.keyUsage) : "—"}</strong>
        </div>
        <div>
          <small>Studio video and analysis</small>
          <strong>{data ? usd(data.studioUsage) : "—"}</strong>
        </div>
      </div>
      <details>
        <summary>Usage and token accounting</summary>
        <p>
          Key usage this month: {usd(data?.keyMonthly)}. Remaining key limit:{" "}
          {data?.keyRemaining == null
            ? "not set or unavailable"
            : usd(data.keyRemaining)}
          .
        </p>
        <p>
          For video, the API returns the cost in USD but no text-token count.
          Each video's cost appears after generation. Studio usage includes only
          saved jobs with reported costs; key usage also includes other apps.
        </p>
        {data?.unreportedJobs > 0 && (
          <p>
            Jobs without a reported cost: {data.unreportedJobs} completed jobs.
          </p>
        )}
        {data?.errors?.map((e, i) => (
          <p key={i}>{e.message}</p>
        ))}
        {data?.checkedAt && (
          <p>
            Updated: {new Date(data.checkedAt).toLocaleTimeString("en-US")}.
            Checked every 30 seconds.
          </p>
        )}
      </details>
      {error && (
        <p className="error" role="alert">
          Could not update balance: {error}
        </p>
      )}
    </section>
  );
}
