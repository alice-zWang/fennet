// AI features. Two providers, chosen in Settings:
//   claude  – Claude API with the user's own API key, called straight from the browser
//             (official @anthropic-ai/sdk, loaded on demand). Supports images, so it can read handwriting.
//   device  – the browser's built-in on-device model (Chrome's Prompt API), when available. Text only, free, private.
import { prefs } from './util.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
export const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (best quality)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (balanced)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest, cheapest)'],
];
// Opus/Sonnet can route a declined request to a fallback model server-side.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export class AIError extends Error {}

let sdkP;
function sdk() {
  if (!sdkP) {
    sdkP = import(SDK_URL).then((m) => m.default || m.Anthropic);
    sdkP.catch(() => { sdkP = null; });
  }
  return sdkP;
}

export function aiConfig() {
  return {
    provider: prefs.get('ai.provider', 'claude'),
    key: prefs.get('ai.key', ''),
    model: prefs.get('ai.model', 'claude-opus-5-5'),
  };
}

export function deviceModelAPI() {
  return typeof window.LanguageModel !== 'undefined' ? window.LanguageModel : null;
}

// Returns null when ready, otherwise a human-readable reason.
export function aiUnavailableReason() {
  const c = aiConfig();
  if (c.provider === 'off') return 'AI features are turned off in Settings.';
  if (c.provider === 'device') return deviceModelAPI() ? null : 'This browser has no built-in AI model. Use Chrome 138+ on a desktop, or switch to Claude in Settings.';
  if (!c.key) return 'Add your Claude API key in Settings → AI to use this.';
  return null;
}
export const aiReady = () => !aiUnavailableReason();
export const aiSupportsImages = () => aiConfig().provider === 'claude';

async function claudeClient() {
  const Anthropic = await sdk();
  return { Anthropic, client: new Anthropic({ apiKey: aiConfig().key, dangerouslyAllowBrowser: true }) };
}

function friendly(e, Anthropic) {
  if (e instanceof AIError) return e;
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return new AIError('Your Claude API key was rejected. Check it in Settings → AI.');
    if (e instanceof Anthropic.PermissionDeniedError) return new AIError('This API key is not allowed to use that model.');
    if (e instanceof Anthropic.RateLimitError) return new AIError('Claude is rate-limiting this key. Wait a minute and try again.');
    if (e instanceof Anthropic.BadRequestError) return new AIError('Claude could not process this request: ' + e.message);
    if (e instanceof Anthropic.APIConnectionError) return new AIError('Could not reach Claude. Are you online?');
    if (e instanceof Anthropic.APIError) return new AIError(`Claude error ${e.status || ''}: ${e.message}`);
  }
  return new AIError(e && e.message ? e.message : String(e));
}

/**
 * Ask the model.
 * content: array of blocks: {type:'text', text} | {type:'image', data(base64), mediaType}
 * history: earlier turns [{role, content}] for chat
 * schema: JSON schema → returns parsed object
 * onText: streaming callback (text delta)
 */
export async function ask({ system, content, history = [], schema, onText, effort = 'low', maxTokens = 16000, signal }) {
  const why = aiUnavailableReason();
  if (why) throw new AIError(why);
  const cfg = aiConfig();
  if (cfg.provider === 'device') return askDevice({ system, content, history, schema, onText });

  let Anthropic;
  try {
    const c = await claudeClient();
    Anthropic = c.Anthropic;
    const userContent = content.map((b) => (b.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: b.mediaType || 'image/jpeg', data: b.data } }
      : { type: 'text', text: b.text }));
    const params = {
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [...history, { role: 'user', content: userContent }],
      output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    };
    let stream;
    if (FALLBACK_MODELS.has(cfg.model)) {
      stream = c.client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal });
    } else {
      stream = c.client.messages.stream(params, { signal });
    }
    if (onText && !schema) stream.on('text', onText);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AIError('Claude declined this request.');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (msg.stop_reason === 'max_tokens' && schema) throw new AIError('The answer was too long. Try a shorter note or fewer items.');
    return schema ? JSON.parse(text) : text;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw friendly(e, Anthropic);
  }
}

async function askDevice({ system, content, history, schema, onText }) {
  const LM = deviceModelAPI();
  try {
    const avail = LM.availability ? await LM.availability() : 'available';
    if (avail === 'unavailable') throw new AIError('The built-in AI model is not available on this device.');
    const session = await LM.create({
      initialPrompts: [
        { role: 'system', content: system || 'You are a helpful study assistant.' },
        ...history.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map((b) => b.text || '').join('\n') })),
      ],
    });
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
    if (schema) {
      const out = await session.prompt(text, { responseConstraint: schema });
      session.destroy && session.destroy();
      return JSON.parse(out);
    }
    if (onText && session.promptStreaming) {
      let full = '';
      for await (const chunk of session.promptStreaming(text)) {
        // Older builds stream the full text so far; newer ones stream deltas.
        const delta = chunk.startsWith(full) ? chunk.slice(full.length) : chunk;
        full += delta;
        onText(delta);
      }
      session.destroy && session.destroy();
      return full;
    }
    const out = await session.prompt(text);
    session.destroy && session.destroy();
    return out;
  } catch (e) {
    throw e instanceof AIError ? e : new AIError('On-device AI failed: ' + (e.message || e));
  }
}
