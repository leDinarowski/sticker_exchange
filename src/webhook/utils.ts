import { WebhookPayload } from './schema.js';

export type ButtonLabelMap = Record<string, string>;

export function resolveButtonId(
  payload: WebhookPayload,
  labels: ButtonLabelMap = {}
): string {
  const selectedButtonId = payload.buttonsResponseMessage?.selectedButtonId;
  if (selectedButtonId) return selectedButtonId;

  const selectedRowId = payload.listResponseMessage?.selectedRowId;
  if (selectedRowId) return selectedRowId;

  const candidate =
    payload.buttonsResponseMessage?.selectedDisplayText?.trim() ||
    payload.text?.message?.trim();
  if (!candidate) return '';

  const exactMatch = labels[candidate];
  if (exactMatch) return exactMatch;

  const normalized = candidate.toLowerCase();
  const labelMatch = Object.entries(labels).find(
    ([label]) => label.toLowerCase() === normalized
  );
  return labelMatch?.[1] ?? '';
}
