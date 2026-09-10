const idPattern = /^[a-f0-9-]{36}$/;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function equalSecret(actual, expected) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET")
      return new Response(`<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Video Studio Media</title>
<style>body{margin:0;background:#111318;color:#eef2f6;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{max-width:520px;padding:32px;border:1px solid #343a44;border-radius:18px;background:#1b1f26}h1{margin-top:0}p{color:#b9c2cf;line-height:1.55}a{display:inline-block;margin-top:10px;padding:12px 18px;border-radius:10px;background:#94b84b;color:#10140a;text-decoration:none;font-weight:700}</style>
<main class="card"><h1>Video Studio Media работает</h1><p>Это служебное хранилище для временных видеореференсов. Файлы доступны только по индивидуальным ссылкам и автоматически удаляются через 24 часа.</p><a href="http://127.0.0.1:3001/">Вернуться в Video Studio</a></main></html>`, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ready: true });

    const upload = url.pathname.match(/^\/upload\/([a-f0-9-]{36})$/);
    if (upload && request.method === "PUT") {
      const authorization = request.headers.get("authorization") || "";
      const suppliedToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
      if (!(await equalSecret(suppliedToken, env.MEDIA_UPLOAD_TOKEN)))
        return json({ error: "Unauthorized" }, 401);
      if (request.headers.get("content-type") !== "video/mp4")
        return json({ error: "Only video/mp4 is accepted" }, 415);
      const length = Number(request.headers.get("content-length") || 0);
      if (!length || length > 25 * 1024 * 1024)
        return json({ error: "File must be between 1 byte and 25 MiB" }, 413);
      await env.MEDIA.put(upload[1], request.body, {
        expirationTtl: 86400,
        metadata: { contentType: "video/mp4" },
      });
      return json({ url: `${url.origin}/media/${upload[1]}` }, 201);
    }

    const media = url.pathname.match(/^\/media\/([a-f0-9-]{36})$/);
    if (media && request.method === "GET" && idPattern.test(media[1])) {
      const object = await env.MEDIA.getWithMetadata(media[1], "stream");
      if (!object.value) return new Response("Not found", { status: 404 });
      return new Response(object.value, {
        headers: {
          "Content-Type": object.metadata?.contentType || "video/mp4",
          "Content-Disposition": "inline",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
