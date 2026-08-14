import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  buildSeatbeltProfile,
  createProcessSandboxProvider,
  processSandboxPolicyFromRunContext,
} from "./processSandbox";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ProcessSandboxProvider", () => {
  it("fails closed in deny mode without probing", () => {
    const probe = vi.fn(() => true);
    const provider = createProcessSandboxProvider({
      mode: "deny",
      platform: "darwin",
      probe,
    });

    expect(provider.status()).toMatchObject({
      available: false,
      backend: "deny",
    });
    expect(() =>
      provider.confine(["/bin/zsh", "-lc", "echo hi"], {
        mode: "read_only",
        workspaceRoot: "/",
        network: "none",
      }),
    ).toThrow("ZEROX_PROCESS_SANDBOX=deny");
    expect(probe).not.toHaveBeenCalled();
  });

  it("fails closed on platforms without a reviewed backend", () => {
    const provider = createProcessSandboxProvider({
      platform: "linux",
      probe: () => true,
    });

    expect(provider.status()).toMatchObject({
      available: false,
      backend: "unavailable",
    });
    expect(() =>
      provider.confine(["/bin/sh", "-c", "true"], {
        mode: "workspace_write",
        workspaceRoot: "/tmp",
        network: "allow",
      }),
    ).toThrow("No reviewed process sandbox backend");
  });

  it("probes once and wraps argv with canonical writable roots", async () => {
    const workspace = await tempDir("zerox-sandbox-workspace-");
    const extra = await tempDir("zerox-sandbox-extra-");
    const probe = vi.fn(() => true);
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      sandboxExec: "/custom/sandbox-exec",
      probe,
    });

    const confined = provider.confine(
      ["/bin/zsh", "-lc", "printf ok"],
      {
        mode: "workspace_write",
        workspaceRoot: workspace,
        extraWriteRoots: [extra],
        network: "none",
      },
    );
    provider.status();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(confined.argv.slice(0, 2)).toEqual([
      "/custom/sandbox-exec",
      "-p",
    ]);
    expect(confined.argv.slice(-4)).toEqual([
      "--",
      "/bin/zsh",
      "-lc",
      "printf ok",
    ]);
    expect(confined.writableRoots).toEqual(
      expect.arrayContaining([
        await canonical(workspace),
        await canonical(extra),
        await canonical(os.tmpdir()),
      ]),
    );
    expect(confined.argv[2]).toContain("(deny file-write*)");
    expect(confined.argv[2]).toContain("(deny network*)");
  });

  it("maps read-only context to zero writable roots", async () => {
    const workspace = await tempDir("zerox-sandbox-readonly-");
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
    });
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: workspace,
      sandbox: {
        mode: "read_only",
        network: "none",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
    });

    const confined = provider.confine(
      ["/bin/zsh", "-lc", "pwd"],
      processSandboxPolicyFromRunContext(runContext),
    );

    expect(confined.writableRoots).toEqual([]);
    expect(confined.argv[2]).not.toContain("(subpath");
    expect(confined.argv[2]).toContain("(deny network*)");
  });

  it("refuses missing writable roots instead of widening policy", async () => {
    const workspace = await tempDir("zerox-sandbox-existing-");
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
    });

    expect(() =>
      provider.confine(["/bin/zsh", "-lc", "true"], {
        mode: "workspace_write",
        workspaceRoot: workspace,
        extraWriteRoots: [path.join(workspace, "missing")],
        network: "allow",
      }),
    ).toThrow("writable root does not exist");
  });

  it("escapes SBPL string literals", () => {
    const profile = buildSeatbeltProfile({
      writableRoots: ['/tmp/a"b\\c'],
      network: "allow",
    });

    expect(profile).toContain(String.raw`(subpath "/tmp/a\"b\\c")`);
  });
});

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function canonical(root: string): Promise<string> {
  return import("node:fs/promises").then(({ realpath }) => realpath(root));
}
