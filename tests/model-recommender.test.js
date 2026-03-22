/**
 * @file model-recommender.test.js
 * @description Unit tests for the VRAM-tier model recommendation algorithm.
 * No mocks needed — this module is pure logic.
 */

import { describe, it, expect } from 'vitest';
const { recommend, RECOMMENDATIONS } = require('../main/wizard/model-recommender');

describe('RECOMMENDATIONS table', () => {
  it('has entries for all 5 VRAM tiers', () => {
    const tiers = ['18+', '10-18', '6-10', '3-6', '<3'];
    tiers.forEach((tier) => {
      expect(RECOMMENDATIONS[tier]).toBeDefined();
    });
  });

  it('each non-cloud tier has model + sizeGB for chat and coding', () => {
    ['18+', '10-18', '6-10', '3-6'].forEach((tier) => {
      expect(RECOMMENDATIONS[tier].chat.model).toBeTruthy();
      expect(RECOMMENDATIONS[tier].chat.sizeGB).toBeGreaterThan(0);
      expect(RECOMMENDATIONS[tier].coding.model).toBeTruthy();
      expect(RECOMMENDATIONS[tier].coding.sizeGB).toBeGreaterThan(0);
    });
  });

  it('<3GB tier recommends cloud for all capabilities', () => {
    expect(RECOMMENDATIONS['<3'].chat.model).toBeNull();
    expect(RECOMMENDATIONS['<3'].chat.cloudRecommended).toBe(true);
    expect(RECOMMENDATIONS['<3'].coding.cloudRecommended).toBe(true);
    expect(RECOMMENDATIONS['<3'].image.cloudRecommended).toBe(true);
  });
});

describe('recommend()', () => {
  it('returns only the requested capabilities', () => {
    const result = recommend('10-18', ['chat']);
    expect(result.chat).toBeDefined();
    expect(result.coding).toBeUndefined();
    expect(result.image).toBeUndefined();
  });

  it('returns correct models for 10-18GB tier', () => {
    const result = recommend('10-18', ['chat', 'coding']);
    expect(result.chat.model).toBe('qwen2.5:14b');
    expect(result.chat.sizeGB).toBe(8.5);
    expect(result.coding.model).toBe('qwen2.5-coder:14b');
    expect(result.coding.sizeGB).toBe(8.5);
  });

  it('returns correct models for 6-10GB tier', () => {
    const result = recommend('6-10', ['chat', 'coding', 'image']);
    expect(result.chat.model).toBe('qwen2.5:7b');
    expect(result.coding.model).toBe('qwen2.5-coder:7b');
    expect(result.image.model).toBe('SDXL-lightning');
  });

  it('includes voice with stt + tts fields when requested', () => {
    const result = recommend('10-18', ['voice']);
    expect(result.voice.stt).toBeTruthy();
    expect(result.voice.tts).toBeTruthy();
    expect(result.voice.sizeGB).toBeGreaterThan(0);
  });

  it('falls back to <3 tier for unknown tier string', () => {
    const result = recommend('unknown-tier', ['chat']);
    expect(result.chat.cloudRecommended).toBe(true);
  });

  it('returns empty object for empty capabilities list', () => {
    const result = recommend('10-18', []);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
