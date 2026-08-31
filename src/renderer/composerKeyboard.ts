export type ComposerKeyEvent = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

/**
 * Enter only submits after the IME has fully left composition mode.
 * Chromium/WebKit can report the composition-confirming key as keyCode 229
 * even when isComposing has already flipped to false, so both signals matter.
 */
export function shouldSubmitComposerOnKeyDown(
  event: ComposerKeyEvent,
  compositionActive: boolean,
): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.altKey) {
    return false;
  }
  if (compositionActive || event.nativeEvent?.isComposing) {
    return false;
  }
  return ![
    event.keyCode,
    event.which,
    event.nativeEvent?.keyCode,
    event.nativeEvent?.which,
  ].includes(229);
}
