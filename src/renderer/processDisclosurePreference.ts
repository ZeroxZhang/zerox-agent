import type { ProcessDisclosurePreference } from "../shared/processDisclosure";

export const PROCESS_DISCLOSURE_PREFERENCE_STORAGE_KEY =
  "zerox.processDisclosurePreference";

export const PROCESS_DISCLOSURE_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: ProcessDisclosurePreference;
  label: string;
  title: string;
}> = [
  { value: "auto", label: "自动", title: "默认折叠，失败与等待决定自动展开" },
  { value: "compact", label: "紧凑", title: "全部收成一行摘要" },
  { value: "open", label: "展开", title: "全部展开" },
  { value: "pinned", label: "固定", title: "保留手动展开的块" },
];

export function isProcessDisclosurePreference(
  value: unknown,
): value is ProcessDisclosurePreference {
  return value === "auto"
    || value === "compact"
    || value === "open"
    || value === "pinned";
}

type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * LD05: the disclosure preference is renderer-local UI state, stored the same
 * way as the other renderer-owned view preferences. Unknown or unreadable
 * values fall back to "auto" so a stale value can never break the stream.
 */
export function loadProcessDisclosurePreference(
  storage: PreferenceStorage | undefined,
): ProcessDisclosurePreference {
  if (!storage) {
    return "auto";
  }
  try {
    const raw = storage.getItem(PROCESS_DISCLOSURE_PREFERENCE_STORAGE_KEY);
    return isProcessDisclosurePreference(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function saveProcessDisclosurePreference(
  storage: PreferenceStorage | undefined,
  preference: ProcessDisclosurePreference,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PROCESS_DISCLOSURE_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // A blocked storage must not break the disclosure surface.
  }
}
