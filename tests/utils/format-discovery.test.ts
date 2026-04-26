import { describe, it, expect } from 'vitest';
import {
  formatDistance,
  formatDiscoveryList,
  formatBilateralList,
  formatProfiles,
  parseIntegerSelection,
} from '../../src/utils/format-discovery.js';
import { DiscoveryEntry } from '../../src/types/index.js';

function makeEntry(rank: number, name: string, items: string[], distM: number): DiscoveryEntry {
  return { rank, user_id: `uuid-${rank}`, name, items, dist_m: distM };
}

describe('formatDistance', () => {
  it('returns meters when under 1000', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('returns km with one decimal when >= 1000', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1830)).toBe('1.8 km');
    expect(formatDistance(3400)).toBe('3.4 km');
  });
});

describe('formatDiscoveryList', () => {
  it('uses singular figurinha when count is 1', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA5'], 1200)];
    const output = formatDiscoveryList(entries);
    expect(output).toContain('1 figurinha');
    expect(output).not.toContain('figurinhas');
  });

  it('uses plural figurinhas when count > 1', () => {
    const entries = [makeEntry(1, 'Maria', ['ARG1', 'ARG2', 'ARG3'], 500)];
    const output = formatDiscoveryList(entries);
    expect(output).toContain('3 figurinhas');
  });

  it('formats distance correctly in the list', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA5'], 1200)];
    const output = formatDiscoveryList(entries);
    expect(output).toContain('1.2 km');
  });

  it('numbers each entry with its rank', () => {
    const entries = [
      makeEntry(1, 'Joao', ['BRA5'], 500),
      makeEntry(2, 'Maria', ['ARG1'], 1500),
    ];
    const output = formatDiscoveryList(entries);
    expect(output).toContain('1. Joao');
    expect(output).toContain('2. Maria');
  });

  it('includes selection prompt', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA5'], 500)];
    expect(formatDiscoveryList(entries)).toContain('Responda com o numero');
  });
});

describe('formatProfiles', () => {
  it('shows name, distance, and sticker codes', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA3', 'BRA5', 'ARG4'], 1200)];
    const output = formatProfiles(entries);
    expect(output).toContain('Joao');
    expect(output).toContain('1.2 km');
    expect(output).toContain('BRA3, BRA5, ARG4');
  });

  it('shows single Entrar em contato + Voltar for single person', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA5'], 500)];
    const output = formatProfiles(entries);
    expect(output).toContain('1 - Entrar em contato com Joao');
    expect(output).toContain('2 - Voltar');
  });

  it('shows individual contacts + Voltar for multiple persons', () => {
    const entries = [
      makeEntry(1, 'Joao', ['BRA5'], 500),
      makeEntry(2, 'Maria', ['ARG1'], 1500),
    ];
    const output = formatProfiles(entries);
    expect(output).toContain('1 - Entrar em contato com Joao');
    expect(output).toContain('2 - Entrar em contato com Maria');
    expect(output).toContain('3 - Voltar');
  });

  it('shows specific-selection hint for multiple persons', () => {
    const entries = [
      makeEntry(1, 'Joao', ['BRA5'], 500),
      makeEntry(2, 'Maria', ['ARG1'], 1500),
    ];
    const output = formatProfiles(entries);
    expect(output).toContain('1,2');
  });

  it('does not show specific-selection hint for single person', () => {
    const entries = [makeEntry(1, 'Joao', ['BRA5'], 500)];
    const output = formatProfiles(entries);
    expect(output).not.toContain('1,2');
  });
});

describe('formatBilateralList', () => {
  it('labels each entry with Match Perfeito', () => {
    const entries = [makeEntry(1, 'Ana', ['ARG3', 'ARG4'], 800)];
    const output = formatBilateralList(entries);
    expect(output).toContain('Match Perfeito');
    expect(output).toContain('1. Ana');
  });

  it('uses "em comum" suffix on item count', () => {
    const entries = [makeEntry(1, 'Ana', ['ARG3', 'ARG4'], 800)];
    const output = formatBilateralList(entries);
    expect(output).toContain('2 figurinhas em comum');
  });

  it('uses singular figurinha when count is 1', () => {
    const entries = [makeEntry(1, 'Pedro', ['BRA7'], 2100)];
    const output = formatBilateralList(entries);
    expect(output).toContain('1 figurinha em comum');
  });

  it('numbers multiple entries correctly', () => {
    const entries = [
      makeEntry(1, 'Ana', ['ARG3'], 800),
      makeEntry(2, 'Pedro', ['BRA7'], 2100),
    ];
    const output = formatBilateralList(entries);
    expect(output).toContain('1. Ana');
    expect(output).toContain('2. Pedro');
  });

  it('includes selection prompt', () => {
    const entries = [makeEntry(1, 'Ana', ['ARG3'], 800)];
    expect(formatBilateralList(entries)).toContain('Responda com o numero');
  });
});

describe('parseIntegerSelection', () => {
  it('parses a single number', () => {
    expect(parseIntegerSelection('1', 5)).toEqual([1]);
    expect(parseIntegerSelection('3', 5)).toEqual([3]);
  });

  it('parses comma-separated numbers', () => {
    expect(parseIntegerSelection('1,3', 5)).toEqual([1, 3]);
    expect(parseIntegerSelection('1, 3, 5', 5)).toEqual([1, 3, 5]);
  });

  it('parses ranges', () => {
    expect(parseIntegerSelection('1-3', 5)).toEqual([1, 2, 3]);
    expect(parseIntegerSelection('2-4', 5)).toEqual([2, 3, 4]);
  });

  it('returns null for numbers out of range', () => {
    expect(parseIntegerSelection('6', 5)).toBeNull();
    expect(parseIntegerSelection('0', 5)).toBeNull();
    expect(parseIntegerSelection('1-6', 5)).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseIntegerSelection('abc', 5)).toBeNull();
    expect(parseIntegerSelection('', 5)).toBeNull();
  });

  it('deduplicates and sorts', () => {
    expect(parseIntegerSelection('3,1,2', 5)).toEqual([1, 2, 3]);
  });
});
