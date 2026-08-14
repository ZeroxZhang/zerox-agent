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
  "check-kernel-migration-program.mjs",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Kernel migration program checker", () => {
  it("accepts the dependency-ordered single-active migration", async () => {
    const root = await createFixture();
    await expect(runChecker(root)).resolves.toContain(
      "Kernel migration program check passed",
    );
  });

  it("accepts an idle boundary before promoting the next Feature", async () => {
    const manifest = createManifest();
    manifest.workstreams[0].state = "completed";
    manifest.activeFeatureId = null;
    manifest.nextFeatureId = "P85";
    const root = await createFixture({
      manifest,
      featureStatus: "done",
    });
    await expect(runChecker(root)).resolves.toContain(
      "Kernel migration program check passed",
    );
  });

  it.each([
    {
      name: "dependency cycles",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[0].dependsOn = ["KM09"];
      },
      expected: "kernel migration dependency cycle",
    },
    {
      name: "multiple active workstreams",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[1].state = "in_progress";
      },
      expected: "in-progress workstreams; maximum is 1",
    },
    {
      name: "missing post-migration review dependency",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[7].dependsOn = [];
      },
      expected: "KM08 must depend on migration completion KM07",
    },
    {
      name: "premature arbitrary Code Mode approval",
      mutate(manifest: ProgramFixture) {
        manifest.deferredCapabilities[2].status =
          "approved_for_independent_program";
      },
      expected: "cannot leave deferred status before KM09 completes",
    },
    {
      name: "missing deferral isolation boundary",
      mutate(manifest: ProgramFixture) {
        manifest.deferredCapabilities[2].prohibitedCurrentAction = "";
      },
      expected: "prohibitedCurrentAction is required",
    },
  ])("rejects $name", async ({ mutate, expected }) => {
    const manifest = createManifest();
    mutate(manifest);
    const root = await createFixture({ manifest });
    await expect(runChecker(root)).rejects.toContain(expected);
  });

  it("rejects missing program artifacts", async () => {
    const manifest = createManifest();
    manifest.operatingGuide = ".zerox/missing-guide.md";
    const root = await createFixture({ manifest });
    await expect(runChecker(root)).rejects.toContain(
      "operatingGuide does not exist",
    );
  });

  it("rejects migration and Feature status drift", async () => {
    const root = await createFixture({ featureStatus: "done" });
    await expect(runChecker(root)).rejects.toContain(
      "must be in_progress while KM01 is active",
    );
  });
});

type WorkstreamFixture = {
  id: string;
  featureId: string;
  state: "planned" | "in_progress" | "completed";
  findings: string[];
  dependsOn: string[];
  architectureDecisionRequired: boolean;
  rollback: string;
  verification: string[];
};

type DeferredCapabilityFixture = {
  id: string;
  status: string;
  decisionGate: string;
  currentEvidence: string;
  trigger: string;
  prohibitedCurrentAction: string;
};

type ProgramFixture = {
  schemaVersion: number;
  programId: string;
  sourceReview: string;
  operatingGuide: string;
  architectureDecision: string;
  status: "active" | "completed";
  activeFeatureId: string | null;
  nextFeatureId: string | null;
  maxActiveFeatures: number;
  migrationCompletionWorkstreamId: string;
  postMigrationGates: string[];
  invariants: string[];
  nonGoals: string[];
  deferredCapabilities: DeferredCapabilityFixture[];
  workstreams: WorkstreamFixture[];
};

function createManifest(): ProgramFixture {
  const workstreams = Array.from({ length: 9 }, (_, index) => {
    const number = index + 1;
    return {
      id: `KM${String(number).padStart(2, "0")}`,
      featureId: `P${83 + number}`,
      state: number === 1 ? "in_progress" as const : "planned" as const,
      findings: [`FINDING_${number}`],
      dependsOn:
        number === 1
          ? []
          : [`KM${String(number - 1).padStart(2, "0")}`],
      architectureDecisionRequired: number <= 7,
      rollback: `rollback KM${number}`,
      verification: ["focused tests"],
    };
  });
  return {
    schemaVersion: 1,
    programId: "test-kernel-migration",
    sourceReview: "docs/review.md",
    operatingGuide: ".zerox/guide.md",
    architectureDecision: ".zerox/decision.md",
    status: "active",
    activeFeatureId: "P84",
    nextFeatureId: "P84",
    maxActiveFeatures: 1,
    migrationCompletionWorkstreamId: "KM07",
    postMigrationGates: ["KM08", "KM09"],
    invariants: Array.from({ length: 6 }, (_, index) => `invariant ${index}`),
    nonGoals: ["no compaction", "no provider", "no arbitrary code"],
    deferredCapabilities: [
      "context_event_compaction",
      "external_subagent_provider",
      "arbitrary_code_mode",
    ].map((id) => ({
      id,
      status: "deferred_for_test",
      decisionGate: "KM09",
      currentEvidence: "baseline evidence",
      trigger: "explicit trigger",
      prohibitedCurrentAction: "do not implement",
    })),
    workstreams,
  };
}

async function createFixture(options: {
  manifest?: ProgramFixture;
  featureStatus?: "done" | "in_progress";
} = {}): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "zerox-kernel-migration-check-"),
  );
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".zerox"), { recursive: true }),
    mkdir(path.join(root, "docs"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, ".zerox", "kernel-migration-program.json"),
      JSON.stringify(options.manifest ?? createManifest()),
      "utf8",
    ),
    writeFile(
      path.join(root, ".zerox", "feature_list.json"),
      JSON.stringify({
        schemaVersion: 1,
        features: [
          { id: "P84", status: options.featureStatus ?? "in_progress" },
        ],
      }),
      "utf8",
    ),
    writeFile(path.join(root, ".zerox", "guide.md"), "# Guide\n", "utf8"),
    writeFile(path.join(root, ".zerox", "decision.md"), "# Decision\n", "utf8"),
    writeFile(path.join(root, "docs", "review.md"), "# Review\n", "utf8"),
  ]);
  return root;
}

async function runChecker(root: string): Promise<string> {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}
