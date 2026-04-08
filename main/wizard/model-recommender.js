/**
 * @file model-recommender.js
 * @description VRAM-aware model recommendation algorithm. Given a VRAM tier and
 * selected capabilities, returns the best available model for each capability.
 * Also provides an alternatives catalog — all models from equal-or-lower VRAM
 * tiers across multiple model families — so the wizard and settings can offer
 * a rich swap dropdown without exceeding the user's GPU budget.
 *
 * Recommendation table (recommended defaults per tier):
 *   Tier       Chat              Coding                  Image
 *   18GB+      qwen2.5:32b       qwen2.5-coder:14b       FLUX.1-dev-fp8
 *   10–18GB    qwen2.5:14b       qwen2.5-coder:14b       FLUX.1-schnell-fp8
 *   6–10GB     qwen2.5:7b        qwen2.5-coder:7b        SDXL-lightning
 *   3–6GB      qwen2.5:3b        qwen2.5-coder:3b        SDXL 4-bit
 *   <3GB       Cloud recommended Cloud recommended        Cloud recommended
 *
 * Alternatives catalog adds Gemma 4, Llama 3.x, Phi 4, Mistral Nemo,
 * DeepSeek, and Code Llama so users can pick across model families.
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
 * Curated list of alternative models per capability, tagged with the minimum
 * VRAM tier required to run them. `getAlternatives()` filters this list to only
 * include models that fit within the user's GPU budget.
 *
 * Each entry:
 *   model   — Ollama model tag (e.g. 'gemma3:12b')
 *   label   — Human-readable display name shown in the wizard dropdown
 *   sizeGB  — Approximate download/disk size in GB
 *   minTier — Minimum VRAM tier needed ('18+' | '10-18' | '6-10' | '3-6')
 *   notes   — Optional short note surfaced in the UI (context window, strengths, etc.)
 *
 * @type {Record<'chat'|'coding'|'image', Array<{model:string, label:string, sizeGB:number, minTier:string, notes?:string}>>}
 */
const ALTERNATIVES_CATALOG = {
  chat: [
    // ── 18GB+ tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:31b',
      label: 'Gemma 4 31B',
      sizeGB: 19.0,
      minTier: '18+',
      notes: '256K context · vision · reasoning',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    {
      model: 'gemma4:26b',
      label: 'Gemma 4 26B (MoE)',
      sizeGB: 16.0,
      minTier: '10-18',
      notes: '128K context · vision · 4B active params',
    },
    {
      model: 'phi4',
      label: 'Phi 4 14B',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Strong reasoning',
    },
    {
      model: 'mistral-nemo',
      label: 'Mistral Nemo 12B',
      sizeGB: 7.1,
      minTier: '10-18',
      notes: 'Fast · multilingual',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    {
      model: 'gemma4:e4b',
      label: 'Gemma 4 E4B',
      sizeGB: 3.0,
      minTier: '6-10',
      notes: '128K context · vision · edge-optimised',
    },
    {
      model: 'mistral:7b',
      label: 'Mistral 7B',
      sizeGB: 4.1,
      minTier: '6-10',
      notes: 'Fast · well-rounded',
    },
    {
      model: 'llama3.1:8b',
      label: 'Llama 3.1 8B',
      sizeGB: 4.9,
      minTier: '6-10',
      notes: '128K context',
    },

    // ── 3–6GB tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:e2b',
      label: 'Gemma 4 E2B',
      sizeGB: 1.5,
      minTier: '3-6',
      notes: '128K context · vision · ultra-compact',
    },
    {
      model: 'phi4-mini',
      label: 'Phi 4 Mini 3.8B',
      sizeGB: 2.5,
      minTier: '3-6',
      notes: 'Strong reasoning for its size',
    },
    {
      model: 'llama3.2:3b',
      label: 'Llama 3.2 3B',
      sizeGB: 2.0,
      minTier: '3-6',
      notes: '128K context',
    },
  ],

  coding: [
    // ── 18GB+ tier ────────────────────────────────────────────────────────────
    {
      model: 'qwen2.5-coder:32b',
      label: 'Qwen 2.5 Coder 32B',
      sizeGB: 20.0,
      minTier: '18+',
      notes: 'Best-in-class coding',
    },
    {
      model: 'gemma4:31b',
      label: 'Gemma 4 31B',
      sizeGB: 19.0,
      minTier: '18+',
      notes: '256K context · strong at reasoning + code',
    },
    {
      model: 'deepseek-r1:14b',
      label: 'DeepSeek R1 14B',
      sizeGB: 9.0,
      minTier: '18+',
      notes: 'Strong reasoning + code',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    {
      model: 'gemma4:26b',
      label: 'Gemma 4 26B (MoE)',
      sizeGB: 16.0,
      minTier: '10-18',
      notes: '128K context · vision · agentic workflows',
    },
    {
      model: 'deepseek-coder-v2:16b',
      label: 'DeepSeek Coder V2 16B',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Specialized coding model',
    },
    {
      model: 'phi4',
      label: 'Phi 4 14B',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Strong at code + math',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    {
      model: 'gemma4:e4b',
      label: 'Gemma 4 E4B',
      sizeGB: 3.0,
      minTier: '6-10',
      notes: '128K context · vision · edge-optimised',
    },
    {
      model: 'codellama:13b',
      label: 'Code Llama 13B',
      sizeGB: 7.4,
      minTier: '6-10',
      notes: 'Meta\'s dedicated coding model',
    },

    // ── 3–6GB tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:e2b',
      label: 'Gemma 4 E2B',
      sizeGB: 1.5,
      minTier: '3-6',
      notes: '128K context · vision · ultra-compact',
    },
    {
      model: 'phi4-mini',
      label: 'Phi 4 Mini 3.8B',
      sizeGB: 2.5,
      minTier: '3-6',
      notes: 'Solid code for its size',
    },
    {
      model: 'llama3.2:3b',
      label: 'Llama 3.2 3B',
      sizeGB: 2.0,
      minTier: '3-6',
      notes: '128K context',
    },
  ],

  image: [
    // ── 18GB+ tier ────────────────────────────────────────────────────────────
    // (FLUX.1-dev-fp8 is the recommended model for 18+ — excluded automatically)
    // Offer schnell as a lighter/faster alternative for 18+ users
    {
      model: 'FLUX.1-schnell-fp8',
      label: 'FLUX.1 Schnell FP8',
      sizeGB: 9.0,
      minTier: '18+',
      notes: 'Faster · slightly lower quality',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    // (FLUX.1-schnell-fp8 is the recommended model for 10-18)
    {
      model: 'SDXL-lightning',
      label: 'SDXL Lightning',
      sizeGB: 6.5,
      minTier: '10-18',
      notes: 'Faster · lower VRAM · 1024×1024',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    // (SDXL-lightning is the recommended model for 6-10)
    {
      model: 'SDXL-4bit',
      label: 'SDXL 4-bit',
      sizeGB: 3.5,
      minTier: '6-10',
      notes: 'Quantised · lower VRAM · 1024×1024',
    },

    // ── 3–6GB tier ────────────────────────────────────────────────────────────
    // (SDXL-4bit is the recommended model for 3-6 — no meaningful alternatives at this size)
  ],
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
 * VRAM tier. Sources from the multi-family ALTERNATIVES_CATALOG rather than just
 * lower-tier Qwen variants, so the user gets real choice across model families.
 *
 * The recommended model for the given tier is excluded — it is the default and
 * will be shown separately in the UI. Voice capability has no alternatives.
 *
 * @param {string} vramTier - '18+' | '10-18' | '6-10' | '3-6' | '<3'
 * @param {string} capability - 'chat' | 'coding' | 'image' | 'voice'
 * @returns {Array<{model: string, label: string, sizeGB: number, tier: string, notes?: string}>}
 */
function getAlternatives(vramTier, capability) {
  if (capability === 'voice') return [];

  const userTierIndex = TIER_ORDER.indexOf(vramTier);
  if (userTierIndex === -1) return [];

  const catalog = ALTERNATIVES_CATALOG[capability] ?? [];
  if (!catalog.length) return [];

  // The recommended model for the user's own tier — exclude from alternatives list
  const ownTierRec = (RECOMMENDATIONS[vramTier] || {})[capability];
  const recommendedModel = ownTierRec ? ownTierRec.model : null;

  return catalog.filter((entry) => {
    // Must fit within the user's VRAM tier
    const entryTierIndex = TIER_ORDER.indexOf(entry.minTier);
    if (entryTierIndex === -1) return false;
    if (entryTierIndex < userTierIndex) return false; // needs more VRAM than user has

    // Exclude the recommended model — it's shown as the default
    if (entry.model === recommendedModel) return false;

    return true;
  }).map((entry) => ({
    model:  entry.model,
    label:  entry.label,
    sizeGB: entry.sizeGB,
    tier:   entry.minTier,
    ...(entry.notes ? { notes: entry.notes } : {}),
  }));
}

module.exports = { recommend, getAlternatives, RECOMMENDATIONS, TIER_ORDER, ALTERNATIVES_CATALOG };
