import { signAsync } from "@electron/osx-sign";
import path from "node:path";

export const safeFsHelperSuffix = path.join(
  "Contents",
  "Resources",
  "safe-fs",
  "zerox-safe-fs",
);

export function buildMacSigningOptions(configuration) {
  const inheritedOptionsForFile = configuration.optionsForFile;
  const safeFsEntitlements = path.resolve(
    import.meta.dirname,
    "..",
    "build",
    "entitlements.safe-fs.plist",
  );
  return {
    ...configuration,
    optionsForFile(filePath) {
      const inherited = inheritedOptionsForFile?.(filePath) ?? {};
      if (!filePath.endsWith(safeFsHelperSuffix)) return inherited;
      return {
        ...inherited,
        entitlements: safeFsEntitlements,
        hardenedRuntime: true,
      };
    },
  };
}

export default async function signMac(configuration) {
  await signAsync(buildMacSigningOptions(configuration));
}
