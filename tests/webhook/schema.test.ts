import { describe, it, expect } from 'vitest';
import { webhookPayloadSchema } from '../../src/webhook/schema.js';

const BASE = {
  type: 'ReceivedCallback' as const,
  phone: '5511999999999',
  instanceId: 'inst-1',
  fromMe: false,
};

describe('webhookPayloadSchema', () => {
  it('parses a plain text message', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-1',
      text: { message: 'Oi' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a message without messageId (button responses omit it)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      text: { message: 'Oi' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a button response with selectedButtonId string', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-2',
      buttonsResponseMessage: { selectedButtonId: 'confirm_name' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buttonsResponseMessage?.selectedButtonId).toBe('confirm_name');
    }
  });

  it('parses a button response WITHOUT selectedButtonId (Z-API omits field)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-3',
      buttonsResponseMessage: { selectedDisplayText: 'Alterar' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buttonsResponseMessage?.selectedButtonId).toBeUndefined();
      expect(result.data.buttonsResponseMessage?.selectedDisplayText).toBe('Alterar');
    }
  });

  it('parses a button response with selectedButtonId null (Z-API sends null)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-4',
      buttonsResponseMessage: { selectedButtonId: null, selectedDisplayText: 'Confirmar' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buttonsResponseMessage?.selectedButtonId).toBeNull();
      expect(result.data.buttonsResponseMessage?.selectedDisplayText).toBe('Confirmar');
    }
  });

  it('parses a button response with extra unknown fields (passthrough)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-5',
      buttonsResponseMessage: {
        selectedButtonId: 'terms_accept',
        selectedDisplayText: 'Aceito',
        type: 1,
        contextInfo: {},
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buttonsResponseMessage?.selectedButtonId).toBe('terms_accept');
    }
  });

  it('parses a list response message (send-option-list / send-button-list callback)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-6',
      listResponseMessage: { selectedRowId: 'discovery' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.listResponseMessage?.selectedRowId).toBe('discovery');
    }
  });

  it('parses a list response message with selectedRowId null', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-6b',
      listResponseMessage: { selectedRowId: null },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.listResponseMessage?.selectedRowId).toBeNull();
    }
  });

  it('parses a location message', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      messageId: 'msg-7',
      location: { latitude: -23.5, longitude: -46.6 },
    });
    expect(result.success).toBe(true);
  });

  it('parses a group message (phone contains @g.us — schema does not reject it)', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      phone: '5511999999999@g.us',
      messageId: 'msg-8',
      text: { message: 'mensagem no grupo' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a Z-API group message with isGroup + participantPhone + chatName', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      phone: '120363019502934028',
      messageId: 'msg-9',
      isGroup: true,
      participantPhone: '5511988888888',
      chatName: 'Troca: A e B',
      text: { message: 'mensagem no grupo' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isGroup).toBe(true);
      expect(result.data.participantPhone).toBe('5511988888888');
      expect(result.data.chatName).toBe('Troca: A e B');
    }
  });

  it('rejects a payload with wrong type', () => {
    const result = webhookPayloadSchema.safeParse({
      ...BASE,
      type: 'SentCallback',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing required phone field', () => {
    const result = webhookPayloadSchema.safeParse({
      type: 'ReceivedCallback',
      instanceId: 'inst-1',
      fromMe: false,
    });
    expect(result.success).toBe(false);
  });
});
