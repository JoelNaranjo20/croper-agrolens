import { DomainError } from '../domain/errors.js';
import { VegetationAnalysisSchema, type VegetationAnalysis } from '../domain/field.js';

export interface AiClient {
  analyzeVegetation(
    image: Buffer,
    contentType: string,
    requestId?: string,
  ): Promise<VegetationAnalysis>;
}

/**
 * HTTP client for the Python AI service.
 * - Hard timeout (AbortSignal) so a slow model never ties up request handlers.
 * - Response validated with zod: a contract drift upstream fails loudly here, not in the UI.
 * - Propagates x-request-id for end-to-end tracing across services.
 */
export class HttpAiClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async analyzeVegetation(
    image: Buffer,
    contentType: string,
    requestId?: string,
  ): Promise<VegetationAnalysis> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)], { type: contentType }), 'upload');

    let res: Response;
    try {
      res = await fetch(new URL('/v1/vision/vegetation-index', this.baseUrl), {
        method: 'POST',
        body: form,
        headers: requestId ? { 'x-request-id': requestId } : {},
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `AI service unreachable: ${(err as Error).name}`,
      );
    }

    if (res.status === 413 || res.status === 415 || res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { title?: string };
      throw new DomainError('UPSTREAM_REJECTED', body.title ?? 'Image rejected by AI service');
    }
    if (!res.ok) throw new DomainError('UPSTREAM_UNAVAILABLE', `AI service error ${res.status}`);

    return VegetationAnalysisSchema.parse(await res.json());
  }
}
