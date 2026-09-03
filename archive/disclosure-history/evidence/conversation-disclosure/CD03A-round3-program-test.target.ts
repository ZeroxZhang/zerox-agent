import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.join(
  process.cwd(),
  "scripts",
  "check-conversation-disclosure-program.mjs",
);
const externalRunnerSource = path.join(
  process.cwd(),
  "scripts",
  "verify-conversation-disclosure-closure.mjs",
);
const roots: string[] = [];
const externalAnchorByRoot = new Map<string, string>();

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  externalAnchorByRoot.clear();
});

describe("Conversation disclosure program checker", () => {
  it("accepts one dependency-ready active Feature with complete coverage", async () => {
    const root = await createFixture();
    await expect(runChecker(root)).resolves.toContain(
      "Conversation disclosure program check passed",
    );
  });

  it.each([
    {
      name: "a missing root finding",
      mutate(program: ProgramFixture) {
        program.rootFindings = program.rootFindings.filter(
          (finding) => finding !== "D13",
        );
      },
      expected: "rootFindings is missing D13",
    },
    {
      name: "an implementation finding padded only by later work",
      mutate(program: ProgramFixture) {
        program.workstreams[1].findings = program.workstreams[1].findings.filter(
          (finding) => finding !== "D4",
        );
      },
      expected: "CD02 must own root finding D4",
    },
    {
      name: "a dependency cycle",
      mutate(program: ProgramFixture) {
        program.workstreams[0].dependsOn = ["CD09"];
      },
      expected: "conversation disclosure dependency cycle",
    },
    {
      name: "a bypassed delivery stage",
      mutate(program: ProgramFixture) {
        program.workstreams[2].dependsOn = [];
      },
      expected: "CD03 must depend transitively on preceding workstream CD02",
    },
    {
      name: "a missing frozen scenario category",
      mutate(program: ProgramFixture) {
        program.scenarioMatrix = program.scenarioMatrix.filter(
          (scenario) => scenario.category !== "legacy",
        );
      },
      expected: "scenarioMatrix is missing required category legacy",
    },
    {
      name: "an unreferenced scenario",
      mutate(program: ProgramFixture) {
        program.scenarioMatrix.push({
          id: "S20-extra",
          category: "default",
          title: "Extra scenario",
          surface: "chat",
          executor: "browser",
          fixture: "fixture",
          setup: "fixture",
          actions: ["act"],
          expected: ["observe"],
          evidenceRequirements: ["browser evidence"],
          acceptanceEvidence: [],
        });
      },
      expected: "scenario S20-extra is not referenced by any workstream",
    },
  ])("rejects $name", async ({ mutate, expected }) => {
    const program = createProgram();
    mutate(program);
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(expected);
  });

  it("rejects missing architecture artifacts", async () => {
    const program = createProgram();
    program.architectureDecision = ".zerox/missing-decision.md";
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "architectureDecision does not exist",
    );
  });

  it("rejects multiple unfinished Features", async () => {
    const root = await createFixture({ extraOpenFeature: true });
    await expect(runChecker(root)).rejects.toContain(
      "feature_list has 2 unfinished features; maximum is 1",
    );
  });

  it("rejects a hardlinked governance control input", async () => {
    const root = await createFixture();
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "zerox-conversation-disclosure-hardlink-"),
    );
    roots.push(outsideRoot);
    await link(
      path.join(root, ".zerox", "feature_list.json"),
      path.join(outsideRoot, "feature-list-alias.json"),
    );

    await expect(runChecker(root)).rejects.toContain(
      "Feature list control input must have exactly one hard link",
    );
  });

  it("rejects manifest and Feature status drift", async () => {
    const root = await createFixture({ featureStatus: "done" });
    await expect(runChecker(root)).rejects.toContain(
      "must be in_progress while CD01 is active",
    );
  });

  it("accepts CD03 completion only after exact external attestation", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    await expect(runChecker(root)).resolves.toContain(
      "Conversation disclosure program check passed",
    );
  });

  it("accepts exact private immutable completed transaction markers", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const anchorPath = externalAnchorByRoot.get(root)!;
    await expect(findCompletedMarker(
      path.join(root, `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`),
    )).resolves.toContain(".completed-");
    await expect(findCompletedMarker(
      `${anchorPath}.publication-transaction.json.remove.tombstone`,
    )).resolves.toContain(".completed-");

    await expect(runChecker(root)).resolves.toContain(
      "Conversation disclosure program check passed",
    );
  });

  it("rejects a weak-mode completed transaction marker", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const markerPath = await findCompletedMarker(
      path.join(root, `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`),
    );
    await chmod(markerPath, 0o644);

    await expect(runChecker(root)).rejects.toContain(
      "completed marker must be owned by the effective user with mode 0600",
    );
  });

  it("rejects a same-bytes new-inode marker under the old identity-bound name", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const markerPath = await findCompletedMarker(
      path.join(root, `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`),
    );
    const replacementPath = `${markerPath}.same-bytes-new-inode`;
    await writeFile(replacementPath, await readFile(markerPath), { mode: 0o600 });
    await rename(replacementPath, markerPath);

    await expect(runChecker(root)).rejects.toContain(
      "completed marker identity/digest is stale",
    );
  });

  it.each([
    ["freeze", (root: string) => path.join(
      root,
      `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`,
    )],
    ["external", (root: string) =>
      `${externalAnchorByRoot.get(root)!}.publication-transaction.json.remove.tombstone`],
  ] as const)("rejects a missing %s completed marker", async (_label, markerBase) => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    await rm(await findCompletedMarker(markerBase(root)));

    await expect(runChecker(root)).rejects.toContain(
      "must have exactly one immutable completed marker",
    );
  });

  it.each([
    ["freeze", (root: string) => path.join(
      root,
      `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`,
    )],
    ["external", (root: string) =>
      `${externalAnchorByRoot.get(root)!}.publication-transaction.json.remove.tombstone`],
  ] as const)("rejects duplicate %s completed markers", async (_label, markerBase) => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const base = markerBase(root);
    const value = await readJsonFile(await findCompletedMarker(base));
    await writeCompletedMarker(base, value);

    await expect(runChecker(root)).rejects.toContain(
      "must have exactly one immutable completed marker",
    );
  });

  it.each([
    ["freeze", (root: string) => path.join(
      root,
      `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`,
    )],
    ["external", (root: string) =>
      `${externalAnchorByRoot.get(root)!}.publication-transaction.json.remove.tombstone`],
  ] as const)("rejects a minimal-invalid %s completed marker", async (
    label,
    markerBase,
  ) => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const base = markerBase(root);
    await rm(await findCompletedMarker(base));
    await writeCompletedMarker(base, {
      kind: label === "freeze"
        ? "conversation-disclosure-review-freeze-transaction"
        : "conversation-disclosure-external-publication-transaction",
      status: "prepared",
    });

    await expect(runChecker(root)).rejects.toContain(
      "must contain the exact prepared v1",
    );
  });

  it.each([
    ["freeze", (root: string) => path.join(
      root,
      `${reviewSnapshotPath}.freeze-transaction.json.remove.tombstone`,
    ), "snapshotPath"],
    ["external", (root: string) =>
      `${externalAnchorByRoot.get(root)!}.publication-transaction.json.remove.tombstone`,
    "anchorOutputPath"],
  ] as const)("rejects a stale-binding %s completed marker", async (
    _label,
    markerBase,
    bindingKey,
  ) => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const base = markerBase(root);
    const markerPath = await findCompletedMarker(base);
    const value = await readJsonFile(markerPath);
    await rm(markerPath);
    value[bindingKey] = `${value[bindingKey]}.stale`;
    const withoutDigest = { ...value };
    delete withoutDigest.digest;
    value.digest = hashCanonical(withoutDigest);
    await writeCompletedMarker(base, value);

    await expect(runChecker(root)).rejects.toContain("bindings are stale");
  });

  it.each([
    ["closure manifest", (root: string) => path.join(root, closureManifestPath)],
    ["external attestation", (root: string) => path.join(root, externalAttestationPath)],
    ["external anchor", (root: string) => externalAnchorByRoot.get(root)!],
  ] as const)("rejects a weak-mode completed %s", async (_label, resolveTarget) => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    await chmod(resolveTarget(root), 0o644);

    await expect(runChecker(root)).rejects.toContain(
      "must be owned by the effective user with mode 0600",
    );
  });

  it("rejects locally complete closure evidence without the repository-external anchor", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    await expect(runChecker(root, { externalAnchor: false })).rejects.toContain(
      "completed CD03 requires an explicit repository-external closure anchor",
    );
  });

  it("rejects a repository-local copy posing as the external closure anchor", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const pinnedAnchor = externalAnchorByRoot.get(root)!;
    const localAnchor = path.join(root, ".zerox", "forged-local-anchor.json");
    await writeFile(localAnchor, await readFile(pinnedAnchor));

    await expect(runChecker(root, { externalAnchor: localAnchor })).rejects.toContain(
      "repository-external closure anchor must stay outside the candidate repository",
    );
  });

  it("rejects a hardlinked external anchor", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const pinnedAnchor = externalAnchorByRoot.get(root)!;
    await link(pinnedAnchor, `${pinnedAnchor}.alias`);

    await expect(runChecker(root)).rejects.toContain(
      "repository-external closure anchor must be a unique regular non-symlink file",
    );
  });

  it("rejects a recomputed external anchor that disagrees with the caller pin", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const anchorPath = externalAnchorByRoot.get(root)!;
    const anchor = JSON.parse(await readFile(anchorPath, "utf8"));
    const pinnedDigest = anchor.digest as string;
    anchor.attestationDigest = `sha256:${"f".repeat(64)}`;
    const withoutDigest = { ...anchor };
    delete withoutDigest.digest;
    anchor.digest = hashCanonical(withoutDigest);
    await writeFile(anchorPath, JSON.stringify(anchor), "utf8");

    await expect(runChecker(root, {
      externalAnchor: anchorPath,
      expectedExternalAnchorDigest: pinnedDigest,
    })).rejects.toContain(
      "external anchor digest does not match the caller-pinned digest",
    );
  });

  it("rejects completion while an external publication recovery transaction remains", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const anchorPath = externalAnchorByRoot.get(root)!;
    await writeFile(
      `${anchorPath}.publication-transaction.json`,
      "{}\n",
      "utf8",
    );

    await expect(runChecker(root)).rejects.toContain(
      "external publication transaction must be recovered and removed",
    );
  });

  it("rejects completion while an external publication tombstone remains", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const anchorPath = externalAnchorByRoot.get(root)!;
    await writeFile(
      `${anchorPath}.publication-transaction.json.remove.tombstone`,
      "{}\n",
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(runChecker(root)).rejects.toContain(
      "external publication transaction must be recovered and removed",
    );
  });

  it("rejects completed CD03 with only a pending external manifest", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({
      program,
      features,
      mutateCd03ReviewBundle(bundle) {
        makeCd03ReviewBundlePending(bundle);
      },
    });
    await expect(runChecker(root)).rejects.toContain(
      "completed CD03 requires an externally_attested closure manifest",
    );
  });

  it("rejects completed CD03 when the declared external attestation is missing", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({
      program,
      features,
      mutateCd03ReviewBundle(bundle) {
        bundle.attestation = undefined;
      },
    });
    await expect(runChecker(root)).rejects.toContain(
      "external closure attestation does not exist or changed identity",
    );
  });

  it("rejects a forged external attestation even when its digest is recomputed", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({
      program,
      features,
      mutateCd03ReviewBundle(bundle) {
        bundle.attestation!.forgedRepositoryClaim = true;
        refreshExternalAttestationDigest(bundle);
      },
    });
    await expect(runChecker(root)).rejects.toContain(
      "external attestation must contain the exact v1 keys",
    );
  });

  it("rejects a stale external attestation binding with recomputed canonical digests", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({
      program,
      features,
      mutateCd03ReviewBundle(bundle) {
        bundle.attestation!.pendingManifestDigest = `sha256:${"f".repeat(64)}`;
        refreshExternalAttestationDigest(bundle);
      },
    });
    await expect(runChecker(root)).rejects.toContain(
      "external attestation pending manifest digest is stale",
    );
  });

  it("rejects false CD03 completion while its artifact is still review pending", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const artifact = createAcceptedCd03Artifact(
      program,
      features.find((feature) => feature.id === "P107")!,
    );
    artifact.status = "review_pending";
    artifact.independentReview.status = "pending";
    const root = await createFixture({
      program,
      features,
      cd03ArtifactContent: JSON.stringify(artifact),
    });
    await expect(runChecker(root)).rejects.toContain(
      "primaryArtifact status must be accepted",
    );
    await expect(runChecker(root)).rejects.toContain(
      "one current externally attested closure manifest reference",
    );
  });

  it("rejects inline reviewers or any extra independentReview keys", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const artifact = createAcceptedCd03Artifact(
      program,
      features.find((feature) => feature.id === "P107")!,
    );
    artifact.independentReview = {
      ...artifact.independentReview,
      reviewers: [{ lane: "contract", verdict: "passed" }],
    } as typeof artifact.independentReview;
    const root = await createFixture({
      program,
      features,
      cd03ArtifactContent: JSON.stringify(artifact),
    });
    await expect(runChecker(root)).rejects.toContain(
      "independentReview must contain the exact external-review keys",
    );
  });

  it("rejects an external review receipt that does not share the frozen CD03 snapshot", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({
      program,
      features,
      mutateCd03ReviewBundle(bundle) {
        bundle.receipts[1]!.snapshotDigest = `sha256:${"f".repeat(64)}`;
        refreshCd03ReviewBundle(bundle);
      },
    });
    await expect(runChecker(root)).rejects.toContain(
      "review receipt snapshotDigest must match the snapshot",
    );
  });

  it("rejects immutable CD03 source drift after independent review", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    await writeFile(
      path.join(root, ".zerox", "CD03-source.ts"),
      "export const fixture = false;\n",
      "utf8",
    );
    await expect(runChecker(root)).rejects.toContain(
      "reviewSnapshot hash drift: .zerox/CD03-source.ts",
    );
  });

  it("rejects a same-byte internal symlink in the frozen CD03 file set", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const root = await createFixture({ program, features });
    const sourcePath = path.join(root, ".zerox", "CD03-source.ts");
    const copyPath = path.join(root, ".zerox", "CD03-source-copy.ts");
    await rename(sourcePath, copyPath);
    await symlink("CD03-source-copy.ts", sourcePath);
    await expect(runChecker(root)).rejects.toContain(
      "must not contain symbolic links: .zerox/CD03-source.ts",
    );
  });

  it("rejects a recomputed snapshot that omits the executable harness closure", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const p107 = features.find((feature) => feature.id === "P107")!;
    p107.files = p107.files?.filter((filePath) => filePath !== "package.json");
    const root = await createFixture({ program, features });
    await expect(runChecker(root)).rejects.toContain(
      "completed CD03 Feature must include executable closure path package.json",
    );
  });

  it("rejects extra keys in a CD03 reviewSnapshot file entry", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const artifact = createAcceptedCd03Artifact(
      program,
      features.find((feature) => feature.id === "P107")!,
    );
    const firstEntry = artifact.reviewSnapshot.files[0] as Record<string, unknown>;
    firstEntry.unexpectedMetadata = "signed but outside the exact schema";
    const snapshotWithoutDigest = {
      ...artifact.reviewSnapshot,
    } as Record<string, unknown>;
    delete snapshotWithoutDigest.digest;
    artifact.reviewSnapshot.digest = hashCanonical(snapshotWithoutDigest);
    const root = await createFixture({
      program,
      features,
      cd03ArtifactContent: JSON.stringify(artifact),
    });
    await expect(runChecker(root)).rejects.toContain(
      "review snapshot files[0] must contain exactly path and sha256",
    );
  });

  it("rejects undeclared CD03 safety aliases even when they are boolean", async () => {
    const { program, features } = createCd03CompletedFixtureState();
    const artifact = createAcceptedCd03Artifact(
      program,
      features.find((feature) => feature.id === "P107")!,
    );
    artifact.safety = {
      ...artifact.safety,
      legacySafetyAlias: false,
    };
    const root = await createFixture({
      program,
      features,
      cd03ArtifactContent: JSON.stringify(artifact),
    });
    await expect(runChecker(root)).rejects.toContain(
      "safety keys must exactly match the completion contract",
    );
  });

  it("accepts the real repository CD03 artifact in an isolated completion dry-run", async () => {
    const repositoryRoot = process.cwd();
    const [program, featureList, artifact] = await Promise.all([
      readJsonFile(path.join(repositoryRoot, ".zerox", "conversation-disclosure-program.json")),
      readJsonFile(path.join(repositoryRoot, ".zerox", "feature_list.json")),
      readJsonFile(path.join(
        repositoryRoot,
        ".zerox",
        "verification",
        "conversation-disclosure",
        "CD03-causal-shadow.json",
      )),
    ]);
    const feature = (featureList.features as Array<{
      id: string;
      status: string;
      files: string[];
    }>).find(
      (candidate) => candidate.id === "P107-conversation-disclosure-domain-adapters",
    )!;
    const root = await mkdtemp(path.join(os.tmpdir(), "zerox-real-cd03-dry-run-"));
    roots.push(root);
    await cp(path.join(repositoryRoot, ".zerox"), path.join(root, ".zerox"), {
      recursive: true,
    });
    for (const relativePath of feature.files) {
      if (relativePath.startsWith(".zerox/")) continue;
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(repositoryRoot, relativePath), target);
    }

    const cd03 = (program.workstreams as Array<{ id: string; state: string }>).find(
      (workstream) => workstream.id === "CD03",
    )!;
    cd03.state = "completed";
    program.activeFeatureId = null;
    program.nextFeatureId = "P108-conversation-disclosure-evidence-foundation";
    feature.status = "done";
    artifact.status = "accepted";
    await writeCompletedCd03ReviewState(root, program, featureList, artifact);

    await expect(runChecker(root)).resolves.toContain(
      "Conversation disclosure program check passed",
    );
  });

  it("rejects package-only closure drift without trusting npm aliases", async () => {
    const { root, snapshotDigest } = await createCurrentCd03ClosureRoot();
    const packagePath = path.join(root, "package.json");
    const packageJson = await readJsonFile(packagePath);
    const scripts = packageJson.scripts as Record<string, string>;
    scripts["program:check"] = "node -e \"\"";
    scripts["harness:check"] = "node -e \"\"";
    await writeFile(packagePath, JSON.stringify(packageJson), "utf8");

    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      snapshotDigest,
    )).rejects.toContain("reviewSnapshot hash drift: package.json");
    await expect(runClosureEntry(
      root,
      "scripts/check-harness-state.mjs",
      snapshotDigest,
    )).rejects.toContain("reviewSnapshot hash drift: package.json");
  });

  it("emits externally digest-bound receipts from both direct closure entries", async () => {
    const { root, snapshotDigest } = await createCurrentCd03ClosureRoot();
    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      snapshotDigest,
    )).resolves.toContain(JSON.stringify({
      kind: "cd03-checker-receipt",
      status: "passed",
      snapshotDigest,
    }));
    await expect(runClosureEntry(
      root,
      "scripts/check-harness-state.mjs",
      snapshotDigest,
    )).resolves.toContain(JSON.stringify({
      kind: "cd03-harness-receipt",
      status: "passed",
      snapshotDigest,
    }));
    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      `sha256:${"f".repeat(64)}`,
    )).rejects.toContain(
      "closure snapshot digest does not match the externally expected digest",
    );
  });

  it("lets the external runner stage a re-inoded marker for the real checker and harness", async () => {
    const { root, snapshotDigest } = await createCurrentCd03ClosureRoot();
    const output = await runActualExternalClosure(root, snapshotDigest);
    const attestation = JSON.parse(output) as {
      candidateResults: Array<{ kind: string; status: string }>;
      status: string;
    };

    expect(attestation.status).toBe("passed");
    expect(attestation.candidateResults.map((entry) => [entry.kind, entry.status]))
      .toEqual([["checker", "passed"], ["harness", "passed"]]);
  });

  it("rejects nested snapshot schema drift at both direct closure entries", async () => {
    const { root } = await createCurrentCd03ClosureRoot();
    const artifactPath = path.join(
      root,
      ".zerox",
      "verification",
      "conversation-disclosure",
      "CD03-causal-shadow.json",
    );
    const artifact = await readJsonFile(artifactPath);
    const snapshot = artifact.reviewSnapshot as {
      digest: string;
      files: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    snapshot.files[0]!.unexpectedMetadata = "outside exact entry schema";
    const snapshotWithoutDigest = { ...snapshot } as Record<string, unknown>;
    delete snapshotWithoutDigest.digest;
    snapshot.digest = hashCanonical(snapshotWithoutDigest);
    await writeFile(artifactPath, JSON.stringify(artifact), "utf8");

    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      snapshot.digest,
    )).rejects.toContain(
      "review snapshot files[0] must contain exactly path and sha256",
    );
    await expect(runClosureEntry(
      root,
      "scripts/check-harness-state.mjs",
      snapshot.digest,
    )).rejects.toContain(
      "harness review snapshot files[0] must contain exactly path and sha256",
    );
  });

  it("rejects harness-only closure drift through the unchanged checker entry", async () => {
    const { root, snapshotDigest } = await createCurrentCd03ClosureRoot();
    await writeFile(
      path.join(root, "scripts", "check-harness-state.mjs"),
      "// mutation probe: harness replaced with a no-op\n",
      "utf8",
    );

    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      snapshotDigest,
    )).rejects.toContain(
      "reviewSnapshot hash drift: scripts/check-harness-state.mjs",
    );
    await expect(runClosureEntry(
      root,
      "scripts/check-harness-state.mjs",
      snapshotDigest,
    )).resolves.not.toContain("cd03-harness-receipt");
  });

  it("rejects checker-only closure drift before the unchanged harness imports it", async () => {
    const { root, snapshotDigest } = await createCurrentCd03ClosureRoot();
    await writeFile(
      path.join(root, "scripts", "check-conversation-disclosure-program.mjs"),
      "// mutation probe: checker replaced with a no-op\n",
      "utf8",
    );

    await expect(runClosureEntry(
      root,
      "scripts/check-harness-state.mjs",
      snapshotDigest,
    )).rejects.toContain(
      "harness checker hash drift: scripts/check-conversation-disclosure-program.mjs",
    );
    await expect(runClosureEntry(
      root,
      "scripts/check-conversation-disclosure-program.mjs",
      snapshotDigest,
    )).resolves.not.toContain("cd03-checker-receipt");
  });

  it("rejects a completed workstream whose dependency is unfinished", async () => {
    const program = createProgram();
    program.workstreams[0].state = "completed";
    program.workstreams[2].state = "completed";
    program.activeFeatureId = null;
    program.nextFeatureId = "P106";
    const root = await createFixture({
      program,
      features: [
        { id: "P105", status: "done" },
        { id: "P107", status: "done" },
      ],
    });
    await expect(runChecker(root)).rejects.toContain(
      "CD03 is completed before dependency CD02 completed",
    );
  });

  it("rejects a planned workstream already registered as done", async () => {
    const root = await createFixture({
      features: [
        { id: "P105", status: "in_progress" },
        { id: "P106", status: "done" },
      ],
    });
    await expect(runChecker(root)).rejects.toContain(
      "planned workstream CD02 cannot already be registered",
    );
  });

  it("rejects duplicate Feature ids", async () => {
    const root = await createFixture({
      features: [
        { id: "P105", status: "in_progress" },
        { id: "P105", status: "in_progress" },
      ],
    });
    await expect(runChecker(root)).rejects.toContain(
      "feature_list has duplicate feature id",
    );
  });

  it("rejects a directory used as a required artifact", async () => {
    const program = createProgram();
    program.sourceReview = ".zerox";
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "sourceReview must be a regular file",
    );
  });

  it("rejects an active required architecture decision that is missing", async () => {
    const program = createProgram();
    program.workstreams[0].architectureDecision =
      ".zerox/missing-workstream-decision.md";
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "workstreams[0].architectureDecision does not exist",
    );
  });

  it("rejects an invalid implementation completion boundary", async () => {
    const program = createProgram();
    program.implementationCompletionWorkstreamId = "CD01";
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "implementationCompletionWorkstreamId must follow the foundation",
    );
  });

  it("rejects post-implementation gates outside the ordered suffix", async () => {
    const program = createProgram();
    program.postImplementationGates = ["CD07"];
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "postImplementationGates must equal the ordered workstreams",
    );
  });

  it("rejects formal acceptance completion without scenario evidence", async () => {
    const program = createProgram();
    for (const workstream of program.workstreams) workstream.state = "completed";
    program.status = "completed";
    program.activeFeatureId = null;
    program.nextFeatureId = null;
    const root = await createFixture({
      program,
      features: program.workstreams.map((workstream) => ({
        id: workstream.featureId,
        status: "done",
      })),
    });
    await expect(runChecker(root)).rejects.toContain(
      "completed acceptance scenario S01-default requires evidence artifacts",
    );
  });

  it("rejects a placeholder canonical acceptance manifest", async () => {
    const program = completedProgramWithEvidence(".zerox/dummy-evidence.md");
    const root = await createFixture({
      program,
      features: doneFeatures(program),
      acceptanceManifestContent: "placeholder",
    });
    await expect(runChecker(root)).rejects.toContain(
      "acceptanceManifest must contain valid JSON",
    );
  });

  it("rejects one shared dummy artifact for every scenario result", async () => {
    const evidenceRef = ".zerox/dummy-evidence.md";
    const program = completedProgramWithEvidence(evidenceRef);
    const root = await createFixture({
      program,
      features: doneFeatures(program),
      acceptanceManifestContent: JSON.stringify(
        createAcceptanceManifest(program, evidenceRef),
      ),
    });
    await expect(runChecker(root)).rejects.toContain(
      "acceptance scenario S01-default must include at least one scenario-specific evidence ref",
    );
  });

  it("rejects a non-canonical acceptance manifest path", async () => {
    const program = createProgram();
    program.acceptanceManifest = ".zerox/alternate-acceptance.json";
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "acceptanceManifest must remain .zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
    );
  });

  it("rejects CD09 without the canonical acceptance artifact", async () => {
    const program = createProgram();
    program.workstreams[8].completionArtifacts = [".zerox/artifact.md"];
    const root = await createFixture({ program });
    await expect(runChecker(root)).rejects.toContain(
      "CD09 completionArtifacts must include the canonical acceptanceManifest",
    );
  });

  it("rejects an invalid accepted build identity", async () => {
    const evidenceRef = ".zerox/dummy-evidence.md";
    const program = completedProgramWithEvidence(evidenceRef);
    const acceptance = createAcceptanceManifest(program, evidenceRef);
    acceptance.app.buildCommit = "wrong";
    const root = await createFixture({
      program,
      features: doneFeatures(program),
      acceptanceManifestContent: JSON.stringify(acceptance),
    });
    await expect(runChecker(root)).rejects.toContain(
      "app must identify the v3.9.2 darwin-arm64 build commit and source tree digest",
    );
  });

  it("accepts a complete canonical manifest with scenario-specific evidence", async () => {
    const program = createProgram();
    const evidenceRefs = new Map(
      program.scenarioMatrix.map((scenario) => [
        scenario.id,
        `.zerox/evidence/${scenario.id}.json`,
      ]),
    );
    for (const workstream of program.workstreams) workstream.state = "completed";
    for (const scenario of program.scenarioMatrix) {
      scenario.acceptanceEvidence = [evidenceRefs.get(scenario.id)!];
    }
    program.status = "completed";
    program.activeFeatureId = null;
    program.nextFeatureId = null;
    const acceptance = createAcceptanceManifest(
      program,
      (scenarioId) => evidenceRefs.get(scenarioId)!,
    );
    const root = await createFixture({
      program,
      features: doneFeatures(program),
      acceptanceManifestContent: JSON.stringify(acceptance),
      additionalFiles: [...evidenceRefs.values()].map((relativePath) => ({
        relativePath,
        content: JSON.stringify({ schemaVersion: 1, status: "passed" }),
      })),
    });
    await expect(runChecker(root)).resolves.toContain(
      "Conversation disclosure program check passed",
    );
  });
});

type ScenarioFixture = {
  id: string;
  category: string;
  title: string;
  surface: string;
  executor: "browser" | "hybrid";
  fixture: string;
  setup: string;
  actions: string[];
  expected: string[];
  evidenceRequirements: string[];
  acceptanceEvidence: string[];
};

type WorkstreamFixture = {
  id: string;
  featureId: string;
  state: "planned" | "in_progress" | "completed";
  findings: string[];
  dependsOn: string[];
  architectureDecisionRequired: boolean;
  architectureDecision?: string;
  completionArtifacts: string[];
  rollback: string;
  verification: string[];
  acceptanceScenarioIds: string[];
  completionContract?: ReviewedShadowContractFixture;
};

type ReviewedShadowContractFixture = {
  schemaVersion: number;
  kind: "reviewed_shadow";
  primaryArtifact: string;
  minimumIndependentPasses: number;
  requiredReviewLanes: string[];
  requiredCharacterizationIds: string[];
  requiredSafety: Record<string, boolean>;
  requiredVerificationIds: string[];
  requiredExecutableClosurePaths: string[];
  postReviewMutablePaths: string[];
};

type ProgramFixture = {
  schemaVersion: number;
  programId: string;
  sourceReview: string;
  operatingGuide: string;
  architectureDecision: string;
  acceptanceManifest: string;
  status: "active" | "completed";
  activeFeatureId: string | null;
  nextFeatureId: string | null;
  maxActiveFeatures: number;
  implementationCompletionWorkstreamId: string;
  postImplementationGates: string[];
  rootFindings: string[];
  invariants: string[];
  nonGoals: string[];
  deferrals: Array<{
    id: string;
    status: string;
    trigger: string;
    prohibitedCurrentAction: string;
  }>;
  scenarioMatrix: ScenarioFixture[];
  workstreams: WorkstreamFixture[];
};

type Cd03ReviewBundle = {
  snapshotPath: string;
  snapshot: Record<string, unknown>;
  receiptPaths: string[];
  receipts: Array<Record<string, unknown>>;
  manifestPath: string;
  manifest: Record<string, unknown>;
  attestationPath: string;
  attestation?: Record<string, unknown>;
};

const reviewSnapshotKind = "conversation-disclosure-review-snapshot";
const reviewReceiptKind = "conversation-disclosure-review-receipt";
const closureManifestKind = "conversation-disclosure-closure-manifest";
const externalAttestationKind =
  "conversation-disclosure-external-closure-attestation";
const reviewAlgorithm = "sha256-canonical-json-v1";
const reviewRound = 20;
const reviewLanes = ["contract", "runtime", "governance"];
const reviewSnapshotPath =
  ".zerox/verification/conversation-disclosure/CD03-round20-review-snapshot.json";
const closureManifestPath =
  ".zerox/verification/conversation-disclosure/CD03-round20-closure-manifest.json";
const externalAttestationPath =
  ".zerox/verification/conversation-disclosure/CD03-round20-external-attestation.json";
const externalRunnerPath = "scripts/verify-conversation-disclosure-closure.mjs";

const scenarioCategories = [
  "default",
  "expanded",
  "evidence",
  "failure",
  "approval",
  "recovery",
  "plan",
  "scheduled",
  "long_session",
  "accessibility",
  "secret_safety",
  "retry",
  "legacy",
  "guided_input",
  "goal_acceptance",
  "plan_confirmation",
  "cancel",
  "context_usage",
  "unknown_coverage",
];

function createProgram(): ProgramFixture {
  const rootFindings = Array.from(
    { length: 13 },
    (_, index) => `D${index + 1}`,
  );
  const scenarioMatrix = scenarioCategories.map((category, index) => ({
    id: `S${String(index + 1).padStart(2, "0")}-${category}`,
    category,
    title: `${category} scenario`,
    surface: "chat",
    executor: index % 2 === 0 ? "browser" as const : "hybrid" as const,
    fixture: "real-app fixture",
    setup: "fixture",
    actions: ["act"],
    expected: ["observe"],
    evidenceRequirements: ["browser evidence", "persisted evidence"],
    acceptanceEvidence: [],
  }));
  const scenarioIds = scenarioMatrix.map((scenario) => scenario.id);
  return {
    schemaVersion: 1,
    programId: "test-conversation-disclosure",
    sourceReview: ".zerox/research.md",
    operatingGuide: ".zerox/guide.md",
    architectureDecision: ".zerox/decision.md",
    acceptanceManifest:
      ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
    status: "active",
    activeFeatureId: "P105",
    nextFeatureId: "P105",
    maxActiveFeatures: 1,
    implementationCompletionWorkstreamId: "CD08",
    postImplementationGates: ["CD09"],
    rootFindings,
    invariants: Array.from({ length: 5 }, (_, index) => `invariant ${index}`),
    nonGoals: ["non-goal one", "non-goal two", "non-goal three"],
    deferrals: [
      {
        id: "raw_reasoning",
        status: "kept_deferred",
        trigger: "separate decision",
        prohibitedCurrentAction: "do not implement",
      },
    ],
    scenarioMatrix,
    workstreams: Array.from({ length: 9 }, (_, index) => {
      const number = index + 1;
      const id = `CD${String(number).padStart(2, "0")}`;
      const findingsByWorkstream: Record<string, string[]> = {
        CD01: ["D1"],
        CD02: ["D1", "D4", "D13"],
        CD03: ["D2", "D3", "D6", "D9"],
        CD04: ["D5", "D7", "D10", "D12"],
        CD05: ["D8"],
        CD06: ["D11"],
        CD07: ["D2"],
        CD08: rootFindings,
        CD09: rootFindings,
      };
      return {
        id,
        featureId: `P${104 + number}`,
        state: number === 1 ? "in_progress" as const : "planned" as const,
        findings: findingsByWorkstream[id],
        dependsOn:
          number === 1
            ? []
            : [`CD${String(number - 1).padStart(2, "0")}`],
        architectureDecisionRequired: number <= 7,
        ...(number <= 7
          ? { architectureDecision: ".zerox/decision.md" }
          : {}),
        completionArtifacts: [
          ...(number === 3
            ? [
                ".zerox/decision.md",
                ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
              ]
            : [".zerox/artifact.md"]),
          ...(number === 9
            ? [
                ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
              ]
            : []),
        ],
        rollback: `rollback ${id}`,
        verification: ["focused tests"],
        acceptanceScenarioIds: number === 1 ? scenarioIds : [scenarioIds[0]],
        ...(number === 3
          ? { completionContract: createReviewedShadowContract() }
          : {}),
      };
    }),
  };
}

function createReviewedShadowContract(): ReviewedShadowContractFixture {
  return {
    schemaVersion: 1,
    kind: "reviewed_shadow",
    primaryArtifact:
      ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    minimumIndependentPasses: 3,
    requiredReviewLanes: ["contract", "runtime", "governance"],
    requiredCharacterizationIds: [
      "C01-global-request-claim",
      "C02-attempt-control",
      "C03-assistant-receipt-order",
      "C04-message-first-repair",
      "C05-required-settlement",
      "C06-ordinary-queue-drain",
      "C07-workspace-lifecycle",
      "C08-event-first-repair",
      "C09-approval-durability",
      "C10-approval-recovery",
      "C11-distinct-causal-identities",
      "C12-single-live-answer",
      "C13-safe-compatibility",
    ],
    requiredSafety: {
      lifecycleRecoveryRendererFixes: true,
      routingSessionTreatedAsDurableWithoutProof: false,
      terminalPublishedBeforeRequiredSettlement: false,
      requiredSettlementStartupRecoverySkipped: false,
      staleAttemptAssistantAccepted: false,
      approvalIntentPersistedWithoutCausalRef: false,
      agentRunAdmissionSurvivesWithoutOwner: false,
      agentRunResumeStartsWithoutRevisionLease: false,
      agentRunObserverFailureChangesOwnerLifecycle: false,
      rawAgentRunFailurePersisted: false,
      approvalIdOmittedFromSettlementFingerprint: false,
      selfAssertedReviewerObjectAccepted: false,
      candidateLocalClosureRunnerAccepted: false,
      failedRequiredSettlementOmitsFailureCode: false,
      runRepositoryBypassesRevisionFence: false,
      requiredSettlementCommitsAfterAttemptInvalidation: false,
      assistantAcceptanceCoexistsWithCommittedTerminal: false,
      agentRunRevisionTwoSnapshotCannotBootstrapMissingReplica: false,
      agentRunRevisionChangesExecutionEnvelope: false,
      failedSettlementAssistantReconciled: false,
      agentRunResumeWithoutOwnerLease: false,
      agentRunExecutionUsesMutableEnvelopeBeforeCas: false,
      agentRunShadowRevisionGapPersists: false,
      rawToolFailurePersistedOrPublished: false,
      nestedJsonCredentialPersistedOrPublished: false,
      unicodeCredentialSyntaxPersistedOrPublished: false,
      legacyAgentRunRawToolErrorPersistedOrPublished: false,
      finalAssistantCredentialPersistedOrPublished: false,
      externalClosureExecutesUnfrozenBytes: false,
      externalClosureReceiptStdoutIgnored: false,
      externalClosureSkipsPostflightRehash: false,
      externalClosureGovernanceInputsChangeAfterPreflight: false,
      agentRunAdmissionRevisionGapReconciled: false,
      crossDomainSuccessCommitsAsymmetrically: false,
      encodedOrMultilineCredentialPersistedOrPublished: false,
      splitStreamCredentialPersistedOrPublished: false,
      guidedInputCredentialPersistedOrPublished: false,
      rawModelServiceNoticePersistedOrPublished: false,
      rawAgentRunIdentityMemoryPersisted: false,
      higherAgentRunShadowAllowsStartup: false,
      stagedExecutableMutationAccepted: false,
      completedWithoutExternalClosureAttestation: false,
      handAuthoredReviewSnapshotAccepted: false,
      completedWithoutCallerPinnedExternalAnchor: false,
      nonRecoverableGovernancePublication: false,
      governanceAliasOrParentSwapAccepted: false,
      futureReviewReceiptAttested: false,
      partialAtomicTempBlocksRecovery: false,
      pathnameParentReplacementRedirectsCommit: false,
      exactTempMetadataBypassAccepted: false,
      leafEntrySwapBreaksPublicationRecovery: false,
      missingOrAmbiguousGovernanceCompletionMarkerAccepted: false,
      invalidGovernanceCompletionMarkerAccepted: false,
      zeroByteGovernanceTempBlocksRecovery: false,
      existingExactGovernanceTempSkipsFsync: false,
      agentRunDerivativePrecedesOwnerCommit: false,
    },
    requiredVerificationIds: [
      "focused",
      "test_type_coverage",
      "full_verify",
      "production_smoke",
      "governance",
    ],
    requiredExecutableClosurePaths: [
      "package.json",
      "scripts/check-harness-state.mjs",
      "scripts/check-conversation-disclosure-program.mjs",
    ],
    postReviewMutablePaths: [
      ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
      ".zerox/conversation-disclosure-program.json",
      ".zerox/feature_list.json",
      ".zerox/progress.md",
      "task_plan.md",
      "findings.md",
      "progress.md",
      reviewSnapshotPath,
      closureManifestPath,
      ".zerox/verification/conversation-disclosure/CD03-round20-contract-review.json",
      ".zerox/verification/conversation-disclosure/CD03-round20-runtime-review.json",
      ".zerox/verification/conversation-disclosure/CD03-round20-governance-review.json",
      externalAttestationPath,
    ],
  };
}

function createCd03CompletedFixtureState() {
  const program = createProgram();
  program.workstreams[0]!.state = "completed";
  program.workstreams[1]!.state = "completed";
  program.workstreams[2]!.state = "completed";
  program.workstreams[3]!.state = "in_progress";
  program.activeFeatureId = "P108";
  program.nextFeatureId = "P108";
  const features = [
    { id: "P105", status: "done" },
    { id: "P106", status: "done" },
    {
      id: "P107",
      status: "done",
      files: [
        ".zerox/decision.md",
        ".zerox/CD03-source.ts",
        ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
        "package.json",
        "scripts/check-harness-state.mjs",
        "scripts/check-conversation-disclosure-program.mjs",
        "scripts/conversation-disclosure-review-contract.mjs",
        externalRunnerPath,
      ],
    },
    { id: "P108", status: "in_progress" },
  ];
  return { program, features };
}

async function createFixture(options: {
  program?: ProgramFixture;
  featureStatus?: "done" | "in_progress";
  extraOpenFeature?: boolean;
  features?: Array<{ id: string; status: string; files?: string[] }>;
  acceptanceManifestContent?: string;
  cd03ArtifactContent?: string;
  mutateCd03ReviewBundle?: (bundle: Cd03ReviewBundle) => void;
  additionalFiles?: Array<{ relativePath: string; content: string }>;
} = {}): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "zerox-conversation-disclosure-check-"),
  );
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".zerox", "verification", "conversation-disclosure"), {
      recursive: true,
    }),
    mkdir(path.join(root, ".zerox", "evidence"), { recursive: true }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
  ]);
  const program = options.program ?? createProgram();
  const features = structuredClone(options.features ?? [
    { id: "P105", status: options.featureStatus ?? "in_progress" },
  ]);
  if (options.extraOpenFeature) {
    features.push({ id: "P999", status: "in_progress" });
  }
  const cd03Feature = features.find((feature) => feature.id === "P107");
  if (cd03Feature && !cd03Feature.files) {
    cd03Feature.files = [
      ".zerox/decision.md",
      ".zerox/CD03-source.ts",
      ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
      "package.json",
      "scripts/check-harness-state.mjs",
      "scripts/check-conversation-disclosure-program.mjs",
      "scripts/conversation-disclosure-review-contract.mjs",
      externalRunnerPath,
    ];
  }
  const cd03Completed = program.workstreams.find((workstream) => workstream.id === "CD03")
    ?.state === "completed";
  const cd03ArtifactContent = options.cd03ArtifactContent
    ?? (cd03Completed && cd03Feature
      ? JSON.stringify(createAcceptedCd03Artifact(program, cd03Feature))
      : undefined);
  const cd03ReviewBundle = cd03ArtifactContent === undefined
    ? undefined
    : createCd03ReviewBundle(
        JSON.parse(cd03ArtifactContent) as Record<string, unknown>,
        await realpath(root),
      );
  let externalAnchorPathForFixture: string | undefined;
  let externalAnchorForFixture: Record<string, unknown> | undefined;
  if (cd03ReviewBundle?.attestation) {
    const externalAnchorRoot = await mkdtemp(
      path.join(os.tmpdir(), "zerox-conversation-disclosure-anchor-"),
    );
    roots.push(externalAnchorRoot);
    externalAnchorPathForFixture = path.join(externalAnchorRoot, "anchor.json");
    externalAnchorForFixture = createExternalAnchor(
      cd03ReviewBundle,
      await realpath(root),
    );
    externalAnchorByRoot.set(root, externalAnchorPathForFixture);
  }
  if (cd03ReviewBundle) options.mutateCd03ReviewBundle?.(cd03ReviewBundle);
  await Promise.all([
    writeFile(
      path.join(root, ".zerox", "conversation-disclosure-program.json"),
      JSON.stringify(program),
      "utf8",
    ),
    writeFile(
      path.join(root, ".zerox", "feature_list.json"),
      JSON.stringify({ schemaVersion: 1, features }),
      "utf8",
    ),
    writeFile(path.join(root, ".zerox", "research.md"), "# Research\n", "utf8"),
    writeFile(path.join(root, ".zerox", "guide.md"), "# Guide\n", "utf8"),
    writeFile(path.join(root, ".zerox", "decision.md"), "# Decision\n", "utf8"),
    writeFile(
      path.join(root, ".zerox", "CD03-source.ts"),
      "export const fixture = true;\n",
      "utf8",
    ),
    writeFile(path.join(root, ".zerox", "artifact.md"), "# Artifact\n", "utf8"),
    writeFile(path.join(root, ".zerox", "dummy-evidence.md"), "# Evidence\n", "utf8"),
    writeFile(path.join(root, "package.json"), "{}\n", "utf8"),
    writeFile(path.join(root, "scripts", "check-harness-state.mjs"), "// fixture harness\n", "utf8"),
    writeFile(path.join(root, "scripts", "check-conversation-disclosure-program.mjs"), "// fixture checker\n", "utf8"),
    writeFile(path.join(root, "scripts", "conversation-disclosure-review-contract.mjs"), "// fixture review contract\n", "utf8"),
    writeFile(path.join(root, externalRunnerPath), "// fixture external runner\n", "utf8"),
    writeFile(
      path.join(root, ".zerox", "build-identity.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "3.9.2",
        buildCommit: "abcdef0",
        sourceTreeDigest: `sha256:${"a".repeat(64)}`,
        platform: "darwin-arm64",
        signatureStatus: "passed",
        launchStatus: "passed",
        packageSha256: "b".repeat(64),
      }),
      "utf8",
    ),
    ...(options.acceptanceManifestContent === undefined
      ? []
      : [
          writeFile(
            path.join(
              root,
              ".zerox",
              "verification",
              "conversation-disclosure",
              "CD09-real-app-acceptance.json",
            ),
            options.acceptanceManifestContent,
            "utf8",
          ),
        ]),
    ...(cd03ArtifactContent === undefined
      ? []
      : [
          writeFile(
            path.join(
              root,
              ".zerox",
              "verification",
              "conversation-disclosure",
              "CD03-causal-shadow.json",
            ),
            cd03ArtifactContent,
            "utf8",
          ),
        ]),
    ...(cd03ReviewBundle === undefined
      ? []
      : [
          writeFile(
            path.join(root, cd03ReviewBundle.snapshotPath),
            JSON.stringify(cd03ReviewBundle.snapshot),
            "utf8",
          ),
          ...cd03ReviewBundle.receipts.map((receipt, index) =>
            writeFile(
              path.join(root, cd03ReviewBundle.receiptPaths[index]!),
              JSON.stringify(receipt),
              "utf8",
            )
          ),
          writeFile(
            path.join(root, cd03ReviewBundle.manifestPath),
            JSON.stringify(cd03ReviewBundle.manifest),
            { encoding: "utf8", mode: 0o600 },
          ),
          ...(cd03ReviewBundle.attestation
            ? [
                writeFile(
                  path.join(root, cd03ReviewBundle.attestationPath),
                  JSON.stringify(cd03ReviewBundle.attestation),
                  { encoding: "utf8", mode: 0o600 },
                ),
              ]
            : []),
        ]),
    ...(options.additionalFiles ?? []).map((file) =>
      writeFile(path.join(root, file.relativePath), file.content, "utf8"),
    ),
    ...(externalAnchorPathForFixture && externalAnchorForFixture
      ? [
          writeFile(
            externalAnchorPathForFixture,
            JSON.stringify(externalAnchorForFixture),
            { encoding: "utf8", mode: 0o600 },
          ),
        ]
      : []),
  ]);
  if (cd03ReviewBundle) {
    await writeExactFreezeCompletedMarker(root, cd03ReviewBundle);
    if (cd03ReviewBundle.attestation
      && cd03ReviewBundle.manifest.status === "externally_attested"
      && externalAnchorPathForFixture
      && externalAnchorForFixture) {
      await writeExactExternalCompletedMarker(
        cd03ReviewBundle,
        externalAnchorPathForFixture,
        externalAnchorForFixture,
      );
    }
  }
  return root;
}

function createAcceptedCd03Artifact(
  program: ProgramFixture,
  feature: { id: string; status: string; files?: string[] },
) {
  const contract = program.workstreams.find((workstream) => workstream.id === "CD03")
    ?.completionContract!;
  const characterizations = contract.requiredCharacterizationIds.map((id) => ({
    id,
    result: "passed",
    evidence: `${id} fixture evidence`,
  }));
  const verification = contract.requiredVerificationIds.map((id) => ({
    id,
    command: `fixture:${id}`,
    result: "passed",
  }));
  const claims = {
    implementationBoundary: { mode: "fixture", disclosureProjectionCutover: false },
    sources: [".zerox/CD03-source.ts"],
    characterizations,
    verification,
    safety: contract.requiredSafety,
    rollback: "fixture rollback",
  };
  const contentByPath = new Map([
    [".zerox/decision.md", "# Decision\n"],
    [".zerox/CD03-source.ts", "export const fixture = true;\n"],
    ["package.json", "{}\n"],
    ["scripts/check-harness-state.mjs", "// fixture harness\n"],
    ["scripts/check-conversation-disclosure-program.mjs", "// fixture checker\n"],
    ["scripts/conversation-disclosure-review-contract.mjs", "// fixture review contract\n"],
    [externalRunnerPath, "// fixture external runner\n"],
  ]);
  const files = (feature.files ?? [])
    .filter((filePath) => !contract.postReviewMutablePaths.includes(filePath))
    .slice()
    .sort()
    .map((filePath) => ({
      path: filePath,
      sha256: hashText(contentByPath.get(filePath) ?? ""),
    }));
  const snapshotWithoutDigest = {
    schemaVersion: 1,
    kind: reviewSnapshotKind,
    algorithm: reviewAlgorithm,
    programId: program.programId,
    workstreamId: "CD03",
    featureId: feature.id,
    round: reviewRound,
    completionContractDigest: hashCanonical(contract),
    safetyContractDigest: hashCanonical(contract.requiredSafety),
    featureFileSetDigest: hashCanonical(feature.files),
    claimsDigest: hashCanonical(claims),
    files,
  };
  const reviewSnapshot = {
    ...snapshotWithoutDigest,
    digest: hashCanonical(snapshotWithoutDigest),
  };
  return {
    schemaVersion: 1,
    artifactId: "CD03-causal-shadow",
    programId: program.programId,
    featureId: "P107",
    status: "accepted",
    ...claims,
    reviewSnapshot,
    independentReview: {
      status: "passed",
      round: reviewRound,
      closureManifestPath,
      history: [],
    },
  };
}

function createCd03ReviewBundle(
  artifact: Record<string, unknown>,
  repositoryRealpath: string,
  externallyAttested = true,
): Cd03ReviewBundle {
  const snapshot = structuredClone(
    artifact.reviewSnapshot as Record<string, unknown>,
  );
  const receiptPaths = reviewLanes.map(
    (lane) => `.zerox/verification/conversation-disclosure/CD03-round20-${lane}-review.json`,
  );
  const receipts = reviewLanes.map((lane, index) => ({
    schemaVersion: 1,
    kind: reviewReceiptKind,
    programId: snapshot.programId,
    workstreamId: snapshot.workstreamId,
    featureId: snapshot.featureId,
    round: snapshot.round,
    lane,
    verdict: "passed",
    snapshotDigest: snapshot.digest,
    snapshotFileCount: (snapshot.files as unknown[]).length,
    completionContractDigest: snapshot.completionContractDigest,
    safetyContractDigest: snapshot.safetyContractDigest,
    transport: "codex-collaboration",
    reviewTaskPath: `/root/fixture_${lane}_${index + 1}`,
    reviewAgentId: `fixture-agent-${index + 1}`,
    challenge: hashText(`fixture-review-challenge-${lane}`),
    findingCounts: { critical: 0, major: 0, minor: 0 },
    findings: [],
    completedAt: `2026-08-24T00:00:0${index}.000Z`,
  }));
  const manifestWithoutDigest = {
    schemaVersion: 1,
    kind: closureManifestKind,
    programId: snapshot.programId,
    workstreamId: snapshot.workstreamId,
    featureId: snapshot.featureId,
    round: snapshot.round,
    status: "review_passed_pending_external_anchor",
    snapshot: { path: reviewSnapshotPath, digest: snapshot.digest },
    reviewReceipts: reviewLanes.map((lane, index) => ({
      lane,
      path: receiptPaths[index],
      canonicalDigest: hashCanonical(receipts[index]),
    })),
    executableClosure: [
      { kind: "package", path: "package.json", sha256: hashText("{}\n") },
      {
        kind: "checker",
        path: "scripts/check-conversation-disclosure-program.mjs",
        sha256: hashText("// fixture checker\n"),
      },
      {
        kind: "harness",
        path: "scripts/check-harness-state.mjs",
        sha256: hashText("// fixture harness\n"),
      },
    ],
    externalRunner: {
      path: externalRunnerPath,
      sha256: hashText("// fixture external runner\n"),
    },
    externalAttestation: {
      path: externalAttestationPath,
      canonicalDigest: null,
    },
  };
  const pendingManifest = {
    ...manifestWithoutDigest,
    digest: hashCanonical(manifestWithoutDigest),
  };
  const bundle: Cd03ReviewBundle = {
    snapshotPath: reviewSnapshotPath,
    snapshot,
    receiptPaths,
    receipts,
    manifestPath: closureManifestPath,
    manifest: pendingManifest,
    attestationPath: externalAttestationPath,
  };
  if (!externallyAttested) return bundle;

  const candidateResults = (["checker", "harness"] as const).map((kind) => {
    const receipt = {
      kind: kind === "checker" ? "cd03-checker-receipt" : "cd03-harness-receipt",
      status: "passed",
      snapshotDigest: snapshot.digest,
    };
    return {
      kind,
      path: kind === "checker"
        ? "scripts/check-conversation-disclosure-program.mjs"
        : "scripts/check-harness-state.mjs",
      receipt,
      receiptDigest: hashCanonical(receipt),
      stdoutDigest: hashText(`fixture ${kind} stdout`),
      stderrDigest: hashText(""),
      status: "passed",
    };
  });
  const attestationWithoutDigest = {
    schemaVersion: 1,
    kind: externalAttestationKind,
    trustLevel: "external-anchor-consistency",
    subjectIdentityAssurance: "not-signed",
    status: "passed",
    repositoryRealpath,
    runnerDigest: pendingManifest.externalRunner.sha256,
    snapshotDigest: snapshot.digest,
    pendingManifestDigest: pendingManifest.digest,
    reviewReceiptDigests: pendingManifest.reviewReceipts.map((entry) => ({
      lane: entry.lane,
      canonicalDigest: entry.canonicalDigest,
    })),
    candidateResults,
    completedAt: "2026-08-24T00:00:10.000Z",
  };
  bundle.attestation = {
    ...attestationWithoutDigest,
    digest: hashCanonical(attestationWithoutDigest),
  };
  const attestedManifestWithoutDigest = {
    ...pendingManifest,
    status: "externally_attested",
    externalAttestation: {
      path: externalAttestationPath,
      canonicalDigest: bundle.attestation.digest,
    },
  } as Record<string, unknown>;
  delete attestedManifestWithoutDigest.digest;
  bundle.manifest = {
    ...attestedManifestWithoutDigest,
    digest: hashCanonical(attestedManifestWithoutDigest),
  };
  return bundle;
}

function refreshCd03ReviewBundle(bundle: Cd03ReviewBundle): void {
  const reviewReceipts = reviewLanes.map((lane, index) => ({
    lane,
    path: bundle.receiptPaths[index],
    canonicalDigest: hashCanonical(bundle.receipts[index]),
  }));
  const manifestWithoutDigest = {
    ...bundle.manifest,
    status: "review_passed_pending_external_anchor",
    reviewReceipts,
    externalAttestation: {
      path: bundle.attestationPath,
      canonicalDigest: null,
    },
  } as Record<string, unknown>;
  delete manifestWithoutDigest.digest;
  const pendingManifest = {
    ...manifestWithoutDigest,
    digest: hashCanonical(manifestWithoutDigest),
  };
  if (!bundle.attestation) {
    bundle.manifest = pendingManifest;
    return;
  }
  const attestationWithoutDigest = {
    ...bundle.attestation,
    runnerDigest: (
      (pendingManifest as Record<string, unknown>).externalRunner as Record<string, unknown>
    ).sha256,
    snapshotDigest: bundle.snapshot.digest,
    pendingManifestDigest: pendingManifest.digest,
    reviewReceiptDigests: reviewReceipts.map((entry) => ({
      lane: entry.lane,
      canonicalDigest: entry.canonicalDigest,
    })),
    candidateResults: (bundle.attestation.candidateResults as Array<Record<string, unknown>>)
      .map((result) => {
        const receipt = {
          ...(result.receipt as Record<string, unknown>),
          snapshotDigest: bundle.snapshot.digest,
        };
        return {
          ...result,
          receipt,
          receiptDigest: hashCanonical(receipt),
        };
      }),
  } as Record<string, unknown>;
  delete attestationWithoutDigest.digest;
  bundle.attestation = {
    ...attestationWithoutDigest,
    digest: hashCanonical(attestationWithoutDigest),
  };
  const attestedManifestWithoutDigest = {
    ...pendingManifest,
    status: "externally_attested",
    externalAttestation: {
      path: bundle.attestationPath,
      canonicalDigest: bundle.attestation.digest,
    },
  } as Record<string, unknown>;
  delete attestedManifestWithoutDigest.digest;
  bundle.manifest = {
    ...attestedManifestWithoutDigest,
    digest: hashCanonical(attestedManifestWithoutDigest),
  };
}

function makeCd03ReviewBundlePending(bundle: Cd03ReviewBundle): void {
  bundle.attestation = undefined;
  const pendingManifestWithoutDigest = {
    ...bundle.manifest,
    status: "review_passed_pending_external_anchor",
    externalAttestation: {
      path: bundle.attestationPath,
      canonicalDigest: null,
    },
  } as Record<string, unknown>;
  delete pendingManifestWithoutDigest.digest;
  bundle.manifest = {
    ...pendingManifestWithoutDigest,
    digest: hashCanonical(pendingManifestWithoutDigest),
  };
}

function createExternalAnchor(
  bundle: Cd03ReviewBundle,
  repositoryRealpath: string,
): Record<string, unknown> {
  const attestation = bundle.attestation!;
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-external-anchor",
    trustLevel: "external-caller-pinned-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath,
    runnerDigest: attestation.runnerDigest,
    snapshotDigest: bundle.snapshot.digest,
    attestationDigest: attestation.digest,
    reviewReceipts: bundle.receipts.map((receipt) => ({
      lane: receipt.lane,
      canonicalDigest: hashCanonical(receipt),
      challenge: receipt.challenge,
    })),
    completedAt: attestation.completedAt,
  };
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

function refreshExternalAttestationDigest(bundle: Cd03ReviewBundle): void {
  const attestationWithoutDigest = {
    ...bundle.attestation,
  } as Record<string, unknown>;
  delete attestationWithoutDigest.digest;
  bundle.attestation = {
    ...attestationWithoutDigest,
    digest: hashCanonical(attestationWithoutDigest),
  };
  const manifestWithoutDigest = {
    ...bundle.manifest,
    externalAttestation: {
      path: bundle.attestationPath,
      canonicalDigest: bundle.attestation.digest,
    },
  } as Record<string, unknown>;
  delete manifestWithoutDigest.digest;
  bundle.manifest = {
    ...manifestWithoutDigest,
    digest: hashCanonical(manifestWithoutDigest),
  };
}

function hashText(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function restoreHistoricalHarnessFromArchive(
  repositoryRoot: string,
  fixtureRoot: string,
): Promise<void> {
  const archive = await readJsonFile(path.join(
    repositoryRoot,
    ".zerox",
    "verification",
    "conversation-disclosure",
    "CD03A-round3-baseline-archive.json",
  ));
  const entry = (archive.entries as Array<{
    path: string;
    source: string;
    sha256: string;
    encoding: string;
    bytes: string;
  }>).find((candidate) => candidate.path === "scripts/check-harness-state.mjs");
  if (!entry || entry.source !== "governance_transition"
    || entry.encoding !== "gzip-base64-v1") {
    throw new Error("Round3 archive lacks the historical harness baseline");
  }
  const historicalBytes = gunzipSync(Buffer.from(entry.bytes, "base64"));
  if (hashText(historicalBytes) !== entry.sha256) {
    throw new Error("Round3 historical harness archive hash is stale");
  }
  await writeFile(path.join(fixtureRoot, entry.path), historicalBytes);
}

function hashCanonical(value: unknown): string {
  return hashText(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function completedProgramWithEvidence(evidenceRef: string): ProgramFixture {
  const program = createProgram();
  for (const workstream of program.workstreams) workstream.state = "completed";
  for (const scenario of program.scenarioMatrix) {
    scenario.acceptanceEvidence = [evidenceRef];
  }
  program.status = "completed";
  program.activeFeatureId = null;
  program.nextFeatureId = null;
  return program;
}

function doneFeatures(program: ProgramFixture) {
  return program.workstreams.map((workstream) => ({
    id: workstream.featureId,
    status: "done",
  }));
}

function createAcceptanceManifest(
  program: ProgramFixture,
  evidenceRef: string | ((scenarioId: string) => string),
) {
  const evidenceFor = (scenarioId: string) =>
    typeof evidenceRef === "string" ? evidenceRef : evidenceRef(scenarioId);
  return {
    schemaVersion: 1,
    programId: program.programId,
    app: {
      status: "passed",
      version: "3.9.2",
      buildCommit: "abcdef0",
      sourceTreeDigest: `sha256:${"a".repeat(64)}`,
      platform: "darwin-arm64",
      identityManifest: ".zerox/build-identity.json",
      identityEvidenceRefs: [".zerox/build-identity.json"],
    },
    runner: {
      kind: "browser",
      name: "fixture-browser",
      version: "1.0.0",
    },
    secretScan: {
      status: "passed",
      evidenceRefs: [".zerox/dummy-evidence.md"],
    },
    independentReview: {
      status: "passed",
      evidenceRefs: [".zerox/dummy-evidence.md"],
    },
    scenarioResults: program.scenarioMatrix.map((scenario) => {
      const scenarioEvidence = evidenceFor(scenario.id);
      return {
        scenarioId: scenario.id,
        executor: scenario.executor,
        fixture: scenario.fixture,
        status: "passed",
        evidenceRefs: [scenarioEvidence],
        requirementResults: scenario.evidenceRequirements.map((requirement) => ({
          requirement,
          status: "passed",
          evidenceRefs: [scenarioEvidence],
        })),
      };
    }),
  };
}

async function createCurrentCd03ClosureRoot(): Promise<{
  root: string;
  snapshotDigest: string;
}> {
  const repositoryRoot = process.cwd();
  const [program, featureList, artifact] = await Promise.all([
    readJsonFile(path.join(repositoryRoot, ".zerox", "conversation-disclosure-program.json")),
    readJsonFile(path.join(repositoryRoot, ".zerox", "feature_list.json")),
    readJsonFile(path.join(
      repositoryRoot,
      ".zerox",
      "verification",
      "conversation-disclosure",
      "CD03-causal-shadow.json",
    )),
  ]);
  const features = featureList.features as Array<{
    id: string;
    status: string;
    files: string[];
  }>;
  const feature = features.find(
    (candidate) => candidate.id === "P107-conversation-disclosure-domain-adapters",
  )!;
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-closure-"));
  roots.push(root);

  for (const directory of [".zerox", "scripts", "docs", ".github"]) {
    await cp(path.join(repositoryRoot, directory), path.join(root, directory), {
      recursive: true,
    });
  }
  for (const relativePath of ["AGENTS.md", "README.md", "init.sh"]) {
    await cp(path.join(repositoryRoot, relativePath), path.join(root, relativePath));
  }
  for (const relativePath of feature.files) {
    if (relativePath.startsWith(".zerox/")) continue;
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), target);
  }
  await restoreHistoricalHarnessFromArchive(repositoryRoot, root);
  const snapshotDigest = await writeCompletedCd03ReviewState(
    root,
    program,
    featureList,
    artifact,
    { pendingExternalCandidate: true },
  );
  return { root, snapshotDigest };
}

async function writeCompletedCd03ReviewState(
  root: string,
  program: Record<string, unknown>,
  featureList: Record<string, unknown>,
  artifact: Record<string, unknown>,
  options: { pendingExternalCandidate?: boolean } = {},
): Promise<string> {
  const features = featureList.features as Array<{
    id: string;
    status: string;
    files: string[];
  }>;
  const feature = features.find(
    (candidate) => candidate.id === "P107-conversation-disclosure-domain-adapters",
  )!;
  const workstreams = program.workstreams as Array<{
    id: string;
    state: string;
    featureId?: string;
    completionContract?: ReviewedShadowContractFixture;
  }>;
  const cd03 = workstreams.find((workstream) => workstream.id === "CD03")!;
  const contract = cd03.completionContract!;
  const cd03Index = workstreams.indexOf(cd03);
  const downstreamFeatureIds = new Set(
    workstreams.slice(cd03Index + 1).map((workstream) => workstream.featureId)
      .filter((featureId): featureId is string => Boolean(featureId)),
  );
  for (const downstream of workstreams.slice(cd03Index + 1)) {
    downstream.state = "planned";
  }
  featureList.features = features.filter(
    (candidate) => !downstreamFeatureIds.has(candidate.id),
  );
  contract.postReviewMutablePaths = [
    ...contract.postReviewMutablePaths.filter(
      (relativePath) => !/^\.zerox\/verification\/conversation-disclosure\/CD03-round[0-9]+-/.test(
        relativePath,
      ),
    ),
    reviewSnapshotPath,
    closureManifestPath,
    ".zerox/verification/conversation-disclosure/CD03-round20-contract-review.json",
    ".zerox/verification/conversation-disclosure/CD03-round20-runtime-review.json",
    ".zerox/verification/conversation-disclosure/CD03-round20-governance-review.json",
    externalAttestationPath,
  ];
  if (options.pendingExternalCandidate) {
    cd03.state = "in_progress";
    program.activeFeatureId = feature.id;
    program.nextFeatureId = feature.id;
    feature.status = "in_progress";
    artifact.status = "review_pending";
  } else {
    const nextFeatureId = workstreams[cd03Index + 1]?.featureId;
    if (!nextFeatureId) {
      throw new Error("CD03 fixture must retain a downstream planned Feature");
    }
    cd03.state = "completed";
    program.activeFeatureId = null;
    program.nextFeatureId = nextFeatureId;
    feature.status = "done";
    artifact.status = "accepted";
  }
  const claims = {
    implementationBoundary: artifact.implementationBoundary,
    sources: artifact.sources,
    characterizations: artifact.characterizations,
    verification: artifact.verification,
    safety: artifact.safety,
    rollback: artifact.rollback,
  };
  const files = await Promise.all(
    feature.files
      .filter((relativePath) => !contract.postReviewMutablePaths.includes(relativePath))
      .slice()
      .sort()
      .map(async (relativePath) => ({
        path: relativePath,
        sha256: `sha256:${createHash("sha256")
          .update(await readFile(path.join(root, relativePath)))
          .digest("hex")}`,
      })),
  );
  const snapshotWithoutDigest = {
    schemaVersion: 1,
    kind: reviewSnapshotKind,
    algorithm: reviewAlgorithm,
    programId: program.programId,
    workstreamId: "CD03",
    featureId: feature.id,
    round: reviewRound,
    completionContractDigest: hashCanonical(contract),
    safetyContractDigest: hashCanonical(contract.requiredSafety),
    featureFileSetDigest: hashCanonical(feature.files),
    claimsDigest: hashCanonical(claims),
    files,
  };
  const snapshotDigest = hashCanonical(snapshotWithoutDigest);
  artifact.reviewSnapshot = {
    ...snapshotWithoutDigest,
    digest: snapshotDigest,
  };
  artifact.independentReview = {
    status: options.pendingExternalCandidate
      ? "passed_pending_external_attestation"
      : "passed",
    round: reviewRound,
    closureManifestPath,
    history: [],
  };
  const bundle = createCd03ReviewBundle(
    artifact,
    await realpath(root),
    !options.pendingExternalCandidate,
  );
  const executableClosure = bundle.manifest.executableClosure as Array<{
    kind: string;
    path: string;
    sha256: string;
  }>;
  for (const entry of executableClosure) {
    entry.sha256 = `sha256:${createHash("sha256")
      .update(await readFile(path.join(root, entry.path)))
      .digest("hex")}`;
  }
  (bundle.manifest.externalRunner as Record<string, unknown>).sha256 =
    `sha256:${createHash("sha256")
      .update(await readFile(path.join(root, externalRunnerPath)))
      .digest("hex")}`;
  refreshCd03ReviewBundle(bundle);
  let externalAnchorPathForState: string | undefined;
  let externalAnchorForState: Record<string, unknown> | undefined;
  if (bundle.attestation) {
    const externalAnchorRoot = await mkdtemp(
      path.join(os.tmpdir(), "zerox-conversation-disclosure-state-anchor-"),
    );
    roots.push(externalAnchorRoot);
    externalAnchorPathForState = path.join(externalAnchorRoot, "anchor.json");
    externalAnchorForState = createExternalAnchor(bundle, await realpath(root));
    externalAnchorByRoot.set(root, externalAnchorPathForState);
  }
  await Promise.all([
    writeFile(
      path.join(root, ".zerox", "conversation-disclosure-program.json"),
      JSON.stringify(program),
      "utf8",
    ),
    writeFile(
      path.join(root, ".zerox", "feature_list.json"),
      JSON.stringify(featureList),
      "utf8",
    ),
    writeFile(
      path.join(
        root,
        ".zerox",
        "verification",
        "conversation-disclosure",
        "CD03-causal-shadow.json",
      ),
      JSON.stringify(artifact),
      "utf8",
    ),
    writeFile(path.join(root, bundle.snapshotPath), JSON.stringify(bundle.snapshot), "utf8"),
    ...bundle.receipts.map((receipt, index) =>
      writeFile(
        path.join(root, bundle.receiptPaths[index]!),
        JSON.stringify(receipt),
        "utf8",
      )
    ),
    writeFile(
      path.join(root, bundle.manifestPath),
      JSON.stringify(bundle.manifest),
      { encoding: "utf8", mode: 0o600 },
    ),
    ...(bundle.attestation
      ? [
          writeFile(
            path.join(root, bundle.attestationPath),
            JSON.stringify(bundle.attestation),
            { encoding: "utf8", mode: 0o600 },
          ),
        ]
      : []),
    ...(externalAnchorPathForState && externalAnchorForState
      ? [
          writeFile(
            externalAnchorPathForState,
            JSON.stringify(externalAnchorForState),
            { encoding: "utf8", mode: 0o600 },
          ),
        ]
      : []),
  ]);
  await writeExactFreezeCompletedMarker(root, bundle);
  if (bundle.attestation && externalAnchorPathForState && externalAnchorForState) {
    await writeExactExternalCompletedMarker(
      bundle,
      externalAnchorPathForState,
      externalAnchorForState,
    );
  }
  return snapshotDigest;
}

async function writeCompletedMarker(
  markerBasePath: string,
  value: Record<string, unknown>,
): Promise<string> {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const sourcePath = `${markerBasePath}.marker-source`;
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  const entry = await lstat(sourcePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const markerPath = `${markerBasePath}.completed-${digest}-${entry.dev}-${entry.ino}.marker`;
  await rename(sourcePath, markerPath);
  return markerPath;
}

async function writeExactFreezeCompletedMarker(
  root: string,
  bundle: Cd03ReviewBundle,
): Promise<string> {
  const snapshotBytes = await readFile(path.join(root, bundle.snapshotPath));
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-review-freeze-transaction",
    status: "prepared",
    round: bundle.snapshot.round,
    mode: "created",
    snapshotPath: bundle.snapshotPath,
    artifactPath: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    originalSnapshotDigest: null,
    targetSnapshotDigest: hashText(snapshotBytes),
    originalArtifactDigest: hashText("fixture original artifact bytes"),
    targetArtifactDigest: hashText("fixture freeze-time pending artifact bytes"),
  };
  return writeCompletedMarker(
    path.join(root, `${bundle.snapshotPath}.freeze-transaction.json.remove.tombstone`),
    { ...withoutDigest, digest: hashCanonical(withoutDigest) },
  );
}

async function writeExactExternalCompletedMarker(
  bundle: Cd03ReviewBundle,
  externalAnchorPath: string,
  externalAnchor: Record<string, unknown>,
): Promise<string> {
  const canonicalAnchorPath = path.join(
    await realpath(path.dirname(externalAnchorPath)),
    path.basename(externalAnchorPath),
  );
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-external-publication-transaction",
    status: "prepared",
    manifestPath: bundle.manifestPath,
    attestationPath: bundle.attestationPath,
    anchorOutputPath: canonicalAnchorPath,
    originalManifestDigest: hashText("fixture pending manifest bytes"),
    targetManifestDigest: hashText(`${canonicalJson(bundle.manifest)}\n`),
    targetAttestationDigest: hashText(`${canonicalJson(bundle.attestation)}\n`),
    targetAnchorDigest: hashText(`${canonicalJson(externalAnchor)}\n`),
    attestation: bundle.attestation,
    finalManifest: bundle.manifest,
    externalAnchor,
  };
  return writeCompletedMarker(
    `${externalAnchorPath}.publication-transaction.json.remove.tombstone`,
    { ...withoutDigest, digest: hashCanonical(withoutDigest) },
  );
}

async function findCompletedMarker(markerBasePath: string): Promise<string> {
  const markerBase = path.basename(markerBasePath);
  const markerNames = (await readdir(path.dirname(markerBasePath))).filter(
    (entry) => entry.startsWith(`${markerBase}.completed-`)
      && entry.endsWith(".marker"),
  );
  expect(markerNames).toHaveLength(1);
  return path.join(path.dirname(markerBasePath), markerNames[0]!);
}

async function runClosureEntry(
  root: string,
  relativeScriptPath: string,
  snapshotDigest: string,
): Promise<string> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        path.join(root, relativeScriptPath),
        "--closure",
        "--expected-snapshot-digest",
        snapshotDigest,
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}

async function runActualExternalClosure(
  root: string,
  snapshotDigest: string,
): Promise<string> {
  const manifest = await readJsonFile(path.join(root, closureManifestPath));
  const receiptEntries = manifest.reviewReceipts as Array<{
    lane: string;
    path: string;
    canonicalDigest: string;
  }>;
  const anchorRoot = await mkdtemp(
    path.join(os.tmpdir(), "zerox-conversation-disclosure-real-runner-anchor-"),
  );
  roots.push(anchorRoot);
  const args = [
    externalRunnerSource,
    "--repo",
    root,
    "--expected-repo-realpath",
    await realpath(root),
    "--closure-manifest",
    closureManifestPath,
    "--expected-runner-digest",
    hashText(await readFile(externalRunnerSource)),
    "--expected-snapshot-digest",
    snapshotDigest,
    "--external-anchor-output",
    path.join(anchorRoot, "anchor.json"),
  ];
  for (const entry of receiptEntries) {
    const receipt = await readJsonFile(path.join(root, entry.path));
    args.push(
      "--expected-review-receipt",
      `${entry.lane}=${entry.canonicalDigest}`,
      "--expected-review-challenge",
      `${entry.lane}=${receipt.challenge}`,
    );
  }
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}

async function runChecker(
  root: string,
  options: {
    externalAnchor?: boolean | string;
    expectedExternalAnchorDigest?: string;
  } = {},
): Promise<string> {
  const configuredAnchor = options.externalAnchor === false
    ? undefined
    : typeof options.externalAnchor === "string"
      ? options.externalAnchor
      : externalAnchorByRoot.get(root);
  const configuredAnchorDigest = options.expectedExternalAnchorDigest ?? (configuredAnchor
    ? (JSON.parse(await readFile(configuredAnchor, "utf8")) as { digest: string }).digest
    : undefined);
  try {
    const result = await execFileAsync(process.execPath, [
      checker,
      ...(configuredAnchor
        ? [
            "--external-anchor",
            configuredAnchor,
            "--expected-external-anchor-digest",
            configuredAnchorDigest!,
          ]
        : []),
    ], {
      cwd: root,
      encoding: "utf8",
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}
