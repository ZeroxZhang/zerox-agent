import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type ElectronBuilderConfig = {
  appId?: string;
  productName?: string;
  asar?: boolean;
  directories?: {
    output?: string;
    buildResources?: string;
  };
  files?: string[];
  mac?: {
    category?: string;
    icon?: string;
    target?: string[];
  };
};

describe("electron-builder config", () => {
  it("packages the built desktop agent and bundled skills for macOS", () => {
    const config = parse(
      readFileSync(path.join(process.cwd(), "electron-builder.yml"), "utf8"),
    ) as ElectronBuilderConfig;

    expect(config).toMatchObject({
      appId: "local.zerox.agent.desktop",
      productName: "Zerox Agent",
      asar: true,
      directories: {
        output: "release",
        buildResources: "build",
      },
      mac: {
        category: "public.app-category.productivity",
        icon: "build/icon.icns",
        target: ["dmg", "zip"],
      },
    });
    expect(config.files).toEqual(
      expect.arrayContaining([
        "dist/**/*",
        "dist-electron/**/*",
        "skills/**/*",
        "package.json",
      ]),
    );
  });
});
