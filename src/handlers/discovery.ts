import { Result, err } from 'neverthrow';
import { logger } from '../utils/logger.js';
import { transitionState, findUserById } from '../db/users.js';
import { findNearbyUsers } from '../db/discovery.js';
import { createMatch } from '../db/matches.js';
import {
  formatDiscoveryList,
  formatBilateralList,
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

function getListFormatter(
  mode?: string
): (entries: DiscoveryEntry[]) => string {
  return mode === 'bilateral' ? formatBilateralList : formatDiscoveryList;
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
    return sendText(phone, getListFormatter(ctx.mode)(list));
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
    // Voltar — clear selection, re-show list
    const { selected_indices: _cleared, ...restCtx } = ctx;
    void _cleared;
    const transitionResult = await transitionState(
      user.id,
      ConversationStep.BROWSING,
      restCtx as ConversationStateContext
    );
    if (transitionResult.isErr()) return transitionResult;

    logger.info({ userId: user.id, event: 'discovery_back' });
    return sendText(phone, getListFormatter(ctx.mode)(list));
  }

  const contactTargets = indices
    .filter(i => i !== voltarIndex)
    .map(i => selected[i - 1])
    .filter((e): e is DiscoveryEntry => e !== undefined);

  const matchIds: string[] = [];

  for (const target of contactTargets) {
    const matchResult = await createMatch(user.id, target.user_id);
    if (matchResult.isErr()) return err(matchResult.error);
    const match = matchResult.value;
    matchIds.push(match.id);

    const userBResult = await findUserById(target.user_id);
    if (userBResult.isErr()) return err(userBResult.error);
    const userB = userBResult.value;
    if (!userB) continue;

    const tB = await transitionState(userB.id, ConversationStep.AWAITING_MATCH_RESPONSE, {
      pending_match_id: match.id,
      pending_target_name: user.name ?? 'Alguem',
    });
    if (tB.isErr()) return tB;

    const notifyB = await sendButtons(
      userB.phone,
      `${user.name ?? 'Alguem'} quer trocar figurinhas com voce. Aceita?`,
      [
        { id: `match_accept_${match.id}`, label: 'Sim' },
        { id: `match_decline_${match.id}`, label: 'Nao' },
      ]
    );
    if (notifyB.isErr()) return notifyB;
  }

  const tA = await transitionState(user.id, ConversationStep.AWAITING_MATCH_RESPONSE, {
    pending_match_ids: matchIds,
  });
  if (tA.isErr()) return tA;

  const names = contactTargets.map(t => t.name).join(', ');
  logger.info({ userId: user.id, event: 'connection_initiated', matchCount: matchIds.length });
  return sendText(phone, `Pedido enviado para ${names}. Voce sera avisado quando responderem.`);
}
