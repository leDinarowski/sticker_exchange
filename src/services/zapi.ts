import { ok, err, Result } from 'neverthrow';
import { logger } from '../utils/logger.js';

const INSTANCE_ID = process.env['ZAPI_INSTANCE_ID'];
const TOKEN = process.env['ZAPI_TOKEN'];
const CLIENT_TOKEN = process.env['ZAPI_SECURITY_TOKEN'];

function baseUrl(): string {
  if (!INSTANCE_ID || !TOKEN) {
    throw new Error('Missing ZAPI_INSTANCE_ID or ZAPI_TOKEN environment variables');
  }
  return `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;
}

async function zapiPost(
  endpoint: string,
  body: Record<string, unknown>
): Promise<Result<void, Error>> {
  const url = `${baseUrl()}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': CLIENT_TOKEN ?? '',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return err(new Error(`Z-API ${endpoint} failed (${res.status}): ${text}`));
  }

  return ok(undefined);
}

export interface ButtonOption {
  id: string;
  label: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export async function sendText(
  phone: string,
  message: string
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'text' });
  return zapiPost('send-text', { phone, message });
}

export async function sendButtons(
  phone: string,
  message: string,
  buttons: ButtonOption[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'buttons', count: buttons.length });

  const buttonActions = buttons.map((b) => ({
    id: b.id,
    type: 'REPLY',
    title: b.label,
  }));

  return zapiPost('send-button-actions', { phone, message, buttonActions });
}

export async function sendList(
  phone: string,
  message: string,
  buttonLabel: string,
  sections: ListSection[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'list' });

  return zapiPost('send-option-list', {
    phone,
    message,
    buttonLabel,
    sections: sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        rowId: r.id,
        title: r.title,
        description: r.description ?? '',
      })),
    })),
  });
}
