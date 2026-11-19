/**
 * Candidate-only switch. The committed default in reviewedTranslationFeature.ts stays false; this module
 * replaces it ONLY when the candidate bundle is built with `vite build --config vite.pilot.config.ts
 * --mode candidate` (npm run build:candidate). Plain `npm run build` never uses it.
 */
export const REVIEWED_TRANSLATION_CANDIDATE: boolean = true;
