import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProcessSandboxProvider,
  type ProcessSandboxPolicy,
} from "./processSandbox";

const provider = createProcessSandboxProvider();
const seatbeltUsable = provider.status().available;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.skipIf(!seatbeltUsable)("real macOS Seatbelt effects", () => {
  it("allows workspace writes and denies adjacent writes", async () => {
    const workspace = await homeTemp("zerox-seatbelt-workspace-");
    const outside = await homeTemp("zerox-seatbelt-outside-");

    const result = runConfined(
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

    const result = runConfined(
      `printf escaped > ${quote(path.join(workspace, "escape", "escaped.txt"))}`,
      policy(workspace, "workspace_write", "allow"),
    );

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(outside, "escaped.txt"))).toBe(false);
  });

  it("denies writes in read-only mode", async () => {
    const workspace = await homeTemp("zerox-seatbelt-readonly-");

    const result = runConfined(
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
    const result = spawnSync(
      confined.argv[0]!,
      [...confined.argv.slice(1)],
      { encoding: "utf8", timeout: 5_000 },
    );

    expect(result.status).toBe(7);
    expect(result.stderr).toContain("EPERM");
  });
});

function runConfined(command: string, sandboxPolicy: ProcessSandboxPolicy) {
  const confined = provider.confine(
    ["/bin/zsh", "-lc", command],
    sandboxPolicy,
  );
  return spawnSync(confined.argv[0]!, [...confined.argv.slice(1)], {
    encoding: "utf8",
    timeout: 5_000,
  });
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

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
