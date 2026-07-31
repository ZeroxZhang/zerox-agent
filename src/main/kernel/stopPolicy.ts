import type { ChatMessage } from "../openAiCompatibleClient";
import type {
  RunContext,
  StopPolicy,
  TurnResult,
} from "./kernelTypes";

export type EvidenceJudgeVerdict =
  | {
      ok: true;
      reason: string;
      evidence: string[];
    }
  | {
      ok: false;
      reason: string;
      missing?: string[];
      impossible?: false;
    }
  | {
      ok: false;
      impossible: true;
      reason: string;
    };

export type EvidenceJudgeInput = {
  condition: string;
  transcriptMessages: ChatMessage[];
  ctx: RunContext;
  lastTurn: TurnResult;
  attempt: number;
};

export type EvidenceJudgePolicyOptions = {
  condition: string;
  transcriptMessages: ChatMessage[] | (() => ChatMessage[]);
  maxReact?: number;
  judge(input: EvidenceJudgeInput): Promise<EvidenceJudgeVerdict>;
};

export function createCheckpointIntervalPolicy(): StopPolicy {
  return {
    kind: "checkpoint_interval",
    async shouldStop(_ctx, lastTurn) {
      if (lastTurn.completed) {
        return {
          stop: true,
          reason: "run completed",
        };
      }

      return {
        stop: false,
        reason: "continue after checkpoint",
      };
    },
  };
}

export function createEvidenceJudgePolicy(
  options: EvidenceJudgePolicyOptions,
): StopPolicy {
  let attempts = 0;
  const maxReact = Math.max(1, Math.floor(options.maxReact ?? 12));

  return {
    kind: "evidence_judge",
    async shouldStop(ctx, lastTurn) {
      if (attempts >= maxReact) {
        return {
          stop: true,
          impossible: true,
          reason: "evidence judge stalled without verifiable progress",
        };
      }

      attempts += 1;
      const transcriptMessages = getTranscriptMessages(options.transcriptMessages);
      const verdict = await options.judge({
        condition: options.condition,
        transcriptMessages,
        ctx,
        lastTurn,
        attempt: attempts,
      });

      return validateEvidenceJudgeVerdict(verdict, transcriptMessages);
    },
  };
}

export function validateEvidenceJudgeVerdict(
  verdict: EvidenceJudgeVerdict,
  transcriptMessages: ChatMessage[],
) {
  if (verdict.ok) {
    const evidence = verdict.evidence.filter((item) => item.trim().length > 0);
    const missing = evidence.filter((item) =>
      !transcriptContainsEvidence(transcriptMessages, item)
    );
    if (!evidence.length || missing.length > 0) {
      return {
        stop: false as const,
        reason: "insufficient evidence in transcript",
        missing: missing.length ? missing : ["evidence"],
      };
    }

    return {
      stop: true as const,
      reason: verdict.reason,
      evidence,
    };
  }

  if (verdict.impossible) {
    return {
      stop: true as const,
      impossible: true as const,
      reason: verdict.reason,
    };
  }

  return {
    stop: false as const,
    reason: verdict.reason,
    ...(verdict.missing ? { missing: verdict.missing } : {}),
  };
}

function getTranscriptMessages(
  transcriptMessages: ChatMessage[] | (() => ChatMessage[]),
): ChatMessage[] {
  return typeof transcriptMessages === "function"
    ? transcriptMessages()
    : transcriptMessages;
}

function transcriptContainsEvidence(
  transcriptMessages: ChatMessage[],
  evidence: string,
): boolean {
  const normalizedEvidence = normalizeForEvidenceMatch(evidence);
  if (!normalizedEvidence) {
    return false;
  }

  const transcript = normalizeForEvidenceMatch(
    transcriptMessages.map((message) => message.content).join("\n"),
  );
  return transcript.includes(normalizedEvidence);
}

function normalizeForEvidenceMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
