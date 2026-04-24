---
name: listing-parser
description: "Use this skill when implementing or testing the listing number parser: parsing user-submitted sticker numbers from free text, handling ranges and differential commands, echo-back confirmation, and validation rules. Covers all supported input formats and edge cases."
---

# Listing Parser

## Supported Input Formats

All parsing happens in `src/utils/listing-parser.ts`. The parser must handle all formats gracefully.

| Format | Example input | Result |
|---|---|---|
| Single number | `45` | [45] |
| Comma-separated | `12, 45, 78` | [12, 45, 78] |
| Whitespace-separated | `12 45 78` | [12, 45, 78] |
| Range | `12-25` | [12, 13, ..., 25] |
| Mixed | `12-15, 45, 78-80` | [12, 13, 14, 15, 45, 78, 79, 80] |
| Differential remove | `remover 45, 78` | { op: 'remove', numbers: [45, 78] } |
| Differential add | `adicionar 203, 415` | { op: 'add', numbers: [203, 415] } |

---

## Validation Rules (Sticker Domain)

- Valid range: 1–670 (World Cup 2026 album)
- Numbers outside range → reject with specific feedback ("Figurinha 671 nao existe no album.")
- Non-numeric tokens → reject the whole submission, prompt again
- Ranges where start > end → reject ("Intervalo invalido: 25-12")
- Maximum 200 numbers per submission (prevents abuse)

---

## Parser Implementation

```typescript
// src/utils/listing-parser.ts
import { Result, ok, err } from 'neverthrow';

const STICKER_MIN = 1;
const STICKER_MAX = 670;
const MAX_PER_SUBMISSION = 200;

export type ParseResult =
  | { op: 'set'; numbers: number[] }
  | { op: 'add'; numbers: number[] }
  | { op: 'remove'; numbers: number[] };

export function parseListingInput(input: string): Result<ParseResult, string> {
  const lower = input.trim().toLowerCase();

  if (lower.startsWith('remover ')) {
    const numbers = parseNumbers(lower.replace('remover ', ''));
    if (numbers.isErr()) return err(numbers.error);
    return ok({ op: 'remove', numbers: numbers.value });
  }

  if (lower.startsWith('adicionar ')) {
    const numbers = parseNumbers(lower.replace('adicionar ', ''));
    if (numbers.isErr()) return err(numbers.error);
    return ok({ op: 'add', numbers: numbers.value });
  }

  const numbers = parseNumbers(lower);
  if (numbers.isErr()) return err(numbers.error);
  return ok({ op: 'set', numbers: numbers.value });
}

function parseNumbers(input: string): Result<number[], string> {
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  const numbers: number[] = [];

  for (const token of tokens) {
    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) return err(`Formato invalido: ${token}`);
      const start = parseInt(parts[0], 10);
      const end = parseInt(parts[1], 10);

      if (isNaN(start) || isNaN(end)) return err(`Numeros invalidos: ${token}`);
      if (start > end) return err(`Intervalo invalido: ${token}. O primeiro numero deve ser menor.`);
      if (end - start > 200) return err(`Intervalo muito grande: ${token}. Maximo 200 numeros por vez.`);

      for (let n = start; n <= end; n++) numbers.push(n);
    } else {
      const n = parseInt(token, 10);
      if (isNaN(n)) return err(`"${token}" nao e um numero valido.`);
      numbers.push(n);
    }
  }

  const invalid = numbers.filter(n => n < STICKER_MIN || n > STICKER_MAX);
  if (invalid.length > 0) {
    return err(`Figurinhas fora do album: ${invalid.join(', ')}. Use numeros entre ${STICKER_MIN} e ${STICKER_MAX}.`);
  }

  if (numbers.length > MAX_PER_SUBMISSION) {
    return err(`Maximo de ${MAX_PER_SUBMISSION} figurinhas por envio.`);
  }

  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  return ok(unique);
}
```

---

## Echo-Back Confirmation Flow

After any successful parse, always echo back before saving:

```typescript
// In handler after successful parse:
const formatted = formatListingPreview(parsed.numbers);

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
  pending_listings: parsed.numbers,
});
```

Only write to the `listings` table after the user taps [Confirmar].

---

## Formatting for Display

```typescript
export function formatListingPreview(numbers: number[]): string {
  // Collapse consecutive sequences into ranges for readability
  if (numbers.length === 0) return '(nenhuma)';
  if (numbers.length <= 10) return numbers.join(', ');

  const ranges: string[] = [];
  let start = numbers[0];
  let prev = numbers[0];

  for (let i = 1; i <= numbers.length; i++) {
    if (i === numbers.length || numbers[i] !== prev + 1) {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = numbers[i];
    }
    prev = numbers[i];
  }

  return ranges.join(', ');
}
// [12, 13, 14, 45, 78, 79] → "12-14, 45, 78-79"
// [12, 14, 45] → "12, 14, 45"
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
      // Delete existing, insert new
      await supabase.from('listings').delete().eq('user_id', userId).eq('domain', domain);
      return insertListings(userId, domain, result.numbers);

    case 'add':
      return insertListings(userId, domain, result.numbers); // DB unique constraint handles dupes

    case 'remove':
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('user_id', userId)
        .eq('domain', domain)
        .in('payload->>number', result.numbers.map(String));
      return error ? err(new Error(error.message)) : ok(undefined);
  }
}

async function insertListings(
  userId: string,
  domain: string,
  numbers: number[]
): Promise<Result<void, Error>> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const rows = numbers.map(n => ({
    user_id: userId,
    domain,
    payload: { number: n },
    expires_at: expiresAt,
  }));

  const { error } = await supabase.from('listings').upsert(rows, {
    onConflict: 'user_id,domain,payload', // requires unique constraint
  });

  return error ? err(new Error(error.message)) : ok(undefined);
}
```

---

## Test Cases to Always Cover

```typescript
describe('parseListingInput', () => {
  it('parses comma-separated numbers', ...)
  it('parses ranges', ...)
  it('parses mixed ranges and singles', ...)
  it('parses differential add', ...)
  it('parses differential remove', ...)
  it('rejects numbers outside 1-670', ...)
  it('rejects invalid ranges (start > end)', ...)
  it('rejects non-numeric tokens', ...)
  it('deduplicates numbers', ...)
  it('returns sorted output', ...)
  it('collapses ranges in formatListingPreview', ...)
});
```
