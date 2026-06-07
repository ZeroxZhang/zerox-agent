import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("app icon assets", () => {
  it("keeps an editable source icon and a macOS icns build artifact", () => {
    const sourceIconPath = path.join(process.cwd(), "build/icon.svg");
    const macIconPath = path.join(process.cwd(), "build/icon.icns");

    expect(existsSync(sourceIconPath)).toBe(true);
    expect(existsSync(macIconPath)).toBe(true);
    expect(statSync(macIconPath).size).toBeGreaterThan(10_000);
  });

  it("uses the Zerox brand mark as the editable source icon", () => {
    const sourceIconPath = path.join(process.cwd(), "build/icon.svg");
    const sourceIcon = readFileSync(sourceIconPath, "utf8");

    expect(sourceIcon).toContain("Zerox app icon");
    expect(sourceIcon).toContain("zerox-mark");
    expect(sourceIcon).toContain("#69e2d6");
  });
});
