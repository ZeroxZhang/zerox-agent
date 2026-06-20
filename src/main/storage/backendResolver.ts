// BackendResolver (contracts v1.4 §1.4, spec T1.4).
//
// Reads `ZEROX_STORAGE_BACKEND` from the environment (`json` | `sqlite` | `dual`).
// Invalid or unset values fall back to `dual` with a warning (the spec's safe
// transition default). The flag is read ONLY from process.env — never from
// modelSettingsStore — to avoid a circular dependency with the config layer.

import type { StorageBackend } from "../../shared/storageContract";

const VALID_BACKENDS = new Set<StorageBackend>(["json", "sqlite", "dual"]);
const DEFAULT_BACKEND: StorageBackend = "dual";

let resolved: StorageBackend | null = null;

function resolveFromEnv(env: NodeJS.ProcessEnv): { backend: StorageBackend; warned: boolean } {
  const raw = env.ZEROX_STORAGE_BACKEND;
  if (!raw) return { backend: DEFAULT_BACKEND, warned: false };
  const normalized = raw.trim().toLowerCase() as StorageBackend;
  if (VALID_BACKENDS.has(normalized)) return { backend: normalized, warned: false };
  return { backend: DEFAULT_BACKEND, warned: true };
}

export function resolveStorageBackend(env: NodeJS.ProcessEnv = process.env): StorageBackend {
  if (resolved) return resolved;
  const { backend, warned } = resolveFromEnv(env);
  if (warned) {
    // eslint-disable-next-line no-console
    console.warn(
      `ZEROX_STORAGE_BACKEND="${env.ZEROX_STORAGE_BACKEND}" is invalid; falling back to "${backend}". Valid values: json | sqlite | dual.`,
    );
  }
  resolved = backend;
  return backend;
}

/** Test-only: reset the memoized resolution. */
export function resetStorageBackendForTesting(): void {
  resolved = null;
}

export function isStorageBackendEnabled(
  backend: StorageBackend,
  ...targets: StorageBackend[]
): boolean {
  return targets.includes(backend);
}

/** True when SQLite must be written (sqlite or dual). */
export function writesToSqlite(backend: StorageBackend): boolean {
  return backend === "sqlite" || backend === "dual";
}

/** True when SQLite is the read source (sqlite or dual). */
export function readsFromSqlite(backend: StorageBackend): boolean {
  return backend === "sqlite" || backend === "dual";
}
