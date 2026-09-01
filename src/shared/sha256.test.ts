import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("shared SHA-256", () => {
  it.each([
    "",
    "abc",
    "中文输入法 Enter",
    "a".repeat(65_537),
  ])("matches the platform SHA-256 for shared builds", (value) => {
    expect(sha256Hex(new TextEncoder().encode(value))).toBe(
      createHash("sha256").update(value).digest("hex"),
    );
  });
});
