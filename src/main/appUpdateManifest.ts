import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

const manifestDomain = Buffer.from(
  "ZEROX_AGENT_UPDATE_MANIFEST\0V2\0ZeroxZhang/zerox-agent\0darwin\0stable\0",
  "utf8",
);
const manifestMaxBytes = 128 * 1024;
const signatureMaxBytes = 2 * 1024;
const fetchTimeoutMs = 15_000;
const trustedDownloadHosts = new Set(["github.com"]);

export const updateManifestSignatureUrl =
  "https://github.com/ZeroxZhang/zerox-agent/releases/latest/download/latest-mac.yml.sig";

export type VerifiedUpdateFile = {
  url: string;
  sha512: string;
  size: number;
};

export type VerifiedUpdateManifest = {
  version: string;
  files: VerifiedUpdateFile[];
  path: string;
  sha512: string;
  keyId: string;
  tag: string;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
};

type UpdateInfoLike = {
  version?: string;
  files?: Array<{
    url?: string;
    sha512?: string;
    size?: number;
    sha2?: unknown;
    packageInfo?: unknown;
    packages?: unknown;
    blockMapSize?: unknown;
    isAdminRightsRequired?: unknown;
  }>;
  path?: string;
  sha512?: string;
  tag?: string;
  packages?: unknown;
  sha2?: unknown;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SignatureEnvelope = {
  schema: 2;
  algorithm: "ed25519";
  keyId: string;
  tag: string;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  manifestSha512: string;
  signature: string;
};

const maximumEnvelopeLifetimeMs = 370 * 24 * 60 * 60 * 1000;

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+$/.test(normalized)
    ? normalized
    : null;
}

function isSha512(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").length === 64;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function updateSequenceForVersion(version: string): number {
  const normalized = normalizeVersion(version);
  const match = normalized ? /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized) : null;
  if (!match) throw new Error("应用版本格式无效");
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 999)) {
    throw new Error("应用版本超出更新序号范围");
  }
  return (parts[0] ?? 0) * 1_000_000 + (parts[1] ?? 0) * 1_000 + (parts[2] ?? 0);
}

function isTrustedResponseUrl(value: string): boolean {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      (parsed.port === "" || parsed.port === "443") &&
      (trustedDownloadHosts.has(parsed.hostname) ||
        parsed.hostname.endsWith(".githubusercontent.com"))
    );
  } catch {
    return false;
  }
}

async function fetchBytes(
  url: string,
  maxBytes: number,
  fetchFn: FetchLike,
): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchFn(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/octet-stream" },
    });
    if (!response.ok) {
      throw new Error(`更新签名服务器返回 HTTP ${response.status}`);
    }
    if (!isTrustedResponseUrl(response.url)) {
      throw new Error("更新签名服务器跳转到了不受信任的地址");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("更新签名响应超过大小限制");
    }
    if (!response.body) {
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > maxBytes) {
        throw new Error("更新签名响应超过大小限制");
      }
      return body;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("更新签名响应超过大小限制");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    clearTimeout(timeout);
  }
}

export function computeUpdateSigningKeyId(publicKeyPem: string | Buffer): string {
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("更新签名公钥必须使用 Ed25519");
  }
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}

export function parseSignatureEnvelope(bytes: Buffer): SignatureEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("更新清单签名格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("更新清单签名格式无效");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "algorithm,expiresAt,issuedAt,keyId,manifestSha512,schema,sequence,signature,tag" ||
    record.schema !== 2 ||
    record.algorithm !== "ed25519" ||
    typeof record.keyId !== "string" ||
    !/^[a-f0-9]{32}$/.test(record.keyId) ||
    typeof record.tag !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(record.tag) ||
    !Number.isSafeInteger(record.sequence) ||
    Number(record.sequence) <= 0 ||
    !isCanonicalTimestamp(record.issuedAt) ||
    !isCanonicalTimestamp(record.expiresAt) ||
    !isSha512(record.manifestSha512) ||
    typeof record.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(record.signature) ||
    Buffer.from(record.signature, "base64").length !== 64
  ) {
    throw new Error("更新清单签名格式无效");
  }
  return record as SignatureEnvelope;
}

function uint64Bytes(value: number): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}

export function createUpdateManifestSignatureMessage(options: {
  keyId: string;
  tag: string;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  manifestBytes: Buffer;
}): Buffer {
  return Buffer.concat([
    manifestDomain,
    Buffer.from(
      `${options.keyId}\0${options.tag}\0${options.sequence}\0${options.issuedAt}\0${options.expiresAt}\0`,
      "utf8",
    ),
    uint64Bytes(options.manifestBytes.length),
    options.manifestBytes,
  ]);
}

function parseManifest(
  bytes: Buffer,
): Omit<
  VerifiedUpdateManifest,
  "keyId" | "tag" | "sequence" | "issuedAt" | "expiresAt"
> {
  let value: unknown;
  try {
    value = parse(bytes.toString("utf8"), {
      maxAliasCount: 0,
      uniqueKeys: true,
    });
  } catch {
    throw new Error("已签名更新清单不是有效 YAML");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("已签名更新清单格式无效");
  }
  const record = value as Record<string, unknown>;
  if ("packages" in record) {
    throw new Error("已签名 macOS 更新清单不得包含 packages");
  }
  const version = normalizeVersion(record.version);
  if (!version || !Array.isArray(record.files) || record.files.length !== 2) {
    throw new Error("已签名更新清单格式无效");
  }

  const pattern = new RegExp(
    `^Zerox-Agent-${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(arm64|x64|universal)\\.(zip|dmg)$`,
  );
  const extensions = new Set<string>();
  const architectures = new Set<string>();
  const files = record.files.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("已签名更新清单文件条目无效");
    }
    const file = entry as Record<string, unknown>;
    const match = typeof file.url === "string" ? pattern.exec(file.url) : null;
    if (
      !match ||
      !isSha512(file.sha512) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) <= 0 ||
      Number(file.size) > 1024 * 1024 * 1024
    ) {
      throw new Error("已签名更新清单文件条目无效");
    }
    architectures.add(match[1] ?? "");
    extensions.add(match[2] ?? "");
    return {
      url: file.url as string,
      sha512: file.sha512,
      size: Number(file.size),
    };
  });
  if (
    architectures.size !== 1 ||
    extensions.size !== 2 ||
    !extensions.has("zip") ||
    !extensions.has("dmg")
  ) {
    throw new Error("已签名更新清单必须包含同架构 ZIP 和 DMG");
  }
  const zip = files.find((file) => file.url.endsWith(".zip"));
  if (
    !zip ||
    record.path !== zip.url ||
    record.sha512 !== zip.sha512
  ) {
    throw new Error("已签名更新清单主文件必须匹配 ZIP");
  }
  return { version, files, path: zip.url, sha512: zip.sha512 };
}

export function verifyUpdateManifest(options: {
  manifestBytes: Buffer;
  signatureBytes: Buffer;
  publicKeyPem: string | Buffer;
  envelope?: SignatureEnvelope;
  now?: Date;
}): VerifiedUpdateManifest {
  const publicKey = createPublicKey(options.publicKeyPem);
  const keyId = computeUpdateSigningKeyId(options.publicKeyPem);
  const envelope =
    options.envelope ?? parseSignatureEnvelope(options.signatureBytes);
  if (envelope.keyId !== keyId) {
    throw new Error("更新清单签名密钥不匹配");
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const issuedAtMs = Date.parse(envelope.issuedAt);
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (
    !Number.isFinite(nowMs) ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > maximumEnvelopeLifetimeMs ||
    issuedAtMs > nowMs ||
    expiresAtMs <= nowMs
  ) {
    throw new Error("更新清单签名已过期或时间范围无效");
  }
  const manifestSha512 = createHash("sha512")
    .update(options.manifestBytes)
    .digest("base64");
  if (envelope.manifestSha512 !== manifestSha512) {
    throw new Error("更新清单内容哈希与签名信封不一致");
  }
  const signature = Buffer.from(envelope.signature, "base64");
  const message = createUpdateManifestSignatureMessage({
    keyId,
    tag: envelope.tag,
    sequence: envelope.sequence,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    manifestBytes: options.manifestBytes,
  });
  if (!verifySignature(null, message, publicKey, signature)) {
    throw new Error("更新清单签名验证失败");
  }
  const manifest = parseManifest(options.manifestBytes);
  if (envelope.tag !== `v${manifest.version}`) {
    throw new Error("更新清单版本与签名标签不一致");
  }
  if (envelope.sequence !== updateSequenceForVersion(manifest.version)) {
    throw new Error("更新清单版本与单调序号不一致");
  }
  return {
    ...manifest,
    keyId,
    tag: envelope.tag,
    sequence: envelope.sequence,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
  };
}

export async function fetchVerifiedUpdateManifest(options: {
  resourcesPath: string;
  fetchFn?: FetchLike;
  now?: Date;
}): Promise<VerifiedUpdateManifest> {
  const fetchFn = options.fetchFn ?? fetch;
  const [signatureBytes, publicKeyPem] = await Promise.all([
    fetchBytes(updateManifestSignatureUrl, signatureMaxBytes, fetchFn),
    readFile(path.join(options.resourcesPath, "update-signing-public-key.pem")),
  ]);
  const envelope = parseSignatureEnvelope(signatureBytes);
  const exactManifestUrl = `https://github.com/ZeroxZhang/zerox-agent/releases/download/${envelope.tag}/latest-mac.yml`;
  const manifestBytes = await fetchBytes(
    exactManifestUrl,
    manifestMaxBytes,
    fetchFn,
  );
  return verifyUpdateManifest({
    manifestBytes,
    signatureBytes,
    publicKeyPem,
    envelope,
    now: options.now,
  });
}

export function assertUpdateInfoMatchesManifest(
  updateInfo: UpdateInfoLike,
  manifest: VerifiedUpdateManifest,
): void {
  if (updateInfo.packages !== undefined || updateInfo.sha2 !== undefined) {
    throw new Error("更新服务器返回了未签名的下载扩展字段");
  }
  if (
    updateInfo.files?.some(
      (file) =>
        file.sha2 !== undefined ||
        file.packageInfo !== undefined ||
        file.packages !== undefined ||
        file.blockMapSize !== undefined ||
        file.isAdminRightsRequired !== undefined,
    )
  ) {
    throw new Error("更新服务器文件条目包含未签名的下载扩展字段");
  }
  if (normalizeVersion(updateInfo.version) !== manifest.version) {
    throw new Error("更新服务器版本与已签名清单不一致");
  }
  if (updateInfo.tag !== manifest.tag) {
    throw new Error("更新服务器标签与已签名清单不一致");
  }
  if (!Array.isArray(updateInfo.files) || updateInfo.files.length !== manifest.files.length) {
    throw new Error("更新服务器文件列表与已签名清单不一致");
  }
  const normalizeFiles = (
    files: Array<{ url?: string; sha512?: string; size?: number }>,
  ) =>
    files
      .map((file) => ({
        url: file.url ?? "",
        sha512: file.sha512 ?? "",
        size: file.size ?? -1,
      }))
      .sort((left, right) => left.url.localeCompare(right.url));
  if (
    JSON.stringify(normalizeFiles(updateInfo.files)) !==
    JSON.stringify(normalizeFiles(manifest.files)) ||
    updateInfo.path !== manifest.path ||
    updateInfo.sha512 !== manifest.sha512
  ) {
    throw new Error("更新服务器哈希与已签名清单不一致");
  }
}

export async function verifyDownloadedUpdateFiles(
  downloadedPath: string,
  manifest: VerifiedUpdateManifest,
): Promise<void> {
  const zip = manifest.files.find((file) => file.url.endsWith(".zip"));
  if (!zip) {
    throw new Error("更新下载文件列表与已签名清单不一致");
  }
  if (!path.isAbsolute(downloadedPath) || path.basename(downloadedPath) !== zip.url) {
    throw new Error("更新下载文件名与已签名清单不一致");
  }
  const stat = await lstat(downloadedPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== zip.size) {
    throw new Error("更新下载文件大小与已签名清单不一致");
  }
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(downloadedPath)) {
    hash.update(chunk);
  }
  if (hash.digest("base64") !== zip.sha512) {
    throw new Error("更新下载文件哈希与已签名清单不一致");
  }
}
