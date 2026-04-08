import { describe, it, expect } from 'vitest';
import {
  getModelMeta,
  getModelFamily,
  getModelCompany,
  supportsThinkingToggle,
  supportsVision,
  groupModelsByCompany,
} from '../renderer/utils/model-registry';

describe('getModelMeta', () => {
  it('returns metadata for a known gemma4 model', () => {
    const meta = getModelMeta('gemma4:27b');
    expect(meta).not.toBeNull();
    expect(meta.company).toBe('Google');
    expect(meta.supportsThinking).toBe('always');
    expect(meta.supportsVision).toBe(true);
  });

  it('returns metadata for deepseek-r1 before generic deepseek', () => {
    const meta = getModelMeta('deepseek-r1:7b');
    expect(meta.supportsThinking).toBe('always');
  });

  it('returns generic deepseek metadata for deepseek-v3', () => {
    const meta = getModelMeta('deepseek-v3.2:latest');
    expect(meta.supportsThinking).toBe(false);
  });

  it('returns null for unknown model', () => {
    expect(getModelMeta('unknown-model:latest')).toBeNull();
  });
});

describe('supportsThinkingToggle', () => {
  it('returns true for qwen3 models', () => {
    expect(supportsThinkingToggle('qwen3:14b')).toBe(true);
  });

  it('returns false for gemma4 (always thinks)', () => {
    expect(supportsThinkingToggle('gemma4:27b')).toBe(false);
  });

  it('returns false for unknown model', () => {
    expect(supportsThinkingToggle('llama2:7b')).toBe(false);
  });
});

describe('supportsVision', () => {
  it('returns true for gemma4', () => {
    expect(supportsVision('gemma4:e4b')).toBe(true);
  });

  it('returns true for llama4', () => {
    expect(supportsVision('llama4:scout')).toBe(true);
  });

  it('returns false for qwen3 (non-VL)', () => {
    expect(supportsVision('qwen3:14b')).toBe(false);
  });

  it('returns true for qwen3-vl', () => {
    expect(supportsVision('qwen3-vl:7b')).toBe(true);
  });
});

describe('groupModelsByCompany', () => {
  it('groups known models by company', () => {
    const models = [
      { name: 'gemma4:27b' },
      { name: 'qwen3:14b' },
      { name: 'mystery:7b' },
    ];
    const groups = groupModelsByCompany(models);
    expect(groups['Google']).toHaveLength(1);
    expect(groups['Alibaba']).toHaveLength(1);
    expect(groups['Other']).toHaveLength(1);
  });

  it('returns empty object for empty list', () => {
    expect(groupModelsByCompany([])).toEqual({});
  });
});
