import { Result, err } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState } from '../db/users.js';
import { findNearbyUsers } from '../db/discovery.js';
import {
  formatDiscoveryList,
  formatProfiles,
  parseIntegerSelection,
} from '../utils/format-discovery.js';
import {
  ConversationStateContext,
  ConversationStep,
  DiscoveryEntry,
  User,
} from '../types/index.js';
import { sendText, sendButtons } from '../services/zapi.js';
import { showMainMenu } from './idle.js';
import { WebhookPayload } from '../webhook/schema.js';

export async function handleDiscovery(
  user: User,
  phone: string
): Promise<Result<void, Error>> {
  const resultsResult = await findNearbyUsers(user.id);
  if (resultsResult.isErr()) return err(resultsResult.error);

  const entries = resultsResult.value;

  if (entries.length === 0) {
    logger.info({ userId: user.id, event: 'discovery_empty' });

    const transitionResult = await transitionState(user.id, ConversationStep.ONBOARDING_RADIUS, {
      updating_location: true,
    });
    if (transitionResult.isErr()) return transitionResult;

    return sendButtons(phone, 'Nenhuma pessoa com figurinhas encontrada perto de voce. Escolha um novo raio para tentar novamente:', [
      { id: 'r1', label: '1 km' },
      { id: 'r3', label: '3 km' },
      { id: 'r5', label: '5 km' },
    ]);
  }

  const transitionResult = await transitionState(user.id, ConversationStep.BROWSING, {
    mode: 'discovery',
    discovery_list: entries,
  });
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'discovery_results', count: entries.length });

  return sendText(phone, formatDiscoveryList(entries));
}

export async function handleBrowsing(
  user: User,
  payload: WebhookPayload,
  phone: string
): Promise<Result<void, Error>> {
  const ctx: ConversationStateContext = user.conversation_state?.context ?? {};
  const discoveryList: DiscoveryEntry[] = ctx.discovery_list ?? [];
  const input = payload.text?.message?.trim() ?? '';

  if (discoveryList.length === 0) {
    return showMainMenu(user.id, phone);
  }

  if (!ctx.selected_indices) {
    return handleListSelection(user, phone, input, discoveryList, ctx);
  }

  return handleActionSelection(user, phone, input, discoveryList, ctx.selected_indices, ctx);
}

async function handleListSelection(
  user: User,
  phone: string,
  input: string,
  list: DiscoveryEntry[],
  ctx: ConversationStateContext
): Promise<Result<void, Error>> {
  const indices = parseIntegerSelection(input, list.length);

  if (!indices) {
    return sendText(phone, formatDiscoveryList(list));
  }

  const selected = indices.map((i) => list[i - 1]).filter((e): e is DiscoveryEntry => e !== undefined);

  const newCtx: ConversationStateContext = { ...ctx, selected_indices: indices };
  const transitionResult = await transitionState(user.id, ConversationStep.BROWSING, newCtx);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'discovery_selected', count: selected.length });

  return sendText(phone, formatProfiles(selected));
}

async function handleActionSelection(
  user: User,
  phone: string,
  input: string,
  list: DiscoveryEntry[],
  selectedIndices: number[],
  ctx: ConversationStateContext
): Promise<Result<void, Error>> {
  const selected = selectedIndices.map((i) => list[i - 1]).filter((e): e is DiscoveryEntry => e !== undefined);
  const voltarIndex = selected.length + 1;
  const indices = parseIntegerSelection(input, voltarIndex);

  if (!indices) {
    return sendText(phone, formatProfiles(selected));
  }

  if (indices.includes(voltarIndex)) {
    // Voltar — clear selection, re-show discovery list
    const { selected_indices: _cleared, ...restCtx } = ctx;
    void _cleared;
    const transitionResult = await transitionState(
      user.id,
      ConversationStep.BROWSING,
      restCtx as ConversationStateContext
    );
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'discovery_back' });
    return sendText(phone, formatDiscoveryList(list));
  }

  // Contact stub — Phase 6 will replace this
  const transitionResult = await transitionState(user.id, ConversationStep.IDLE);
  if (transitionResult.isErr()) return transitionResult;

  logger.info({ userId: user.id, event: 'discovery_contact_stub', targets: indices });

  const sendResult = await sendText(phone, 'Funcionalidade em breve.');
  if (sendResult.isErr()) return sendResult;

  return showMainMenu(user.id, phone);
}
