/**
 * @file comfyui.js
 * @description Manages the ComfyUI process and wraps its image generation API.
 * ComfyUI runs natively on Windows at http://localhost:8188. The Noxio UI never
 * exposes ComfyUI's node graph — all generation is driven by pre-built workflow
 * JSON templates that map to Noxio's style/quality presets.
 *
 * Supported models (per VRAM tier):
 *   18GB+     → FLUX.1-dev-fp8
 *   10–18GB   → FLUX.2-klein-9b-fp8
 *   6–10GB    → FLUX.2-klein-4b-fp8
 *   3–6GB     → SDXL 4-bit
 *
 * Generation flow:
 *   1. POST /prompt with workflow JSON → { prompt_id }
 *   2. Poll GET /history/{prompt_id} until status.completed = true
 *   3. GET /view?filename=...&subfolder=...&type=output → image bytes
 *   4. Return base64 data URL to caller
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const logger = require('../utils/logger');
const processManager = require('../infrastructure/process-manager');

const COMFYUI_BASE_URL = 'http://127.0.0.1:8188';

/** Maps model IDs (as stored in settings.models.image) to ComfyUI checkpoint filenames.
 *  For FLUX.2 Klein models, this is the diffusion model filename (loaded via UNETLoader,
 *  not CheckpointLoaderSimple) — the VAE and text encoder filenames are fixed constants below.
 */
const MODEL_FILENAMES = {
  'FLUX.1-dev-fp8':        'flux1-dev-fp8.safetensors',
  'FLUX.1-schnell-fp8':    'flux1-schnell-fp8.safetensors',
  'FLUX.2-klein-9b-fp8':   'flux-2-klein-9b-fp8.safetensors',
  'FLUX.2-klein-4b-fp8':   'flux-2-klein-4b-fp8.safetensors',
  'SDXL-lightning':        'sdxl-lightning-4step.safetensors',
  'SDXL-4bit':             'sdxl-4bit.safetensors',
};

// FLUX.2 Klein uses a split-model architecture: separate diffusion model, VAE, and text encoder.
// The VAE is shared but the text encoder differs — 9B needs Qwen3-8B (12288-dim output),
// 4B needs Qwen3-4B (7680-dim). Using the wrong encoder causes a matrix shape crash.
const KLEIN_VAE_FILE = 'flux2-vae.safetensors';
const KLEIN_TEXT_ENCODER_FILES = {
  'FLUX.2-klein-4b-fp8': 'qwen_3_4b_fp4_flux2.safetensors',
  'FLUX.2-klein-9b-fp8': 'qwen_3_8b_fp8mixed.safetensors',
};

/** Poll interval in ms when waiting for a generation job to complete */
const POLL_INTERVAL_MS = 2000;

/** Maximum number of poll attempts before timing out (~15 minutes) */
const MAX_POLL_ATTEMPTS = 450;

// ─── Klein Pre-flight ─────────────────────────────────────────────────────────

/**
 * Ensures all FLUX.2 Klein model files are in the correct ComfyUI subfolders.
 * Migrates the diffusion model from the old checkpoints/ location if needed.
 * Throws a clear error if companion files (VAE, text encoder) are missing so the
 * user gets an actionable message rather than a cryptic ComfyUI execution error.
 *
 * @param {string} modelFilename - Diffusion model filename (e.g. 'flux-2-klein-9b-fp8.safetensors')
 * @param {string} imageModel - Model ID from settings (e.g. 'FLUX.2-klein-9b-fp8')
 * @returns {string} The text encoder filename for this variant
 */
function ensureKleinFiles(modelFilename, imageModel) {
  const modelsBase = processManager.getComfyUIModelsPath();
  if (!modelsBase) return KLEIN_TEXT_ENCODER_FILES['FLUX.2-klein-4b-fp8']; // ComfyUI not installed

  const diffusionDest = path.join(modelsBase, 'diffusion_models', modelFilename);

  if (!fs.existsSync(diffusionDest)) {
    // Try migrating from the old checkpoints/ location
    const oldPath = path.join(modelsBase, 'checkpoints', modelFilename);
    if (fs.existsSync(oldPath)) {
      logger.info(`comfyui: migrating Klein diffusion model from checkpoints/ to diffusion_models/`);
      fs.mkdirSync(path.dirname(diffusionDest), { recursive: true });
      fs.renameSync(oldPath, diffusionDest);
      logger.info(`comfyui: migration complete — ${modelFilename}`);
    }
    // If still missing after migration attempt, ComfyUI will surface a clear file-not-found error
  }

  const textEncoderFile = KLEIN_TEXT_ENCODER_FILES[imageModel] ?? KLEIN_TEXT_ENCODER_FILES['FLUX.2-klein-4b-fp8'];

  // Check companion files — these were never downloaded in older installs
  const vaePath     = path.join(modelsBase, 'vae', KLEIN_VAE_FILE);
  const clipPath    = path.join(modelsBase, 'text_encoders', textEncoderFile);
  const missingFiles = [];
  if (!fs.existsSync(vaePath))  missingFiles.push(`vae/${KLEIN_VAE_FILE}`);
  if (!fs.existsSync(clipPath)) missingFiles.push(`text_encoders/${textEncoderFile}`);

  if (missingFiles.length > 0) {
    throw new Error(
      `FLUX.2 Klein requires additional model files that aren't downloaded yet: ` +
      `${missingFiles.join(', ')}. ` +
      `Go to Settings → Models → Image Model and click "Reinstall image model" to download them.`
    );
  }

  return textEncoderFile;
}

// ─── Workflow Templates ────────────────────────────────────────────────────────

/**
 * Uploads an image buffer to ComfyUI's input folder via /upload/image.
 * @param {Buffer} imageBuffer - Raw image bytes
 * @param {string} mimeType - MIME type e.g. 'image/png'
 * @param {string} filename - Filename to use in the upload
 * @returns {Promise<string>} The filename ComfyUI assigned in its input folder
 */
function uploadImage(imageBuffer, mimeType, filename) {
  return new Promise((resolve, reject) => {
    const boundary = `----NoxioFormBoundary${Date.now()}`;
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, imageBuffer, suffix]);

    const options = {
      hostname: '127.0.0.1',
      port: 8188,
      path: '/upload/image',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          resolve(result.name);
        } catch (err) {
          reject(new Error(`ComfyUI upload parse error: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`ComfyUI /upload/image: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('ComfyUI /upload/image timed out')); });
    req.write(body);
    req.end();
  });
}

/**
 * Builds a FLUX.1-schnell img2img workflow using an already-uploaded reference image.
 * Swaps EmptyLatentImage for LoadImage → VAEEncode with denoise < 1.0.
 *
 * @param {string} prompt - Positive text prompt
 * @param {number} steps - Inference steps
 * @param {string} uploadedFilename - Filename returned by /upload/image
 * @param {number} strength - Denoise strength 0.1–1.0 (higher = more prompt, less reference)
 * @param {string} [modelFile] - ComfyUI checkpoint filename
 * @returns {Object} ComfyUI workflow object
 */
function buildImg2ImgFluxWorkflow(prompt, steps, uploadedFilename, strength, modelFile = 'flux1-schnell-fp8.safetensors') {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: modelFile } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['1', 1] } },
    '4': { class_type: 'LoadImage', inputs: { image: uploadedFilename, upload: 'image' } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['5', 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: strength,
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'noxio' } },
  };
}

/**
 * Returns a FLUX.1-schnell-fp8 workflow JSON object.
 * Used for photorealistic and artistic styles on 10–18GB VRAM tiers.
 *
 * @param {string} prompt - Positive text prompt
 * @param {number} steps - Number of inference steps
 * @param {string} [modelFile] - ComfyUI checkpoint filename
 * @returns {Object} ComfyUI workflow object
 */
function buildFluxWorkflow(prompt, steps, modelFile = 'flux1-schnell-fp8.safetensors') {
  // FLUX schnell/Klein are timestep-distilled — CFG must be 1.0.
  // Higher values break generation and crash the ComfyUI execution worker.
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: modelFile },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'noxio' },
    },
  };
}

/**
 * Returns a FLUX.2 Klein txt2img workflow using the split-model architecture.
 * Klein is NOT a combined checkpoint — it requires UNETLoader + CLIPLoader(flux2) + VAELoader.
 *
 * @param {string} prompt - Positive text prompt
 * @param {number} steps - Number of inference steps
 * @param {string} [modelFile] - Diffusion model filename (loaded by UNETLoader)
 * @param {string} [textEncoderFile] - Text encoder filename (varies by Klein variant)
 * @returns {Object} ComfyUI workflow object
 */
function buildKleinWorkflow(prompt, steps, modelFile = 'flux-2-klein-4b-fp8.safetensors', textEncoderFile = KLEIN_TEXT_ENCODER_FILES['FLUX.2-klein-4b-fp8']) {
  return {
    '1': { class_type: 'UNETLoader',       inputs: { unet_name: modelFile, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader',       inputs: { clip_name: textEncoderFile, type: 'flux2', device: 'default' } },
    '3': { class_type: 'VAELoader',        inputs: { vae_name: KLEIN_VAE_FILE } },
    '4': { class_type: 'CLIPTextEncode',   inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'CLIPTextEncode',   inputs: { text: '', clip: ['2', 0] } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model:        ['1', 0],
        positive:     ['4', 0],
        negative:     ['5', 0],
        latent_image: ['6', 0],
        seed:         Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg:          1.0,
        sampler_name: 'euler',
        scheduler:    'simple',
        denoise:      1.0,
      },
    },
    '8': { class_type: 'VAEDecode',  inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage',  inputs: { images: ['8', 0], filename_prefix: 'noxio' } },
  };
}

/**
 * Returns a FLUX.2 Klein img2img workflow using the split-model architecture.
 *
 * @param {string} prompt - Positive text prompt
 * @param {number} steps - Number of inference steps
 * @param {string} uploadedFilename - Filename returned by /upload/image
 * @param {number} strength - Denoise strength 0.1–1.0
 * @param {string} [modelFile] - Diffusion model filename
 * @param {string} [textEncoderFile] - Text encoder filename (varies by Klein variant)
 * @returns {Object} ComfyUI workflow object
 */
function buildKleinImg2ImgWorkflow(prompt, steps, uploadedFilename, strength, modelFile = 'flux-2-klein-4b-fp8.safetensors', textEncoderFile = KLEIN_TEXT_ENCODER_FILES['FLUX.2-klein-4b-fp8']) {
  return {
    '1':  { class_type: 'UNETLoader',       inputs: { unet_name: modelFile, weight_dtype: 'default' } },
    '2':  { class_type: 'CLIPLoader',       inputs: { clip_name: textEncoderFile, type: 'flux2', device: 'default' } },
    '3':  { class_type: 'VAELoader',        inputs: { vae_name: KLEIN_VAE_FILE } },
    '4':  { class_type: 'CLIPTextEncode',   inputs: { text: prompt, clip: ['2', 0] } },
    '5':  { class_type: 'CLIPTextEncode',   inputs: { text: '', clip: ['2', 0] } },
    '6':  { class_type: 'LoadImage',        inputs: { image: uploadedFilename, upload: 'image' } },
    '7':  { class_type: 'VAEEncode',        inputs: { pixels: ['6', 0], vae: ['3', 0] } },
    '8':  {
      class_type: 'KSampler',
      inputs: {
        model:        ['1', 0],
        positive:     ['4', 0],
        negative:     ['5', 0],
        latent_image: ['7', 0],
        seed:         Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg:          1.0,
        sampler_name: 'euler',
        scheduler:    'simple',
        denoise:      strength,
      },
    },
    '9':  { class_type: 'VAEDecode',  inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage',  inputs: { images: ['9', 0], filename_prefix: 'noxio' } },
  };
}

/**
 * Returns an SDXL-lightning workflow JSON object.
 * Used for abstract and anime styles on 6–10GB VRAM tiers.
 * Anime style adds an anime-style LoRA modifier to the prompt.
 *
 * @param {string} prompt - Positive text prompt
 * @param {number} steps - Number of inference steps
 * @param {boolean} anime - If true, adds anime LoRA and prompt modifier
 * @returns {Object} ComfyUI workflow object
 */
function buildSdxlWorkflow(prompt, steps, anime) {
  const positivePrompt = anime
    ? `anime style, ${prompt}, vibrant colors, detailed linework`
    : prompt;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: anime ? 'sdxl-lightning-4step.safetensors' : 'sdxl-lightning-4step.safetensors' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: positivePrompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'low quality, blurry, deformed, ugly, bad anatomy',
        clip: ['1', 1],
      },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: Math.floor(Math.random() * 2 ** 32),
        steps,
        cfg: 1.5,
        sampler_name: 'dpmpp_sde',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'noxio' },
    },
  };
}

/**
 * Selects and builds the appropriate workflow based on style and quality.
 *
 * Style → workflow mapping:
 *   photorealistic → FLUX schnell, cfg=3.5, euler sampler
 *   artistic       → FLUX schnell, cfg=7.0, dpm++ sampler (more creative)
 *   abstract       → SDXL-lightning, abstract-weighted prompt
 *   anime          → SDXL-lightning, anime LoRA
 *
 * Quality → steps mapping:
 *   draft    → 4
 *   standard → 8
 *   high     → 20
 *
 * @param {string} prompt
 * @param {'photorealistic'|'artistic'|'abstract'|'anime'} style
 * @param {'draft'|'standard'|'high'} quality
 * @param {string|null} referenceImageFilename - Filename from /upload/image, or null for txt2img
 * @param {number} strength - Denoise strength for img2img (ignored when no reference)
 * @param {string|null} [imageModel] - Model ID from settings (e.g. 'FLUX.2-klein-4b-fp8')
 * @returns {Object} ComfyUI workflow JSON object
 */
function buildWorkflow(prompt, style, quality, referenceImageFilename = null, strength = 0.5, imageModel = null) {
  const modelFile = MODEL_FILENAMES[imageModel] ?? 'flux1-schnell-fp8.safetensors';
  const isKlein = imageModel?.startsWith('FLUX.2-klein');
  const isSdxl  = imageModel?.startsWith('SDXL');

  const stepsMap = { draft: 4, standard: 8, high: 20 };
  // Distilled models (FLUX schnell/Klein) need at least 20 steps for img2img to
  // preserve reference structure — ignore the quality preset in that case.
  const steps = referenceImageFilename ? 20 : (stepsMap[quality] ?? 8);

  const stylePrefix = {
    photorealistic: '',
    artistic: 'artistic interpretation, painterly, ',
    abstract: 'abstract art, surreal, geometric shapes, bold colors, ',
    anime: 'anime style, vibrant colors, detailed linework, ',
  }[style] || '';

  const styledPrompt = `${stylePrefix}${prompt}`;

  // FLUX.2 Klein uses split-model architecture (UNETLoader, not CheckpointLoaderSimple).
  // Text encoder varies by variant — pass it explicitly so the workflow uses the right file.
  if (isKlein) {
    const textEncoderFile = KLEIN_TEXT_ENCODER_FILES[imageModel] ?? KLEIN_TEXT_ENCODER_FILES['FLUX.2-klein-4b-fp8'];
    return referenceImageFilename
      ? buildKleinImg2ImgWorkflow(styledPrompt, steps, referenceImageFilename, strength, modelFile, textEncoderFile)
      : buildKleinWorkflow(styledPrompt, steps, modelFile, textEncoderFile);
  }

  if (referenceImageFilename) {
    return buildImg2ImgFluxWorkflow(styledPrompt, steps, referenceImageFilename, strength, modelFile);
  }

  if (isSdxl) {
    return buildSdxlWorkflow(styledPrompt, steps, style === 'anime');
  }

  return buildFluxWorkflow(styledPrompt, steps, modelFile);
}

// ─── HTTP Helpers ──────────────────────────────────────────────────────────────

/**
 * Makes an HTTP GET request to ComfyUI and returns the parsed JSON body.
 * @param {string} urlPath - Path relative to COMFYUI_BASE_URL (e.g. '/system_stats')
 * @returns {Promise<Object>}
 */
function comfyGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${COMFYUI_BASE_URL}${urlPath}`,
      { timeout: 10000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`ComfyUI GET ${urlPath}: JSON parse error — ${err.message}`));
          }
        });
      }
    );
    req.on('error', (err) => reject(new Error(`ComfyUI GET ${urlPath}: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ComfyUI GET ${urlPath}: request timed out`));
    });
  });
}

/**
 * Makes an HTTP POST request to ComfyUI with a JSON body.
 * @param {string} urlPath - Path relative to COMFYUI_BASE_URL
 * @param {Object} payload - JSON-serialisable request body
 * @returns {Promise<Object>} Parsed JSON response
 */
function comfyPost(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: '127.0.0.1',
      port: 8188,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (err) {
          reject(new Error(`ComfyUI POST ${urlPath}: JSON parse error — ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`ComfyUI POST ${urlPath}: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ComfyUI POST ${urlPath}: request timed out`));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Fetches raw image bytes from ComfyUI's /view endpoint.
 * @param {string} filename - Filename returned in the job history
 * @param {string} subfolder - Subfolder (usually empty string)
 * @param {string} type - Image type (usually 'output')
 * @returns {Promise<Buffer>} Raw image bytes
 */
function fetchImageBytes(filename, subfolder, type) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ filename, subfolder, type }).toString();
    const req = http.get(
      `${COMFYUI_BASE_URL}/view?${params}`,
      { timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', (err) => reject(new Error(`ComfyUI /view fetch failed: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ComfyUI /view fetch timed out'));
    });
  });
}

// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * Checks whether ComfyUI is responsive on port 8188.
 * @returns {Promise<boolean>}
 */
function checkRunning() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: 8188, path: '/system_stats', timeout: 3000 },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 300);
        res.resume();
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ─── Process Lifecycle ─────────────────────────────────────────────────────────

/**
 * Starts the ComfyUI process via process-manager.
 * Delegates all spawning, crash detection, and restart logic to process-manager.
 * @returns {Promise<void>}
 */
async function start() {
  logger.info('comfyui: starting via process-manager');
  await processManager.startService('comfyui');
}

/**
 * Stops the ComfyUI process via process-manager.
 * @returns {Promise<void>}
 */
async function stop() {
  logger.info('comfyui: stopping via process-manager');
  await processManager.stopService('comfyui');
}

// ─── Image Generation ──────────────────────────────────────────────────────────

/**
 * Generates an image using a pre-built ComfyUI workflow.
 *
 * Flow:
 *   1. Build workflow JSON from style/quality params
 *   2. POST to /prompt → receive prompt_id
 *   3. Poll /history/{prompt_id} until completed
 *   4. Fetch image bytes from /view
 *   5. Return as base64 data URL
 *
 * @param {Object} params
 * @param {string} params.prompt - Text description of the image
 * @param {'photorealistic'|'artistic'|'abstract'|'anime'} params.style - Visual style preset
 * @param {'draft'|'standard'|'high'} params.quality - Quality/steps preset
 * @param {Function} params.onProgress - Callback invoked with percent (0–100)
 * @param {string|null} [params.referenceImageData] - Base64 data URL of reference image for img2img
 * @param {number} [params.strength=0.75] - Denoise strength for img2img (0.1 subtle → 1.0 ignore reference)
 * @param {string|null} [params.imageModel] - Model ID from settings (e.g. 'FLUX.2-klein-4b-fp8')
 * @returns {Promise<string>} Base64 data URL of the generated image (e.g. 'data:image/png;base64,...')
 * @throws {Error} If ComfyUI is unreachable, the job fails, or the image cannot be fetched
 */
async function generateImage({ prompt, style, quality, onProgress, abortSignal, referenceImageData = null, strength = 0.5, imageModel = null }) {
  logger.info(`comfyui: generateImage — style=${style}, quality=${quality}, model=${imageModel ?? 'default'}, img2img=${!!referenceImageData}`);

  // Verify ComfyUI is reachable before submitting
  const running = await checkRunning();
  if (!running) {
    throw new Error('ComfyUI is not running — cannot generate image');
  }

  onProgress(5);

  // Upload reference image to ComfyUI's input folder if provided
  let referenceImageFilename = null;
  if (referenceImageData) {
    const mimeMatch = referenceImageData.match(/^data:(image\/[a-z+]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const base64Data = referenceImageData.replace(/^data:image\/[a-z+]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    logger.info(`comfyui: uploading reference image (${imageBuffer.length} bytes)`);
    referenceImageFilename = await uploadImage(imageBuffer, mimeType, `noxio-ref.${ext}`);
    logger.info(`comfyui: reference image uploaded as ${referenceImageFilename}`);
    onProgress(12);
  } else {
    onProgress(15);
  }

  // FLUX.2 Klein: verify all required files exist and migrate old checkpoint-folder installs
  if (imageModel?.startsWith('FLUX.2-klein')) {
    const modelFilename = MODEL_FILENAMES[imageModel];
    if (modelFilename) ensureKleinFiles(modelFilename, imageModel);
  }

  // Build the workflow and submit it
  const workflow = buildWorkflow(prompt, style, quality, referenceImageFilename, strength, imageModel);
  logger.info('comfyui: submitting workflow to /prompt');

  const submitResult = await comfyPost('/prompt', { prompt: workflow });
  const promptId = submitResult.prompt_id;

  if (!promptId) {
    throw new Error(`ComfyUI /prompt returned no prompt_id: ${JSON.stringify(submitResult)}`);
  }

  logger.info(`comfyui: job submitted — prompt_id=${promptId}`);
  onProgress(15);

  // Poll /history until the job completes
  let attempts = 0;
  let history = null;

  while (attempts < MAX_POLL_ATTEMPTS) {
    if (abortSignal?.cancelled) {
      throw new Error('Image generation cancelled');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    attempts += 1;

    try {
      const historyData = await comfyGet(`/history/${promptId}`);
      const jobEntry = historyData[promptId];

      if (jobEntry && jobEntry.status && jobEntry.status.completed) {
        // ComfyUI sets completed=true for both success and error.
        // Check status_str so we surface errors immediately instead of
        // falling through to "no images found in outputs".
        if (jobEntry.status.status_str === 'error') {
          const errMsg = jobEntry.status.messages
            ?.find((m) => m[0] === 'execution_error')?.[1]?.exception_message
            ?? 'unknown ComfyUI execution error';
          throw new Error(`ComfyUI job failed: ${errMsg}`);
        }
        history = jobEntry;
        break;
      }

      // Every 30 polls, check /queue — if the job isn't there or in history, it vanished
      if (attempts % 30 === 0) {
        try {
          const queueData = await comfyGet('/queue');
          const inQueue =
            queueData.queue_running?.some((item) => item[1] === promptId) ||
            queueData.queue_pending?.some((item) => item[1] === promptId);
          if (!inQueue) {
            logger.warn(`comfyui: job ${promptId} not found in queue or history after ${attempts} polls — ComfyUI may have dropped it`);
          }
        } catch (_) { /* non-fatal */ }
      }

      // Emit progress: 15% at start → 90% while polling
      const pollProgress = Math.min(15 + Math.floor((attempts / MAX_POLL_ATTEMPTS) * 75), 90);
      onProgress(pollProgress);
    } catch (pollErr) {
      if (pollErr.message.startsWith('ComfyUI job failed')) throw pollErr;
      logger.warn(`comfyui: poll attempt ${attempts} failed — ${pollErr.message}`);
    }
  }

  if (!history) {
    throw new Error(`ComfyUI job ${promptId} did not complete within timeout`);
  }

  onProgress(92);

  // Extract the output image reference from history
  const outputs = history.outputs;
  const nodeOutputs = Object.values(outputs);
  let imageRef = null;

  for (const nodeOutput of nodeOutputs) {
    if (nodeOutput.images && nodeOutput.images.length > 0) {
      imageRef = nodeOutput.images[0];
      break;
    }
  }

  if (!imageRef) {
    throw new Error(`ComfyUI job ${promptId} completed but no images found in outputs`);
  }

  logger.info(`comfyui: fetching image — filename=${imageRef.filename}, type=${imageRef.type}`);

  // Fetch image bytes and convert to base64 data URL
  const imageBytes = await fetchImageBytes(
    imageRef.filename,
    imageRef.subfolder || '',
    imageRef.type || 'output'
  );

  const base64 = imageBytes.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  onProgress(100);
  logger.info(`comfyui: generation complete — ${imageBytes.length} bytes`);

  return dataUrl;
}

module.exports = { start, stop, generateImage, checkRunning, COMFYUI_BASE_URL };
