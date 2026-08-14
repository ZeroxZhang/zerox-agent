import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageJson = readJson("package.json") as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lockfile = readJson("package-lock.json") as {
  packages: Record<string, { version?: string }>;
};

describe("dependency security boundary", () => {
  it("keeps direct dependency ranges above reviewed security floors", () => {
    expect(packageJson.dependencies.undici).toBe("^7.29.0");
    expect(packageJson.devDependencies.electron).toBe("^42.9.0");
  });

  it.each([
    ["node_modules/undici", "7.29.0"],
    ["node_modules/@electron/rebuild/node_modules/undici", "6.28.0"],
    ["node_modules/js-yaml", "4.3.1"],
    ["node_modules/brace-expansion", "5.0.9"],
    ["node_modules/fast-uri", "3.1.5"],
    ["node_modules/nanoid", "3.3.18"],
    ["node_modules/electron", "42.9.0"],
  ])("resolves %s at or above %s", (packagePath, minimum) => {
    const version = lockfile.packages[packagePath]?.version;
    expect(version, `${packagePath} is missing from package-lock.json`).toBeTypeOf(
      "string",
    );
    expect(compareVersions(version!, minimum)).toBeGreaterThanOrEqual(0);
  });

  it("uses Electron's patched internal archive extractor", () => {
    expect(lockfile.packages["node_modules/extract-zip"]).toBeUndefined();
    expect(
      lockfile.packages["node_modules/@electron-internal/extract-zip"]?.version,
    ).toBeTypeOf("string");
  });
});

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(path.join(root, relativePath), "utf8"),
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
