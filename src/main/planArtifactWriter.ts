import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  PlanArtifact,
  PlanProjection,
  PlanRecord,
} from "../shared/planMode";
import { sanitizePlanRecordDiagnostics } from "../shared/planDiagnostics";
import {
  runSafeFsHelper,
  type SafeFsHelperRuntimeOptions,
} from "./localFileOrganizer";

export type PlanArtifactWriter = {
  write(plan: PlanRecord, artifact: PlanArtifact): Promise<PlanProjection>;
  writePrepared(
    plan: PlanRecord,
    projection: PreparedPlanProjection,
  ): Promise<PlanProjection>;
  verify(plan: PlanRecord): Promise<boolean>;
};

export type PreparedPlanProjection = {
  kind: "artifact" | "tombstone";
  renderVersion: 1;
  path: string;
  sha256: string;
  body: string;
};

export function createPlanArtifactWriter(options?: SafeFsHelperRuntimeOptions & {
  now?: () => string;
}): PlanArtifactWriter {
  const now = options?.now ?? (() => new Date().toISOString());

  return {
    async write(plan, artifact) {
      const prepared = await preparePlanProjection(plan, artifact);
      return publishPreparedProjection(
        prepared.safeInput.plan,
        prepared.root,
        prepared.projection,
        now,
        options ?? {},
      );
    },

    async writePrepared(plan, projection) {
      const sanitized = sanitizePlanRecordDiagnostics(plan);
      if (!sanitized.workspaceRoot) {
        throw new Error("计划没有绑定工作区，无法恢复 Markdown 投影。");
      }
      assertPreparedProjection(projection);
      const root = await realpath(sanitized.workspaceRoot);
      if (projection.path !== canonicalProjectionPath(root, sanitized.id)) {
        throw new Error("持久化投影 intent 不是当前计划的规范路径。");
      }
      if (hash(projection.body) !== projection.sha256) {
        throw new Error("持久化投影 intent 正文与摘要不一致。");
      }
      return publishPreparedProjection(
        sanitized,
        root,
        projection,
        now,
        options ?? {},
      );
    },

    async verify(plan) {
      if (!plan.projection || !plan.workspaceRoot || !plan.finalArtifact) {
        return false;
      }
      try {
        const safeInput = sanitizeArtifactProjection(plan, plan.finalArtifact);
        const root = await realpath(safeInput.plan.workspaceRoot!);
        if (
          safeInput.plan.projection!.path
          !== canonicalProjectionPath(root, safeInput.plan.id)
        ) {
          return false;
        }
        const currentProjection = renderPlanMarkdown(
          safeInput.plan.confirmedRevision
            ? {
                ...safeInput.plan,
                revision: safeInput.plan.confirmedRevision,
              }
            : safeInput.plan,
          safeInput.artifact,
        );
        if (hash(currentProjection) !== safeInput.plan.projection!.sha256) {
          return false;
        }
        await runSafeFsHelper(
          "projection-verify",
          await projectionHelperArgs(
            root,
            safeInput.plan.id,
            safeInput.plan.projection!.sha256,
          ),
          undefined,
          options ?? {},
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function publishPreparedProjection(
  plan: PlanRecord,
  root: string,
  projection: PreparedPlanProjection,
  now: () => string,
  options: SafeFsHelperRuntimeOptions,
): Promise<PlanProjection> {
  await runSafeFsHelper(
    "projection-write",
    await projectionHelperArgs(
      root,
      plan.id,
      plan.projection?.sha256,
      projection.sha256,
    ),
    projection.body,
    options,
  );
  return {
    path: projection.path,
    sha256: projection.sha256,
    writtenAt: now(),
  };
}

export async function rewriteSanitizedPlanProjection(
  plan: PlanRecord,
  now = () => new Date().toISOString(),
): Promise<PlanRecord> {
  const sanitized = sanitizePlanRecordDiagnostics(plan);
  const { projection: _projection, ...detached } = sanitized;
  if (!sanitized.projection || !sanitized.workspaceRoot) {
    return detached;
  }
  assertArtifactPlanId(sanitized.id);
  const root = await realpath(sanitized.workspaceRoot);
  const destination = canonicalProjectionPath(root, sanitized.id);
  if (sanitized.projection.path !== destination) {
    throw new Error("计划投影路径不是当前计划的规范路径。");
  }
  const markdown = sanitized.finalArtifact
    ? renderPlanMarkdown(sanitized, sanitized.finalArtifact)
    : tombstoneProjectionMarkdown();
  const sha256 = hash(markdown);
  await runSafeFsHelper(
    "projection-write",
    await projectionHelperArgs(
      root,
      sanitized.id,
      sanitized.projection.sha256,
      sha256,
    ),
    markdown,
    {},
  );
  return {
    ...sanitized,
    projection: {
      path: destination,
      sha256,
      writtenAt:
        sanitized.projection.sha256 === sha256
          ? sanitized.projection.writtenAt
          : now(),
    },
  };
}

export async function describePlanProjection(
  plan: PlanRecord,
  artifact: PlanArtifact,
): Promise<PreparedPlanProjection> {
  return (await preparePlanProjection(plan, artifact)).projection;
}

export async function describePlanTombstoneProjection(
  plan: PlanRecord,
): Promise<PreparedPlanProjection> {
  const sanitized = sanitizePlanRecordDiagnostics(plan);
  if (!sanitized.workspaceRoot) {
    throw new Error("计划没有绑定工作区，无法生成 Markdown 投影。");
  }
  assertArtifactPlanId(sanitized.id);
  const root = await realpath(sanitized.workspaceRoot);
  const destination = canonicalProjectionPath(root, sanitized.id);
  if (sanitized.projection?.path !== destination) {
    throw new Error("计划投影路径不是当前计划的规范路径。");
  }
  return {
    kind: "tombstone",
    renderVersion: 1,
    path: destination,
    sha256: hash(tombstoneProjectionMarkdown()),
    body: tombstoneProjectionMarkdown(),
  };
}

/**
 * Builds a migration intent without touching the workspace. The persisted
 * legacy projection path remains only expected-old authority; writePrepared
 * must still prove that it is the current canonical workspace path before it
 * can publish these exact sanitized bytes.
 */
export function describeStoredPlanProjection(
  plan: PlanRecord,
): PreparedPlanProjection {
  const sanitized = sanitizePlanRecordDiagnostics(plan);
  if (!sanitized.projection) {
    throw new Error("计划没有可迁移的旧投影权威。");
  }
  const body = sanitized.finalArtifact
    ? renderPlanMarkdown(sanitized, sanitized.finalArtifact)
    : tombstoneProjectionMarkdown();
  return {
    kind: sanitized.finalArtifact ? "artifact" : "tombstone",
    renderVersion: 1,
    path: sanitized.projection.path,
    sha256: hash(body),
    body,
  };
}

async function preparePlanProjection(
  plan: PlanRecord,
  artifact: PlanArtifact,
): Promise<{
  safeInput: { plan: PlanRecord; artifact: PlanArtifact };
  root: string;
  projection: PreparedPlanProjection;
}> {
  const safeInput = sanitizeArtifactProjection(plan, artifact);
  if (!safeInput.plan.workspaceRoot) {
    throw new Error("计划没有绑定工作区，无法生成 Markdown 投影。");
  }
  assertArtifactPlanId(safeInput.plan.id);
  const root = await realpath(safeInput.plan.workspaceRoot);
  const destination = canonicalProjectionPath(root, safeInput.plan.id);
  if (
    safeInput.plan.projection
    && safeInput.plan.projection.path !== destination
  ) {
    throw new Error("计划投影路径不是当前计划的规范路径。");
  }
  const markdown = renderPlanMarkdown(safeInput.plan, safeInput.artifact);
  return {
    safeInput,
    root,
    projection: {
      kind: "artifact",
      renderVersion: 1,
      path: destination,
      sha256: hash(markdown),
      body: markdown,
    },
  };
}

function assertPreparedProjection(
  projection: PreparedPlanProjection,
): void {
  if (
    (projection.kind !== "artifact" && projection.kind !== "tombstone")
    || projection.renderVersion !== 1
    || typeof projection.path !== "string"
    || !path.isAbsolute(projection.path)
    || !/^[a-f0-9]{64}$/.test(projection.sha256)
    || typeof projection.body !== "string"
  ) {
    throw new Error("持久化投影 intent 结构非法。");
  }
}

function sanitizeArtifactProjection(
  plan: PlanRecord,
  artifact: PlanArtifact,
): { plan: PlanRecord; artifact: PlanArtifact } {
  const sanitized = sanitizePlanRecordDiagnostics({
    ...plan,
    finalArtifact: artifact,
  });
  if (!sanitized.finalArtifact) {
    throw new Error("计划投影缺少可公开的结构化终版。");
  }
  return { plan: sanitized, artifact: sanitized.finalArtifact };
}

function tombstoneProjectionMarkdown(): string {
  return "# Plan projection unavailable\n\nLegacy diagnostic projection removed.\n";
}

function assertArtifactPlanId(planId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(planId)) {
    throw new Error("计划 ID 非法。");
  }
}

export function renderPlanMarkdown(
  plan: PlanRecord,
  artifact: PlanArtifact,
): string {
  const lines = [
    `# ${artifact.title}`,
    "",
    `> Plan ID: ${plan.id} · Revision: ${plan.revision} · Mode: ${plan.mode} · Schema: v${plan.schemaVersion ?? 1}`,
    ...(plan.taskProfile
      ? [
          `> Task Profile: ${plan.taskProfile.domain}/${plan.taskProfile.risk} · Investigation: ${plan.taskProfile.investigationDepth}`,
        ]
      : []),
    ...(plan.selectedSkill
      ? [
          `> Selected Skill: ${plan.selectedSkill.manifest.name} · Source: ${
            plan.skillDecision?.source ?? "legacy"
          } · Snapshot SHA-256: ${
            plan.skillDecision?.snapshotSha256 ??
            hash(JSON.stringify(plan.selectedSkill))
          }`,
        ]
      : []),
    "",
    artifact.summary,
    "",
    ...(plan.schemaVersion === 3 && plan.goalContractSnapshot
      ? [
          "## 目标契约",
          "",
          `- Goal revision：r${plan.goalContractSnapshot.revision}`,
          `- Plan version：v${plan.goalPlanVersion ?? 1}`,
          `- 规划协议：${plan.mode === "debate" ? "Debate" : "Direct"}`,
          `- 用途：${plan.purpose ?? "initial"}`,
          `- SHA-256：${plan.goalContractRef?.sha256 ?? "missing"}`,
          `- 目标：${plan.goalContractSnapshot.objective}`,
          `- 交付物：${plan.goalContractSnapshot.deliverables.join("；") || "无"}`,
          `- 成功标准：${plan.goalContractSnapshot.successCriteria
            .map((criterion) => `${criterion.id}=${criterion.description}`)
            .join("；")}`,
          "",
        ]
      : []),
    ...((plan.schemaVersion ?? 1) >= 2
      ? [
          "## 任务合同",
          "",
          `- 目标：${plan.taskContract.objective}`,
          `- 交付物：${(plan.taskContract.deliverables ?? []).join("；") || "无"}`,
          `- 目标引用：${(plan.taskContract.targetRefs ?? []).join("；") || "无"}`,
          `- 证据引用：${(plan.taskContract.evidenceRefs ?? []).join("；") || "无"}`,
          "",
          "## Skill 路由",
          "",
          `- 来源：${plan.skillDecision?.source ?? "none"}`,
          `- 选择：${plan.skillDecision?.selectedSkillName ?? "无"}`,
          `- 理由：${plan.skillDecision?.reason ?? "无"}`,
          `- 输入：${JSON.stringify(plan.skillDecision?.inputValues ?? {})}`,
          `- 输入证据：${JSON.stringify(
            plan.skillDecision?.inputEvidenceRefs ?? {},
          )}`,
          `- 权限：${JSON.stringify(plan.skillDecision?.permissions ?? {})}`,
          "",
          "## 调查证据",
          "",
          ...bullets(
            plan.evidence.map(
              (item) =>
                `${item.id} · ${item.title} · 来源：${
                  item.sourceRef ?? "内存"
                } · SHA-256：${item.sha256 ?? hash(item.summary)} · 文件锚点：${hash(
                  JSON.stringify(item.sourceHashes ?? []),
                )}`,
            ),
          ),
          "",
        ]
      : []),
    "## 目标",
    "",
    artifact.objective,
    "",
    "## 范围",
    "",
    "### 包含",
    "",
    ...bullets(artifact.scope.in),
    "",
    "### 不包含",
    "",
    ...bullets(artifact.scope.out),
    "",
    "## 里程碑",
    "",
    ...artifact.milestones.flatMap((milestone, index) => [
      `### ${index + 1}. ${milestone.title}`,
      "",
      milestone.description,
      "",
      ...bullets(
        milestone.acceptanceCriteria.map((criterion) => `验收：${criterion}`),
      ),
      ...bullets(
        milestone.dependencies.map((dependency) => `依赖：${dependency}`),
      ),
      ...bullets(
        (milestone.targetRefs ?? []).map((target) => `目标：${target}`),
      ),
      ...bullets(
        (milestone.evidenceRefs ?? []).map((evidence) => `证据：${evidence}`),
      ),
      ...bullets(
        (milestone.actions ?? []).map((action) => `动作：${action}`),
      ),
      ...bullets(
        (milestone.toolNames ?? []).map((toolName) => `工具：${toolName}`),
      ),
      ...bullets(
        (milestone.acceptanceChecks ?? []).map(
          (check) =>
            `类型化验收 [${check.kind}] ${check.description}；参数：${JSON.stringify(
              check.params,
            )}`,
        ),
      ),
      "",
    ]),
    "## 风险",
    "",
    ...bullets(
      artifact.risks.map(
        (risk) =>
          `[${risk.severity}/${risk.status}] ${risk.description}；缓解：${risk.mitigation}`,
      ),
    ),
    "",
    "## 整体验收标准",
    "",
    ...bullets(artifact.acceptanceCriteria),
    ...bullets(
      (artifact.acceptanceChecks ?? []).map(
        (check) =>
          `[${check.kind}] ${check.description}；参数：${JSON.stringify(
            check.params,
          )}`,
      ),
    ),
    "",
    "## 未决问题",
    "",
    ...bullets(artifact.unresolvedQuestions),
    "",
    "## 少数意见",
    "",
    ...bullets(artifact.minorityOpinion),
    "",
    "## 执行门禁",
    "",
    `- 状态：${artifact.actionGate}`,
    `- 原因：${artifact.gateReason}`,
    ...(plan.qualityReport
      ? [
          `- 确定性检查：${plan.qualityReport.acceptanceCoverage.deterministicChecks}`,
          `- 模型检查：${plan.qualityReport.acceptanceCoverage.modelReviewChecks}`,
          `- 证据覆盖：${plan.qualityReport.evidenceCoverage.referenced}/${plan.qualityReport.evidenceCoverage.total}`,
          ...plan.qualityReport.blockingIssues.map(
            (issue) => `- 阻断 [${issue.code}]：${issue.message}`,
          ),
          ...plan.qualityReport.warnings.map(
            (issue) => `- 警告 [${issue.code}]：${issue.message}`,
          ),
        ]
      : []),
    "",
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function bullets(values: string[]): string[] {
  return values.length ? values.map((value) => `- ${value}`) : ["- 无"];
}

function canonicalProjectionPath(root: string, planId: string): string {
  return path.join(root, ".zerox", "plans", `${planId}.md`);
}

async function projectionHelperArgs(
  root: string,
  planId: string,
  expectedSha256: string | undefined,
  nextSha256?: string,
): Promise<string[]> {
  const stats = await lstat(root, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("计划工作区不是稳定目录。");
  }
  return [
    root,
    stats.dev.toString(),
    stats.ino.toString(),
    stats.uid.toString(),
    (stats.mode & 0o777n).toString(),
    planId,
    expectedSha256 ? `sha256:${expectedSha256}` : "absent",
    ...(nextSha256 ? [`sha256:${nextSha256}`] : []),
  ];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
