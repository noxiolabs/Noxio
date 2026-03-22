/**
 * @file settings.test.js
 * @description Unit tests for the settings Redux slice. Covers the budget
 * clamping fix (negative monthlyBudgetUSD / usedUSD must be rejected) and
 * all other public reducers.
 */

import { describe, it, expect } from 'vitest';
import reducer, {
  completeSetup,
  updateCloudProvider,
  updateCloudUsage,
  updateRouting,
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

// ─── updateCloudProvider ──────────────────────────────────────────────────────

describe('updateCloudProvider', () => {
  it('enables a provider', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { enabled: true } }));
    expect(state.cloudProviders.openai.enabled).toBe(true);
  });

  it('sets a valid monthly budget', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'anthropic', config: { monthlyBudgetUSD: 20 } }));
    expect(state.cloudProviders.anthropic.monthlyBudgetUSD).toBe(20);
  });

  it('clamps negative monthlyBudgetUSD to 0 (budget validation fix)', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { monthlyBudgetUSD: -50 } }));
    expect(state.cloudProviders.openai.monthlyBudgetUSD).toBe(0);
  });

  it('clamps negative usedUSD to 0', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'google', config: { usedUSD: -10 } }));
    expect(state.cloudProviders.google.usedUSD).toBe(0);
  });

  it('accepts zero as a valid budget', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { monthlyBudgetUSD: 0 } }));
    expect(state.cloudProviders.openai.monthlyBudgetUSD).toBe(0);
  });

  it('coerces non-numeric budget strings to 0', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { monthlyBudgetUSD: 'abc' } }));
    expect(state.cloudProviders.openai.monthlyBudgetUSD).toBe(0);
  });

  it('coerces float budgets correctly (no truncation)', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { monthlyBudgetUSD: 9.99 } }));
    expect(state.cloudProviders.openai.monthlyBudgetUSD).toBe(9.99);
  });

  it('is a no-op for an unknown provider', () => {
    const before = emptyState();
    const state = reducer(before, updateCloudProvider({ provider: 'unknown_co', config: { enabled: true } }));
    expect(state.cloudProviders).toEqual(before.cloudProviders);
  });

  it('does not mutate other providers', () => {
    const state = reducer(emptyState(), updateCloudProvider({ provider: 'openai', config: { enabled: true } }));
    expect(state.cloudProviders.anthropic.enabled).toBe(false);
    expect(state.cloudProviders.google.enabled).toBe(false);
  });
});

// ─── updateCloudUsage ─────────────────────────────────────────────────────────

describe('updateCloudUsage', () => {
  it('updates usedUSD for the specified provider', () => {
    const state = reducer(emptyState(), updateCloudUsage({ provider: 'anthropic', usedUSD: 4.75 }));
    expect(state.cloudProviders.anthropic.usedUSD).toBe(4.75);
  });

  it('does not affect other providers', () => {
    const state = reducer(emptyState(), updateCloudUsage({ provider: 'openai', usedUSD: 3 }));
    expect(state.cloudProviders.anthropic.usedUSD).toBe(0);
    expect(state.cloudProviders.google.usedUSD).toBe(0);
  });

  it('is a no-op for an unknown provider', () => {
    const before = emptyState();
    const state = reducer(before, updateCloudUsage({ provider: 'mystery', usedUSD: 99 }));
    expect(state.cloudProviders).toEqual(before.cloudProviders);
  });
});

// ─── updateRouting ────────────────────────────────────────────────────────────

describe('updateRouting', () => {
  it('updates routing preferences', () => {
    const state = reducer(emptyState(), updateRouting({ allowCloudForComplexReasoning: true }));
    expect(state.routing.allowCloudForComplexReasoning).toBe(true);
  });

  it('preserves unspecified routing keys', () => {
    const state = reducer(emptyState(), updateRouting({ allowCloudForComplexReasoning: true }));
    expect(state.routing.preferLocal).toBe(true);
    expect(state.routing.allowCloudForLongContext).toBe(true);
  });

  it('can disable preferLocal', () => {
    const state = reducer(emptyState(), updateRouting({ preferLocal: false }));
    expect(state.routing.preferLocal).toBe(false);
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
