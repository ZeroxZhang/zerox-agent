import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";

const previewValidationKey = "building-agent.validation-preview";

export function loadPreviewValidationSnapshot(
  storage: Pick<Storage, "getItem">,
): AgentBootstrapValidationSnapshot | null {
  try {
    const raw = storage.getItem(previewValidationKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as AgentBootstrapValidationSnapshot;
    return parsed?.report && parsed.validatedAt ? parsed : null;
  } catch {
    return null;
  }
}

export function savePreviewValidationSnapshot(
  storage: Pick<Storage, "setItem">,
  snapshot: AgentBootstrapValidationSnapshot,
) {
  storage.setItem(previewValidationKey, JSON.stringify(snapshot));
}

export function clearPreviewValidationSnapshot(
  storage: Pick<Storage, "removeItem">,
) {
  storage.removeItem(previewValidationKey);
}
