import { Fragment, memo, useMemo, type ReactNode } from "react";
import {
  resolveProcessDensity,
  type ProcessAttention,
  type ProcessDisclosurePreference,
} from "../../../shared/processDisclosure";
import type { RenderedOutputPart } from "../../chatOutputModel";
import { OutputPartRenderer } from "./OutputPartRenderer";
import {
  ProcessBlock,
  ProcessGroup,
  SettledProcessFold,
  type ProcessBlockTone,
} from "./ProcessBlock";

type AnswerBlockProps = {
  parts: RenderedOutputPart[];
  preference?: ProcessDisclosurePreference;
  /** True once the turn has settled and no longer streams. */
  settled?: boolean;
};

const PROCESS_PART_TYPES = new Set<RenderedOutputPart["type"]>([
  "approval_request",
  "command_output",
  "file_ref",
  "input_request",
  "ledger_event",
  "model_call",
  "plan_step",
  "reasoning",
  "tool_call",
  "tool_result",
]);

export function isProcessOutputPart(part: RenderedOutputPart): boolean {
  return PROCESS_PART_TYPES.has(part.type);
}

export function processPartAttention(part: RenderedOutputPart): ProcessAttention {
  if (part.type === "approval_request") {
    return "blocking";
  }
  if (part.type === "plan_step") {
    return part.steps.some((step) => step.status === "failed")
      ? "blocking"
      : "normal";
  }
  if (part.type === "tool_result") {
    return part.ok ? "normal" : "blocking";
  }
  if (part.type === "diagnostic") {
    return part.severity === "error" ? "blocking" : "normal";
  }
  return "normal";
}

export function processPartPresentation(part: RenderedOutputPart): {
  tone: ProcessBlockTone;
  label: string;
  summary: string;
  meta?: string;
} {
  switch (part.type) {
    case "reasoning":
      return {
        tone: "thinking",
        label: "思考",
        summary: summarizeText(part.text),
        ...(part.truncated ? { meta: "已截断" } : {}),
      };
    case "tool_call":
      return {
        tone: "tool",
        label: part.toolName,
        summary: part.toolSource ? `调用 · ${part.toolSource}` : "调用工具",
      };
    case "tool_result":
      return {
        tone: part.ok ? "tool-ok" : "tool-error",
        label: part.ok ? "工具返回" : "工具失败",
        summary: part.ok ? "成功" : part.error ? summarizeText(part.error) : "失败",
      };
    case "approval_request":
      return {
        tone: "approval",
        label: "需要你的决定",
        summary: `${part.toolName} · ${part.riskLevel} 风险`,
        meta: "等待中",
      };
    case "command_output":
      return {
        tone: "tool",
        label: "命令输出",
        summary: part.command,
        ...(part.exitCode !== undefined ? { meta: `退出码 ${part.exitCode}` } : {}),
      };
    case "file_ref":
      return {
        tone: "tool",
        label: part.label ?? part.path,
        summary: part.action,
      };
    case "input_request":
      return {
        tone: "approval",
        label: "需要补充信息",
        summary: part.skillName,
      };
    case "plan_step": {
      const current = part.steps[part.currentIndex];
      const failed = part.steps.find((step) => step.status === "failed");
      return {
        tone: "plan",
        label: part.currentIndex >= 0
          ? `计划 · 步骤 ${part.currentIndex + 1}/${part.total}`
          : `计划 · ${part.total} 步`,
        summary: failed
          ? `步骤失败：${failed.label}`
          : current?.label ?? "全部步骤已结束",
        ...(failed ? { meta: "需要处理" } : {}),
      };
    }
    case "model_call":
      return {
        tone: "model",
        label: `第 ${part.turn} 轮`,
        summary: part.toolCallsExecuted !== undefined
          ? `已调用 ${part.toolCallsExecuted} 次工具`
          : "调用模型",
      };
    case "ledger_event":
      return {
        tone: "model",
        label: part.title,
        summary: part.detail ?? part.status,
        meta: part.status,
      };
    default:
      return {
        tone: "model",
        label: "过程",
        summary: part.type,
      };
  }
}

type Segment =
  | { kind: "narrative"; parts: RenderedOutputPart[] }
  | { kind: "process"; parts: RenderedOutputPart[] };

function segmentParts(parts: RenderedOutputPart[]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    const kind = isProcessOutputPart(part) ? "process" : "narrative";
    const last = segments.at(-1);
    if (last?.kind === kind) {
      last.parts.push(part);
      continue;
    }
    segments.push({ kind, parts: [part] });
  }
  return segments;
}

function summarizeText(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 80)}…` : singleLine;
}

function renderPart(part: RenderedOutputPart, preference: ProcessDisclosurePreference) {
  if (!isProcessOutputPart(part)) {
    return <OutputPartRenderer key={part.renderKey} part={part} />;
  }
  const presentation = processPartPresentation(part);
  return (
    <ProcessBlock
      attention={processPartAttention(part)}
      id={part.renderKey}
      key={part.renderKey}
      label={presentation.label}
      meta={presentation.meta}
      preference={preference}
      summary={presentation.summary}
      tone={presentation.tone}
    >
      <OutputPartRenderer part={part} />
    </ProcessBlock>
  );
}

function renderProcessRun(
  parts: RenderedOutputPart[],
  preference: ProcessDisclosurePreference,
): ReactNode {
  const density = resolveProcessDensity(
    parts.map((part) => ({
      id: part.renderKey,
      attention: processPartAttention(part),
      part,
    })),
  );
  return (
    <>
      {density.hasLeadingGroup ? (
        <ProcessGroup
          count={density.leading.length}
          preference={preference}
          tail={processPartPresentation(density.leading.at(-1)!.part).label}
        >
          {density.leading.map((entry) => renderPart(entry.part, preference))}
        </ProcessGroup>
      ) : null}
      {density.recent.map((entry) => renderPart(entry.part, preference))}
    </>
  );
}

export const AnswerBlock = memo(function AnswerBlock({
  parts,
  preference = "auto",
  settled = false,
}: AnswerBlockProps) {
  const segments = useMemo(() => segmentParts(parts), [parts]);
  const processParts = useMemo(
    () => parts.filter(isProcessOutputPart),
    [parts],
  );

  if (segments.length === 0) {
    return null;
  }

  const narrative = segments
    .filter((segment) => segment.kind === "narrative")
    .flatMap((segment) => segment.parts);

  // A settled turn folds its whole process stream into one line and keeps the
  // answer visible; a running turn keeps causal order with per-run density.
  const body =
    settled && processParts.length > 0
      ? (
          <>
            <SettledProcessFold
              blockCount={processParts.length}
              preference={preference}
              summary={`${processParts.length} 步`}
            >
              {processParts.map((part) => renderPart(part, preference))}
            </SettledProcessFold>
            {narrative.map((part) => (
              <OutputPartRenderer key={part.renderKey} part={part} />
            ))}
          </>
        )
      : segments.map((segment, index) =>
          segment.kind === "narrative" ? (
            <Fragment key={`narrative-${index}`}>
              {segment.parts.map((part) => (
                <OutputPartRenderer key={part.renderKey} part={part} />
              ))}
            </Fragment>
          ) : (
            <div className="process-block-run" key={`process-${index}`}>
              {renderProcessRun(segment.parts, preference)}
            </div>
          ),
        );

  return (
    <div className="chat-answer-block is-body-only">
      <div className="chat-answer-body">
        <div className="chat-output-part-list">{body}</div>
      </div>
    </div>
  );
});
