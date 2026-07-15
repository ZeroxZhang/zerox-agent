import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import {
  assertUpdateInfoMatchesManifest,
  computeUpdateSigningKeyId,
  createUpdateManifestSignatureMessage,
  fetchVerifiedUpdateManifest,
  verifyDownloadedUpdateFiles,
  verifyUpdateManifest,
} from "./appUpdateManifest";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const keyId = computeUpdateSigningKeyId(publicKeyPem);
  const sha512 = Buffer.alloc(64, 5).toString("base64");
  const manifest = {
    version: "3.7.2",
    files: [
      {
        url: "Zerox-Agent-3.7.2-arm64.zip",
        sha512,
        size: 100,
      },
      {
        url: "Zerox-Agent-3.7.2-arm64.dmg",
        sha512,
        size: 200,
      },
    ],
    path: "Zerox-Agent-3.7.2-arm64.zip",
    sha512,
  };
  const manifestBytes = Buffer.from(stringify(manifest));
  const tag = "v3.7.2";
  const sequence = 3_007_002;
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 - 60_000).toISOString();
  const signature = sign(
    null,
    createUpdateManifestSignatureMessage({
      keyId,
      tag,
      sequence,
      issuedAt,
      expiresAt,
      manifestBytes,
    }),
    privateKey,
  );
  const envelope = {
    schema: 2,
    algorithm: "ed25519",
    keyId,
    tag,
    sequence,
    issuedAt,
    expiresAt,
    manifestSha512: createHash("sha512")
      .update(manifestBytes)
      .digest("base64"),
    signature: signature.toString("base64"),
  };
  const signatureBytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  return {
    manifest,
    manifestBytes,
    signatureBytes,
    publicKeyPem,
    privateKey,
    envelope,
  };
}

describe("signed update manifest", () => {
  it("verifies the exact manifest bytes and returns a bounded projection", () => {
    const value = fixture();
    expect(
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: value.signatureBytes,
        publicKeyPem: value.publicKeyPem,
      }),
    ).toEqual({
      ...value.manifest,
      keyId: value.envelope.keyId,
      tag: value.envelope.tag,
      sequence: value.envelope.sequence,
      issuedAt: value.envelope.issuedAt,
      expiresAt: value.envelope.expiresAt,
    });
  });

  it("rejects manifest tampering, key substitution, and tag substitution", () => {
    const value = fixture();
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: Buffer.concat([value.manifestBytes, Buffer.from("# changed\n")]),
        signatureBytes: value.signatureBytes,
        publicKeyPem: value.publicKeyPem,
      }),
    ).toThrow("内容哈希");

    const otherKey = generateKeyPairSync("ed25519").publicKey.export({
      format: "pem",
      type: "spki",
    });
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: value.signatureBytes,
        publicKeyPem: otherKey,
      }),
    ).toThrow("密钥不匹配");

    const changedEnvelope = {
      ...value.envelope,
      tag: "v3.7.3",
    };
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: Buffer.from(JSON.stringify(changedEnvelope)),
        publicKeyPem: value.publicKeyPem,
      }),
    ).toThrow("签名验证失败");
  });

  it("rejects unsafe manifest shapes before electron-updater sees them", () => {
    const value = fixture();
    const unsafeBytes = Buffer.from(
      stringify({
        ...value.manifest,
        files: [
          { ...value.manifest.files[0], url: "../Zerox-Agent-3.7.2-arm64.zip" },
          value.manifest.files[1],
        ],
      }),
    );
    const signature = sign(
      null,
      createUpdateManifestSignatureMessage({
        keyId: value.envelope.keyId,
        tag: value.envelope.tag,
        sequence: value.envelope.sequence,
        issuedAt: value.envelope.issuedAt,
        expiresAt: value.envelope.expiresAt,
        manifestBytes: unsafeBytes,
      }),
      value.privateKey,
    );
    const envelope = {
      ...value.envelope,
      manifestSha512: createHash("sha512").update(unsafeBytes).digest("base64"),
      signature: signature.toString("base64"),
    };
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: unsafeBytes,
        signatureBytes: Buffer.from(JSON.stringify(envelope)),
        publicKeyPem: value.publicKeyPem,
      }),
    ).toThrow("文件条目无效");
  });

  it("compares every security-relevant updater file field", () => {
    const value = fixture();
    const verified = verifyUpdateManifest({
      manifestBytes: value.manifestBytes,
      signatureBytes: value.signatureBytes,
      publicKeyPem: value.publicKeyPem,
    });
    expect(() =>
      assertUpdateInfoMatchesManifest(
        { ...value.manifest, tag: value.envelope.tag },
        verified,
      ),
    ).not.toThrow();
    expect(() =>
      assertUpdateInfoMatchesManifest(
        {
          ...value.manifest,
          tag: value.envelope.tag,
          files: value.manifest.files.map((file, index) =>
            index === 0 ? { ...file, size: file.size + 1 } : file,
          ),
        },
        verified,
      ),
    ).toThrow("哈希");
    expect(() =>
      assertUpdateInfoMatchesManifest(
        { ...value.manifest, tag: value.envelope.tag, packages: {} },
        verified,
      ),
    ).toThrow("未签名的下载扩展字段");
    expect(() =>
      assertUpdateInfoMatchesManifest(
        {
          ...value.manifest,
          tag: value.envelope.tag,
          files: value.manifest.files.map((file, index) =>
            index === 0 ? { ...file, sha2: "attacker-controlled" } : file,
          ),
        },
        verified,
      ),
    ).toThrow("文件条目包含未签名");
  });

  it("rejects expired envelopes and sequence substitution", () => {
    const value = fixture();
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: value.signatureBytes,
        publicKeyPem: value.publicKeyPem,
        now: new Date(Date.parse(value.envelope.expiresAt) + 1),
      }),
    ).toThrow("已过期");

    const changedEnvelope = { ...value.envelope, sequence: value.envelope.sequence + 1 };
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: Buffer.from(JSON.stringify(changedEnvelope)),
        publicKeyPem: value.publicKeyPem,
      }),
    ).toThrow("签名验证失败");

    const futureIssuedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const futureExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const futureEnvelope = {
      ...value.envelope,
      issuedAt: futureIssuedAt,
      expiresAt: futureExpiresAt,
    };
    futureEnvelope.signature = sign(
      null,
      createUpdateManifestSignatureMessage({
        keyId: futureEnvelope.keyId,
        tag: futureEnvelope.tag,
        sequence: futureEnvelope.sequence,
        issuedAt: futureEnvelope.issuedAt,
        expiresAt: futureEnvelope.expiresAt,
        manifestBytes: value.manifestBytes,
      }),
      value.privateKey,
    ).toString("base64");
    expect(() =>
      verifyUpdateManifest({
        manifestBytes: value.manifestBytes,
        signatureBytes: Buffer.from(JSON.stringify(futureEnvelope)),
        publicKeyPem: value.publicKeyPem,
        now: new Date(),
      }),
    ).toThrow("时间范围无效");
  });

  it("rehashes the exact regular ZIP returned by the active download promise", async () => {
    const value = fixture();
    const directory = mkdtempSync(path.join(tmpdir(), "zerox-downloaded-update-"));
    const zipPath = path.join(directory, "Zerox-Agent-3.7.2-arm64.zip");
    const body = Buffer.from("verified downloaded update");
    writeFileSync(zipPath, body);
    const verified = verifyUpdateManifest({
      manifestBytes: value.manifestBytes,
      signatureBytes: value.signatureBytes,
      publicKeyPem: value.publicKeyPem,
    });
    const manifest = {
      ...verified,
      files: verified.files.map((file) =>
        file.url.endsWith(".zip")
          ? {
              ...file,
              size: body.length,
              sha512: createHash("sha512").update(body).digest("base64"),
            }
          : file,
      ),
    };
    manifest.sha512 = manifest.files.find((file) => file.url.endsWith(".zip"))!.sha512;

    await expect(verifyDownloadedUpdateFiles(zipPath, manifest)).resolves.toBeUndefined();
    writeFileSync(zipPath, "tampered");
    await expect(verifyDownloadedUpdateFiles(zipPath, manifest)).rejects.toThrow(
      "大小",
    );
  });

  it("uses the signed tag to fetch an exact-tag manifest", async () => {
    const value = fixture();
    const resourcesPath = mkdtempSync(path.join(tmpdir(), "zerox-update-key-"));
    mkdirSync(resourcesPath, { recursive: true });
    writeFileSync(
      path.join(resourcesPath, "update-signing-public-key.pem"),
      value.publicKeyPem,
    );
    const requested: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      return new Response(
        url.endsWith(".sig") ? value.signatureBytes : value.manifestBytes,
        { status: 200 },
      );
    });

    await expect(
      fetchVerifiedUpdateManifest({ resourcesPath, fetchFn }),
    ).resolves.toMatchObject({ version: "3.7.2", tag: "v3.7.2" });
    expect(requested).toEqual([
      "https://github.com/ZeroxZhang/zerox-agent/releases/latest/download/latest-mac.yml.sig",
      "https://github.com/ZeroxZhang/zerox-agent/releases/download/v3.7.2/latest-mac.yml",
    ]);
  });

  it("rejects oversized signature responses before reading the body", async () => {
    const resourcesPath = mkdtempSync(path.join(tmpdir(), "zerox-update-key-"));
    writeFileSync(
      path.join(resourcesPath, "update-signing-public-key.pem"),
      fixture().publicKeyPem,
    );
    const fetchFn = vi.fn(async () =>
      new Response("small", {
        status: 200,
        headers: { "content-length": "5000" },
      }),
    );

    await expect(
      fetchVerifiedUpdateManifest({ resourcesPath, fetchFn }),
    ).rejects.toThrow("超过大小限制");
  });
});
