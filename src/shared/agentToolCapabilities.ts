import type { TaskDomain } from "./agentTaskStrategy";

export type ToolSideEffect =
  | "none"
  | "local_read"
  | "local_write"
  | "destructive"
  | "external";

export type ToolConcurrencyMode = "parallel" | "exclusive";

export type ToolCapability = {
  name: string;
  domain: string;
  sideEffect: ToolSideEffect;
  concurrency: ToolConcurrencyMode;
  supportsBatch: boolean;
  supportsRecursive: boolean;
  resultSizeRisk: "low" | "medium" | "high";
  platformSensitivity: "none" | "macos" | "linux" | "windows" | "shell_specific";
  requiresConfirmation: boolean;
  preferredFor: string[];
  antiPatterns: string[];
};

export type NativeToolPreference = {
  preferredToolName: string;
  reason: string;
};

const capabilityDefinitions: Array<Omit<ToolCapability, "concurrency">> = [
  {
    name: "file_stat",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:stat"],
    antiPatterns: [],
  },
  {
    name: "file_list",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:list_shallow"],
    antiPatterns: ["recursive_inventory", "large_tree_scan"],
  },
  {
    name: "file_search",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: true,
    supportsRecursive: true,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:search", "files:recursive_discovery"],
    antiPatterns: [],
  },
  {
    name: "file_inventory",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: true,
    supportsRecursive: true,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:inventory", "files:recursive_discovery"],
    antiPatterns: [],
  },
  {
    name: "file_move_plan",
    domain: "files",
    sideEffect: "none",
    supportsBatch: true,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:plan_moves"],
    antiPatterns: ["unreviewed_state_change"],
  },
  {
    name: "file_apply_moves",
    domain: "files",
    sideEffect: "local_write",
    supportsBatch: true,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: true,
    preferredFor: ["files:apply_moves"],
    antiPatterns: ["missing_preview", "missing_transaction_log"],
  },
  {
    name: "file_verify_moves",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: true,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:verify_moves"],
    antiPatterns: [],
  },
  {
    name: "file_rollback_moves",
    domain: "files",
    sideEffect: "local_write",
    supportsBatch: true,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: true,
    preferredFor: ["files:rollback_moves"],
    antiPatterns: ["missing_transaction_log"],
  },
  {
    name: "file_read",
    domain: "files",
    sideEffect: "local_read",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "high",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["files:read_single"],
    antiPatterns: ["bulk_read", "offload_loop"],
  },
  {
    name: "file_write",
    domain: "files",
    sideEffect: "local_write",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "low",
    platformSensitivity: "none",
    requiresConfirmation: true,
    preferredFor: ["files:write_artifact"],
    antiPatterns: ["unreviewed_state_change"],
  },
  {
    name: "chrome_bookmarks_read",
    domain: "browser",
    sideEffect: "local_write",
    supportsBatch: true,
    supportsRecursive: true,
    resultSizeRisk: "medium",
    platformSensitivity: "macos",
    requiresConfirmation: true,
    preferredFor: ["browser:chrome_bookmarks"],
    antiPatterns: ["manual_bookmarks_json_parse", "script_generated_parser"],
  },
  {
    name: "test_run",
    domain: "code",
    sideEffect: "none",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["code:test"],
    antiPatterns: [],
  },
  {
    name: "code_search",
    domain: "code",
    sideEffect: "local_read",
    supportsBatch: true,
    supportsRecursive: true,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["code:search"],
    antiPatterns: [],
  },
  {
    name: "web_fetch",
    domain: "web",
    sideEffect: "external",
    supportsBatch: false,
    supportsRecursive: false,
    resultSizeRisk: "medium",
    platformSensitivity: "none",
    requiresConfirmation: false,
    preferredFor: ["web:fetch"],
    antiPatterns: ["uncited_research_fact"],
  },
  {
    name: "shell_exec",
    domain: "system",
    sideEffect: "destructive",
    supportsBatch: true,
    supportsRecursive: true,
    resultSizeRisk: "high",
    platformSensitivity: "shell_specific",
    requiresConfirmation: true,
    preferredFor: ["system:advanced"],
    antiPatterns: [
      "platform_trial_and_error",
      "native_tool_available",
      "unreviewed_state_change",
    ],
  },
];

const PARALLEL_TOOL_OPT_INS = new Set([
  "file_stat",
  "file_list",
  "file_search",
  "file_inventory",
  "file_move_plan",
  "file_verify_moves",
  "file_read",
  "code_search",
  "web_fetch",
]);

const capabilities: ToolCapability[] = capabilityDefinitions.map(
  (capability) => ({
    ...capability,
    concurrency: PARALLEL_TOOL_OPT_INS.has(capability.name)
      ? "parallel"
      : "exclusive",
  }),
);

const registry = new Map(capabilities.map((capability) => [capability.name, capability]));

export function getToolCapabilityRegistry(): ReadonlyMap<string, ToolCapability> {
  return registry;
}

export function getToolCapability(name: string): ToolCapability | undefined {
  return registry.get(name);
}

export function getToolConcurrencyMode(
  name: string,
  args: unknown,
  source: string | null = null,
): ToolConcurrencyMode {
  if (!isRecord(args) || source !== "built-in") {
    return "exclusive";
  }
  const capability = registry.get(name);
  if (
    !capability ||
    capability.concurrency !== "parallel" ||
    capability.requiresConfirmation
  ) {
    return "exclusive";
  }
  return "parallel";
}

export function preferNativeToolForOperation(input: {
  domain: TaskDomain;
  operation: string;
  currentToolName?: string;
}): NativeToolPreference | null {
  if (input.currentToolName !== "shell_exec") {
    return null;
  }

  const operationClass = classifyOperation(input.domain, input.operation);
  if (!operationClass) {
    return null;
  }

  const preferred = capabilities.find((capability) =>
    capability.name !== input.currentToolName &&
    capability.preferredFor.includes(operationClass)
  );

  return preferred
    ? {
        preferredToolName: preferred.name,
        reason: `${preferred.name} is the native tool for ${operationClass}.`,
      }
    : null;
}

function classifyOperation(
  domain: TaskDomain,
  operation: string,
): string | null {
  const normalized = operation.toLowerCase();

  if (domain === "code" && /\b(test|vitest|npm test|verify)\b/.test(normalized)) {
    return "code:test";
  }

  if (domain === "code" && /(search|grep|find symbol|locate)/.test(normalized)) {
    return "code:search";
  }

  if (domain === "files" && /(search|find files|discover)/.test(normalized)) {
    return "files:search";
  }

  if (
    (domain === "web" || domain === "unknown") &&
    /(chrome|browser|浏览器).*(bookmark|bookmarks|书签)|(?:bookmark|bookmarks|书签).*(chrome|browser|浏览器)/i.test(
      operation,
    )
  ) {
    return "browser:chrome_bookmarks";
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
