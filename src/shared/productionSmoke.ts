import type { StorageBackend } from "./storageContract";

export const productionStorageAuthorityDomains = [
  "goal",
  "execution_checkpoint",
  "memory",
  "workspace",
  "multi_agent_session",
  "learning_candidate",
  "eval_candidate",
  "promoted_eval_fixture",
] as const;

export type ProductionStorageAuthorityDomain =
  (typeof productionStorageAuthorityDomains)[number];

export type ProductionStorageSmokeEvidence = {
  schemaVersion: 2;
  kind: "production_storage_smoke";
  requestedBackend: StorageBackend;
  resolvedBackend: StorageBackend;
  nativeRuntime: {
    runtime: "electron";
    electronVersion: string;
    modulesAbi: string;
    nodeVersion: string;
  };
  sqlite: {
    foreignKeys: 1;
    journalMode: "wal";
    migrationCount: number;
    taskRowPersisted: true;
    taskId: string;
    taskName: string;
  };
  authority: {
    domains: ProductionStorageAuthorityDomain[];
    markerCount: 8;
    recordIds: Record<ProductionStorageAuthorityDomain, string>;
    domainRowsPersisted: true;
    legacyJsonShadowsAbsent: true;
  };
};

export type ProductionSmokeAcceptance = {
  ok: boolean;
  failedChecks: Array<"renderer" | "storage">;
};

export type ProductionSmokeSettlement = {
  code: number;
  message: string;
};

export function createProductionSmokeSettler(
  settle: (result: ProductionSmokeSettlement) => void,
): (result: ProductionSmokeSettlement) => boolean {
  let settled = false;
  return (result) => {
    if (settled) {
      return false;
    }
    settled = true;
    settle(result);
    return true;
  };
}

export function evaluateProductionSmokeAcceptance(input: {
  rendererPassed: boolean;
  storageRequired: boolean;
  storagePassed: boolean;
}): ProductionSmokeAcceptance {
  const failedChecks: ProductionSmokeAcceptance["failedChecks"] = [];
  if (!input.rendererPassed) {
    failedChecks.push("renderer");
  }
  if (input.storageRequired && !input.storagePassed) {
    failedChecks.push("storage");
  }
  return {
    ok: failedChecks.length === 0,
    failedChecks,
  };
}

export function isProductionStorageSmokeEvidence(
  value: unknown,
): value is ProductionStorageSmokeEvidence {
  if (!value || typeof value !== "object") {
    return false;
  }

  const evidence = value as ProductionStorageSmokeEvidence;
  const authorityDomains = evidence.authority?.domains;
  const recordIds = evidence.authority?.recordIds;
  return (
    evidence.schemaVersion === 2 &&
    evidence.kind === "production_storage_smoke" &&
    evidence.requestedBackend === "sqlite" &&
    evidence.resolvedBackend === "sqlite" &&
    evidence.nativeRuntime?.runtime === "electron" &&
    typeof evidence.nativeRuntime.electronVersion === "string" &&
    evidence.nativeRuntime.electronVersion.length > 0 &&
    typeof evidence.nativeRuntime.modulesAbi === "string" &&
    /^\d+$/.test(evidence.nativeRuntime.modulesAbi) &&
    typeof evidence.nativeRuntime.nodeVersion === "string" &&
    evidence.nativeRuntime.nodeVersion.length > 0 &&
    evidence.sqlite?.foreignKeys === 1 &&
    evidence.sqlite.journalMode === "wal" &&
    Number.isInteger(evidence.sqlite.migrationCount) &&
    evidence.sqlite.migrationCount > 0 &&
    evidence.sqlite.taskRowPersisted === true &&
    typeof evidence.sqlite.taskId === "string" &&
    evidence.sqlite.taskId.length > 0 &&
    typeof evidence.sqlite.taskName === "string" &&
    evidence.sqlite.taskName.length > 0 &&
    Array.isArray(authorityDomains) &&
    authorityDomains.length === productionStorageAuthorityDomains.length &&
    authorityDomains.every(
      (domain, index) => domain === productionStorageAuthorityDomains[index],
    ) &&
    evidence.authority.markerCount === productionStorageAuthorityDomains.length &&
    hasExactAuthorityRecordIds(recordIds) &&
    evidence.authority.domainRowsPersisted === true &&
    evidence.authority.legacyJsonShadowsAbsent === true
  );
}

function hasExactAuthorityRecordIds(
  value: unknown,
): value is Record<ProductionStorageAuthorityDomain, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...productionStorageAuthorityDomains].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    productionStorageAuthorityDomains.every(
      (domain) =>
        typeof record[domain] === "string" &&
        (record[domain] as string).length > 0,
    )
  );
}
