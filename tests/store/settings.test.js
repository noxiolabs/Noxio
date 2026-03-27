/**
 * @file settings.test.js
 * @description Unit tests for the settings Redux slice.
 */

import { describe, it, expect } from 'vitest';
import reducer, {
  completeSetup,
  setModel,
} from '../../renderer/store/slices/settings';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyState() {
  return reducer(undefined, { type: '@@INIT' });
}

// ─── completeSetup ────────────────────────────────────────────────────────────

describe('completeSetup', () => {
  it('sets setupComplete to true', () => {
    const state = reducer(emptyState(), completeSetup());
    expect(state.setupComplete).toBe(true);
  });

  it('is idempotent', () => {
    let state = reducer(emptyState(), completeSetup());
    state = reducer(state, completeSetup());
    expect(state.setupComplete).toBe(true);
  });
});

// ─── setModel ────────────────────────────────────────────────────────────────

describe('setModel', () => {
  it('sets the chat model', () => {
    const state = reducer(emptyState(), setModel({ capability: 'chat', model: 'qwen2.5:14b' }));
    expect(state.models.chat).toBe('qwen2.5:14b');
  });

  it('sets the coding model independently of chat model', () => {
    let state = reducer(emptyState(), setModel({ capability: 'chat', model: 'qwen2.5:14b' }));
    state = reducer(state, setModel({ capability: 'coding', model: 'qwen2.5-coder:14b' }));
    expect(state.models.chat).toBe('qwen2.5:14b');
    expect(state.models.coding).toBe('qwen2.5-coder:14b');
  });

  it('is a no-op for an unknown capability', () => {
    const before = emptyState();
    const state = reducer(before, setModel({ capability: 'video', model: 'some-model' }));
    expect(state.models).toEqual(before.models);
  });
});
