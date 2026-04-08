/**
 * @file model-registry.js
 * @description Central capability registry for known Ollama model families.
 * Maps model name patterns to metadata: family, company, thinking support, vision support.
 *
 * supportsThinking values:
 *   'always' — model always thinks (Gemma 4, DeepSeek R1, GPT-OSS) — Think button hidden
 *   'toggle' — hybrid thinking (Qwen 3/3.5) — Think button shown
 *   false    — no thinking capability (Llama 4, Phi-4) — Think button hidden
 */

const MODEL_REGISTRY = [
  // ── Google ────────────────────────────────────────────────────────────────
  { pattern: /gemma4/,       family: 'gemma',    company: 'Google',    supportsThinking: 'always', supportsVision: true  },

  // ── Alibaba — qwen3-vl must be checked before qwen3 ──────────────────────
  { pattern: /qwen3-vl/,     family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle', supportsVision: true  },
  { pattern: /qwen3/,        family: 'qwen',     company: 'Alibaba',   supportsThinking: 'toggle', supportsVision: false },

  // ── DeepSeek — r1 must be checked before generic deepseek ─────────────────
  { pattern: /deepseek-r1/,  family: 'deepseek', company: 'DeepSeek',  supportsThinking: 'always', supportsVision: false },
  { pattern: /deepseek/,     family: 'deepseek', company: 'DeepSeek',  supportsThinking: false,    supportsVision: false },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  { pattern: /gpt-oss/,      family: 'gpt-oss',  company: 'OpenAI',    supportsThinking: 'always', supportsVision: false },

  // ── Meta ──────────────────────────────────────────────────────────────────
  { pattern: /llama4/,       family: 'llama',    company: 'Meta',      supportsThinking: false,    supportsVision: true  },

  // ── Microsoft ─────────────────────────────────────────────────────────────
  { pattern: /phi4/,         family: 'phi',      company: 'Microsoft', supportsThinking: false,    supportsVision: false },
];

/**
 * Returns the first registry entry whose pattern matches the model name, or null.
 * @param {string} modelName
 * @returns {{ pattern: RegExp, family: string, company: string, supportsThinking: 'always'|'toggle'|false, supportsVision: boolean }|null}
 */
export function getModelMeta(modelName) {
  if (!modelName) return null;
  return MODEL_REGISTRY.find((entry) => entry.pattern.test(modelName)) ?? null;
}

/**
 * @param {string} modelName
 * @returns {string} family name, or 'other' if unknown
 */
export function getModelFamily(modelName) {
  return getModelMeta(modelName)?.family ?? 'other';
}

/**
 * @param {string} modelName
 * @returns {string} company name, or 'Other' if unknown
 */
export function getModelCompany(modelName) {
  return getModelMeta(modelName)?.company ?? 'Other';
}

/**
 * Returns true only for models with toggleable thinking (Qwen 3/3.5).
 * This is the guard for showing the Think button.
 * @param {string} modelName
 * @returns {boolean}
 */
export function supportsThinkingToggle(modelName) {
  return getModelMeta(modelName)?.supportsThinking === 'toggle';
}

/**
 * Returns true for models with vision/multimodal capability.
 * @param {string} modelName
 * @returns {boolean}
 */
export function supportsVision(modelName) {
  return getModelMeta(modelName)?.supportsVision === true;
}

/**
 * Groups an array of model objects by company.
 * Unknown models go into 'Other'.
 * @param {Array<{ name: string }>} models
 * @returns {Record<string, Array<{ name: string }>>}
 */
export function groupModelsByCompany(models) {
  const groups = {};
  for (const model of models) {
    const company = getModelCompany(model.name);
    if (!groups[company]) groups[company] = [];
    groups[company].push(model);
  }
  return groups;
}
