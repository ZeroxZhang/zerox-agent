const MAX_ACCEPTANCE_SUMMARY_BYTES = 1_024;
const MAX_EVIDENCE_REF_BYTES = 512;
const MAX_REDACTION_INPUT_CHARS = 65_536;

const SECRET_KEYS = new Set([
  "apikey",
  "accesskey",
  "accesstoken",
  "authorization",
  "awssessiontoken",
  "awssecuritytoken",
  "bearer",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "passwd",
  "passphrase",
  "privatekey",
  "pwd",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessionkey",
  "sessiontoken",
  "securitytoken",
  "token",
  "webhook",
  "webhookurl",
]);

const SECRET_SUFFIXES = [
  "apikey",
  "accesskey",
  "accesstoken",
  "awssessiontoken",
  "awssecuritytoken",
  "bearertoken",
  "clientsecret",
  "credential",
  "credentials",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessionkey",
  "sessiontoken",
  "securitytoken",
  "webhook",
  "webhookurl",
] as const;

export function redactAndBoundAcceptanceSummary(value: unknown): string {
  return redactAndBound(value, MAX_ACCEPTANCE_SUMMARY_BYTES);
}

export function redactAndBoundEvidenceRef(value: unknown): string {
  return redactAndBound(value, MAX_EVIDENCE_REF_BYTES);
}

function redactAndBound(value: unknown, maxBytes: number): string {
  const raw = safeString(value)
    .slice(0, MAX_REDACTION_INPUT_CHARS)
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  const patternRedacted = raw
    .replace(
      /https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[^\s"'?,;]+/gi,
      "[redacted]",
    )
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^\/@\s]+@/gi, "$1[redacted]@")
    .replace(
      /\bAuthorization\s*:\s*(?:Basic|Bearer)\s+[^\s,;]+/gi,
      "Authorization: [redacted]",
    )
    .replace(/\bSet-Cookie\s*:\s*[^;\r\n]+/gi, "Set-Cookie: [redacted]")
    .replace(/\bCookie\s*:\s*[^,\r\n]+/gi, "Cookie: [redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /((?:\\)?["'])([a-z][a-z\d_.-]*)\1\s*:\s*((?:\\)?["'])[^"']*?\3/gi,
      (match, keyQuote: string, key: string, valueQuote: string) =>
        isSecretKey(key)
          ? `${keyQuote}${key}${keyQuote}:${valueQuote}[redacted]${valueQuote}`
          : match,
    )
    .replace(
      /(^|[?&;,\s{])(\b[a-z][a-z\d_.-]*\b)(\s*(?:=|:|%3d)\s*)([^?&#\s,;}]+)/gi,
      (match, prefix: string, key: string, separator: string) =>
        isSecretKey(key)
          ? `${prefix}${key}${separator}[redacted]`
          : match,
    )
    .replace(
      /\b(?:sk-(?:proj-)?[a-z\d_-]{6,}|gh[pousr]_[a-z\d_]{8,}|github_pat_[a-z\d_]{8,}|AKIA[A-Z\d]{16}|ASIA[A-Z\d]{16}|AIza[A-Za-z\d_-]{20,}|xox[baprs]-[A-Za-z\d-]{8,}|eyJ[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,})\b/g,
      "[redacted]",
    );
  const redacted = redactSecretPathSegments(patternRedacted).trim();
  return truncateUtf8(redacted, maxBytes);
}

function redactSecretPathSegments(value: string): string {
  const segments = value.split("/");
  for (let index = 0; index + 1 < segments.length; index += 1) {
    if (isSecretKey(segments[index] ?? "")) {
      segments[index + 1] = "[redacted]";
    }
  }
  return segments.join("/");
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z\d]/g, "");
  return (
    SECRET_KEYS.has(normalized) ||
    SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix);
  let end = Math.max(0, maxBytes - suffixBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString("utf8")}${suffix}`;
}

function safeString(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value ?? "");
  } catch {
    return "[unreadable]";
  }
}
