/**
 * @file model-recommender.js
 * @description VRAM-aware model recommendation algorithm. Given a VRAM tier and
 * selected capabilities, returns the best available model for each capability.
 * Also provides an alternatives list — all models from equal-or-lower VRAM tiers —
 * so the wizard can offer a swap dropdown without exceeding the user's GPU budget.
 *
 * Recommendation table (from CLAUDE.md):
 *   Tier       Chat              Coding                  Image
 *   18GB+      qwen2.5:32b       qwen2.5-coder:14b       FLUX.1-dev-fp8
 *   10–18GB    qwen2.5:14b       qwen2.5-coder:14b       FLUX.1-schnell-fp8
 *   6–10GB     qwen2.5:7b        qwen2.5-coder:7b        SDXL-lightning
 *   3–6GB      qwen2.5:3b        qwen2.5-coder:3b        SDXL 4-bit
 *   <3GB       Cloud recommended Cloud recommended        Cloud recommended
 *
 * TODO Phase 3: wire to wizard UI and real hardware data from hardware-scan.js.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Ordered list of tiers from highest VRAM requirement to lowest.
 * Position in this array determines which tiers are "equal-or-lower" for a given tier.
 * @type {string[]}
 */
const TIER_ORDER = ['18+', '10-18', '6-10', '3-6', '<3'];

/** @type {Record<string, {chat: Object, coding: Object, image: Object}>} */
const RECOMMENDATIONS = {
  '18+': {
    chat:   { model: 'qwen2.5:32b',          sizeGB: 20.0 },
    coding: { model: 'qwen2.5-coder:14b',    sizeGB: 8.5  },
    image:  { model: 'FLUX.1-dev-fp8',        sizeGB: 17.0 },
  },
  '10-18': {
    chat:   { model: 'qwen2.5:14b',          sizeGB: 8.5  },
    coding: { model: 'qwen2.5-coder:14b',    sizeGB: 8.5  },
    image:  { model: 'FLUX.1-schnell-fp8',   sizeGB: 9.0  },
  },
  '6-10': {
    chat:   { model: 'qwen2.5:7b',           sizeGB: 4.5  },
    coding: { model: 'qwen2.5-coder:7b',     sizeGB: 4.5  },
    image:  { model: 'SDXL-lightning',        sizeGB: 6.5  },
  },
  '3-6': {
    chat:   { model: 'qwen2.5:3b',           sizeGB: 2.0  },
    coding: { model: 'qwen2.5-coder:3b',     sizeGB: 2.0  },
    image:  { model: 'SDXL-4bit',            sizeGB: 3.5  },
  },
  '<3': {
    chat:   { model: null, cloudRecommended: true },
    coding: { model: null, cloudRecommended: true },
    image:  { model: null, cloudRecommended: true },
  },
};

/**
 * Returns model recommendations for the given VRAM tier and selected capabilities.
 * @param {string} vramTier - '18+' | '10-18' | '6-10' | '3-6' | '<3'
 * @param {string[]} capabilities - subset of ['chat', 'coding', 'image', 'voice']
 * @returns {Object} Recommendation map keyed by capability
 */
function recommend(vramTier, capabilities) {
  logger.info(`model-recommender: recommend(tier=${vramTier}, caps=${capabilities})`);
  const tier = RECOMMENDATIONS[vramTier] || RECOMMENDATIONS['<3'];
  const result = {};

  if (capabilities.includes('chat'))   result.chat   = tier.chat;
  if (capabilities.includes('coding')) result.coding = tier.coding;
  if (capabilities.includes('image'))  result.image  = tier.image;
  if (capabilities.includes('voice'))  result.voice  = { stt: 'faster-whisper-large-v3', tts: 'kokoro', sizeGB: 1.5 };

  return result;
}

/**
 * Returns all alternative models for a given capability that fit within the user's
 * VRAM tier (i.e., models from lower-VRAM tiers, which are guaranteed to fit).
 * The recommended model for the given tier is excluded — it is the default and
 * will be shown separately in the UI.
 *
 * Models from higher tiers are never included, as they would not fit in VRAM.
 * Voice capability has no alternatives (it always uses faster-whisper + kokoro).
 *
 * @param {string} vramTier - '18+' | '10-18' | '6-10' | '3-6' | '<3'
 * @param {string} capability - 'chat' | 'coding' | 'image' | 'voice'
 * @returns {Array<{model: string, sizeGB: number, tier: string}>}
 */
function getAlternatives(vramTier, capability) {
  if (capability === 'voice') return [];

  const userTierIndex = TIER_ORDER.indexOf(vramTier);
  if (userTierIndex === -1) return [];

  // The recommended model for the user's own tier — we exclude it from alternatives
  // since it is already shown as the default selection.
  const ownTierRec = (RECOMMENDATIONS[vramTier] || {})[capability];
  const recommendedModel = ownTierRec ? ownTierRec.model : null;

  const alternatives = [];

  // Walk tiers that are equal-or-lower (same index or higher index in TIER_ORDER).
  // Skip '<3' since those entries have model: null (cloud-only).
  for (let i = userTierIndex; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    if (tier === '<3') continue;

    const entry = (RECOMMENDATIONS[tier] || {})[capability];
    if (!entry || !entry.model) continue;

    // Skip the recommended model — it will be the default option in the dropdown
    if (entry.model === recommendedModel) continue;

    // Avoid duplicates (e.g. qwen2.5-coder:14b appears in both 18+ and 10-18)
    if (alternatives.some((a) => a.model === entry.model)) continue;

    alternatives.push({ model: entry.model, sizeGB: entry.sizeGB, tier });
  }

  return alternatives;
}

module.exports = { recommend, getAlternatives, RECOMMENDATIONS, TIER_ORDER };
