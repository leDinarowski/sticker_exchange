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
      const prefix = rangeMatch[1]!;
      const start = parseInt(rangeMatch[2]!, 10);
      const end = parseInt(rangeMatch[3]!, 10);

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

  const prefix = match[1]!;
  const numStr = match[2]!;
  const num = parseInt(numStr, 10);

  if (prefix === 'FWC') {
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

export function formatListingPreview(codes: string[]): string {
  if (codes.length === 0) return '(nenhuma)';
  if (codes.length <= 10) return codes.join(', ');

  const byPrefix: Record<string, number[]> = {};
  for (const code of codes) {
    const match = code.match(/^([A-Z]{2,3})(\d+)$/);
    if (!match) continue;
    const prefix = match[1]!;
    const numStr = match[2]!;
    (byPrefix[prefix] ??= []).push(parseInt(numStr, 10));
  }

  const parts: string[] = [];
  for (const [prefix, numbers] of Object.entries(byPrefix)) {
    numbers.sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = numbers[0]!;
    let prev = numbers[0]!;
    for (let i = 1; i <= numbers.length; i++) {
      if (i === numbers.length || numbers[i] !== prev + 1) {
        ranges.push(start === prev ? `${prefix}${start}` : `${prefix}${start}-${prev}`);
        start = numbers[i]!;
      }
      prev = numbers[i]!;
    }
    parts.push(ranges.join(', '));
  }

  return parts.join(', ');
}
