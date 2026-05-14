import { describe, expect, it } from 'vitest';
import { WebhookPayload } from '../../src/webhook/schema.js';
import { resolveButtonId } from '../../src/webhook/utils.js';

const BASE: WebhookPayload = {
  type: 'ReceivedCallback',
  phone: '5511999999999',
  instanceId: 'inst',
  messageId: 'msg-1',
  fromMe: false,
};

describe('resolveButtonId', () => {
  it('returns buttonId from the real Z-API send-button-list callback', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { buttonId: 'confirm_name', message: 'Confirmar' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('prefers buttonId over selectedButtonId', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: {
        buttonId: 'confirm_name',
        selectedButtonId: 'alter_name',
      },
    };

    expect(resolveButtonId(payload)).toBe('confirm_name');
  });

  it('falls back to selectedButtonId when buttonId is absent (legacy format)', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedButtonId: 'confirm_name' },
    };

    expect(resolveButtonId(payload)).toBe('confirm_name');
  });

  it('uses selectedRowId when no buttonId or selectedButtonId is present', () => {
    const payload: WebhookPayload = {
      ...BASE,
      listResponseMessage: { selectedRowId: 'terms_accept' },
    };

    expect(resolveButtonId(payload)).toBe('terms_accept');
  });

  it('maps message (Z-API real label) when buttonId is null', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { buttonId: null, message: 'Confirmar' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('maps selectedDisplayText (legacy) when buttonId/selectedButtonId are absent', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedDisplayText: ' Confirmar ' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('matches label case-insensitively', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { message: 'confirmar' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('returns empty string when no button data is present', () => {
    const payload: WebhookPayload = {
      ...BASE,
      text: { message: 'Confirmar' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('');
  });

  it('returns empty string when label is unknown', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { message: 'Desconhecido' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('');
  });
});
