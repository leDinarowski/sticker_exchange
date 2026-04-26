---
name: listing-parser
description: "Use this skill when implementing or testing the listing number parser: parsing user-submitted sticker codes from free text, handling team ranges and differential commands, echo-back confirmation, and validation rules. Covers all supported input formats and edge cases."
---

# Listing Parser — Panini FIFA World Cup 2026™

> Always read `stickers_context.md` before working in this area. It contains the authoritative list of all 48 team codes, series (FWC, CC), and sticker counts.

## Sticker Code Format

Each sticker is identified by a **3-letter team prefix + position number**, normalized to uppercase with no space:

| Series | Code pattern | Valid numbers | Count |
|--------|-------------|---------------|-------|
| Teams (48) | `ARG1`–`ARG20`, `BRA1`–`BRA20`, … | 1–20 | 960 |
| FWC (tournament) | `FWC00`, `FWC1`–`FWC19` | 00, 1–19 | 20 |
| CC (Coca-Cola promo) | `CC1`–`CC14` | 1–14 | 14 |
| **Total** | | | **994** |

Valid team prefixes (48): ARG, BRA, COL, ECU, PAR, URU, CAN, CUW, HAI, MEX, PAN, USA, AUS, IRN, JPN, JOR, KOR, KSA, QAT, UZB, ALG, CPV, CIV, EGY, GHA, MAR, RSA, SEN, TUN, AUT, BEL, BIH, CRO, CZE, ENG, ESP, FRA, GER, NED, NOR, POR, SCO, SUI, SWE, TUR, NZL, COD, IRQ.

---

## Supported Input Formats

| Format | Example input | Parsed result |
|--------|--------------|---------------|
| Single code | `BRA5` | [`BRA5`] |
| Comma-separated | `BRA5, ARG3, FWC8` | [`BRA5`, `ARG3`, `FWC8`] |
| Space-separated | `BRA5 ARG3 FWC8` | [`BRA5`, `ARG3`, `FWC8`] |
| Range within team | `BRA5-10` or `BRA5-BRA10` | [`BRA5`, `BRA6`, …, `BRA10`] |
| Mixed | `BRA5-8, ARG3, CC2` | [`BRA5`, `BRA6`, `BRA7`, `BRA8`, `ARG3`, `CC2`] |
| Differential remove | `remover BRA5, ARG3` | `{ op: 'remove', codes: ['BRA5', 'ARG3'] }` |
| Differential add | `adicionar BRA5` | `{ op: 'add', codes: ['BRA5'] }` |

Input is always normalized: trimmed, uppercased, spaces between prefix and number removed (`bra 5` → `BRA5`).

---

## Validation Rules

- Team prefix must be one of the 48 valid codes, `FWC`, or `CC`.
- Number must be in the valid range for the series (1–20 for teams, 00/1–19 for FWC, 1–14 for CC).
- `FWC00` is the only zero-padded code — accept it explicitly.
- Range start must be ≤ range end (`BRA10-5` → reject with feedback).
- Range must not span more than 20 numbers (`BRA1-20` is the maximum valid range per team).
- Maximum 200 codes per submission (prevents abuse).
- Unknown prefix → reject: `"Prefixo desconhecido: XYZ. Verifique o codigo da selecao."`.
- Number out of range → reject: `"BRA21 nao existe. Selecoes tem de BRA1 a BRA20."`.

---

## Parser Implementation

```typescript
// src/utils/listing-parser.ts
import { Result, ok, err } from 'neverthrow';

const TEAM_CODES = new Set([
  'ARG','BRA','COL','ECU','PAR','URU',
  'CAN','CUW','HAI','MEX','PAN','USA',
  'AUS','IRN','JPN','JOR','KOR','KSA','QAT','UZB',
  'ALG','CPV','CIV','EGY','GHA','MAR','RSA','SEN','TUN',
  'AUT','BEL','BIH','CRO','CZE','ENG','ESP','FRA','GER',
  'NED','NOR','POR','SCO','SUI','SWE','TUR',
  'NZL','COD','IRQ',
]);

export type ParseResult =
  | { op: 'set';    codes: string[] }
  | { op: 'add';    codes: string[] }
  | { op: 'remove'; codes: string[] };

export function parseListingInput(input: string): Result<ParseResult, string> {
  const normalized = input.trim().toUpperCase();

  if (normalized.startsWith('REMOVER ')) {
    const result = parseCodes(normalized.slice('REMOVER '.length));
    if (result.isErr()) return err(result.error);
    return ok({ op: 'remove', codes: result.value });
  }

  if (normalized.startsWith('ADICIONAR ')) {
    const result = parseCodes(normalized.slice('ADICIONAR '.length));
    if (result.isErr()) return err(result.error);
    return ok({ op: 'add', codes: result.value });
  }

  const result = parseCodes(normalized);
  if (result.isErr()) return err(result.error);
  return ok({ op: 'set', codes: result.value });
}

function parseCodes(input: string): Result<string[], string> {
  // Normalize: remove spaces between prefix and number (e.g. "BRA 5" → "BRA5")
  const cleaned = input.replace(/([A-Z]{2,3})\s+(\d+)/g, '$1$2');
  const tokens = cleaned.split(/[\s,]+/).filter(Boolean);
  const codes: string[] = [];

  for (const token of tokens) {
    // Range: BRA5-10 or BRA5-BRA10
    const rangeMatch = token.match(/^([A-Z]{2,3})(\d+)-(?:[A-Z]{2,3})?(\d+)$/);
    if (rangeMatch) {
      const [, prefix, startStr, endStr] = rangeMatch;
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (start > end) return err(`Intervalo invalido: ${token}. O primeiro numero deve ser menor.`);
      if (end - start >= 20) return err(`Intervalo muito grande: ${token}. Maximo 20 por vez.`);

      for (let n = start; n <= end; n++) {
        const code = `${prefix}${n}`;
        const validation = validateCode(code);
        if (validation.isErr()) return err(validation.error);
        codes.push(code);
      }
      continue;
    }

    // Single code: BRA5, FWC00, CC3
    const codeMatch = token.match(/^([A-Z]{2,3})(\d+)$/);
    if (codeMatch) {
      const validation = validateCode(token);
      if (validation.isErr()) return err(validation.error);
      codes.push(token);
      continue;
    }

    return err(`"${token}" nao e um codigo valido. Use o formato da selecao seguido do numero, ex: BRA5.`);
  }

  if (codes.length > 200) {
    return err(`Maximo de 200 figurinhas por envio. Voce enviou ${codes.length}.`);
  }

  const unique = [...new Set(codes)];
  return ok(unique);
}

function validateCode(code: string): Result<void, string> {
  const match = code.match(/^([A-Z]{2,3})(\d+)$/);
  if (!match) return err(`Codigo invalido: ${code}`);

  const [, prefix, numStr] = match;
  const num = parseInt(numStr, 10);

  if (prefix === 'FWC') {
    // FWC00 is valid; FWC1–FWC19 are valid
    if (numStr !== '00' && (num < 1 || num > 19)) {
      return err(`${code} nao existe. Serie FWC vai de FWC00 a FWC19.`);
    }
    return ok(undefined);
  }

  if (prefix === 'CC') {
    if (num < 1 || num > 14) {
      return err(`${code} nao existe. Serie CC vai de CC1 a CC14.`);
    }
    return ok(undefined);
  }

  if (!TEAM_CODES.has(prefix)) {
    return err(`Prefixo desconhecido: ${prefix}. Verifique o codigo da selecao.`);
  }

  if (num < 1 || num > 20) {
    return err(`${code} nao existe. Selecoes tem de ${prefix}1 a ${prefix}20.`);
  }

  return ok(undefined);
}
```

---

## Echo-Back Confirmation Flow

After any successful parse, always echo back before saving:

```typescript
// In handler after successful parse:
const formatted = formatListingPreview(parsed.codes);

await zapi.sendButtons({
  phone: user.phone,
  message: `Entendi estas figurinhas: ${formatted}. Esta correto?`,
  buttons: [
    { id: 'confirm_listings', label: 'Confirmar' },
    { id: 'correct_listings', label: 'Corrigir' },
  ],
});

// Store pending in state context — do NOT write to DB yet
await transitionState(user.id, 'ONBOARDING_LISTINGS', {
  pending_listings: parsed.codes,
});
```

Only write to the `listings` table after the user taps [Confirmar].

---

## Formatting for Display

```typescript
export function formatListingPreview(codes: string[]): string {
  if (codes.length === 0) return '(nenhuma)';
  if (codes.length <= 10) return codes.join(', ');

  // Group by prefix and collapse consecutive numbers into ranges
  const byPrefix: Record<string, number[]> = {};
  for (const code of codes) {
    const match = code.match(/^([A-Z]{2,3})(\d+)$/);
    if (!match) continue;
    const [, prefix, numStr] = match;
    (byPrefix[prefix] ??= []).push(parseInt(numStr, 10));
  }

  const parts: string[] = [];
  for (const [prefix, numbers] of Object.entries(byPrefix)) {
    numbers.sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = numbers[0];
    let prev = numbers[0];
    for (let i = 1; i <= numbers.length; i++) {
      if (i === numbers.length || numbers[i] !== prev + 1) {
        ranges.push(start === prev ? `${prefix}${start}` : `${prefix}${start}-${prev}`);
        start = numbers[i];
      }
      prev = numbers[i];
    }
    parts.push(ranges.join(', '));
  }

  return parts.join(', ');
}
// ['BRA5','BRA6','BRA7','ARG3'] → "BRA5-7, ARG3"
// ['BRA5','BRA7','ARG3']       → "BRA5, BRA7, ARG3"
```

---

## Applying a ParseResult to the Database

```typescript
// src/services/listings.ts
export async function applyListingUpdate(
  userId: string,
  domain: string,
  result: ParseResult
): Promise<Result<void, Error>> {
  switch (result.op) {
    case 'set':
      await supabase.from('listings').delete().eq('user_id', userId).eq('domain', domain);
      return insertListings(userId, domain, result.codes);

    case 'add':
      return insertListings(userId, domain, result.codes);

    case 'remove': {
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('user_id', userId)
        .eq('domain', domain)
        .in('payload->>code', result.codes);
      return error ? err(new Error(error.message)) : ok(undefined);
    }
  }
}

async function insertListings(
  userId: string,
  domain: string,
  codes: string[]
): Promise<Result<void, Error>> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const rows = codes.map(code => ({
    user_id: userId,
    domain,
    payload: { code },
    expires_at: expiresAt,
  }));

  const { error } = await supabase.from('listings').upsert(rows, {
    onConflict: 'user_id,domain,payload',
  });

  return error ? err(new Error(error.message)) : ok(undefined);
}
```

---

## Test Cases to Always Cover

```typescript
describe('parseListingInput', () => {
  it('parses single code: "BRA5" → [BRA5]')
  it('parses comma-separated: "BRA5, ARG3" → [BRA5, ARG3]')
  it('parses range within team: "BRA5-8" → [BRA5, BRA6, BRA7, BRA8]')
  it('parses BRA5-BRA8 range syntax')
  it('parses FWC00 as valid')
  it('parses FWC1-FWC5 range')
  it('parses CC1-CC14 range')
  it('parses differential add: "adicionar BRA5" → { op: add, codes: [BRA5] }')
  it('parses differential remove: "remover BRA5, ARG3"')
  it('normalizes lowercase: "bra5" → BRA5')
  it('normalizes space: "BRA 5" → BRA5')
  it('rejects unknown prefix: "XYZ5"')
  it('rejects number out of range: "BRA21"')
  it('rejects FWC20 (max is FWC19)')
  it('rejects CC15 (max is CC14)')
  it('rejects invalid range: "BRA10-5" (start > end)')
  it('rejects non-code tokens: "hello"')
  it('deduplicates codes')
  it('rejects more than 200 codes')
  it('collapses ranges in formatListingPreview: [BRA5,BRA6,BRA7,ARG3] → "BRA5-7, ARG3"')
});
```
