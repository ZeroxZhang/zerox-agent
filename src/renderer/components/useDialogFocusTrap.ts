import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogStackEntry<T extends { isConnected: boolean }> = {
  containsTarget: (target: T) => boolean;
  restoreTarget: T | null;
  token: symbol;
};

const openDialogStack = createDialogFocusStack<HTMLElement>();

export function useDialogFocusTrap(options: {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  open: boolean;
}) {
  const { dialogRef, initialFocusRef, onEscape, open } = options;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialogElement = dialogRef.current;
    if (!dialogElement) {
      return;
    }
    const activeDialog: HTMLElement = dialogElement;
    const dialogToken = Symbol("dialog");

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialogStack.push({
      containsTarget: (target) => activeDialog.contains(target),
      restoreTarget: previousFocus,
      token: dialogToken,
    });

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
      if (!openDialogStack.isTop(dialogToken)) {
        return;
      }
      if (event.key === "Escape" && onEscapeRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onEscapeRef.current();
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
      const removal = openDialogStack.remove(dialogToken);
      if (
        shouldRestoreDialogFocus({
          targetIsConnected: Boolean(removal.restoreTarget?.isConnected),
          wasTopmost: removal.wasTopmost,
        })
      ) {
        removal.restoreTarget?.focus();
      }
    };
  }, [dialogRef, initialFocusRef, open]);
}

export function shouldRestoreDialogFocus(options: {
  targetIsConnected: boolean;
  wasTopmost: boolean;
}): boolean {
  return options.wasTopmost && options.targetIsConnected;
}

export function chooseDialogRestoreTarget<T>(options: {
  currentTarget: T | null;
  currentTargetIsConnected: boolean;
  currentTargetWasInsideRemovedDialog: boolean;
  fallbackTarget: T | null;
  fallbackTargetIsConnected: boolean;
}): T | null {
  if (
    options.currentTargetIsConnected &&
    !options.currentTargetWasInsideRemovedDialog
  ) {
    return options.currentTarget;
  }
  return options.fallbackTargetIsConnected
    ? options.fallbackTarget
    : null;
}

export function createDialogFocusStack<
  T extends { isConnected: boolean },
>() {
  const entries: DialogStackEntry<T>[] = [];

  return {
    isTop(token: symbol): boolean {
      return entries.at(-1)?.token === token;
    },

    push(entry: DialogStackEntry<T>): void {
      entries.push(entry);
    },

    remove(token: symbol): {
      restoreTarget: T | null;
      wasTopmost: boolean;
    } {
      const stackIndex = entries.findIndex(
        (entry) => entry.token === token,
      );
      if (stackIndex < 0) {
        return {
          restoreTarget: null,
          wasTopmost: false,
        };
      }

      const wasTopmost = stackIndex === entries.length - 1;
      const [removedDialog] = entries.splice(stackIndex, 1);
      const nextDialog = entries[stackIndex];
      if (nextDialog) {
        nextDialog.restoreTarget = chooseDialogRestoreTarget({
          currentTarget: nextDialog.restoreTarget,
          currentTargetIsConnected: Boolean(
            nextDialog.restoreTarget?.isConnected,
          ),
          currentTargetWasInsideRemovedDialog: Boolean(
            nextDialog.restoreTarget &&
              removedDialog.containsTarget(nextDialog.restoreTarget),
          ),
          fallbackTarget: removedDialog.restoreTarget,
          fallbackTargetIsConnected: Boolean(
            removedDialog.restoreTarget?.isConnected,
          ),
        });
      }

      return {
        restoreTarget: removedDialog.restoreTarget,
        wasTopmost,
      };
    },
  };
}
