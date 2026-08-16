import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAuthoritativeStoreBackend,
  writeStoreJsonAtomically,
} from "./authoritativeStore";
import { createInMemoryStorage } from "./storageDb";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("authoritative store backend", () => {
  it("requires an explicit SQLite dependency for sqlite and dual modes", () => {
    expect(() =>
      createAuthoritativeStoreBackend({
        backend: "sqlite",
        domain: "fixture",
      }),
    ).toThrow('requires SQLite storage for backend "sqlite"');
    expect(() =>
      createAuthoritativeStoreBackend({
        backend: "dual",
        domain: "fixture",
      }),
    ).toThrow('requires SQLite storage for backend "dual"');
  });

  it("makes dual shadow failures visible and closes admission", async () => {
    const storage = await createInMemoryStorage();
    const backend = createAuthoritativeStoreBackend({
      backend: "dual",
      storage,
      domain: "fixture",
    });
    backend.enqueueShadow(async () => {
      throw new Error("shadow failed");
    });

    await expect(
      backend.flushShadowWrites({ close: true }),
    ).rejects.toThrow("shadow failed");
    expect(() => backend.assertWritable()).toThrow(
      "Persistence queue is closed",
    );
    storage.close();
  });

  it("keeps sqlite mode free of compatibility shadow work", async () => {
    const storage = await createInMemoryStorage();
    const backend = createAuthoritativeStoreBackend({
      backend: "sqlite",
      storage,
      domain: "fixture",
    });
    let shadowCalls = 0;
    backend.enqueueShadow(async () => {
      shadowCalls += 1;
    });
    await backend.flushShadowWrites({ close: true });
    expect(shadowCalls).toBe(0);
    storage.close();
  });

  it("writes JSON compatibility snapshots atomically with private mode", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "zerox-authoritative-store-"),
    );
    roots.push(root);
    const filePath = path.join(root, "records.json");
    await writeStoreJsonAtomically({
      directory: root,
      filePath,
      value: { schemaVersion: 1, records: [{ id: "record_1" }] },
    });

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      schemaVersion: 1,
      records: [{ id: "record_1" }],
    });
  });
});
