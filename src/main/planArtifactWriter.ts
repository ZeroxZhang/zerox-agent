import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  PlanArtifact,
  PlanProjection,
  PlanRecord,
} from "../shared/planMode";
import { sanitizePlanRecordDiagnostics } from "../shared/planDiagnostics";

export type PlanArtifactWriter = {
  write(plan: PlanRecord, artifact: PlanArtifact): Promise<PlanProjection>;
  verify(plan: PlanRecord): Promise<boolean>;
};

export function createPlanArtifactWriter(options?: {
  now?: () => string;
}): PlanArtifactWriter {
  const now = options?.now ?? (() => new Date().toISOString());

  return {
    async write(plan, artifact) {
      const safeInput = sanitizeArtifactProjection(plan, artifact);
      if (!safeInput.plan.workspaceRoot) {
        throw new Error("计划没有绑定工作区，无法生成 Markdown 投影。");
      }
      assertArtifactPlanId(safeInput.plan.id);
      const root = await realpath(safeInput.plan.workspaceRoot);
      const zeroxDir = path.join(root, ".zerox");
      const plansDir = path.join(zeroxDir, "plans");
      await assertNotSymlinkIfPresent(zeroxDir);
      await mkdir(plansDir, { recursive: true });
      await assertNotSymlinkIfPresent(zeroxDir);
      await assertNotSymlinkIfPresent(plansDir);
      const destination = path.join(plansDir, `${safeInput.plan.id}.md`);
      assertInside(root, destination);
      const markdown = renderPlanMarkdown(safeInput.plan, safeInput.artifact);
      const sha256 = hash(markdown);
      const temp = path.join(
        plansDir,
        `.${safeInput.plan.id}.${randomUUID()}.tmp`,
      );
      await writeFile(temp, markdown, { encoding: "utf8", mode: 0o600 });
      await rename(temp, destination);
      const persisted = await readFile(destination, "utf8");
      if (hash(persisted) !== sha256) {
        throw new Error("计划投影写入后哈希校验失败。");
      }
      return {
        path: destination,
        sha256,
        writtenAt: now(),
      };
    },

    async verify(plan) {
      if (!plan.projection || !plan.workspaceRoot || !plan.finalArtifact) {
        return false;
      }
      try {
        const safeInput = sanitizeArtifactProjection(plan, plan.finalArtifact);
        const root = await realpath(safeInput.plan.workspaceRoot!);
        assertInside(root, safeInput.plan.projection!.path);
        await assertNoSymlinkChain(root, safeInput.plan.projection!.path);
        const content = await readFile(safeInput.plan.projection!.path, "utf8");
        const currentProjection = renderPlanMarkdown(
          safeInput.plan.confirmedRevision
            ? {
                ...safeInput.plan,
                revision: safeInput.plan.confirmedRevision,
              }
            : safeInput.plan,
          safeInput.artifact,
        );
        return (
          hash(content) === safeInput.plan.projection!.sha256 &&
          hash(currentProjection) === safeInput.plan.projection!.sha256
        );
      } catch {
        return false;
      }
    },
  };
}

export async function rewriteSanitizedPlanProjection(
  plan: PlanRecord,
  now = () => new Date().toISOString(),
): Promise<PlanRecord> {
  if (!plan.projection || !plan.workspaceRoot || !plan.finalArtifact) {
    return sanitizePlanRecordDiagnostics(plan);
  }
  const safeInput = sanitizeArtifactProjection(plan, plan.finalArtifact);
  assertArtifactPlanId(safeInput.plan.id);
  const root = await realpath(safeInput.plan.workspaceRoot!);
  const zeroxDir = path.join(root, ".zerox");
  const plansDir = path.join(zeroxDir, "plans");
  const destination = path.join(plansDir, `${safeInput.plan.id}.md`);
  if (safeInput.plan.projection!.path !== destination) {
    throw new Error("计划投影路径不是当前计划的规范路径。");
  }
  assertInside(root, destination);
  await assertNotSymlinkIfPresent(zeroxDir);
  await mkdir(plansDir, { recursive: true });
  await assertNotSymlinkIfPresent(zeroxDir);
  await assertNotSymlinkIfPresent(plansDir);
  await assertNoSymlinkChain(root, destination);
  const markdown = renderPlanMarkdown(safeInput.plan, safeInput.artifact);
  const sha256 = hash(markdown);
  let current = "";
  try {
    current = await readFile(destination, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (hash(current) !== sha256) {
    const temp = path.join(
      plansDir,
      `.${safeInput.plan.id}.${randomUUID()}.migration.tmp`,
    );
    await writeFile(temp, markdown, { encoding: "utf8", mode: 0o600 });
    await rename(temp, destination);
  }
  return {
    ...safeInput.plan,
    projection: {
      path: destination,
      sha256,
      writtenAt:
        safeInput.plan.projection!.sha256 === sha256
          ? safeInput.plan.projection!.writtenAt
          : now(),
    },
  };
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

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("计划投影路径越过工作区边界。");
  }
}

async function assertNotSymlinkIfPresent(target: string) {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`计划投影目录不能是符号链接：${target}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function assertNoSymlinkChain(root: string, target: string) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await assertNotSymlinkIfPresent(current);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
