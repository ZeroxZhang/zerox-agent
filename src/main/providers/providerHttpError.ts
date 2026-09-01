import { readResponseTextWithLimit } from "../fetchWithTimeout";
import { PROVIDER_ERROR_MAX_BODY_BYTES } from "../../shared/limits";

const maximumRetryAfterMs = 30_000;

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly code?: string;

  constructor(
    status: number,
    responseHeaders: Readonly<Record<string, string>>,
    code?: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.statusCode = status;
    this.responseHeaders = responseHeaders;
    this.code = code;
  }
}

export async function providerHttpError(
  response: Response,
): Promise<ProviderHttpError> {
  const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after-ms"));
  const retryAfter = parseRetryAfterSeconds(response.headers?.get("retry-after"));
  const code = await readSafeProviderCode(response);
  return new ProviderHttpError(response.status, {
    ...(retryAfterMs === undefined
      ? {}
      : { "retry-after-ms": String(retryAfterMs) }),
    ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  }, code);
}

async function readSafeProviderCode(response: Response): Promise<string | undefined> {
  try {
    const body = await readResponseTextWithLimit(
      response,
      PROVIDER_ERROR_MAX_BODY_BYTES,
      "Provider error",
    );
    const parsed = JSON.parse(body) as {
      code?: unknown;
      type?: unknown;
      error?: { code?: unknown; type?: unknown };
    };
    const value =
      parsed.error?.code ?? parsed.error?.type ?? parsed.code ?? parsed.type;
    if (typeof value !== "string") return undefined;
    return value.trim().replace(/[^\w.\-:/]/g, "_").slice(0, 96) || undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(maximumRetryAfterMs, Math.ceil(parsed));
}

function parseRetryAfterSeconds(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return String(Math.min(maximumRetryAfterMs, Math.ceil(parsed * 1000)) / 1000);
}
