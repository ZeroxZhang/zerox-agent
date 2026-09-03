import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_IPC_CHANNELS, IPC_CHANNELS } from "./ipcChannels";

const ROOT = process.cwd();
const REGISTRY_VALUES: Set<string> = new Set([
  ...Object.values(IPC_CHANNELS),
  ...Object.values(ALL_IPC_CHANNELS),
]);

// Mirrors the extraction used to build the registry: channel literals on
// lines that register, invoke, or broadcast over IPC.
const CTX =
  /handleTrustedIpc|ipcMain\.(handle|on|removeHandler)|webContents\.send|ipcRenderer\.(invoke|on|send|removeListener)|safeSend|sendToRenderers/;

function scanSources(): string[] {
  const found = new Set<string>();
  for (const relative of listTypeScriptSources()) {
    const lines = readFileSync(path.join(ROOT, relative), "utf8").split("\n");
    for (const line of lines) {
      if (!CTX.test(line)) continue;
      const re = /"([a-zA-Z][a-zA-Z0-9]*:[a-zA-Z0-9:]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) found.add(match[1]);
    }
  }
  return [...found].sort();
}

function listTypeScriptSources(): string[] {
  const out = execFileSync(
    "/usr/bin/find",
    ["src/main", "src/preload", "-name", "*.ts", "!", "-name", "*.test.ts"],
    { encoding: "utf8" },
  );
  return out.trim().split("\n").filter(Boolean);
}

describe("IPC channel single registry", () => {
  it("registers every channel literal used in main/preload sources", () => {
    const used = scanSources();
    const unregistered = used.filter((channel) => !REGISTRY_VALUES.has(channel));
    expect(unregistered).toEqual([]);
  });

  it("keeps registry values unique and keyed deterministically", () => {
    const all = { ...IPC_CHANNELS, ...ALL_IPC_CHANNELS };
    const values = Object.values(all);
    expect(new Set(values).size).toBe(values.length);
    const keys = Object.keys(all);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => /^[a-z][a-zA-Z0-9]*$/.test(key))).toBe(true);
    expect(values.length).toBeGreaterThan(100);
  });
});
