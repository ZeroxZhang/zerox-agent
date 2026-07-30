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
      if (!plan.workspaceRoot) {
        throw new Error("计划没有绑定工作区，无法生成 Markdown 投影。");
      }
      validatePlanId(plan.id);
      const root = await realpath(plan.workspaceRoot);
      const zeroxDir = path.join(root, ".zerox");
      const plansDir = path.join(zeroxDir, "plans");
      await assertNotSymlinkIfPresent(zeroxDir);
      await mkdir(plansDir, { recursive: true });
      await assertNotSymlinkIfPresent(zeroxDir);
      await assertNotSymlinkIfPresent(plansDir);
      const destination = path.join(plansDir, `${plan.id}.md`);
      assertInside(root, destination);
      const markdown = renderPlanMarkdown(plan, artifact);
      const sha256 = hash(markdown);
      const temp = path.join(plansDir, `.${plan.id}.${randomUUID()}.tmp`);
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
      if (!plan.projection || !plan.workspaceRoot) {
        return false;
      }
      try {
        const root = await realpath(plan.workspaceRoot);
        assertInside(root, plan.projection.path);
        await assertNoSymlinkChain(root, plan.projection.path);
        const content = await readFile(plan.projection.path, "utf8");
        return hash(content) === plan.projection.sha256;
      } catch {
        return false;
      }
    },
  };
}

export function renderPlanMarkdown(
  plan: PlanRecord,
  artifact: PlanArtifact,
): string {
  const lines = [
    `# ${artifact.title}`,
    "",
    `> Plan ID: ${plan.id} · Revision: ${plan.revision} · Mode: ${plan.mode}`,
    "",
    artifact.summary,
    "",
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
    "",
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function bullets(values: string[]): string[] {
  return values.length ? values.map((value) => `- ${value}`) : ["- 无"];
}

function validatePlanId(planId: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(planId)) {
    throw new Error("计划 ID 非法。");
  }
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
