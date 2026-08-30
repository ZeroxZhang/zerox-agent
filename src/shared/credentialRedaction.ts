const secretKeyPattern =
  /(?:api.?key|access.?key|access.?token|refresh.?token|token|password|passwd|passphrase|secret|authorization|cookie|credential|private.?key|session.?key|webhook)/i;
const safeTokenTelemetryKeys = new Set([
  "aftertokens",
  "availabletokens",
  "beforetokens",
  "budgettokens",
  "cachereadinputtokens",
  "cachereadtokens",
  "cachedinputtokens",
  "cachedcontenttokencount",
  "cachewriteinputtokens",
  "cachewritetokens",
  "candidatestokencount",
  "chattokens",
  "checkpointedtokens",
  "coldsummarybudgettokens",
  "compactedrequesttokens",
  "compactedtokens",
  "completiontokens",
  "contenttokens",
  "contexttokenbudget",
  "contextwindowtokens",
  "corebudgettokens",
  "currentmaxtokens",
  "currenttokens",
  "effectivetailtokens",
  "estimatedtokens",
  "expectedtokens",
  "fixedrequesttokens",
  "goaltokens",
  "initialmaxtokens",
  "inputtokens",
  "maxtokens",
  "maxoutputtokens",
  "messagetokenbudget",
  "messagetokens",
  "outputtokens",
  "plantokens",
  "prompttokencount",
  "prompttokens",
  "recallbudgettokens",
  "reasoningtokens",
  "remainingtokens",
  "safetymargintokens",
  "systemtokens",
  "tailtokenbudget",
  "tailtokens",
  "thinkingbudgettokens",
  "titletokens",
  "tooldefinitiontokens",
  "tokenbudget",
  "tokencount",
  "tokenlimit",
  "tokensconsumed",
  "tokensestimated",
  "totaltokens",
  "turntokens",
]);

export function redactCredentials(value: unknown): unknown {
  return redactCredentialValue(value, new WeakMap<object, unknown>());
}

export function redactCredentialText(value: string): string {
  return redactOverlappingQuotedCredentialAssignments(
    redactYamlBlockCredentialScalars(value),
  )
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
      /\bAuthorization\s*:\s*[^\r\n]+/gi,
      "Authorization: [redacted]",
    )
    .replace(/\bSet-Cookie\s*:\s*[^;\r\n]+/gi, "Set-Cookie: [redacted]")
    .replace(/\bCookie\s*:\s*[^,\r\n]+/gi, "Cookie: [redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /((?:(?:\\+)?["'])((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)(?:\\+)?["']\s*(?:\+?=|＋?＝|:|：|%3d|\\u003d|\\u003a)\s*)((?:\\+)?["'])[^"'\r\n]*?((?:\\+)?["'])/gi,
      (
        match,
        prefix: string,
        key: string,
        valueQuote: string,
        closingQuote: string,
      ) =>
        isSecretKey(key)
          ? `${prefix}${valueQuote}[redacted]${closingQuote}`
          : match,
    )
    .replace(
      /(^|\s)([\-－]{2})((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)(\s+|\+?=|＋?＝)((?:\\+)?["'])[^"'\r\n]*?\5/gi,
      (
        match,
        prefix: string,
        flagPrefix: string,
        key: string,
        separator: string,
        valueQuote: string,
      ) =>
        isSecretKey(key)
          ? `${prefix}${flagPrefix}${key}${separator}${valueQuote}[redacted]${valueQuote}`
          : match,
    )
    .replace(
      /(^|\s)([\-－]{2})((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)(\s+|\+?=|＋?＝)([^\s,;}"']+)/gi,
      (
        match,
        prefix: string,
        flagPrefix: string,
        key: string,
        separator: string,
      ) =>
        isSecretKey(key)
          ? `${prefix}${flagPrefix}${key}${separator}[redacted]`
          : match,
    )
    .replace(
      /(^|[?&;,\s{"'(:：\[（])((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)(\s*(?:\+?=|＋?＝|:|：|%3d|\\u003d|\\u003a)\s*)((?:\\+)?["'])[^"'\r\n]*?\4/gi,
      (
        match,
        prefix: string,
        key: string,
        separator: string,
        valueQuote: string,
      ) =>
        isSecretKey(key)
          ? `${prefix}${key}${separator}${valueQuote}[redacted]${valueQuote}`
          : match,
    )
    .replace(
      /(^|[?&;,\s{"'(:：\[（])((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)(\s*(?:\+?=|＋?＝|:|：|%3d|\\u003d|\\u003a)\s*)([^?&#\s,;}"']+)/gi,
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

function redactOverlappingQuotedCredentialAssignments(value: string): string {
  let redacted = value;
  const assignment =
    /((?:\\+)?["'])((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)((?:\\+)?["']\s*(?:\+?=|＋?＝|:|：|%3d|\\u003d|\\u003a)\s*)((?:\\+)?["'])([^"'\r\n]*?)((?:\\+)?["'])/iy;

  // Scan from right to left so a non-secret outer JSON string cannot consume
  // the start of a nested escaped credential assignment before it is checked.
  for (let index = redacted.length - 1; index >= 0; index -= 1) {
    assignment.lastIndex = index;
    const match = assignment.exec(redacted);
    if (!match || !isSecretKey(match[2])) {
      continue;
    }
    redacted = `${redacted.slice(0, index)}${match[1]}${match[2]}${match[3]}${match[4]}[redacted]${match[6]}${redacted.slice(index + match[0].length)}`;
  }
  return redacted;
}

function redactYamlBlockCredentialScalars(value: string): string {
  const lines = value.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const content = line.replace(/[\r\n]+$/, "");
    const header = content.match(
      /^([ \t]*)((?:[a-z\d_.-]|[\uFF01-\uFF5E]|\\u[0-9a-f]{4}|%[0-9a-f]{2})+)\s*:\s*[|>][+-]?(?:\s+#.*)?\s*$/i,
    );
    if (!header || !isSecretKey(header[2])) {
      continue;
    }
    const headerIndent = header[1].length;
    for (
      let scalarIndex = index + 1;
      scalarIndex < lines.length;
      scalarIndex += 1
    ) {
      const scalarLine = lines[scalarIndex] ?? "";
      const scalarContent = scalarLine.replace(/[\r\n]+$/, "");
      const lineEnding = scalarLine.slice(scalarContent.length);
      if (scalarContent.trim().length === 0) {
        continue;
      }
      const scalarIndent = scalarContent.match(/^[ \t]*/)?.[0].length ?? 0;
      if (scalarIndent <= headerIndent) {
        break;
      }
      lines[scalarIndex] =
        `${scalarContent.slice(0, scalarIndent)}[redacted]${lineEnding}`;
    }
  }
  return lines.join("");
}

export function stringifyRedactedCredentials(value: unknown): string {
  try {
    return JSON.stringify(redactCredentials(value)) ?? "null";
  } catch {
    return '"[unserializable]"';
  }
}

export function redactCredentialJsonText(value: string): string {
  try {
    return stringifyRedactedCredentials(JSON.parse(value));
  } catch {
    return '{"redacted":"invalid_tool_arguments"}';
  }
}

export function redactCredentialString(value: string): string {
  const redacted = redactCredentials(value);
  return typeof redacted === "string" ? redacted : "[redacted]";
}

function redactCredentialValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
      || (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") {
          const safeParsed = redactCredentialValue(parsed, seen);
          return JSON.stringify(safeParsed) === JSON.stringify(parsed)
            ? value
            : JSON.stringify(safeParsed);
        }
      } catch {
        // Preserve non-JSON text through the ordinary credential scrubber.
      }
    }
    return redactCredentialText(redactEmbeddedJsonFragments(value));
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
    redacted[key] = shouldRedactSecretKey(key, item)
      ? "[redacted]"
      : redactCredentialValue(item, seen);
  }
  return redacted;
}

function shouldRedactSecretKey(key: string, value: unknown): boolean {
  if (!isSecretKey(key)) {
    return false;
  }
  const normalizedKey = normalizeSecretKey(key);
  return !(
    safeTokenTelemetryKeys.has(normalizedKey)
    && (typeof value === "number" || typeof value === "boolean")
  );
}

export function isCredentialKey(key: string): boolean {
  return secretKeyPattern.test(normalizeSecretKey(key));
}

function isSecretKey(key: string): boolean {
  return isCredentialKey(key);
}

function normalizeSecretKey(key: string): string {
  let normalized = key.normalize("NFKC");
  for (let depth = 0; depth < 4; depth += 1) {
    const decoded = normalized
      .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .normalize("NFKC");
    if (decoded === normalized) {
      break;
    }
    normalized = decoded;
  }
  return normalized
    .replace(/[^a-z\d]/gi, "")
    .toLowerCase();
}

function redactEmbeddedJsonFragments(value: string): string {
  let cursor = 0;
  let scan = 0;
  let redacted = "";
  let changed = false;
  while (scan < value.length) {
    if (value[scan] !== "{" && value[scan] !== "[") {
      scan += 1;
      continue;
    }
    const end = findBalancedJsonEnd(value, scan);
    if (end === null) {
      scan += 1;
      continue;
    }
    const candidate = value.slice(scan, end + 1);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") {
        const safeParsed = redactCredentialValue(
          parsed,
          new WeakMap<object, unknown>(),
        );
        redacted += value.slice(cursor, scan);
        redacted += JSON.stringify(safeParsed) === JSON.stringify(parsed)
          ? candidate
          : JSON.stringify(safeParsed);
        cursor = end + 1;
        scan = end + 1;
        changed = true;
        continue;
      }
    } catch {
      // An invalid outer fragment may still contain a valid inner fragment.
    }
    scan += 1;
  }
  return changed ? `${redacted}${value.slice(cursor)}` : value;
}

function findBalancedJsonEnd(value: string, start: number): number | null {
  const stack: string[] = [value[start]];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") {
      continue;
    }
    const open = stack.at(-1);
    if (
      (open === "{" && character !== "}")
      || (open === "[" && character !== "]")
    ) {
      return null;
    }
    stack.pop();
    if (stack.length === 0) {
      return index;
    }
  }
  return null;
}
