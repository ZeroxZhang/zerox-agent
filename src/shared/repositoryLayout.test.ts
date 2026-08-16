import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("repository root layout", () => {
  it("keeps historical review and product artifacts under docs", () => {
    for (const rootArtifact of [
      "UI_AUDIT.md",
      "UI_ACCEPTANCE.md",
      "onepager.html",
      "zerox-agent-onepage.html",
      "zerox-agent-onepage.png",
    ]) {
      expect(existsSync(path.join(root, rootArtifact))).toBe(false);
    }

    for (const archivedArtifact of [
      "docs/reviews/zerox-agent-3-3-0-ui-audit.md",
      "docs/reviews/zerox-agent-3-3-0-ui-acceptance.md",
      "docs/product/archive/README.md",
      "docs/product/archive/building-agent-onepager.html",
      "docs/product/archive/zerox-agent-introduction.html",
      "docs/product/archive/zerox-agent-introduction.png",
    ]) {
      expect(existsSync(path.join(root, archivedArtifact))).toBe(true);
    }
  });

  it("preserves required root entrypoints and canonical brand assets", () => {
    for (const requiredRootFile of [
      "AGENTS.md",
      "README.md",
      "package.json",
      "package-lock.json",
      "index.html",
      "init.sh",
      "logo.png",
      "electron-builder.yml",
      "tsconfig.json",
      "tsconfig.electron.json",
      "tsconfig.renderer.json",
      "tsconfig.tests.json",
      "vite.config.ts",
      "vitest.config.ts",
    ]) {
      expect(existsSync(path.join(root, requiredRootFile))).toBe(true);
    }

    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    expect(readme).toContain('src="logo.png"');
  });

  it("keeps archived cross-references resolvable from their new locations", () => {
    const acceptance = readFileSync(
      path.join(
        root,
        "docs/reviews/zerox-agent-3-3-0-ui-acceptance.md",
      ),
      "utf8",
    );
    const introduction = readFileSync(
      path.join(
        root,
        "docs/product/archive/zerox-agent-introduction.html",
      ),
      "utf8",
    );

    expect(acceptance).toContain(
      "[`zerox-agent-3-3-0-ui-audit.md`](zerox-agent-3-3-0-ui-audit.md)",
    );
    expect(introduction).toContain('<base href="../../../">');
  });
});
