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

async function zapiPostData<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<Result<T, Error>> {
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

  const data = await res.json() as T;
  return ok(data);
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

// TEMP: button messages require Z-API beta toggle (unavailable on trial).
// Renders as numbered text until the toggle is enabled; revert when ready.
export async function sendButtons(
  phone: string,
  message: string,
  buttons: ButtonOption[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'buttons', count: buttons.length });
  const options = buttons.map((b, i) => `${i + 1} - ${b.label}`).join('\n');
  return sendText(phone, `${message}\n\n${options}\n\nResponda com o numero.`);
}

export async function createGroup(
  name: string,
  participants: string[]
): Promise<Result<string, Error>> {
  logger.info({ event: 'zapi_send', type: 'create_group', count: participants.length });
  const result = await zapiPostData<Record<string, unknown>>('create-group', {
    autoInvite: true,
    groupName: name,
    phones: participants,
  });
  if (result.isErr()) return err(result.error);
  // Log full response so we can confirm the group phone field name
  logger.info({ event: 'zapi_create_group_response', body: result.value });
  const groupPhone = (result.value['phone'] ?? result.value['groupPhone'] ?? result.value['id']) as string | undefined;
  if (!groupPhone) {
    return err(new Error(`create-group returned no phone field: ${JSON.stringify(result.value)}`));
  }
  return ok(groupPhone);
}

// TEMP: list messages require Z-API beta toggle (unavailable on trial).
// Renders as numbered text until the toggle is enabled; revert when ready.
export async function sendList(
  phone: string,
  message: string,
  _buttonLabel: string,
  sections: ListSection[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'list' });
  const rows = sections.flatMap((s) => s.rows);
  const options = rows.map((r, i) => `${i + 1} - ${r.title}`).join('\n');
  return sendText(phone, `${message}\n\n${options}\n\nResponda com o numero.`);
}
