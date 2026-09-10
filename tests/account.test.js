import test from "node:test";
import assert from "node:assert/strict";
import { openRouter } from "../server/provider.js";
import { createTransport } from "../server/transport.js";
test("account distinguishes account balance from key spending and never returns key metadata", async () => {
  const p = openRouter(
    "secret",
    async (url) =>
      new Response(
        JSON.stringify({
          data: url.endsWith("/credits")
            ? { total_credits: 25, total_usage: 3 }
            : {
                usage: 2,
                usage_daily: 0.5,
                usage_monthly: 1,
                limit_remaining: 8,
                label: "secret",
              },
        }),
      ),
  );
  const b = await p.account();
  assert.equal(b.balance, 22);
  assert.equal(b.keyUsage, 2);
  assert.equal(b.keyDaily, 0.5);
  assert.equal(b.keyRemaining, 8);
  assert.ok(!JSON.stringify(b).includes("secret"));
});
test("restricted credits remains unavailable, not zero, while key spend works", async () => {
  const p = openRouter("secret", async (url) =>
    url.endsWith("/credits")
      ? new Response("{}", { status: 403 })
      : new Response(JSON.stringify({ data: { usage: 0, usage_daily: 0 } })),
  );
  const b = await p.account();
  assert.equal(b.balance, null);
  assert.equal(b.keyDaily, 0);
  assert.equal(b.errors[0].scope, "balance");
});
test("transport only accepts local HTTP proxies", () => {
  assert.throws(() => createTransport("https://proxy.example"));
  assert.throws(() => createTransport("socks5://127.0.0.1:10808"));
});
