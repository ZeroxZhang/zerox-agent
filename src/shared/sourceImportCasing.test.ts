import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve("src");
const sourceExtensions = [".ts", ".tsx"];
const resolvedExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];

describe("source import casing", () => {
  it("uses case-exact paths for relative source imports", async () => {
    const files = await listSourceFiles(sourceRoot);
    const mismatches: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of readRelativeImportSpecifiers(source)) {
        const importPath = path.resolve(path.dirname(file), specifier);
        const candidates = buildResolutionCandidates(importPath);
        const hasExactMatch = await hasExactPath(candidates);
        if (hasExactMatch) {
          continue;
        }

        const actualPath = await findCaseInsensitiveMatch(candidates);
        if (actualPath) {
          mismatches.push(
            `${path.relative(sourceRoot, file)} imports ${specifier}, but the case-exact path is ${path.relative(
              path.dirname(file),
              actualPath,
            )}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  }, 15_000);
});

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(fullPath);
      }
      return sourceExtensions.includes(path.extname(entry.name)) ? [fullPath] : [];
    }),
  );
  return files.flat();
}

function readRelativeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function buildResolutionCandidates(importPath: string): string[] {
  const candidates = resolvedExtensions.map((extension) => `${importPath}${extension}`);
  return [
    ...candidates,
    ...resolvedExtensions
      .filter(Boolean)
      .map((extension) => path.join(importPath, `index${extension}`)),
  ];
}

async function hasExactPath(candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await exactPathExists(candidate)) {
      return true;
    }
  }
  return false;
}

async function exactPathExists(candidate: string): Promise<boolean> {
  const parts = path.resolve(candidate).split(path.sep).filter(Boolean);
  let current = path.parse(candidate).root;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return false;
    }
    if (!entries.includes(part)) {
      return false;
    }
    current = path.join(current, part);
  }
  return true;
}

async function findCaseInsensitiveMatch(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const match = await caseInsensitivePath(candidate);
    if (match) {
      return match;
    }
  }
  return null;
}

async function caseInsensitivePath(candidate: string): Promise<string | null> {
  const parts = path.resolve(candidate).split(path.sep).filter(Boolean);
  let current = path.parse(candidate).root;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return null;
    }
    const actual = entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
    if (!actual) {
      return null;
    }
    current = path.join(current, actual);
  }
  return current;
}
