import { useEffect, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocusTrap(options: {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  open: boolean;
}) {
  const { dialogRef, initialFocusRef, onEscape, open } = options;

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return;
    }
    const activeDialog: HTMLElement = dialogElement;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function getFocusableElements() {
      return Array.from(activeDialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled"))
        .filter((element) => element.getAttribute("aria-hidden") !== "true");
    }

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = getFocusableElements()[0];
      const initialTarget = initialFocusRef?.current ?? firstFocusable ?? activeDialog;
      initialTarget.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [dialogRef, initialFocusRef, onEscape, open]);
}
