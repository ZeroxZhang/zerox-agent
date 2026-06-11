import { describe, expect, it } from "vitest";
import {
  checkCitationCoverage,
  createResearchCitation,
  renderMarkdownResearchReport,
} from "./researchWriting";

describe("research writing contracts", () => {
  const citation = createResearchCitation({
    id: "src_docs",
    url: "https://docs.example.com/guide",
    title: "Harness Guide",
    accessedAt: "2026-06-10T00:00:00.000Z",
    quote: "Harness tracks deterministic eval results.",
  });

  it("requires sourced facts to cite a known citation", () => {
    expect(
      checkCitationCoverage({
        citations: [citation],
        claims: [
          {
            id: "fact_without_source",
            kind: "sourced_fact",
            text: "Harness tracks deterministic eval results.",
            citationIds: [],
          },
          {
            id: "fact_with_missing_source",
            kind: "sourced_fact",
            text: "Missing citations are not accepted.",
            citationIds: ["src_missing"],
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      unsupportedClaimIds: ["fact_without_source", "fact_with_missing_source"],
      citedFactIds: [],
    });
  });

  it("allows model inferences but keeps them out of sourced fact coverage", () => {
    expect(
      checkCitationCoverage({
        citations: [citation],
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
      }),
    ).toEqual({
      ok: true,
      citationCount: 1,
      sourcedFactCount: 1,
      citedFactIds: ["fact_1"],
      inferenceClaimIds: ["inference_1"],
      unsupportedClaimIds: [],
      summary:
        "1 sourced facts covered by 1 citations; 1 model inferences separated.",
    });
  });

  it("renders sourced facts separately from model inferences", () => {
    const markdown = renderMarkdownResearchReport({
      title: "Agent Capability Research",
      generatedAt: "2026-06-10T00:00:00.000Z",
      citations: [citation],
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
      sections: [
        {
          heading: "Findings",
          claimIds: ["fact_1", "inference_1"],
        },
      ],
    });

    expect(markdown).toContain("### Sourced Facts");
    expect(markdown).toContain(
      "- Harness tracks deterministic eval results.[^src_docs]",
    );
    expect(markdown).toContain("### Model Inference");
    expect(markdown).toContain(
      "- This likely reduces review drift. (inference)",
    );
    expect(markdown).toContain(
      "[^src_docs]: Harness Guide, https://docs.example.com/guide",
    );
  });
});
