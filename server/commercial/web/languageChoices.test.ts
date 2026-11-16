import { describe, expect, it } from 'vitest';
import { enabledDirections, languageChoices } from './languageChoices.js';

describe('server-enabled language choices', () => {
  it('keeps enabled beta directions while omitting unavailable pairs', () => {
    const service = { directions: [
      { id: 'es-en', status: 'beta' }, { id: 'en-es', status: 'verified' },
      { id: 'es-ja', status: 'pending' }, { id: 'es-ko', enabled: false },
      { id: 'es-de', available: false }, { id: 'de-en', status: 'unavailable' },
    ] };
    expect(enabledDirections(service).map(item => item.id)).toEqual(['es-en', 'en-es']);
    expect(languageChoices(service, 'es')).toEqual({ sources: ['es', 'en'], source: 'es', targets: ['en'] });
    expect(languageChoices(service, 'en').targets).toEqual(['es']);
  });
  it('never expands an empty service into a catalog or an unsupported pair', () => {
    expect(languageChoices({ directions: [] }, 'ja')).toEqual({ sources: [], source: undefined, targets: [] });
    expect(languageChoices({ directions: [{ id: 'es-en' }] }, 'ja').source).toBe('es');
  });
});
