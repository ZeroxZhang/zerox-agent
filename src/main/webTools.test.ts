import { describe, expect, it } from "vitest";
import { createWebTools } from "./webTools";

describe("web tools", () => {
  it("fetches a page and extracts readable text", async () => {
    const tools = createWebTools({
      fetch: async () =>
        new Response(
          `<!doctype html>
          <html>
            <head>
              <title>Example Page</title>
              <style>.hidden { color: red; }</style>
              <script>window.secret = true;</script>
            </head>
            <body>
              <h1>Hello Web</h1>
              <p>This is readable.</p>
            </body>
          </html>`,
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
    });

    await expect(tools.fetchPage("https://example.com/page")).resolves.toEqual({
      ok: true,
      result: {
        url: "https://example.com/page",
        status: 200,
        contentType: "text/html; charset=utf-8",
        title: "Example Page",
        text: "Hello Web This is readable.",
      },
    });
  });

  it("returns a structured error for invalid URLs and non-2xx responses", async () => {
    const tools = createWebTools({
      fetch: async () => new Response("Not found", { status: 404 }),
    });

    await expect(tools.fetchPage("not a url")).resolves.toEqual({
      ok: false,
      error: "web_fetch URL must be a valid http(s) URL.",
    });
    await expect(tools.fetchPage("https://example.com/missing")).resolves.toEqual({
      ok: false,
      error: "web_fetch returned HTTP 404.",
    });
  });

  it("searches DuckDuckGo Lite and unwraps result URLs", async () => {
    const requestedUrls: string[] = [];
    const tools = createWebTools({
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return new Response(
          `
          <html>
            <body>
              <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide" class='result-link'>Example Guide</a>
              <td class="result-snippet">A useful guide about agents.</td>
              <a class="result-link" href="https://docs.example.com/page">Docs Page</a>
              <td class="result-snippet">Reference docs.</td>
            </body>
          </html>`,
          {
            status: 200,
            headers: { "content-type": "text/html" },
          },
        );
      },
    });

    await expect(tools.search("agent memory")).resolves.toEqual({
      ok: true,
      result: {
        query: "agent memory",
        results: [
          {
            title: "Example Guide",
            url: "https://example.com/guide",
            snippet: "A useful guide about agents.",
          },
          {
            title: "Docs Page",
            url: "https://docs.example.com/page",
            snippet: "Reference docs.",
          },
        ],
      },
    });
    expect(requestedUrls[0]).toBe(
      "https://lite.duckduckgo.com/lite/?q=agent%20memory",
    );
  });

  it("returns a structured error when search fetch fails", async () => {
    const tools = createWebTools({
      fetch: async () => {
        throw new Error("network down");
      },
    });

    await expect(tools.search("agent memory")).resolves.toEqual({
      ok: false,
      error: "web_search failed: network down",
    });
  });
});
