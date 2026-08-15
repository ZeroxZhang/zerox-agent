import { describe, expect, it } from "vitest";
import {
  chooseDialogRestoreTarget,
  createDialogFocusStack,
  shouldRestoreDialogFocus,
} from "./useDialogFocusTrap";

describe("dialog focus restoration", () => {
  it("restores focus only when the closing dialog owned the stack top", () => {
    expect(
      shouldRestoreDialogFocus({
        targetIsConnected: true,
        wasTopmost: true,
      }),
    ).toBe(true);
    expect(
      shouldRestoreDialogFocus({
        targetIsConnected: true,
        wasTopmost: false,
      }),
    ).toBe(false);
  });

  it("does not focus a target removed with its underlying dialog", () => {
    expect(
      shouldRestoreDialogFocus({
        targetIsConnected: false,
        wasTopmost: true,
      }),
    ).toBe(false);
  });

  it("passes the underlying restore target to the next stacked dialog", () => {
    expect(
      chooseDialogRestoreTarget({
        currentTarget: "underlying-dialog-button",
        currentTargetIsConnected: false,
        currentTargetWasInsideRemovedDialog: true,
        fallbackTarget: "original-trigger",
        fallbackTargetIsConnected: true,
      }),
    ).toBe("original-trigger");
  });

  it("keeps an independent connected restore target", () => {
    expect(
      chooseDialogRestoreTarget({
        currentTarget: "independent-trigger",
        currentTargetIsConnected: true,
        currentTargetWasInsideRemovedDialog: false,
        fallbackTarget: "older-trigger",
        fallbackTargetIsConnected: true,
      }),
    ).toBe("independent-trigger");
  });

  it("carries the original trigger through three dialogs removed bottom-up", () => {
    const stack = createDialogFocusStack<MockFocusTarget>();
    const originalTrigger = target("original-trigger");
    const firstDialogButton = target("first-dialog-button");
    const secondDialogButton = target("second-dialog-button");
    const firstToken = Symbol("first");
    const secondToken = Symbol("second");
    const thirdToken = Symbol("third");

    stack.push({
      containsTarget: (candidate) => candidate === firstDialogButton,
      restoreTarget: originalTrigger,
      token: firstToken,
    });
    stack.push({
      containsTarget: (candidate) => candidate === secondDialogButton,
      restoreTarget: firstDialogButton,
      token: secondToken,
    });
    stack.push({
      containsTarget: () => false,
      restoreTarget: secondDialogButton,
      token: thirdToken,
    });

    firstDialogButton.isConnected = false;
    expect(stack.remove(firstToken)).toMatchObject({
      restoreTarget: originalTrigger,
      wasTopmost: false,
    });
    secondDialogButton.isConnected = false;
    expect(stack.remove(secondToken)).toMatchObject({
      restoreTarget: originalTrigger,
      wasTopmost: false,
    });
    expect(stack.remove(thirdToken)).toEqual({
      restoreTarget: originalTrigger,
      wasTopmost: true,
    });
  });

  it("preserves top ownership and restores each connected nested trigger", () => {
    const stack = createDialogFocusStack<MockFocusTarget>();
    const originalTrigger = target("original-trigger");
    const nestedTrigger = target("nested-trigger");
    const firstToken = Symbol("first");
    const secondToken = Symbol("second");

    stack.push({
      containsTarget: (candidate) => candidate === nestedTrigger,
      restoreTarget: originalTrigger,
      token: firstToken,
    });
    stack.push({
      containsTarget: () => false,
      restoreTarget: nestedTrigger,
      token: secondToken,
    });

    expect(stack.isTop(firstToken)).toBe(false);
    expect(stack.isTop(secondToken)).toBe(true);
    expect(stack.remove(secondToken)).toEqual({
      restoreTarget: nestedTrigger,
      wasTopmost: true,
    });
    expect(stack.isTop(firstToken)).toBe(true);
    expect(stack.remove(firstToken)).toEqual({
      restoreTarget: originalTrigger,
      wasTopmost: true,
    });
  });
});

type MockFocusTarget = {
  id: string;
  isConnected: boolean;
};

function target(id: string): MockFocusTarget {
  return {
    id,
    isConnected: true,
  };
}
