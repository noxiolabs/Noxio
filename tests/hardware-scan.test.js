/**
 * @file hardware-scan.test.js
 * @description Unit tests for the wizard hardware scan enrichment layer.
 * Runs against real detector.js — on non-Windows machines nvidia-smi and
 * powershell are absent so detector degrades gracefully (zeroed values).
 * Tests verify the enrichment logic and output shape regardless of platform.
 */

import { describe, it, expect } from 'vitest';
import { scanHardware } from '../main/wizard/hardware-scan';

describe('scanHardware()', () => {
  it('returns a WizardHardware object with the required shape', async () => {
    const result = await scanHardware();

    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('vramTier');
    expect(result).toHaveProperty('canRunChat');
    expect(result).toHaveProperty('canRunImage');
    expect(result).toHaveProperty('canRunVoice');
    expect(result).toHaveProperty('needsCloud');
  });

  it('vramTier is one of the 5 valid tier strings', async () => {
    const validTiers = ['18+', '10-18', '6-10', '3-6', '<3'];
    const result = await scanHardware();
    expect(validTiers).toContain(result.vramTier);
  });

  it('canRunVoice is always true (voice uses CPU only)', async () => {
    const result = await scanHardware();
    expect(result.canRunVoice).toBe(true);
  });

  it('needsCloud is true iff vramTier is <3', async () => {
    const result = await scanHardware();
    expect(result.needsCloud).toBe(result.vramTier === '<3');
  });

  it('canRunChat is false iff vramTier is <3', async () => {
    const result = await scanHardware();
    expect(result.canRunChat).toBe(result.vramTier !== '<3');
  });

  it('canRunImage is true only for 18+, 10-18, 6-10 tiers', async () => {
    const result = await scanHardware();
    const imageCapableTiers = ['18+', '10-18', '6-10'];
    expect(result.canRunImage).toBe(imageCapableTiers.includes(result.vramTier));
  });

  it('raw object has expected top-level keys', async () => {
    const result = await scanHardware();
    expect(result.raw).toHaveProperty('gpu');
    expect(result.raw).toHaveProperty('ram');
    expect(result.raw).toHaveProperty('cpu');
    expect(result.raw).toHaveProperty('os');
  });
});
