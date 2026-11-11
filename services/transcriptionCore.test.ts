import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  describeGeminiError,
  isRetryableGeminiError,
  localizeEnglishFootMeasurements,
} from './transcriptionCore';

describe('English to Spanish measurement localization', () => {
  it('translates feet only for the same numeric measurement in the original', () => {
    expect(localizeEnglishFootMeasurements('He fell 15 feet.', 'Cayó 15 feet.')).toBe('Cayó 15 pies.');
    expect(localizeEnglishFootMeasurements('He fell 15 feet.', 'Cayó 16 feet.')).toBe('Cayó 16 feet.');
    expect(localizeEnglishFootMeasurements('He landed on both feet.', 'Cayó de pies.')).toBe('Cayó de pies.');
  });
});

describe('transcription model diagnostics', () => {
  it('uses the currently supported default model', () => {
    expect(DEFAULT_TRANSCRIPTION_MODEL).toBe('gemini-3.8-flash');
  });

  it('explains that a retired model must be replaced', () => {
    const message = describeGeminiError(
      new Error(
        'This model models/gemini-2.5-flash is no longer available to new users.'
      )
    );

    expect(message).toMatch(/model is unavailable/i);
    expect(message).toContain('gemini-3.8-flash');
  });

  it('does not retry a permanent model-not-found error', () => {
    expect(
      isRetryableGeminiError(
        new Error('404 NOT_FOUND: model is no longer available')
      )
    ).toBe(false);
  });

  it('keeps authentication errors distinct from model errors', () => {
    expect(describeGeminiError(new Error('API key not valid'))).toMatch(
      /API key/i
    );
  });
});
