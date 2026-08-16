import { describe, expect, it } from "vitest";
import {
  createProductionSmokeSettler,
  evaluateProductionSmokeAcceptance,
  isProductionStorageSmokeEvidence,
  productionStorageAuthorityDomains,
  type ProductionStorageSmokeEvidence,
} from "./productionSmoke";

const validEvidence: ProductionStorageSmokeEvidence = {
  schemaVersion: 2,
  kind: "production_storage_smoke",
  requestedBackend: "sqlite",
  resolvedBackend: "sqlite",
  nativeRuntime: {
    runtime: "electron",
    electronVersion: "42.9.0",
    modulesAbi: "146",
    nodeVersion: "24.14.0",
  },
  sqlite: {
    foreignKeys: 1,
    journalMode: "wal",
    migrationCount: 7,
    taskRowPersisted: true,
    taskId: "smoke_task",
    taskName: "Production SQLite smoke",
  },
  authority: {
    domains: [...productionStorageAuthorityDomains],
    markerCount: 8,
    recordIds: {
      goal: "goal_smoke",
      execution_checkpoint: "run_smoke",
      memory: "memory_smoke",
      workspace: "workspace_smoke",
      multi_agent_session: "session_smoke",
      learning_candidate: "learning_smoke",
      eval_candidate: "candidate_smoke",
      promoted_eval_fixture: "fixture_smoke",
    },
    domainRowsPersisted: true,
    legacyJsonShadowsAbsent: true,
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

  it("validates objective Electron SQLite authority evidence", () => {
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
        authority: {
          ...validEvidence.authority,
          legacyJsonShadowsAbsent: false,
        },
      }),
    ).toBe(false);
    expect(
      isProductionStorageSmokeEvidence({
        ...validEvidence,
        authority: {
          ...validEvidence.authority,
          domains: validEvidence.authority.domains.slice(1),
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
