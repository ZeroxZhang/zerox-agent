const secretKeyPattern =
  /(?:api.?key|access.?key|access.?token|refresh.?token|token|password|passwd|passphrase|secret|authorization|cookie|credential|private.?key|session.?key|webhook)/i;

export function redactCredentials(value: unknown): unknown {
  return redactCredentialValue(value, new WeakMap<object, unknown>());
}

export function redactCredentialText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[redacted private key]",
    )
    .replace(
      /https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[^\s"'?,;]+/gi,
      "[redacted]",
    )
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
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
      /(^|[?&;,\s{])([a-z][a-z\d_.-]*)(\s*(?:=|:|%3d)\s*)([^?&#\s,;}]+)/gi,
      (
        match,
        prefix: string,
        key: string,
        separator: string,
      ) =>
        isSecretKey(key)
          ? `${prefix}${key}${separator}[redacted]`
          : match,
    )
    .replace(
      /\b(?:sk-(?:proj-)?[a-z\d_-]{6,}|gh[pousr]_[a-z\d_]{8,}|github_pat_[a-z\d_]{8,}|AKIA[A-Z\d]{16}|ASIA[A-Z\d]{16}|AIza[A-Za-z\d_-]{20,}|xox[baprs]-[A-Za-z\d-]{8,}|eyJ[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,})\b/g,
      "[redacted]",
    );
}

export function stringifyRedactedCredentials(value: unknown): string {
  try {
    return JSON.stringify(redactCredentials(value)) ?? "null";
  } catch {
    return '"[unserializable]"';
  }
}

function redactCredentialValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") {
    return redactCredentialText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactCredentialText(value.message),
    };
  }
  const existing = seen.get(value);
  if (existing) {
    return existing;
  }
  if (Array.isArray(value)) {
    const redacted: unknown[] = [];
    seen.set(value, redacted);
    for (const item of value) {
      redacted.push(redactCredentialValue(item, seen));
    }
    return redacted;
  }
  const redacted: Record<string, unknown> = {};
  seen.set(value, redacted);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSecretKey(key)
      ? "[redacted]"
      : redactCredentialValue(item, seen);
  }
  return redacted;
}

function isSecretKey(key: string): boolean {
  return secretKeyPattern.test(key.replace(/[^a-z\d]/gi, ""));
}
