import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
};

describe("package scripts", () => {
  it("binds macOS release artifacts to one clean Git commit", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts", "package-mac.mjs"),
      "utf8",
    );

    expect(source).toContain('const gitBin = "/usr/bin/git"');
    expect(source).toContain('"--mac",\n    ...targets,');
    expect(source).toContain('"--publish",\n    "never",');
    expect(source).toContain('if (key.startsWith("GIT_")) delete env[key]');
    expect(source).toContain('"status", "--porcelain", "--untracked-files=all"');
    expect(source.match(/readFrozenGitCommit\(\)/g)).toHaveLength(4);
    expect(source).toContain("currentCommit !== frozenCommit");
    expect(source).toContain("finalCommit !== frozenCommit");
    expect(source).toContain("--config.extraMetadata.buildCommit=${frozenCommit}");
    expect(source).toContain('requestedReleaseMode || "developer-id"');
    expect(source).toContain('releaseMode !== "legacy-adhoc"');
    expect(source).toContain("--config.extraMetadata.releaseMode=${releaseMode}");
    expect(source).toContain('releaseMode === "legacy-adhoc"');
    expect(source).toContain('"--config.mac.identity=-"');
    expect(source).toContain('"--config.mac.hardenedRuntime=false"');
    expect(source).toContain('"--config.mac.notarize=false"');
    expect(source).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
    expect(source).toContain('targets.includes("zip")');
    expect(source).toContain('"finalize-mac-zip.mjs"');

    const finalizeZip = readFileSync(
      path.join(process.cwd(), "scripts", "finalize-mac-zip.mjs"),
      "utf8",
    );
    expect(finalizeZip).toContain('const dittoBin = "/usr/bin/ditto"');
    expect(finalizeZip).toContain('"--keepParent"');
    expect(finalizeZip).toContain("await buildBlockMap(");
    expect(finalizeZip).toContain('metadata.path = zipEntry.url');
    expect(finalizeZip).toContain('metadata.sha512 = blockmap.sha512');

    const afterSign = readFileSync(
      path.join(process.cwd(), "scripts", "after-sign-mac.mjs"),
      "utf8",
    );
    expect(afterSign).toContain('legacyReleaseMode = "legacy-adhoc"');
    expect(afterSign).toContain(
      'identifier "local.zerox.agent.desktop"',
    );
    expect(afterSign).toContain('"--preserve-metadata=identifier,entitlements,flags,runtime"');
    expect(afterSign).toContain('["--verify", "--deep", "--strict", "--verbose=2", appPath]');

    const builderConfig = readFileSync(
      path.join(process.cwd(), "electron-builder.yml"),
      "utf8",
    );
    expect(builderConfig).toContain("afterSign: ./scripts/after-sign-mac.mjs");
    expect(builderConfig).toContain("from: build/update-signing-public-key.pem");

    const signScript = readFileSync(
      path.join(process.cwd(), "scripts", "sign-update-manifest.mjs"),
      "utf8",
    );
    expect(signScript).toContain("ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE");
    expect(signScript).toContain("inline update signing keys are forbidden");
    expect(signScript).toContain("outside the repository");
    expect(signScript).toContain("0600 or stricter");
    expect(signScript).toContain("ZEROX_AGENT_UPDATE_MANIFEST\\0V2");
    expect(signScript).toContain("sequence");
    expect(signScript).toContain("expiresAt");
    expect(signScript).toContain('algorithm: "ed25519"');
    expect(signScript).toContain("generated update manifest signature could not be verified");

    const publishScript = readFileSync(
      path.join(process.cwd(), "scripts", "publish-github-release.mjs"),
      "utf8",
    );
    expect(publishScript).toContain("runReleasePreflight");
    expect(publishScript).toContain('"--verify-tag"');
    expect(publishScript).toContain("repos/ZeroxZhang/zerox-agent/git/ref/tags/");
    expect(publishScript).toContain("repos/ZeroxZhang/zerox-agent/git/tags/");
    expect(publishScript).toContain("remote tag must resolve to the exact release HEAD");
    expect(publishScript).toContain('key.startsWith("GIT_")');
    expect(publishScript).toContain('createHash("sha256")');
    expect(publishScript).toContain("asset.digest");
    expect(publishScript).toContain("inspectReleaseArtifacts(stagingRoot)");
    expect(publishScript).toContain("zerox-release-publish-");
    expect(publishScript).toContain('"--draft"');
    expect(publishScript).toContain('"--draft=false"');
    expect(publishScript).toContain('"delete"');
    expect(publishScript).toContain("exactly six distinct assets");
    expect(publishScript).toContain("failed the six-asset verification");

    const mainSource = readFileSync(
      path.join(process.cwd(), "src", "main", "main.ts"),
      "utf8",
    );
    expect(mainSource).toContain("app.requestSingleInstanceLock()");
  });

  it("sets release metadata to v3.8.2", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLock = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as { version?: string; packages?: Record<string, { version?: string }> };
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

    expect(packageJson.version).toBe("3.8.2");
    expect(packageJson.scripts?.["smoke:providers"]).toContain(
      "smoke-multi-provider.mjs",
    );
    expect(packageJson.scripts?.["stress:runtime"]).toBe(
      "ZEROX_RUNTIME_STRESS=1 vitest run --run src/main/runtimeStress.test.ts --maxWorkers=1",
    );
    // package-lock.json is updated by `npm install`; check it matches the
    // declared package version once dependencies are installed.
    expect(packageLock.version).toBe("3.8.2");
    expect(packageLock.packages?.[""]?.version).toBe("3.8.2");
    expect(readme).toContain("current release: v3.8.2");
    expect(readme).toContain("当前版本是 **v3.8.2**");
  });

  it("publishes an exact-tag arm64 compatibility release from GitHub Actions", () => {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8",
    );
    const releaseNotes = readFileSync(
      path.join(
        process.cwd(),
        ".github",
        "release-notes",
        "v3.8.2.md",
      ),
      "utf8",
    );

    expect(workflow).toContain('tags:\n      - "v*.*.*"');
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain('test "$(uname -m)" = "arm64"');
    expect(workflow).toContain("secrets.ZEROX_UPDATE_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("ZEROX_RELEASE_MODE: legacy-adhoc");
    expect(workflow).toContain("npm test -- --maxWorkers=1");
    expect(workflow).toContain("npm run stress:runtime");
    expect(workflow).toContain("npm run eval:agent:built");
    expect(workflow).toContain("npm run eval:memory:built");
    expect(workflow).toContain("npm run release:mac");
    expect(workflow).toContain("npm run release:publish");
    expect(releaseNotes).toContain("# Zerox Agent v3.8.2");
    expect(releaseNotes).toContain("Zerox-Agent-3.8.2-arm64.dmg");
    expect(releaseNotes).toContain("xattr -dr com.apple.quarantine");
  });

  it("keeps release gates tracked through v3.8.2", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{
        id: string;
        status: string;
        definitionOfDone?: string[];
      }>;
    };
    const runtimeProgram = JSON.parse(
      readFileSync(
        path.join(
          process.cwd(),
          ".zerox/runtime-convergence-program.json",
        ),
        "utf8",
      ),
    ) as {
      activeFeatureId: string | null;
      maxActiveFeatures: number;
      workstreams: Array<{ featureId: string }>;
    };
    const convergenceFeatureIds = new Set(
      runtimeProgram.workstreams.map((workstream) => workstream.featureId),
    );
    const kernelMigrationProgram = JSON.parse(
      readFileSync(
        path.join(
          process.cwd(),
          ".zerox/kernel-migration-program.json",
        ),
        "utf8",
      ),
    ) as {
      activeFeatureId: string | null;
      maxActiveFeatures: number;
      workstreams: Array<{ featureId: string }>;
    };
    const kernelMigrationFeatureIds = new Set(
      kernelMigrationProgram.workstreams.map(
        (workstream) => workstream.featureId,
      ),
    );

    const openFeatureIds = featureList.features
      .filter((feature) => feature.status !== "done")
      .map((feature) => feature.id);
    const p32 = featureList.features.find(
      (feature) => feature.id === "P32-v3.2.0-goal-mode-memory-ingestion-settings-glass",
    );
    const p33 = featureList.features.find(
      (feature) => feature.id === "P33-v3.2.1-ui-ux-design-system-settings-ia",
    );
    const p34 = featureList.features.find(
      (feature) => feature.id === "P34-v3.2.2-soft-blue-visual-system",
    );
    const p35 = featureList.features.find(
      (feature) => feature.id === "P35-v3.2.3-home-style-release",
    );
    const p36 = featureList.features.find(
      (feature) => feature.id === "P36-v3.3.0-macos-ui-release-polish",
    );
    const p37 = featureList.features.find(
      (feature) => feature.id === "P37-v3.4.0-obsidian-frontend-interaction",
    );
    const p38 = featureList.features.find(
      (feature) => feature.id === "P38-v3.4.0-goal-mode-obsidian-regression-fixes",
    );
    const p39 = featureList.features.find(
      (feature) => feature.id === "P39-v3.4.0-goal-mode-runtime-state-repair",
    );
    const p40 = featureList.features.find(
      (feature) =>
        feature.id === "P40-v3.4.0-goal-mode-bounded-termination",
    );
    const p41 = featureList.features.find(
      (feature) =>
        feature.id === "P41-v3.4.0-goal-acceptance-policy-engine",
    );
    const p43 = featureList.features.find(
      (feature) => feature.id === "P43-goal-acceptance-recovery",
    );
    const p44 = featureList.features.find(
      (feature) => feature.id === "P44-v3.7.0-audit-hardening-release",
    );
    const p45 = featureList.features.find(
      (feature) =>
        feature.id === "P45-v3.7.0-audit-closure-runtime-convergence",
    );
    const p46 = featureList.features.find(
      (feature) => feature.id === "P46-v3.7.0-strict-review-fixes",
    );
    const p47 = featureList.features.find(
      (feature) => feature.id === "P47-project-introduction-site",
    );
    const p48 = featureList.features.find(
      (feature) => feature.id === "P48-v3.7.1-auto-update-and-chat-attachments",
    );
    const p49 = featureList.features.find(
      (feature) =>
        feature.id === "P49-v3.8.0-multi-provider-plan-debate",
    );
    const p50 = featureList.features.find(
      (feature) =>
        feature.id === "P50-v3.8.0-plan-mode-ui-and-structured-output-fixes",
    );
    const p51 = featureList.features.find(
      (feature) =>
        feature.id === "P51-v3.8.0-goal-runtime-false-block-recovery",
    );
    const p52 = featureList.features.find(
      (feature) =>
        feature.id === "P52-v3.8.0-plan-c-structured-output-recovery",
    );
    const p53 = featureList.features.find(
      (feature) =>
        feature.id ===
        "P53-v3.8.0-plan-input-routing-and-agent-terminal-state",
    );
    const p54 = featureList.features.find(
      (feature) =>
        feature.id === "P54-v3.8.0-plan-trust-boundary-hardening",
    );
    const p55 = featureList.features.find(
      (feature) =>
        feature.id === "P55-v3.8.1-model-provider-and-conversation-ux",
    );
    const p56 = featureList.features.find(
      (feature) =>
        feature.id ===
        "P56-v3.8.1-thinking-control-and-empty-response-hotfix",
    );
    const p31 = featureList.features.find(
      (feature) => feature.id === "P31-v3.1.2-window-controls-and-settings-icon",
    );
    const p30 = featureList.features.find(
      (feature) => feature.id === "P30-v3.1.1-composer-multiline-hotfix",
    );
    const p29 = featureList.features.find(
      (feature) => feature.id === "P29-v3.1.0-goal-acceptance-subagent-runtime",
    );
    const p28 = featureList.features.find(
      (feature) => feature.id === "P28-v3.0.0-execution-context-spine",
    );

    expect(packageJson.version).toBe("3.8.2");
    expect(openFeatureIds.length).toBeLessThanOrEqual(
      Math.min(
        runtimeProgram.maxActiveFeatures,
        kernelMigrationProgram.maxActiveFeatures,
      ),
    );
    const activeProgramFeatureIds = [
      runtimeProgram.activeFeatureId,
      kernelMigrationProgram.activeFeatureId,
    ].filter((featureId): featureId is string => Boolean(featureId));
    expect(
      openFeatureIds.filter(
        (featureId) =>
          convergenceFeatureIds.has(featureId) ||
          kernelMigrationFeatureIds.has(featureId),
      ),
    ).toEqual(
      activeProgramFeatureIds,
    );
    expect(p56?.status === "in_progress" || p56?.status === "done").toBe(true);
    expect(p56).toEqual(
      expect.objectContaining({
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("DeepSeek"),
          expect.stringContaining("reasoning-only"),
          expect.stringContaining("provider"),
        ]),
      }),
    );
    expect(p55?.status === "in_progress" || p55?.status === "done").toBe(true);
    expect(p55).toEqual(
      expect.objectContaining({
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("verified"),
          expect.stringContaining("Alibaba Model Studio Coding Plan"),
          expect.stringContaining("custom OpenAI-compatible"),
          expect.stringContaining("decision cards"),
        ]),
      }),
    );
    expect(p54?.status === "in_progress" || p54?.status === "done").toBe(true);
    expect(p54).toEqual(
      expect.objectContaining({
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("selected Skill"),
          expect.stringContaining("strictly validated"),
          expect.stringContaining("dependency cycles"),
          expect.stringContaining("durable session index"),
        ]),
      }),
    );
    expect(p53?.status === "in_progress" || p53?.status === "done").toBe(true);
    expect(p52?.status === "in_progress" || p52?.status === "done").toBe(true);
    expect(p51?.status === "in_progress" || p51?.status === "done").toBe(true);
    expect(p50?.status === "in_progress" || p50?.status === "done").toBe(true);
    expect(p49?.status === "in_progress" || p49?.status === "done").toBe(true);
    expect(p49).toEqual(
      expect.objectContaining({
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("descriptor-driven multi-provider"),
          expect.stringContaining("A1, B1, A2, B2, and C"),
          expect.stringContaining("Plan runs are read-only"),
        ]),
      }),
    );
    expect(p47?.status === "in_progress" || p47?.status === "done").toBe(true);
    expect(p48?.status === "in_progress" || p48?.status === "done").toBe(true);
    expect(p45?.status === "in_progress" || p45?.status === "done").toBe(true);
    expect(p46?.status === "in_progress" || p46?.status === "done").toBe(true);
    expect(p44?.status === "in_progress" || p44?.status === "done").toBe(true);
    expect(p44).toEqual(
      expect.objectContaining({
        id: "P44-v3.7.0-audit-hardening-release",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("fails closed"),
          expect.stringContaining("newline-separated commands"),
          expect.stringContaining("canonical skill root"),
          expect.stringContaining("latest durable checkpoint"),
          expect.stringContaining("serialized atomic persistence"),
          expect.stringContaining("consistently identify v3.7.0"),
        ]),
      }),
    );
    expect(p43?.status === "in_progress" || p43?.status === "done").toBe(true);
    expect(p43).toEqual(
      expect.objectContaining({
        id: "P43-goal-acceptance-recovery",
        files: [
          ".superpowers/sdd/task-4-report.md",
          ".superpowers/sdd/task-5-report.md",
          ".superpowers/sdd/task-6-report.md",
          ".superpowers/sdd/task-7-review-fixes-acceptance.md",
          ".superpowers/sdd/task-7-review-fixes-persistence-ui.md",
          ".superpowers/sdd/task-7-review-fixes-controller.md",
          ".zerox/feature_list.json",
          ".zerox/progress.md",
          "src/main/agentGoalAcceptance.test.ts",
          "src/main/agentGoalAcceptance.ts",
          "src/main/agentGoalAcceptanceCertificate.test.ts",
          "src/main/agentGoalAcceptanceCertificate.ts",
          "src/main/agentGoalAcceptanceRetryPolicy.test.ts",
          "src/main/agentGoalAcceptanceRetryPolicy.ts",
          "src/main/agentGoalController.test.ts",
          "src/main/agentGoalController.ts",
          "src/main/agentGoalEvidenceManifest.ts",
          "src/main/agentGoalFailureFingerprint.test.ts",
          "src/main/agentGoalFailureFingerprint.ts",
          "src/main/agentGoalRepairPolicy.test.ts",
          "src/main/agentGoalRepairPolicy.ts",
          "src/main/agentGoalStore.test.ts",
          "src/main/agentGoalStore.ts",
          "src/main/agentTrajectoryStore.test.ts",
          "src/main/agentTrajectoryStore.ts",
          "src/main/container.test.ts",
          "src/main/container.ts",
          "src/main/goalChatService.test.ts",
          "src/main/goalChatService.ts",
          "src/main/ipc/index.test.ts",
          "src/main/ipc/index.ts",
          "src/main/providers/anthropicProvider.ts",
          "src/main/providers/geminiProvider.ts",
          "src/main/providers/providerHttpError.ts",
          "src/main/providers/providers.test.ts",
          "src/main/storage/migrateRoundTrip.test.ts",
          "src/main/storage/repositories/goalRepository.ts",
          "src/main/storage/repositories/repositories.test.ts",
          "src/main/storage/repositories/runRepository.ts",
          "src/preload/index.test.ts",
          "src/preload/index.ts",
          "src/renderer/App.tsx",
          "src/renderer/chatTaskActivity.test.ts",
          "src/renderer/chatTaskActivity.ts",
          "src/renderer/components/AgentChatPanel.tsx",
          "src/renderer/components/GoalDetailDrawer.tsx",
          "src/renderer/components/GoalStatusStrip.tsx",
          "src/renderer/goalAcceptanceInteraction.test.ts",
          "src/renderer/goalAcceptanceInteraction.ts",
          "src/renderer/goalProgressViewModel.test.ts",
          "src/renderer/goalProgressViewModel.ts",
          "src/renderer/materialDesign.test.ts",
          "src/renderer/styles/chat.css",
          "src/shared/agentArtifactProvenance.test.ts",
          "src/shared/agentArtifactProvenance.ts",
          "src/shared/agentGoal.test.ts",
          "src/shared/agentGoal.ts",
          "src/shared/agentTrajectory.ts",
          "src/shared/chat.ts",
          "src/shared/packageScripts.test.ts",
          "src/shared/storageContract.ts",
          "src/shared/trustedFileSnapshot.ts",
        ],
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining(
            "Transient final-judge failures retry visibly without rerunning accepted task work",
          ),
          expect.stringContaining(
            "Exhausted retries preserve a durable waiting_for_acceptance state",
          ),
          expect.stringContaining(
            "Users can continue final acceptance from persisted evidence",
          ),
          expect.stringContaining(
            "Manual completion is terminal, audited, unverified, and never certificate-backed",
          ),
          expect.stringContaining(
            "Restart, cancellation, stale writes, renderer copy, and historical goals remain safe",
          ),
        ]),
      }),
    );
    expect(p41?.status === "in_progress" || p41?.status === "done").toBe(true);
    expect(p41).toEqual(
      expect.objectContaining({
        id: "P41-v3.4.0-goal-acceptance-policy-engine",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Historical Goal JSON remains readable"),
          expect.stringContaining("stable failure fingerprint"),
          expect.stringContaining("durable acceptance certificate"),
        ]),
      }),
    );
    expect(p40?.status === "in_progress" || p40?.status === "done").toBe(true);
    expect(p40).toEqual(
      expect.objectContaining({
        id: "P40-v3.4.0-goal-mode-bounded-termination",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("artifact evidence references resolve"),
          expect.stringContaining("budgets are enforced"),
          expect.stringContaining("cannot be overwritten by stale background work"),
        ]),
      }),
    );
    expect(p39?.status === "in_progress" || p39?.status === "done").toBe(true);
    expect(p39).toEqual(
      expect.objectContaining({
        id: "P39-v3.4.0-goal-mode-runtime-state-repair",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Goal drafts preserve the selected workspace"),
          expect.stringContaining("Aborted stale runs cannot overwrite"),
          expect.stringContaining("Goal review actions use clear Continue"),
        ]),
      }),
    );
    expect(p38?.status === "in_progress" || p38?.status === "done").toBe(true);
    expect(p38).toEqual(
      expect.objectContaining({
        id: "P38-v3.4.0-goal-mode-obsidian-regression-fixes",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Goal draft confirmation UI uses Obsidian"),
          expect.stringContaining("Goal Status pause button calls the pauseGoal IPC flow"),
          expect.stringContaining("Goal milestone instructions reduce avoidable Tool failed loops"),
        ]),
      }),
    );
    expect(p37?.status === "in_progress" || p37?.status === "done").toBe(true);
    expect(p37).toEqual(
      expect.objectContaining({
        id: "P37-v3.4.0-obsidian-frontend-interaction",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("0708 design guideline"),
          expect.stringContaining("B · 曜石 Obsidian"),
          expect.stringContaining("Renderer visual tokens implement the Obsidian"),
          expect.stringContaining("package metadata reports version 3.4.0"),
          expect.stringContaining("README current release and download example reflect v3.4.0"),
        ]),
      }),
    );
    expect(p36).toEqual(
      expect.objectContaining({
        id: "P36-v3.3.0-macos-ui-release-polish",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("UI_AUDIT.md records the macOS HIG audit"),
          expect.stringContaining("4 P0 safety and modal-contract findings are completed"),
          expect.stringContaining("independent adversarial UI acceptance PASS"),
          expect.stringContaining("package metadata reports version 3.3.0"),
          expect.stringContaining("GitHub Release v3.3.0"),
        ]),
      }),
    );
    expect(p35?.status === "in_progress" || p35?.status === "done").toBe(true);
    expect(p35).toEqual(
      expect.objectContaining({
        id: "P35-v3.2.3-home-style-release",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("root app background uses F8FBFD"),
          expect.stringContaining("home prompt reads 让Zerox-Agent帮你做什么？"),
          expect.stringContaining("package metadata reports version 3.2.3"),
          expect.stringContaining("GitHub Release v3.2.3"),
        ]),
      }),
    );
    expect(p34?.status).toBe("done");
    expect(p34?.status === "in_progress" || p34?.status === "done").toBe(true);
    expect(p34).toEqual(
      expect.objectContaining({
        id: "P34-v3.2.2-soft-blue-visual-system",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Soft Blue Desktop Control Surface"),
          expect.stringContaining("Renderer visual tokens implement"),
          expect.stringContaining("Figma-inspired light blue/white system"),
          expect.stringContaining("raw visual magic values outside tokens"),
          expect.stringContaining("Independent Principal Design Architect adversarial review"),
          expect.stringContaining("package metadata reports version 3.2.2"),
        ]),
      }),
    );
    expect(p33?.status).toBe("done");
    expect(p33).toEqual(
      expect.objectContaining({
        id: "P33-v3.2.1-ui-ux-design-system-settings-ia",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Product designer, interaction designer, and UX designer"),
          expect.stringContaining("comprehensive UI/UX design-system file"),
          expect.stringContaining("Settings information architecture is reordered"),
          expect.stringContaining("Design director and UX expert review"),
          expect.stringContaining("package metadata reports version 3.2.1"),
        ]),
      }),
    );
    expect(p32?.status).toBe("done");
    expect(p32).toEqual(
      expect.objectContaining({
        id: "P32-v3.2.0-goal-mode-memory-ingestion-settings-glass",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Composer shows the four bottom controls"),
          expect.stringContaining("Goal Mode and legacy /目标 create a typed GoalDraft"),
          expect.stringContaining("Memory records support manual_required"),
          expect.stringContaining("Memory ingestion scans recent reviewed local history"),
          expect.stringContaining("Visual tokens cool the app away from beige/yellow"),
          expect.stringContaining("package metadata reports version 3.2.0"),
        ]),
      }),
    );
    expect(p31?.status).toBe("done");
    expect(p31).toEqual(
      expect.objectContaining({
        id: "P31-v3.1.2-window-controls-and-settings-icon",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("sidebar reserves a sticky macOS window-control safe area"),
          expect.stringContaining("Settings primary navigation gear renders from a bounded SVG path"),
          expect.stringContaining("package metadata reports version 3.1.2"),
          expect.stringContaining("local test package is opened for user acceptance before the release build"),
        ]),
      }),
    );
    expect(p30?.status).toBe("done");
    expect(p30).toEqual(
      expect.objectContaining({
        id: "P30-v3.1.1-composer-multiline-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Chat composer inserts line breaks with Shift+Enter and Option+Enter"),
          expect.stringContaining("authored newlines are preserved"),
          expect.stringContaining("package metadata reports version 3.1.1"),
          expect.stringContaining("macOS DMG, ZIP, blockmaps, and latest-mac.yml artifacts are regenerated for v3.1.1"),
        ]),
      }),
    );
    expect(p29?.status).toBe("done");
    expect(p29).toEqual(
      expect.objectContaining({
        id: "P29-v3.1.0-goal-acceptance-subagent-runtime",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Slash Goal commands with selected skills persist"),
          expect.stringContaining("right-side context rail shows decomposed task progress"),
          expect.stringContaining("actor tool launches real subagent work with parent run context"),
          expect.stringContaining("Independent adversarial review subagent"),
          expect.stringContaining("package metadata reports version 3.1.0"),
          expect.stringContaining("GitHub Release v3.1.0"),
        ]),
      }),
    );
    expect(p28?.status === "in_progress" || p28?.status === "done").toBe(true);
    expect(p28).toEqual(
      expect.objectContaining({
        id: "P28-v3.0.0-execution-context-spine",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("AgentRuntimeContextSnapshot"),
          expect.stringContaining("Chat agent-loop runs append"),
          expect.stringContaining("Goal milestone runs append"),
          expect.stringContaining("Recoverable scheduled task runs append"),
          expect.stringContaining("package metadata reports version 3.0.0"),
          expect.stringContaining("GitHub Release v3.0.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P27-v2.9.5-scheduled-task-session-recovery-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.5"),
          expect.stringContaining("GitHub Release v2.9.5"),
          expect.stringContaining("Saved scheduled tasks can be edited"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P26-v2.9.4-scheduled-task-automation-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.4"),
          expect.stringContaining("GitHub Release v2.9.4"),
          expect.stringContaining("Scheduled task creation supports prompt-only automation"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P25-v2.9.3-goal-performance-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.3"),
          expect.stringContaining("GitHub Release v2.9.3"),
          expect.stringContaining("Production performance smoke expands archived sessions"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P23-v2.9.0-output-rendering",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("approved Evidence-Linked Answer plus Run Ledger"),
          expect.stringContaining("typed shared output parts cover text, tables, code blocks"),
          expect.stringContaining("restored sessions render rich output structure"),
          expect.stringContaining("package metadata reports version 2.9.2"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P22-v2.8.5-reasoning-finalization-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("non-empty reasoningContent"),
          expect.stringContaining("persisted into the assistant message history"),
          expect.stringContaining("package metadata reports version 2.8.5"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P21-v2.8.4-empty-response-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("agent loop remembers the latest tool failure"),
          expect.stringContaining("empty model follow-up responses"),
          expect.stringContaining("package metadata reports version 2.8.4"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P20-v2.8.3-time-semantics-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("protected local date context"),
          expect.stringContaining("web_search tool descriptions require date-sensitive queries"),
          expect.stringContaining("package metadata reports version 2.8.3"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P19-v2.8.2-chat-rename-message-skill-polish",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("session more menu exposes rename"),
          expect.stringContaining("explicitly selected skills are preloaded"),
          expect.stringContaining("package metadata reports version 2.8.2"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P18-v2.8.1-runtime-surface-polish-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.8.1"),
          expect.stringContaining("real-time thinking and tool preview"),
          expect.stringContaining("@skill capsule remains in the lower composer"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P17-v2.8.0-runtime-orchestration-memory",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("ExecutionContextPackage"),
          expect.stringContaining("skill_load"),
          expect.stringContaining("tool invocation ledger"),
          expect.stringContaining("raw history"),
          expect.stringContaining("computer-use black-box acceptance"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P16-v2.7.0-ui-interaction",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Chat supports first-class streamed answer output"),
          expect.stringContaining("Focused tests, full verification, production smoke, packaged smoke, black-box QA, and independent acceptance pass"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P15-hardening-release-2.6.0",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("sandbox escape paths hardened"),
          expect.stringContaining("package version bumped to 2.6.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P14-workspace-skill-execution-2.5.0",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("first-class workspace selection"),
          expect.stringContaining("package version bumped to 2.5.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P12.1-session-history-management-2.4.1",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("archive/delete session actions"),
          expect.stringContaining("package version bumped to 2.4.1"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P12-2.4.0-iteration-activation-and-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("iteration-roadmap P1-P8 activated"),
          expect.stringContaining("package version bumped to 2.4.0"),
        ]),
      }),
    );
    expect(featureList.features).not.toContainEqual(
      expect.objectContaining({
        id: "P12-2.4.0-iteration-activation-and-release",
        status: "in_progress",
      }),
    );
    // Prior release gate stays done (no regression).
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P11.7-v2.3.6-release-metadata-and-distribution",
        status: "done",
      }),
    );
  });

  it("exposes a production start command for the built Electron app", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      start: "electron .",
      "start:prod": "npm run build && electron .",
    });
  });

  it("exposes a single verification command before local use", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      verify:
        "npm test && npm run build && node scripts/run-agent-evals.mjs && node scripts/run-memory-evals.mjs",
      doctor: "npm run verify",
      "smoke:llm": "npm run build && node scripts/check-api-info.mjs",
      "smoke:prod": "npm run build && BUILDING_AGENT_SMOKE=1 electron .",
      "validate:agent":
        "npm run build && BUILDING_AGENT_VALIDATE=1 electron .",
    });
  });

  it("exposes deterministic memory evals", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "eval:memory": "npm run build && node scripts/run-memory-evals.mjs",
    });
  });

  it("exposes built-artifact variants for post-build verification workflows", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "eval:agent": "npm run build && node scripts/run-agent-evals.mjs",
      "eval:agent:built": "node scripts/run-agent-evals.mjs",
      "eval:memory": "npm run build && node scripts/run-memory-evals.mjs",
      "eval:memory:built": "node scripts/run-memory-evals.mjs",
      "harness:score": "npm run build && node scripts/run-harness-score.mjs",
      "harness:score:built": "node scripts/run-harness-score.mjs",
      "episode:export":
        "npm run build && node scripts/export-agent-episode.mjs",
      "episode:export:built": "node scripts/export-agent-episode.mjs",
      "smoke:prod": "npm run build && BUILDING_AGENT_SMOKE=1 electron .",
      "smoke:prod:built": "BUILDING_AGENT_SMOKE=1 electron .",
    });
  });

  it("exposes macOS packaging commands for local app distribution", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "pack:mac": "node scripts/package-mac.mjs --dir",
      "dist:mac": "node scripts/package-mac.mjs dmg zip",
      "release:sign": "node scripts/sign-update-manifest.mjs",
      "release:preflight": "node scripts/release-preflight.mjs",
      "release:mac":
        "npm run dist:mac && npm run release:sign && npm run release:preflight",
      "release:publish": "node scripts/publish-github-release.mjs",
    });
  });

  it("exposes harness engineering commands", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "harness:check": "node scripts/check-harness-state.mjs",
      "program:check":
        "node scripts/check-runtime-convergence-program.mjs && node scripts/check-kernel-migration-program.mjs",
      "harness:score": "npm run build && node scripts/run-harness-score.mjs",
      "episode:export":
        "npm run build && node scripts/export-agent-episode.mjs",
    });
  });
});
