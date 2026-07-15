import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { verifyUpdateManifest } from "../main/appUpdateManifest";

// @ts-expect-error JavaScript release script intentionally has no declaration file.
import { signUpdateManifest } from "../../scripts/sign-update-manifest.mjs";

function fixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), "zerox-sign-manifest-root-"));
  const keyDir = mkdtempSync(path.join(tmpdir(), "zerox-sign-manifest-key-"));
  mkdirSync(path.join(rootDir, "release"));
  mkdirSync(path.join(rootDir, "build"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(keyDir, "private.pem");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  writeFileSync(
    privateKeyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  chmodSync(privateKeyPath, 0o600);
  writeFileSync(
    path.join(rootDir, "build", "update-signing-public-key.pem"),
    publicKeyPem,
  );
  const sha512 = Buffer.alloc(64, 2).toString("base64");
  const manifestBytes = Buffer.from(
    stringify({
      version: "3.7.1",
      files: [
        { url: "Zerox-Agent-3.7.1-arm64.zip", sha512, size: 100 },
        { url: "Zerox-Agent-3.7.1-arm64.dmg", sha512, size: 200 },
      ],
      path: "Zerox-Agent-3.7.1-arm64.zip",
      sha512,
    }),
  );
  writeFileSync(path.join(rootDir, "release", "latest-mac.yml"), manifestBytes);
  return { rootDir, privateKeyPath, publicKeyPem, manifestBytes };
}

describe("update manifest signer", () => {
  it("creates a runtime-verifiable V2 envelope with monotonic and time bounds", () => {
    const value = fixture();
    const now = new Date("2026-07-15T12:00:00.000Z");
    const result = signUpdateManifest({
      rootDir: value.rootDir,
      env: { ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE: value.privateKeyPath },
      now,
    });
    const signatureBytes = readFileSync(result.signaturePath);

    expect(result.envelope).toMatchObject({
      schema: 2,
      tag: "v3.7.1",
      sequence: 3_007_001,
      issuedAt: now.toISOString(),
    });
    expect(
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes,
        publicKeyPem: value.publicKeyPem,
        now,
      }),
    ).toMatchObject({ version: "3.7.1", sequence: 3_007_001 });
  });

  it("rejects inline, relative, repository-contained, and permissive private keys", () => {
    const value = fixture();
    expect(() =>
      signUpdateManifest({
        rootDir: value.rootDir,
        env: { ZEROX_UPDATE_SIGNING_PRIVATE_KEY: "secret" },
      }),
    ).toThrow("inline update signing keys are forbidden");
    expect(() =>
      signUpdateManifest({
        rootDir: value.rootDir,
        env: { ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE: "private.pem" },
      }),
    ).toThrow("absolute path outside");

    const insideKey = path.join(value.rootDir, "private.pem");
    writeFileSync(insideKey, readFileSync(value.privateKeyPath), { mode: 0o600 });
    chmodSync(insideKey, 0o600);
    expect(() =>
      signUpdateManifest({
        rootDir: value.rootDir,
        env: { ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE: insideKey },
      }),
    ).toThrow("outside the repository");

    chmodSync(value.privateKeyPath, 0o644);
    expect(() =>
      signUpdateManifest({
        rootDir: value.rootDir,
        env: { ZEROX_UPDATE_SIGNING_PRIVATE_KEY_FILE: value.privateKeyPath },
      }),
    ).toThrow("0600 or stricter");
  });
});
