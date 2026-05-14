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

  const selectedDisplayText = payload.buttonsResponseMessage?.selectedDisplayText?.trim();
  if (!selectedDisplayText) return '';

  const exactMatch = labels[selectedDisplayText];
  if (exactMatch) return exactMatch;

  const normalizedDisplayText = selectedDisplayText.toLowerCase();
  const labelMatch = Object.entries(labels).find(
    ([label]) => label.toLowerCase() === normalizedDisplayText
  );
  return labelMatch?.[1] ?? '';
}
