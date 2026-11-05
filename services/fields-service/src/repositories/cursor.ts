import { ObjectId } from 'mongodb';
import { DomainError } from '../domain/errors.js';

/**
 * Opaque cursors (keyset pagination on _id). Unlike skip/limit, cost stays O(limit)
 * at any depth and pages don't shift when new documents are inserted.
 */
export const encodeCursor = (id: string): string => Buffer.from(id).toString('base64url');

export function decodeCursor(cursor: string): ObjectId {
  const raw = Buffer.from(cursor, 'base64url').toString();
  if (!ObjectId.isValid(raw)) throw new DomainError('INVALID_INPUT', 'Invalid cursor');
  return new ObjectId(raw);
}

export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;
}
