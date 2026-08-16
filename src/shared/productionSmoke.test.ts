import { describe, expect, it } from "vitest";
import {
  createProductionSmokeSettler,
  evaluateProductionSmokeAcceptance,
  isProductionStorageSmokeEvidence,
  type ProductionStorageSmokeEvidence,
} from "./productionSmoke";

const validEvidence: ProductionStorageSmokeEvidence = {
  schemaVersion: 1,
  kind: "production_storage_smoke",
  requestedBackend: "dual",
  resolvedBackend: "dual",
  nativeRuntime: {
    runtime: "electron",
    electronVersion: "42.9.0",
    modulesAbi: "146",
    nodeVersion: "24.14.0",
  },
  sqlite: {
    foreignKeys: 1,
    journalMode: "wal",
    migrationCount: 3,
    taskRowPersisted: true,
  },
  dual: {
    jsonShadowPersisted: true,
    taskId: "smoke_task",
    taskName: "Production SQLite smoke",
  },
};

describe("production smoke contract", () => {
  it("keeps a timeout failure from being overwritten by a late success", () => {
    const settlements: Array<{ code: number; message: string }> = [];
    const settle = createProductionSmokeSettler((result) => {
      settlements.push(result);
    });

    expect(settle({ code: 1, message: "storage timed out" })).toBe(true);
    expect(settle({ code: 0, message: "late renderer success" })).toBe(false);
    expect(settlements).toEqual([
      { code: 1, message: "storage timed out" },
    ]);
  });

  it("rejects a renderer success when storage fell back to JSON", () => {
    expect(
      evaluateProductionSmokeAcceptance({
        rendererPassed: true,
        storageRequired: true,
        storagePassed: false,
      }),
    ).toEqual({
      ok: false,
      failedChecks: ["storage"],
    });
  });

  it("requires both renderer and native storage evidence", () => {
    expect(
      evaluateProductionSmokeAcceptance({
        rendererPassed: true,
        storageRequired: true,
        storagePassed: true,
      }),
    ).toEqual({
      ok: true,
      failedChecks: [],
    });
    expect(
      evaluateProductionSmokeAcceptance({
        rendererPassed: false,
        storageRequired: true,
        storagePassed: true,
      }),
    ).toEqual({
      ok: false,
      failedChecks: ["renderer"],
    });
  });

  it("validates objective Electron SQLite and dual-shadow evidence", () => {
    expect(isProductionStorageSmokeEvidence(validEvidence)).toBe(true);
    expect(
      isProductionStorageSmokeEvidence({
        ...validEvidence,
        resolvedBackend: "json",
      }),
    ).toBe(false);
    expect(
      isProductionStorageSmokeEvidence({
        ...validEvidence,
        dual: {
          ...validEvidence.dual,
          jsonShadowPersisted: false,
        },
      }),
    ).toBe(false);
    expect(
      isProductionStorageSmokeEvidence({
        ...validEvidence,
        sqlite: {
          ...validEvidence.sqlite,
          taskRowPersisted: false,
        },
      }),
    ).toBe(false);
  });
});
