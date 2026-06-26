import type { ToolDefinition } from "./openAiCompatibleClient";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import type { ToolResultOffloadReadScope } from "./toolResultOffloadStore";

export type AgentToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; errorDetails?: Record<string, unknown> };

export type ToolExecutionOptions = {
  runContext?: AgentRunContext;
  signal?: AbortSignal;
  toolResultReadScope?: ToolResultOffloadReadScope;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
) => Promise<AgentToolExecutionResult>;

export type DynamicToolRegistry = {
  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    source: string,
    descriptor?: NativeToolDescriptor,
  ): void;
  unregister(toolName: string): boolean;
  getDefinitions(): ToolDefinition[];
  getNativeDescriptors(): NativeToolDescriptor[];
  getNativeDescriptor(toolName: string): NativeToolDescriptor | null;
  getSource(toolName: string): string | null;
  getVisibleDefinitions(filter: DynamicToolVisibilityFilter): ToolDefinition[];
  getRegistrationConflicts(): DynamicToolRegistrationConflict[];
  getSourceHealthSnapshot(): DynamicToolSourceHealth[];
  execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions,
  ): Promise<AgentToolExecutionResult>;
  listBySource(): Map<string, string[]>;
  has(toolName: string): boolean;
};

export type DynamicToolVisibilityFilter = {
  allowedNames?: string[];
  allowedSources?: string[];
};

export type DynamicToolRegistrationConflict = {
  toolName: string;
  existingSource: string;
  attemptedSource: string;
  reason: "duplicate_tool_name";
  createdAt: string;
};

export type DynamicToolSourceHealth = {
  source: string;
  status: "ready" | "conflict";
  toolCount: number;
  conflictCount: number;
};

export function createDynamicToolRegistry(options?: {
  now?: () => string;
}): DynamicToolRegistry {
  const handlers = new Map<string, ToolHandler>();
  const definitions = new Map<string, ToolDefinition>();
  const sources = new Map<string, string>();
  const nativeDescriptors = new Map<string, NativeToolDescriptor>();
  const conflicts: DynamicToolRegistrationConflict[] = [];
  const sourceOrder: string[] = [];
  const now = options?.now ?? (() => new Date().toISOString());

  return {
    register(definition, handler, source, descriptor) {
      const name = definition.function.name;
      rememberSource(source);

      if (handlers.has(name)) {
        const existingSource = sources.get(name) ?? "unknown";
        conflicts.push({
          toolName: name,
          existingSource,
          attemptedSource: source,
          reason: "duplicate_tool_name",
          createdAt: now(),
        });
        throw new Error(`Tool "${name}" is already registered.`);
      }

      definitions.set(name, definition);
      handlers.set(name, handler);
      sources.set(name, source);
      if (descriptor) {
        nativeDescriptors.set(name, descriptor);
      }
    },

    unregister(toolName) {
      if (!handlers.has(toolName)) {
        return false;
      }

      handlers.delete(toolName);
      definitions.delete(toolName);
      sources.delete(toolName);
      nativeDescriptors.delete(toolName);
      return true;
    },

    getDefinitions() {
      return [...definitions.values()];
    },

    getNativeDescriptors() {
      return [...nativeDescriptors.values()];
    },

    getNativeDescriptor(toolName) {
      return nativeDescriptors.get(toolName) ?? null;
    },

    getSource(toolName) {
      return sources.get(toolName) ?? null;
    },

    getVisibleDefinitions(filter) {
      const allowedNames = new Set(filter.allowedNames ?? []);
      const allowedSources = new Set(filter.allowedSources ?? []);

      return [...definitions.entries()]
        .filter(([name]) => {
          const source = sources.get(name);
          return allowedNames.has(name) || (source ? allowedSources.has(source) : false);
        })
        .map(([, definition]) => definition);
    },

    getRegistrationConflicts() {
      return conflicts.map((conflict) => ({ ...conflict }));
    },

    getSourceHealthSnapshot() {
      return sourceOrder.map((source) => {
        const toolCount = [...sources.values()].filter(
          (candidate) => candidate === source,
        ).length;
        const conflictCount = conflicts.filter(
          (conflict) => conflict.attemptedSource === source,
        ).length;
        return {
          source,
          status: conflictCount > 0 ? "conflict" : "ready",
          toolCount,
          conflictCount,
        };
      });
    },

    async execute(toolName, args, options) {
      const handler = handlers.get(toolName);

      if (!handler) {
        return { ok: false, error: `Tool "${toolName}" is not registered.` };
      }

      const validationErrors = validateToolArgs(
        definitions.get(toolName)?.function.parameters,
        args,
      );
      if (validationErrors.length > 0) {
        return {
          ok: false,
          error: `Recoverable tool argument error: ${validationErrors.join("; ")}.`,
          errorDetails: {
            recoverable: true,
            validationErrors,
          },
        };
      }

      try {
        return await handler(args, options);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Tool execution failed.",
        };
      }
    },

    listBySource() {
      const result = new Map<string, string[]>();

      for (const [name, source] of sources) {
        const list = result.get(source) ?? [];
        list.push(name);
        result.set(source, list);
      }

      return result;
    },

    has(toolName) {
      return handlers.has(toolName);
    },
  };

  function rememberSource(source: string) {
    if (!sourceOrder.includes(source)) {
      sourceOrder.push(source);
    }
  }
}

function validateToolArgs(parameters: unknown, args: Record<string, unknown>): string[] {
  if (!isRecord(parameters)) {
    return [];
  }
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((value): value is string => typeof value === "string")
    : [];
  const properties = isRecord(parameters.properties) ? parameters.properties : {};
  const errors: string[] = [];

  for (const name of required) {
    if (args[name] === undefined || args[name] === null || args[name] === "") {
      errors.push(`${name} is required`);
    }
  }

  for (const [name, schema] of Object.entries(properties)) {
    if (!(name in args) || args[name] === undefined || args[name] === null) {
      continue;
    }
    const expectedType = readJsonSchemaType(schema);
    if (expectedType && !matchesJsonSchemaType(args[name], expectedType)) {
      errors.push(`${name} must be ${expectedType}`);
    }
  }

  return errors;
}

function readJsonSchemaType(schema: unknown): string | null {
  if (!isRecord(schema)) {
    return null;
  }
  return typeof schema.type === "string" ? schema.type : null;
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
