// ─── Conversation State ───────────────────────────────────────────────────────

export const ConversationStep = {
  NEW:                     'NEW',
  ONBOARDING_NAME:         'ONBOARDING_NAME',
  ONBOARDING_TERMS:        'ONBOARDING_TERMS',
  ONBOARDING_LOCATION:     'ONBOARDING_LOCATION',
  ONBOARDING_RADIUS:       'ONBOARDING_RADIUS',
  ONBOARDING_LISTINGS:     'ONBOARDING_LISTINGS',
  IDLE:                    'IDLE',
  BROWSING:                'BROWSING',
  CONFIRMING_INVENTORY:    'CONFIRMING_INVENTORY',
  AWAITING_MATCH_RESPONSE: 'AWAITING_MATCH_RESPONSE',
} as const;

export type ConversationStep = typeof ConversationStep[keyof typeof ConversationStep];

export interface DiscoveryEntry {
  rank: number;
  user_id: string;
  name: string;
  items: number[];
  dist_m: number;
}

export interface ConversationStateContext {
  mode?: 'discovery' | 'bilateral';
  discovery_list?: DiscoveryEntry[];
  pending_listings?: number[];
  pending_match_id?: string;
  pending_target_name?: string;
  retry_count?: number;
}

export interface ConversationStatePayload {
  step: ConversationStep;
  context: ConversationStateContext;
  updated_at: string;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  phone: string;
  wa_username: string | null;
  name: string | null;
  radius_km: number;
  conversation_state: ConversationStatePayload | null;
  consented_at: string | null;
  refused_at: string | null;
  created_at: string;
}

// ─── Listings ─────────────────────────────────────────────────────────────────

export interface Listing {
  id: string;
  user_id: string;
  domain: string;
  payload: Record<string, unknown>;
  expires_at: string;
  created_at: string;
}

// ─── Matches ──────────────────────────────────────────────────────────────────

export const MatchStatus = {
  PENDING:     'PENDING',
  CONFIRMED_B: 'CONFIRMED_B',
  CONNECTED:   'CONNECTED',
  DECLINED:    'DECLINED',
  EXPIRED:     'EXPIRED',
} as const;

export type MatchStatus = typeof MatchStatus[keyof typeof MatchStatus];

export interface Match {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: MatchStatus;
  created_at: string;
  expires_at: string;
}

// ─── Z-API Webhook ────────────────────────────────────────────────────────────

export interface ZApiWebhookPayload {
  type: string;
  phone: string;
  instanceId: string;
  messageId: string;
  fromMe: boolean;
  text?: { message: string };
  buttonsResponseMessage?: { selectedButtonId: string };
  listResponseMessage?: { selectedRowId: string };
  location?: { latitude: number; longitude: number };
}
