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
    return err(new Error(`Z-API ${endpoint} failed (${res.status})`));
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
    return err(new Error(`Z-API ${endpoint} failed (${res.status})`));
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

export async function sendButtons(
  phone: string,
  message: string,
  buttons: ButtonOption[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'buttons', count: buttons.length });
  return zapiPost('send-button-list', {
    phone,
    message,
    buttonList: { buttons: buttons.map((b) => ({ id: b.id, label: b.label })) },
  });
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
  const groupPhone = (result.value['phone'] ?? result.value['groupPhone'] ?? result.value['id']) as string | undefined;
  if (!groupPhone) {
    return err(new Error('create-group: response missing phone field'));
  }
  return ok(groupPhone);
}

export async function sendList(
  phone: string,
  message: string,
  buttonLabel: string,
  sections: ListSection[]
): Promise<Result<void, Error>> {
  logger.info({ event: 'zapi_send', type: 'list' });
  const options = sections.flatMap((s) =>
    s.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) }))
  );
  return zapiPost('send-option-list', {
    phone,
    message,
    optionList: {
      title: sections[0]?.title ?? '',
      buttonLabel,
      options,
    },
  });
}

export async function checkZApiConnectivity(): Promise<Result<void, Error>> {
  try {
    const url = `${baseUrl()}/connected`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Client-Token': CLIENT_TOKEN ?? '' },
    });
    if (!res.ok) {
      return err(new Error(`Z-API /connected returned ${res.status}`));
    }
    return ok(undefined);
  } catch (e) {
    return err(new Error(e instanceof Error ? e.message : 'Z-API unreachable'));
  }
}
