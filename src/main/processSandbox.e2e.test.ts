import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProcessSandboxProvider,
  type ProcessSandboxPolicy,
} from "./processSandbox";
import { runOwnedProcess } from "./ownedProcess";

const provider = createProcessSandboxProvider();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform !== "darwin")("real macOS Seatbelt effects", () => {
  it("keeps the production provider functional with deny-by-default reads", () => {
    expect(provider.status()).toMatchObject({
      available: true,
      backend: "seatbelt",
      enforcement: "read-write-and-network-policy",
    });
  });

  it("allows workspace writes and denies adjacent writes", async () => {
    const workspace = await homeTemp("zerox-seatbelt-workspace-");
    const outside = await homeTemp("zerox-seatbelt-outside-");

    const result = await runConfined(
      `printf inside > ${quote(path.join(workspace, "inside.txt"))}; ` +
        `printf outside > ${quote(path.join(outside, "outside.txt"))}`,
      policy(workspace, "workspace_write", "allow"),
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(workspace, "inside.txt"), "utf8")).toBe(
      "inside",
    );
    expect(existsSync(path.join(outside, "outside.txt"))).toBe(false);
    expect(result.stderr.toLowerCase()).toContain("operation not permitted");
  });

  it("denies writes through a workspace symlink to an outside root", async () => {
    const workspace = await homeTemp("zerox-seatbelt-symlink-workspace-");
    const outside = await homeTemp("zerox-seatbelt-symlink-outside-");
    await symlink(outside, path.join(workspace, "escape"));

    const result = await runConfined(
      `printf escaped > ${quote(path.join(workspace, "escape", "escaped.txt"))}`,
      policy(workspace, "workspace_write", "allow"),
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(outside, "escaped.txt"))).toBe(false);
  });

  it("allows declared reads and denies adjacent user-file reads", async () => {
    const workspace = await homeTemp("zerox-seatbelt-read-workspace-");
    const outside = await homeTemp("zerox-seatbelt-read-outside-");
    const insidePath = path.join(workspace, "inside.txt");
    const outsidePath = path.join(outside, "secret.txt");
    await import("node:fs/promises").then(({ writeFile }) =>
      Promise.all([
        writeFile(insidePath, "inside", "utf8"),
        writeFile(outsidePath, "outside-secret", "utf8"),
      ]),
    );

    const result = await runConfined(
      `cat ${quote(insidePath)}; cat ${quote(outsidePath)}`,
      policy(workspace, "read_only", "none"),
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("inside");
    expect(result.stdout).not.toContain("outside-secret");
    expect(result.stderr.toLowerCase()).toContain("operation not permitted");
  });

  it("denies an undeclared sibling secret in the global temporary directory", async () => {
    const workspace = await homeTemp("zerox-seatbelt-tmp-workspace-");
    const sibling = await globalTemp("zerox-seatbelt-sibling-");
    const secretPath = path.join(sibling, "secret.txt");
    await writeFile(secretPath, "sibling-secret", "utf8");

    const intrusionPath = path.join(sibling, "intrusion.txt");
    const confined = provider.confine(
      [
        "/bin/zsh",
        "-lc",
        `/bin/cat ${quote(secretPath)}; printf intrusion > ${quote(intrusionPath)}`,
      ],
      policy(workspace, "read_only", "none"),
    );
    try {
      const result = spawnSync(
        confined.argv[0]!,
        [...confined.argv.slice(1)],
        { encoding: "utf8", timeout: 5_000 },
      );

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("sibling-secret");
      expect(result.stderr.toLowerCase()).toContain("operation not permitted");
      expect(existsSync(intrusionPath)).toBe(false);
      expect(confined.readableRoots).not.toContain(
        await import("node:fs/promises").then(({ realpath }) =>
          realpath(os.tmpdir()),
        ),
      );
    } finally {
      await confined.cleanup();
    }
  });

  it("uses and removes its own private temporary directory", async () => {
    const workspace = await homeTemp("zerox-seatbelt-own-temp-workspace-");
    const confined = provider.confine(
      [
        "/bin/zsh",
        "-lc",
        'printf private > "$TMPDIR/own.txt"; /bin/cat "$TMPDIR/own.txt"',
      ],
      policy(workspace, "read_only", "none"),
    );
    const privateTempDir = confined.privateTempDir;
    const result = spawnSync(
      confined.argv[0]!,
      [...confined.argv.slice(1)],
      {
        encoding: "utf8",
        timeout: 5_000,
        env: confined.buildChildEnv(process.env),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("private");
    expect(readFileSync(path.join(privateTempDir, "own.txt"), "utf8")).toBe(
      "private",
    );
    await confined.cleanup();
    await expect(access(privateTempDir)).rejects.toThrow();
  });

  it("denies reads from another sandbox instance private temp", async () => {
    const workspace = await homeTemp("zerox-seatbelt-cross-temp-workspace-");
    const first = provider.confine(
      ["/usr/bin/true"],
      policy(workspace, "read_only", "none"),
    );
    const second = provider.confine(
      ["/bin/cat", path.join(first.privateTempDir, "secret.txt")],
      policy(workspace, "read_only", "none"),
    );
    await writeFile(
      path.join(first.privateTempDir, "secret.txt"),
      "other-private-secret",
      "utf8",
    );

    try {
      const result = spawnSync(
        second.argv[0]!,
        [...second.argv.slice(1)],
        {
          encoding: "utf8",
          timeout: 5_000,
          env: second.buildChildEnv(process.env),
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("other-private-secret");
      expect(result.stderr.toLowerCase()).toContain(
        "operation not permitted",
      );
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });

  it("isolates concurrent same-user lease reads and writes", async () => {
    const workspace = await homeTemp("zerox-seatbelt-concurrent-workspace-");
    const first = provider.confine(
      [
        "/bin/zsh",
        "-lc",
        'printf concurrent-secret > "$TMPDIR/secret.txt"; sleep 5',
      ],
      policy(workspace, "read_only", "none"),
    );
    const firstExecution = runOwnedProcess({
      command: first.argv[0]!,
      args: first.argv.slice(1),
      env: first.buildChildEnv(process.env),
      timeoutMs: 1_000,
      maxOutputBytes: 16_384,
    });
    const secretPath = path.join(first.privateTempDir, "secret.txt");
    const intrusionPath = path.join(first.privateTempDir, "intrusion.txt");
    await waitForPath(secretPath);

    const second = provider.confine(
      [
        "/bin/zsh",
        "-lc",
        `/bin/cat ${quote(secretPath)}; printf intrusion > ${quote(intrusionPath)}`,
      ],
      policy(workspace, "read_only", "none"),
    );
    try {
      const result = spawnSync(
        second.argv[0]!,
        [...second.argv.slice(1)],
        {
          encoding: "utf8",
          timeout: 5_000,
          env: second.buildChildEnv(process.env),
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("concurrent-secret");
      expect(result.stderr.toLowerCase()).toContain(
        "operation not permitted",
      );
      expect(existsSync(intrusionPath)).toBe(false);
      expect(readFileSync(secretPath, "utf8")).toBe("concurrent-secret");
    } finally {
      await firstExecution;
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });

  it("denies writes in read-only mode", async () => {
    const workspace = await homeTemp("zerox-seatbelt-readonly-");

    const result = await runConfined(
      `printf denied > ${quote(path.join(workspace, "denied.txt"))}`,
      policy(workspace, "read_only", "allow"),
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(workspace, "denied.txt"))).toBe(false);
  });

  it("denies network connect when policy is none", async () => {
    const workspace = await homeTemp("zerox-seatbelt-network-");
    const childScript = [
      'const net = require("node:net");',
      'const socket = net.connect(9, "127.0.0.1", () => process.exit(0));',
      'socket.on("error", error => {',
      '  console.error(`${error.code}:${error.message}`);',
      '  process.exit(error.code === "EPERM" ? 7 : 8);',
      "});",
      "setTimeout(() => process.exit(9), 1000);",
    ].join("\n");
    const confined = provider.confine(
      [process.execPath, "-e", childScript],
      policy(workspace, "read_only", "none"),
    );
    try {
      const result = spawnSync(
        confined.argv[0]!,
        [...confined.argv.slice(1)],
        {
          encoding: "utf8",
          timeout: 5_000,
          env: confined.buildChildEnv(process.env),
        },
      );

      expect(result.status).toBe(7);
      expect(result.stderr).toContain("EPERM");
    } finally {
      await confined.cleanup();
    }
  });
});

async function runConfined(
  command: string,
  sandboxPolicy: ProcessSandboxPolicy,
) {
  const confined = provider.confine(
    ["/bin/zsh", "-lc", command],
    sandboxPolicy,
  );
  try {
    return spawnSync(confined.argv[0]!, [...confined.argv.slice(1)], {
      encoding: "utf8",
      timeout: 5_000,
      env: confined.buildChildEnv(process.env),
    });
  } finally {
    await confined.cleanup();
  }
}

function policy(
  workspaceRoot: string,
  mode: ProcessSandboxPolicy["mode"],
  network: ProcessSandboxPolicy["network"],
): ProcessSandboxPolicy {
  return { workspaceRoot, mode, network };
}

async function homeTemp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.homedir(), `.${prefix}`));
  roots.push(root);
  return root;
}

async function globalTemp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function waitForPath(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(filePath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(filePath)) {
    throw new Error(`Timed out waiting for ${filePath}.`);
  }
}
