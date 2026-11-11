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
  evaluateCandidateDiscoveryResult,
  analyzeStudentTaskSubmissionWithAI
} from '../server/db.js';

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
    expect(result.nextStepRecommendation).toContain('call');
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
