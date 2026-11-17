/* ---------------------------------------------------------------------------
   One way to talk to a model.

   The console can run on a free, keyless model out of the box, and an admin can
   point it at their own provider later without touching code. Everything that
   wants a model (course drafts, topic outlines) calls aiChat and gets either
   text or a plain reason, never an exception.
   --------------------------------------------------------------------------- */

import { db } from './db.js';

export type AiProviderKey =
  | 'FREE'
  | 'POLLINATIONS'
  | 'OPENAI'
  | 'OPENAI_COMPATIBLE'
  | 'GEMINI'
  | 'ANTHROPIC'
  | 'NONE';

export interface AiProviderMeta {
  label: string;
  hint: string;
  model: string;
  baseUrl: string;
  /** True when the provider needs no API key. */
  keyless: boolean;
}

export const AI_PROVIDERS: Record<string, AiProviderMeta> = {
  FREE: {
    label: 'Free model (built in)',
    hint: 'Runs on a public free model. No key, no sign up. Good for drafts.',
    model: 'openai-fast',
    baseUrl: 'https://text.pollinations.ai/openai',
    keyless: true
  },
  POLLINATIONS: {
    label: 'Pollinations (free, no key)',
    hint: 'The same free model, chosen on purpose.',
    model: 'openai-fast',
    baseUrl: 'https://text.pollinations.ai/openai',
    keyless: true
  },
  OPENAI: {
    label: 'OpenAI',
    hint: 'A paid key. The strongest writing of the list.',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    keyless: false
  },
  OPENAI_COMPATIBLE: {
    label: 'Any OpenAI-compatible API',
    hint: 'Groq, Together, LM Studio, a hosted proxy. Paste the base URL.',
    model: '',
    baseUrl: '',
    keyless: false
  },
  GEMINI: {
    label: 'Google Gemini',
    hint: 'Free tier available from Google AI Studio.',
    model: 'gemini-1.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyless: false
  },
  ANTHROPIC: {
    label: 'Anthropic',
    hint: 'Claude, with a paid key.',
    model: 'claude-3-5-sonnet-latest',
    baseUrl: 'https://api.anthropic.com/v1',
    keyless: false
  },
  NONE: {
    label: 'Not connected',
    hint: 'No model. Drafts fall back to the built-in rule based writer.',
    model: '',
    baseUrl: '',
    keyless: false
  }
};

export interface AiRuntime {
  provider: AiProviderKey;
  model: string;
  key: string;
  baseUrl: string;
  keyless: boolean;
  label: string;
  /** True when a request can actually be made. */
  available: boolean;
  /** True when no admin key is involved. */
  free: boolean;
}

const readSavedSettings = () => {
  try {
    return (db.prepare("SELECT * FROM ai_settings WHERE id = 'default'").get() as any) || null;
  } catch {
    return null;
  }
};

const providerMeta = (provider: string): AiProviderMeta =>
  AI_PROVIDERS[provider as AiProviderKey] || AI_PROVIDERS.NONE;

/**
 * Which model a request would use, in order of preference: what the admin
 * saved, then the environment, then the free model. A provider that needs a key
 * and has none is skipped rather than attempted and failed.
 */
export function resolveAiRuntime(): AiRuntime {
  const saved = readSavedSettings();
  const savedProvider = String(saved?.provider || 'NONE').toUpperCase() as AiProviderKey;
  const savedKey = String(saved?.api_key || '').trim();
  const envKey = String(process.env.AI_API_KEY || '').trim();
  const envProvider = String(process.env.AI_PROVIDER || '').toLowerCase();

  const build = (provider: AiProviderKey, key: string, model?: string, baseUrl?: string): AiRuntime => {
    const meta = providerMeta(provider);
    const resolvedModel = String(model || meta.model || '').trim();
    const resolvedBase = String(baseUrl || meta.baseUrl || '').trim().replace(/\/$/, '');
    const keyless = meta.keyless;
    return {
      provider,
      model: resolvedModel,
      key,
      baseUrl: resolvedBase,
      keyless,
      label: provider === 'FREE' || provider === 'POLLINATIONS' ? 'Free model' : meta.label,
      available: provider !== 'NONE' && Boolean(resolvedBase) && (keyless || Boolean(key)),
      free: keyless
    };
  };

  if (savedProvider !== 'NONE' && AI_PROVIDERS[savedProvider]) {
    const runtime = build(
      savedProvider,
      savedKey,
      saved?.model || '',
      saved?.base_url || ''
    );
    if (runtime.available) return runtime;
    // A provider was picked but its key is missing. Say so rather than quietly
    // sending the text somewhere else.
    return { ...runtime, available: false };
  }

  if (savedProvider === 'NONE') {
    // Somebody chose "Not connected". The older env switch still gets a chance,
    // because deployments set it before this page existed.
    if ((envProvider === 'real' || envProvider === 'external') && envKey) {
      return build(
        'OPENAI_COMPATIBLE',
        envKey,
        process.env.AI_MODEL || 'gpt-4o-mini',
        process.env.AI_API_BASE_URL || 'https://api.openai.com/v1'
      );
    }
    return build('NONE', '', '', '');
  }

  // No row has been saved yet: the free model, so a fresh install just works.
  if ((envProvider === 'real' || envProvider === 'external') && envKey) {
    return build(
      'OPENAI_COMPATIBLE',
      envKey,
      process.env.AI_MODEL || 'gpt-4o-mini',
      process.env.AI_API_BASE_URL || 'https://api.openai.com/v1'
    );
  }

  return build('FREE', '', AI_PROVIDERS.FREE.model, AI_PROVIDERS.FREE.baseUrl);
}

/** A short line the console can show without exposing a key. */
export function aiSummary() {
  const runtime = resolveAiRuntime();
  return {
    provider: runtime.provider,
    label: runtime.label,
    model: runtime.model,
    free: runtime.free,
    available: runtime.available
  };
}

export interface AiChatInput {
  system: string;
  user: string;
  /** Ask for JSON. Providers that support a JSON mode get it switched on. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export type AiChatResult =
  | { ok: true; text: string; model: string; provider: AiProviderKey; free: boolean }
  | { ok: false; error: string; provider: AiProviderKey; retryAfterSeconds?: number };

/** Pull the wait out of a rate limit answer, when the provider gives one. */
const retryAfterFrom = (body: string): number | undefined => {
  const match = body.match(/retry after (\d+)\s*s/i) || body.match(/"retry_after"\s*:\s*(\d+)/i);
  if (match) return Math.min(120, Math.max(1, Number(match[1])));
  return undefined;
};

const cleanError = (status: number, body: string) => {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (status === 401 || status === 403) return 'The model provider refused the key.';
  if (status === 402) {
    const wait = retryAfterFrom(body);
    return wait
      ? `The free model allows one request at a time. It will be free again in ${wait} seconds.`
      : 'The free model is at its limit right now. Try again in a minute, or add your own key in Settings.';
  }
  if (status === 429) {
    const wait = retryAfterFrom(body);
    return wait
      ? `The model is rate limited. Try again in ${wait} seconds.`
      : 'The model is busy right now. Try again in a minute.';
  }
  if (status >= 500) return 'The model provider had a bad moment. Try again shortly.';
  return `The model provider answered ${status}. ${snippet}`;
};

/* The free model allows one request at a time per address, so calls queue here
   instead of colliding with each other. */
let aiQueue: Promise<unknown> = Promise.resolve();
const throughQueue = <T>(job: () => Promise<T>): Promise<T> => {
  const next = aiQueue.then(job, job);
  aiQueue = next.catch(() => undefined);
  return next;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request, to whichever provider is configured. */
async function callOnce(runtime: AiRuntime, input: AiChatInput): Promise<AiChatResult> {
  if (!runtime.available) {
    return { ok: false, error: 'No model is connected and the free model is off.', provider: runtime.provider };
  }

  const timeout = input.timeoutMs || Number(process.env.AI_TIMEOUT_MS || 60000);
  const temperature = input.temperature ?? 0.4;

  try {
    if (runtime.provider === 'GEMINI') {
      const url = `${runtime.baseUrl}/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.key)}`;
      const body: any = {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: input.maxTokens || 4096,
          ...(input.json ? { responseMimeType: 'application/json' } : {})
        }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
      const raw = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          error: cleanError(res.status, raw),
          provider: runtime.provider,
          retryAfterSeconds: retryAfterFrom(raw)
        };
      }
      const json = JSON.parse(raw);
      const text = (json?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => String(p?.text || ''))
        .join('')
        .trim();
      if (!text) return { ok: false, error: 'The model returned nothing.', provider: runtime.provider };
      return { ok: true, text, model: runtime.model, provider: runtime.provider, free: runtime.free };
    }

    if (runtime.provider === 'ANTHROPIC') {
      const res = await fetch(`${runtime.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': runtime.key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: runtime.model,
          max_tokens: input.maxTokens || 4096,
          temperature,
          system: input.system,
          messages: [{ role: 'user', content: input.user }]
        }),
        signal: AbortSignal.timeout(timeout)
      });
      const raw = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          error: cleanError(res.status, raw),
          provider: runtime.provider,
          retryAfterSeconds: retryAfterFrom(raw)
        };
      }
      const json = JSON.parse(raw);
      const text = (json?.content || []).map((part: any) => String(part?.text || '')).join('').trim();
      if (!text) return { ok: false, error: 'The model returned nothing.', provider: runtime.provider };
      return { ok: true, text, model: runtime.model, provider: runtime.provider, free: runtime.free };
    }

    // OpenAI, any OpenAI-compatible endpoint, and the free model all share a body.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!runtime.keyless && runtime.key) headers.Authorization = `Bearer ${runtime.key}`;

    const res = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: runtime.model,
        temperature,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ],
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        ...(runtime.keyless ? { referrer: 'frins.in' } : {})
      }),
      signal: AbortSignal.timeout(timeout)
    });

    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: cleanError(res.status, raw),
        provider: runtime.provider,
        retryAfterSeconds: retryAfterFrom(raw)
      };
    }

    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // Some free endpoints answer with plain text instead of a chat object.
      const text = raw.trim();
      if (text && !text.startsWith('<')) {
        return { ok: true, text, model: runtime.model, provider: runtime.provider, free: runtime.free };
      }
      return { ok: false, error: 'The model returned something unreadable.', provider: runtime.provider };
    }

    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, error: 'The model returned nothing.', provider: runtime.provider };
    return { ok: true, text, model: runtime.model, provider: runtime.provider, free: runtime.free };
  } catch (err: any) {
    const reason =
      err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'The model did not answer in time.'
        : 'The server could not reach the model.';
    return { ok: false, error: reason, provider: runtime.provider };
  }
}

/**
 * Chat with the configured model, one call at a time. When the free tier says
 * how long to wait and the wait is short, it waits and tries once more, because
 * a course draft is worth ninety seconds to an admin.
 */
export async function aiChat(input: AiChatInput & { waitForRetry?: boolean }): Promise<AiChatResult> {
  const runtime = resolveAiRuntime();
  const first = await throughQueue(() => callOnce(runtime, input));

  if (first.ok) return first;

  const wait = first.retryAfterSeconds;
  const allowed = input.waitForRetry !== false;
  if (!allowed || !wait || wait > 50) return first;

  await sleep((wait + 1) * 1000);
  return throughQueue(() => callOnce(runtime, input));
}

/**
 * Models wrap JSON in fences, or add a sentence before it. This digs the object
 * out and gives up quietly if there is not one.
 */
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/```json/gi, '```')
    .trim();

  const withoutFences = cleaned.includes('```')
    ? cleaned
        .split('```')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.startsWith('{') || chunk.startsWith('['))
        .join('\n')
    : cleaned;

  const candidate = withoutFences.trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* look for the outermost object below */
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
