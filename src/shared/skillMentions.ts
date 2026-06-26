export type SkillMentionCandidate = {
  name: string;
  displayName: string;
  description: string;
};

export type ActiveSkillMention = {
  start: number;
  end: number;
  query: string;
};

const skillNamePattern = "[a-z0-9][a-z0-9-]{0,63}";

export function matchSkillMentionCandidates(
  skills: SkillMentionCandidate[],
  query: string,
  limit = 8,
): SkillMentionCandidate[] {
  const normalizedQuery = normalizeSkillQuery(query);
  if (!normalizedQuery) {
    return skills.slice(0, limit);
  }

  return skills
    .map((skill) => ({ skill, score: scoreSkill(skill, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map((entry) => entry.skill);
}

export function extractActiveSkillMention(
  value: string,
  cursor: number,
): ActiveSkillMention | null {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const token = beforeCursor.slice(atIndex + 1);
  if (/\s/.test(token) || /[^\w-]/.test(token)) {
    return null;
  }

  return {
    start: atIndex,
    end: cursor,
    query: token,
  };
}

export function extractRequestedSkillQuery(message: string): string | null {
  const atMatch = message.match(new RegExp(`@(${skillNamePattern})`, "i"));
  if (atMatch?.[1]) {
    return atMatch[1].toLowerCase();
  }

  const explicitMatch = message.match(
    new RegExp(
      `(?:使用|用|调用|执行|运行|通过|采用)\\s*(${skillNamePattern})\\s*(?:skill|技能)`,
      "i",
    ),
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].toLowerCase();
  }

  return null;
}

export function replaceActiveSkillMention(
  value: string,
  mention: ActiveSkillMention,
  skillName: string,
): string {
  const prefix = value.slice(0, mention.start);
  const suffix = value.slice(mention.end);
  const separator = suffix.startsWith(" ") || suffix.length === 0 ? "" : " ";
  return `${prefix}@${skillName}${separator}${suffix}`;
}

function scoreSkill(skill: SkillMentionCandidate, query: string): number {
  const name = normalizeSkillQuery(skill.name);
  const displayName = normalizeSkillQuery(skill.displayName);
  const description = normalizeSkillQuery(skill.description);

  if (name === query) return 100;
  if (name.startsWith(query)) return 90;
  if (displayName.startsWith(query)) return 80;
  if (name.includes(query)) return 70;
  if (displayName.includes(query)) return 60;
  if (description.includes(query)) return 40;
  return 0;
}

function normalizeSkillQuery(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}
