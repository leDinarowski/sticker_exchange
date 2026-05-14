import { WebhookPayload } from './schema.js';

export type ButtonLabelMap = Record<string, string>;

export function resolveButtonId(
  payload: WebhookPayload,
  labels: ButtonLabelMap = {}
): string {
  const btn = payload.buttonsResponseMessage;

  const directId = btn?.buttonId || btn?.selectedButtonId;
  if (directId) return directId;

  const rowId = payload.listResponseMessage?.selectedRowId;
  if (rowId) return rowId;

  const candidate = btn?.message?.trim() || btn?.selectedDisplayText?.trim();
  if (!candidate) return '';

  const exact = labels[candidate];
  if (exact) return exact;

  const normalized = candidate.toLowerCase();
  const match = Object.entries(labels).find(([label]) => label.toLowerCase() === normalized);
  return match?.[1] ?? '';
}
