import { ProxyAgent, fetch as proxyFetch } from "undici";

export function createTransport(proxyUrl) {
  if (!proxyUrl) return { fetcher: fetch, close: async () => {} };
  const url = new URL(proxyUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "OPENROUTER_PROXY_URL must point to a local HTTP proxy.",
    );
  }
  const dispatcher = new ProxyAgent(url.href);
  return {
    fetcher: (url, options) => proxyFetch(url, { ...options, dispatcher }),
    close: () => dispatcher.close(),
  };
}
