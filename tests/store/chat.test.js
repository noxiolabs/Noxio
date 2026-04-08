/**
 * @file chat.test.js
 * @description Unit tests for the chat Redux slice. Covers all reducers including
 * the fixes applied in the pre-phase-4 hardening pass:
 *   - createConversation accepts a caller-supplied id (race-condition fix)
 *   - sendMessage is a no-op when there is no active conversation
 *   - appendStreamToken is a no-op when the streaming message doesn't exist
 *   - finaliseStream resets streaming state and auto-titles the conversation
 */

import { describe, it, expect } from 'vitest';
import reducer, {
  createConversation,
  setActiveConversation,
  sendMessage,
  appendStreamToken,
  finaliseStream,
  deleteConversation,
  setSelectedModel,
} from '../../renderer/store/slices/chat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyState() {
  return reducer(undefined, { type: '@@INIT' });
}

function stateWithConversation(model = 'qwen2.5:14b') {
  return reducer(emptyState(), createConversation({ model }));
}

// ─── createConversation ───────────────────────────────────────────────────────

describe('createConversation', () => {
  it('adds a new conversation to the list', () => {
    const state = stateWithConversation();
    expect(state.conversations).toHaveLength(1);
  });

  it('sets the new conversation as active', () => {
    const state = stateWithConversation();
    expect(state.activeConversationId).toBe(state.conversations[0].id);
  });

  it('uses a caller-supplied id when provided (race-condition fix)', () => {
    const id = 'fixed-id-123';
    const state = reducer(emptyState(), createConversation({ id, model: 'qwen2.5:14b' }));
    expect(state.conversations[0].id).toBe(id);
    expect(state.activeConversationId).toBe(id);
  });

  it('auto-generates an id when none is supplied', () => {
    const state = stateWithConversation();
    expect(typeof state.conversations[0].id).toBe('string');
    expect(state.conversations[0].id.length).toBeGreaterThan(0);
  });

  it('prepends new conversation (most recent first)', () => {
    let state = stateWithConversation();
    state = reducer(state, createConversation({ model: 'qwen2.5:14b' }));
    // Second conversation should be at index 0 (most recent)
    expect(state.conversations).toHaveLength(2);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
  });

  it('sets model from payload', () => {
    const state = reducer(emptyState(), createConversation({ model: 'llama3:8b' }));
    expect(state.conversations[0].model).toBe('llama3:8b');
  });

  it('falls back to selectedModel when no model in payload', () => {
    let state = reducer(emptyState(), setSelectedModel('qwen2.5:7b'));
    state = reducer(state, createConversation({}));
    expect(state.conversations[0].model).toBe('qwen2.5:7b');
  });
});

// ─── sendMessage ─────────────────────────────────────────────────────────────

describe('sendMessage', () => {
  it('adds a user message and an assistant placeholder to the active conversation', () => {
    const state = reducer(stateWithConversation(), sendMessage({ content: 'Hello' }));
    const conv = state.conversations[0];
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('Hello');
    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('');
  });

  it('sets streaming=true and records streamingMessageId', () => {
    const state = reducer(stateWithConversation(), sendMessage({ content: 'Hi' }));
    expect(state.streaming).toBe(true);
    expect(state.streamingMessageId).toBeTruthy();
    expect(state.streamingMessageId).toBe(state.conversations[0].messages[1].id);
  });

  it('is a no-op when there is no active conversation', () => {
    const state = reducer(emptyState(), sendMessage({ content: 'orphan' }));
    expect(state.conversations).toHaveLength(0);
    expect(state.streaming).toBe(false);
  });
});

// ─── appendStreamToken ───────────────────────────────────────────────────────

describe('appendStreamToken', () => {
  function streamingState() {
    return reducer(stateWithConversation(), sendMessage({ content: 'Hello' }));
  }

  it('appends the token to the streaming message', () => {
    let state = streamingState();
    state = reducer(state, appendStreamToken('Hello'));
    state = reducer(state, appendStreamToken(' world'));
    const assistant = state.conversations[0].messages[1];
    expect(assistant.content).toBe('Hello world');
  });

  it('is a no-op when there is no active conversation', () => {
    // Manually construct a state with streaming=true but no conversation
    const base = emptyState();
    const orphaned = { ...base, streaming: true, streamingMessageId: 'ghost' };
    const state = reducer(orphaned, appendStreamToken('token'));
    expect(state.conversations).toHaveLength(0);
  });

  it('is a no-op when streamingMessageId is null', () => {
    const base = stateWithConversation();
    const state = reducer(base, appendStreamToken('token'));
    // No streaming message exists — messages array should still be empty
    expect(base.conversations[0].messages).toHaveLength(0);
    expect(state.conversations[0].messages).toHaveLength(0);
  });
});

// ─── finaliseStream ───────────────────────────────────────────────────────────

describe('finaliseStream', () => {
  function streamingState(content = 'Tell me about Mars') {
    return reducer(stateWithConversation(), sendMessage({ content }));
  }

  it('sets streaming=false and clears streamingMessageId', () => {
    const state = reducer(streamingState(), finaliseStream());
    expect(state.streaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  it('auto-titles the conversation from the first user message (≤40 chars)', () => {
    const state = reducer(streamingState('Short question'), finaliseStream());
    expect(state.conversations[0].title).toBe('Short question');
  });

  it('truncates auto-title at 40 chars with ellipsis', () => {
    const long = 'A'.repeat(50);
    const state = reducer(streamingState(long), finaliseStream());
    expect(state.conversations[0].title).toBe('A'.repeat(40) + '…');
  });

  it('does not overwrite a manually set title', () => {
    // Redux Toolkit freezes state via Immer so we can't mutate directly.
    // Deep-clone to get an unfrozen copy before setting the custom title.
    let state = JSON.parse(JSON.stringify(stateWithConversation()));
    state.conversations[0].title = 'My custom title';
    state = reducer(state, sendMessage({ content: 'New message' }));
    state = reducer(state, finaliseStream());
    expect(state.conversations[0].title).toBe('My custom title');
  });

  it('is idempotent — calling twice does not crash', () => {
    let state = reducer(streamingState(), finaliseStream());
    state = reducer(state, finaliseStream());
    expect(state.streaming).toBe(false);
  });
});

// ─── deleteConversation ───────────────────────────────────────────────────────

describe('deleteConversation', () => {
  it('removes the specified conversation', () => {
    // Use the SAME initial state for both the ID lookup and the dispatch —
    // two calls to stateWithConversation() produce two different nanoid()s.
    const initial = stateWithConversation();
    const state = reducer(initial, deleteConversation(initial.conversations[0].id));
    expect(state.conversations).toHaveLength(0);
  });

  it('sets activeConversationId to the next conversation when deleting the active one', () => {
    let state = stateWithConversation();
    state = reducer(state, createConversation({ model: 'qwen2.5:14b' }));
    // conversations[0] is the latest (active), conversations[1] is the older one
    const activeId = state.activeConversationId;
    const otherId  = state.conversations[1].id;
    state = reducer(state, deleteConversation(activeId));
    expect(state.activeConversationId).toBe(otherId);
  });

  it('sets activeConversationId to null when the last conversation is deleted', () => {
    const init = stateWithConversation();
    const state = reducer(init, deleteConversation(init.conversations[0].id));
    expect(state.activeConversationId).toBeNull();
  });

  it('does not change activeConversationId when deleting a non-active conversation', () => {
    let state = stateWithConversation();
    const firstId = state.conversations[0].id;
    state = reducer(state, createConversation({ model: 'qwen2.5:14b' }));
    // Active is now the second conversation (index 0). Delete the older one.
    state = reducer(state, deleteConversation(firstId));
    expect(state.activeConversationId).not.toBe(firstId);
    expect(state.conversations).toHaveLength(1);
  });
});

// ─── setSelectedModel ─────────────────────────────────────────────────────────

describe('setSelectedModel', () => {
  it('updates selectedModel', () => {
    const state = reducer(emptyState(), setSelectedModel('llama3:8b'));
    expect(state.selectedModel).toBe('llama3:8b');
  });

  it('can be set to null', () => {
    let state = reducer(emptyState(), setSelectedModel('llama3:8b'));
    state = reducer(state, setSelectedModel(null));
    expect(state.selectedModel).toBeNull();
  });
});

// ─── sendMessage with attachments ─────────────────────────────────────────

describe('sendMessage with attachments', () => {
  it('stores attachment metadata on the user message', () => {
    const state0 = stateWithConversation();
    const state1 = reducer(state0, sendMessage({
      content: 'Look at this',
      attachments: [{ name: 'photo.png', type: 'image' }],
    }));
    const conv = state1.conversations[0];
    const userMsg = conv.messages[0];
    expect(userMsg.role).toBe('user');
    expect(userMsg.attachments).toEqual([{ name: 'photo.png', type: 'image' }]);
  });

  it('stores empty array when no attachments provided', () => {
    const state0 = stateWithConversation();
    const state1 = reducer(state0, sendMessage({ content: 'Hello' }));
    const userMsg = state1.conversations[0].messages[0];
    expect(userMsg.attachments).toEqual([]);
  });
});
