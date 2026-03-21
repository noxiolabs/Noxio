/**
 * @file hardware-scan.test.js
 * @description Unit tests for the wizard hardware scan enrichment layer.
 * Runs against real detector.js — on non-Windows machines nvidia-smi and
 * powershell are absent so detector degrades gracefully (zeroed values).
 * Tests verify the enrichment logic and output shape regardless of platform.
 *
 * Also covers the detectHardware() failure fallback added in the pre-phase-4
 * hardening pass: if detectHardware() throws, scanHardware() must return a
 * valid WizardHardware object rather than propagating the error.
 */

import { describe, it, expect, vi } from 'vitest';
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

// ─── Failure path (detectHardware throws) ────────────────────────────────────

describe('scanHardware() — detectHardware failure fallback', () => {
  it('returns a valid WizardHardware object when detectHardware throws', async () => {
    // Force detectHardware to throw by mocking the detector module
    const detector = await import('../main/infrastructure/detector');
    const spy = vi.spyOn(detector, 'detectHardware').mockRejectedValueOnce(
      new Error('nvidia-smi not found')
    );

    const result = await scanHardware();

    // Should NOT throw — must return a valid fallback
    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('vramTier');
    expect(result).toHaveProperty('canRunChat');
    expect(result).toHaveProperty('canRunVoice');
    expect(result).toHaveProperty('needsCloud');

    // Fallback tier is always '<3' so user is prompted to use cloud
    expect(result.vramTier).toBe('<3');
    expect(result.needsCloud).toBe(true);
    expect(result.canRunVoice).toBe(true); // voice is always available

    // raw must have the correct shape so getVramTier and wizard screens don't crash
    expect(result.raw).toHaveProperty('gpu');
    expect(result.raw).toHaveProperty('ram');
    expect(result.raw).toHaveProperty('cpu');
    expect(result.raw).toHaveProperty('os');
    expect(result.raw.gpu).toHaveProperty('vramTotalMB');
    expect(result.raw.gpu.vramTotalMB).toBe(0);

    spy.mockRestore();
  });
});
