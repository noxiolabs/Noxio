/**
 * @file model-downloader.test.js
 * @description Unit tests for the model downloader.
 * Ollama tests verify error handling without a real Ollama connection.
 * HuggingFace tests verify the Phase 5/6 stub behaviour (skips with 100%).
 */

import { describe, it, expect } from 'vitest';
import { downloadModel } from '../main/wizard/model-downloader';

describe('downloadModel() with source=huggingface', () => {
  it('resolves without throwing', async () => {
    await expect(
      downloadModel({ model: 'FLUX.1-schnell', source: 'huggingface' })
    ).resolves.toBeUndefined();
  });

  it('calls onProgress with percent=100 and status=skipped', async () => {
    const calls = [];
    await downloadModel({
      model: 'FLUX.1-schnell',
      source: 'huggingface',
      onProgress: (p) => calls.push(p),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ model: 'FLUX.1-schnell', percent: 100, status: 'skipped' });
  });

  it('works without an onProgress callback', async () => {
    await expect(
      downloadModel({ model: 'SDXL-lightning', source: 'huggingface' })
    ).resolves.toBeUndefined();
  });
});

describe('downloadModel() with source=ollama (Ollama not running)', () => {
  it('rejects with an error when Ollama is not reachable', async () => {
    await expect(
      downloadModel({ model: 'qwen2.5:14b', source: 'ollama' })
    ).rejects.toThrow();
  });

  it('propagates the error to the caller', async () => {
    let thrown = null;
    try {
      await downloadModel({ model: 'qwen2.5:14b', source: 'ollama' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
  });
});
