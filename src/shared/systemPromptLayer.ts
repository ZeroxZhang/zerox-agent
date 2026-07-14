import type { AgentPromptProfile } from "./agentProtocol";

/** Identifies the role of a layer in the assembly stack. */
export type SystemPromptLayerId =
  | "agent.identity"       // "you are a local desktop AI agent..."
  | "agent.memory"         // memory system usage instructions (Phase 2)
  | "agent.attachment_safety" // attachment quoted-data trust boundary
  | "agent.tool_guidance"  // tool prioritization rules
  | "agent.output"         // output language / format rules
  | "agent.profile"        // model-specific behavioral guidance
  | "env.runtime"          // model ID, workspace root, current date
  | "env.provider"         // provider-specific additions
  | "mode.goal"            // goal mode execution profile
  | "mode.chat"            // chat mode wrapper
  | "custom.plugin"        // plugin injection point
  | "custom.user";         // caller-supplied system text

/** A single assembled layer: an immutable, named segment. */
export type SystemPromptLayer = {
  /** Identifies the layer's role. */
  id: SystemPromptLayerId;
  /** Human-readable label for debugging/logging. */
  label: string;
  /** The prompt text for this layer. */
  content: string;
  /** Priority for ordering (lower = earlier in the final prompt). */
  order: number;
  /** When true, this layer is NEVER stripped by context compaction. */
  protected: boolean;
  /** Optional metadata for tracing. */
  metadata?: Record<string, string>;
};

/** Options passed to the system prompt assembler. */
export type AssembleOptions = {
  modelId?: string;
  workspaceRoot?: string;
  /** Local date used to resolve relative date wording in prompts. */
  currentDate?: string;
  /** IANA timezone name used to interpret currentDate, when known. */
  timeZone?: string;
  /** Execution mode. Determines which layers are included. */
  mode?: "agent" | "chat" | "goal";
};

/** Result of assembly. */
export type AssembleResult = {
  /** All layers in order. */
  layers: SystemPromptLayer[];
  /** The joined prompt string (single string for backward compatibility). */
  prompt: string;
  /** The model profile that was selected. */
  profile: AgentPromptProfile;
};

/**
 * A provider that builds one layer of the system prompt.
 * Plugins can register additional providers via the assembler.
 */
export type LayerProvider = {
  id: SystemPromptLayerId;
  /** Build the layer for the given options. Return null to skip this layer. */
  build(options: AssembleOptions): SystemPromptLayer | null;
  /** Priority for ordering. */
  order: number;
};

/** The assembler: composes system prompt layers and produces the final prompt. */
export type SystemPromptAssembler = {
  /** Assemble all layers and return the joined prompt (backward compat). */
  assemble(options?: AssembleOptions): AssembleResult;
  /** Return individual layers for callers that want structured output. */
  assembleLayers(options?: AssembleOptions): SystemPromptLayer[];
  /** Register a custom layer provider (plugin extension point). */
  registerLayerProvider(provider: LayerProvider): void;
  /** Remove a previously registered layer provider by id. */
  removeLayerProvider(id: SystemPromptLayerId): void;
};
