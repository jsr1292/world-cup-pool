import { describe, it, expect } from 'vitest';
import { flagSlug, flagEmoji, shortName } from './teams.js';

describe('flagSlug', () => {
  it('lowercases ISO alpha-2 codes', () => {
    expect(flagSlug('MX')).toBe('mx');
    expect(flagSlug('kr')).toBe('kr');
    expect(flagSlug('US')).toBe('us');
  });
  it('maps GB subdivisions for England/Scotland/Wales', () => {
    expect(flagSlug('ENG')).toBe('gb-eng');
    expect(flagSlug('SCT')).toBe('gb-sct');
    expect(flagSlug('WAL')).toBe('gb-wls');
  });
  it('returns empty for blank/unknown codes', () => {
    expect(flagSlug('')).toBe('');
    expect(flagSlug('ZZZ')).toBe('');
  });
});

describe('flagEmoji (img-based, cross-platform)', () => {
  it('renders an <img> from flagcdn for a valid code', () => {
    const html = flagEmoji('MX');
    expect(html).toContain('<img');
    expect(html).toContain('flagcdn.com/h40/mx.png');
    expect(html).toContain('height:1em'); // scales with surrounding font-size
  });
  it('handles England via the subdivision slug', () => {
    expect(flagEmoji('ENG')).toContain('gb-eng.png');
  });
  it('returns empty (no broken img) for unknown codes', () => {
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('ZZ9')).toBe('');
  });
  it('only ever emits a whitelisted slug (safe for {@html})', () => {
    // A hostile code can never inject markup — flagSlug rejects non [A-Z]{2}.
    expect(flagEmoji('"><script>')).toBe('');
  });
});

describe('shortName', () => {
  it('shortens long names and passes through known maps', () => {
    expect(shortName('South Korea')).toBe('S. Korea');
    expect(shortName('Czech Republic')).toBe('Czechia');
    expect(shortName('Brazil')).toBe('Brazil');
  });
});
