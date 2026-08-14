import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentRunContext,
  AgentSandboxMode,
} from "../shared/agentWorkspace";

export type ProcessSandboxNetwork = "none" | "allow";

export type ProcessSandboxPolicy = {
  mode: AgentSandboxMode;
  workspaceRoot: string;
  extraWriteRoots?: readonly string[];
  network: ProcessSandboxNetwork;
};

export type ProcessSandboxStatus = Readonly<{
  available: boolean;
  backend: "seatbelt" | "deny" | "unavailable";
  enforcement: "write-and-network-none" | "none";
  reason?: string;
}>;

export type ConfinedProcess = Readonly<{
  argv: readonly string[];
  backend: "seatbelt";
  enforcement: "write-and-network-none";
  denialSignatures: readonly string[];
  writableRoots: readonly string[];
  network: ProcessSandboxNetwork;
}>;

export type ProcessSandboxProvider = {
  status(): ProcessSandboxStatus;
  confine(
    argv: readonly string[],
    policy: ProcessSandboxPolicy,
  ): ConfinedProcess;
};

export class ProcessSandboxUnavailableError extends Error {
  readonly code = "PROCESS_SANDBOX_UNAVAILABLE";

  constructor(
    message: string,
    readonly backend: ProcessSandboxStatus["backend"],
  ) {
    super(message);
    this.name = "ProcessSandboxUnavailableError";
  }
}

export function createProcessSandboxProvider(options?: {
  mode?: "required" | "deny";
  platform?: NodeJS.Platform;
  sandboxExec?: string;
  probeTimeoutMs?: number;
  probe?: (sandboxExec: string, timeoutMs: number) => boolean;
}): ProcessSandboxProvider {
  const mode = options?.mode ?? "required";
  const platform = options?.platform ?? process.platform;
  const sandboxExec = options?.sandboxExec ?? "/usr/bin/sandbox-exec";
  const probeTimeoutMs = positiveTimeout(options?.probeTimeoutMs ?? 5_000);
  let cachedStatus: ProcessSandboxStatus | undefined;

  const resolveStatus = (): ProcessSandboxStatus => {
    if (cachedStatus) return cachedStatus;
    if (mode === "deny") {
      cachedStatus = Object.freeze({
        available: false,
        backend: "deny",
        enforcement: "none",
        reason: "Process execution is disabled by ZEROX_PROCESS_SANDBOX=deny.",
      });
      return cachedStatus;
    }
    if (platform !== "darwin") {
      cachedStatus = Object.freeze({
        available: false,
        backend: "unavailable",
        enforcement: "none",
        reason: `No reviewed process sandbox backend is available for ${platform}.`,
      });
      return cachedStatus;
    }

    const usable = (
      options?.probe ??
      ((executable, timeoutMs) => probeSeatbelt(executable, timeoutMs))
    )(sandboxExec, probeTimeoutMs);
    cachedStatus = usable
      ? Object.freeze({
          available: true,
          backend: "seatbelt",
          enforcement: "write-and-network-none",
        })
      : Object.freeze({
          available: false,
          backend: "unavailable",
          enforcement: "none",
          reason: "macOS Seatbelt rejected its functional probe.",
        });
    return cachedStatus;
  };

  return {
    status: resolveStatus,
    confine(argv, policy) {
      const status = resolveStatus();
      if (!status.available || status.backend !== "seatbelt") {
        throw new ProcessSandboxUnavailableError(
          status.reason ?? "Process sandbox is unavailable.",
          status.backend,
        );
      }
      if (argv.length === 0 || !argv[0]?.trim()) {
        throw new ProcessSandboxUnavailableError(
          "Process sandbox requires a non-empty argv.",
          status.backend,
        );
      }
      const writableRoots = deriveWritableRoots(policy);
      const profile = buildSeatbeltProfile({
        writableRoots,
        network: policy.network,
      });
      return Object.freeze({
        argv: Object.freeze([
          sandboxExec,
          "-p",
          profile,
          "--",
          ...argv.map(String),
        ]),
        backend: "seatbelt" as const,
        enforcement: "write-and-network-none" as const,
        denialSignatures: Object.freeze([
          "operation not permitted",
          "not permitted",
        ]),
        writableRoots: Object.freeze([...writableRoots]),
        network: policy.network,
      });
    },
  };
}

export function processSandboxPolicyFromRunContext(
  runContext: AgentRunContext,
): ProcessSandboxPolicy {
  return {
    mode: runContext.sandbox.mode,
    workspaceRoot: runContext.workspaceRoot,
    extraWriteRoots: runContext.sandbox.extraWriteRoots,
    network:
      runContext.sandbox.network === "none" ? "none" : "allow",
  };
}

export function buildSeatbeltProfile(input: {
  writableRoots: readonly string[];
  network: ProcessSandboxNetwork;
}): string {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal ${sbplString("/dev/null")}))`,
  ];
  if (input.writableRoots.length > 0) {
    forms.push(
      `(allow file-write* ${input.writableRoots
        .map((root) => `(subpath ${sbplString(root)})`)
        .join(" ")})`,
    );
  }
  if (input.network === "none") {
    forms.push("(deny network*)");
  }
  return forms.join(" ");
}

export function isProcessSandboxUnavailableError(
  error: unknown,
): error is ProcessSandboxUnavailableError {
  return (
    error instanceof ProcessSandboxUnavailableError ||
    (error instanceof Error &&
      (error as Error & { code?: unknown }).code ===
        "PROCESS_SANDBOX_UNAVAILABLE")
  );
}

function deriveWritableRoots(policy: ProcessSandboxPolicy): string[] {
  if (policy.mode === "read_only") return [];
  const requested = [
    policy.workspaceRoot,
    ...(policy.extraWriteRoots ?? []),
    "/tmp",
    tmpdir(),
  ];
  return [...new Set(requested.map(canonicalExistingRoot))];
}

function canonicalExistingRoot(root: string): string {
  const normalized = path.resolve(String(root));
  try {
    return realpathSync.native(normalized);
  } catch {
    throw new ProcessSandboxUnavailableError(
      `Process sandbox writable root does not exist or cannot be resolved: ${normalized}`,
      "seatbelt",
    );
  }
}

function probeSeatbelt(sandboxExec: string, timeoutMs: number): boolean {
  const profile = buildSeatbeltProfile({
    writableRoots: [],
    network: "allow",
  });
  const result = spawnSync(
    sandboxExec,
    ["-p", profile, "--", "/usr/bin/true"],
    {
      timeout: timeoutMs,
      stdio: "ignore",
    },
  );
  return result.status === 0;
}

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Process sandbox probe timeout must be positive.");
  }
  return Math.floor(value);
}

function sbplString(value: string): string {
  return `"${value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.raw`\"`)}"`;
}
