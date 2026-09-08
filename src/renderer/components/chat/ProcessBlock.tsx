import { memo, useState, type ReactNode } from "react";
import {
  resolveProcessBlockExpanded,
  type ProcessAttention,
  type ProcessDisclosurePreference,
} from "../../../shared/processDisclosure";
import { Icon } from "../Icon";

export type ProcessBlockTone =
  | "thinking"
  | "tool"
  | "tool-ok"
  | "tool-error"
  | "plan"
  | "model"
  | "approval";

export type ProcessBlockProps = {
  id: string;
  attention: ProcessAttention;
  preference: ProcessDisclosurePreference;
  label: string;
  summary: string;
  meta?: string;
  tone: ProcessBlockTone;
  children: ReactNode;
};

/**
 * One inline process fact (L1 summary row / L2 body).
 *
 * Follows the existing disclosure interaction contract: a button with
 * `aria-expanded` + `aria-controls`, the shared expand/collapse icon, and an
 * explicit 展开/收起 label. Blocking rows announce themselves as alerts.
 */
export const ProcessBlock = memo(function ProcessBlock(props: ProcessBlockProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | undefined>(undefined);
  const expanded = resolveProcessBlockExpanded({
    attention: props.attention,
    preference: props.preference,
    userExpanded,
  });
  const bodyId = `process-block-body-${props.id}`;
  const blocking = props.attention === "blocking";

  return (
    <section
      className={`process-block is-${props.tone} is-${props.attention}${
        expanded ? " is-expanded" : ""
      }`}
      data-process-attention={props.attention}
      data-process-id={props.id}
      role={blocking ? "alert" : undefined}
    >
      <button
        aria-controls={bodyId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}${props.label}详情`}
        className="process-block-head"
        onClick={() => setUserExpanded(!expanded)}
        title={expanded ? "收起详情" : "展开详情"}
        type="button"
      >
        <span aria-hidden="true" className="process-block-dot" />
        <strong className="process-block-label">{props.label}</strong>
        <span className="process-block-summary">{props.summary}</span>
        {props.meta ? <span className="process-block-meta">{props.meta}</span> : null}
        <Icon name={expanded ? "collapse" : "expand"} size={14} />
      </button>
      {expanded ? (
        <div className="process-block-body" id={bodyId}>
          {props.children}
        </div>
      ) : null}
    </section>
  );
});

/** L0: older non-attention steps fold into one line. */
export const ProcessGroup = memo(function ProcessGroup(props: {
  count: number;
  tail: string;
  preference: ProcessDisclosurePreference;
  children: ReactNode;
}) {
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = props.preference === "open"
    ? true
    : props.preference === "compact"
      ? false
      : userExpanded;
  const bodyId = "process-group-body";

  return (
    <section
      className={`process-group${expanded ? " is-expanded" : ""}`}
      data-process-group-count={props.count}
    >
      <button
        aria-controls={bodyId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}更早的过程`}
        className="process-group-head"
        onClick={() => setUserExpanded(!expanded)}
        title={expanded ? "收起更早的过程" : "展开更早的过程"}
        type="button"
      >
        <Icon name={expanded ? "collapse" : "expand"} size={15} />
        <strong>更早的过程</strong>
        <span>{props.count} 步</span>
        <small>{props.tail}</small>
      </button>
      {expanded ? (
        <div className="process-group-body" id={bodyId}>
          {props.children}
        </div>
      ) : null}
    </section>
  );
});

/** Settled turn: the whole process stream folds to one summary line. */
export const SettledProcessFold = memo(function SettledProcessFold(props: {
  blockCount: number;
  summary: string;
  preference: ProcessDisclosurePreference;
  children: ReactNode;
}) {
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = props.preference === "open" ? true : userExpanded;

  return (
    <section
      className={`settled-process-fold${expanded ? " is-expanded" : ""}`}
      data-settled-process-count={props.blockCount}
    >
      <button
        aria-controls="settled-process-body"
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}本轮过程`}
        className="settled-process-head"
        onClick={() => setUserExpanded(!expanded)}
        type="button"
      >
        <Icon name={expanded ? "collapse" : "expand"} size={15} />
        <strong>本轮过程</strong>
        <span>{props.blockCount} 步</span>
        <small>{props.summary}</small>
      </button>
      {expanded ? (
        <div className="settled-process-body" id="settled-process-body">
          {props.children}
        </div>
      ) : null}
    </section>
  );
});
