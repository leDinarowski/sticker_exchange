import { describe, it, expect } from 'vitest';
import { parseListingInput, formatListingPreview } from '../../src/utils/listing-parser.js';

describe('parseListingInput', () => {
  // ── Happy path — single and multi-code inputs ─────────────────────────────

  it('parses a single code', () => {
    const result = parseListingInput('BRA5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5'] });
  });

  it('parses comma-separated codes', () => {
    const result = parseListingInput('BRA5, ARG3, FWC8');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5', 'ARG3', 'FWC8'] });
  });

  it('parses space-separated codes', () => {
    const result = parseListingInput('BRA5 ARG3 FWC8');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5', 'ARG3', 'FWC8'] });
  });

  it('parses a range within a team (short syntax)', () => {
    const result = parseListingInput('BRA5-8');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5', 'BRA6', 'BRA7', 'BRA8'] });
  });

  it('parses a range with named-prefix end (BRA5-BRA8)', () => {
    const result = parseListingInput('BRA5-BRA8');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5', 'BRA6', 'BRA7', 'BRA8'] });
  });

  it('parses mixed ranges and single codes', () => {
    const result = parseListingInput('BRA5-8, ARG3, CC2');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      op: 'set',
      codes: ['BRA5', 'BRA6', 'BRA7', 'BRA8', 'ARG3', 'CC2'],
    });
  });

  // ── FWC series ─────────────────────────────────────────────────────────────

  it('parses FWC00 as valid', () => {
    const result = parseListingInput('FWC00');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['FWC00'] });
  });

  it('parses FWC range', () => {
    const result = parseListingInput('FWC1-FWC5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      op: 'set',
      codes: ['FWC1', 'FWC2', 'FWC3', 'FWC4', 'FWC5'],
    });
  });

  it('parses FWC19 as valid (max)', () => {
    const result = parseListingInput('FWC19');
    expect(result.isOk()).toBe(true);
  });

  // ── CC series ──────────────────────────────────────────────────────────────

  it('parses CC1-CC14 (full range)', () => {
    const result = parseListingInput('CC1-CC14');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().codes).toHaveLength(14);
  });

  // ── Differential operations ───────────────────────────────────────────────

  it('parses differential add', () => {
    const result = parseListingInput('adicionar BRA5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'add', codes: ['BRA5'] });
  });

  it('parses differential remove with multiple codes', () => {
    const result = parseListingInput('remover BRA5, ARG3');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'remove', codes: ['BRA5', 'ARG3'] });
  });

  it('handles lowercase adicionar', () => {
    const result = parseListingInput('adicionar bra5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'add', codes: ['BRA5'] });
  });

  // ── Normalization ─────────────────────────────────────────────────────────

  it('normalizes lowercase input', () => {
    const result = parseListingInput('bra5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5'] });
  });

  it('normalizes space between prefix and number (bra 5 → BRA5)', () => {
    const result = parseListingInput('BRA 5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ op: 'set', codes: ['BRA5'] });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it('deduplicates repeated codes', () => {
    const result = parseListingInput('BRA5, BRA5');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().codes).toHaveLength(1);
    expect(result._unsafeUnwrap().codes).toEqual(['BRA5']);
  });

  // ── Validation errors ─────────────────────────────────────────────────────

  it('rejects unknown team prefix', () => {
    const result = parseListingInput('XYZ5');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('Prefixo desconhecido');
  });

  it('rejects number out of range for a team (BRA21)', () => {
    const result = parseListingInput('BRA21');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('BRA1 a BRA20');
  });

  it('rejects BRA0 (below range)', () => {
    const result = parseListingInput('BRA0');
    expect(result.isErr()).toBe(true);
  });

  it('rejects FWC20 (above max FWC19)', () => {
    const result = parseListingInput('FWC20');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('FWC00 a FWC19');
  });

  it('rejects CC15 (above max CC14)', () => {
    const result = parseListingInput('CC15');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('CC1 a CC14');
  });

  it('rejects CC0 (below CC range)', () => {
    const result = parseListingInput('CC0');
    expect(result.isErr()).toBe(true);
  });

  it('rejects invalid range where start > end', () => {
    const result = parseListingInput('BRA10-5');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('Intervalo invalido');
  });

  it('rejects range spanning 20 or more numbers', () => {
    const result = parseListingInput('BRA1-BRA21');
    expect(result.isErr()).toBe(true);
  });

  it('rejects non-code free text', () => {
    const result = parseListingInput('hello');
    expect(result.isErr()).toBe(true);
  });

  it('rejects a mix with one invalid code', () => {
    const result = parseListingInput('BRA5, XYZ3');
    expect(result.isErr()).toBe(true);
  });

  it('rejects more than 200 codes', () => {
    // 10 teams × 20 stickers = 200; adding one more triggers the limit
    const teams = ['ARG','BRA','COL','ECU','PAR','URU','CAN','MEX','PAN','USA'];
    const parts = teams.map(t => `${t}1-20`);
    parts.push('FWC1'); // 201st code
    const result = parseListingInput(parts.join(', '));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain('Maximo de 200');
  });
});

describe('formatListingPreview', () => {
  it('returns (nenhuma) for empty array', () => {
    expect(formatListingPreview([])).toBe('(nenhuma)');
  });

  it('returns simple join for 10 or fewer codes', () => {
    expect(formatListingPreview(['BRA5', 'ARG3', 'FWC8'])).toBe('BRA5, ARG3, FWC8');
  });

  it('returns simple join for exactly 10 codes', () => {
    const codes = ['BRA1','BRA2','BRA3','BRA4','BRA5','BRA6','BRA7','BRA8','BRA9','BRA10'];
    expect(formatListingPreview(codes)).toBe(codes.join(', '));
  });

  it('collapses consecutive numbers into ranges for >10 codes', () => {
    const codes = ['BRA5','BRA6','BRA7','ARG3','ARG4','ARG5','ARG6','ARG7','ARG8','ARG9','ARG10'];
    const result = formatListingPreview(codes);
    expect(result).toContain('BRA5-7');
    expect(result).toContain('ARG3-10');
  });

  it('does not collapse non-consecutive numbers', () => {
    // BRA has only 5 and 7 (non-consecutive); ARG1-9 fills the >10 threshold
    const codes = ['BRA5','BRA7','ARG1','ARG2','ARG3','ARG4','ARG5','ARG6','ARG7','ARG8','ARG9'];
    const result = formatListingPreview(codes);
    expect(result).toContain('BRA5');     // BRA5 appears standalone
    expect(result).toContain('BRA7');     // BRA7 appears standalone
    expect(result).not.toContain('BRA5-7'); // not collapsed into a range
  });
});
