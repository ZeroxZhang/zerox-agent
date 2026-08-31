import { describe, expect, it } from "vitest";
import {
  assertSafeStoreEntityId,
  isSafeStoreEntityId,
} from "./storeEntityId";

describe("store entity id", () => {
  it.each([
    "run_1",
    "goal-1",
    "request:revision.2",
    `a${"b".repeat(511)}`,
  ])("accepts the persisted id alphabet: %s", (value) => {
    expect(isSafeStoreEntityId(value)).toBe(true);
    expect(() => assertSafeStoreEntityId(value, "Entity id")).not.toThrow();
  });

  it.each([
    "",
    "../outside",
    ".hidden",
    "with/slash",
    "with\\backslash",
    "with space",
    `a${"b".repeat(512)}`,
  ])("rejects an unsafe persisted id: %s", (value) => {
    expect(isSafeStoreEntityId(value)).toBe(false);
    expect(() => assertSafeStoreEntityId(value, "Entity id")).toThrow(
      "Entity id is invalid",
    );
  });
});
