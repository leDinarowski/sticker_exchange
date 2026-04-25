import { z } from 'zod';

export const webhookPayloadSchema = z.object({
  type: z.literal('ReceivedCallback'),
  phone: z.string(),
  instanceId: z.string(),
  message: z.object({
    messageId: z.string(),
    fromMe: z.boolean(),
    type: z.enum([
      'text',
      'buttonsResponseMessage',
      'listResponseMessage',
      'locationMessage',
      'imageMessage',
      'audioMessage',
    ]),
    text: z.object({ message: z.string() }).optional(),
    buttonsResponseMessage: z.object({ selectedButtonId: z.string() }).optional(),
    listResponseMessage: z.object({ selectedRowId: z.string() }).optional(),
    location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  }),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
