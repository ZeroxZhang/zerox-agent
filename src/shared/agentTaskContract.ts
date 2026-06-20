export type AgentTaskContract =
  | ChromeBookmarksTaskContract
  | JsonMarkdownTaskContract;

export type ChromeBookmarksTaskContract = {
  schemaVersion: 1;
  id: string;
  taskKind: "local_data_to_artifact";
  mode: "deterministic";
  source: { type: "chrome_bookmarks"; profile?: string };
  transform: { type: "grouped_markdown" };
  deliverable: {
    artifactId: "bookmark_list";
    artifactRef: "artifact:bookmark_list";
    mediaType: "text/markdown";
    destination: { kind: "desktop"; filename: "bookmark_list.md" };
  };
  capabilities: Array<{ id: string; toolName: "chrome_bookmarks_read" }>;
  acceptance: {
    evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"];
    provenanceRequired: true;
  };
  createdFrom: {
    description: string;
    chatSessionId?: string;
    originMessageId?: string;
  };
};

export type JsonMarkdownTaskContract = {
  schemaVersion: 1;
  id: string;
  taskKind: "local_data_to_artifact";
  mode: "deterministic";
  source: { type: "json_file"; path: string };
  transform: { type: "json_markdown" };
  deliverable: {
    artifactId: string;
    artifactRef: `artifact:${string}`;
    mediaType: "text/markdown";
    destination:
      | { kind: "desktop"; filename: string }
      | { kind: "path"; path: string };
  };
  capabilities: Array<{ id: string; toolName: "file_read" | "file_write" }>;
  acceptance: {
    evidenceRefs: Array<`artifact:${string}` | `provenance:${string}`>;
    provenanceRequired: true;
  };
  createdFrom: {
    description: string;
    chatSessionId?: string;
    originMessageId?: string;
  };
};

export type CompileAgentTaskContractInput = {
  description: string;
  chatSessionId?: string;
  originMessageId?: string;
};

export function compileAgentTaskContract(
  input: CompileAgentTaskContractInput,
): AgentTaskContract | undefined {
  const description = input.description.trim();
  if (!description || !isChromeBookmarksToDesktopMarkdownGoal(description)) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    id: createTaskContractId(input, description),
    taskKind: "local_data_to_artifact",
    mode: "deterministic",
    source: { type: "chrome_bookmarks" },
    transform: { type: "grouped_markdown" },
    deliverable: {
      artifactId: "bookmark_list",
      artifactRef: "artifact:bookmark_list",
      mediaType: "text/markdown",
      destination: { kind: "desktop", filename: "bookmark_list.md" },
    },
    capabilities: [
      { id: "chrome_bookmarks_read", toolName: "chrome_bookmarks_read" },
    ],
    acceptance: {
      evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
      provenanceRequired: true,
    },
    createdFrom: {
      description,
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
      ...(input.originMessageId
        ? { originMessageId: input.originMessageId }
        : {}),
    },
  };
}

function isChromeBookmarksToDesktopMarkdownGoal(description: string): boolean {
  return (
    mentionsChromeBookmarks(description) &&
    mentionsGrouping(description) &&
    mentionsMarkdown(description) &&
    mentionsDesktop(description)
  );
}

function mentionsChromeBookmarks(description: string): boolean {
  return (
    /chrome/i.test(description) &&
    /(bookmark|bookmarks|书签)/i.test(description)
  );
}

function mentionsGrouping(description: string): boolean {
  return /(group|grouped|grouping|categorize|category|categories|分类|类型|分组)/i.test(
    description,
  );
}

function mentionsMarkdown(description: string): boolean {
  return /(markdown|md\b|\.md\b)/i.test(description);
}

function mentionsDesktop(description: string): boolean {
  return /(desktop|桌面)/i.test(description);
}

function createTaskContractId(
  input: CompileAgentTaskContractInput,
  description: string,
): string {
  return [
    "task_contract_chrome_bookmarks",
    normalizeIdPart(input.chatSessionId ?? "no_chat"),
    normalizeIdPart(input.originMessageId ?? "no_message"),
    stableShortHash(description),
  ].join("_");
}

function normalizeIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "none";
}

function stableShortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}
