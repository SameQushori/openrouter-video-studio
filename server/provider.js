const BASE = "https://openrouter.ai/api/v1";
export function openRouter(apiKey, fetcher = fetch) {
  async function request(path, options = {}) {
    if (!apiKey)
      throw Object.assign(
        new Error("Add OPENROUTER_API_KEY to .env and restart the server."),
        { status: 503 },
      );
    let response;
    try {
      response = await fetcher(BASE + path, {
        ...options,
        redirect: "error",
        signal: options.signal || AbortSignal.timeout(45000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch {
      throw Object.assign(
        new Error("OpenRouter did not respond. Check your connection."),
        { status: 502, uncertain: options.method === "POST" },
      );
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = String(
        data.error?.message || `OpenRouter: HTTP ${response.status}`,
      ).replaceAll(apiKey, "[redacted]");
      throw Object.assign(new Error(message), {
        status: response.status,
        uncertain: options.method === "POST" && response.status >= 500,
      });
    }
    return response;
  }
  return {
    analysisModels: async () => (await (await request("/models")).json()).data,
    analyze: async (body) => {
      const response = await request("/chat/completions", {
        method: "POST",
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240000),
      });
      try {
        return await response.json();
      } catch {
        throw Object.assign(
          new Error(
            "The analysis response could not be read. Check usage before retrying.",
          ),
          { uncertain: true },
        );
      }
    },
    account: async () => {
      const results = await Promise.allSettled([
        request("/credits")
          .then((r) => r.json())
          .then((b) => b.data),
        request("/key")
          .then((r) => r.json())
          .then((b) => b.data),
      ]);
      const credits =
        results[0].status === "fulfilled" ? results[0].value : null;
      const key = results[1].status === "fulfilled" ? results[1].value : null;
      const number = (v) =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      return {
        balance:
          number(credits?.total_credits) !== null &&
          number(credits?.total_usage) !== null
            ? credits.total_credits - credits.total_usage
            : null,
        accountUsage: number(credits?.total_usage),
        keyUsage: number(key?.usage),
        keyDaily: number(key?.usage_daily),
        keyMonthly: number(key?.usage_monthly),
        keyRemaining: number(key?.limit_remaining),
        errors: results.flatMap((r, i) =>
          r.status === "rejected"
            ? [
                {
                  scope: i === 0 ? "balance" : "key",
                  message:
                    r.reason.status === 403 && i === 0
                      ? "The account balance is unavailable for this key. OpenRouter may require a management key."
                      : r.reason.message,
                },
              ]
            : [],
        ),
        checkedAt: new Date().toISOString(),
      };
    },
    models: async () => (await (await request("/videos/models")).json()).data,
    submit: async (body) => {
      const response = await request("/videos", {
        method: "POST",
        body: JSON.stringify(body),
      });
      try {
        return await response.json();
      } catch {
        throw Object.assign(
          new Error(
            "The submission response could not be read. Check OpenRouter before sending another request.",
          ),
          { uncertain: true },
        );
      }
    },
    poll: async (id) =>
      (await request(`/videos/${encodeURIComponent(id)}`)).json(),
    // Use the canonical endpoint, never a user-supplied download/poll URL.
    content: async (id, range) => {
      const path = `/videos/${encodeURIComponent(id)}/content?index=0`;
      const response = await fetcher(BASE + path, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(range ? { Range: range } : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(120000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = new URL(response.headers.get("location"), BASE);
        if (
          location.protocol !== "https:" ||
          location.username ||
          location.password
        )
          throw new Error("Invalid video URL.");
        // Redirect is handed to the browser: the API key never leaves OpenRouter.
        return { redirect: location.href };
      }
      if (!response.ok)
        throw Object.assign(
          new Error(
            `Video unavailable: HTTP ${response.status}. The URL may have expired.`,
          ),
          { status: response.status },
        );
      return { response };
    },
  };
}
