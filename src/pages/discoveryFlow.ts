/* ---------------------------------------------------------------------------
   The Discovery flow, page side.

   Which questions appear, in what order, and how many, is decided by the rules
   an admin sets. Those rules live in src/shared/discoveryFlow.ts, which the
   server reads too, so what the page shows and what the result is built from
   can never drift apart. This file only maps the API payload into that shape
   and adds the short "why we ask" line under each question.
   --------------------------------------------------------------------------- */

import {
  DEFAULT_SETTINGS,
  flowProgress,
  resolveFlow,
  roleLabelFor,
  type DiscoverySettings,
  type FlowQuestion,
  type FlowOption,
  type ShowIfRule
} from '../shared/discoveryFlow';

export { flowProgress, roleLabelFor, DEFAULT_SETTINGS };
export type { DiscoverySettings, FlowQuestion, FlowOption, ShowIfRule };

/** The payload the public endpoint sends. Serialised rows, not classes. */
export interface ApiQuestion {
  id: string;
  number: number;
  order?: number;
  domain: string;
  domainTitle: string;
  prompt: string;
  inputType: 'single_choice' | 'text';
  options?: Array<string | FlowOption>;
  audience?: string[];
  experience?: string[];
  showIf?: ShowIfRule[];
  askInFlow?: boolean;
  resultNote?: string;
  isActive?: boolean;
}

export type Track =
  | 'student_concepts'
  | 'strategy_learner'
  | 'trader'
  | 'investor'
  | 'both'
  | 'other';

export type Answers = Record<string, string>;

/** Kept for older callers; the number now comes from the admin settings. */
export const MINIMUM_ANSWERS = DEFAULT_SETTINGS.minAnswers;

export const roleFromTrack = (track: string): string =>
  track === 'other' ? 'other' : track;

export const roleLabel = (track: string): string => roleLabelFor(track);

/**
 * One plain sentence under each question, so it never feels arbitrary. This is
 * presentation only. Branching is entirely rule driven.
 */
const WHY: Record<string, string> = {
  Q02: 'It tells us which market to use in your first examples.',
  Q28: 'So the course aims at what you actually want.',
  Q31: 'This is where we start, before any module is written.',
  Q30: 'Your plan has to fit the hours you really have.',
  Q23: 'Beginners are usually told to watch charts, not themselves.',
  Q22: 'It decides whether we start you with a simple journal.',
  Q27: 'You do not need an answer here. We just want to see where you are.',
  Q29: 'It sets how direct your mentor should be with you.',
  Q33: 'Optional, in your own words. Skip it if you would rather not.',
  Q01: 'It tells us what you already believe about the market.',
  Q03: 'Experience changes how much we skip and where we slow down.',
  Q04: 'It decides whether your plan starts with a habit or a method.',
  Q05: 'Trading and investing need different anchors.',
  Q06: 'Risk is the part most people leave to mood.',
  Q07: 'It tells us whether you need a process or a repeatable system.',
  Q08: 'This one shapes where your review starts.',
  Q09: 'Your exit rule is what protects the money you make.',
  Q10: 'It shows how much of your trading is already written down.',
  Q11: 'It shows how much of your day the plan has to fit.',
  Q12: 'It tells us whether you build from theory or from screen time.',
  Q13: 'It decides how much weight the mentor puts on discipline.',
  Q14: 'It shows whether your entries are planned or improvised.',
  Q15: 'It shows whether your results come from a rule or a run.',
  Q16: 'It tells us which part of your process we look at first.',
  Q17: 'It shows whether your losses are planned or personal.',
  Q18: 'It sets the first habit we build with you.',
  Q19: 'It decides where your mentor pushes and where they wait.',
  Q20: 'It tells us whether the strategy or the habit comes first.',
  Q21: 'It shows what you already do well, so we do not repeat it.',
  Q24: 'It tells us which feedback will land and which will not.',
  Q25: 'It tells us which part of the portfolio we look at first.',
  Q26: 'Risk here is about how you size, not how you feel.',
  Q32: 'It tells us who you are doing this for.'
};

const GENERIC_WHY = 'A short question so we can place you properly.';

const normaliseOption = (option: string | FlowOption): FlowOption =>
  typeof option === 'string' ? { value: option, label: option } : option;

/** Turn one API row into the shared flow shape. */
export const toFlowQuestion = (question: ApiQuestion): FlowQuestion => ({
  id: question.id,
  number: question.number,
  order: Number(question.order) || question.number,
  domain: question.domain,
  domainTitle: question.domainTitle,
  prompt: question.prompt,
  inputType: question.inputType,
  options: (question.options || []).map(normaliseOption),
  audience: question.audience || [],
  experience: question.experience || [],
  showIf: question.showIf || [],
  askInFlow: question.askInFlow !== false,
  active: question.isActive !== false,
  resultNote: question.resultNote || ''
});

export interface ResolvedFlow {
  questions: Array<FlowQuestion & { why: string }>;
  settings: DiscoverySettings;
  length: number;
}

/**
 * The questions this person sees. Role and experience narrow the bank, earlier
 * answers open or close the rest, and the admin's count decides how many show.
 */
export function buildDiscoveryFlow(
  bank: ApiQuestion[],
  settings: DiscoverySettings | null | undefined,
  track: string,
  experience: string,
  answers: Answers
): ResolvedFlow {
  const resolved = resolveFlow(
    bank.map(toFlowQuestion),
    settings || DEFAULT_SETTINGS,
    roleFromTrack(track),
    experience,
    answers
  );

  const questions = resolved.questions.map((question) => ({
    ...question,
    why: question.resultNote || WHY[question.id] || GENERIC_WHY
  }));

  return { questions, settings: resolved.settings, length: questions.length };
}
