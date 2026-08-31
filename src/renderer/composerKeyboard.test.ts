import { describe, expect, it } from "vitest";
import { shouldSubmitComposerOnKeyDown } from "./composerKeyboard";

const bareEnter = {
  key: "Enter",
  shiftKey: false,
  altKey: false,
};

describe("composer keyboard", () => {
  it("submits only a bare Enter outside IME composition", () => {
    expect(shouldSubmitComposerOnKeyDown(bareEnter, false)).toBe(true);
    expect(shouldSubmitComposerOnKeyDown({ ...bareEnter, shiftKey: true }, false))
      .toBe(false);
    expect(shouldSubmitComposerOnKeyDown({ ...bareEnter, altKey: true }, false))
      .toBe(false);
  });

  it("does not submit the Enter that confirms IME text", () => {
    expect(shouldSubmitComposerOnKeyDown(bareEnter, true)).toBe(false);
    expect(shouldSubmitComposerOnKeyDown({
      ...bareEnter,
      nativeEvent: { isComposing: true },
    }, false)).toBe(false);
  });

  it("honors Chromium's keyCode 229 fallback around compositionend", () => {
    expect(shouldSubmitComposerOnKeyDown({
      ...bareEnter,
      nativeEvent: { isComposing: false, keyCode: 229 },
    }, false)).toBe(false);
    expect(shouldSubmitComposerOnKeyDown({
      ...bareEnter,
      keyCode: 229,
    }, false)).toBe(false);
    expect(shouldSubmitComposerOnKeyDown({
      ...bareEnter,
      nativeEvent: { isComposing: false, keyCode: 13 },
    }, false)).toBe(true);
  });
});
