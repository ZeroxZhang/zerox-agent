import type { StorageBackend } from "./storageContract";

export type ProductionStorageSmokeEvidence = {
  schemaVersion: 1;
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
  };
  dual: {
    jsonShadowPersisted: true;
    taskId: string;
    taskName: string;
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
  return (
    evidence.schemaVersion === 1 &&
    evidence.kind === "production_storage_smoke" &&
    evidence.requestedBackend === "dual" &&
    evidence.resolvedBackend === "dual" &&
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
    evidence.dual?.jsonShadowPersisted === true &&
    typeof evidence.dual.taskId === "string" &&
    evidence.dual.taskId.length > 0 &&
    typeof evidence.dual.taskName === "string" &&
    evidence.dual.taskName.length > 0
  );
}
