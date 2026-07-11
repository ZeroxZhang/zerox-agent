export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

export type WebToolResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export type WebTools = {
  fetchPage(url: string): Promise<WebToolResult>;
  search(query: string): Promise<WebToolResult>;
};

const duckDuckGoLiteUrl = "https://lite.duckduckgo.com/lite/";
const userAgent =
  "BuildingAgent/0.1 (+https://localhost; local desktop agent MVP)";

// v3.6.0: Maximum response body size (5 MB) to prevent memory exhaustion
// from malicious or excessively large responses.
const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;

// v3.6.0: Private / internal / loopback / link-local IP blocks (SSRF protection).
// These must never be accessible via web_fetch.
const BLOCKED_IP_PATTERNS: ReadonlyArray<{
  label: string;
  test: (hostname: string) => boolean;
}> = [
  {
    label: "loopback",
    test: (h) => {
      const lowered = h.toLowerCase();
      return (
        lowered === "localhost" ||
        lowered === "127.0.0.1" ||
        lowered === "::1" ||
        lowered === "0.0.0.0"
      );
    },
  },
  {
    label: "link-local",
    test: (h) =>
      /^169\.254\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^fe80:/i.test(h),
  },
  {
    label: "private-a",
    test: (h) => /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h),
  },
  {
    label: "private-b",
    test: (h) => /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h),
  },
  {
    label: "private-c",
    test: (h) => /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h),
  },
];

function isBlockedHostname(hostname: string): string | null {
  // Strip IPv6 brackets from hostname before checking (URL constructor
  // preserves [brackets] for IPv6 addresses like [fe80::1]).
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(normalized)) {
      return pattern.label;
    }
  }
  return null;
}

export function createWebTools(options?: { fetch?: typeof fetch }): WebTools {
  const fetchImpl = options?.fetch ?? fetch;

  return {
    async fetchPage(url) {
      const parsedUrl = parseHttpUrl(url);
      if (!parsedUrl) {
        return {
          ok: false,
          error: "web_fetch URL must be a valid http(s) URL.",
        };
      }

      // v3.6.0: SSRF protection — block private/internal/loopback IPs
      const blockedReason = isBlockedHostname(parsedUrl.hostname);
      if (blockedReason) {
        return {
          ok: false,
          error: `web_fetch blocked: ${parsedUrl.hostname} is a ${blockedReason} address. Internal network access is not permitted.`,
        };
      }

      try {
        const response = await fetchImpl(parsedUrl.toString(), {
          headers: { "User-Agent": userAgent },
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `web_fetch returned HTTP ${response.status}.`,
          };
        }

        const contentType = response.headers.get("content-type") ?? "";

        // v3.6.0: Stream response body with size cap (5 MB)
        const reader = response.body?.getReader();
        if (!reader) {
          const raw = await response.text();
          const title = extractTitle(raw);
          const text = contentType.includes("html")
            ? htmlToText(raw)
            : normalizeWhitespace(raw);
          return {
            ok: true,
            result: {
              url: parsedUrl.toString(),
              status: response.status,
              contentType,
              title,
              text: truncate(text, 24_000),
            },
          };
        }

        const decoder = new TextDecoder();
        let raw = "";
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
                reader.cancel();
                raw += decoder.decode(value, { stream: true });
                raw = raw.slice(0, MAX_RESPONSE_BODY_BYTES);
                raw += "\n\n[web_fetch: response truncated at 5 MB limit]";
                break;
              }
              raw += decoder.decode(value, { stream: true });
            }
          }
        } finally {
          reader.releaseLock();
        }

        const title = extractTitle(raw);
        const text = contentType.includes("html")
          ? htmlToText(raw)
          : normalizeWhitespace(raw);

        return {
          ok: true,
          result: {
            url: parsedUrl.toString(),
            status: response.status,
            contentType,
            title,
            text: truncate(text, 24_000),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: `web_fetch failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    },

    async search(query) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return { ok: false, error: "web_search query is required." };
      }

      try {
        const url = `${duckDuckGoLiteUrl}?q=${encodeURIComponent(
          normalizedQuery,
        )}`;
        const response = await fetchImpl(url, {
          headers: { "User-Agent": userAgent },
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `web_search returned HTTP ${response.status}.`,
          };
        }

        const html = await response.text();

        return {
          ok: true,
          result: {
            query: normalizedQuery,
            results: parseDuckDuckGoLiteResults(html).slice(0, 8),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: `web_search failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    },
  };
}

function parseDuckDuckGoLiteResults(html: string): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const snippetPattern =
    /<td\b[^>]*class=["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;
  const snippets = [...html.matchAll(snippetPattern)].map((match) =>
    htmlToText(match[1] ?? ""),
  );
  let index = 0;

  for (const match of html.matchAll(linkPattern)) {
    const attributes = match[1] ?? "";
    if (!/\bclass=["'][^"']*result-link[^"']*["']/i.test(attributes)) {
      continue;
    }

    const href = decodeHtmlEntities(
      attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "",
    );
    const title = htmlToText(match[2] ?? "");
    const url = unwrapDuckDuckGoUrl(href);

    if (!title || !url) {
      continue;
    }

    results.push({
      title,
      url,
      snippet: snippets[index] ?? "",
    });
    index += 1;
  }

  return results;
}

function unwrapDuckDuckGoUrl(value: string): string {
  const withProtocol = value.startsWith("//") ? `https:${value}` : value;

  try {
    const parsed = new URL(withProtocol);
    const unwrapped = parsed.searchParams.get("uddg");
    return unwrapped ? decodeURIComponent(unwrapped) : parsed.toString();
  } catch {
    return "";
  }
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        // v3.6.0: Strip CSS-hidden content before converting to text (SEC-11).
        // This removes elements hidden via display:none, visibility:hidden,
        // opacity:0, and HTML hidden attribute — preventing prompt injection
        // through content invisible to users but visible to LLMs.
        .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+?\b(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
        .replace(/<[^>]+?\bhidden\b[^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? htmlToText(match[1]) : "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
