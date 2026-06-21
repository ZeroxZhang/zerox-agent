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
  execute(
    toolName: string,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions,
  ): Promise<AgentToolExecutionResult>;
  listBySource(): Map<string, string[]>;
  has(toolName: string): boolean;
};

export function createDynamicToolRegistry(): DynamicToolRegistry {
  const handlers = new Map<string, ToolHandler>();
  const definitions = new Map<string, ToolDefinition>();
  const sources = new Map<string, string>();
  const nativeDescriptors = new Map<string, NativeToolDescriptor>();

  return {
    register(definition, handler, source, descriptor) {
      const name = definition.function.name;

      if (handlers.has(name)) {
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

    async execute(toolName, args, options) {
      const handler = handlers.get(toolName);

      if (!handler) {
        return { ok: false, error: `Tool "${toolName}" is not registered.` };
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
}
