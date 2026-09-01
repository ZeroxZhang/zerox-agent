import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type ElectronBuilderConfig = {
  appId?: string;
  productName?: string;
  artifactName?: string;
  asar?: boolean;
  afterPack?: string;
  directories?: {
    output?: string;
    buildResources?: string;
  };
  files?: string[];
  mac?: {
    category?: string;
    icon?: string;
    sign?: string;
    binaries?: string[];
    target?: string[];
  };
  extraResources?: Array<{ from?: string; to?: string }>;
};

describe("electron-builder config", () => {
  it("packages the built desktop agent and bundled skills for macOS", () => {
    const config = parse(
      readFileSync(path.join(process.cwd(), "electron-builder.yml"), "utf8"),
    ) as ElectronBuilderConfig;

    expect(config).toMatchObject({
      appId: "local.zerox.agent.desktop",
      productName: "Zerox Agent",
      artifactName: "Zerox-Agent-${version}-${arch}.${ext}",
      asar: true,
      afterPack: "./scripts/after-pack-mac.mjs",
      directories: {
        output: "release",
        buildResources: "build",
      },
      mac: {
        category: "public.app-category.productivity",
        icon: "build/icon.icns",
        sign: "./scripts/mac-sign.mjs",
        binaries: ["Contents/Resources/safe-fs/zerox-safe-fs"],
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
    expect(config.extraResources).toEqual(expect.arrayContaining([
      {
        from: "${env.ZEROX_SAFE_FS_SOURCE}",
        to: "safe-fs/zerox-safe-fs",
      },
    ]));
  });
});
