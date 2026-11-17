import { describe, it, expect, beforeAll } from 'vitest';
import {
  CANONICAL_QUESTIONS,
  DISCOVERY_TEST_PERSONAS,
  evaluateDiscoverySessionDeterministically
} from '../server/canonicalQuestions.js';
import {
  redactPII,
  executeThreeAgentPipeline,
  validateThreeAgentOutput,
  runOfflineBenchmarkSuite
} from '../server/aiPipeline.js';
import {
  db,
  initDatabaseAndSeed,
  evaluateLearnerEvidenceSufficiencyAndAdaptation,
  getActiveDiscoveryQuestions,
  getDiscoverySettings,
  evaluateCandidateDiscoveryResult,
  buildPersonalReview,
  analyzeStudentTaskSubmissionWithAI
} from '../server/db.js';
import { buildDiscoveryFlow } from '../src/pages/discoveryFlow.js';
import { flowProgress } from '../src/shared/discoveryFlow.js';
import {
  extractYouTubeId,
  stripTranscriptMarkup,
  buildDeterministicDraft,
  stripDashes
} from '../server/videoStudio.js';
import { buildTopicOutline } from '../server/courseStudio.js';
import { resolveAiRuntime, parseJsonLoose } from '../server/aiClient.js';

function toResponsesMap(answers: Record<string, string>): Record<string, { answerValue: string; answerText?: string }> {
  const out: Record<string, { answerValue: string; answerText?: string }> = {};
  for (const [k, v] of Object.entries(answers)) {
    out[k] = { answerValue: v, answerText: v };
  }
  return out;
}

describe('FRINS Clean-Slate Acceptance Test Suite (FRI-PROD-001 to FRI-QA-001)', () => {
  beforeAll(() => {
    initDatabaseAndSeed();
  });

  it('FRI-DISC-001: Enforces canonical 34-question Discovery bank and deterministic contradiction/pathway rules', () => {
    expect(CANONICAL_QUESTIONS.length).toBe(34);

    // Persona C: Contradictory participant -> Contradiction Detector fires
    const contradictoryEval = evaluateDiscoverySessionDeterministically(
      toResponsesMap(DISCOVERY_TEST_PERSONAS.contradictory_participant.answers)
    );
    expect(contradictoryEval.answeredCount).toBe(34);
    expect(contradictoryEval.completenessPct).toBe(100);
    expect(contradictoryEval.contradictionFlags.length).toBeGreaterThanOrEqual(2);
    expect(contradictoryEval.sufficiencyStatus).toBe('CONFLICTING');

    // Persona B: Steady investor -> NO_CONCERN_ESTABLISHED exit pathway
    const steadyEval = evaluateDiscoverySessionDeterministically(
      toResponsesMap(DISCOVERY_TEST_PERSONAS.steady_investor_no_concern.answers)
    );
    expect(steadyEval.answeredCount).toBe(34);
    expect(steadyEval.contradictionFlags.length).toBe(0);
    expect(steadyEval.noConcernEstablished).toBe(true);
    expect(steadyEval.exitPathway).toBe('NO_CONCERN_ESTABLISHED');
  });

  it('FRI-LLM-001: Redacts PII (email, phone, participant name) before constructing AI context', () => {
    const raw = 'Contact Aarav Mehta at aarav.mehta@example.com or +91 9876543210.';
    const sanitized = redactPII(raw, 'Aarav Mehta', 'aarav.mehta@example.com');
    expect(sanitized).not.toContain('aarav.mehta@example.com');
    expect(sanitized).not.toContain('9876543210');
    expect(sanitized).not.toContain('Aarav');
    expect(sanitized).toContain('[REDACTED_EMAIL]');
  });

  it('FRI-AI-001..003: Executes Three-Agent Pipeline with strict human-approval governance invariants', async () => {
    const p = DISCOVERY_TEST_PERSONAS.active_trader_friction;
    const responsesMap = toResponsesMap(p.answers);
    const evalResult = evaluateDiscoverySessionDeterministically(responsesMap);

    const output = await executeThreeAgentPipeline(
      'test_sess_01',
      p.participantName,
      p.participantEmail,
      p.track,
      responsesMap,
      evalResult
    );

    expect(output.observationalStage.observations.length).toBeGreaterThan(0);
    expect(output.decisionStage.reviewState).toBe('PENDING_GUIDE_REVIEW');
    expect(output.decisionStage.forbiddenAuthoritiesEnforced.canChangeApprovedLevelDirectly).toBe(false);
    expect(output.decisionStage.forbiddenAuthoritiesEnforced.canPublishActivePDPDirectly).toBe(false);
    expect(output.generativeStage.candidatePDPDraft.draftStatus).toBe('PENDING_GUIDE_REVIEW');
    expect(output.validatorResult.passed).toBe(true);
  });

  it('FRI-AI-004: Safety & Grounding Validator blocks prohibited financial advice, tips, and governance bypasses', async () => {
    const p = DISCOVERY_TEST_PERSONAS.active_trader_friction;
    const responsesMap = toResponsesMap(p.answers);
    const evalResult = evaluateDiscoverySessionDeterministically(responsesMap);

    const cleanOutput = await executeThreeAgentPipeline(
      'test_sess_02',
      p.participantName,
      p.participantEmail,
      p.track,
      responsesMap,
      evalResult
    );

    // Tamper with output to inject prohibited stock tip and governance bypass
    const tampered = JSON.parse(JSON.stringify(cleanOutput));
    tampered.generativeStage.guideBrief.executiveSummary =
      'Buy NIFTY calls now with target price of Rs 450 for guaranteed returns!';
    tampered.decisionStage.reviewState = 'ACTIVE_APPROVED';

    const validation = validateThreeAgentOutput(
      tampered.sanitizedPackage,
      tampered.observationalStage,
      tampered.decisionStage,
      tampered.generativeStage
    );

    expect(validation.passed).toBe(false);
    expect(validation.prohibitedAdviceCheckPassed).toBe(false);
    expect(validation.approvalGatePreserved).toBe(false);
    expect(validation.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('FRI-ML-001 & FRI-ML-002: Runs Offline Gold Benchmark Suite with 100% pass rate (6/6)', () => {
    const suite = runOfflineBenchmarkSuite();
    expect(suite.totalCases).toBe(6);
    expect(suite.passedCases).toBe(6);
    expect(suite.groundingScore).toBe(100);
    expect(suite.safetyBlockRate).toBe(100);
    expect(suite.noAdviceLeakage).toBe(true);
  });

  it('FRI-LEARN-001 & FRI-GUIDE-001: Multi-source sufficiency distinguishes reflections-only vs corroborated formal/practice evidence', () => {
    // Aarav has HIGH_FORMAL assessment + MEDIUM_PRACTICE submission + LOW_REFLECTION entry
    const aaravEval = evaluateLearnerEvidenceSufficiencyAndAdaptation('usr_learner_aarav');
    expect(aaravEval.evidenceStatus).toBe('SUFFICIENT');
    expect(aaravEval.sourceBreakdown.highFormalAssessments).toBeGreaterThanOrEqual(1);
    expect(aaravEval.sourceBreakdown.mediumPracticeArtefacts).toBeGreaterThanOrEqual(1);
    expect(aaravEval.proposedAdaptationAction).toBe('PROPOSE_PROGRESSION');

    // Priya has only LOW_REFLECTION entry -> cannot be SUFFICIENT or PROPOSE_PROGRESSION
    const priyaEval = evaluateLearnerEvidenceSufficiencyAndAdaptation('usr_learner_priya');
    expect(priyaEval.sourceBreakdown.highFormalAssessments).toBe(0);
    expect(priyaEval.sourceBreakdown.mediumPracticeArtefacts).toBe(0);
    expect(priyaEval.sourceBreakdown.lowWeightReflections).toBeGreaterThanOrEqual(1);
    expect(priyaEval.evidenceStatus).toBe('INSUFFICIENT');
    expect(priyaEval.proposedAdaptationAction).toBe('REINFORCE');
  });

  it('FRI-DISC-DYNAMIC: Supports Admin-configured N Discovery questions and generates Answer-Based Candidate Result for booking a call', () => {
    const activeQuestions = getActiveDiscoveryQuestions();
    expect(activeQuestions.length).toBeGreaterThanOrEqual(1);
    expect(activeQuestions.length).toBeLessThanOrEqual(34);

    // Answer only the active N questions (not all 34)
    const sampleAnswers: Record<string, string> = {};
    for (const q of activeQuestions) {
      if (q.options && q.options.length > 0) {
        sampleAnswers[q.id] = q.options[1]?.value || q.options[0].value;
      } else {
        sampleAnswers[q.id] = 'Building a disciplined risk and execution routine.';
      }
    }

    const result = evaluateCandidateDiscoveryResult(sampleAnswers, 'trader');
    expect(result.answeredCount).toBe(activeQuestions.length);
    expect(result.readinessScore).toBeGreaterThan(0);
    expect(result.pillarScores.length).toBeGreaterThan(0);
    expect(result.focusAreasForTeam.length).toBeGreaterThan(0);
    expect(result.strengths.length).toBeGreaterThan(0);
    // The result invites a conversation. It never reads as a course being sold.
    expect(result.nextStepRecommendation).toContain('conversation');
    expect(result.headline).not.toContain('course');
    expect(result.summary).not.toContain('course');
  });

  it('FRI-ADMIN-TASK-AI: Analyzes student uploaded Heikin-Ashi task result for Admin & Team only before Admin review', () => {
    const accurateUpload = analyzeStudentTaskSubmissionWithAI({
      taskTitle: 'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
      instructions: 'Explain Heikin-Ashi formula, show uptrend candles with no lower wicks, and mark Doji reversal.',
      expectedCriteria: 'Formula (O+H+L+C)/4, no lower shadow in uptrend, Doji reversal, synthetic price vs real LTP.',
      learnerSubmission:
        'Heikin-Ashi Close = (O+H+L+C)/4 and Open is midpoint of prior body. Marked 5 green candles with no lower wicks in strong uptrend and a Doji reversal candle. Used real market price LTP for stop execution.',
      uploadedFileName: 'NIFTY_Heikin_Ashi_Chart.svg'
    });

    expect(accurateUpload.visibility).toBe('ADMIN_AND_TEAM_ONLY');
    expect(accurateUpload.verdict).toBe('CORRECT');
    expect(accurateUpload.accuracyScore).toBeGreaterThanOrEqual(85);
    expect(accurateUpload.correctPoints.length).toBeGreaterThanOrEqual(3);

    const incompleteUpload = analyzeStudentTaskSubmissionWithAI({
      taskTitle: 'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
      instructions: 'Explain Heikin-Ashi formula, show uptrend candles with no lower wicks, and mark Doji reversal.',
      learnerSubmission: 'I uploaded a normal candlestick chart that looks green.'
    });

    expect(incompleteUpload.visibility).toBe('ADMIN_AND_TEAM_ONLY');
    expect(incompleteUpload.verdict).toBe('NEEDS_CORRECTION');
    expect(incompleteUpload.issuesOrCorrections.length).toBeGreaterThanOrEqual(2);
  });

  it('FRI-BRAND-001: Rebrands FRISMN to FRINS across backend data, seeded accounts and audit records', () => {
    const admin = db.prepare("SELECT name, email FROM users WHERE role = 'ADMIN'").get() as any;
    expect(admin.email).toBe('admin@frins.org');

    const legacyHits: string[] = [];
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as any[];
    for (const t of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${t.name}")`).all() as any[]).filter((c) =>
        /TEXT|CLOB|CHAR/i.test(c.type || '')
      );
      for (const c of cols) {
        const hit = db
          .prepare(`SELECT COUNT(*) as c FROM "${t.name}" WHERE "${c.name}" LIKE '%frismn%'`)
          .get() as any;
        if (hit.c > 0) legacyHits.push(`${t.name}.${c.name}`);
      }
    }
    expect(legacyHits).toEqual([]);
  });

  it('FRI-ADMIN-COURSE-Q: Admin-defined course questions are stored per course and available to learners', () => {
    const questions = db.prepare('SELECT * FROM course_questions').all() as any[];
    expect(questions.length).toBeGreaterThanOrEqual(4);

    const heikin = questions.filter((q) => q.course_id === 'crs_heikin_ashi_01');
    expect(heikin.length).toBeGreaterThanOrEqual(2);
    for (const q of questions) {
      const options = JSON.parse(q.options_json || '[]');
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(q.correct_option_index).toBeGreaterThanOrEqual(0);
      expect(q.correct_option_index).toBeLessThan(options.length);
    }

    const attemptsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='course_question_attempts'")
      .get();
    expect(Boolean(attemptsTable)).toBe(true);
  });

  it('FRI-ADMIN-LEADS: Website form submissions are persisted and exposed to the Admin leads inbox', () => {
    const before = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
    expect(before).toBeGreaterThan(0);

    const lead = db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 1').get() as any;
    expect(lead).toBeTruthy();
    expect(lead.name).toBeTruthy();
    expect(lead.email).toContain('@');
    expect(lead.track).toBeTruthy();
    expect(lead.status).toBeTruthy();
    expect(lead.created_at).toBeTruthy();
  });
});

/* The flow is tested against the real seeded bank, exactly as the API serves it:
   every question carries the admin-set order, audience and branching rules. */
const bankFor = () =>
  getActiveDiscoveryQuestions().map((q: any) => ({
    id: q.id,
    number: q.number,
    order: q.order,
    domain: q.domain,
    domainTitle: q.domainTitle,
    prompt: q.prompt,
    inputType: q.inputType,
    options: q.options || [],
    audience: q.audience || [],
    experience: q.experience || [],
    showIf: q.showIf || [],
    askInFlow: q.askInFlow !== false,
    isActive: true
  }));

const FLOW_SETTINGS = { minAnswers: 3, maxQuestions: 9 };

const flowFor = (role: string, answers: Record<string, string> = {}, experience = 'under_1y') =>
  buildDiscoveryFlow(bankFor(), FLOW_SETTINGS, role, experience, answers);

describe('Discovery flow adapts to the person', () => {
  it('FRI-DISC-FLOW-ROLE: role decides the path, not the order of the bank', () => {
    const beginner = flowFor('student_concepts');
    const trader = flowFor('trader');
    const investor = flowFor('investor');

    expect(beginner.questions.length).toBeGreaterThanOrEqual(3);
    expect(trader.questions.length).toBeGreaterThanOrEqual(3);

    // Everyone opens with the same orientation question, then the paths split.
    expect(beginner.questions[0].id).toBe('Q28');
    expect(trader.questions[0].id).toBe('Q28');
    expect(investor.questions[0].id).toBe('Q28');
    expect(beginner.questions[1].id).not.toBe(trader.questions[1].id);

    // A trader is asked about sizing and invalidation. A beginner is not.
    const traderIds = trader.questions.map((q) => q.id);
    expect(traderIds).toContain('Q10');
    expect(traderIds).toContain('Q14');
    const beginnerIds = beginner.questions.map((q) => q.id);
    expect(beginnerIds).not.toContain('Q14');
    expect(beginnerIds).toContain('Q23');

    // A question that is switched off never appears for anyone.
    for (const q of [...beginner.questions, ...trader.questions, ...investor.questions]) {
      expect(['Q01', 'Q03', 'Q34']).not.toContain(q.id);
    }
  });

  it('FRI-DISC-FLOW-BRANCH: later questions follow from the answers already given', () => {
    // A clean exit unlocks the question about position habits. A messy exit
    // unlocks the one about loss limits instead.
    const clean = flowFor('trader', { Q14: 'execute_exit_cleanly', Q10: 'risk_defined_formula' });
    const messy = flowFor('trader', { Q14: 'widen_or_average_down', Q10: 'conviction_feeling' });
    const cleanIds = clean.questions.map((q) => q.id);
    const messyIds = messy.questions.map((q) => q.id);

    expect(cleanIds).toContain('Q18');
    expect(cleanIds).not.toContain('Q15');
    expect(messyIds).toContain('Q15');
    expect(messyIds).not.toContain('Q18');
  });

  it('FRI-DISC-FLOW-COUNT: the admin sets how many questions appear', () => {
    expect(flowFor('trader').questions.length).toBe(9);

    const short = buildDiscoveryFlow(bankFor(), { minAnswers: 3, maxQuestions: 5 }, 'trader', 'under_1y', {});
    expect(short.questions.length).toBe(5);

    const long = buildDiscoveryFlow(bankFor(), { minAnswers: 3, maxQuestions: 14 }, 'trader', 'under_1y', {});
    expect(long.questions.length).toBe(14);
  });

  it('FRI-DISC-FLOW-EXPERIENCE: a band with no questions falls back to the full path', () => {
    const flow = flowFor('trader', {}, 'over_7y');
    expect(flow.questions.length).toBeGreaterThanOrEqual(3);
  });

  it('FRI-DISC-FLOW-MIN: the flow never runs shorter than the minimum when the bank can help', () => {
    const make = (id: string, order: number, audience: string[]) => ({
      id,
      number: order,
      order,
      domain: 'X',
      domainTitle: 'X',
      prompt: id,
      inputType: 'single_choice' as const,
      options: [{ value: 'a', label: 'A' }],
      audience,
      experience: [],
      showIf: [],
      askInFlow: true,
      active: true
    });

    const thin = [make('A', 1, []), make('B', 2, ['trader']), make('C', 3, ['student_concepts']), make('D', 4, ['student_concepts'])];

    // A trader matches two questions, so the bank pads the path to the floor.
    const trader = buildDiscoveryFlow(thin, FLOW_SETTINGS, 'trader', 'under_1y', {});
    expect(trader.questions.length).toBe(3);

    // A beginner matches three already, so nothing is padded.
    const beginner = buildDiscoveryFlow(thin, FLOW_SETTINGS, 'student_concepts', 'under_1y', {});
    expect(beginner.questions.length).toBe(3);

    expect(flowProgress(0, 3, FLOW_SETTINGS).canFinish).toBe(false);
    expect(flowProgress(3, 9, FLOW_SETTINGS).canFinish).toBe(true);
    expect(flowProgress(3, 9, { minAnswers: 5, maxQuestions: 9 }).canFinish).toBe(false);
  });

  it('FRI-DISC-FLOW-RULES: an admin edit to a question changes everyone it applies to', () => {
    const answers = { Q28: 'x' } as Record<string, string>;
    const before = buildDiscoveryFlow(bankFor(), FLOW_SETTINGS, 'investor', '1_to_3y', answers);
    expect(before.questions.map((q) => q.id)).toContain('Q25');

    // Take the question out of the investor path with the same rule fields the
    // admin form writes, and it disappears for that role only.
    const edited = bankFor().map((q) => (q.id === 'Q25' ? { ...q, audience: ['trader'] } : q));
    const after = buildDiscoveryFlow(edited, FLOW_SETTINGS, 'investor', '1_to_3y', answers);
    expect(after.questions.map((q) => q.id)).not.toContain('Q25');

    const trader = buildDiscoveryFlow(
      edited,
      { minAnswers: 3, maxQuestions: 30 },
      'trader',
      '1_to_3y',
      answers
    );
    expect(trader.questions.map((q) => q.id)).toContain('Q25');
  });

  it('FRI-DISC-COPY: copy an admin writes on an option reaches the result', () => {
    const bank = bankFor().map((q) =>
      q.id === 'Q10'
        ? {
            ...q,
            options: q.options.map((option: any) =>
              option.value === 'conviction_feeling'
                ? {
                    ...option,
                    outcome: {
                      title: 'Your size follows your mood',
                      body: 'That is the one habit we would change first.',
                      tone: 'focus'
                    }
                  }
                : option
            )
          }
        : q
    );

    const review = buildPersonalReview({ Q10: 'conviction_feeling' }, 'trader', '', [], bank);
    expect(review).toBeTruthy();
    const insight = review!.insights.find((row: any) => row.title === 'Your size follows your mood');
    expect(insight).toBeTruthy();
    expect(insight!.body).toBe('That is the one habit we would change first.');
    expect(insight!.tone).toBe('focus');
  });

  it('FRI-DISC-REVIEW: the written review changes with the answers', () => {
    const trader = buildPersonalReview(
      { Q07: 'mental_framework', Q10: 'conviction_feeling', Q03: 'under_1y' },
      'trader',
      ''
    );
    const investor = buildPersonalReview(
      { Q07: 'mental_framework', Q10: 'conviction_feeling', Q03: 'under_1y' },
      'investor',
      ''
    );

    expect(trader).toBeTruthy();
    expect(trader!.personalRead).not.toBe(investor!.personalRead);
    expect(trader!.personalRead).toContain('trade actively');
    expect(investor!.personalRead).toContain('invest for the long term');
    expect(trader!.focusAreas).toContain('A process kept in your head');
    expect(trader!.nextSteps.length).toBe(3);
  });
});

describe('Video studio', () => {
  it('FRI-VIDEO-LINK: reads every YouTube link shape an admin is likely to paste', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('')).toBeNull();
  });

  it('FRI-VIDEO-CLEAN: turns captions into readable paragraphs', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Position size is the habit that keeps you alive

00:00:04.000 --> 00:00:07.000
[Music]

00:00:07.000 --> 00:00:10.000
Position size is the habit that keeps you alive

00:00:10.000 --> 00:00:13.000
Decide the stop first, then the size follows
`;
    const cleaned = stripTranscriptMarkup(vtt);
    expect(cleaned).not.toContain('-->');
    expect(cleaned).not.toContain('[Music]');
    // The repeated caption line is only kept once.
    expect(cleaned.match(/Position size is the habit/g)?.length).toBe(1);
    expect(cleaned).toContain('Decide the stop first');
  });

  it('FRI-VIDEO-DRAFT: builds a course whose lessons and tasks come from the transcript', () => {
    const transcript = [
      'Position sizing is the first decision, not the last one.',
      'Most people choose a quantity they like and then place the stop wherever the chart looks calm.',
      'That makes the risk random from trade to trade.',
      'Decide where you are wrong first, and let the size follow from that level.',
      'After two losses in a row, halve the risk until a win comes back.',
      'Confidence is not information, so never size up because you feel sure.',
      'Keep eight fields in a written plan before the entry.',
      'Every week, split your trades into those that followed the plan and those that did not.',
      'Then compare the two lists and see which one paid.'
    ].join(' ');

    const draft = buildDeterministicDraft({
      title: 'Position sizing',
      transcript,
      track: 'trader',
      level: 'L1 to L2',
      moduleCount: 3
    });

    expect(draft.generatedBy).toBe('DETERMINISTIC');
    expect(draft.modules.length).toBe(3);
    expect(draft.modules.length).toBe(draft.tasks);
    expect(draft.modules[0].lesson).toContain('Position sizing');
    expect(draft.modules[0].task.instructions).toContain('Instrument and direction');
    // Headings never end on a dangling joining word.
    for (const m of draft.modules) {
      expect(m.title).not.toMatch(/\b(and|of|to|the|with|if)$/i);
    }
  });

  it('FRI-VIDEO-DRAFT-ROLE: the same transcript yields role-appropriate wording', () => {
    const transcript = Array.from({ length: 24 }, (_, i) =>
      `Line ${i + 1} explains how a written thesis and allocation rules keep a long term position steady.`
    ).join(' ');

    const investor = buildDeterministicDraft({
      title: 'Long term',
      transcript,
      track: 'investor',
      level: 'L2',
      moduleCount: 2
    });
    const trader = buildDeterministicDraft({
      title: 'Long term',
      transcript,
      track: 'trader',
      level: 'L2',
      moduleCount: 2
    });

    expect(investor.modules[0].lesson).toContain('build a position');
    expect(trader.modules[0].lesson).toContain('decide a trade');
  });
});

describe('A course from a topic, without a key', () => {
  it('FRI-STUDIO-AI: a fresh install runs on the free model, with no key anywhere', () => {
    const runtime = resolveAiRuntime();
    expect(runtime.available).toBe(true);
    expect(runtime.provider).toBe('FREE');
    expect(runtime.free).toBe(true);
    expect(runtime.key).toBe('');
    expect(runtime.baseUrl).toContain('pollinations');
  });

  it('FRI-STUDIO-TOPIC: a topic always yields a course with a lesson and a task per module', () => {
    const draft = buildTopicOutline({
      topic: 'Position sizing from the stop, not from lot size',
      brief: 'One worked example. Halve the risk after two losses.',
      track: 'trader',
      level: 'L1 to L2',
      moduleCount: 3
    });

    expect(draft.modules.length).toBe(3);
    expect(draft.tasks).toBe(3);
    expect(draft.basis).toBe('TOPIC');
    expect(draft.generatedBy).toBe('DETERMINISTIC');

    for (const module of draft.modules) {
      expect(module.title.length).toBeGreaterThan(3);
      expect(module.lesson.length).toBeGreaterThan(40);
      expect(module.task.title.length).toBeGreaterThan(3);
      expect(module.task.instructions.length).toBeGreaterThan(20);
      expect(module.task.dueDays).toBeGreaterThan(0);
      // House style: no en or em dashes anywhere a learner reads.
      expect(module.title).not.toMatch(/[\u2013\u2014]/);
      expect(module.lesson).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('FRI-STUDIO-CLEAN: model text is cleaned and fenced JSON still parses', () => {
    expect(stripDashes('Size from the stop \u2014 not the lot')).toBe('Size from the stop, not the lot');
    expect(stripDashes('Half\u2011formed rule')).toBe('Half-formed rule');

    const fenced = '```json\n{"title":"A course","modules":[{"title":"One"}]}\n```';
    const parsed = parseJsonLoose<{ title: string; modules: any[] }>(fenced);
    expect(parsed?.title).toBe('A course');
    expect(parsed?.modules.length).toBe(1);

    const chatty = 'Here is the course you asked for.\n{"title":"Chatty"}\nThat is all.';
    expect(parseJsonLoose<any>(chatty)?.title).toBe('Chatty');
    expect(parseJsonLoose<any>('no json at all')).toBeNull();
  });

  it('FRI-STUDIO-RULE: a copy of a course keeps one lesson and one task per module', () => {
    const draft = buildTopicOutline({
      topic: 'Reading a balance sheet before the first position',
      track: 'investor',
      level: 'L1 · Foundations',
      moduleCount: 2
    });

    const shape = draft.modules.map((m) => ({
      lesson: m.lesson.length > 0,
      task: Boolean(m.task.title && m.task.instructions)
    }));
    expect(shape).toEqual([
      { lesson: true, task: true },
      { lesson: true, task: true }
    ]);
  });
});
