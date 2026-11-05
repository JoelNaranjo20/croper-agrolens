/** Downstream call context propagated on every hop (tracing + tenancy). */
export interface CallContext {
  tenantId: string;
  requestId: string;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface Problem {
  title?: string;
  code?: string;
  errors?: unknown;
}

/**
 * Minimal JSON HTTP client over native fetch (undici): timeouts, header propagation and
 * problem+json → typed error mapping. No retries on non-idempotent methods by design.
 */
export class JsonHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    ctx: CallContext,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          accept: 'application/json',
          'x-tenant-id': ctx.tenantId,
          'x-request-id': ctx.requestId,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError(
        503,
        `Upstream unavailable (${(err as Error).name})`,
        'UPSTREAM_UNAVAILABLE',
      );
    }

    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as T & Problem;
    if (!res.ok) {
      throw new UpstreamError(
        res.status,
        data.title ?? `Upstream error ${res.status}`,
        data.code,
        data.errors,
      );
    }
    return data;
  }
}
