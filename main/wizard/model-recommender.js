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
 *   18GB+      gemma4:31b        qwen2.5-coder:14b       FLUX.1-dev-fp8
 *   10–18GB    gemma4:26b        qwen2.5-coder:14b       FLUX.2-klein-9b-fp8
 *   6–10GB     gemma4:e4b        qwen2.5-coder:7b        FLUX.2-klein-4b-fp8
 *   3–6GB      gemma4:e2b        qwen2.5-coder:3b        SDXL 4-bit
 *   <3GB       Cloud recommended Cloud recommended        Cloud recommended
 *
 * Alternatives catalog adds Qwen 2.5, Llama 3.x, Phi 4, Mistral Nemo,
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
    chat:   { model: 'gemma4:31b',         label: 'Gemma 4 31B',         company: 'Google',    sizeGB: 19.0 },
    coding: { model: 'qwen2.5-coder:14b',  label: 'Qwen 2.5 Coder 14B', company: 'Alibaba',   sizeGB: 8.5  },
    image:  { model: 'FLUX.1-dev-fp8',     label: 'FLUX.1 Dev FP8',      company: 'BFL',       sizeGB: 17.0 },
  },
  '10-18': {
    chat:   { model: 'gemma4:26b',            label: 'Gemma 4 26B',            company: 'Google',  sizeGB: 16.0 },
    coding: { model: 'qwen2.5-coder:14b',     label: 'Qwen 2.5 Coder 14B',    company: 'Alibaba', sizeGB: 8.5  },
    image:  { model: 'FLUX.2-klein-9b-fp8',   label: 'FLUX.2 Klein 9B FP8',   company: 'BFL',     sizeGB: 9.0,  gated: true },
  },
  '6-10': {
    chat:   { model: 'gemma4:e4b',            label: 'Gemma 4 E4B',            company: 'Google',  sizeGB: 3.0  },
    coding: { model: 'qwen2.5-coder:7b',      label: 'Qwen 2.5 Coder 7B',     company: 'Alibaba', sizeGB: 4.5  },
    image:  { model: 'FLUX.2-klein-4b-fp8',   label: 'FLUX.2 Klein 4B FP8',   company: 'BFL',     sizeGB: 4.0 },
  },
  '3-6': {
    chat:   { model: 'gemma4:e2b',         label: 'Gemma 4 E2B',         company: 'Google',    sizeGB: 1.5  },
    coding: { model: 'qwen2.5-coder:3b',   label: 'Qwen 2.5 Coder 3B',  company: 'Alibaba',   sizeGB: 2.0  },
    image:  { model: 'SDXL-4bit',          label: 'SDXL 4-bit',           company: 'Stability', sizeGB: 3.5  },
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
 *   model   — Ollama model tag (e.g. 'gemma4:e4b')
 *   label   — Human-readable display name shown in the wizard dropdown
 *   company — Model family company (used for grouping in the UI)
 *   sizeGB  — Approximate download/disk size in GB
 *   minTier — Minimum VRAM tier needed ('18+' | '10-18' | '6-10' | '3-6')
 *   notes   — Optional short note surfaced in the UI (context window, strengths, etc.)
 *
 * @type {Record<'chat'|'coding'|'image', Array>}
 */
const ALTERNATIVES_CATALOG = {
  chat: [
    // ── 18GB+ tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:31b',
      label: 'Gemma 4 31B',
      company: 'Google',
      sizeGB: 19.0,
      minTier: '18+',
      notes: '256K context · vision · reasoning',
    },
    {
      model: 'qwen2.5:32b',
      label: 'Qwen 2.5 32B',
      company: 'Alibaba',
      sizeGB: 20.0,
      minTier: '18+',
      notes: 'Strong multilingual · long context',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    {
      model: 'gemma4:26b',
      label: 'Gemma 4 26B (MoE)',
      company: 'Google',
      sizeGB: 16.0,
      minTier: '10-18',
      notes: '128K context · vision · 4B active params',
    },
    {
      model: 'qwen2.5:14b',
      label: 'Qwen 2.5 14B',
      company: 'Alibaba',
      sizeGB: 8.5,
      minTier: '10-18',
      notes: 'Strong reasoning · multilingual',
    },
    {
      model: 'phi4',
      label: 'Phi 4 14B',
      company: 'Microsoft',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Strong reasoning',
    },
    {
      model: 'mistral-nemo',
      label: 'Mistral Nemo 12B',
      company: 'Mistral AI',
      sizeGB: 7.1,
      minTier: '10-18',
      notes: 'Fast · multilingual',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    {
      model: 'gemma4:e4b',
      label: 'Gemma 4 E4B',
      company: 'Google',
      sizeGB: 3.0,
      minTier: '6-10',
      notes: '128K context · vision · edge-optimised',
    },
    {
      model: 'qwen2.5:7b',
      label: 'Qwen 2.5 7B',
      company: 'Alibaba',
      sizeGB: 4.5,
      minTier: '6-10',
      notes: 'Well-rounded · fast',
    },
    {
      model: 'mistral:7b',
      label: 'Mistral 7B',
      company: 'Mistral AI',
      sizeGB: 4.1,
      minTier: '6-10',
      notes: 'Fast · well-rounded',
    },
    {
      model: 'llama3.1:8b',
      label: 'Llama 3.1 8B',
      company: 'Meta',
      sizeGB: 4.9,
      minTier: '6-10',
      notes: '128K context',
    },

    // ── 3–6GB tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:e2b',
      label: 'Gemma 4 E2B',
      company: 'Google',
      sizeGB: 1.5,
      minTier: '3-6',
      notes: '128K context · vision · ultra-compact',
    },
    {
      model: 'qwen2.5:3b',
      label: 'Qwen 2.5 3B',
      company: 'Alibaba',
      sizeGB: 2.0,
      minTier: '3-6',
      notes: 'Fast · capable for its size',
    },
    {
      model: 'phi4-mini',
      label: 'Phi 4 Mini 3.8B',
      company: 'Microsoft',
      sizeGB: 2.5,
      minTier: '3-6',
      notes: 'Strong reasoning for its size',
    },
    {
      model: 'llama3.2:3b',
      label: 'Llama 3.2 3B',
      company: 'Meta',
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
      company: 'Alibaba',
      sizeGB: 20.0,
      minTier: '18+',
      notes: 'Best-in-class coding',
    },
    {
      model: 'gemma4:31b',
      label: 'Gemma 4 31B',
      company: 'Google',
      sizeGB: 19.0,
      minTier: '18+',
      notes: '256K context · strong at reasoning + code',
    },
    {
      model: 'deepseek-r1:14b',
      label: 'DeepSeek R1 14B',
      company: 'DeepSeek',
      sizeGB: 9.0,
      minTier: '18+',
      notes: 'Strong reasoning + code',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    {
      model: 'gemma4:26b',
      label: 'Gemma 4 26B (MoE)',
      company: 'Google',
      sizeGB: 16.0,
      minTier: '10-18',
      notes: '128K context · vision · agentic workflows',
    },
    {
      model: 'deepseek-coder-v2:16b',
      label: 'DeepSeek Coder V2 16B',
      company: 'DeepSeek',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Specialized coding model',
    },
    {
      model: 'phi4',
      label: 'Phi 4 14B',
      company: 'Microsoft',
      sizeGB: 9.1,
      minTier: '10-18',
      notes: 'Strong at code + math',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    {
      model: 'gemma4:e4b',
      label: 'Gemma 4 E4B',
      company: 'Google',
      sizeGB: 3.0,
      minTier: '6-10',
      notes: '128K context · vision · edge-optimised',
    },
    {
      model: 'codellama:13b',
      label: 'Code Llama 13B',
      company: 'Meta',
      sizeGB: 7.4,
      minTier: '6-10',
      notes: "Meta's dedicated coding model",
    },

    // ── 3–6GB tier ────────────────────────────────────────────────────────────
    {
      model: 'gemma4:e2b',
      label: 'Gemma 4 E2B',
      company: 'Google',
      sizeGB: 1.5,
      minTier: '3-6',
      notes: '128K context · vision · ultra-compact',
    },
    {
      model: 'phi4-mini',
      label: 'Phi 4 Mini 3.8B',
      company: 'Microsoft',
      sizeGB: 2.5,
      minTier: '3-6',
      notes: 'Solid code for its size',
    },
    {
      model: 'llama3.2:3b',
      label: 'Llama 3.2 3B',
      company: 'Meta',
      sizeGB: 2.0,
      minTier: '3-6',
      notes: '128K context',
    },
  ],

  image: [
    // ── 18GB+ tier ────────────────────────────────────────────────────────────
    {
      model: 'FLUX.1-dev-fp8',
      label: 'FLUX.1 Dev FP8',
      company: 'BFL',
      sizeGB: 17.0,
      minTier: '18+',
      notes: 'Highest quality · slower · guidance-distilled',
    },
    {
      model: 'FLUX.1-schnell-fp8',
      label: 'FLUX.1 Schnell FP8',
      company: 'BFL',
      sizeGB: 9.0,
      minTier: '18+',
      notes: 'Fast · slightly lower quality than Dev',
    },

    // ── 10–18GB tier ──────────────────────────────────────────────────────────
    {
      model: 'FLUX.2-klein-9b-fp8',
      label: 'FLUX.2 Klein 9B FP8',
      company: 'BFL',
      sizeGB: 9.0,
      minTier: '10-18',
      notes: 'Recommended · efficient transformer architecture',
      gated: true,
    },
    {
      model: 'SDXL-lightning',
      label: 'SDXL Lightning',
      company: 'Stability AI',
      sizeGB: 6.5,
      minTier: '10-18',
      notes: 'Faster · lower VRAM · 1024×1024',
    },

    // ── 6–10GB tier ───────────────────────────────────────────────────────────
    {
      model: 'FLUX.2-klein-4b-fp8',
      label: 'FLUX.2 Klein 4B FP8',
      company: 'BFL',
      sizeGB: 4.0,
      minTier: '6-10',
      notes: 'Recommended · compact · efficient',
    },
    {
      model: 'SDXL-4bit',
      label: 'SDXL 4-bit',
      company: 'Stability AI',
      sizeGB: 3.5,
      minTier: '6-10',
      notes: 'Quantised · lower VRAM · 1024×1024',
    },
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
 * lower-tier variants, so the user gets real choice across model families.
 *
 * The recommended model for the given tier is excluded — it is the default and
 * will be shown separately in the UI. Voice capability has no alternatives.
 *
 * @param {string} vramTier - '18+' | '10-18' | '6-10' | '3-6' | '<3'
 * @param {string} capability - 'chat' | 'coding' | 'image' | 'voice'
 * @returns {Array<{model: string, label: string, company: string, sizeGB: number, tier: string, notes?: string}>}
 */
function getAlternatives(vramTier, capability) {
  if (capability === 'voice') return [];

  const userTierIndex = TIER_ORDER.indexOf(vramTier);
  if (userTierIndex === -1) return [];

  const catalog = ALTERNATIVES_CATALOG[capability] ?? [];
  if (!catalog.length) return [];

  const ownTierRec = (RECOMMENDATIONS[vramTier] || {})[capability];
  const recommendedModel = ownTierRec ? ownTierRec.model : null;

  return catalog.filter((entry) => {
    const entryTierIndex = TIER_ORDER.indexOf(entry.minTier);
    if (entryTierIndex === -1) return false;
    if (entryTierIndex < userTierIndex) return false;
    if (entry.model === recommendedModel) return false;
    return true;
  }).map((entry) => ({
    model:   entry.model,
    label:   entry.label,
    company: entry.company || 'Other',
    sizeGB:  entry.sizeGB,
    tier:    entry.minTier,
    ...(entry.notes ? { notes: entry.notes } : {}),
  }));
}

module.exports = { recommend, getAlternatives, RECOMMENDATIONS, TIER_ORDER, ALTERNATIVES_CATALOG };
