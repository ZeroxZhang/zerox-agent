import { chmodSync } from "node:fs";
import path from "node:path";
import { inspectPinnedUnsignedSafeFsHelper } from "./inspect-safe-fs-helper.mjs";
import { EXPECTED_SAFE_FS_HELPER_DIGEST } from "./safe-fs-toolchain-selection.mjs";

export default async function afterPackMac(context) {
  if (context.electronPlatformName !== "darwin") return;
  const helperPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents/Resources/safe-fs/zerox-safe-fs",
  );
  // /dev/fd capabilities intentionally expose no mutable source pathname.
  // electron-builder copies their bytes with a conservative mode, so restore
  // the reviewed executable mode before signing and then revalidate the exact
  // unsigned image that entered the App bundle.
  chmodSync(helperPath, 0o755);
  inspectPinnedUnsignedSafeFsHelper(helperPath, {
    safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST,
  });
}
