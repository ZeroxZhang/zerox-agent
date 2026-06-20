import { describe, expect, it } from "vitest";
import {
  createLocationResolver,
  getLocationResourceRoot,
  isPathInsideLocationRoot,
  normalizeLocationBoundaryPath,
  normalizeLocationPath,
  resolveLocationResource,
} from "./locationResource";

const env = {
  homeDir: "/Users/demo",
  workspaceRoot: "/workspace/project",
  platform: "darwin" as const,
};

describe("location resource resolver", () => {
  it("resolves Desktop aliases to the same canonical file and root", () => {
    const resolver = createLocationResolver(env);
    const aliases = [
      "~/Desktop/bookmark_list.md",
      "~/桌面/bookmark_list.md",
      "Desktop/bookmark_list.md",
      "桌面/bookmark_list.md",
      "/Users/demo/Desktop/bookmark_list.md",
    ];

    expect(aliases.map((value) => resolver.resolve(value).path)).toEqual([
      "/Users/demo/Desktop/bookmark_list.md",
      "/Users/demo/Desktop/bookmark_list.md",
      "/Users/demo/Desktop/bookmark_list.md",
      "/Users/demo/Desktop/bookmark_list.md",
      "/Users/demo/Desktop/bookmark_list.md",
    ]);
    expect(aliases.map((value) => resolveLocationResource(value, env).root)).toEqual([
      "/Users/demo/Desktop",
      "/Users/demo/Desktop",
      "/Users/demo/Desktop",
      "/Users/demo/Desktop",
      "/Users/demo/Desktop",
    ]);
  });

  it("resolves Downloads aliases to the same canonical file and root", () => {
    const aliases = [
      "~/Downloads/report.md",
      "~/下载/report.md",
      "Downloads/report.md",
      "下载/report.md",
      "/Users/demo/Downloads/report.md",
    ];

    expect(aliases.map((value) => normalizeLocationPath(value, env))).toEqual([
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
    ]);
    expect(aliases.map((value) => normalizeLocationBoundaryPath(value, env))).toEqual([
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
      "/Users/demo/Downloads/report.md",
    ]);
  });

  it("separates boundary normalization from file resource root extraction", () => {
    expect(normalizeLocationBoundaryPath("~/Downloads/report.md", env)).toBe(
      "/Users/demo/Downloads/report.md",
    );
    expect(getLocationResourceRoot("~/Downloads/report.md", env)).toBe(
      "/Users/demo/Downloads",
    );
    expect(resolveLocationResource("~/Downloads/report.md", env)).toMatchObject({
      path: "/Users/demo/Downloads/report.md",
      root: "/Users/demo/Downloads",
    });
  });

  it("keeps ordinary relative paths workspace-relative", () => {
    expect(normalizeLocationPath("reports/today.md", env)).toBe(
      "/workspace/project/reports/today.md",
    );
  });

  it("handles home shorthand and non-special home paths", () => {
    expect(normalizeLocationPath("~", env)).toBe("/Users/demo");
    expect(normalizeLocationPath("~/Documents/a.md", env)).toBe(
      "/Users/demo/Documents/a.md",
    );
  });

  it("checks canonical containment across equivalent aliases", () => {
    expect(
      isPathInsideLocationRoot("桌面/bookmark_list.md", "~/Desktop", env),
    ).toBe(true);
  });
});
