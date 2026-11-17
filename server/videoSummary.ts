/* ---------------------------------------------------------------------------
   Video summaries.

   A two hour video is not something anyone watches on a deadline. This turns it
   into an overview, a set of sections with the time they start, and a short list
   of takeaways, so the admin can decide what to watch and skip the rest.

   Three levels of material, in order of how much they can be trusted:

   1. TRANSCRIPT  the spoken words, with times. Real summary, real pointers.
   2. CHAPTERS    the creator's own chapter list, still with real times, and the
                  description. Good enough to see the shape of the video.
   3. DESCRIPTION only what the uploader wrote. Says so, and says less.

   The extractive pass always runs, so there is a summary even with no model.
   The model then rewrites it, if one is connected.
   --------------------------------------------------------------------------- */

import { aiChat, parseJsonLoose } from './aiClient.js';
import { keyTopics, type TimedSegment, type WatchPageStatus } from './videoStudio.js';

export type SummaryBasis = 'TRANSCRIPT' | 'CHAPTERS' | 'DESCRIPTION' | 'METADATA';

export interface SummarySection {
  startSeconds: number;
  timestamp: string;
  title: string;
  points: string[];
}

export interface VideoSummary {
  overview: string;
  sections: SummarySection[];
  takeaways: string[];
  basis: SummaryBasis;
  generatedBy: 'LIVE_LLM' | 'DETERMINISTIC';
  modelName: string;
  durationSeconds: number | null;
  /** How long the summary takes to read, in minutes. */
  readingMinutes: number;
  fallbackReason?: string;
  /** Said plainly when there was nothing to read, and why. */
  note?: string;
}

/** English, Hindi, Bangla: the names a person reads, from the codes YouTube sends. */
const languageNames = (codes: string[]) => {
  const names = codes.map((code) => {
    const base = String(code).toLowerCase().split('-')[0];
    try {
      const label = new Intl.DisplayNames(['en'], { type: 'language' }).of(base);
      return label && label !== base ? label : String(code).toUpperCase();
    } catch {
      return String(code).toUpperCase();
    }
  });
  const unique = [...new Set(names)];
  return unique.length <= 1
    ? unique[0] || 'this video'
    : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
};

/** 1:02:03, or 12:40. */
export const formatTimestamp = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
};

const FILLER = new Set([
  'the', 'and', 'that', 'this', 'with', 'have', 'from', 'your', 'when', 'what', 'will', 'just',
  'they', 'them', 'then', 'than', 'there', 'their', 'about', 'into', 'over', 'very', 'also',
  'because', 'been', 'being', 'would', 'could', 'should', 'which', 'while', 'where', 'were',
  'you', 'our', 'out', 'for', 'are', 'but', 'not', 'can', 'how', 'why', 'who', 'all', 'any',
  'one', 'two', 'get', 'got', 'his', 'her', 'its', 'has', 'had', 'was', 'may', 'more', 'most',
  'some', 'such', 'only', 'own', 'same', 'too', 'now', 'way', 'even', 'still', 'does', 'did',
  'here', 'each', 'other', 'after', 'before', 'these', 'those', 'much', 'many', 'make', 'made',
  'like', 'look', 'looks', 'want', 'need', 'know', 'think', 'going', 'right', 'well', 'really',
  'yeah', 'okay', 'ok', 'so', 'um', 'uh', 'right', 'things', 'thing', 'kind', 'sort', 'actually'
]);

const words = (text: string) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** A word's weight across the whole video. Repeats mean it matters. */
const buildWeights = (text: string) => {
  const counts = new Map<string, number>();
  for (const word of words(text)) {
    if (word.length < 3 || FILLER.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return counts;
};

const sentencesOf = (text: string) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);

const scoreSentence = (sentence: string, weights: Map<string, number>) => {
  const list = words(sentence).filter((w) => w.length > 3 && !FILLER.has(w));
  if (!list.length) return 0;
  const total = list.reduce((sum, word) => sum + (weights.get(word) || 0), 0);
  return total / Math.sqrt(list.length);
};

const titleFrom = (text: string, fallback: string) => {
  const weights = buildWeights(text);
  const best = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
    .sort((a, b) => text.toLowerCase().indexOf(a) - text.toLowerCase().indexOf(b));
  if (!best.length) return fallback;
  const phrase = best.join(' ');
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
};

const cleanPoint = (value: unknown) =>
  String(value ?? '')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[\u2013\u2014\u2015]/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

const readingMinutesOf = (summary: Pick<VideoSummary, 'overview' | 'sections' | 'takeaways'>) => {
  const text = [
    summary.overview,
    ...summary.sections.flatMap((section) => [section.title, ...section.points]),
    ...summary.takeaways
  ].join(' ');
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
};

/* --------------------------------------------------- timed transcript pass */

export interface SummarySectionDraft {
  startSeconds: number;
  title: string;
  points: string[];
}

/**
 * Turns a timed transcript into evenly spaced sections, each with the few
 * sentences that carry it. This is the fallback summary, and the material the
 * model is given, so both describe the same parts of the video.
 */
export function extractSections(segments: TimedSegment[], maxSections = 14): SummarySectionDraft[] {
  const usable = segments.filter((segment) => segment.text && segment.text.split(/\s+/).length > 2);
  if (usable.length < 4) return [];

  const totalWords = usable.reduce((sum, segment) => sum + segment.text.split(/\s+/).length, 0);
  // Long videos get more sections, but never so many that nobody reads them.
  const count = Math.max(3, Math.min(maxSections, Math.round(totalWords / 240)));
  const perSection = Math.ceil(usable.length / count);

  const weights = buildWeights(usable.map((segment) => segment.text).join(' '));

  const sections: SummarySectionDraft[] = [];
  for (let index = 0; index < usable.length; index += perSection) {
    const slice = usable.slice(index, index + perSection);
    if (!slice.length) continue;

    const text = slice.map((segment) => segment.text).join(' ');
    const sentences = sentencesOf(text);
    const ranked = sentences
      .map((sentence) => ({ sentence, score: scoreSentence(sentence, weights) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
      .map((entry) => entry.sentence.replace(/\s+/g, ' ').trim());

    sections.push({
      startSeconds: slice[0].startSeconds,
      title: titleFrom(text, `Part ${sections.length + 1}`),
      points: ranked.length ? ranked : [text.slice(0, 220)]
    });
  }

  return sections;
}

/* ------------------------------------------------------------ description */

const firstSentences = (text: string, count: number) =>
  sentencesOf(text).slice(0, count).join(' ').trim();

/* --------------------------------------------------------------- the model */

const SYSTEM_PROMPT = `You summarise market education videos for FRINS.
The admin has a long video and cannot watch all of it. Give them the shape of it and
the parts worth their time, with the time each part starts.
Rules:
- Use only the material given. Never invent facts, names, numbers or times.
- Every section must start at one of the timestamps you were given, copied exactly.
- Points are short and concrete: what the viewer learns or sees, not "he talks about".
- Plain English, short sentences, no em dashes.
- Never promise returns, never give buy or sell calls.
Return JSON only:
{"overview":"three to five sentences on what the video is and who it is for","sections":[{"timestamp":"12:40","title":"short title","points":["",""]}],"takeaways":["","",""]}`;

interface BuildInput {
  title: string;
  channel?: string;
  description?: string;
  durationSeconds?: number | null;
  segments: TimedSegment[];
  chapters: Array<{ startSeconds: number; title: string }>;
  /** How the page read went, so a failed read is never called an empty video. */
  readStatus?: WatchPageStatus;
  /** Caption languages the page lists, even when their text stays locked. */
  captionLanguages?: string[];
}

export async function buildVideoSummary(input: BuildInput): Promise<VideoSummary> {
  const durationSeconds = input.durationSeconds ?? null;
  const extracted = extractSections(input.segments);
  const basis: SummaryBasis = extracted.length
    ? 'TRANSCRIPT'
    : input.chapters.length >= 2
      ? 'CHAPTERS'
      : (input.description || '').trim()
        ? 'DESCRIPTION'
        : 'METADATA';

  /* -------- the offline summary, which is also what we hand the model ---- */
  const offline: VideoSummary = (() => {
    if (basis === 'TRANSCRIPT') {
      const sections: SummarySection[] = extracted.map((section) => ({
        startSeconds: section.startSeconds,
        timestamp: formatTimestamp(section.startSeconds),
        title: section.title,
        points: section.points
      }));
      const talk = input.segments.map((s) => s.text).join(' ');
      const topics = keyTopics(talk, 6);
      const lengthLine = durationSeconds
        ? `${formatTimestamp(durationSeconds)} of video, cut into ${sections.length} parts.`
        : `${sections.length} parts.`;
      return {
        overview:
          topics.length > 0
            ? `This video works through ${topics.slice(0, 3).join(', ')}. ${lengthLine} The times below are where each part starts.`
            : firstSentences(talk, 2) || `${input.title}.`,
        sections,
        takeaways: topics.slice(0, 5).map((topic) => `Keep an ear on ${topic}.`),
        basis,
        generatedBy: 'DETERMINISTIC',
        modelName: 'rules',
        durationSeconds,
        readingMinutes: 1
      };
    }

    if (basis === 'CHAPTERS') {
      const sections: SummarySection[] = input.chapters.map((chapter) => ({
        startSeconds: chapter.startSeconds,
        timestamp: formatTimestamp(chapter.startSeconds),
        title: cleanPoint(chapter.title),
        points: []
      }));
      return {
        overview:
          firstSentences(input.description || '', 2) ||
          `${input.title}, in ${sections.length} parts as the creator laid them out.`,
        sections,
        takeaways: sections.slice(0, 4).map((section) => `${section.timestamp} ${section.title}`),
        basis,
        generatedBy: 'DETERMINISTIC',
        modelName: 'rules',
        durationSeconds,
        readingMinutes: 1
      };
    }

    if (!(input.description || '').trim()) {
      /* Three different things used to read the same here: YouTube published
         nothing, YouTube listed captions but kept the words, and our own read
         failed. Only the first is about the video, so they are said apart. */
      const languages = (input.captionLanguages || []).filter(Boolean);
      const named = languageNames(languages);
      const readFailed = input.readStatus && input.readStatus !== 'OK';

      let overview: string;
      let note: string;

      if (input.readStatus === 'UNAVAILABLE') {
        overview = `YouTube says this video is unavailable. It may be private, taken down, or the link may be short of a character.`;
        note = 'Check the link in a browser. If it opens there, paste the transcript and everything else works the same.';
      } else if (readFailed) {
        overview =
          input.readStatus === 'BOT_WALL'
            ? `We could not read this video's page. YouTube asked to confirm a browser rather than a server, so it sent nothing back for ${input.title}.`
            : `We could not read this video's page just now, so YouTube sent nothing back for ${input.title}. That is usually a passing block on their side.`;
        note = 'Try again in a minute. If it stays shut, paste the transcript and everything else works the same.';
      } else if (languages.length) {
        overview = `${input.title}${input.channel ? ` by ${input.channel}` : ''} has captions in ${named}, and YouTube keeps the words themselves from our server. Its page has no description and no chapter marks to read instead.`;
        note = 'Open the video, choose More, then Show transcript, copy it and paste it above. The summary then carries the minute each part starts.';
      } else {
        const length = durationSeconds ? `${formatTimestamp(durationSeconds)} long` : 'of a length we could not read';
        overview = `${input.title}${input.channel ? ` by ${input.channel}` : ''} is ${length}. YouTube lists no description, no chapters and no captions for it, so there is nothing to read yet.`;
        note = 'Paste the transcript and this page fills in with the times of each part.';
      }

      return {
        overview,
        note,
        sections: [],
        takeaways: [],
        basis: 'METADATA',
        generatedBy: 'DETERMINISTIC',
        modelName: 'rules',
        durationSeconds,
        readingMinutes: 1
      };
    }

    const overview =
      firstSentences(input.description || '', 3) ||
      `${input.title}. There is no transcript and no chapter list for this video yet.`;
    return {
      overview,
      sections: [],
      takeaways: [],
      basis: 'DESCRIPTION',
      generatedBy: 'DETERMINISTIC',
      modelName: 'rules',
      durationSeconds,
      readingMinutes: 1
    };
  })();

  offline.readingMinutes = readingMinutesOf(offline);

  /* Nothing was published at all. Say that plainly instead of asking a model
     to pad it out. There is still a video, and there is still the truth. */
  if (basis === 'METADATA') return offline;

  /* ------------------------------ ask the model to write it properly ----- */
  const allowed = new Map<string, number>();
  for (const section of offline.sections) allowed.set(section.timestamp, section.startSeconds);

  const material =
    basis === 'TRANSCRIPT'
      ? {
          source: 'TRANSCRIPT',
          note: 'Each entry is one stretch of the video, in order. Points are quotes and near quotes from it.',
          sections: extracted.map((section) => ({
            timestamp: formatTimestamp(section.startSeconds),
            said: section.points
          }))
        }
      : basis === 'CHAPTERS'
        ? {
            source: 'CHAPTERS',
            note: 'These are the creator\'s own chapter titles and the video description. Do not claim what is said inside a chapter; only what its title and the description tell you.',
            chapters: input.chapters.map((chapter) => ({
              timestamp: formatTimestamp(chapter.startSeconds),
              title: chapter.title
            })),
            description: (input.description || '').slice(0, 5000)
          }
        : {
            source: 'DESCRIPTION',
            note: 'Only the description is available. Say what the video covers, not what it says.',
            description: (input.description || '').slice(0, 5000)
          };

  const result = await aiChat({
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      title: input.title,
      channel: input.channel || '',
      duration: durationSeconds ? formatTimestamp(durationSeconds) : 'unknown',
      material
    }),
    json: true,
    temperature: 0.3,
    timeoutMs: 90000
  });

  if (!result.ok) {
    return { ...offline, fallbackReason: result.error };
  }

  const parsed = parseJsonLoose<any>(result.text);
  const rawSections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  if (!rawSections.length && basis !== 'DESCRIPTION') {
    return { ...offline, fallbackReason: 'The model returned no sections.' };
  }

  const sections: SummarySection[] = [];
  for (const raw of rawSections.slice(0, 24)) {
    const timestamp = cleanPoint(raw?.timestamp || '');
    const startSeconds = allowed.get(timestamp);
    // A time the model made up is not a pointer. Drop it.
    if (startSeconds === undefined) continue;
    const points = (Array.isArray(raw?.points) ? raw.points : [])
      .map((point: unknown) => cleanPoint(point))
      .filter(Boolean)
      .slice(0, 4);
    const title = cleanPoint(raw?.title || '');
    sections.push({
      startSeconds,
      timestamp,
      title: title || `At ${timestamp}`,
      points
    });
  }

  sections.sort((a, b) => a.startSeconds - b.startSeconds);

  const overview = cleanPoint(parsed?.overview || '') || offline.overview;
  const takeaways = (Array.isArray(parsed?.takeaways) ? parsed.takeaways : [])
    .map((item: unknown) => cleanPoint(item))
    .filter(Boolean)
    .slice(0, 6);

  const summary: VideoSummary = {
    overview,
    sections: sections.length ? sections : offline.sections,
    takeaways: takeaways.length ? takeaways : offline.takeaways,
    basis,
    generatedBy: 'LIVE_LLM',
    modelName: result.model || 'model',
    durationSeconds,
    readingMinutes: 1
  };
  summary.readingMinutes = readingMinutesOf(summary);
  return summary;
}

/** The summary as plain text, for copying into a note or a message. */
export function summaryToText(summary: VideoSummary, title: string, url: string) {
  const lines: string[] = [];
  lines.push(title);
  lines.push(url);
  const from =
    summary.basis === 'TRANSCRIPT'
      ? 'From the transcript'
      : summary.basis === 'CHAPTERS'
        ? 'From the chapters'
        : summary.basis === 'DESCRIPTION'
          ? 'From the description'
          : 'From the title and length';
  lines.push(`${from} · ${summary.readingMinutes} min read`);
  lines.push('');
  lines.push(summary.overview);
  if (summary.sections.length) {
    lines.push('');
    lines.push('Sections');
    for (const section of summary.sections) {
      lines.push(`${section.timestamp}  ${section.title}`);
      for (const point of section.points) lines.push(`   - ${point}`);
    }
  }
  if (summary.takeaways.length) {
    lines.push('');
    lines.push('Takeaways');
    for (const takeaway of summary.takeaways) lines.push(`- ${takeaway}`);
  }
  return lines.join('\n');
}
