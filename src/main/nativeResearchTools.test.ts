import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNativeResearchTools } from "./nativeResearchTools";

describe("native research tools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-research-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createTools() {
    return createNativeResearchTools({
      now: () => new Date("2026-06-10T00:00:00.000Z"),
      webTools: {
        async fetchPage(url) {
          return {
            ok: true,
            result: {
              url,
              status: 200,
              contentType: "text/html",
              title: "Harness Guide",
              text: "Harness tracks deterministic eval results.",
            },
          };
        },
        async search(query) {
          return { ok: true, result: { query, results: [] } };
        },
      },
    });
  }

  it("fetches a normalized web document with a citation seed", async () => {
    const tools = createTools();

    await expect(
      tools.webFetchDocument({ url: "https://docs.example.com/guide" }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        document: {
          url: "https://docs.example.com/guide",
          title: "Harness Guide",
          text: "Harness tracks deterministic eval results.",
          fetchedAt: "2026-06-10T00:00:00.000Z",
        },
        citationSeed: {
          url: "https://docs.example.com/guide",
          title: "Harness Guide",
          accessedAt: "2026-06-10T00:00:00.000Z",
        },
      },
    });
  });

  it("records citation evidence separately from report prose", async () => {
    const tools = createTools();

    await expect(
      tools.citationRecord({
        id: "src_docs",
        url: "https://docs.example.com/guide",
        title: "Harness Guide",
        quote: "Harness tracks deterministic eval results.",
        accessedAt: "2026-06-10T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        citation: {
          id: "src_docs",
          url: "https://docs.example.com/guide",
          title: "Harness Guide",
        },
        evidence: {
          citationId: "src_docs",
          quotePreview: "Harness tracks deterministic eval results.",
          quoteHash: expect.any(String),
        },
      },
    });
  });

  it("writes Markdown and a citation sidecar when coverage passes", async () => {
    const tools = createTools();
    const reportPath = path.join(tempDir, "agent-capability.md");

    const result = await tools.markdownReportWrite({
      path: reportPath,
      title: "Agent Capability Research",
      generatedAt: "2026-06-10T00:00:00.000Z",
      citations: [
        {
          id: "src_docs",
          url: "https://docs.example.com/guide",
          title: "Harness Guide",
          accessedAt: "2026-06-10T00:00:00.000Z",
          quote: "Harness tracks deterministic eval results.",
        },
      ],
      claims: [
        {
          id: "fact_1",
          kind: "sourced_fact",
          text: "Harness tracks deterministic eval results.",
          citationIds: ["src_docs"],
        },
        {
          id: "inference_1",
          kind: "model_inference",
          text: "This likely reduces review drift.",
          citationIds: [],
        },
      ],
      sections: [{ heading: "Findings", claimIds: ["fact_1", "inference_1"] }],
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        path: reportPath,
        citationsPath: path.join(tempDir, "agent-capability.citations.json"),
        coverage: { ok: true, unsupportedClaimIds: [] },
      },
    });
    await expect(readFile(reportPath, "utf8")).resolves.toContain(
      "### Sourced Facts",
    );
    const sidecar = JSON.parse(
      await readFile(path.join(tempDir, "agent-capability.citations.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      citations: [{ id: "src_docs" }],
      claims: [{ id: "fact_1" }, { id: "inference_1" }],
      coverage: { ok: true },
    });
  });

  it("refuses to write reports with unsupported sourced claims", async () => {
    const tools = createTools();
    const reportPath = path.join(tempDir, "unsupported.md");

    const result = await tools.markdownReportWrite({
      path: reportPath,
      title: "Unsupported Report",
      citations: [],
      claims: [
        {
          id: "fact_1",
          kind: "sourced_fact",
          text: "This fact has no source.",
          citationIds: [],
        },
      ],
      sections: [{ heading: "Findings", claimIds: ["fact_1"] }],
    });

    expect(result).toEqual({
      ok: false,
      error: "markdown_report_write refused unsupported sourced claims.",
      errorDetails: {
        unsupportedClaimIds: ["fact_1"],
      },
    });
  });
});
