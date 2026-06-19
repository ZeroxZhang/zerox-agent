import { afterEach, describe, expect, it } from "vitest";
import {
  resetStorageBackendForTesting,
  resolveStorageBackend,
  writesToSqlite,
  readsFromSqlite,
} from "./backendResolver";

describe("BackendResolver", () => {
  afterEach(() => resetStorageBackendForTesting());

  it("returns dual when env is unset", () => {
    expect(resolveStorageBackend({})).toBe("dual");
  });

  it("returns explicit json / sqlite / dual", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "json" })).toBe("json");
    resetStorageBackendForTesting();
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "sqlite" })).toBe("sqlite");
    resetStorageBackendForTesting();
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "dual" })).toBe("dual");
  });

  it("case-insensitive + trims whitespace", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "  SQLITE " })).toBe("sqlite");
  });

  it("falls back to dual + warns on invalid value", () => {
    const original = console.warn;
    const calls: string[] = [];
    console.warn = (msg: string) => calls.push(msg);
    try {
      expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "redis" })).toBe("dual");
      expect(calls.length).toBe(1);
      expect(calls[0]).toContain("redis");
    } finally {
      console.warn = original;
    }
  });

  it("writesToSqlite / readsFromSqlite predicates", () => {
    expect(writesToSqlite("sqlite")).toBe(true);
    expect(writesToSqlite("dual")).toBe(true);
    expect(writesToSqlite("json")).toBe(false);
    expect(readsFromSqlite("sqlite")).toBe(true);
    expect(readsFromSqlite("dual")).toBe(true);
    expect(readsFromSqlite("json")).toBe(false);
  });
});
