import { useCallback, useRef, useState } from "react";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

export type ConfirmDialogVariant = "danger" | "info" | "warning";

export function ConfirmDialog({
  cancelLabel = "取消",
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  title,
  variant = "warning",
}: {
  cancelLabel?: string;
  confirmLabel: string;
  message: string;
  onCancel?: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  variant?: ConfirmDialogVariant;
}) {
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const canCancel = Boolean(onCancel);
  const descriptionId = `${toDialogId(title)}-description`;
  const titleId = `${toDialogId(title)}-title`;

  const handleCancel = useCallback(() => {
    if (!pending && onCancel) {
      onCancel();
    }
  }, [onCancel, pending]);

  useDialogFocusTrap({
    dialogRef,
    initialFocusRef: safeButtonRef,
    onEscape: handleCancel,
    open: true,
  });

  async function handleConfirm() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="app-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`app-confirm-dialog is-${variant}`}
        ref={dialogRef}
        role={variant === "danger" ? "alertdialog" : "dialog"}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="app-confirm-copy">
          <span>{variant === "danger" ? "需要确认" : "提示"}</span>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{message}</p>
        </div>
        <div className="app-confirm-actions">
          {canCancel ? (
            <button
              className="app-confirm-secondary"
              disabled={pending}
              onClick={handleCancel}
              ref={safeButtonRef}
              type="button"
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            className="app-confirm-primary"
            disabled={pending}
            onClick={() => {
              void handleConfirm();
            }}
            ref={canCancel ? undefined : safeButtonRef}
            type="button"
          >
            {pending ? "处理中" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDialogId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app-confirm-dialog";
}
