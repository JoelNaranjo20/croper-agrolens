import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface GraphqlErrorItem {
  message: string;
  extensions?: { code?: string; reason?: string };
}

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly errors: GraphqlErrorItem[] = [],
  ) {
    super(message);
    this.name = 'GraphqlError';
  }
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlErrorItem[];
}

/**
 * Deliberately tiny GraphQL client (≈1 kB) instead of Apollo (≈40 kB gz): rural 3G budgets
 * matter more than a normalized cache we don't need.
 *
 * Queries go over GET so the service worker (and any CDN) can cache them — that is what makes
 * the field list available offline. Mutations go over POST and are never cached.
 */
@Injectable({ providedIn: 'root' })
export class GraphqlClient {
  private readonly http = inject(HttpClient);
  private readonly endpoint = '/graphql';

  query<T>(
    query: string,
    variables: Record<string, unknown> = {},
    opts: { fresh?: boolean } = {},
  ): Promise<T> {
    // `fresh`: scenario-style queries that must never be served from cache go over POST.
    if (opts.fresh) return this.mutate<T>(query, variables);
    const params = new HttpParams({
      fromObject: { query: compact(query), variables: JSON.stringify(variables) },
    });
    return this.run<T>(this.http.get<GraphqlResponse<T>>(this.endpoint, { params }));
  }

  mutate<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.run<T>(
      this.http.post<GraphqlResponse<T>>(this.endpoint, { query: compact(query), variables }),
    );
  }

  private async run<T>(req: ReturnType<HttpClient['get']>): Promise<T> {
    let res: GraphqlResponse<T>;
    try {
      res = (await firstValueFrom(req)) as GraphqlResponse<T>;
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        const body = err.error as GraphqlResponse<T> | null;
        if (body?.errors?.length) throw toError(body.errors);
        throw new GraphqlError(
          err.status === 0 ? 'Sin conexión con el servidor' : `Error HTTP ${err.status}`,
          err.status === 0 ? 'NETWORK' : `HTTP_${err.status}`,
        );
      }
      throw err;
    }
    if (res.errors?.length) throw toError(res.errors);
    return res.data as T;
  }
}

function toError(errors: GraphqlErrorItem[]): GraphqlError {
  const first = errors[0]!;
  return new GraphqlError(first.message, first.extensions?.code ?? 'UNKNOWN', errors);
}

/** Shorter URLs for GET queries. */
function compact(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}
