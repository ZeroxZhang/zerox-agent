import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GoalEvidenceManifest } from "../shared/agentGoal";
import {
  buildGoalEvidenceManifest,
  renderGoalEvidenceManifest,
} from "./agentGoalEvidenceManifest";

describe("goal evidence manifest", () => {
  let workspacePath: string;
  let outsidePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), "goal-evidence-workspace-"));
    outsidePath = await mkdtemp(path.join(os.tmpdir(), "goal-evidence-outside-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  });

  it("preserves late Markdown headings and criterion-relevant evidence", async () => {
    const reportPath = path.join(workspacePath, "report.md");
    await writeFile(
      reportPath,
      `# Start\n${"ordinary body line\n".repeat(800)}# Final conclusion\nRelease accepted with verification evidence.\n`,
      "utf8",
    );

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${reportPath}`],
      criterionText: "Final conclusion verification accepted",
    }));

    expect(manifest.generatedAt).toBe("2026-07-11T00:00:00.000Z");
    expect(manifest.artifacts[0]).toMatchObject({
      ref: `artifact:${reportPath}`,
      path: reportPath,
      mediaType: "text/markdown",
      lineCount: 803,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      headings: expect.arrayContaining([
        { depth: 1, text: "Start", line: 1 },
        { depth: 1, text: "Final conclusion", line: 802 },
      ]),
    });
    expect(manifest.artifacts[0]?.excerpts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining("criterion"),
          text: expect.stringContaining("Release accepted"),
        }),
      ]),
    );
  });

  it("represents JSON validity, top-level keys, structure, and relevant scalars", async () => {
    const jsonPath = path.join(workspacePath, "result.json");
    await writeFile(
      jsonPath,
      JSON.stringify({
        status: "accepted",
        summary: { verification: "npm run verify passed", count: 12 },
        records: Array.from({ length: 30 }, (_, index) => ({ index, ignored: true })),
      }),
      "utf8",
    );

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${jsonPath}`],
      criterionText: "verification passed",
    }));
    const artifact = manifest.artifacts[0];

    expect(artifact?.mediaType).toBe("application/json");
    expect(artifact?.jsonKeys).toEqual(["status", "summary", "records"]);
    expect(artifact?.excerpts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "json_parse_status", text: "valid" }),
        expect.objectContaining({ label: "json_structure" }),
        expect.objectContaining({
          label: expect.stringContaining("json_scalar"),
          text: expect.stringContaining("npm run verify passed"),
        }),
      ]),
    );
    expect(renderGoalEvidenceManifest(manifest)).not.toContain('"records":[{"index":0');
  });

  it.each([
    { extension: "csv", delimiter: ",", mediaType: "text/csv" },
    { extension: "tsv", delimiter: "\t", mediaType: "text/tab-separated-values" },
  ])("captures $extension table shape and bounded rows", async ({ extension, delimiter, mediaType }) => {
    const tablePath = path.join(workspacePath, `results.${extension}`);
    await writeFile(
      tablePath,
      [
        ["name", "status", "score"].join(delimiter),
        ["alpha", "accepted", "10"].join(delimiter),
        ["beta", "pending", "5"].join(delimiter),
        ["omega", "accepted", "9"].join(delimiter),
      ].join("\n"),
      "utf8",
    );

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${tablePath}`],
      criterionText: "accepted score",
    }));

    expect(manifest.artifacts[0]).toMatchObject({
      mediaType,
      tableShape: {
        rows: 3,
        columns: 3,
        headers: ["name", "status", "score"],
      },
      excerpts: expect.arrayContaining([
        expect.objectContaining({ label: "table_head" }),
        expect.objectContaining({ label: "table_tail" }),
      ]),
    });
  });

  it("captures source metadata, head/tail excerpts, and relevant line windows", async () => {
    const sourcePath = path.join(workspacePath, "check.ts");
    await writeFile(
      sourcePath,
      [
        "export function start() { return true; }",
        ...Array.from({ length: 40 }, (_, index) => `const value${index} = ${index};`),
        "const verificationGate = 'release accepted';",
        "export const finish = true;",
      ].join("\n"),
      "utf8",
    );

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${sourcePath}`],
      criterionText: "verification release accepted",
    }));

    expect(manifest.artifacts[0]).toMatchObject({
      mediaType: "text/typescript",
      lineCount: 43,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      excerpts: expect.arrayContaining([
        expect.objectContaining({ label: "head" }),
        expect.objectContaining({ label: "tail" }),
        expect.objectContaining({
          label: expect.stringContaining("criterion"),
          text: expect.stringContaining("verificationGate"),
        }),
      ]),
    });
  });

  it("reads PNG and JPEG dimensions from validated headers", async () => {
    const pngPath = path.join(workspacePath, "image.png");
    const jpegPath = path.join(workspacePath, "image.jpg");
    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    await writeFile(pngPath, png);
    await writeFile(jpegPath, jpeg);

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${pngPath}`, `artifact:${jpegPath}`],
    }));

    expect(manifest.artifacts[0]).toMatchObject({
      mediaType: "image/png",
      imageSize: { width: 640, height: 480 },
      excerpts: [],
    });
    expect(manifest.artifacts[1]).toMatchObject({
      mediaType: "image/jpeg",
      imageSize: { width: 1280, height: 720 },
      excerpts: [],
    });
  });

  it("keeps safe metadata for corrupt image headers without throwing", async () => {
    const corruptPath = path.join(workspacePath, "corrupt.png");
    await writeFile(corruptPath, Buffer.from("not a png header"));

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${corruptPath}`],
    }));

    expect(manifest.artifacts[0]).toMatchObject({
      mediaType: "image/png",
      sizeBytes: 16,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      excerpts: [],
    });
    expect(manifest.artifacts[0]?.imageSize).toBeUndefined();
  });

  it("keeps generic binary metadata without raw-content excerpts", async () => {
    const binaryPath = path.join(workspacePath, "payload.bin");
    await writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0x41, 0x42]));

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${binaryPath}`],
      criterionText: "AB",
    }));

    expect(manifest.artifacts[0]).toMatchObject({
      mediaType: "application/octet-stream",
      sizeBytes: 8,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      excerpts: [],
    });
    expect(renderGoalEvidenceManifest(manifest)).not.toContain("AB");
  });

  it("rejects parent and leaf symlinks before reading", async () => {
    const realDirectory = path.join(workspacePath, "real");
    await mkdir(realDirectory);
    const realFile = path.join(realDirectory, "evidence.md");
    const leafLink = path.join(workspacePath, "leaf.md");
    const parentLink = path.join(workspacePath, "parent-link");
    await writeFile(realFile, "# Secret through a link", "utf8");
    await symlink(realFile, leafLink);
    await symlink(realDirectory, parentLink, "dir");

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [
        `artifact:${leafLink}`,
        `artifact:${path.join(parentLink, "evidence.md")}`,
      ],
    }));

    expect(manifest.artifacts).toEqual([]);
  });

  it("rejects outside-root, traversal, NUL, and unsafe artifact references", async () => {
    const outsideFile = path.join(outsidePath, "outside.md");
    await writeFile(outsideFile, "# Outside", "utf8");

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [
        `artifact:${outsideFile}`,
        "artifact:../outside.md",
        "artifact:bad\0name.md",
        "artifact:unsafe;name.md",
      ],
    }));

    expect(manifest.artifacts).toEqual([]);
  });

  it("caps rendered output at exactly 12,000 characters with truthful bookkeeping", async () => {
    const reportPath = path.join(workspacePath, "many-headings.md");
    await writeFile(
      reportPath,
      Array.from(
        { length: 600 },
        (_, index) => `# Heading ${index} ${"structural-metadata ".repeat(3)}\nbody ${index}`,
      ).join("\n"),
      "utf8",
    );

    const manifest = await buildGoalEvidenceManifest(input({
      evidenceRefs: [`artifact:${reportPath}`],
      maxRenderedChars: 12_000,
    }));
    const rendered = renderGoalEvidenceManifest(manifest, 12_000);

    expect(rendered).toHaveLength(12_000);
    expect(rendered.endsWith("\n... [truncated]")).toBe(true);
    expect(manifest.totalRenderedChars).toBe(12_000);
    expect(manifest.truncated).toBe(true);
  });

  it("enforces a render cap even for caller-supplied manifests", () => {
    const manifest: GoalEvidenceManifest = {
      version: 1,
      generatedAt: "2026-07-11T00:00:00.000Z",
      totalRenderedChars: 0,
      truncated: false,
      artifacts: [
        {
          ref: "artifact:memory",
          mediaType: "text/plain",
          excerpts: [{ label: "head", text: "x".repeat(20_000) }],
        },
      ],
    };

    expect(renderGoalEvidenceManifest(manifest, 12_000)).toHaveLength(12_000);
  });

  function input(overrides: {
    evidenceRefs?: string[];
    criterionText?: string;
    maxRenderedChars?: number;
  } = {}) {
    return {
      evidenceRefs: overrides.evidenceRefs ?? [],
      criterionText: overrides.criterionText ?? "artifact evidence",
      workspacePath,
      extraAuthorizedRoots: [],
      locationEnv: { homeDir: os.homedir(), workspaceRoot: workspacePath, platform: process.platform },
      artifacts: {},
      now: () => "2026-07-11T00:00:00.000Z",
      maxRenderedChars: overrides.maxRenderedChars,
    };
  }
});
