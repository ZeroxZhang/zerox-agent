import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Electron-builder hook intentionally remains executable JavaScript.
import afterSignMac from "../../scripts/after-sign-mac.mjs";

function context(overrides: Record<string, unknown> = {}) {
  return {
    electronPlatformName: "darwin",
    appOutDir: "/tmp/out",
    packager: { appInfo: { productFilename: "Zerox Agent" } },
    ...overrides,
  };
}

function success(stdout = "", stderr = "") {
  return { status: 0, stdout, stderr, error: undefined };
}

describe("legacy macOS after-sign hook", () => {
  it("is a no-op outside the explicit legacy macOS mode", async () => {
    const runCodesign = vi.fn();
    await afterSignMac(context(), { releaseMode: "developer-id", runCodesign });
    await afterSignMac(context({ electronPlatformName: "linux" }), {
      releaseMode: "legacy-adhoc",
      runCodesign,
    });
    expect(runCodesign).not.toHaveBeenCalled();
  });

  it("seals, deeply verifies, and inspects the stable requirement", async () => {
    const runCodesign = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(
        success(
          "",
          'Executable=/tmp/out/Zerox Agent.app\ndesignated => identifier "local.zerox.agent.desktop"',
        ),
      );
    await afterSignMac(context(), {
      releaseMode: "legacy-adhoc",
      existsSync: () => true,
      runCodesign,
    });
    expect(runCodesign).toHaveBeenCalledTimes(3);
    expect(runCodesign.mock.calls[0]?.[0]).toContain(
      '=designated => identifier "local.zerox.agent.desktop"',
    );
    expect(runCodesign.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining(["--verify", "--deep", "--strict"]),
    );
  });

  it("fails closed for missing context, bundles, codesign errors, and requirement drift", async () => {
    await expect(
      afterSignMac(context({ packager: {} }), { releaseMode: "legacy-adhoc" }),
    ).rejects.toThrow("product filename");
    await expect(
      afterSignMac(context(), {
        releaseMode: "legacy-adhoc",
        existsSync: () => false,
      }),
    ).rejects.toThrow("cannot find");
    await expect(
      afterSignMac(context(), {
        releaseMode: "legacy-adhoc",
        existsSync: () => true,
        runCodesign: () => ({
          status: 1,
          stdout: "",
          stderr: "sign failed",
          error: undefined,
        }),
      }),
    ).rejects.toThrow("sign failed");

    const runCodesign = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(success("designated => cdhash H\"abc\""));
    await expect(
      afterSignMac(context(), {
        releaseMode: "legacy-adhoc",
        existsSync: () => true,
        runCodesign,
      }),
    ).rejects.toThrow("not stable");
  });
});
