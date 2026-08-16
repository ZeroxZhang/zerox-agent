// BackendResolver (contracts v1.4 §1.4, spec T1.4).
//
// Reads `ZEROX_STORAGE_BACKEND` from the environment (`json` | `sqlite` | `dual`).
// Invalid or unset values use the release default (`sqlite` after P97).
// The flag is read ONLY from process.env — never from modelSettingsStore — to
// avoid a circular dependency with the config layer. Native-open failure is
// fatal for sqlite/dual so an unavailable authority cannot silently write JSON.

import type { StorageBackend } from "../../shared/storageContract";
import { readFeatureFlags } from "../../shared/featureFlags";

const VALID_BACKENDS = new Set<StorageBackend>(["json", "sqlite", "dual"]);

function resolveFromEnv(env: NodeJS.ProcessEnv): { backend: StorageBackend; warned: boolean } {
  const raw = env.ZEROX_STORAGE_BACKEND;
  const backend = readFeatureFlags(env).ZEROX_STORAGE_BACKEND;
  if (!raw) return { backend, warned: false };
  const normalized = raw.trim().toLowerCase() as StorageBackend;
  if (VALID_BACKENDS.has(normalized)) return { backend, warned: false };
  return { backend, warned: true };
}

export function resolveStorageBackend(env: NodeJS.ProcessEnv = process.env): StorageBackend {
  const { backend, warned } = resolveFromEnv(env);
  if (warned) {
    // eslint-disable-next-line no-console
    console.warn(
      `ZEROX_STORAGE_BACKEND="${env.ZEROX_STORAGE_BACKEND}" is invalid; falling back to "${backend}". Valid values: json | sqlite | dual.`,
    );
  }
  return backend;
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

export function requireStorageBackendAvailability(
  backend: StorageBackend,
  sqliteAvailable: boolean,
): StorageBackend {
  if (backend !== "json" && !sqliteAvailable) {
    throw new Error(
      `Storage backend "${backend}" requires SQLite authority, but SQLite is unavailable.`,
    );
  }
  return backend;
}
