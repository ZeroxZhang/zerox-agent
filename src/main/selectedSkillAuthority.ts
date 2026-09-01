import type { GoalSelectedSkill } from "../shared/agentGoal";
import {
  createPublicSkillSnapshot,
  createPublicSkillSnapshotSha256,
  publicSkillSnapshotsEqual,
  type SkillSnapshotSource,
} from "../shared/skills";

export type SelectedSkillAuthorityResult =
  | { ok: true; selectedSkill?: GoalSelectedSkill }
  | { ok: false; reason: "missing" | "missing_digest" | "drift" };

export function verifySelectedSkillAuthority(input: {
  selectedSkill?: GoalSelectedSkill;
  snapshotSha256?: string;
  requireDigest?: boolean;
  discoveredSkills: SkillSnapshotSource[];
}): SelectedSkillAuthorityResult {
  if (!input.selectedSkill) {
    return { ok: true };
  }
  if (input.requireDigest && !input.snapshotSha256) {
    return { ok: false, reason: "missing_digest" };
  }
  const currentSkill = input.discoveredSkills.find(
    (skill) => skill.manifest.name === input.selectedSkill!.manifest.name,
  );
  if (!currentSkill) {
    return { ok: false, reason: "missing" };
  }
  const canonical = createPublicSkillSnapshot(currentSkill);
  if (
    !publicSkillSnapshotsEqual(canonical, input.selectedSkill) ||
    (input.snapshotSha256 !== undefined &&
      createPublicSkillSnapshotSha256(canonical) !== input.snapshotSha256)
  ) {
    return { ok: false, reason: "drift" };
  }
  return { ok: true, selectedSkill: canonical };
}
