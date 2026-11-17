import { aiChat, parseJsonLoose } from './aiClient.js';

/* ---------------------------------------------------------------------------
   Video studio.

   An admin pastes a YouTube link. We pull the title and, when YouTube serves
   them, the captions. If the captions are withheld we say so plainly and take
   a pasted transcript instead, which we clean up.

   From that transcript we build a course draft: modules, a lesson for each,
   and a task for each. With a live model configured in AI_PROVIDER the draft
   comes from the model. Without one, it comes from the transcript itself, and
   the draft says which of the two it is.
   --------------------------------------------------------------------------- */

export interface VideoMeta {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
}

export type TranscriptSource = 'YOUTUBE' | 'PASTED';

export interface TranscriptResult {
  ok: boolean;
  transcript: string;
  language: string;
  source: TranscriptSource;
  /** Why the automatic fetch failed, in words an admin can act on. */
  reason?: string;
}

/** One spoken stretch of a video, with where it starts. */
export interface TimedSegment {
  startSeconds: number;
  text: string;
}

export interface VideoExtras {
  description: string;
  durationSeconds: number | null;
  /** The creator's own chapter list, when the video has one. */
  chapters: Array<{ startSeconds: number; title: string }>;
}

export interface CourseDraftModule {
  position: number;
  title: string;
  focus: string;
  lesson: string;
  task: {
    title: string;
    instructions: string;
    expectedCriteria: string;
    estimatedMinutes: number;
    dueDays: number;
  };
}

export type DraftBasis = 'TRANSCRIPT' | 'DESCRIPTION' | 'TOPIC';

export interface CourseDraft {
  title: string;
  summary: string;
  description: string;
  track: string;
  level: string;
  generatedBy: 'LIVE_LLM' | 'DETERMINISTIC';
  modelName: string;
  /** What the draft was written from, so the console can say so. */
  basis: DraftBasis;
  /** Set when a model was tried and could not be reached. */
  fallbackReason?: string;
  modules: CourseDraftModule[];
  tasks: number;
}

/* ------------------------------------------------------------------ links */

/**
 * Pulls the id out of every YouTube link shape an admin is likely to paste:
 * watch, youtu.be, shorts, embed, live, with or without a timestamp.
 */
export function extractYouTubeId(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const allowed = ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'];
  if (!allowed.includes(host)) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  const markerIndex = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
  if (markerIndex >= 0 && parts[markerIndex + 1]) {
    const id = parts[markerIndex + 1];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  return null;
}

export function canonicalWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/* ------------------------------------------------------------- cleaning */

const TIMING_LINE = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->/;
const VTT_TAGS = /<[^>]+>/g;
const INLINE_TIMESTAMPS = /\[\d{1,2}:\d{2}(?::\d{2})?\]/g;
const STANDALONE_TIMESTAMPS = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}(\.\d{3})?\s*$/;

/**
 * Turns whatever the admin pasted into readable prose: VTT, SRT, YouTube's
 * XML, or plain text with time markers. Duplicate caption lines are dropped.
 */
export function stripTranscriptMarkup(raw: string): string {
  const input = String(raw || '').replace(/\r\n/g, '\n');
  if (!input.trim()) return '';

  const lines = input.split('\n');
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    let text = line;

    if (/^WEBVTT/i.test(text)) continue;
    if (/^\s*(NOTE|STYLE|REGION)\b/.test(text)) continue;
    if (TIMING_LINE.test(text)) continue;
    if (STANDALONE_TIMESTAMPS.test(text)) continue;
    if (!text.trim()) {
      kept.push('');
      continue;
    }

    text = text.replace(VTT_TAGS, '').replace(INLINE_TIMESTAMPS, '');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    text = text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // [Music], [Applause] and friends say nothing about the subject.
    if (/^[\[\]()♪\s.,!?-]+$/.test(text)) continue;
    if (/^\[(music|applause|laughter|silence|inaudible)[^\]]*\]$/i.test(text)) continue;

    // YouTube repeats the tail of one caption at the head of the next.
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }

  // Captions arrive in short lines. Join them into paragraphs, and treat a
  // blank line as a real paragraph break.
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      paragraphs.push(current.join(' ').replace(/\s+([.,!?])/g, '$1').trim());
      current = [];
    }
  };

  for (const line of kept) {
    if (!line) {
      flush();
      continue;
    }
    current.push(line);
    if (current.join(' ').length > 420) flush();
  }
  flush();

  return paragraphs.join('\n\n').trim();
}

export function countWords(text: string): number {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/* ---------------------------------------------------------------- fetch */

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const url = canonicalWatchUrl(videoId);
  const fallback: VideoMeta = {
    videoId,
    url,
    title: `YouTube video ${videoId}`,
    channel: '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as any;
    return {
      videoId,
      url,
      title: String(data.title || fallback.title),
      channel: String(data.author_name || ''),
      thumbnail: String(data.thumbnail_url || fallback.thumbnail)
    };
  } catch {
    return fallback;
  }
}

/**
 * YouTube serves captions to browsers and often withholds them from servers.
 * We try, and when it comes back empty we say why instead of guessing.
 */
export async function fetchYouTubeTranscript(
  videoId: string
): Promise<{ transcript: string; language: string } | { transcript: ''; language: ''; reason: string }> {
  /* The mobile client still hands out caption tracks to servers, so that is
     the first attempt. The watch page is the fallback. */
  const viaMobile = await fetchTranscriptViaInnerTube(videoId);
  if (viaMobile.transcript) return viaMobile;
  const mobileReason = 'reason' in viaMobile ? viaMobile.reason : '';

  try {
    const page = await fetch(`${canonicalWatchUrl(videoId)}&hl=en`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!page.ok) {
      return {
        transcript: '',
        language: '',
        reason: `YouTube answered ${page.status}. Paste the transcript below and everything else works the same.`
      };
    }

    const html = await page.text();
    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) {
      return {
        transcript: '',
        language: '',
        reason: mobileReason || 'This video has no captions, so paste the transcript below.'
      };
    }

    const tracks = JSON.parse(match[1].replace(/\\u0026/g, '&')) as Array<{
      baseUrl: string;
      languageCode?: string;
      kind?: string;
    }>;
    const text = await readCaptionTrack(tracks);
    if (text) return text;
  } catch {
    /* fall through to the message below */
  }

  return {
    transcript: '',
    language: '',
    reason:
      mobileReason ||
      'YouTube did not send the captions to our server. Paste the transcript below and carry on.'
  };
}

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

const pickTrack = (tracks: CaptionTrack[]) =>
  tracks.find((t) => (t.languageCode || '').startsWith('en') && t.kind !== 'asr') ||
  tracks.find((t) => (t.languageCode || '').startsWith('en')) ||
  tracks[0];

/** Reads one caption track, preferring the handwritten English one. */
async function readCaptionTrack(
  tracks: CaptionTrack[]
): Promise<{ transcript: string; language: string } | null> {
  if (!tracks.length) return null;
  const preferred = pickTrack(tracks.filter(Boolean));
  if (!preferred?.baseUrl) return null;

  const base = preferred.baseUrl.replace(/\\u0026/g, '&');
  for (const suffix of ['&fmt=json3', '']) {
    try {
      const res = await fetch(`${base}${suffix}`, {
        headers: {
          'User-Agent':
            'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US)'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) continue;
      const body = await res.text();
      const parsed = parseCaptionPayload(body);
      if (parsed) return { transcript: parsed, language: preferred.languageCode || 'en' };
    } catch {
      /* try the next format */
    }
  }
  return null;
}

/** Parses json3 or XML captions into timed segments. */
export function parseCaptionSegments(body: string): TimedSegment[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as any;
      const events = Array.isArray(json?.events) ? json.events : [];
      const segments: TimedSegment[] = [];
      for (const event of events) {
        const segs = Array.isArray(event?.segs) ? event.segs : null;
        if (!segs) continue;
        const text = segs
          .map((s: any) => String(s?.utf8 || ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) continue;
        segments.push({ startSeconds: Math.max(0, Math.round(Number(event?.tStartMs || 0) / 1000)), text });
      }
      return mergeTinySegments(segments);
    } catch {
      return [];
    }
  }

  if (/<timedtext|<body|<p\s/i.test(trimmed)) {
    const segments: TimedSegment[] = [];
    const paragraphRe = /<p[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    while ((match = paragraphRe.exec(trimmed))) {
      const text = match[2]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;
      segments.push({ startSeconds: Math.max(0, Math.round(Number(match[1]) / 1000)), text });
    }
    return mergeTinySegments(segments);
  }

  return [];
}

/** Captions arrive in two word scraps. Glue them into sentences. */
function mergeTinySegments(segments: TimedSegment[]): TimedSegment[] {
  const merged: TimedSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && segment.startSeconds - last.startSeconds < 6 && last.text.length < 220) {
      last.text = `${last.text} ${segment.text}`.replace(/\s+/g, ' ').trim();
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/** The captions with their times, which is what a summary with pointers needs. */
export async function fetchTimedTranscript(videoId: string): Promise<TimedSegment[]> {
  const client = {
    clientName: 'ANDROID_VR',
    clientVersion: '1.61.48',
    androidSdkVersion: 32,
    hl: 'en',
    gl: 'US'
  };

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US)',
        'X-Youtube-Client-Name': '28',
        'X-Youtube-Client-Version': '1.61.48'
      },
      body: JSON.stringify({ videoId, context: { client }, contentCheckOk: true, racyCheckOk: true }),
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return [];

    const json = (await res.json()) as any;
    const tracks: CaptionTrack[] = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const preferred = pickTrack(tracks.filter(Boolean));
    if (!preferred?.baseUrl) return [];

    const base = preferred.baseUrl.replace(/\\u0026/g, '&');
    for (const suffix of ['&fmt=json3', '']) {
      try {
        const track = await fetch(`${base}${suffix}`, {
          headers: {
            'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US)'
          },
          signal: AbortSignal.timeout(15000)
        });
        if (!track.ok) continue;
        const segments = parseCaptionSegments(await track.text());
        if (segments.length) return segments;
      } catch {
        /* try the next format */
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** The mobile player API. Faster than the watch page and kinder to servers. */
async function fetchTranscriptViaInnerTube(
  videoId: string
): Promise<{ transcript: string; language: string } | { transcript: ''; language: ''; reason: string }> {
  const client = {
    clientName: 'ANDROID_VR',
    clientVersion: '1.61.48',
    androidSdkVersion: 32,
    hl: 'en',
    gl: 'US'
  };

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US)',
        'X-Youtube-Client-Name': '28',
        'X-Youtube-Client-Version': '1.61.48'
      },
      body: JSON.stringify({ videoId, context: { client }, contentCheckOk: true, racyCheckOk: true }),
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      return { transcript: '', language: '', reason: `YouTube answered ${res.status} for this video.` };
    }

    const json = (await res.json()) as any;
    const status = json?.playabilityStatus?.status;
    const tracks: CaptionTrack[] = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (!tracks.length) {
      const reason =
        status === 'OK'
          ? 'This video has captions switched off, so there is nothing to read. Paste the transcript below.'
          : status === 'LOGIN_REQUIRED'
            ? 'YouTube wants a signed in viewer for this video, which our server is not. Paste the transcript below and everything else works the same.'
            : status === 'UNPLAYABLE'
              ? 'YouTube will not serve this video to our server. Paste the transcript below and carry on.'
              : 'No captions came back for this video. Paste the transcript below and carry on.';
      return { transcript: '', language: '', reason };
    }

    const text = await readCaptionTrack(tracks);
    if (text) return text;

    return {
      transcript: '',
      language: '',
      reason: 'YouTube listed the captions but did not send them. Paste the transcript below.'
    };
  } catch {
    return { transcript: '', language: '', reason: 'We could not reach YouTube from the server.' };
  }
}

/** json3, XML and VTT all end up as the same plain text. */
function parseCaptionPayload(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';

  // json3
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as any;
      const events = Array.isArray(json?.events) ? json.events : [];
      const chunks: string[] = [];
      for (const event of events) {
        const segs = Array.isArray(event?.segs) ? event.segs : null;
        if (!segs) continue;
        const text = segs.map((s: any) => String(s?.utf8 || '')).join('');
        if (text.trim()) chunks.push(text.trim());
      }
      return stripTranscriptMarkup(chunks.join('\n'));
    } catch {
      return '';
    }
  }

  // YouTube's timedtext XML: <p t="1360" d="1680">line</p>
  if (/<timedtext|<body|<p\s/i.test(trimmed)) {
    const chunks: string[] = [];
    const paragraphRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    while ((match = paragraphRe.exec(trimmed))) {
      const text = match[1]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) chunks.push(text);
    }
    return stripTranscriptMarkup(chunks.join('\n'));
  }

  return stripTranscriptMarkup(trimmed);
}

/**
 * What the watch page still tells us when the captions are withheld: the
 * description, how long the video runs, and the creator's own chapter list.
 * Those chapters are real pointers, at real times, without a single caption.
 */
export async function fetchVideoExtras(videoId: string): Promise<VideoExtras> {
  const empty: VideoExtras = { description: '', durationSeconds: null, chapters: [] };
  try {
    const res = await fetch(`${canonicalWatchUrl(videoId)}&hl=en`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return empty;
    const html = await res.text();

    const raw =
      html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      html.match(/"attributedDescription":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      '';
    const description = raw ? decodeJsonString(raw).trim() : '';

    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const durationSeconds = lengthMatch ? Number(lengthMatch[1]) || null : null;

    // The player bar chapter list, when the creator set one.
    const chapters: Array<{ startSeconds: number; title: string }> = [];
    const chapterRe =
      /"chapterRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"\},"timeRangeStartMillis":(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = chapterRe.exec(html))) {
      const title = decodeJsonString(match[1]).trim();
      if (!title) continue;
      chapters.push({ startSeconds: Math.max(0, Math.round(Number(match[2]) / 1000)), title });
    }

    // Otherwise, timestamps written in the description itself.
    const fromDescription = parseTimestampedLines(description);
    const finalChapters = chapters.length ? chapters : fromDescription;

    return {
      description,
      durationSeconds,
      chapters: dedupeChapters(finalChapters)
    };
  } catch {
    return empty;
  }
}

/** Kept for callers that only want the description. */
export async function fetchVideoDescription(videoId: string): Promise<string> {
  return (await fetchVideoExtras(videoId)).description;
}

/**
 * Lines like "12:40 Position sizing" or "1:02:03 - The review". This is how most
 * long videos lay out their chapters, captions or not.
 */
export function parseTimestampedLines(text: string): Array<{ startSeconds: number; title: string }> {
  const out: Array<{ startSeconds: number; title: string }> = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:.)]?\s*(.+?)\s*$/);
    if (!match) continue;
    const parts = match[1].split(':').map(Number);
    const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    const title = match[2].replace(/\s+/g, ' ').trim();
    if (!title || title.length > 120) continue;
    out.push({ startSeconds: seconds, title });
  }
  return out;
}

const dedupeChapters = (chapters: Array<{ startSeconds: number; title: string }>) => {
  const seen = new Set<number>();
  return chapters
    .filter((chapter) => {
      if (seen.has(chapter.startSeconds)) return false;
      seen.add(chapter.startSeconds);
      return true;
    })
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .slice(0, 60);
};

/** YouTube stores the description as a JSON string inside the page. */
function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\\/g, '\\');
  }
}

/* ------------------------------------------------------------- generate */

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'have', 'from', 'your', 'when', 'what', 'will', 'just',
  'they', 'them', 'then', 'than', 'there', 'their', 'about', 'into', 'over', 'very', 'also',
  'because', 'been', 'being', 'would', 'could', 'should', 'which', 'while', 'where', 'were',
  'you', 'our', 'out', 'for', 'are', 'but', 'not', 'can', 'how', 'why', 'who', 'all', 'any',
  'one', 'two', 'get', 'got', 'his', 'her', 'its', 'has', 'had', 'was', 'may', 'more', 'most',
  'some', 'such', 'only', 'own', 'same', 'too', 'now', 'way', 'even', 'still', 'does', 'did',
  'here', 'each', 'other', 'after', 'before', 'these', 'those', 'much', 'many', 'make', 'made',
  'like', 'look', 'looks', 'want', 'need', 'know', 'think', 'going', 'right', 'well', 'really'
]);

/** The words a transcript is actually about, biggest first. */
export function keyTopics(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/** Sentences, with the fragments captions leave behind dropped. */
export function splitSentences(text: string): string[] {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);
}

const TITLE_CASE_SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'at', 'by', 'with']);

function titleCase(phrase: string) {
  return phrase
    .split(' ')
    .map((word, i) =>
      i > 0 && TITLE_CASE_SMALL.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

const TRACK_LABEL: Record<string, string> = {
  student_concepts: 'market foundations',
  strategy_learner: 'strategy design',
  trader: 'active trading',
  investor: 'long-term investing',
  both: 'trading and investing'
};

interface DeterministicInput {
  title: string;
  transcript: string;
  track: string;
  level: string;
  moduleCount: number;
}

/**
 * The offline draft. It is assembled from the transcript's own sentences and
 * vocabulary, so it stays on topic, and every task asks for work that can be
 * checked against what the video said.
 */
export function buildDeterministicDraft(input: DeterministicInput): CourseDraft {
  const { title, transcript, track, level, moduleCount } = input;
  const sentences = splitSentences(transcript);
  const topics = keyTopics(transcript, Math.max(moduleCount * 3, 12));
  const perModule = Math.max(2, Math.ceil(sentences.length / Math.max(1, moduleCount)));

  /** The line in a chunk that carries the most of what the video is about. */
  const strongestLine = (lines: string[], offset = 0): string => {
    let best = lines[0] || '';
    let bestScore = -1;
    for (const line of lines) {
      const lower = line.toLowerCase();
      const score = topics.reduce((sum, topic) => sum + (lower.includes(topic) ? 1 : 0), 0);
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
    return best;
  };

  const DANGLING = new Set([
    'a', 'an', 'and', 'as', 'at', 'because', 'but', 'by', 'for', 'from', 'if', 'in', 'into',
    'is', 'it', 'its', 'of', 'on', 'or', 'so', 'that', 'the', 'their', 'then', 'there', 'these',
    'they', 'this', 'to', 'was', 'were', 'when', 'which', 'while', 'with', 'your', 'you'
  ]);

  /**
   * A heading is read, not parsed, so it should end on a word that carries
   * meaning: no trailing "of", no half a clause.
   */
  const shorten = (line: string, words = 8): string => {
    const clean = line
      .replace(/^[^A-Za-z0-9]+/, '')
      .replace(/[.!?,;:]+$/, '')
      .replace(/^(all right|okay|ok|so|and|but|now|then|well|look)[,\s]+/i, '');

    const parts = clean.split(/\s+/).slice(0, words);
    while (parts.length > 3 && DANGLING.has(parts[parts.length - 1].toLowerCase().replace(/[,;:]/g, ''))) {
      parts.pop();
    }
    return parts.join(' ').replace(/[,;:]$/, '');
  };

  const headingFor = (chunk: string[], index: number): string => {
    const line = strongestLine(chunk);
    // Prefer a self-contained clause over the start of a long sentence.
    const clauses = line
      .split(/,\s+|;\s+|\s+(?:because|which|while|but|so that)\s+/i)
      .map((c) => c.trim())
      .filter((c) => c.split(/\s+/).length >= 3);

    const pick =
      clauses.find((c) => c.split(/\s+/).length >= 3 && c.split(/\s+/).length <= 9) ||
      clauses[0] ||
      line;

    const phrase = shorten(pick, 9);
    if (!phrase) return `Part ${index + 1}`;
    return `Module ${index + 1} · ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  };

  const TASK_FRAMES = [
    {
      title: 'Write one plan for one trade',
      instructions: [
        'Take one decision you would genuinely make this week and write the plan before you take it.',
        '',
        '1. Instrument and direction.',
        '2. The level where you are wrong.',
        '3. What you are willing to lose, in rupees.',
        '4. The size that follows from those two numbers.',
        '5. One line on why the trade exists at all.'
      ].join('\n'),
      criteria: [
        'All five fields are filled, with numbers rather than adjectives.',
        'The stop is a level, not a feeling.',
        'Size is calculated from the stop and the risk, and the working is shown.',
        'The reason is written before the entry, not after.'
      ]
    },
    {
      title: 'Find where your sizing slipped',
      instructions: [
        'Look at your last ten trades.',
        '',
        '1. Note the risk you actually took on each one.',
        '2. Mark the two largest and the two smallest.',
        '3. Explain each outlier in one sentence.',
        '4. Say what rule would have kept them within one band.'
      ].join('\n'),
      criteria: [
        'Ten trades are shown with a rupee risk figure for each.',
        'The two outliers are named rather than glossed over.',
        'The explanation is about the decision, not about the market.',
        'The proposed rule is specific enough to apply tomorrow.'
      ]
    },
    {
      title: 'Mark the invalidation before entry',
      instructions: [
        'Pick two open or recent positions.',
        '',
        'For each one, write down:',
        '1. The level that proves the idea wrong.',
        '2. What you will do when price reaches it.',
        '3. What you actually did, if it has been reached.'
      ].join('\n'),
      criteria: [
        'Both positions have a written invalidation level.',
        'The action at the level is decided in advance.',
        'The actual behaviour is reported honestly, including the lapse.',
        'No position is justified only by how confident the learner feels.'
      ]
    },
    {
      title: 'Review one week, process before outcome',
      instructions: [
        'Take last week of decisions and split them into two lists: those that followed your written rules and those that did not.',
        '',
        '1. Show the result of each list.',
        '2. Explain why the two lists differ, if they do.',
        '3. Name the one rule you broke most often.'
      ].join('\n'),
      criteria: [
        'Both lists are complete, including the trades that went well without a plan.',
        'The comparison is between process and outcome, not between wins and losses.',
        'The most broken rule is named in the learner\u2019s own words.',
        'The review would let someone else see what changed.'
      ]
    }
  ];

  const modules: CourseDraftModule[] = [];
  for (let i = 0; i < moduleCount; i += 1) {
    const slice = sentences.slice(i * perModule, i * perModule + perModule);
    if (!slice.length) break;

    const heading = headingFor(slice, i);
    const focusLine = strongestLine(slice);
    const frame = TASK_FRAMES[i % TASK_FRAMES.length];

    const lesson = [
      slice.slice(0, 3).join(' '),
      slice.length > 3 ? slice.slice(3, 6).join(' ') : '',
      'The line worth keeping from this part:',
      `"${focusLine}"`,
      `Read it again, then say in your own words where it applies to how you ${track === 'investor' ? 'build a position' : 'decide a trade'}.`
    ]
      .filter(Boolean)
      .join('\n\n');

    modules.push({
      position: i + 1,
      title: heading,
      focus: shorten(focusLine, 9),
      lesson,
      task: {
        title: frame.title,
        instructions: frame.instructions,
        expectedCriteria: [
          `Judged against what the video said about ${topics.slice(i, i + 2).join(' and ') || 'the topic'}.`,
          ...frame.criteria
        ].join('\n'),
        estimatedMinutes: 30,
        dueDays: 7
      }
    });
  }

  const topicList = topics.slice(0, 4).join(', ');
  const summary = `Built from the video "${title}". Covers ${topicList || 'the ideas in the video'}. ${modules.length} modules, each with one lesson and one marked task.`;

  return {
    title: `${title} · Course`,
    summary,
    description: [
      `Built from the transcript of "${title}".`,
      `Level: ${level}. Track: ${TRACK_LABEL[track] || track}.`,
      `${modules.length} modules, ${modules.length} tasks, and the video itself as the first step.`
    ].join(' '),
    track,
    level,
    generatedBy: 'DETERMINISTIC',
    modelName: 'frins-transcript-builder-v1',
    basis: 'TRANSCRIPT',
    modules,
    tasks: modules.length
  };
}

/* ------------------------------------------------------------------ live */

const SYSTEM_PROMPT = `You design market education courses for FRINS.
You are given the source material for a course: a transcript, a video description, or a topic the admin typed.
Rules:
- Never promise returns, never give buy or sell calls, never call anything risk free.
- Plain English, short sentences, no em dashes.
- Every module needs one lesson of 120 to 220 words and one task the learner can submit.
- Tasks must be checkable. Say exactly what the learner turns in and what a reviewer looks for.
- If the material is thin, stay close to it. Do not invent statistics, prices or names.
Return JSON only, with this shape:
{"title":"","summary":"","description":"","modules":[{"title":"","focus":"","lesson":"","task":{"title":"","instructions":"","expectedCriteria":"","estimatedMinutes":30,"dueDays":7}}]}`;

export const stripDashes = (value: unknown, fallback = '') =>
  String(value ?? fallback)
    // Hyphen variants become a plain hyphen; en and em dashes become a comma.
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[\u2013\u2014\u2015]/g, ',')
    .replace(/\s+,/g, ',');

const toModules = (rawModules: any[]): CourseDraftModule[] =>
  rawModules.slice(0, 12).map((m: any, index: number) => ({
    position: index + 1,
    title: stripDashes(m?.title, `Module ${index + 1}`),
    focus: stripDashes(m?.focus, ''),
    lesson: stripDashes(m?.lesson, ''),
    task: {
      title: stripDashes(m?.task?.title, `Apply Module ${index + 1}`),
      instructions: stripDashes(m?.task?.instructions, ''),
      expectedCriteria: stripDashes(m?.task?.expectedCriteria, ''),
      estimatedMinutes: Number(m?.task?.estimatedMinutes) > 0 ? Number(m.task.estimatedMinutes) : 30,
      dueDays: Number(m?.task?.dueDays) > 0 ? Number(m.task.dueDays) : 7
    }
  }));

/** A hold-the-shape draft for when there is no transcript and no model. */
function emptyDraft(input: DraftRequest, basis: DraftBasis): CourseDraft {
  const count = Math.min(12, Math.max(2, input.moduleCount));
  return {
    title: input.title,
    summary: `A ${count} module course built around this video.`,
    description: '',
    track: input.track,
    level: input.level,
    generatedBy: 'DETERMINISTIC',
    modelName: 'rules',
    basis,
    modules: Array.from({ length: count }).map((_, index) => ({
      position: index + 1,
      title: `Module ${index + 1}`,
      focus: '',
      lesson: 'Write this lesson, or connect a model and generate again.',
      task: {
        title: `Task ${index + 1}`,
        instructions: 'Describe what the learner should hand in.',
        expectedCriteria: '',
        estimatedMinutes: 30,
        dueDays: 7
      }
    })),
    tasks: count
  };
}

export interface DraftRequest {
  title: string;
  /** The transcript, when YouTube served one or an admin pasted one. */
  transcript?: string;
  /** The video description, used when the captions are withheld. */
  description?: string;
  channel?: string;
  track: string;
  level: string;
  moduleCount: number;
  /** A learner to write for. Shapes the examples and the difficulty. */
  learner?: { name?: string; track?: string; level?: string; focus?: string[] } | null;
}

/**
 * Write a course from whatever material is available. The model comes from the
 * console settings, which start on the free one, so this works with no key.
 * A failure falls back to the transcript builder, and a draft is never labelled
 * as model written when it is not.
 */
export async function buildCourseDraft(input: DraftRequest): Promise<CourseDraft | null> {
  const transcript = String(input.transcript || '').trim();
  const description = String(input.description || '').trim();
  const hasTranscript = countWords(transcript) >= 60;
  const hasDescription = countWords(description) >= 40;
  const basis: DraftBasis = hasTranscript ? 'TRANSCRIPT' : 'DESCRIPTION';

  const offline = hasTranscript
    ? buildDeterministicDraft({
        title: input.title,
        transcript,
        track: input.track,
        level: input.level,
        moduleCount: input.moduleCount
      })
    : null;

  if (!hasTranscript && !hasDescription) return offline;

  const material = hasTranscript
    ? transcript.slice(0, 24000)
    : `Video title: ${input.title}\nChannel: ${input.channel || 'unknown'}\nDescription:\n${description.slice(0, 6000)}`;

  const learnerLine = input.learner
    ? `Write for one learner: ${input.learner.name || 'a learner'}. Track: ${input.learner.track || input.track}. Level: ${input.learner.level || input.level}.${
        input.learner.focus && input.learner.focus.length
          ? ` Their recent review flagged: ${input.learner.focus.join('; ')}.`
          : ''
      }`
    : 'Write for a learner on the stated track and level.';

  const result = await aiChat({
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      task: hasTranscript ? 'Turn this material into a course.' : 'Write a course from this video description. It is the only material you have.',
      source: basis,
      title: input.title,
      track: input.track,
      level: input.level,
      moduleCount: input.moduleCount,
      learner: learnerLine,
      material
    }),
    json: true,
    temperature: 0.35,
    timeoutMs: 90000
  });

  if (!result.ok) {
    return offline ? { ...offline, fallbackReason: result.error } : { ...emptyDraft(input, basis), fallbackReason: result.error };
  }

  const parsed = parseJsonLoose<any>(result.text);
  const modules = toModules(Array.isArray(parsed?.modules) ? parsed.modules : []);
  if (!modules.length) return offline;

  return {
    title: stripDashes(parsed?.title, offline?.title || input.title),
    summary: stripDashes(parsed?.summary, offline?.summary || ''),
    description: stripDashes(parsed?.description, offline?.description || ''),
    track: input.track,
    level: input.level,
    generatedBy: 'LIVE_LLM',
    modelName: result.model || 'model',
    basis,
    modules,
    tasks: modules.length
  };
}
