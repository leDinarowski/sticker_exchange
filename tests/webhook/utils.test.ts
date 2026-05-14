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
  it('prefers selectedButtonId over selectedRowId and selectedDisplayText', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: {
        selectedButtonId: 'confirm_name',
        selectedDisplayText: 'Alterar',
      },
      listResponseMessage: { selectedRowId: 'terms_accept' },
    };

    expect(resolveButtonId(payload, { Alterar: 'alter_name' })).toBe('confirm_name');
  });

  it('uses selectedRowId when selectedButtonId is absent', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedDisplayText: 'Alterar' },
      listResponseMessage: { selectedRowId: 'terms_accept' },
    };

    expect(resolveButtonId(payload, { Alterar: 'alter_name' })).toBe('terms_accept');
  });

  it('maps selectedDisplayText when Z-API omits button IDs', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedButtonId: null, selectedDisplayText: ' Confirmar ' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('matches selectedDisplayText case-insensitively', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedDisplayText: 'confirmar' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('confirm_name');
  });

  it('returns an empty string when no ID or known display text exists', () => {
    const payload: WebhookPayload = {
      ...BASE,
      buttonsResponseMessage: { selectedDisplayText: 'Desconhecido' },
    };

    expect(resolveButtonId(payload, { Confirmar: 'confirm_name' })).toBe('');
  });
});
