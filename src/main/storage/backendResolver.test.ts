import { describe, expect, it } from "vitest";
import {
  resolveStorageBackend,
  writesToSqlite,
  readsFromSqlite,
} from "./backendResolver";

describe("BackendResolver", () => {
  it("returns the complete JSON source of truth when env is unset", () => {
    expect(resolveStorageBackend({})).toBe("json");
  });

  it("returns explicit json / sqlite / dual", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "json" })).toBe("json");
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "sqlite" })).toBe("sqlite");
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "dual" })).toBe("dual");
  });

  it("case-insensitive + trims whitespace", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "  SQLITE " })).toBe("sqlite");
  });

  it("falls back to json + warns on invalid value", () => {
    const original = console.warn;
    const calls: string[] = [];
    console.warn = (msg: string) => calls.push(msg);
    try {
      expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "redis" })).toBe("json");
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
