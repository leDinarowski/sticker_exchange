import { Result } from 'neverthrow';
import { logger } from './logger.js';
import { ConversationStep, PendingOp } from '../types/index.js';
import { findUserById } from '../db/users.js';
import { sendButtons, ButtonOption } from '../services/zapi.js';

export type BuildEchoText = (
  accumulated: string[],
  op: PendingOp,
  collectingWants: boolean
) => string;

export interface TrailingEchoArgs {
  userId: string;
  phone: string;
  seq: number;
  delayMs: number;
  buildEchoText: BuildEchoText;
}

export interface TrailingEchoDeps {
  sleep?: (ms: number) => Promise<void>;
  loadUser?: typeof findUserById;
  send?: (phone: string, message: string, buttons: ButtonOption[]) => Promise<Result<void, Error>>;
}

const ECHO_BUTTONS: ButtonOption[] = [
  { id: 'confirm_listings', label: 'Confirmar' },
  { id: 'correct_listings', label: 'Corrigir' },
];

export async function runTrailingEcho(
  args: TrailingEchoArgs,
  deps: TrailingEchoDeps = {}
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const loadUser = deps.loadUser ?? findUserById;
  const send = deps.send ?? sendButtons;

  await sleep(args.delayMs);

  const fresh = await loadUser(args.userId);
  if (fresh.isErr()) {
    logger.error({
      userId: args.userId,
      event: 'listings_echo_load_failed',
      error: fresh.error.message,
    });
    return;
  }

  const user = fresh.value;
  if (!user) {
    logger.warn({ userId: args.userId, event: 'listings_echo_load_missing' });
    return;
  }

  const ctx = user.conversation_state?.context ?? {};
  const step = user.conversation_state?.step;

  if (ctx.last_seq !== args.seq) {
    logger.info({
      userId: args.userId,
      event: 'listings_echo_suppressed_by_seq',
      expected: args.seq,
      current: ctx.last_seq ?? null,
    });
    return;
  }

  if (step !== ConversationStep.ONBOARDING_LISTINGS) {
    logger.info({
      userId: args.userId,
      event: 'listings_echo_suppressed_by_state',
      step: step ?? null,
    });
    return;
  }

  const accumulated = ctx.accumulated_codes ?? [];
  const op: PendingOp = ctx.pending_op ?? 'set';
  const collectingWants = ctx.collecting_wants === true;
  const echoText = args.buildEchoText(accumulated, op, collectingWants);

  const sendResult = await send(args.phone, echoText, ECHO_BUTTONS);
  if (sendResult.isErr()) {
    logger.error({
      userId: args.userId,
      event: 'listings_echo_send_failed',
      error: sendResult.error.message,
    });
    return;
  }

  logger.info({
    userId: args.userId,
    event: 'listings_echo_sent',
    total: accumulated.length,
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
