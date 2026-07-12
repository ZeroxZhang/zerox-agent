import { lstat, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";
import type { WebTools } from "./webTools";
import {
  checkCitationCoverage,
  createResearchCitation,
  normalizeReportSections,
  normalizeResearchCitations,
  normalizeResearchClaims,
  renderMarkdownResearchReport,
  stableHash,
} from "../shared/researchWriting";
import { validatePathInsideLocationRoots } from "../shared/locationResource";

export type NativeResearchTools = {
  webFetchDocument(
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<AgentToolExecutionResult>;
  citationRecord(args: Record<string, unknown>): Promise<AgentToolExecutionResult>;
  citationCoverageCheck(
    args: Record<string, unknown>,
  ): Promise<AgentToolExecutionResult>;
  markdownReportWrite(
    args: Record<string, unknown>,
  ): Promise<AgentToolExecutionResult>;
};

export function createNativeResearchTools(options: {
  webTools: WebTools;
  now?: () => Date;
}): NativeResearchTools {
  const now = options.now ?? (() => new Date());

  return {
    async webFetchDocument(args, executionOptions) {
      const url = String(args.url ?? "").trim();
      if (!url) {
        return { ok: false, error: "web_fetch_document requires a url." };
      }

      const fetched = await options.webTools.fetchPage(url, executionOptions);
      if (!fetched.ok) {
        return fetched;
      }

      try {
        const fetchedAt = now().toISOString();
        const documentUrl = String(fetched.result.url ?? url);
        const title = String(fetched.result.title ?? "").trim() || documentUrl;
        const text = String(fetched.result.text ?? "");
        const citationSeed = createResearchCitation({
          url: documentUrl,
          title,
          accessedAt: fetchedAt,
        });

        return {
          ok: true,
          result: {
            document: {
              sourceId: citationSeed.id,
              url: documentUrl,
              title,
              status: fetched.result.status,
              contentType: fetched.result.contentType,
              text,
              fetchedAt,
            },
            citationSeed,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "web_fetch_document failed.",
        };
      }
    },

    async citationRecord(args) {
      try {
        const citation = createResearchCitation({
          id: String(args.id ?? ""),
          url: String(args.url ?? ""),
          title: String(args.title ?? ""),
          accessedAt: args.accessedAt
            ? String(args.accessedAt)
            : now().toISOString(),
          quote: args.quote ? String(args.quote) : undefined,
          note: args.note ? String(args.note) : undefined,
        });
        const quote = citation.quote ?? "";

        return {
          ok: true,
          result: {
            citation,
            evidence: {
              citationId: citation.id,
              url: citation.url,
              quotePreview: quote.slice(0, 280),
              quoteHash: stableHash(`${citation.url}\n${quote}`),
              storedSeparately: true,
            },
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "citation_record failed.",
        };
      }
    },

    async citationCoverageCheck(args) {
      const citations = normalizeResearchCitations(args.citations);
      const claims = normalizeResearchClaims(args.claims);

      return {
        ok: true,
        result: {
          coverage: checkCitationCoverage({ citations, claims }),
        },
      };
    },

    async markdownReportWrite(args) {
      const reportPath = String(args.path ?? "").trim();
      if (!reportPath) {
        return { ok: false, error: "markdown_report_write requires a path." };
      }

      const citations = normalizeResearchCitations(args.citations);
      const claims = normalizeResearchClaims(args.claims);
      const sections = normalizeReportSections(args.sections);
      const coverage = checkCitationCoverage({ citations, claims });
      if (!coverage.ok) {
        return {
          ok: false,
          error: "markdown_report_write refused unsupported sourced claims.",
          errorDetails: {
            unsupportedClaimIds: coverage.unsupportedClaimIds,
          },
        };
      }

      try {
        const resolvedPath = resolveUserPath(reportPath);
        const citationsPath = deriveCitationsPath(resolvedPath);
        const boundary = await validateReportWriteBoundary(resolvedPath);
        if (!boundary.ok) {
          return {
            ok: false,
            error: `markdown_report_write refused symlinked or escaped report path: ${boundary.reason}`,
          };
        }
        const generatedAt = args.generatedAt
          ? String(args.generatedAt)
          : now().toISOString();
        const markdown = renderMarkdownResearchReport({
          title: String(args.title ?? "Research Report"),
          generatedAt,
          citations,
          claims,
          sections,
        });
        const sidecar = {
          generatedAt,
          reportPath: resolvedPath,
          citations,
          claims,
          coverage,
        };

        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, markdown, "utf8");
        await writeFile(
          citationsPath,
          `${JSON.stringify(sidecar, null, 2)}\n`,
          "utf8",
        );

        return {
          ok: true,
          result: {
            path: resolvedPath,
            citationsPath,
            bytesWritten: Buffer.byteLength(markdown),
            citationCount: citations.length,
            coverage,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "markdown_report_write failed.",
        };
      }
    },
  };
}

async function validateReportWriteBoundary(
  reportPath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parentPath = path.dirname(reportPath);
  const existingBoundary = await nearestExistingPath(parentPath);
  const result = validatePathInsideLocationRoots(reportPath, [existingBoundary], {
    workspaceRoot: existingBoundary,
  });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

async function nearestExistingPath(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

function deriveCitationsPath(reportPath: string): string {
  const extension = path.extname(reportPath);
  if (!extension) {
    return `${reportPath}.citations.json`;
  }

  return path.join(
    path.dirname(reportPath),
    `${path.basename(reportPath, extension)}.citations.json`,
  );
}

function resolveUserPath(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}
