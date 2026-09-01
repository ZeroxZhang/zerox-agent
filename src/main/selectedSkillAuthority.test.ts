import { describe, expect, it } from "vitest";
import type { GoalSelectedSkill } from "../shared/agentGoal";
import {
  createPublicSkillSnapshot,
  createPublicSkillSnapshotSha256,
  type SkillRecord,
} from "../shared/skills";
import { verifySelectedSkillAuthority } from "./selectedSkillAuthority";

function createSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    rootDir: "/tmp/skills/authority",
    skillFile: "/tmp/skills/authority/SKILL.md",
    body: "Canonical instructions.",
    manifest: {
      name: "authority",
      displayName: "Authority",
      description: "Verify Skill authority.",
      version: "1.0.0",
      execution: { mode: "agent", entrypoint: null },
      inputs: [],
      permissions: {
        files: { read: ["./input"], write: ["./output"] },
        shell: { commands: ["npm test"] },
        web: { search: false, fetchDomains: [] },
        memory: { read: false, write: false },
      },
    },
    ...overrides,
  };
}

describe("selected Skill authority", () => {
  it("returns only the rediscovered canonical public snapshot", () => {
    const current = createSkill();
    const persisted = createPublicSkillSnapshot(current);
    const result = verifySelectedSkillAuthority({
      selectedSkill: persisted,
      snapshotSha256: createPublicSkillSnapshotSha256(persisted),
      requireDigest: true,
      discoveredSkills: [current],
    });

    expect(result).toEqual({ ok: true, selectedSkill: persisted });
    expect(result.ok && result.selectedSkill).not.toBe(persisted);
  });

  it.each([
    ["root", { rootDir: "/tmp/skills/tampered" }],
    ["body", { body: "Tampered instructions." }],
  ])("rejects persisted %s drift even when the name still matches", (_label, patch) => {
    const current = createSkill();
    const persisted = {
      ...createPublicSkillSnapshot(current),
      ...patch,
    } as GoalSelectedSkill;

    expect(
      verifySelectedSkillAuthority({
        selectedSkill: persisted,
        snapshotSha256: createPublicSkillSnapshotSha256(current),
        requireDigest: true,
        discoveredSkills: [current],
      }),
    ).toEqual({ ok: false, reason: "drift" });
  });

  it("rejects missing installed skills and missing required digests", () => {
    const selectedSkill = createPublicSkillSnapshot(createSkill());
    expect(
      verifySelectedSkillAuthority({
        selectedSkill,
        requireDigest: true,
        discoveredSkills: [createSkill()],
      }),
    ).toEqual({ ok: false, reason: "missing_digest" });
    expect(
      verifySelectedSkillAuthority({
        selectedSkill,
        discoveredSkills: [],
      }),
    ).toEqual({ ok: false, reason: "missing" });
  });
});
