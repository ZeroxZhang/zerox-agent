import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { rm } from "node:fs/promises";
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
  extraReadRoots?: readonly string[];
  extraWriteRoots?: readonly string[];
  network: ProcessSandboxNetwork;
};

export type ProcessSandboxStatus = Readonly<{
  available: boolean;
  backend: "seatbelt" | "deny" | "unavailable";
  enforcement: "read-write-and-network-policy" | "none";
  reason?: string;
}>;

export type ConfinedProcess = Readonly<{
  argv: readonly string[];
  backend: "seatbelt";
  enforcement: "read-write-and-network-policy";
  denialSignatures: readonly string[];
  readableRoots: readonly string[];
  writableRoots: readonly string[];
  network: ProcessSandboxNetwork;
  privateTempDir: string;
  buildChildEnv(
    parentEnv: NodeJS.ProcessEnv,
    configuredEnv?: Record<string, string>,
  ): NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
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

const PROCESS_CHILD_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "SHELL",
  "USER",
] as const;

const PRIVATE_TEMP_ENV_KEYS = new Set(["TMPDIR", "TMP", "TEMP"]);

const SYSTEM_PROCESS_READ_ROOTS = [
  "/System",
  "/Library/Apple",
  "/bin",
  "/sbin",
  "/usr",
  "/opt/homebrew",
  "/usr/local",
  "/dev",
  "/private/etc",
  "/private/var/db",
] as const;

export function buildMinimalProcessEnv(
  parentEnv: NodeJS.ProcessEnv,
  configuredEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of PROCESS_CHILD_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  for (const [key, value] of Object.entries(configuredEnv)) {
    if (!PRIVATE_TEMP_ENV_KEYS.has(key)) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}

export function createProcessSandboxProvider(options?: {
  mode?: "required" | "deny";
  platform?: NodeJS.Platform;
  sandboxExec?: string;
  probeTimeoutMs?: number;
  probe?: (sandboxExec: string, timeoutMs: number) => boolean;
  tempRoot?: string;
}): ProcessSandboxProvider {
  const mode = options?.mode ?? "required";
  const platform = options?.platform ?? process.platform;
  const sandboxExec = options?.sandboxExec ?? "/usr/bin/sandbox-exec";
  const tempRoot = options?.tempRoot ?? tmpdir();
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
          enforcement: "read-write-and-network-policy",
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
      let privateTempDir: string | undefined;
      try {
        privateTempDir = createPrivateTempDirectory(tempRoot);
        const leaseTempDir = privateTempDir;
        const writableRoots = deriveWritableRoots(policy, leaseTempDir);
        const readableRoots = deriveReadableRoots(policy, writableRoots);
        const profile = buildSeatbeltProfile({
          readableRoots,
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
          enforcement: "read-write-and-network-policy" as const,
          denialSignatures: Object.freeze([
            "operation not permitted",
            "not permitted",
          ]),
          readableRoots: Object.freeze([...readableRoots]),
          writableRoots: Object.freeze([...writableRoots]),
          network: policy.network,
          privateTempDir: leaseTempDir,
          buildChildEnv: (
            parentEnv: NodeJS.ProcessEnv,
            configuredEnv: Record<string, string> = {},
          ) =>
            buildPrivateTempProcessEnv(
              parentEnv,
              configuredEnv,
              leaseTempDir,
            ),
          cleanup: createPrivateTempCleanup(leaseTempDir),
        });
      } catch (error) {
        if (privateTempDir) {
          removePrivateTempPreservingError(privateTempDir);
        }
        if (isProcessSandboxUnavailableError(error)) {
          throw error;
        }
        throw new ProcessSandboxUnavailableError(
          `Process sandbox could not create an isolated temporary directory: ${
            error instanceof Error ? error.message : String(error)
          }`,
          status.backend,
        );
      }
    },
  };
}

export function processSandboxPolicyFromRunContext(
  runContext: AgentRunContext,
  options?: { network?: ProcessSandboxNetwork },
): ProcessSandboxPolicy {
  return {
    mode: runContext.sandbox.mode,
    workspaceRoot: runContext.workspaceRoot,
    extraReadRoots: runContext.sandbox.extraReadRoots,
    extraWriteRoots: runContext.sandbox.extraWriteRoots,
    network: options?.network ?? "none",
  };
}

export function buildSeatbeltProfile(input: {
  readableRoots?: readonly string[];
  writableRoots: readonly string[];
  network: ProcessSandboxNetwork;
}): string {
  const forms = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    `(allow file-read* (literal ${sbplString("/dev/null")}))`,
    `(allow file-write* (literal ${sbplString("/dev/null")}))`,
  ];
  if (input.readableRoots && input.readableRoots.length > 0) {
    const traversalRoots = deriveTraversalRoots(input.readableRoots);
    if (traversalRoots.length > 0) {
      forms.push(
        `(allow file-read-metadata file-test-existence ${traversalRoots
          .map((root) => `(literal ${sbplString(root)})`)
          .join(" ")})`,
      );
    }
    forms.push(
      `(allow file-read* file-test-existence ${input.readableRoots
        .map((root) => `(subpath ${sbplString(root)})`)
        .join(" ")})`,
    );
  }
  if (input.writableRoots.length > 0) {
    forms.push(
      `(allow file-write* ${input.writableRoots
        .map((root) => `(subpath ${sbplString(root)})`)
        .join(" ")})`,
    );
  }
  if (input.network === "allow") {
    forms.push("(allow network*)");
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

function deriveWritableRoots(
  policy: ProcessSandboxPolicy,
  privateTempDir: string,
): string[] {
  const requested = policy.mode === "read_only"
    ? [privateTempDir]
    : [
        privateTempDir,
        policy.workspaceRoot,
        ...(policy.extraWriteRoots ?? []),
      ];
  return [...new Set(requested.map(canonicalExistingRoot))];
}

function deriveReadableRoots(
  policy: ProcessSandboxPolicy,
  writableRoots: readonly string[],
): string[] {
  const declaredRoots = [
    policy.workspaceRoot,
    ...(policy.extraReadRoots ?? []),
    ...(policy.extraWriteRoots ?? []),
  ].map(canonicalExistingRoot);
  const systemRoots = SYSTEM_PROCESS_READ_ROOTS
    .filter((root) => existsSync(root))
    .map(canonicalExistingRoot);
  return [
    ...new Set([
      ...declaredRoots,
      ...writableRoots,
      ...systemRoots,
      ...deriveRuntimeReadRoots(),
    ]),
  ];
}

function canonicalExistingRoot(root: string): string {
  const normalized = path.resolve(String(root));
  try {
    return realpathSync.native(normalized);
  } catch {
    throw new ProcessSandboxUnavailableError(
      `Process sandbox root does not exist or cannot be resolved: ${normalized}`,
      "seatbelt",
    );
  }
}

function probeSeatbelt(sandboxExec: string, timeoutMs: number): boolean {
  const probeReadRoots = SYSTEM_PROCESS_READ_ROOTS
    .filter((root) => existsSync(root))
    .map(canonicalExistingRoot);
  const profile = buildSeatbeltProfile({
    readableRoots: [...new Set([...probeReadRoots, ...deriveRuntimeReadRoots()])],
    writableRoots: [],
    network: "none",
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

function createPrivateTempDirectory(tempRoot: string): string {
  const canonicalTempRoot = canonicalExistingRoot(tempRoot);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const created = path.join(
      canonicalTempRoot,
      `zerox-process-sandbox-${randomUUID()}`,
    );
    try {
      mkdirSync(created, { mode: 0o700 });
      try {
        chmodSync(created, 0o700);
        const metadata = lstatSync(created);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error("private temporary path is not a real directory");
        }
        const canonicalCreated = realpathSync.native(created);
        const relative = path.relative(canonicalTempRoot, canonicalCreated);
        if (
          !relative ||
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative)
        ) {
          throw new Error("private temporary path escaped its creation root");
        }
        return canonicalCreated;
      } catch (error) {
        removePrivateTempPreservingError(created);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("private temporary directory name allocation was exhausted");
}

function createPrivateTempCleanup(
  privateTempDir: string,
): () => Promise<void> {
  let cleanup: Promise<void> | undefined;
  return () => {
    cleanup ??= rm(privateTempDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 10,
    });
    return cleanup;
  };
}

function removePrivateTempPreservingError(privateTempDir: string): void {
  try {
    rmSync(privateTempDir, { recursive: true, force: true });
  } catch {
    // Setup failures retain their original error.
  }
}

function buildPrivateTempProcessEnv(
  parentEnv: NodeJS.ProcessEnv,
  configuredEnv: Record<string, string>,
  privateTempDir: string,
): NodeJS.ProcessEnv {
  return {
    ...buildMinimalProcessEnv(parentEnv, configuredEnv),
    TMPDIR: privateTempDir,
    TMP: privateTempDir,
    TEMP: privateTempDir,
  };
}

function deriveTraversalRoots(roots: readonly string[]): string[] {
  const traversalRoots = new Set<string>();
  for (const root of roots) {
    let current = path.dirname(root);
    while (current !== path.dirname(current)) {
      traversalRoots.add(current);
      current = path.dirname(current);
    }
  }
  return [...traversalRoots];
}

function deriveRuntimeReadRoots(): string[] {
  const executables = [
    process.execPath,
    resolveExecutableFromPath("node", process.env.PATH),
  ].filter(
    (value): value is string =>
      typeof value === "string" && existsSync(value),
  );
  return [
    ...new Set(
      executables.map((executable) => {
        const canonicalExecutable = realpathSync.native(executable);
        const executableDirectory = path.dirname(canonicalExecutable);
        return path.basename(executableDirectory) === "bin"
          ? path.dirname(executableDirectory)
          : executableDirectory;
      }),
    ),
  ];
}

function resolveExecutableFromPath(
  executable: string,
  pathValue: string | undefined,
): string | null {
  for (const directory of (pathValue ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, executable);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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
