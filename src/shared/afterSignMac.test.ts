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
  it("is a no-op outside macOS", async () => {
    const runCodesign = vi.fn();
    await afterSignMac(context({ electronPlatformName: "linux" }), {
      releaseMode: "legacy-adhoc",
      runCodesign,
    });
    expect(runCodesign).not.toHaveBeenCalled();
  });

  it("verifies the packaged helper in every macOS signing mode", async () => {
    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === "/usr/bin/file") {
        return success(`${args[0]}: Mach-O 64-bit executable arm64`);
      }
      if (args[0] === "-l") {
        return success("cmd LC_BUILD_VERSION\n  minos 12.0\n");
      }
      return success(`${args[1]}:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)`);
    });
    const runCodesign = vi.fn((args: string[]) => {
      if (args[0] === "-dv") return success("", "flags=0x10000(runtime)");
      if (args[0] === "-d") return success("", "<plist><dict></dict></plist>");
      return success();
    });
    await afterSignMac(context(), {
      releaseMode: "developer-id",
      existsSync: () => true,
      lstatSync: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100755,
      }),
      realpathSync: (value: string) => value,
      runCommand,
      runCodesign,
    });
    expect(runCommand).toHaveBeenCalledTimes(3);
    expect(runCodesign).toHaveBeenCalledTimes(3);
    expect(runCodesign.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["--verify", "--strict"]),
    );
  });

  it("rejects helper entitlement and linked-library expansion", async () => {
    const dependencies = {
      releaseMode: "developer-id",
      existsSync: () => true,
      lstatSync: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100755,
      }),
      realpathSync: (value: string) => value,
      runCodesign: (args: string[]) => {
        if (args[0] === "-dv") return success("", "flags=0x10000(runtime)");
        if (args[0] === "-d") {
          return success("", "<plist><dict><key>com.apple.security.network.client</key><true/></dict></plist>");
        }
        return success();
      },
      runCommand: (_command: string, args: string[]) => {
        if (args.length === 1) return success("Mach-O 64-bit executable arm64");
        if (args[0] === "-l") return success("cmd LC_BUILD_VERSION\n minos 12.0");
        return success("helper:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)");
      },
    };
    await expect(afterSignMac(context(), dependencies))
      .rejects.toThrow("empty entitlement set");
    await expect(afterSignMac(context(), {
      ...dependencies,
      runCommand: (_command: string, args: string[]) => {
        if (args.length === 1) return success("Mach-O 64-bit executable arm64");
        if (args[0] === "-l") return success("cmd LC_BUILD_VERSION\n minos 12.0");
        return success("helper:\n\t/usr/local/lib/libInjected.dylib");
      },
    })).rejects.toThrow("unexpected libraries");
    await expect(afterSignMac(context(), {
      ...dependencies,
      runCodesign: (args: string[]) =>
        args[0] === "-d"
          ? success("", "<plist><dict></dict></plist>")
          : args[0] === "-dv"
            ? success("", "flags=0x2(adhoc)")
            : success(),
    })).rejects.toThrow("lacks hardened runtime");
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
      verifySafeFsHelper: () => {},
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
        verifySafeFsHelper: () => {},
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
        verifySafeFsHelper: () => {},
      }),
    ).rejects.toThrow("not stable");
  });
});
