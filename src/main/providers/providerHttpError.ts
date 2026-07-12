const maximumRetryAfterMs = 30_000;

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly responseHeaders: Readonly<Record<string, string>>;

  constructor(status: number, responseHeaders: Readonly<Record<string, string>>) {
    super(`HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.statusCode = status;
    this.responseHeaders = responseHeaders;
  }
}

export function providerHttpError(response: Response): ProviderHttpError {
  const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after-ms"));
  const retryAfter = parseRetryAfterSeconds(response.headers?.get("retry-after"));
  return new ProviderHttpError(response.status, {
    ...(retryAfterMs === undefined
      ? {}
      : { "retry-after-ms": String(retryAfterMs) }),
    ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  });
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
