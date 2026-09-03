/**
 * OpenAI-compatible function tool wire shape.
 *
 * Kept in shared so protocol producers (agentProtocol) and main-process
 * provider clients can reference it without a shared -> main import edge.
 * main/openAiCompatibleClient re-exports this type for its historical
 * importers.
 */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
