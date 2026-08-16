import {
  access,
  lstat,
  mkdtemp,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  buildMinimalProcessEnv,
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
        confined.privateTempDir,
      ]),
    );
    expect(confined.writableRoots).not.toContain(
      await canonical(os.tmpdir()),
    );
    expect(confined.readableRoots).not.toContain(
      await canonical(os.tmpdir()),
    );
    expect((await lstat(confined.privateTempDir)).mode & 0o777).toBe(0o700);
    expect(confined.argv[2]).toContain("(deny default)");
    expect(confined.argv[2]).toContain('(import "system.sb")');
    expect(confined.argv[2]).not.toContain("(allow network*)");
    await confined.cleanup();
    await expect(access(confined.privateTempDir)).rejects.toThrow();
  });

  it("maps read-only context to only its private writable temp", async () => {
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

    expect(confined.writableRoots).toEqual([confined.privateTempDir]);
    expect(confined.readableRoots).toContain(await canonical(workspace));
    expect(confined.readableRoots).toContain(confined.privateTempDir);
    expect(confined.readableRoots).not.toContain(
      await canonical(os.tmpdir()),
    );
    expect(confined.argv[2]).toContain("(deny default)");
    expect(confined.argv[2]).toContain(
      `(subpath "${await canonical(workspace)}")`,
    );
    expect(confined.argv[2]).not.toContain("(allow network*)");
    await confined.cleanup();
  });

  it("does not derive process network access from web-tool policy", async () => {
    const workspace = await tempDir("zerox-sandbox-network-split-");
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: workspace,
    });

    expect(processSandboxPolicyFromRunContext(runContext)).toMatchObject({
      network: "none",
      extraReadRoots: [],
    });
    expect(
      processSandboxPolicyFromRunContext(runContext, { network: "allow" }),
    ).toMatchObject({ network: "allow" });
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
    });
    const confined = provider.confine(
      ["/bin/zsh", "-lc", "true"],
      processSandboxPolicyFromRunContext(runContext, { network: "allow" }),
    );
    expect(confined.argv[2]).toContain("(allow network*)");
    await confined.cleanup();
  });

  it("binds the private temp environment to the provider-issued lease", async () => {
    const workspace = await tempDir("zerox-sandbox-env-workspace-");
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
    });
    const confined = provider.confine(["/usr/bin/true"], {
      mode: "read_only",
      workspaceRoot: workspace,
      network: "none",
    });

    expect(
      buildMinimalProcessEnv(
        {
          HOME: "/Users/demo",
          LANG: "en_US.UTF-8",
          PATH: "/usr/bin:/bin",
          OPENAI_API_KEY: "parent-secret",
          GITHUB_TOKEN: "parent-token",
          TMPDIR: "/parent/tmp",
        },
        {
          EXPLICIT_SETTING: "allowed",
        },
      ),
    ).toEqual({
      HOME: "/Users/demo",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      EXPLICIT_SETTING: "allowed",
    });
    expect(
      confined.buildChildEnv(
        {
          HOME: "/Users/demo",
          LANG: "en_US.UTF-8",
          PATH: "/usr/bin:/bin",
          OPENAI_API_KEY: "parent-secret",
          TMPDIR: "/parent/tmp",
        },
        {
          EXPLICIT_SETTING: "allowed",
          TMPDIR: "/configured/tmpdir",
          TMP: "/configured/tmp",
          TEMP: "/configured/temp",
        },
      ),
    ).toEqual({
      HOME: "/Users/demo",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      EXPLICIT_SETTING: "allowed",
      TMPDIR: confined.privateTempDir,
      TMP: confined.privateTempDir,
      TEMP: confined.privateTempDir,
    });
    await confined.cleanup();
  });

  it("creates unique canonical private temps without granting their parent", async () => {
    const workspace = await tempDir("zerox-sandbox-unique-workspace-");
    const tempRoot = await tempDir("zerox-sandbox-private-parent-");
    const aliasRoot = await tempDir("zerox-sandbox-private-alias-");
    const alias = path.join(aliasRoot, "temp-link");
    await symlink(tempRoot, alias);
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
      tempRoot: alias,
    });

    const first = provider.confine(["/usr/bin/true"], {
      mode: "read_only",
      workspaceRoot: workspace,
      network: "none",
    });
    const second = provider.confine(["/usr/bin/true"], {
      mode: "read_only",
      workspaceRoot: workspace,
      network: "none",
    });
    const canonicalTempRoot = await canonical(tempRoot);

    expect(first.privateTempDir).not.toBe(second.privateTempDir);
    expect(path.basename(first.privateTempDir)).toMatch(
      /^zerox-process-sandbox-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(path.dirname(first.privateTempDir)).toBe(canonicalTempRoot);
    expect(path.dirname(second.privateTempDir)).toBe(canonicalTempRoot);
    expect(first.readableRoots).not.toContain(canonicalTempRoot);
    expect(first.writableRoots).not.toContain(canonicalTempRoot);
    expect(first.argv[2]).not.toContain(
      `(subpath "${canonicalTempRoot}")`,
    );
    expect(first.argv[2]).toContain(
      `(literal "${canonicalTempRoot}")`,
    );
    expect(first.argv[2]).not.toContain(`(subpath "${alias}")`);

    await first.cleanup();
    await first.cleanup();
    await second.cleanup();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("refuses missing writable roots instead of widening policy", async () => {
    const workspace = await tempDir("zerox-sandbox-existing-");
    const tempRoot = await tempDir("zerox-sandbox-failed-private-");
    const provider = createProcessSandboxProvider({
      platform: "darwin",
      probe: () => true,
      tempRoot,
    });

    expect(() =>
      provider.confine(["/bin/zsh", "-lc", "true"], {
        mode: "workspace_write",
        workspaceRoot: workspace,
        extraWriteRoots: [path.join(workspace, "missing")],
        network: "allow",
      }),
    ).toThrow("root does not exist");
    expect(await readdir(tempRoot)).toEqual([]);
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
