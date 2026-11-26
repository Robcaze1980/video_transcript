import { createHash } from 'node:crypto';

/** Stable ID for the reservation tuple sent by Video to Account. */
export function videoReservationId(accountId: string, identityKey: string, inputId: string,
  operation: string, revision: number, requestKey: string): string {
  const tuple = ['vistavo-video-reservation-v1', accountId, identityKey, inputId, operation, revision, requestKey];
  const bytes = createHash('sha256').update(JSON.stringify(tuple)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hash = bytes.toString('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
