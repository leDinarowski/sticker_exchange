import { MeetingPlace } from '../db/meeting-places.js';

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) {
    return `${Math.round(distanceM)} m`;
  }
  const km = (distanceM / 1000).toFixed(1).replace('.', ',');
  return `${km} km`;
}

export function formatMeetingPlaceMessage(place: MeetingPlace): string {
  const locationLine = place.neighborhood
    ? `${place.address} — ${place.neighborhood}`
    : place.address;

  return [
    'Sugestao de ponto de encontro para a troca:',
    '',
    place.name,
    locationLine,
    `A ${formatDistance(place.distance_m)} de distancia.`,
  ].join('\n');
}
