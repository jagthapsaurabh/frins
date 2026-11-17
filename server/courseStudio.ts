/* ---------------------------------------------------------------------------
   Topic studio.

   An admin types a subject, says who it is for, and gets a course: modules,
   a lesson each, and a task each. The model is whatever the console is set to,
   which starts on the free one, so this works with no key. If the model is
   unreachable the outline still comes back, written by the rule based builder,
   and the draft says so.
   --------------------------------------------------------------------------- */

import { aiChat, parseJsonLoose } from './aiClient.js';
import { keyTopics, type CourseDraft, type CourseDraftModule } from './videoStudio.js';

export interface TopicRequest {
  topic: string;
  /** Anything the admin wants included: a book, a chart type, a past mistake. */
  brief?: string;
  track: string;
  level: string;
  moduleCount: number;
  learner?: { name?: string; track?: string; level?: string; focus?: string[] } | null;
}

const SYSTEM_PROMPT = `You design market education courses for FRINS.
You are given a topic, an optional brief, and the person the course is for.
Build a course that teaches that topic in order, from where the learner actually is.
Rules:
- Never promise returns, never give buy or sell calls, never call anything risk free.
- Plain English, short sentences, no em dashes.
- Each lesson is 120 to 220 words and teaches one idea.
- Each task is something the learner submits and a reviewer can check. Say what they hand in and what good looks like.
- Use the learner's stated level and focus areas. Do not repeat what they already do well.
- Do not invent statistics, prices, names or dates.
Return JSON only:
{"title":"","summary":"","description":"","modules":[{"title":"","focus":"","lesson":"","task":{"title":"","instructions":"","expectedCriteria":"","estimatedMinutes":30,"dueDays":7}}]}`;

const clean = (value: unknown, fallback = '') =>
  String(value ?? fallback)
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[\u2013\u2014\u2015]/g, ',')
    .replace(/\s+,/g, ',')
    .trim();

const toModules = (raw: any[], fallbackTitle: string): CourseDraftModule[] =>
  raw.slice(0, 12).map((m: any, index: number) => ({
    position: index + 1,
    title: clean(m?.title, `${fallbackTitle}: part ${index + 1}`),
    focus: clean(m?.focus, ''),
    lesson: clean(m?.lesson, ''),
    task: {
      title: clean(m?.task?.title, `Practise part ${index + 1}`),
      instructions: clean(m?.task?.instructions, ''),
      expectedCriteria: clean(m?.task?.expectedCriteria, ''),
      estimatedMinutes: Number(m?.task?.estimatedMinutes) > 0 ? Number(m.task.estimatedMinutes) : 30,
      dueDays: Number(m?.task?.dueDays) > 0 ? Number(m.task.dueDays) : 7
    }
  }));

/**
 * A plain outline for when no model can be reached. It is honest about what it
 * is: a skeleton the admin fills in, not a written course.
 */
export function buildTopicOutline(input: TopicRequest): CourseDraft {
  const topic = clean(input.topic, 'Untitled topic');
  const ideas = keyTopics(`${input.topic} ${input.brief || ''}`, 12);
  const count = Math.min(12, Math.max(2, input.moduleCount));
  const stages = ['What it is', 'Where it goes wrong', 'How to do it', 'How to check it', 'When to stop', 'Making it a habit'];

  const modules: CourseDraftModule[] = Array.from({ length: count }).map((_, index) => {
    const stage = stages[index % stages.length];
    const idea = ideas[index % Math.max(1, ideas.length)] || topic;
    return {
      position: index + 1,
      title: `${stage}: ${idea.replace(/\b\w/g, (c) => c.toUpperCase())}`,
      focus: `A short pass over ${idea} for a ${input.level} learner.`,
      lesson: [
        `This lesson is a placeholder so the shape of the course is in place.`,
        `Write what a ${input.level} learner needs to know about ${idea} in this position, then join a model to have it written for you.`,
        `Two or three short paragraphs work better than one long one. Name the mistake people make here and the rule that prevents it.`
      ].join('\n\n'),
      task: {
        title: `Apply: ${idea}`,
        instructions: `Write down what you would do with ${idea} on your own charts or portfolio this week. One page. Say what you looked at, what you decided, and what you would do differently next time.`,
        expectedCriteria: `Names the decision, the reason, and one thing to change. No trade calls.`,
        estimatedMinutes: 30,
        dueDays: 7
      }
    };
  });

  return {
    title: topic,
    summary: `A ${count} module course on ${topic.toLowerCase()}, written for a ${input.level} learner.`,
    description: input.brief || '',
    track: input.track,
    level: input.level,
    generatedBy: 'DETERMINISTIC',
    modelName: 'rules',
    basis: 'TOPIC',
    modules,
    tasks: modules.length
  };
}

/**
 * The course an admin asked for, by topic. Returns null only when the topic is
 * empty; a model failure falls back to the outline above.
 */
export async function buildTopicDraft(input: TopicRequest): Promise<CourseDraft | null> {
  const topic = clean(input.topic, '');
  if (topic.length < 3) return null;

  const fallback = buildTopicOutline(input);
  const focus = input.learner?.focus?.filter(Boolean) || [];

  const result = await aiChat({
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      topic,
      brief: clean(input.brief, ''),
      moduleCount: input.moduleCount,
      track: input.track,
      level: input.level,
      learner: input.learner
        ? {
            name: input.learner.name || 'a learner',
            track: input.learner.track || input.track,
            level: input.learner.level || input.level,
            alreadyGoodAt: focus.length ? focus : 'unknown'
          }
        : 'no named learner, write for the track and level',
      length: 'Each lesson 120 to 220 words.'
    }),
    json: true,
    temperature: 0.5,
    timeoutMs: 90000,
    task: 'course'
  });

  if (!result.ok) return { ...fallback, fallbackReason: result.error };

  const parsed = parseJsonLoose<any>(result.text);
  const modules = toModules(Array.isArray(parsed?.modules) ? parsed.modules : [], topic);
  if (!modules.length) return { ...fallback, fallbackReason: 'The model returned no modules.' };

  return {
    title: clean(parsed?.title, topic),
    summary: clean(parsed?.summary, fallback.summary),
    description: clean(parsed?.description, clean(input.brief, '')),
    track: input.track,
    level: input.level,
    generatedBy: 'LIVE_LLM',
    modelName: result.model || 'model',
    basis: 'TOPIC',
    modules,
    tasks: modules.length
  };
}
