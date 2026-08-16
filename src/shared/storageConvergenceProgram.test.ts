import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.join(
  process.cwd(),
  "scripts",
  "check-storage-convergence-program.mjs",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("storage convergence program checker", () => {
  it("accepts one active dependency-ordered P97 program", async () => {
    const root = await createFixture(createManifest());
    await expect(runChecker(root)).resolves.toContain(
      "Storage convergence program check passed",
    );
  });

  it("rejects multiple active workstreams", async () => {
    const manifest = createManifest();
    manifest.workstreams[1]!.state = "in_progress";
    const root = await createFixture(manifest);
    await expect(runChecker(root)).rejects.toContain(
      "requires one in_progress workstream",
    );
  });

  it("rejects an active workstream before its dependency completes", async () => {
    const manifest = createManifest();
    manifest.workstreams[0]!.state = "planned";
    manifest.workstreams[1]!.state = "in_progress";
    manifest.activeWorkstreamId = "SC02";
    const root = await createFixture(manifest);
    await expect(runChecker(root)).rejects.toContain(
      "SC02 started before SC01 completed",
    );
  });

  it("rejects a missing target domain or file-backed exclusion", async () => {
    const manifest = createManifest();
    manifest.domainAuthority.pop();
    manifest.fileBackedExclusions.pop();
    const root = await createFixture(manifest);
    await expect(runChecker(root)).rejects.toContain(
      "storage convergence is missing domain promoted_eval_fixture",
    );
    await expect(runChecker(root)).rejects.toContain(
      "storage convergence is missing exclusion artifact_payloads",
    );
  });

  it("accepts completed closure only with P97 done and no active ids", async () => {
    const manifest = createManifest();
    manifest.status = "completed";
    manifest.activeFeatureId = null;
    manifest.activeWorkstreamId = null;
    for (const workstream of manifest.workstreams) {
      workstream.state = "completed";
    }
    const root = await createFixture(manifest, "done");
    await expect(runChecker(root)).resolves.toContain(
      "Storage convergence program check passed",
    );
  });
});

type Workstream = {
  id: string;
  state: "planned" | "in_progress" | "completed";
  dependsOn: string[];
  rollback: string;
  verification: string[];
};

type Manifest = {
  schemaVersion: number;
  status: "active" | "completed";
  activeFeatureId: string | null;
  activeWorkstreamId: string | null;
  maxActiveFeatures: number;
  operatingGuide: string;
  architectureDecision: string;
  workstreams: Workstream[];
  domainAuthority: Array<{
    domain: string;
    current: "json";
    target: "sqlite";
    workstream: string;
  }>;
  fileBackedExclusions: Array<{ domain: string; reason: string }>;
};

function createManifest(): Manifest {
  const dependencies: Record<string, string[]> = {
    SC01: [],
    SC02: ["SC01"],
    SC03: ["SC02"],
    SC04: ["SC02"],
    SC05: ["SC02"],
    SC06: ["SC02"],
    SC07: ["SC03", "SC04", "SC05", "SC06"],
    SC08: ["SC07"],
  };
  return {
    schemaVersion: 1,
    status: "active",
    activeFeatureId: "P97-sqlite-domain-storage-convergence",
    activeWorkstreamId: "SC01",
    maxActiveFeatures: 1,
    operatingGuide: ".zerox/guide.md",
    architectureDecision: ".zerox/decision.md",
    workstreams: Object.entries(dependencies).map(([id, dependsOn], index) => ({
      id,
      state: index === 0 ? "in_progress" : "planned",
      dependsOn,
      rollback: `rollback ${id}`,
      verification: ["focused tests"],
    })),
    domainAuthority: [
      ["goal", "SC03"],
      ["execution_checkpoint", "SC03"],
      ["memory", "SC04"],
      ["workspace", "SC05"],
      ["multi_agent_session", "SC05"],
      ["learning_candidate", "SC06"],
      ["eval_candidate", "SC06"],
      ["promoted_eval_fixture", "SC06"],
    ].map(([domain, workstream]) => ({
      domain: domain!,
      current: "json" as const,
      target: "sqlite" as const,
      workstream: workstream!,
    })),
    fileBackedExclusions: [
      "model_settings_and_credentials",
      "tool_result_blobs",
      "workspace_run_ledger",
      "raw_history",
      "artifact_payloads",
    ].map((domain) => ({ domain, reason: `keep ${domain} file-backed` })),
  };
}

async function createFixture(
  manifest: Manifest,
  featureStatus: "in_progress" | "done" = "in_progress",
): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "zerox-storage-convergence-check-"),
  );
  roots.push(root);
  await mkdir(path.join(root, ".zerox"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, ".zerox", "storage-convergence-program.json"),
      JSON.stringify(manifest),
      "utf8",
    ),
    writeFile(
      path.join(root, ".zerox", "feature_list.json"),
      JSON.stringify({
        features: [
          {
            id: "P97-sqlite-domain-storage-convergence",
            status: featureStatus,
          },
        ],
      }),
      "utf8",
    ),
    writeFile(path.join(root, ".zerox", "guide.md"), "# guide\n", "utf8"),
    writeFile(path.join(root, ".zerox", "decision.md"), "# decision\n", "utf8"),
  ]);
  return root;
}

async function runChecker(root: string): Promise<string> {
  try {
    return (
      await execFileAsync(process.execPath, [checker], {
        cwd: root,
        encoding: "utf8",
      })
    ).stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}
