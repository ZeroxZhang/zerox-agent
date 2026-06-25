export type RawHistoryRole = "system" | "user" | "assistant" | "tool";

export type RawHistoryEntry = {
  id: string;
  sessionId?: string;
  runId?: string;
  workspaceId?: string;
  role: RawHistoryRole;
  toolName?: string;
  content: string;
  pathRefs?: string[];
  createdAt: string;
  source: "chat" | "tool" | "command" | "memory";
};

export type RawHistorySearchOptions = {
  query: string;
  workspaceId?: string;
  sessionId?: string;
  limit?: number;
};

export type RawHistorySearchResult = {
  entry: RawHistoryEntry;
  score: number;
  matchedTerms: string[];
};

export type RawHistoryAroundOptions = {
  entryId: string;
  workspaceId?: string;
  sessionId?: string;
  before?: number;
  after?: number;
};

export type RawHistoryAroundResult = {
  anchor: RawHistoryEntry;
  entries: RawHistoryEntry[];
};
