/* ---------------------------------------------------------------------------
   The Discovery flow.

   The question bank holds the full catalogue. This file decides which of those
   questions a given person actually sees: the order is chosen by their role,
   and later questions are gated on what they answered earlier. Everyone
   answers at least three; the rest follow from those answers.
   --------------------------------------------------------------------------- */

export interface FlowQuestion {
  id: string;
  number: number;
  domain: string;
  domainTitle: string;
  prompt: string;
  inputType: 'single_choice' | 'text';
  options?: Array<{ value: string; label: string }>;
}

export type Role = 'beginner' | 'strategy' | 'trader' | 'investor' | 'mixed' | 'other';

export type Answers = Record<string, string>;

interface FlowStep {
  id: string;
  /** Shown under the question, so the question never feels arbitrary. */
  why: string;
  /** Only asked when the earlier answers make it relevant. */
  when?: (answers: Answers) => boolean;
}

export const MINIMUM_ANSWERS = 3;

export const roleFromTrack = (track: string): Role => {
  switch (track) {
    case 'student_concepts':
      return 'beginner';
    case 'strategy_learner':
      return 'strategy';
    case 'trader':
      return 'trader';
    case 'investor':
      return 'investor';
    case 'both':
      return 'mixed';
    default:
      return 'other';
  }
};

export const roleLabel = (role: Role): string => {
  switch (role) {
    case 'beginner':
      return 'Starting from the basics';
    case 'strategy':
      return 'Building a strategy';
    case 'trader':
      return 'Trading actively';
    case 'investor':
      return 'Investing for the long term';
    case 'mixed':
      return 'Trading and investing';
    default:
      return 'Your own path';
  }
};

const answered = (answers: Answers, id: string) => String(answers[id] || '').trim().length > 0;

/* ------------------------------------------------------------------ flows */

const BEGINNER: FlowStep[] = [
  {
    id: 'Q02',
    why: 'It tells us which market to use in your first examples.'
  },
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q31',
    why: 'This is where we start, before any module is written.'
  },
  {
    id: 'Q30',
    why: 'Your plan has to fit the hours you really have.'
  },
  {
    id: 'Q23',
    why: 'Beginners are usually told to watch charts, not themselves.'
  },
  {
    id: 'Q22',
    why: 'It decides whether we start you with a simple journal.'
  },
  {
    id: 'Q27',
    why: 'You do not need an answer here. We just want to see where you are.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  },
  {
    id: 'Q33',
    why: 'Optional, in your own words. Skip it if you would rather not.'
  }
];

const STRATEGY: FlowStep[] = [
  {
    id: 'Q07',
    why: 'A strategy is only as good as the process around it.'
  },
  {
    id: 'Q12',
    why: 'Switching setups too often hides whether one of them works.'
  },
  {
    id: 'Q08',
    why: 'Written reasons are the difference between a plan and an impulse.'
  },
  {
    id: 'Q11',
    why: 'Exits are where most strategies quietly break.',
    when: (a) => answered(a, 'Q08') && a.Q08 !== 'always_pre_recorded'
  },
  {
    id: 'Q27',
    why: 'If you cannot say the edge in three sentences, the plan is still fuzzy.',
    when: (a) => a.Q12 === 'still_building_first' || a.Q07 === 'no_fixed_process'
  },
  {
    id: 'Q13',
    why: 'A strategy improves through review, not through more videos.'
  },
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q30',
    why: 'Testing and reviewing takes hours. We plan around yours.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  }
];

const TRADER: FlowStep[] = [
  {
    id: 'Q07',
    why: 'This is the first thing we look at with a trader.'
  },
  {
    id: 'Q10',
    why: 'Position size decides how long you survive a bad run.'
  },
  {
    id: 'Q14',
    why: 'What you do at invalidation is the habit that costs or saves money.'
  },
  {
    id: 'Q15',
    why: 'A limit only works if it is fixed before the trade.',
    when: (a) => answered(a, 'Q10') && a.Q10 !== 'risk_defined_formula'
  },
  {
    id: 'Q16',
    why: 'The run after a loss is where process usually disappears.',
    when: (a) => answered(a, 'Q14') && a.Q14 !== 'execute_exit_cleanly'
  },
  {
    id: 'Q18',
    why: 'Fast markets expose the routines that are only written down.',
    when: (a) => a.Q14 === 'execute_exit_cleanly'
  },
  {
    id: 'Q13',
    why: 'P&L tells you what happened. Review tells you why.'
  },
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q30',
    why: 'Preparation and review take time. We plan around yours.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  }
];

const INVESTOR: FlowStep[] = [
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q08',
    why: 'A position you cannot explain is a position you cannot hold.'
  },
  {
    id: 'Q09',
    why: 'Noise is the main reason good theses get abandoned early.',
    when: (a) => answered(a, 'Q08')
  },
  {
    id: 'Q27',
    why: 'We want to hear the thesis in your own words, not a borrowed one.',
    when: (a) => a.Q08 === 'rarely_defined' || a.Q08 === 'mental_note_only'
  },
  {
    id: 'Q10',
    why: 'Allocation is where conviction meets discipline.'
  },
  {
    id: 'Q16',
    why: 'Drawdowns test the plan more than rallies do.'
  },
  {
    id: 'Q13',
    why: 'Long-term holding still needs a review rhythm.'
  },
  {
    id: 'Q22',
    why: 'It decides what records we set up with you first.'
  },
  {
    id: 'Q30',
    why: 'Research and review take time. We plan around yours.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  }
];

const MIXED: FlowStep[] = [
  {
    id: 'Q05',
    why: 'Mixing books is the most common source of losses.'
  },
  {
    id: 'Q07',
    why: 'Both books still run on one decision process.'
  },
  {
    id: 'Q10',
    why: 'Position size decides how long you survive a bad run.'
  },
  {
    id: 'Q14',
    why: 'What you do at invalidation is the habit that costs or saves money.'
  },
  {
    id: 'Q13',
    why: 'Two books need one review, or neither improves.'
  },
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q30',
    why: 'We plan the week around the hours you really have.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  }
];

const OTHER: FlowStep[] = [
  {
    id: 'Q28',
    why: 'So the course aims at what you actually want.'
  },
  {
    id: 'Q31',
    why: 'This is where we start, before any module is written.'
  },
  {
    id: 'Q07',
    why: 'It tells us how much structure to build in from the start.'
  },
  {
    id: 'Q13',
    why: 'Review is the habit every course here begins with.'
  },
  {
    id: 'Q30',
    why: 'We plan the week around the hours you really have.'
  },
  {
    id: 'Q29',
    why: 'It sets how direct your mentor should be with you.'
  }
];

const FLOWS: Record<Role, FlowStep[]> = {
  beginner: BEGINNER,
  strategy: STRATEGY,
  trader: TRADER,
  investor: INVESTOR,
  mixed: MIXED,
  other: OTHER
};

/* --------------------------------------------------------------- resolve */

export interface ResolvedFlow {
  questions: Array<FlowQuestion & { why: string }>;
  /** Questions left in this person's path. */
  length: number;
}

/**
 * Questions already answered always stay in the path, even if a changed
 * answer would no longer have unlocked them. Nobody loses a question they
 * have already given us an answer to.
 */
export function buildDiscoveryFlow(
  bank: FlowQuestion[],
  track: string,
  answers: Answers
): ResolvedFlow {
  const role = roleFromTrack(track);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const steps = FLOWS[role];
  const used = new Set<string>();

  const questions: Array<FlowQuestion & { why: string }> = [];
  for (const step of steps) {
    const question = byId.get(step.id);
    if (!question) continue;
    const passed = !step.when || step.when(answers);
    if (!passed && !answered(answers, step.id)) continue;
    questions.push({ ...question, why: step.why });
    used.add(step.id);
  }

  /* If the admin has swapped the bank out, make sure the path never runs
     short: fill with whatever else is active, in bank order. */
  if (questions.length < MINIMUM_ANSWERS) {
    for (const question of bank) {
      if (used.has(question.id)) continue;
      questions.push({
        ...question,
        why: 'A short question so we can place you properly.'
      });
      used.add(question.id);
      if (questions.length >= MINIMUM_ANSWERS + 2) break;
    }
  }

  return { questions, length: questions.length };
}

/** Where the person is, in words. */
export function flowProgress(answeredCount: number, total: number) {
  if (answeredCount < MINIMUM_ANSWERS) {
    const left = MINIMUM_ANSWERS - answeredCount;
    return {
      canFinish: false,
      note: `${left} more to unlock your result`
    };
  }
  const left = Math.max(0, total - answeredCount);
  return {
    canFinish: true,
    note: left > 0 ? `${left} more for a sharper result` : 'Everything answered'
  };
}
