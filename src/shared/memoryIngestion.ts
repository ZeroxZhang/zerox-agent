import type { MemoryInput, MemoryRecord } from "./memory";

export type MemoryIngestionCandidateStatus =
  | "pending"
  | "accepted"
  | "rejected";

export type MemoryIngestionEvidenceSnippet = {
  messageId: string;
  sessionId?: string;
  workspaceId?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
};

export type MemoryIngestionCandidate = {
  id: string;
  title: string;
  rationale: string;
  confidence: number;
  status: MemoryIngestionCandidateStatus;
  evidence: MemoryIngestionEvidenceSnippet[];
  draftMemory: MemoryInput;
  createdAt: string;
  updatedAt: string;
  acceptedMemoryId?: string;
};

export type MemoryIngestionScope = {
  workspaceId?: string;
  sessionId?: string;
  days?: number;
  maxSessions?: number;
  maxMessages?: number;
};

export type MemoryIngestionReport = {
  scannedSessions: number;
  scannedMessages: number;
  createdCandidates: number;
  duplicateCandidates: number;
  skippedCandidates: number;
  candidates: MemoryIngestionCandidate[];
  createdAt: string;
};

export type MemoryIngestionRuntimeStatus = {
  running: boolean;
  message: string;
  startedAt?: string;
  completedAt?: string;
  report?: MemoryIngestionReport;
  error?: string;
};

export type IngestRecentMemoryResult =
  | { ok: true; report: MemoryIngestionReport }
  | { ok: false; message: string };

export type GetMemoryIngestionStatusResult =
  | { ok: true; status: MemoryIngestionRuntimeStatus }
  | { ok: false; message: string };

export type ListMemoryIngestionCandidatesResult =
  | { ok: true; candidates: MemoryIngestionCandidate[] }
  | { ok: false; message: string };

export type AcceptMemoryIngestionCandidateResult =
  | {
      ok: true;
      candidate: MemoryIngestionCandidate;
      memory: MemoryRecord;
    }
  | { ok: false; message: string };

export type RejectMemoryIngestionCandidateResult =
  | { ok: true; candidate: MemoryIngestionCandidate }
  | { ok: false; message: string };
