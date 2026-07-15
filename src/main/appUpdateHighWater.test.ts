import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUpdateHighWaterStore } from "./appUpdateHighWater";
import type { VerifiedUpdateManifest } from "./appUpdateManifest";

function manifest(version: string, sequence: number): VerifiedUpdateManifest {
  const zip = `Zerox-Agent-${version}-arm64.zip`;
  const sha512 = Buffer.alloc(64, 4).toString("base64");
  return {
    version,
    sequence,
    keyId: "a".repeat(32),
    tag: `v${version}`,
    issuedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2027-07-14T00:00:00.000Z",
    files: [
      { url: zip, sha512, size: 100 },
      { url: `Zerox-Agent-${version}-arm64.dmg`, sha512, size: 200 },
    ],
    path: zip,
    sha512,
  };
}

describe("update high-water store", () => {
  it("atomically persists the highest accepted signed sequence", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "zerox-update-high-water-"));
    const filePath = path.join(root, "config", "update-high-water.json");
    const store = createUpdateHighWaterStore(filePath);

    await store.save(manifest("3.7.2", 3_007_002), "2026-07-14T01:00:00.000Z");
    await expect(store.load()).resolves.toMatchObject({
      sequence: 3_007_002,
      version: "3.7.2",
      tag: "v3.7.2",
    });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({ schema: 1 });

    await expect(
      store.save(manifest("3.7.1", 3_007_001), "2026-07-14T02:00:00.000Z"),
    ).rejects.toThrow("低于本地已接受版本");
    await expect(store.load()).resolves.toMatchObject({ sequence: 3_007_002 });
  });

  it("fails closed for malformed or symlinked state files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "zerox-update-high-water-"));
    const malformedPath = path.join(root, "malformed.json");
    writeFileSync(malformedPath, "{}\n");
    await expect(createUpdateHighWaterStore(malformedPath).load()).rejects.toThrow(
      "格式无效",
    );

    const target = path.join(root, "target.json");
    const linked = path.join(root, "linked.json");
    writeFileSync(target, "{}\n");
    symlinkSync(target, linked);
    await expect(createUpdateHighWaterStore(linked).load()).rejects.toThrow(
      "文件不安全",
    );
  });

  it("uses a cross-instance monotonic compare-and-set under concurrent writers", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "zerox-update-high-water-"));
    const filePath = path.join(root, "config", "update-high-water.json");
    const stores = Array.from({ length: 40 }, () =>
      createUpdateHighWaterStore(filePath),
    );
    await Promise.allSettled(
      stores.map((store, index) =>
        store.save(
          index % 2 === 0
            ? manifest("3.7.3", 3_007_003)
            : manifest("3.7.2", 3_007_002),
          "2026-07-14T03:00:00.000Z",
        ),
      ),
    );

    await expect(createUpdateHighWaterStore(filePath).load()).resolves.toMatchObject({
      sequence: 3_007_003,
      version: "3.7.3",
    });
  });
});
