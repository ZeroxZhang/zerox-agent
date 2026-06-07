import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("gitignore", () => {
  it("keeps generated desktop release artifacts out of source control", () => {
    const gitignore = readFileSync(
      path.join(process.cwd(), ".gitignore"),
      "utf8",
    );

    expect(gitignore).toContain("release/");
  });

  it("keeps local model credential files out of source control", () => {
    const gitignore = readFileSync(
      path.join(process.cwd(), ".gitignore"),
      "utf8",
    );

    expect(gitignore).toContain(".api_info.md");
  });
});
