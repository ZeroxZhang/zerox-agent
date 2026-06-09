export type ResearchClaimKind = "sourced_fact" | "model_inference";

export type ResearchCitation = {
  id: string;
  url: string;
  title: string;
  accessedAt: string;
  quote?: string;
  note?: string;
};

export type ResearchClaim = {
  id: string;
  kind: ResearchClaimKind;
  text: string;
  citationIds: string[];
};

export type MarkdownResearchReportSection = {
  heading: string;
  claimIds: string[];
};

export type CitationCoverageInput = {
  citations: ResearchCitation[];
  claims: ResearchClaim[];
};

export type CitationCoverageResult = {
  ok: boolean;
  citationCount: number;
  sourcedFactCount: number;
  citedFactIds: string[];
  inferenceClaimIds: string[];
  unsupportedClaimIds: string[];
  summary: string;
};

export type MarkdownResearchReportInput = CitationCoverageInput & {
  title: string;
  generatedAt?: string;
  sections: MarkdownResearchReportSection[];
};

export type ResearchCitationInput = {
  id?: string;
  url: string;
  title?: string;
  accessedAt?: string;
  quote?: string;
  note?: string;
};

export function createResearchCitation(
  input: ResearchCitationInput,
): ResearchCitation {
  const url = normalizeUrl(input.url);
  return {
    id: normalizeCitationId(input.id) || createSourceId(url),
    url,
    title: String(input.title ?? "").trim() || url,
    accessedAt: input.accessedAt ?? new Date().toISOString(),
    ...(input.quote ? { quote: input.quote } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

export function createSourceId(url: string): string {
  const normalizedUrl = normalizeUrl(url);
  let hostname = "source";

  try {
    hostname = new URL(normalizedUrl).hostname;
  } catch {
    // normalizeUrl already validates in normal use; this fallback keeps IDs stable.
  }

  const hostPart =
    hostname
      .replace(/^www\./i, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "source";

  return `src_${hostPart}_${stableHash(normalizedUrl).slice(0, 8)}`;
}

export function checkCitationCoverage(
  input: CitationCoverageInput,
): CitationCoverageResult {
  const citationIds = new Set(input.citations.map((citation) => citation.id));
  const sourcedFacts = input.claims.filter(
    (claim) => claim.kind === "sourced_fact",
  );
  const citedFactIds: string[] = [];
  const unsupportedClaimIds: string[] = [];
  const inferenceClaimIds: string[] = [];

  for (const claim of input.claims) {
    if (claim.kind === "model_inference") {
      inferenceClaimIds.push(claim.id);
      continue;
    }

    const uniqueCitationIds = [...new Set(claim.citationIds)];
    const hasKnownCitations =
      uniqueCitationIds.length > 0 &&
      uniqueCitationIds.every((citationId) => citationIds.has(citationId));

    if (hasKnownCitations) {
      citedFactIds.push(claim.id);
    } else {
      unsupportedClaimIds.push(claim.id);
    }
  }

  return {
    ok: unsupportedClaimIds.length === 0,
    citationCount: input.citations.length,
    sourcedFactCount: sourcedFacts.length,
    citedFactIds,
    inferenceClaimIds,
    unsupportedClaimIds,
    summary: `${citedFactIds.length} sourced facts covered by ${input.citations.length} citations; ${inferenceClaimIds.length} model inferences separated.`,
  };
}

export function renderMarkdownResearchReport(
  input: MarkdownResearchReportInput,
): string {
  const coverage = checkCitationCoverage(input);
  if (!coverage.ok) {
    throw new Error(
      `Unsupported sourced claims: ${coverage.unsupportedClaimIds.join(", ")}`,
    );
  }

  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const lines: string[] = [
    `# ${input.title.trim() || "Research Report"}`,
    "",
  ];

  if (input.generatedAt) {
    lines.push(`_Generated at ${input.generatedAt}_`, "");
  }

  lines.push("## Summary", "", "### Sourced Facts");
  const sourcedFacts = input.claims.filter(
    (claim) => claim.kind === "sourced_fact",
  );
  if (sourcedFacts.length) {
    for (const claim of sourcedFacts) {
      lines.push(`- ${formatClaim(claim)}`);
    }
  } else {
    lines.push("- No sourced facts recorded.");
  }

  lines.push("", "### Model Inference");
  const inferences = input.claims.filter(
    (claim) => claim.kind === "model_inference",
  );
  if (inferences.length) {
    for (const claim of inferences) {
      lines.push(`- ${claim.text} (inference)`);
    }
  } else {
    lines.push("- No model inference recorded.");
  }

  for (const section of input.sections) {
    lines.push("", `## ${section.heading}`);
    const sectionClaims = section.claimIds
      .map((claimId) => claimsById.get(claimId))
      .filter((claim): claim is ResearchClaim => Boolean(claim));
    if (!sectionClaims.length) {
      lines.push("", "No claims recorded.");
      continue;
    }

    lines.push("");
    for (const claim of sectionClaims) {
      lines.push(
        `- ${
          claim.kind === "sourced_fact"
            ? formatClaim(claim)
            : `${claim.text} (inference)`
        }`,
      );
    }
  }

  lines.push("", "## Sources", "");
  for (const citation of input.citations) {
    const accessed = citation.accessedAt
      ? ` Accessed ${citation.accessedAt}.`
      : "";
    lines.push(
      `[^${citation.id}]: ${citation.title}, ${citation.url}.${accessed}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function normalizeResearchCitations(
  values: unknown,
): ResearchCitation[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) =>
      value && typeof value === "object"
        ? createResearchCitation(value as ResearchCitationInput)
        : null,
    )
    .filter((value): value is ResearchCitation => Boolean(value));
}

export function normalizeResearchClaims(values: unknown): ResearchClaim[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const record = value as Record<string, unknown>;
      const kind =
        record.kind === "model_inference" ? "model_inference" : "sourced_fact";
      const citationIds = Array.isArray(record.citationIds)
        ? record.citationIds.map(String).filter(Boolean)
        : [];

      return {
        id: String(record.id ?? "").trim(),
        kind,
        text: String(record.text ?? "").trim(),
        citationIds,
      } satisfies ResearchClaim;
    })
    .filter(
      (value): value is ResearchClaim => Boolean(value?.id && value.text),
    );
}

export function normalizeReportSections(
  values: unknown,
): MarkdownResearchReportSection[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const record = value as Record<string, unknown>;
      const claimIds = Array.isArray(record.claimIds)
        ? record.claimIds.map(String).filter(Boolean)
        : [];

      return {
        heading: String(record.heading ?? "").trim(),
        claimIds,
      } satisfies MarkdownResearchReportSection;
    })
    .filter((value): value is MarkdownResearchReportSection =>
      Boolean(value?.heading),
    );
}

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatClaim(claim: ResearchClaim): string {
  return `${claim.text}${claim.citationIds.map((id) => `[^${id}]`).join("")}`;
}

function normalizeCitationId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeUrl(value: string): string {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Research citation URL must be http(s).");
  }
  return url.toString();
}
