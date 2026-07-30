import type { PlanMilestone } from "./planMode";

export type ValidatedPlanMilestoneGraph = {
  dependenciesById: Map<string, string[]>;
  rootIds: Set<string>;
};

export function validatePlanMilestoneGraph(
  milestones: PlanMilestone[],
): ValidatedPlanMilestoneGraph {
  if (milestones.length === 0) {
    throw new Error("计划至少需要一个里程碑。");
  }

  const byId = new Map<string, PlanMilestone>();
  const idsByTitle = new Map<string, string[]>();
  for (const [index, milestone] of milestones.entries()) {
    const id = milestone.id.trim();
    const title = milestone.title.trim();
    if (!id || !title || !milestone.description.trim()) {
      throw new Error(`计划里程碑 ${index + 1} 缺少 id、title 或 description。`);
    }
    if (milestone.acceptanceCriteria.length === 0) {
      throw new Error(`计划里程碑 "${id}" 缺少验收条件。`);
    }
    if (byId.has(id)) {
      throw new Error(`计划里程碑 ID "${id}" 重复。`);
    }
    byId.set(id, milestone);
    idsByTitle.set(title, [...(idsByTitle.get(title) ?? []), id]);
  }

  const dependenciesById = new Map<string, string[]>();
  for (const milestone of milestones) {
    const id = milestone.id.trim();
    const resolved = milestone.dependencies.map((dependency) => {
      const candidate = dependency.trim();
      if (!candidate) {
        throw new Error(`计划里程碑 "${id}" 包含空依赖。`);
      }
      if (byId.has(candidate)) {
        return candidate;
      }
      const titleMatches = idsByTitle.get(candidate) ?? [];
      if (titleMatches.length === 0) {
        throw new Error(
          `计划里程碑 "${id}" 引用了不存在的依赖 "${candidate}"。`,
        );
      }
      if (titleMatches.length > 1) {
        throw new Error(
          `计划里程碑 "${id}" 的依赖标题 "${candidate}" 不唯一，请使用里程碑 ID。`,
        );
      }
      return titleMatches[0]!;
    });
    const unique = [...new Set(resolved)];
    if (unique.includes(id)) {
      throw new Error(`计划里程碑 "${id}" 不能依赖自身。`);
    }
    dependenciesById.set(id, unique);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) {
      throw new Error("计划里程碑依赖不能形成循环。");
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependencyId of dependenciesById.get(id) ?? []) {
      visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) {
    visit(id);
  }

  return {
    dependenciesById,
    rootIds: new Set(
      [...dependenciesById.entries()]
        .filter(([, dependencies]) => dependencies.length === 0)
        .map(([id]) => id),
    ),
  };
}
