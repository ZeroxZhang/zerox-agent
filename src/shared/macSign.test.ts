import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Electron-builder signer intentionally remains executable JavaScript.
import { buildMacSigningOptions } from "../../scripts/mac-sign.mjs";

describe("macOS custom signer", () => {
  it("assigns only the native safe-fs helper an empty entitlement file", () => {
    const inheritedOptionsForFile = vi.fn(() => ({
      entitlements: "/tmp/inherited.plist",
      hardenedRuntime: false,
      timestamp: "none",
    }));
    const options = buildMacSigningOptions({
      app: "/tmp/Zerox Agent.app",
      optionsForFile: inheritedOptionsForFile,
    });
    const helper = path.join(
      "/tmp/Zerox Agent.app",
      "Contents",
      "Resources",
      "safe-fs",
      "zerox-safe-fs",
    );

    expect(options.optionsForFile(helper)).toMatchObject({
      entitlements: expect.stringMatching(/build\/entitlements\.safe-fs\.plist$/),
      hardenedRuntime: true,
      timestamp: "none",
    });
    expect(options.optionsForFile("/tmp/Zerox Agent.app/Contents/MacOS/Zerox Agent"))
      .toEqual({
        entitlements: "/tmp/inherited.plist",
        hardenedRuntime: false,
        timestamp: "none",
      });
    expect(inheritedOptionsForFile).toHaveBeenCalledTimes(2);
  });
});
