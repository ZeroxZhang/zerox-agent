import type {
  AssembleOptions,
  AssembleResult,
  LayerProvider,
  SystemPromptAssembler,
  SystemPromptLayer,
  SystemPromptLayerId,
} from "./systemPromptLayer";
import { selectAgentPromptProfile } from "./agentProtocol";
import { defaultLayerProviders } from "./systemPromptLayerProviders";

// --- Assembler implementation ---

function createSystemPromptAssembler(
  initialProviders: LayerProvider[] = [],
): SystemPromptAssembler {
  const providers = new Map<SystemPromptLayerId, LayerProvider>();

  for (const p of initialProviders) {
    providers.set(p.id, p);
  }

  function assembleLayers(options: AssembleOptions = {}): SystemPromptLayer[] {
    const layers: SystemPromptLayer[] = [];
    for (const p of providers.values()) {
      const layer = p.build(options);
      if (layer) {
        layers.push(layer);
      }
    }
    // Stable sort by order
    return layers.sort((a, b) => a.order - b.order);
  }

  function assemble(options: AssembleOptions = {}): AssembleResult {
    const layers = assembleLayers(options);
    // Chat mode: layers joined with "\n" (no blank-line section separation).
    // Agent / goal mode: layers joined with "\n\n" (blank-line section separation
    // matches the original monolithic format where each section is separated by "").
    const separator = options.mode === "chat" ? "\n" : "\n\n";
    const nonEmpty = layers.filter((l) => l.content.length > 0);
    const prompt = nonEmpty.map((l) => l.content).join(separator);
    const profile = selectAgentPromptProfile(options.modelId);
    return { layers, prompt, profile };
  }

  return {
    assemble,
    assembleLayers,
    registerLayerProvider(provider: LayerProvider): void {
      providers.set(provider.id, provider);
    },
    removeLayerProvider(id: SystemPromptLayerId): void {
      providers.delete(id);
    },
  };
}

// --- Global singleton ---

let _defaultAssembler: SystemPromptAssembler | undefined;

export function getSystemPromptAssembler(): SystemPromptAssembler {
  if (!_defaultAssembler) {
    _defaultAssembler = createSystemPromptAssembler(defaultLayerProviders);
  }
  return _defaultAssembler;
}

export function setSystemPromptAssembler(
  assembler: SystemPromptAssembler,
): void {
  _defaultAssembler = assembler;
}

export { createSystemPromptAssembler };
