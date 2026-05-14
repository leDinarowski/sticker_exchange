import { WebhookPayload } from './schema.js';

export function resolveButtonId(payload: WebhookPayload): string {
  return (
    payload.buttonsResponseMessage?.selectedButtonId ??
    payload.listResponseMessage?.selectedRowId ??
    ''
  );
}
