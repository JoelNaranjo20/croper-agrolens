export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_GEOMETRY'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED';

const STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_GEOMETRY: 422,
  INVALID_INPUT: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UPSTREAM_UNAVAILABLE: 503,
  UPSTREAM_REJECTED: 422,
};

/** Expected, client-facing failures. Anything else is a 500 and its details are never leaked. */
export class DomainError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = STATUS[code];
  }
}
