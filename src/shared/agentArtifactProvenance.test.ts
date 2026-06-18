import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getArtifactProvenancePath,
  verifyArtifactProvenance,
  writeArtifactProvenance,
} from "./agentArtifactProvenance";

describe("agentArtifactProvenance", () => {
  it("writes and verifies the artifact sidecar", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifact-provenance-"));
    const artifactPath = path.join(root, "bookmark_list.md");
    await writeFile(artifactPath, "# Bookmarks\n", "utf8");

    const manifestPath = await writeArtifactProvenance({
      artifactPath,
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      runId: "run_1",
      goalId: "goal_1",
      source: { type: "chrome_bookmarks" },
      generatedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(manifestPath).toBe(getArtifactProvenancePath(artifactPath));
    await expect(
      verifyArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
        goalId: "goal_1",
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.destination.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports deterministic verification failures for missing or stale provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifact-provenance-"));
    const artifactPath = path.join(root, "bookmark_list.md");
    await writeFile(artifactPath, "# Bookmarks\n", "utf8");

    await expect(
      verifyArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
        goalId: "goal_1",
        milestoneId: "milestone_1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "Artifact provenance sidecar is missing.",
    });

    await writeArtifactProvenance({
      artifactPath,
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      runId: "run_1",
      goalId: "goal_1",
      milestoneId: "milestone_1",
      source: { type: "chrome_bookmarks" },
      generatedAt: "2026-06-18T00:00:00.000Z",
    });

    const cases = [
      {
        input: { runId: "run_2" },
        reason: "Artifact provenance runId does not match.",
      },
      {
        input: { goalId: "goal_2" },
        reason: "Artifact provenance goalId does not match.",
      },
      {
        input: { milestoneId: "milestone_2" },
        reason: "Artifact provenance milestoneId does not match.",
      },
      {
        input: { artifactId: "goalEvidence" },
        reason: "Artifact provenance artifactId does not match.",
      },
      {
        input: { artifactRef: "artifact:goalEvidence" },
        reason: "Artifact provenance artifactRef does not match.",
      },
    ];

    for (const testCase of cases) {
      await expect(
        verifyArtifactProvenance({
          artifactPath,
          artifactId: "bookmark_list",
          artifactRef: "artifact:bookmark_list",
          runId: "run_1",
          goalId: "goal_1",
          milestoneId: "milestone_1",
          ...testCase.input,
        }),
      ).resolves.toMatchObject({ ok: false, reason: testCase.reason });
    }

    await writeFile(artifactPath, "# Bookmarks\n- changed\n", "utf8");
    await expect(
      verifyArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
        goalId: "goal_1",
        milestoneId: "milestone_1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "Artifact provenance destination hash does not match current content.",
    });
  });

  it("rejects stale copied sidecars and symlink artifact paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifact-provenance-"));
    const sourcePath = path.join(root, "source.md");
    const copiedPath = path.join(root, "copied.md");
    await writeFile(sourcePath, "source", "utf8");
    await writeFile(copiedPath, "source", "utf8");
    const sourceManifestPath = await writeArtifactProvenance({
      artifactPath: sourcePath,
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      runId: "run_1",
      source: { type: "chrome_bookmarks" },
      generatedAt: "2026-06-18T00:00:00.000Z",
    });
    await copyFile(sourceManifestPath, getArtifactProvenancePath(copiedPath));

    await expect(
      verifyArtifactProvenance({
        artifactPath: copiedPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "Artifact provenance destination path does not match the requested path.",
    });

    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "artifact-outside-"));
    const outsidePath = path.join(outsideRoot, "secret.md");
    const linkRoot = path.join(root, "links");
    await mkdir(linkRoot);
    await writeFile(outsidePath, "secret", "utf8");
    const linkPath = path.join(linkRoot, "bookmark_list.md");
    await symlink(outsidePath, linkPath);

    await expect(
      verifyArtifactProvenance({
        artifactPath: linkPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "Artifact path must not be a symlink.",
    });
  });

  it("rejects symlinked parent directories for artifact provenance writes and verification", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifact-provenance-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "artifact-outside-"));
    const linkRoot = path.join(root, "linked-output");
    await symlink(outsideRoot, linkRoot);
    const artifactPath = path.join(linkRoot, "bookmark_list.md");
    await writeFile(artifactPath, "# Bookmarks\n", "utf8");

    await expect(
      writeArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
        source: { type: "chrome_bookmarks" },
        generatedAt: "2026-06-18T00:00:00.000Z",
      }),
    ).rejects.toThrow("Artifact path parents must not contain symlinks.");

    await writeFile(
      getArtifactProvenancePath(artifactPath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "zerox.artifactProvenance",
          runId: "run_1",
          artifactId: "bookmark_list",
          artifactRef: "artifact:bookmark_list",
          source: { type: "chrome_bookmarks" },
          destination: {
            path: path.resolve(artifactPath),
            sha256: createHash("sha256").update("# Bookmarks\n").digest("hex"),
            sizeBytes: Buffer.byteLength("# Bookmarks\n"),
          },
          generatedAt: "2026-06-18T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      verifyArtifactProvenance({
        artifactPath,
        artifactId: "bookmark_list",
        artifactRef: "artifact:bookmark_list",
        runId: "run_1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "Artifact path parents must not contain symlinks.",
    });
  });
});
