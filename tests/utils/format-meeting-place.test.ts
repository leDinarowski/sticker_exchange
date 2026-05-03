import { describe, it, expect } from 'vitest';
import { formatMeetingPlaceMessage } from '../../src/utils/format-meeting-place.js';
import { MeetingPlace } from '../../src/db/meeting-places.js';

function makePlace(overrides: Partial<MeetingPlace> = {}): MeetingPlace {
  return {
    id: 'place-uuid-1',
    name: 'Cafe do Joao',
    address: 'Rua Augusta, 123',
    neighborhood: 'Pinheiros',
    distance_m: 320,
    ...overrides,
  };
}

describe('formatMeetingPlaceMessage', () => {
  it('starts with the header line', () => {
    const msg = formatMeetingPlaceMessage(makePlace());
    expect(msg.split('\n')[0]).toBe('Sugestão de ponto de encontro para a troca:');
  });

  it('includes an empty line after the header', () => {
    const msg = formatMeetingPlaceMessage(makePlace());
    expect(msg.split('\n')[1]).toBe('');
  });

  it('includes the place name on the third line', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ name: 'Cafe do Joao' }));
    expect(msg.split('\n')[2]).toBe('Cafe do Joao');
  });

  it('formats location line with neighborhood when present', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ address: 'Rua Augusta, 123', neighborhood: 'Pinheiros' }));
    expect(msg.split('\n')[3]).toBe('Rua Augusta, 123 — Pinheiros');
  });

  it('formats location line without em dash when neighborhood is null', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ address: 'Rua Augusta, 123', neighborhood: null }));
    const locationLine = msg.split('\n')[3];
    expect(locationLine).toBe('Rua Augusta, 123');
    expect(locationLine).not.toContain('—');
    expect(locationLine).not.toContain('null');
  });

  it('formats distance < 1000 m as whole metres', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ distance_m: 320.7 }));
    expect(msg).toContain('A 321 m de distância.');
  });

  it('formats distance >= 1000 m as km with BR decimal comma', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ distance_m: 1400 }));
    expect(msg).toContain('A 1,4 km de distância.');
  });

  it('formats exactly 1000 m as 1,0 km', () => {
    const msg = formatMeetingPlaceMessage(makePlace({ distance_m: 1000 }));
    expect(msg).toContain('A 1,0 km de distância.');
  });

  it('full message matches expected format', () => {
    const place = makePlace({ distance_m: 320, name: 'Cafe do Joao', address: 'Rua Augusta, 123', neighborhood: 'Pinheiros' });
    const expected = [
      'Sugestão de ponto de encontro para a troca:',
      '',
      'Cafe do Joao',
      'Rua Augusta, 123 — Pinheiros',
      'A 320 m de distância.',
    ].join('\n');
    expect(formatMeetingPlaceMessage(place)).toBe(expected);
  });
});
