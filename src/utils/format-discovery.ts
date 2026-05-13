import { DiscoveryEntry } from '../types/index.js';
import { compactCodes } from './listing-parser.js';

export function formatDistance(distM: number): string {
  if (distM < 1000) return `${Math.round(distM)} m`;
  return `${(distM / 1000).toFixed(1)} km`;
}

export function formatDiscoveryList(entries: DiscoveryEntry[]): string {
  const lines = entries.map((e) => {
    const count = e.items.length;
    const label = count === 1 ? 'figurinha' : 'figurinhas';
    return `${e.rank}. ${e.name} - ${formatDistance(e.dist_m)} - ${count} ${label}`;
  });

  return [
    'Pessoas perto de você:\n',
    ...lines,
    '\nResponda com o número. Você pode selecionar vários: ex. 1,3 ou 1-3',
  ].join('\n');
}

export function formatProfiles(entries: DiscoveryEntry[]): string {
  const profiles = entries.map((e) => {
    const dist = formatDistance(e.dist_m);
    const codes = compactCodes(e.items);
    return `${e.name} - ${dist}\nFigurinhas: ${codes}`;
  });

  const profileBlock = profiles.join('\n\n');

  const options = entries.map((e, i) => `${i + 1} - Entrar em contato com ${e.name}`);
  const voltarIndex = entries.length + 1;
  options.push(`${voltarIndex} - Voltar`);

  const footer =
    entries.length > 1
      ? `\nVocê pode selecionar pessoas específicas: ex. 1,2`
      : '';

  return [
    profileBlock,
    '\nO que deseja fazer agora?\n',
    options.join('\n'),
    footer,
    '\nResponda com o numero.',
  ].join('\n');
}

export function formatBilateralList(entries: DiscoveryEntry[]): string {
  const lines = entries.map((e) => {
    const count = e.items.length;
    const label = count === 1 ? 'figurinha' : 'figurinhas';
    return `${e.rank}. ${e.name} - Match Perfeito - ${formatDistance(e.dist_m)} - ${count} ${label} em comum`;
  });

  return [
    'Matches perfeitos perto de você:\n',
    ...lines,
    '\nResponda com o número. Você pode selecionar vários: ex. 1,3 ou 1-3',
  ].join('\n');
}

export function parseIntegerSelection(input: string, max: number): number[] | null {
  const cleaned = input.trim();
  const parts = cleaned.split(',').map((p) => p.trim());
  const result = new Set<number>();

  for (const part of parts) {
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]!, 10);
      const to = parseInt(rangeMatch[2]!, 10);
      if (from < 1 || to > max || from > to) return null;
      for (let i = from; i <= to; i++) result.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < 1 || n > max) return null;
      result.add(n);
    } else {
      return null;
    }
  }

  return result.size > 0 ? [...result].sort((a, b) => a - b) : null;
}
