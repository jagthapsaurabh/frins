/* ---------------------------------------------------------------------------
   Discovery flow, shared by the public page and the server.

   Nothing about the order or the branching is hardcoded any more: each question
   carries its own rules, set by an admin, and this file just applies them.
   --------------------------------------------------------------------------- */

export type RoleKey =
  | 'student_concepts'
  | 'strategy_learner'
  | 'trader'
  | 'investor'
  | 'both'
  | 'other';

export const ROLE_OPTIONS: Array<{ value: RoleKey; label: string }> = [
  { value: 'student_concepts', label: 'Student or beginner' },
  { value: 'strategy_learner', label: 'Strategy learner' },
  { value: 'trader', label: 'Active trader' },
  { value: 'investor', label: 'Long-term investor' },
  { value: 'both', label: 'Trading and investing' },
  { value: 'other', label: 'Something else' }
];

export const EXPERIENCE_OPTIONS = [
  { value: 'under_1y', label: 'Less than 1 year' },
  { value: '1_to_3y', label: '1 to 3 years' },
  { value: '3_to_7y', label: '3 to 7 years' },
  { value: 'over_7y', label: 'More than 7 years' }
];

export const TONE_OPTIONS = [
  { value: 'focus', label: 'Where we start' },
  { value: 'developing', label: 'Half formed' },
  { value: 'strength', label: 'Already working' }
];

/** "Only ask this when another question was answered with one of these." */
export interface ShowIfRule {
  questionId: string;
  values: string[];
  /** Leave empty to apply to every role. */
  roles: string[];
}

export interface OutcomeCopy {
  title: string;
  body: string;
  tone: 'strength' | 'developing' | 'focus';
}

export interface FlowOption {
  value: string;
  label: string;
  outcome?: OutcomeCopy | null;
}

export interface FlowQuestion {
  id: string;
  number: number;
  order: number;
  domain: string;
  domainTitle: string;
  prompt: string;
  inputType: 'single_choice' | 'text';
  options?: FlowOption[];
  /** Empty means every role sees it. */
  audience: string[];
  /** Empty means every experience band sees it. */
  experience: string[];
  showIf: ShowIfRule[];
  askInFlow: boolean;
  active: boolean;
  resultNote?: string;
}

export interface DiscoverySettings {
  minAnswers: number;
  maxQuestions: number;
}

export const DEFAULT_SETTINGS: DiscoverySettings = { minAnswers: 3, maxQuestions: 9 };

export type Answers = Record<string, string>;

const hasAnswer = (answers: Answers, id: string) => String(answers[id] || '').trim().length > 0;

/**
 * A condition scoped to certain roles is ignored for everyone else, so one
 * question can behave differently for an investor and a trader.
 */
const conditionApplies = (rule: ShowIfRule, role: string) =>
  !rule.roles || rule.roles.length === 0 || rule.roles.includes(role);

export function conditionMet(rule: ShowIfRule, answers: Answers): boolean {
  const value = String(answers[rule.questionId] || '').trim();
  if (!value) return false;
  return rule.values.includes(value);
}

export interface ResolvedFlow {
  questions: FlowQuestion[];
  settings: DiscoverySettings;
}

/**
 * The questions this person is actually asked, in the admin's order:
 * role, experience, then the answers already given, capped at the configured
 * number. Anything already answered stays in the path so a changed answer
 * never takes a question away.
 */
export function resolveFlow(
  bank: FlowQuestion[],
  settings: DiscoverySettings,
  role: string,
  experience: string,
  answers: Answers
): ResolvedFlow {
  const safeSettings: DiscoverySettings = {
    minAnswers: Math.max(1, Number(settings.minAnswers) || DEFAULT_SETTINGS.minAnswers),
    maxQuestions: Math.max(1, Number(settings.maxQuestions) || DEFAULT_SETTINGS.maxQuestions)
  };

  const eligible = [...bank]
    .filter((q) => q.active && q.askInFlow)
    .filter((q) => q.audience.length === 0 || q.audience.includes(role))
    .filter((q) => q.experience.length === 0 || q.experience.includes(experience))
    .filter((q) => {
      const rules = q.showIf.filter((rule) => conditionApplies(rule, role));
      if (!rules.length) return true;
      const met = rules.every((rule) => conditionMet(rule, answers));
      return met || hasAnswer(answers, q.id);
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const answered = eligible.filter((q) => hasAnswer(answers, q.id));
  const unanswered = eligible.filter((q) => !hasAnswer(answers, q.id));
  const room = Math.max(0, safeSettings.maxQuestions - answered.length);
  const questions = [...answered, ...unanswered.slice(0, room)].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id)
  );

  /* A thin bank should never leave someone below the minimum. If the rules
     filter everything out, fill from the questions that are still on in the
     flow, and only then from anything active, saying nothing about it. */
  if (questions.length < safeSettings.minAnswers) {
    const filler = [
      ...bank.filter((q) => q.active && q.askInFlow),
      ...bank.filter((q) => q.active && !q.askInFlow)
    ];
    for (const q of filler) {
      if (questions.some((existing) => existing.id === q.id)) continue;
      questions.push(q);
      if (questions.length >= safeSettings.minAnswers) break;
    }
    questions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  return { questions, settings: safeSettings };
}

export function flowProgress(answeredCount: number, total: number, settings: DiscoverySettings) {
  const min = settings.minAnswers;
  if (answeredCount < min) {
    const left = min - answeredCount;
    return {
      canFinish: false,
      note: answeredCount === 0 ? `Answer ${min} to unlock your result` : `${left} more to unlock your result`
    };
  }
  const left = Math.max(0, total - answeredCount);
  return {
    canFinish: true,
    note: left > 0 ? `${left} more for a sharper result` : 'Everything answered'
  };
}

export const roleLabelFor = (role: string) =>
  ROLE_OPTIONS.find((r) => r.value === role)?.label || 'Your own path';
