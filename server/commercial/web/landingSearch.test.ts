import { describe, expect, it } from 'vitest';
import { normalizeLandingSearch } from './landingSearch';

describe('localized FAQ search', () => {
  it('matches unaccented queries to French, Portuguese and Vietnamese copy', () => {
    expect(normalizeLandingSearch('Télécharger', 'fr')).toBe('telecharger');
    expect(normalizeLandingSearch('Tradução', 'pt-BR')).toBe('traducao');
    expect(normalizeLandingSearch('PHỤ ĐỀ', 'vi')).toBe('phu de');
    expect(normalizeLandingSearch('تَرْجَمَة', 'ar')).toBe(normalizeLandingSearch('ترجمة', 'ar'));
    expect(normalizeLandingSearch('저장', 'ko')).not.toBe(normalizeLandingSearch('자막', 'ko'));
  });
});
