import { describe, expect, it } from "vitest";
import {
  requireStorageBackendAvailability,
  resolveStorageBackend,
  writesToSqlite,
  readsFromSqlite,
} from "./backendResolver";

describe("BackendResolver", () => {
  it("returns SQLite authority when env is unset", () => {
    expect(resolveStorageBackend({})).toBe("sqlite");
  });

  it("returns explicit json / sqlite / dual", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "json" })).toBe("json");
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "sqlite" })).toBe("sqlite");
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "dual" })).toBe("dual");
  });

  it("case-insensitive + trims whitespace", () => {
    expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "  SQLITE " })).toBe("sqlite");
  });

  it("falls back to the SQLite release default and warns on invalid value", () => {
    const original = console.warn;
    const calls: string[] = [];
    console.warn = (msg: string) => calls.push(msg);
    try {
      expect(resolveStorageBackend({ ZEROX_STORAGE_BACKEND: "redis" })).toBe("sqlite");
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

  it("fails closed when requested SQLite authority is unavailable", () => {
    expect(requireStorageBackendAvailability("json", false)).toBe("json");
    expect(requireStorageBackendAvailability("sqlite", true)).toBe("sqlite");
    expect(requireStorageBackendAvailability("dual", true)).toBe("dual");
    expect(() =>
      requireStorageBackendAvailability("sqlite", false),
    ).toThrow(/requires SQLite authority/);
    expect(() =>
      requireStorageBackendAvailability("dual", false),
    ).toThrow(/requires SQLite authority/);
  });
});
