/**
 * LV-019.B C2a (docs/specs/LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md): constants shared by Account and Video for partial settlement and for a
 * release after a provider admission. Pure data and predicates, no I/O.
 */
export const RESOLUTION_KINDS=['no_speech','not_delivered','unknown_expired'] as const;
export type ResolutionKind=typeof RESOLUTION_KINDS[number];
/** Video's claim about why a reservation that already had a provider admission is released. Account cannot verify it; it stores it with its evidence hash. */
export type VideoResolution={kind:ResolutionKind;evidenceSha256:string};
/** Optional parts of a settlement: `capturedSeconds` (1 <= K < N) for a partial capture, `resolution` for a release after admission. */
export type VideoSettlementOptions={capturedSeconds?:number;resolution?:VideoResolution};
/**
 * Floor below which Account refuses an `unknown_expired` release (the admission may still be answered). Video's own wait before asking must be greater than or
 * equal to it; a test compares both so the number is not duplicated.
 */
export const UNKNOWN_RESOLUTION_MIN_AGE_MS=15*60_000;
export const isResolutionKind=(value:unknown):value is ResolutionKind=>typeof value==='string'&&(RESOLUTION_KINDS as readonly string[]).includes(value);
const hex64=/^[a-f0-9]{64}$/;
export function validResolution(value:unknown):value is VideoResolution{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='evidenceSha256,kind')return false;
  const row=value as Record<string,unknown>;
  return isResolutionKind(row.kind)&&typeof row.evidenceSha256==='string'&&hex64.test(row.evidenceSha256);
}
export const sameResolution=(a:VideoResolution,b:VideoResolution)=>a.kind===b.kind&&a.evidenceSha256===b.evidenceSha256;
