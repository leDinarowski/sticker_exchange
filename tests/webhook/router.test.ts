import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok } from 'neverthrow';

vi.mock('../../src/db/users.js', () => ({
  transitionState: vi.fn(),
}));
vi.mock('../../src/handlers/new.js', () => ({
  handleNew: vi.fn(),
}));
vi.mock('../../src/handlers/onboarding-name.js', () => ({
  handleOnboardingName: vi.fn(),
}));
vi.mock('../../src/handlers/onboarding-terms.js', () => ({
  handleOnboardingTerms: vi.fn(),
}));
vi.mock('../../src/handlers/onboarding-location.js', () => ({
  handleOnboardingLocation: vi.fn(),
}));
vi.mock('../../src/handlers/onboarding-radius.js', () => ({
  handleOnboardingRadius: vi.fn(),
}));
vi.mock('../../src/handlers/onboarding-listings.js', () => ({
  handleOnboardingListings: vi.fn(),
}));
vi.mock('../../src/handlers/idle.js', () => ({
  showMainMenu: vi.fn(),
}));
vi.mock('../../src/handlers/update-location.js', () => ({
  handleUpdateLocation: vi.fn(),
}));
vi.mock('../../src/handlers/discovery.js', () => ({
  handleDiscovery: vi.fn(),
  handleBrowsing: vi.fn(),
}));
vi.mock('../../src/handlers/bilateral.js', () => ({
  handleBilateral: vi.fn(),
  runBilateralQuery: vi.fn(),
}));
vi.mock('../../src/db/bilateral.js', () => ({
  getWantedListings: vi.fn(),
  replaceWantedListings: vi.fn(),
  findBilateralMatches: vi.fn(),
}));

import { route } from '../../src/webhook/router.js';
import * as newHandler from '../../src/handlers/new.js';
import * as nameHandler from '../../src/handlers/onboarding-name.js';
import * as idleHandler from '../../src/handlers/idle.js';
import * as updateLocationHandler from '../../src/handlers/update-location.js';
import * as discoveryHandler from '../../src/handlers/discovery.js';
import * as bilateralHandler from '../../src/handlers/bilateral.js';
import { ConversationStep, User } from '../../src/types/index.js';
import { WebhookPayload } from '../../src/webhook/schema.js';

function makePayload(): WebhookPayload {
  return {
    type: 'ReceivedCallback' as const,
    phone: '5511999999999',
    instanceId: 'inst',
    messageId: 'msg-1',
    fromMe: false,
    text: { message: 'Oi' },
  };
}

function makeUser(step: ConversationStep, refused = false): User {
  return {
    id: 'uuid-1',
    phone: '5511999999999',
    wa_username: null,
    name: null,
    radius_km: 3,
    conversation_state: { step, context: {}, updated_at: '' },
    consented_at: refused ? null : null,
    refused_at: refused ? '2026-04-25T00:00:00Z' : null,
    created_at: '',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('router', () => {
  it('ignores messages from the bot itself (fromMe=true)', async () => {
    const payload = makePayload();
    payload.fromMe = true;

    const result = await route(null, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(newHandler.handleNew).not.toHaveBeenCalled();
  });

  it('calls handleNew when user is null', async () => {
    vi.mocked(newHandler.handleNew).mockResolvedValue(ok(undefined));

    const result = await route(null, { phone: '5511999999999' }, makePayload());

    expect(result.isOk()).toBe(true);
    expect(newHandler.handleNew).toHaveBeenCalledWith({ phone: '5511999999999' });
  });

  it('dispatches to onboarding-name handler when step is ONBOARDING_NAME', async () => {
    vi.mocked(nameHandler.handleOnboardingName).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.ONBOARDING_NAME);

    const result = await route(user, { phone: '5511999999999' }, makePayload());

    expect(result.isOk()).toBe(true);
    expect(nameHandler.handleOnboardingName).toHaveBeenCalledWith(user, expect.any(Object));
  });

  it('shows main menu for IDLE state', async () => {
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);

    const result = await route(user, { phone: '5511999999999' }, makePayload());

    expect(result.isOk()).toBe(true);
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith('uuid-1', '5511999999999');
  });

  it('routes IDLE + text "4" to handleUpdateLocation', async () => {
    vi.mocked(updateLocationHandler.handleUpdateLocation).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);
    const payload: WebhookPayload = {
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      text: { message: '4' },
    };

    const result = await route(user, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(updateLocationHandler.handleUpdateLocation).toHaveBeenCalledWith(user, '5511999999999');
    expect(idleHandler.showMainMenu).not.toHaveBeenCalled();
  });

  it('routes IDLE + listResponseMessage selectedRowId "update_location" to handleUpdateLocation', async () => {
    vi.mocked(updateLocationHandler.handleUpdateLocation).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);
    const payload: WebhookPayload = {
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      listResponseMessage: { selectedRowId: 'update_location' },
    };

    const result = await route(user, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(updateLocationHandler.handleUpdateLocation).toHaveBeenCalledWith(user, '5511999999999');
  });

  it('shows main menu for IDLE with unrecognised input', async () => {
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);
    const payload: WebhookPayload = {
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      text: { message: 'Oi' },
    };

    const result = await route(user, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(idleHandler.showMainMenu).toHaveBeenCalledWith('uuid-1', '5511999999999');
    expect(updateLocationHandler.handleUpdateLocation).not.toHaveBeenCalled();
  });

  it('routes IDLE + text "1" to handleDiscovery', async () => {
    vi.mocked(discoveryHandler.handleDiscovery).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);
    const payload: WebhookPayload = {
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      text: { message: '1' },
    };

    const result = await route(user, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(discoveryHandler.handleDiscovery).toHaveBeenCalledWith(user, '5511999999999');
    expect(idleHandler.showMainMenu).not.toHaveBeenCalled();
  });

  it('routes IDLE + text "2" to handleBilateral', async () => {
    vi.mocked(bilateralHandler.handleBilateral).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.IDLE);
    const payload: WebhookPayload = {
      type: 'ReceivedCallback',
      phone: '5511999999999',
      instanceId: 'inst',
      messageId: 'msg-1',
      fromMe: false,
      text: { message: '2' },
    };

    const result = await route(user, { phone: '5511999999999' }, payload);

    expect(result.isOk()).toBe(true);
    expect(bilateralHandler.handleBilateral).toHaveBeenCalledWith(user, '5511999999999');
    expect(idleHandler.showMainMenu).not.toHaveBeenCalled();
  });

  it('routes BROWSING state to handleBrowsing', async () => {
    vi.mocked(discoveryHandler.handleBrowsing).mockResolvedValue(ok(undefined));
    const user = makeUser(ConversationStep.BROWSING);

    const result = await route(user, { phone: '5511999999999' }, makePayload());

    expect(result.isOk()).toBe(true);
    expect(discoveryHandler.handleBrowsing).toHaveBeenCalledWith(
      user,
      expect.any(Object),
      '5511999999999'
    );
    expect(idleHandler.showMainMenu).not.toHaveBeenCalled();
  });

  it('shows main menu for unknown state (fallback)', async () => {
    vi.mocked(idleHandler.showMainMenu).mockResolvedValue(ok(undefined));
    const user = makeUser('UNKNOWN_STATE' as ConversationStep);

    const result = await route(user, { phone: '5511999999999' }, makePayload());

    expect(result.isOk()).toBe(true);
    expect(idleHandler.showMainMenu).toHaveBeenCalled();
  });
});
