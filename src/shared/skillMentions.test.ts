import { describe, expect, it } from "vitest";
import {
  extractActiveSkillMention,
  extractRequestedSkillQuery,
  matchSkillMentionCandidates,
  type SkillMentionCandidate,
} from "./skillMentions";

const skills: SkillMentionCandidate[] = [
  {
    name: "onepager",
    displayName: "Onepager",
    description: "Generate beautiful OnePage infographic posters.",
  },
  {
    name: "local-file-organizer",
    displayName: "Local File Organizer",
    description: "Organize local folders.",
  },
  {
    name: "paper-to-course",
    displayName: "Paper to Course",
    description: "Turn a paper into a tutorial.",
  },
];

describe("skill mentions", () => {
  it("fuzzy matches @ queries against skill names and descriptions", () => {
    expect(matchSkillMentionCandidates(skills, "one").map((skill) => skill.name)).toEqual([
      "onepager",
    ]);
  });

  it("detects the active @ token before the cursor", () => {
    expect(extractActiveSkillMention("请用 @one", 7)).toEqual({
      start: 3,
      end: 7,
      query: "one",
    });
  });

  it("extracts natural language requests to use a specific skill", () => {
    expect(extractRequestedSkillQuery("使用 onepager 技能，给这个项目生成一张图")).toBe(
      "onepager",
    );
    expect(extractRequestedSkillQuery("请通过 @onepager 做一版")).toBe("onepager");
  });
});
