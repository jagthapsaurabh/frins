/* ---------------------------------------------------------------------------
   A model that can watch the video itself.

   YouTube keeps caption text away from servers, and a video with no chapters and
   a thin description has nothing else to read. Some models take a YouTube link
   and watch it, which is the only way left to summarise a video whose words stay
   locked. Gemini does this, so when the summary job is pointed at a Gemini
   connection, the link goes straight to it.

   Every time it hands back is checked against the video's real length before it
   is shown: a model can be sure of a chapter and wrong about a second, and a
   wrong second becomes a jump point that lands nowhere.
   --------------------------------------------------------------------------- */

import { resolveAiRuntimeFor, type AiRuntime } from './aiClient.js';
import { formatTimestamp } from './videoSummary.js';

export interface WaitedSection {
  startSeconds: number;
  title: string;
  points: string[];
}

export interface WaitedSummary {
  overview: string;
  sections: WaitedSection[];
  takeaways: string[];
  modelName: string;
  connectionLabel: string;
}

const SYSTEM_PROMPT = `You summarise trading education videos for FRINS, an Indian trading learning platform.
Watch the video and answer with JSON only, in this shape:
{
  "overview": "three sentences on what the video teaches",
  "sections": [{ "startSeconds": 0, "title": "short title", "points": ["what happens here", "the rule it gives"] }],
  "takeaways": ["one line a learner can use"]
}
Rules:
- Between 4 and 12 sections, in the order they happen.
- startSeconds is an integer, the second the section STARTS in the video. Only give a time you are confident about.
- Points stay close to the speaker's own words. Do not invent rules, numbers or indicators that are not in the video.
- Short sentences. No em dashes or en dashes. Plain words a learner reads once and follows.
- If the video is mostly promotion or has almost no teaching, say that in the overview and return fewer sections.`;

const clean = (value: unknown, limit = 220) =>
  String(value ?? '')
    .replace(/[\u2010-\u2015]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const parseJsonLoose = (text: string): any | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

/** Gemini, with the watch URL as the video input. */
export async function summariseVideoWithModel(
  runtime: AiRuntime,
  watchUrl: string,
  durationSeconds: number | null
): Promise<{ ok: true; summary: WaitedSummary } | { ok: false; reason: string }> {
  if (!runtime.available) {
    return { ok: false, reason: `${runtime.label} has no key yet.` };
  }
  if (runtime.provider !== 'GEMINI') {
    return { ok: false, reason: `${runtime.label} cannot watch a video link.` };
  }

  const url = `${runtime.baseUrl}/models/${encodeURIComponent(runtime.model)}:generateContent?key=${encodeURIComponent(runtime.key)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { fileData: { mimeType: 'video/*', fileUri: watchUrl } },
          {
            text: `Summarise this video${
              durationSeconds ? `, which is ${formatTimestamp(durationSeconds)} long` : ''
            }. Return the JSON only.`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  };

  let raw = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    raw = await res.text();
    if (!res.ok) {
      /* Gemini says plainly when a link is private, too long or not available
         in the region. Pass its reason on, shortened, rather than a guess. */
      const detail = (() => {
        try {
          return String(JSON.parse(raw)?.error?.message || '').slice(0, 200);
        } catch {
          return raw.replace(/\s+/g, ' ').slice(0, 160);
        }
      })();
      return {
        ok: false,
        reason:
          res.status === 400 || res.status === 404
            ? `Gemini could not open this video. ${detail}`
            : `Gemini answered ${res.status}. ${detail}`
      };
    }
  } catch (err: any) {
    const reason =
      err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'Gemini took longer than two minutes on this video.'
        : 'The server could not reach Gemini.';
    return { ok: false, reason };
  }

  const json = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  const text = (json?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => String(part?.text || ''))
    .join('\n')
    .trim();
  const parsed = text ? parseJsonLoose(text) : null;
  if (!parsed) {
    const blocked = String(json?.promptFeedback?.blockReason || '');
    return {
      ok: false,
      reason: blocked
        ? `Gemini refused this video (${blocked.toLowerCase()}).`
        : 'Gemini watched the video but sent nothing readable back.'
    };
  }

  const limit = durationSeconds && durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
  const seen = new Set<number>();
  const sections: WaitedSection[] = [];
  for (const entry of Array.isArray(parsed.sections) ? parsed.sections : []) {
    const start = Math.round(Number(entry?.startSeconds));
    if (!Number.isFinite(start) || start < 0 || start > limit) continue;
    if (seen.has(start)) continue;
    const title = clean(entry?.title, 90);
    if (!title) continue;
    seen.add(start);
    sections.push({
      startSeconds: start,
      title,
      points: (Array.isArray(entry?.points) ? entry.points : []).map((p: unknown) => clean(p)).filter(Boolean).slice(0, 4)
    });
    if (sections.length >= 24) break;
  }
  sections.sort((a, b) => a.startSeconds - b.startSeconds);

  const overview = clean(parsed.overview, 600);
  if (!overview && !sections.length) {
    return { ok: false, reason: 'Gemini watched the video but had nothing to say about it.' };
  }

  return {
    ok: true,
    summary: {
      overview: overview || 'A short video with the parts below.',
      sections,
      takeaways: (Array.isArray(parsed.takeaways) ? parsed.takeaways : [])
        .map((item: unknown) => clean(item))
        .filter(Boolean)
        .slice(0, 6),
      modelName: runtime.model,
      connectionLabel: runtime.label
    }
  };
}

/** The connection the summary job is pointed at, or null when it cannot watch. */
export function videoWatcherForSummaries(): AiRuntime | null {
  const runtime = resolveAiRuntimeFor('summary');
  return runtime.available && runtime.provider === 'GEMINI' ? runtime : null;
}
