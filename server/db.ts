import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_QUESTIONS,
  DISCOVERY_TEST_PERSONAS,
  evaluateDiscoverySessionDeterministically,
  QUESTION_BANK_VERSION
} from './canonicalQuestions.js';
import {
  buildSanitizedEvidencePackage,
  runDecisionAgentGoverned,
  runGenerativeAgentTemplate,
  runObservationalAgentDeterministic,
  runOfflineBenchmarkSuite,
  validateThreeAgentOutput
} from './aiPipeline.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'frins.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = 'frins_static_salt_v1';
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

export function verifyPassword(password: string, storedHash: string): boolean {
  return hashPassword(password) === storedHash;
}

export function writeAuditEvent(params: {
  correlationId?: string;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
}) {
  const id = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const correlationId = params.correlationId || `cor_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(
    `INSERT INTO audit_events (
      id, correlation_id, actor_user_id, actor_role, action, entity_type, entity_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    correlationId,
    params.actorUserId,
    params.actorRole,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.details),
    new Date().toISOString()
  );
  return { id, correlationId };
}

/**
 * Multi-Source Evidence Sufficiency & Adaptation Evaluator (Requirement 8.26 & Section 11)
 * Distinguishes HIGH_FORMAL assessments, MEDIUM_PRACTICE artefacts, and LOW_REFLECTION journal logs.
 * Never treats casual reflections as equal weight to formal assessments.
 */
export function evaluateLearnerEvidenceSufficiencyAndAdaptation(learnerId: string) {
  const profile = db
    .prepare('SELECT * FROM student_learning_profiles WHERE learner_id = ?')
    .get(learnerId) as any;

  const evidenceItems = db
    .prepare('SELECT * FROM evidence_items WHERE learner_id = ? ORDER BY created_at DESC')
    .all(learnerId) as any[];

  const assessments = db
    .prepare('SELECT * FROM assessments WHERE learner_id = ? ORDER BY created_at DESC')
    .all(learnerId) as any[];

  const reflections = db
    .prepare('SELECT * FROM reflections WHERE learner_id = ? ORDER BY created_at DESC')
    .all(learnerId) as any[];

  const tasks = db
    .prepare('SELECT * FROM learning_tasks WHERE learner_id = ?')
    .all(learnerId) as any[];

  const formalCount = evidenceItems.filter((e) => e.sufficiency_weight === 'HIGH_FORMAL').length;
  const practiceCount = evidenceItems.filter((e) => e.sufficiency_weight === 'MEDIUM_PRACTICE').length;
  const reflectionCount = evidenceItems.filter((e) => e.sufficiency_weight === 'LOW_REFLECTION').length;
  const conflictingCount =
    evidenceItems.filter((e) => e.verification_status === 'CONFLICTING').length +
    assessments.filter((a) => a.evidence_status === 'CONFLICTING').length;
  const ruleBreachReflections = reflections.filter((r) => r.process_adherence === 'RULE_BREACH').length;
  const submittedOrReviewedTasks = tasks.filter(
    (t) => t.status === 'SUBMITTED' || t.status === 'REVIEWED'
  ).length;

  let evidenceStatus: 'SUFFICIENT' | 'INSUFFICIENT' | 'CONFLICTING' | 'REVIEW_REQUIRED' = 'INSUFFICIENT';
  let proposedAdaptationAction:
    | 'CONTINUE'
    | 'REINFORCE'
    | 'CLARIFY'
    | 'REASSESS'
    | 'PROPOSE_PROGRESSION'
    | 'PROPOSE_REVISION'
    | 'PAUSE_FOR_GUIDE' = 'CONTINUE';
  let rationale = '';
  let uncertaintyNote = '';

  if (conflictingCount > 0 || (formalCount > 0 && ruleBreachReflections >= 2)) {
    evidenceStatus = 'CONFLICTING';
    proposedAdaptationAction = 'CLARIFY';
    rationale =
      'Conflicting evidence detected between formal/practice records and recent session rule breaches. Guide review and clarification required before any progression.';
    uncertaintyNote =
      'HIGH UNCERTAINTY: Divergent signals across evidence sources require human Guide interpretation.';
  } else if (formalCount === 0 && practiceCount === 0 && reflectionCount > 0) {
    // Requirement 11: Casual reflections alone cannot establish sufficiency for progression!
    evidenceStatus = 'INSUFFICIENT';
    proposedAdaptationAction = 'REINFORCE';
    rationale = `Learner has ${reflectionCount} reflection/self-report record(s) (LOW_REFLECTION weight) but 0 verified practice artefacts (MEDIUM_PRACTICE) and 0 formal Guide assessments (HIGH_FORMAL). Per FRINS Rubric v1.2.0, self-reflections do not carry equal weight to formal assessments.`;
    uncertaintyNote =
      'MODERATE-HIGH UNCERTAINTY: Single-source self-report evidence only; corroborate with deliberate practice and formal scenario evaluation.';
  } else if (formalCount >= 1 && practiceCount >= 1 && submittedOrReviewedTasks >= 2 && ruleBreachReflections === 0) {
    evidenceStatus = 'SUFFICIENT';
    const currentLvl = profile?.approved_level || 'L1';
    if (currentLvl === 'L1' || currentLvl === 'L2') {
      proposedAdaptationAction = 'PROPOSE_PROGRESSION';
      rationale = `Multi-source evidence is SUFFICIENT (${formalCount} HIGH_FORMAL assessment, ${practiceCount} MEDIUM_PRACTICE artefact(s), ${reflectionCount} reflection log(s)) with consistent process adherence. Candidate for Guide-reviewed progression or PDP advancement.`;
    } else {
      proposedAdaptationAction = 'CONTINUE';
      rationale =
        'Multi-source evidence confirms sustained independent application across formal, practice, and reflection sources.';
    }
    uncertaintyNote =
      'LOW UNCERTAINTY: Corroborated across formal Guide assessment, deliberate practice submission, and structured reflection.';
  } else if (practiceCount >= 1 && formalCount === 0) {
    evidenceStatus = 'REVIEW_REQUIRED';
    proposedAdaptationAction = 'REASSESS';
    rationale = `Learner has submitted ${practiceCount} practice artefact(s) and ${reflectionCount} reflection(s), but lacks a formal Guide scenario/process assessment (HIGH_FORMAL) for the target competency.`;
    uncertaintyNote =
      'MODERATE UNCERTAINTY: Practice artefacts are encouraging; formal Guide evaluation needed to verify competency criteria.';
  } else {
    evidenceStatus = 'INSUFFICIENT';
    proposedAdaptationAction = 'PAUSE_FOR_GUIDE';
    rationale = 'Insufficient multi-source evidence collected so far. Continue initial Discovery/Guide conversation and baseline tasks.';
    uncertaintyNote = 'HIGH UNCERTAINTY: Baseline evidence collection still in progress.';
  }

  return {
    learnerId,
    currentApprovedLevel: profile?.approved_level || 'L1',
    rubricVersion: profile?.rubric_version || '1.2.0',
    evidenceStatus,
    sourceBreakdown: {
      highFormalAssessments: formalCount,
      mediumPracticeArtefacts: practiceCount,
      lowWeightReflections: reflectionCount
    },
    proposedAdaptationAction,
    reviewState: 'PENDING_GUIDE_REVIEW',
    rationale,
    uncertaintyNote
  };
}

export function getActiveDiscoveryQuestions() {
  const rows = db
    .prepare('SELECT * FROM discovery_questions WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all() as any[];

  return rows.map((r, idx) => ({
    id: r.id,
    number: idx + 1,
    sortOrder: r.sort_order,
    domain: r.domain,
    domainTitle: r.domain_title,
    prompt: r.prompt,
    inputType: r.input_type as 'single_choice' | 'text',
    options: JSON.parse(r.options_json || '[]'),
    required: true,
    isActive: Boolean(r.is_active)
  }));
}

export function getAllDiscoveryQuestions() {
  const rows = db
    .prepare('SELECT * FROM discovery_questions ORDER BY sort_order ASC, id ASC')
    .all() as any[];

  return rows.map((r, idx) => ({
    id: r.id,
    number: idx + 1,
    sortOrder: r.sort_order,
    domain: r.domain,
    domainTitle: r.domain_title,
    prompt: r.prompt,
    inputType: r.input_type as 'single_choice' | 'text',
    options: JSON.parse(r.options_json || '[]'),
    required: true,
    isActive: Boolean(r.is_active)
  }));
}

/**
 * Generates an immediate, answer-based Discovery Result for any N active questions
 * so the candidate can see their score breakdown, strengths, focus areas, and book a call.
 */
export function evaluateCandidateDiscoveryResult(
  answersMap: Record<string, string>,
  track: string = 'trader',
  customTrack: string = ''
) {
  const activeQuestions = getActiveDiscoveryQuestions();
  const totalActive = Math.max(1, activeQuestions.length);

  let answeredCount = 0;
  let scoreSum = 0;
  const domainScores: Record<string, { title: string; sum: number; count: number }> = {};
  const strengths: string[] = [];
  const focusAreasForTeam: string[] = [];
  const answerHighlights: Array<{ questionId: string; prompt: string; answerLabel: string; signal: 'STRONG' | 'DEVELOPING' | 'FOCUS_NEEDED' }> = [];

  for (const q of activeQuestions) {
    const rawVal = String(answersMap[q.id] || '').trim();
    if (!rawVal) continue;
    answeredCount++;

    if (!domainScores[q.domain]) {
      domainScores[q.domain] = { title: q.domainTitle, sum: 0, count: 0 };
    }

    let itemScore = 70;
    let answerLabel = rawVal;
    let signal: 'STRONG' | 'DEVELOPING' | 'FOCUS_NEEDED' = 'DEVELOPING';

    if (q.inputType === 'single_choice' && Array.isArray(q.options) && q.options.length > 0) {
      const optIdx = q.options.findIndex((o: any) => o.value === rawVal);
      if (optIdx >= 0) {
        answerLabel = q.options[optIdx].label;
      }
      // Score heuristics based on option semantics or position
      const valLower = rawVal.toLowerCase();
      if (
        valLower.includes('written_and_followed') ||
        valLower.includes('structured_off_market') ||
        valLower.includes('always_pre') ||
        valLower.includes('execute_exit_cleanly') ||
        valLower.includes('strict_non_negotiable') ||
        valLower.includes('process_unchanged') ||
        valLower.includes('comprehensive_journal') ||
        valLower.includes('risk_defined_formula') ||
        valLower.includes('8_to_10_planned') ||
        valLower.includes('strictly_separated')
      ) {
        itemScore = 90;
        signal = 'STRONG';
      } else if (
        valLower.includes('hesitate') ||
        valLower.includes('widen') ||
        valLower.includes('urge_to_recover') ||
        valLower.includes('impulsive') ||
        valLower.includes('no_formal') ||
        valLower.includes('during_live_hours') ||
        valLower.includes('mental_notes') ||
        valLower.includes('0_to_1') ||
        valLower.includes('2_to_4') ||
        valLower.includes('often_stretched')
      ) {
        itemScore = 46;
        signal = 'FOCUS_NEEDED';
      } else {
        itemScore = 72;
        signal = 'DEVELOPING';
      }
    } else {
      itemScore = rawVal.length > 25 ? 82 : 68;
      signal = rawVal.length > 25 ? 'STRONG' : 'DEVELOPING';
    }

    scoreSum += itemScore;
    domainScores[q.domain].sum += itemScore;
    domainScores[q.domain].count += 1;

    answerHighlights.push({
      questionId: q.id,
      prompt: q.prompt,
      answerLabel,
      signal
    });

    if (signal === 'STRONG' && strengths.length < 3) {
      strengths.push(`${q.domainTitle}: "${answerLabel}"`);
    } else if (signal === 'FOCUS_NEEDED' && focusAreasForTeam.length < 4) {
      focusAreasForTeam.push(`${q.domainTitle}: Address "${answerLabel}" with a structured pre-decision rule`);
    }
  }

  const overallScore = answeredCount > 0 ? Math.round(scoreSum / answeredCount) : 65;

  if (strengths.length === 0) {
    strengths.push(
      'Honest self-awareness about current market habits and willingness to build a structured process.'
    );
  }
  if (focusAreasForTeam.length === 0) {
    focusAreasForTeam.push(
      track === 'other'
        ? `Building a course around what you described: ${customTrack || 'your own focus area'}.`
        : track === 'student_concepts'
        ? 'Building a clear conceptual foundation of market structure, order flow, and risk principles from scratch.'
        : track === 'strategy_learner'
          ? 'Structuring, testing, and understanding market strategy rules, edge conditions, and invalidation criteria.'
          : track === 'investor'
            ? 'Formalising a written pre-investment thesis and quarterly review cadence with your Guide.'
            : 'Establishing a written pre-session checklist and strict invalidation execution routine.'
    );
  }

  const pillars = Object.entries(domainScores).map(([key, d]) => {
    const score = Math.round(d.sum / Math.max(1, d.count));
    const status: 'STRONG' | 'DEVELOPING' | 'PRIORITY_FOCUS' =
      score >= 76 ? 'STRONG' : score >= 56 ? 'DEVELOPING' : 'PRIORITY_FOCUS';
    return {
      domain: key,
      title: d.title,
      scorePct: score,
      score,
      status
    };
  });

  const recommendedLevel =
    overallScore >= 82 ? 'L3 · Independent Process' : overallScore >= 65 ? 'L2 · Guided Application' : 'L1 · Foundational Structure';

  const trackLabelMap: Record<string, string> = {
    student_concepts: 'Custom Market Concepts & Foundations Course',
    strategy_learner: 'Custom Strategy Understanding & Design Course',
    trader: 'Custom Active Trading Execution & Risk Course',
    investor: 'Custom Long-Term Investing & Thesis Course',
    both: 'Custom All-Round Market & Strategy Course',
    other: customTrack ? `Custom Course: ${customTrack}` : 'Custom Course (self-described focus)'
  };

  const recommendedProgram =
    trackLabelMap[track] ||
    (overallScore < 60
      ? `Custom ${track === 'investor' ? 'Thesis & Allocation' : 'Concepts, Strategy & Execution'} Course`
      : `Tailored ${track === 'investor' ? 'Portfolio Decision' : 'Strategy & Composure'} Course`);

  const readinessLabel =
    overallScore >= 76
      ? 'Strong Process Foundation'
      : overallScore >= 56
        ? 'Developing Market & Strategy Structure'
        : 'Foundational & Custom Course Focus';

  const headline =
    overallScore >= 76
      ? 'Your answers show a strong baseline. Our team will build an advanced course around your goals.'
      : overallScore >= 56
        ? 'You have a good foundation. Our team will build a course around your strategy and the gaps we find.'
        : 'Your answers give our team a clear blueprint to build your custom step-by-step course from the ground up.';

  const summary = `Based on your ${answeredCount} Discovery responses, our team has mapped what you already understand and the exact concepts, strategy modules, and habits we will custom-build into your personal course.`;

  const nextStepRecommendation =
    'Book a 1-on-1 call with our team below so we can review your result together and design your custom learning curriculum (never a generic one-size-fits-all course).';

  return {
    totalConfiguredQuestions: totalActive,
    answeredCount,
    completenessPct: Math.min(100, Math.round((answeredCount / totalActive) * 100)),
    overallReadinessScore: overallScore,
    readinessScore: overallScore,
    readinessLabel,
    recommendedLevel,
    recommendedStartingLevel: recommendedLevel,
    recommendedProgram,
    recommendedTrack: recommendedProgram,
    headline,
    summary,
    pillars,
    pillarScores: pillars,
    strengths,
    focusAreasForTeam,
    answerHighlights,
    nextStepRecommendation
  };
}

/**
 * Internal AI Task Pre-Reviewer (strictly for Admin & Team use, never shown to students)
 * Analyzes a student's uploaded task result against the task prompt & expected criteria
 * before the Admin reviews it (e.g., checking if a student's Heikin-Ashi analysis is correct or not).
 */
export function analyzeStudentTaskSubmissionWithAI(params: {
  taskTitle: string;
  instructions: string;
  expectedCriteria?: string;
  learnerSubmission: string;
  uploadedFileName?: string;
}) {
  const titleLower = (params.taskTitle || '').toLowerCase();
  const subLower = (params.learnerSubmission || '').toLowerCase();
  const criteriaLower = (params.expectedCriteria || '').toLowerCase();
  const now = new Date().toISOString();

  const isHeikinAshiTask =
    titleLower.includes('heikin') ||
    params.instructions.toLowerCase().includes('heikin') ||
    criteriaLower.includes('heikin');

  if (isHeikinAshiTask) {
    const mentionsAverageClose =
      subLower.includes('(o+h+l+c)/4') ||
      subLower.includes('average') ||
      subLower.includes('four prices') ||
      subLower.includes('open + high + low + close');
    const mentionsNoLowerWick =
      subLower.includes('no lower wick') ||
      subLower.includes('no lower shadow') ||
      subLower.includes('without lower') ||
      subLower.includes('flat bottom');
    const mentionsDojiReversal =
      subLower.includes('doji') ||
      subLower.includes('indecision') ||
      subLower.includes('exhaustion') ||
      subLower.includes('both shadows') ||
      subLower.includes('reversal');
    const mentionsSyntheticPriceCaution =
      subLower.includes('synthetic') ||
      subLower.includes('actual price') ||
      subLower.includes('real market price') ||
      subLower.includes('ltp');

    const correctPoints: string[] = [];
    const issuesOrCorrections: string[] = [];
    let score = 45;

    if (mentionsAverageClose) {
      score += 18;
      correctPoints.push(
        'Correctly identified the Heikin-Ashi averaged formula: HA Close = (Open + High + Low + Close) / 4 and midpoint HA Open.'
      );
    } else {
      issuesOrCorrections.push(
        'Missing or unclear explanation of the Heikin-Ashi calculation formula ((O+H+L+C)/4 and midpoint of prior HA body).'
      );
    }

    if (mentionsNoLowerWick) {
      score += 18;
      correctPoints.push(
        'Correctly identified that strong Heikin-Ashi uptrend candles have consecutive green bodies with no lower shadows/wicks.'
      );
    } else {
      issuesOrCorrections.push(
        'Did not clearly state the key Heikin-Ashi trend rule: strong bullish continuation candles lack lower wicks (and strong bearish candles lack upper wicks).'
      );
    }

    if (mentionsDojiReversal) {
      score += 12;
      correctPoints.push(
        'Correctly spotted small-bodied Heikin-Ashi Doji / dual-shadow candles as trend pause or reversal signals.'
      );
    } else {
      issuesOrCorrections.push(
        'Did not highlight how small bodies with upper and lower shadows (Heikin-Ashi Doji) signal momentum exhaustion.'
      );
    }

    if (mentionsSyntheticPriceCaution) {
      score += 7;
      correctPoints.push(
        'Correctly distinguished synthetic Heikin-Ashi values from actual traded market prices (LTP) for order execution.'
      );
    } else {
      issuesOrCorrections.push(
        'Important check for Admin: Student did not mention that Heikin-Ashi prices are averaged/synthetic. Check that they do not place real stop-loss orders at HA close levels instead of real market prices.'
      );
    }

    if (params.uploadedFileName) {
      correctPoints.push(`Uploaded visual chart/artifact ("${params.uploadedFileName}") attached for visual inspection.`);
    }

    const accuracyScore = Math.min(98, Math.max(30, score));
    const verdict: 'CORRECT' | 'PARTIALLY_CORRECT' | 'NEEDS_CORRECTION' =
      accuracyScore >= 82
        ? 'CORRECT'
        : accuracyScore >= 60
          ? 'PARTIALLY_CORRECT'
          : 'NEEDS_CORRECTION';

    return {
      visibility: 'ADMIN_AND_TEAM_ONLY',
      verdict,
      accuracyScore,
      isCorrectSummary:
        verdict === 'CORRECT'
          ? `AI Analysis: Student's Heikin-Ashi result is CORRECT (${accuracyScore}% match). Core formula, wickless trend continuation, and reversal structure are accurately identified.`
          : verdict === 'PARTIALLY_CORRECT'
            ? `AI Analysis: Student's Heikin-Ashi submission is PARTIALLY CORRECT (${accuracyScore}% match). Some core Heikin-Ashi concepts are present, but key details need mentor clarification.`
            : `AI Analysis: Student's Heikin-Ashi submission NEEDS CORRECTION (${accuracyScore}% match). Key Heikin-Ashi rules (formula, wickless trend bodies, or reversal signals) are missing or inaccurate.`,
      correctPoints,
      issuesOrCorrections,
      suggestedAdminFeedback:
        verdict === 'CORRECT'
          ? 'Excellent work on your Heikin-Ashi chart analysis! You accurately identified the averaged candle formula, the wickless uptrend continuation bars, and the Doji exhaustion signal. Always remember to execute stops using actual market price rather than synthetic HA close levels.'
          : 'Good effort uploading your Heikin-Ashi result. Before we mark this complete, please review: (1) how HA Open and Close are averaged, (2) why strong uptrend HA candles have no lower wicks, and (3) how HA Doji candles signal trend exhaustion.',
      analyzedAt: now
    };
  }

  // General Market Concept / Strategy / Risk Task AI Analysis
  const wordCount = params.learnerSubmission.trim().split(/\s+/).filter(Boolean).length;
  const expectedKeywords = (params.expectedCriteria || params.instructions)
    .toLowerCase()
    .split(/[,.;\s]+/)
    .filter((w) => w.length >= 5);
  const uniqueExpected = Array.from(new Set(expectedKeywords)).slice(0, 10);
  const matchedKeywords = uniqueExpected.filter((kw) => subLower.includes(kw));

  const keywordRatio = uniqueExpected.length > 0 ? matchedKeywords.length / uniqueExpected.length : 0.7;
  const lengthScore = wordCount >= 35 ? 35 : wordCount >= 15 ? 25 : 12;
  const accuracyScore = Math.min(96, Math.round(45 + keywordRatio * 30 + (lengthScore - 15)));

  const verdict: 'CORRECT' | 'PARTIALLY_CORRECT' | 'NEEDS_CORRECTION' =
    accuracyScore >= 80
      ? 'CORRECT'
      : accuracyScore >= 60
        ? 'PARTIALLY_CORRECT'
        : 'NEEDS_CORRECTION';

  const correctPoints: string[] = [
    `Student submitted a ${wordCount}-word structured response${params.uploadedFileName ? ` with uploaded file "${params.uploadedFileName}"` : ''}.`
  ];
  if (matchedKeywords.length > 0) {
    correctPoints.push(`Addressed key task concepts: ${matchedKeywords.slice(0, 6).join(', ')}.`);
  }

  const issuesOrCorrections: string[] = [];
  if (wordCount < 20) {
    issuesOrCorrections.push('Submission is very brief. Ask the student to explain their step-by-step reasoning and invalidation criteria.');
  }
  const missedKeywords = uniqueExpected.filter((kw) => !subLower.includes(kw)).slice(0, 4);
  if (missedKeywords.length > 0) {
    issuesOrCorrections.push(`Did not explicitly cover: ${missedKeywords.join(', ')}.`);
  }
  if (issuesOrCorrections.length === 0) {
    issuesOrCorrections.push('No major conceptual errors detected; verify chart markings during 1-on-1 review.');
  }

  return {
    visibility: 'ADMIN_AND_TEAM_ONLY',
    verdict,
    accuracyScore,
    isCorrectSummary:
      verdict === 'CORRECT'
        ? `AI Analysis: Submission is CORRECT (${accuracyScore}% alignment with task criteria).`
        : verdict === 'PARTIALLY_CORRECT'
          ? `AI Analysis: Submission is PARTIALLY CORRECT (${accuracyScore}% alignment). Review missing criteria below.`
          : `AI Analysis: Submission NEEDS CORRECTION (${accuracyScore}% alignment). Student missed core concepts.`,
    correctPoints,
    issuesOrCorrections,
    suggestedAdminFeedback:
      verdict === 'CORRECT'
        ? 'Well structured submission! You covered the core concepts clearly and demonstrated sound process reasoning.'
        : 'Thank you for uploading your result. Let us refine a few missing points in chat before approving this task.',
    analyzedAt: now
  };
}

export function initDatabaseAndSeed() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER')),
      account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED')),
      track TEXT NOT NULL DEFAULT 'trader',
      assigned_guide_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      consent_version TEXT NOT NULL,
      wording_snapshot TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      track TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW',
      notes TEXT,
      assigned_guide_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovery_sessions (
      id TEXT PRIMARY KEY,
      participant_user_id TEXT,
      participant_name TEXT NOT NULL,
      participant_email TEXT NOT NULL,
      track TEXT NOT NULL,
      question_bank_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      completeness_pct INTEGER NOT NULL DEFAULT 0,
      sufficiency_status TEXT NOT NULL DEFAULT 'INSUFFICIENT',
      exit_pathway TEXT NOT NULL DEFAULT 'PENDING',
      contradiction_flags_json TEXT NOT NULL DEFAULT '[]',
      domain_summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovery_responses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      answer_value TEXT NOT NULL,
      answer_text TEXT,
      answered_at TEXT NOT NULL,
      UNIQUE(session_id, question_id),
      FOREIGN KEY (session_id) REFERENCES discovery_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discovery_questions (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 1,
      domain TEXT NOT NULL DEFAULT 'DECISION_PROCESS',
      domain_title TEXT NOT NULL DEFAULT 'Decision Process',
      prompt TEXT NOT NULL,
      input_type TEXT NOT NULL DEFAULT 'single_choice' CHECK (input_type IN ('single_choice', 'text')),
      options_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_bookings (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      participant_name TEXT NOT NULL,
      participant_email TEXT NOT NULL,
      participant_phone TEXT,
      track TEXT NOT NULL DEFAULT 'trader',
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      notes TEXT,
      readiness_score INTEGER NOT NULL DEFAULT 70,
      recommended_focus TEXT,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guide_conversations (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      guide_id TEXT NOT NULL,
      discovery_session_id TEXT,
      ai_run_id TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 45,
      conversation_summary TEXT NOT NULL,
      agreed_learning_needs_json TEXT NOT NULL,
      conducted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_learning_profiles (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL UNIQUE,
      approved_level TEXT NOT NULL DEFAULT 'L1',
      proposed_level TEXT,
      level_review_state TEXT NOT NULL DEFAULT 'APPROVED',
      primary_track TEXT NOT NULL DEFAULT 'trader',
      evidence_status TEXT NOT NULL DEFAULT 'SUFFICIENT',
      market_context_summary TEXT NOT NULL,
      guide_private_notes TEXT,
      rubric_version TEXT NOT NULL DEFAULT '1.2.0',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS core_competencies (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      description TEXT NOT NULL,
      l1_criteria TEXT NOT NULL,
      l2_criteria TEXT NOT NULL,
      l3_criteria TEXT NOT NULL,
      l4_criteria TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      approved_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learner_competency_proposals (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      description TEXT NOT NULL,
      rationale TEXT NOT NULL,
      target_level TEXT NOT NULL DEFAULT 'L2',
      status TEXT NOT NULL DEFAULT 'PENDING_GUIDE_REVIEW',
      reviewed_by TEXT,
      review_reason TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS competency_decisions (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      competency_code TEXT NOT NULL,
      previous_level TEXT NOT NULL,
      new_level TEXT NOT NULL,
      decision_status TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      guide_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pdp_versions (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE_APPROVED', 'PENDING_GUIDE_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'SUPERSEDED')),
      summary TEXT NOT NULL,
      objectives_json TEXT NOT NULL,
      competency_focus_json TEXT NOT NULL,
      routine_schedule TEXT NOT NULL,
      source_ai_run_id TEXT,
      drafted_by TEXT NOT NULL,
      reviewed_by_guide_id TEXT,
      review_decision TEXT,
      review_reason TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      activated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_tasks (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      pdp_version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      instructions TEXT NOT NULL,
      competency_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ASSIGNED',
      learner_submission TEXT,
      guide_feedback TEXT,
      due_date TEXT,
      submitted_at TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      market_context TEXT NOT NULL,
      decision_taken TEXT NOT NULL,
      process_adherence TEXT NOT NULL,
      emotional_state TEXT NOT NULL,
      reflection_notes TEXT NOT NULL,
      evidence_weight TEXT NOT NULL DEFAULT 'CASUAL_REFLECTION',
      guide_comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      competency_code TEXT NOT NULL,
      sufficiency_weight TEXT NOT NULL,
      uncertainty_note TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      competency_code TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      assessment_type TEXT NOT NULL,
      demonstrated_level TEXT NOT NULL,
      evidence_status TEXT NOT NULL,
      evaluator_guide_id TEXT NOT NULL,
      findings TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_workflow_runs (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      learner_id TEXT,
      provider_mode TEXT NOT NULL,
      model_name TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      run_status TEXT NOT NULL,
      sanitized_input_summary_json TEXT NOT NULL,
      observational_stage_json TEXT NOT NULL,
      decision_stage_json TEXT NOT NULL,
      generative_stage_json TEXT NOT NULL,
      validator_result_json TEXT NOT NULL,
      review_state TEXT NOT NULL DEFAULT 'PENDING_GUIDE_REVIEW',
      reviewed_by_guide_id TEXT,
      guide_review_notes TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 15,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS training_examples (
      id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL,
      participant_hash TEXT NOT NULL,
      dataset_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      split TEXT NOT NULL CHECK (split IN ('TRAIN', 'VALIDATION', 'TEST')),
      consent_verified INTEGER NOT NULL DEFAULT 1,
      deidentified_verified INTEGER NOT NULL DEFAULT 1,
      guide_verified INTEGER NOT NULL DEFAULT 1,
      curator_guide_id TEXT NOT NULL,
      inclusion_status TEXT NOT NULL DEFAULT 'INCLUDED',
      curation_reason TEXT NOT NULL,
      sanitized_context_json TEXT NOT NULL,
      gold_observation_json TEXT NOT NULL,
      gold_decision_json TEXT NOT NULL,
      gold_guide_brief_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS benchmark_runs (
      id TEXT PRIMARY KEY,
      dataset_version TEXT NOT NULL,
      provider_mode TEXT NOT NULL,
      model_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      total_cases INTEGER NOT NULL,
      passed_cases INTEGER NOT NULL,
      grounding_score INTEGER NOT NULL,
      uncertainty_calibration_score INTEGER NOT NULL,
      safety_block_rate INTEGER NOT NULL,
      no_advice_leakage INTEGER NOT NULL,
      case_results_json TEXT NOT NULL,
      release_gate_status TEXT NOT NULL,
      executed_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      actor_user_id TEXT,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      ip_hint TEXT DEFAULT '127.0.0.1',
      created_at TEXT NOT NULL
    );
  `);

  // Ensure initial guide_conversations seed exists
  const convCount = (db.prepare('SELECT COUNT(*) as c FROM guide_conversations').get() as any).c;
  const now = '2026-10-16T08:00:00.000Z';
  if (convCount === 0) {
    const existingUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (existingUsers > 0) {
      db.prepare(`
        INSERT INTO guide_conversations (
          id, learner_id, guide_id, discovery_session_id, ai_run_id, duration_minutes,
          conversation_summary, agreed_learning_needs_json, conducted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'conv_aarav_01',
        'usr_learner_aarav',
        'usr_guide_vikram',
        'sess_aarav_01',
        'run_aarav_01',
        45,
        'Conducted 45-minute 1-on-1 FRINS Conversation. Explored Aarav’s experience during volatile morning opens and why he occasionally cancels initial stop orders when price moves fast. Agreed that the root friction is entering without a written pre-market invalidation card and continuing to trade after two consecutive losses.',
        JSON.stringify([
          'Establish a written 4-point pre-trade qualification card before market open (COMP-PROC-01)',
          'Respect initial pre-defined invalidation stops across 10 consecutive trades without widening (COMP-EXEC-03)',
          'Enforce a 30-minute mandatory cool-down pause after 2 consecutive losses (COMP-RISK-02)'
        ]),
        now
      );
    }
  }

  // Ensure dynamic Admin-configurable discovery_questions are seeded (default N = 7 active questions)
  const dqCount = (db.prepare('SELECT COUNT(*) as c FROM discovery_questions').get() as any).c;
  if (dqCount === 0) {
    const insertDQ = db.prepare(`
      INSERT INTO discovery_questions (
        id, sort_order, domain, domain_title, prompt, input_type, options_json, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const defaultActiveSet = new Set(['Q01', 'Q06', 'Q07', 'Q11', 'Q14', 'Q16', 'Q22']);
    CANONICAL_QUESTIONS.forEach((q, idx) => {
      insertDQ.run(
        q.id,
        idx + 1,
        q.domain,
        q.domainTitle,
        q.prompt,
        q.type === 'open_reflection' ? 'text' : 'single_choice',
        JSON.stringify(q.options || []),
        defaultActiveSet.has(q.id) ? 1 : 0,
        now,
        now
      );
    });
  }

  // Ensure initial call_bookings seed exists
  const cbCount = (db.prepare('SELECT COUNT(*) as c FROM call_bookings').get() as any).c;
  if (cbCount === 0) {
    db.prepare(`
      INSERT INTO call_bookings (
        id, session_id, participant_name, participant_email, participant_phone, track,
        preferred_date, preferred_time, notes, readiness_score, recommended_focus, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
    `).run(
      'book_seed_01',
      'sess_aarav_01',
      'Aarav Mehta',
      'aarav@example.com',
      '+91 98201 11223',
      'trader',
      '2026-10-20',
      '11:00 AM IST',
      'Want to discuss my Discovery result on stop-loss hesitation and morning overtrading.',
      64,
      'Execution Composure & Pre-Decision Risk Checklist',
      now
    );
  }

  // Ensure courses, student_courses, task_messages tables and learning_tasks extra columns exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      track TEXT NOT NULL DEFAULT 'student_concepts',
      level TEXT NOT NULL DEFAULT 'L1',
      description TEXT NOT NULL,
      modules_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_courses (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      learner_id TEXT NOT NULL,
      custom_notes TEXT,
      progress_pct INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      assigned_by TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      audience TEXT NOT NULL,
      target_user_id TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (notification_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS course_questions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_option_index INTEGER NOT NULL DEFAULT 0,
      explanation TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS course_question_attempts (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      learner_id TEXT NOT NULL,
      selected_option_index INTEGER NOT NULL,
      is_correct INTEGER NOT NULL,
      attempted_at TEXT NOT NULL
    );
  `);

  const extraTaskColumns = [
    'ALTER TABLE learning_tasks ADD COLUMN course_id TEXT',
    'ALTER TABLE learning_tasks ADD COLUMN expected_criteria TEXT',
    'ALTER TABLE learning_tasks ADD COLUMN uploaded_file_name TEXT',
    'ALTER TABLE learning_tasks ADD COLUMN uploaded_file_data TEXT',
    'ALTER TABLE learning_tasks ADD COLUMN ai_review_json TEXT',
    'ALTER TABLE leads ADD COLUMN custom_track TEXT',
    'ALTER TABLE call_bookings ADD COLUMN custom_track TEXT',
    'ALTER TABLE discovery_sessions ADD COLUMN custom_track TEXT'
  ];
  for (const sql of extraTaskColumns) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }

  // Seed initial custom courses if empty
  const courseCount = (db.prepare('SELECT COUNT(*) as c FROM courses').get() as any).c;
  if (courseCount === 0) {
    const insertCourse = db.prepare(`
      INSERT INTO courses (id, title, track, level, description, modules_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'usr_admin_meera', ?)
    `);

    insertCourse.run(
      'crs_heikin_ashi_01',
      'Candlestick Mastery & Heikin-Ashi Trend Structure',
      'strategy_learner',
      'L1 → L2',
      'Custom-built course covering standard vs. averaged price candlesticks, the Heikin-Ashi formula, trend continuation without lower wicks, and spotting Doji exhaustion.',
      JSON.stringify([
        'Module 1: Standard Candlesticks vs. Heikin-Ashi Averaged Formula ((O+H+L+C)/4)',
        'Module 2: Identifying Strong Uptrends (Consecutive Green Bodies With Zero Lower Shadows)',
        'Module 3: Spotting Heikin-Ashi Doji Indecision & Trend Reversals',
        'Module 4: Executing Orders Using Real Market Price (LTP) vs. Synthetic HA Levels'
      ]),
      now
    );

    insertCourse.run(
      'crs_strategy_lab_02',
      'Market Strategy Design, Edge Qualification & Risk Sizing',
      'trader',
      'L2 → L3',
      'Hands-on strategy curriculum for building written setup rules, pre-session qualification cards, invalidation stop placement, and drawdown circuit breakers.',
      JSON.stringify([
        'Module 1: Anatomy of a Repeatable Market Strategy & Regime Fit',
        'Module 2: Pre-Decision Checklist & Invalidation Stop Definition',
        'Module 3: Position Sizing From Downside Risk Formula',
        'Module 4: Post-Session Process vs. Outcome Review'
      ]),
      now
    );

    insertCourse.run(
      'crs_concepts_03',
      'Foundational Market Concepts & Long-Term Thesis Building',
      'student_concepts',
      'L1 → L2',
      'Built for students and beginners learning market mechanics, price discovery, liquidity, and how to write a structured investment or trading thesis from scratch.',
      JSON.stringify([
        'Module 1: How Financial Markets, Order Books & Timeframes Work',
        'Module 2: Price Structure, Support/Resistance & Volatility Basics',
        'Module 3: Risk Preservation & Capital Allocation Foundations',
        'Module 4: Building Your First Written Market Thesis'
      ]),
      now
    );

    // Assign courses to seeded students
    const insertSC = db.prepare(`
      INSERT INTO student_courses (id, course_id, learner_id, custom_notes, progress_pct, status, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'usr_admin_meera', ?)
    `);
    insertSC.run(
      'sc_aarav_01',
      'crs_heikin_ashi_01',
      'usr_learner_aarav',
      'Customised for Aarav: Focus on filtering morning noise using Heikin-Ashi trend structure while keeping stops anchored to actual LTP.',
      65,
      now
    );
    insertSC.run(
      'sc_aarav_02',
      'crs_strategy_lab_02',
      'usr_learner_aarav',
      'Focus on pre-market qualification checklist and two-loss cool-down rule.',
      45,
      now
    );
    insertSC.run(
      'sc_priya_01',
      'crs_concepts_03',
      'usr_learner_priya',
      'Customised for Priya: Focus on written thesis criteria and avoiding averaging down.',
      30,
      now
    );
  }

  // Seed course-linked questions (Admin-editable question bank per course)
  const courseQuestionCount = (db.prepare('SELECT COUNT(*) as c FROM course_questions').get() as any).c;
  if (courseQuestionCount === 0) {
    const insertCourseQuestion = db.prepare(`
      INSERT INTO course_questions (id, course_id, prompt, options_json, correct_option_index, explanation, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'usr_admin_meera', ?)
    `);
    insertCourseQuestion.run(
      'cq_ha_01',
      'crs_heikin_ashi_01',
      'How is the Heikin-Ashi close price calculated?',
      JSON.stringify(['(Open + High + Low + Close) / 4', 'Close of the current candle only', '(High + Low) / 2', 'Open of the prior candle']),
      0,
      'Heikin-Ashi closes are the average of the bar\'s Open, High, Low and Close, which smooths noise.',
      now
    );
    insertCourseQuestion.run(
      'cq_ha_02',
      'crs_heikin_ashi_01',
      'A strong Heikin-Ashi uptrend typically shows candles with:',
      JSON.stringify(['Long lower wicks on every bar', 'No lower shadows (wicks) on consecutive green bodies', 'Alternating red and green bodies', 'A flat open equal to close on every bar']),
      1,
      'Consecutive green Heikin-Ashi bodies without lower shadows indicate strong bullish trend continuation.',
      now
    );
    insertCourseQuestion.run(
      'cq_sl_01',
      'crs_strategy_lab_02',
      'Where should an invalidation stop be placed when trading with Heikin-Ashi signals?',
      JSON.stringify(['At the synthetic Heikin-Ashi candle low', 'Using the real market price (LTP) structure on the underlying chart', 'At a fixed 0.5% distance from entry', 'There is no need for a stop']),
      1,
      'Heikin-Ashi values are synthetic averages; stops must reference real market price structure.',
      now
    );
    insertCourseQuestion.run(
      'cq_cn_01',
      'crs_concepts_03',
      'What does the bid-ask spread primarily represent?',
      JSON.stringify(['The total volume traded in a session', 'The difference between the best bid and best ask price', 'The brokerage fee per trade', 'The gap between yesterday\'s close and today\'s open']),
      1,
      'The spread is the difference between the highest price a buyer will pay and the lowest a seller will accept.',
      now
    );
  }

  // Ensure the "Find Heikin-Ashi" task with Student Uploaded Result + AI Pre-Review + Chat exists
  const haTaskExists = db.prepare('SELECT id FROM learning_tasks WHERE id = ?').get('tsk_heikin_ashi_01');
  if (!haTaskExists) {
    const sampleHeikinAshiSvg = `data:image/svg+xml;utf8,` + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="680" height="280" viewBox="0 0 680 280">
        <rect width="680" height="280" rx="12" fill="#0F172A"/>
        <text x="24" y="34" fill="#F8FAFC" font-family="sans-serif" font-size="15" font-weight="bold">Student Upload: NIFTY 15m Heikin-Ashi Trend &amp; Reversal Analysis (Aarav Mehta)</text>
        <text x="24" y="54" fill="#94A3B8" font-family="monospace" font-size="12">Formula Checked: HA Close = (O+H+L+C)/4 | HA Open = (Prior HA Open + Prior HA Close)/2</text>
        <line x1="24" y1="230" x2="656" y2="230" stroke="#334155" stroke-dasharray="4 4"/>
        <!-- 5 Bullish Heikin-Ashi Candles with NO Lower Wicks -->
        <g>
          <line x1="80" y1="175" x2="80" y2="210" stroke="#10B981" stroke-width="2"/>
          <rect x="70" y="185" width="20" height="25" rx="2" fill="#10B981"/>
          <line x1="140" y1="150" x2="140" y2="195" stroke="#10B981" stroke-width="2"/>
          <rect x="130" y="162" width="20" height="33" rx="2" fill="#10B981"/>
          <line x1="200" y1="125" x2="200" y2="175" stroke="#10B981" stroke-width="2"/>
          <rect x="190" y="138" width="20" height="37" rx="2" fill="#10B981"/>
          <line x1="260" y1="100" x2="260" y2="155" stroke="#10B981" stroke-width="2"/>
          <rect x="250" y="114" width="20" height="41" rx="2" fill="#10B981"/>
          <line x1="320" y1="82" x2="320" y2="132" stroke="#10B981" stroke-width="2"/>
          <rect x="310" y="95" width="20" height="37" rx="2" fill="#10B981"/>
          <text x="115" y="252" fill="#34D399" font-family="sans-serif" font-size="12" font-weight="bold">✓ Strong Uptrend: No Lower Wicks</text>
        </g>
        <!-- Heikin-Ashi Doji Exhaustion Candle (Upper + Lower Shadows) -->
        <g>
          <line x1="410" y1="68" x2="410" y2="138" stroke="#FBBF24" stroke-width="2.5"/>
          <rect x="398" y="99" width="24" height="7" rx="1" fill="#FBBF24"/>
          <circle cx="410" cy="102" r="26" fill="none" stroke="#FBBF24" stroke-dasharray="4 3"/>
          <text x="360" y="252" fill="#FBBF24" font-family="sans-serif" font-size="12" font-weight="bold">⚡ HA Doji Indecision / Reversal</text>
        </g>
        <!-- Bearish Reversal Candles (No Upper Wicks) -->
        <g>
          <line x1="500" y1="105" x2="500" y2="165" stroke="#F43F5E" stroke-width="2"/>
          <rect x="490" y="105" width="20" height="42" rx="2" fill="#F43F5E"/>
          <line x1="560" y1="130" x2="560" y2="195" stroke="#F43F5E" stroke-width="2"/>
          <rect x="550" y="130" width="20" height="45" rx="2" fill="#F43F5E"/>
          <text x="485" y="252" fill="#FB7185" font-family="sans-serif" font-size="12" font-weight="bold">Bearish Shift (No Upper Wicks)</text>
        </g>
      </svg>
    `);

    const haSubmissionText =
      'I found and marked a clean Heikin-Ashi trend and reversal sequence on the NIFTY 15-minute chart:\n' +
      '1. Formula: Heikin-Ashi Close = (Open + High + Low + Close) / 4, and Heikin-Ashi Open = midpoint of the previous HA candle body.\n' +
      '2. Strong Uptrend Identification: Bars 1 to 5 show consecutive green Heikin-Ashi bodies with zero lower wicks (no lower shadows), confirming strong bullish momentum.\n' +
      '3. Reversal Signal: At Bar 6, a small-bodied Heikin-Ashi Doji with both upper and lower shadows appeared, signaling trend exhaustion, followed by red candles with no upper wicks.';

    const haCriteria =
      'Must identify Heikin-Ashi Close formula (O+H+L+C)/4, midpoint HA Open, strong uptrend candles having no lower wicks/shadows, Doji with dual wicks for exhaustion/reversal, and note that HA prices are synthetic vs real LTP.';

    const haAiReview = analyzeStudentTaskSubmissionWithAI({
      taskTitle: 'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
      instructions: 'Find and upload a chart showing Heikin-Ashi trend candles without lower wicks, explain the HA formula, and mark a Doji reversal.',
      expectedCriteria: haCriteria,
      learnerSubmission: haSubmissionText,
      uploadedFileName: 'NIFTY_Heikin_Ashi_Trend_Analysis.svg'
    });

    const existingUsersCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (existingUsersCount > 0) {
      db.prepare(`
        INSERT INTO learning_tasks (
          id, learner_id, pdp_version_id, course_id, title, category, instructions, expected_criteria,
          competency_code, status, learner_submission, uploaded_file_name, uploaded_file_data,
          ai_review_json, guide_feedback, due_date, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'tsk_heikin_ashi_01',
        'usr_learner_aarav',
        'pdp_aarav_v1',
        'crs_heikin_ashi_01',
        'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
        'CHART_CONCEPT_LAB',
        'Find a clean Heikin-Ashi trend on your chart, upload the annotated result, explain how Heikin-Ashi candles are calculated ((O+H+L+C)/4), show why strong uptrend candles have no lower wicks, and mark where a Heikin-Ashi Doji signals trend exhaustion.',
        haCriteria,
        'COMP-PROC-01',
        'SUBMITTED',
        haSubmissionText,
        'NIFTY_Heikin_Ashi_Trend_Analysis.svg',
        sampleHeikinAshiSvg,
        JSON.stringify(haAiReview),
        null,
        '2026-10-22',
        now
      );

      // Seed initial chat messages on this task so Admin & Student can see the live chat thread
      const insertMsg = db.prepare(`
        INSERT INTO task_messages (id, task_id, sender_user_id, sender_name, sender_role, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertMsg.run(
        'msg_ha_01',
        'tsk_heikin_ashi_01',
        'usr_learner_aarav',
        'Aarav Mehta',
        'LEARNER',
        'Hi team, I have uploaded my Heikin-Ashi chart analysis showing the 5 wickless green trend candles and the Doji reversal. Please review and let me know if my interpretation is accurate!',
        now
      );
      insertMsg.run(
        'msg_ha_02',
        'tsk_heikin_ashi_01',
        'usr_admin_meera',
        'Meera Krishnan (Admin)',
        'ADMIN',
        'Thanks for uploading your Heikin-Ashi chart, Aarav! We received your diagram and are reviewing how you marked the wickless uptrend bars and Doji exhaustion.',
        now
      );
    }
  }
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count > 0) {
    return;
  }

  const pwHash = hashPassword('frins123');

  // 1. Seed Users
  // OR IGNORE so a second process booting at the same moment cannot fail the
  // seed on the unique email index. The count check above is not atomic.
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role, account_status, track, assigned_guide_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('usr_admin_meera', 'Meera Krishnan', 'admin@frins.org', pwHash, 'ADMIN', 'ACTIVE', 'both', null, now, now);
  insertUser.run('usr_guide_vikram', 'Dr. Vikram Sen', 'vikram.guide@frins.org', pwHash, 'GUIDE', 'ACTIVE', 'both', null, now, now);
  insertUser.run('usr_learner_aarav', 'Aarav Mehta', 'aarav@example.com', pwHash, 'LEARNER', 'ACTIVE', 'trader', 'usr_guide_vikram', now, now);
  insertUser.run('usr_learner_priya', 'Priya Nair', 'priya@example.com', pwHash, 'LEARNER', 'ACTIVE', 'investor', 'usr_guide_vikram', now, now);
  insertUser.run('usr_learner_rohan', 'Rohan Verma', 'rohan@example.com', pwHash, 'LEARNER', 'ACTIVE', 'investor', 'usr_guide_vikram', now, now);

  // 2. Seed Core Competencies (Permanent Library v1.2.0)
  const insertComp = db.prepare(`
    INSERT INTO core_competencies (
      id, code, title, domain, description, l1_criteria, l2_criteria, l3_criteria, l4_criteria, rubric_version, status, approved_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const competencies = [
    {
      id: 'comp_01',
      code: 'COMP-PROC-01',
      title: 'Pre-Decision Process & Thesis Articulation',
      domain: 'DECISION_PROCESS',
      description: 'Ability to define clear market qualification criteria, thesis reasoning, and invalidation conditions in writing prior to committing capital.',
      l1: 'L1 Foundational Understanding: Recognises the difference between an impulse idea and a structured setup/thesis; documents reasoning intermittently.',
      l2: 'L2 Guided Application: Consistently uses a written pre-decision checklist with Guide support; defines invalidation before entry on >70% of decisions.',
      l3: 'L3 Independent Application: Self-governs written pre-decision criteria across market conditions without external prompting; filters external noise reliably.',
      l4: 'L4 Adaptive Mastery: Refines decision checklists systematically across changing market regimes using longitudinal evidence.'
    },
    {
      id: 'comp_02',
      code: 'COMP-RISK-02',
      title: 'Downside Calibration & Position Sizing Governance',
      domain: 'RISK_EXECUTION',
      description: 'Structuring position size and portfolio exposure around acceptable downside loss rather than emotional conviction or recent P&L.',
      l1: 'L1 Foundational Understanding: Understands capital preservation principles and maximum loss limits conceptually.',
      l2: 'L2 Guided Application: Calculates position size from predefined risk parameters before entry; avoids unplanned averaging down.',
      l3: 'L3 Independent Application: Maintains non-negotiable risk caps across winning and losing streaks independently.',
      l4: 'L4 Adaptive Mastery: Dynamically calibrates portfolio exposure to volatility and liquidity regimes based on documented risk evidence.'
    },
    {
      id: 'comp_03',
      code: 'COMP-EXEC-03',
      title: 'In-Flight Composure & Invalidation Execution',
      domain: 'RISK_EXECUTION',
      description: 'Acting in accordance with pre-committed invalidation and exit criteria when live prices move rapidly or adversely.',
      l1: 'L1 Foundational Understanding: Identifies personal triggers for hesitation, FOMO, or revenge decisions in hindsight.',
      l2: 'L2 Guided Application: Notices stress signals in real time and follows planned exits or cool-down pauses in most sessions.',
      l3: 'L3 Independent Application: Executes invalidation exits cleanly without widening stops or forcing recovery trades.',
      l4: 'L4 Adaptive Mastery: Sustains calm, objective execution during extreme volatility spikes and mentors own state regulation.'
    },
    {
      id: 'comp_04',
      code: 'COMP-REV-04',
      title: 'Evidence-Based Reflection & Process-Outcome Separation',
      domain: 'REFLECTION_EVIDENCE',
      description: 'Evaluating decisions by adherence to process and quality of reasoning rather than judging solely by profit or loss.',
      l1: 'L1 Foundational Understanding: Distinguishes a lucky profitable rule-breach from a well-executed decision conceptually.',
      l2: 'L2 Guided Application: Maintains a structured decision journal and conducts weekly process vs outcome audits with Guide feedback.',
      l3: 'L3 Independent Application: Independently identifies recurring behavioral patterns from multi-month journal evidence.',
      l4: 'L4 Adaptive Mastery: Uses rigorous multi-source evidence logs to test and evolve personal market hypotheses.'
    },
    {
      id: 'comp_05',
      code: 'COMP-ADAPT-05',
      title: 'Deliberate Restraint & Regime Awareness',
      domain: 'PARTICIPATION_ORIENTATION',
      description: 'Recognising when market conditions do not align with one’s personal playbook and exercising patient restraint.',
      l1: 'L1 Foundational Understanding: Recognises that sitting in cash or waiting is an active market decision.',
      l2: 'L2 Guided Application: Reduces unforced activity during low-clarity sessions using pre-set participation filters.',
      l3: 'L3 Independent Application: Demonstrates high comfort with inactivity when criteria are absent; zero boredom participation.',
      l4: 'L4 Adaptive Mastery: Seamlessly aligns participation intensity with structural market environment.'
    }
  ];

  for (const c of competencies) {
    insertComp.run(
      c.id,
      c.code,
      c.title,
      c.domain,
      c.description,
      c.l1,
      c.l2,
      c.l3,
      c.l4,
      '1.2.0',
      'ACTIVE',
      'usr_admin_meera',
      now
    );
  }

  // 3. Seed Student Learning Profiles
  const insertProfile = db.prepare(`
    INSERT INTO student_learning_profiles (
      id, learner_id, approved_level, proposed_level, level_review_state, primary_track, evidence_status, market_context_summary, guide_private_notes, rubric_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProfile.run(
    'slp_aarav',
    'usr_learner_aarav',
    'L2',
    'L3',
    'PENDING_GUIDE_REVIEW',
    'trader',
    'SUFFICIENT',
    'Active index & equity swing/intraday trader (2.5 years). Strong conceptual grasp of setups, currently working on eliminating stop-loss hesitation and post-loss recovery urges.',
    'GUIDE PRIVATE NOTE (Dr. Vikram Sen): Aarav has made strong progress on his pre-market checklist over the last 3 weeks. Keep him at L2 until his formal scenario assessment confirms zero stop-widening across 10 consecutive live sessions.',
    '1.2.0',
    now
  );

  insertProfile.run(
    'slp_priya',
    'usr_learner_priya',
    'L1',
    'L2',
    'PENDING_GUIDE_REVIEW',
    'investor',
    'REVIEW_REQUIRED',
    'Long-term equity investor (2 years) building her first written thesis and downside invalidation journal.',
    'GUIDE PRIVATE NOTE (Dr. Vikram Sen): Priya completed Discovery today. Review her Three-Agent brief and approve her initial PDP v1.0 after your 45-minute call.',
    '1.2.0',
    now
  );

  insertProfile.run(
    'slp_rohan',
    'usr_learner_rohan',
    'L3',
    null,
    'APPROVED',
    'investor',
    'SUFFICIENT',
    'Experienced long-term capital allocator (8+ years) with documented written investment memos, strict allocation caps, and quarterly process audits. No significant learning concern established.',
    'GUIDE PRIVATE NOTE (Dr. Vikram Sen): Validated NO_CONCERN_ESTABLISHED outcome. Rohan uses FRINS for quarterly peer reflection checkpoints.',
    '1.2.0',
    now
  );

  // 4. Seed Discovery Sessions + 34 Canonical Responses + Three-Agent AI Workflow Runs
  const seedSessionWithPersona = (
    sessionId: string,
    userId: string,
    personaKey: keyof typeof DISCOVERY_TEST_PERSONAS,
    aiRunId: string,
    reviewState: 'PENDING_GUIDE_REVIEW' | 'APPROVED_BY_GUIDE'
  ) => {
    const persona = DISCOVERY_TEST_PERSONAS[personaKey];
    const responsesMap: Record<string, { answerValue: string; answerText?: string }> = {};
    for (const [qId, val] of Object.entries(persona.answers)) {
      responsesMap[qId] = { answerValue: val, answerText: val };
    }
    const evalResult = evaluateDiscoverySessionDeterministically(responsesMap);

    db.prepare(`
      INSERT INTO discovery_sessions (
        id, participant_user_id, participant_name, participant_email, track, question_bank_version,
        status, completeness_pct, sufficiency_status, exit_pathway, contradiction_flags_json,
        domain_summary_json, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      userId,
      persona.participantName,
      persona.participantEmail,
      persona.track,
      QUESTION_BANK_VERSION,
      'COMPLETED',
      evalResult.completenessPct,
      evalResult.sufficiencyStatus,
      evalResult.exitPathway,
      JSON.stringify(evalResult.contradictionFlags),
      JSON.stringify(evalResult.domainBreakdown),
      now,
      now,
      now
    );

    const insertResp = db.prepare(`
      INSERT INTO discovery_responses (id, session_id, question_id, domain, answer_value, answer_text, answered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const q of CANONICAL_QUESTIONS) {
      const val = persona.answers[q.id] || '';
      insertResp.run(
        `resp_${sessionId}_${q.id}`,
        sessionId,
        q.id,
        q.domain,
        val,
        q.type === 'open_reflection' ? val : null,
        now
      );
    }

    const pkg = buildSanitizedEvidencePackage(
      sessionId,
      persona.participantName,
      persona.participantEmail,
      persona.track,
      responsesMap,
      evalResult
    );
    const obs = runObservationalAgentDeterministic(pkg);
    const dec = runDecisionAgentGoverned(pkg, obs);
    const gen = runGenerativeAgentTemplate(pkg, obs, dec);
    const val = validateThreeAgentOutput(pkg, obs, dec, gen);

    db.prepare(`
      INSERT INTO ai_workflow_runs (
        id, trace_id, session_id, learner_id, provider_mode, model_name, prompt_version, run_status,
        sanitized_input_summary_json, observational_stage_json, decision_stage_json, generative_stage_json,
        validator_result_json, review_state, reviewed_by_guide_id, guide_review_notes, latency_ms, created_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      aiRunId,
      `tr_seed_${aiRunId}`,
      sessionId,
      userId,
      'MOCK_DETERMINISTIC',
      'frins-deterministic-mock-v1',
      'frins-prompt-v1.0.0',
      'COMPLETED',
      JSON.stringify(pkg),
      JSON.stringify(obs),
      JSON.stringify(dec),
      JSON.stringify(gen),
      JSON.stringify(val),
      reviewState,
      reviewState === 'APPROVED_BY_GUIDE' ? 'usr_guide_vikram' : null,
      reviewState === 'APPROVED_BY_GUIDE'
        ? 'Verified observations during 45-minute Guide conversation; aligned on pre-market checklist and downside exit discipline.'
        : null,
      18,
      now,
      reviewState === 'APPROVED_BY_GUIDE' ? now : null
    );
  };

  seedSessionWithPersona('sess_aarav_01', 'usr_learner_aarav', 'active_trader_friction', 'run_aarav_01', 'APPROVED_BY_GUIDE');
  seedSessionWithPersona('sess_rohan_01', 'usr_learner_rohan', 'steady_investor_no_concern', 'run_rohan_01', 'APPROVED_BY_GUIDE');
  seedSessionWithPersona('sess_priya_01', 'usr_learner_priya', 'contradictory_participant', 'run_priya_01', 'PENDING_GUIDE_REVIEW');

  // Seed Guide Conversation for Aarav
  db.prepare(`
    INSERT INTO guide_conversations (
      id, learner_id, guide_id, discovery_session_id, ai_run_id, duration_minutes,
      conversation_summary, agreed_learning_needs_json, conducted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'conv_aarav_01',
    'usr_learner_aarav',
    'usr_guide_vikram',
    'sess_aarav_01',
    'run_aarav_01',
    45,
    'Conducted 45-minute 1-on-1 FRINS Conversation. Explored Aarav’s experience during volatile morning opens and why he occasionally cancels initial stop orders when price moves fast. Agreed that the root friction is entering without a written pre-market invalidation card and continuing to trade after two consecutive losses.',
    JSON.stringify([
      'Establish a written 4-point pre-trade qualification card before market open (COMP-PROC-01)',
      'Respect initial pre-defined invalidation stops across 10 consecutive trades without widening (COMP-EXEC-03)',
      'Enforce a 30-minute mandatory cool-down pause after 2 consecutive losses (COMP-RISK-02)'
    ]),
    now
  );

  // 5. Seed Consent Records
  const insertConsent = db.prepare(`
    INSERT INTO consent_records (id, user_id, session_id, consent_type, granted, consent_version, wording_snapshot, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertConsent.run(
    'con_aarav_01',
    'usr_learner_aarav',
    'sess_aarav_01',
    'TRAINING_CURATION',
    1,
    'v1.0-2026',
    'Explicit opt-in consent for de-identified, Guide-verified learning observation curation.',
    now
  );
  insertConsent.run(
    'con_rohan_01',
    'usr_learner_rohan',
    'sess_rohan_01',
    'TRAINING_CURATION',
    1,
    'v1.0-2026',
    'Explicit opt-in consent for de-identified, Guide-verified learning observation curation.',
    now
  );

  // 6. Seed PDP Versions
  const insertPDP = db.prepare(`
    INSERT INTO pdp_versions (
      id, learner_id, version_number, title, status, summary, objectives_json, competency_focus_json,
      routine_schedule, source_ai_run_id, drafted_by, reviewed_by_guide_id, review_decision, review_reason,
      created_at, reviewed_at, activated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPDP.run(
    'pdp_aarav_v1',
    'usr_learner_aarav',
    1,
    'Foundational Process & Downside Execution Plan (v1.0, Active)',
    'ACTIVE_APPROVED',
    'Approved after initial 45-minute FRINS Conversation with Dr. Vikram Sen. Focuses on establishing a written pre-market checklist and respecting initial invalidation stops without averaging down.',
    JSON.stringify([
      'Complete a written 4-point pre-trade qualification card before every intraday or swing entry.',
      'Execute pre-defined invalidation stops without moving them further away across 10 consecutive trades.',
      'Enforce a mandatory 30-minute cool-down pause after any 2 consecutive losing trades in a session.'
    ]),
    JSON.stringify(['COMP-PROC-01', 'COMP-RISK-02', 'COMP-EXEC-03']),
    'Daily 15-min pre-open checklist (08:50 IST) + Friday 45-min Process vs Outcome review.',
    'run_aarav_01',
    'Dr. Vikram Sen (Guide) + GenerativeAgent',
    'usr_guide_vikram',
    'APPROVED',
    'Approved following 45-min Guide Conversation. Learner agreed to 2-loss cool-down rule.',
    now,
    now,
    now
  );

  insertPDP.run(
    'pdp_aarav_v2',
    'usr_learner_aarav',
    2,
    'Stage 2 Revision: Regime Filtering & Scaling Discipline (v2.0, Pending Guide Approval)',
    'PENDING_GUIDE_REVIEW',
    'Proposed revision incorporating recent reflection evidence. Adds volatility regime filtering and structured profit-scaling rules while maintaining v1.0 downside guardrails.',
    JSON.stringify([
      'Maintain all v1.0 pre-trade qualification and hard invalidation stop rules.',
      'Add opening-range volatility check to avoid chasing gap-up extensions in the first 15 minutes.',
      'Conduct weekly 2x2 Process vs Outcome matrix audit with chart screenshots attached.'
    ]),
    JSON.stringify(['COMP-EXEC-03', 'COMP-REV-04', 'COMP-ADAPT-05']),
    'Daily pre-open filter + Wednesday & Friday structured journal audit.',
    'run_aarav_01',
    'GenerativeAgent (Draft Proposal)',
    null,
    null,
    null,
    now,
    null,
    null
  );

  insertPDP.run(
    'pdp_priya_v1',
    'usr_learner_priya',
    1,
    'Long-Term Thesis Documentation & Downside Allocation Plan (v1.0, Pending Guide Review)',
    'PENDING_GUIDE_REVIEW',
    'Candidate initial PDP generated from Discovery session sess_priya_01. Prioritises separating short-term trades from long-term holdings and documenting thesis invalidation triggers.',
    JSON.stringify([
      'Separate long-term compounding holdings from short-term positional ideas into distinct tracking sheets.',
      'Write a 3-sentence investment thesis and fundamental invalidation trigger before allocating to any new equity.',
      'Review portfolio decisions quarterly based on business thesis progress rather than daily price fluctuations.'
    ]),
    JSON.stringify(['COMP-PROC-01', 'COMP-RISK-02', 'COMP-REV-04']),
    'Weekend 45-minute research & thesis journaling routine.',
    'run_priya_01',
    'GenerativeAgent (Draft Proposal)',
    null,
    null,
    null,
    now,
    null,
    null
  );

  insertPDP.run(
    'pdp_rohan_v1',
    'usr_learner_rohan',
    1,
    'Independent Process Maintenance & Quarterly Reflection Charter (v1.0, Active)',
    'ACTIVE_APPROVED',
    'No remedial learning concern established during Discovery or Guide conversation. This charter supports Rohan’s self-governed quarterly portfolio review.',
    JSON.stringify([
      'Continue pre-commitment investment memos and quarterly thesis verification.',
      'Optional quarterly 45-minute reflection dialogue with Learning Guide.'
    ]),
    JSON.stringify(['COMP-REV-04', 'COMP-ADAPT-05']),
    'Quarterly portfolio process audit.',
    'run_rohan_01',
    'Dr. Vikram Sen',
    'usr_guide_vikram',
    'APPROVED',
    'Confirmed NO_CONCERN_ESTABLISHED; approved light maintenance charter.',
    now,
    now,
    now
  );

  // 7. Seed Learning Tasks for Aarav
  const insertTask = db.prepare(`
    INSERT INTO learning_tasks (
      id, learner_id, pdp_version_id, title, category, instructions, competency_code, status, learner_submission, guide_feedback, due_date, submitted_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTask.run(
    'tsk_aarav_01',
    'usr_learner_aarav',
    'pdp_aarav_v1',
    'Pre-Market 4-Point Qualification Log (5 Sessions)',
    'DELIBERATE_PRACTICE',
    'Before market open across 5 sessions, record your key levels, invalidation trigger, fixed risk per decision, and state of mind.',
    'COMP-PROC-01',
    'REVIEWED',
    'Completed all 5 pre-market logs between Oct 8 and Oct 14. Having the invalidation level written on paper before 9:15 AM prevented me from taking two impulsive opening-candle trades.',
    'Excellent specificity on the Oct 11 and Oct 14 logs. Notice how writing the invalidation point reduced your morning urgency.',
    '2026-10-15',
    now,
    now
  );

  insertTask.run(
    'tsk_aarav_02',
    'usr_learner_aarav',
    'pdp_aarav_v1',
    '10-Decision Stop-Loss Execution Tracker',
    'PROCESS_AUDIT',
    'Log 10 consecutive active decisions and record whether the initial invalidation exit was respected without widening.',
    'COMP-EXEC-03',
    'SUBMITTED',
    'Logged 10 decisions: 9/10 respected exact pre-defined stop. On Decision #6 (volatile expiry afternoon), I hesitated for 40 seconds before exiting manually.',
    null,
    '2026-10-18',
    now,
    null
  );

  insertTask.run(
    'tsk_aarav_03',
    'usr_learner_aarav',
    'pdp_aarav_v1',
    'Two-Loss Mandatory Cool-Down Drill',
    'SCENARIO_DRILL',
    'If two consecutive losses occur in a single session, close order screens for 30 minutes and complete a state-check reflection before deciding whether to resume.',
    'COMP-RISK-02',
    'ASSIGNED',
    null,
    null,
    '2026-10-22',
    null,
    null
  );

  // 8. Seed Reflections & Evidence Items
  const insertReflection = db.prepare(`
    INSERT INTO reflections (
      id, learner_id, title, market_context, decision_taken, process_adherence, emotional_state, reflection_notes, evidence_weight, guide_comment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReflection.run(
    'ref_aarav_01',
    'usr_learner_aarav',
    'Post-Session Review: Respecting Stop on Gap Reversal',
    'Wide-range morning session with sharp sector rotation after macro data release.',
    'Entered planned pullback setup; price hit invalidation level within 12 minutes; executed planned exit immediately.',
    'FOLLOWED_PLAN',
    'Calm at first, then mild frustration, then relief after stepping back',
    'Two months ago I would have doubled down on this losing position. Sticking to the pre-written risk amount made the loss feel completely manageable.',
    'STRUCTURED_JOURNAL',
    'Strong evidence of L2 Guided Application on COMP-EXEC-03.',
    now
  );

  insertReflection.run(
    'ref_aarav_02',
    'usr_learner_aarav',
    'Mid-Week Check: Profitable Trade That Broke Entry Filter',
    'Choppy afternoon index consolidation.',
    'Entered early before candle closure out of fear of missing the move; trade ended in profit.',
    'PARTIAL_DEVIATION',
    'Restless / FOMO during afternoon lull',
    'Even though this trade made money, I classified it in my journal as a Process Breach (Flawed Process / Lucky Outcome) because I jumped in before my confirmation criteria.',
    'STRUCTURED_JOURNAL',
    'Classifying a profitable rule-breach honestly is a major milestone in COMP-REV-04.',
    now
  );

  const insertEvidence = db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code, sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertEvidence.run(
    'ev_aarav_01',
    'usr_learner_aarav',
    'DISCOVERY_RESPONSE',
    'sess_aarav_01',
    'Canonical 34-Question Discovery Baseline',
    'Baseline self-reported process and execution profile across all 5 FRINS domains (100% completion).',
    'COMP-PROC-01',
    'LOW_REFLECTION',
    'Self-reported baseline; requires corroboration from practice artefacts and formal assessment.',
    'VERIFIED',
    now
  );

  insertEvidence.run(
    'ev_aarav_02',
    'usr_learner_aarav',
    'PRACTICE_ARTEFACT',
    'tsk_aarav_01',
    '5-Session Pre-Market Qualification Logs',
    'Verified written pre-market checklists submitted across 5 consecutive market sessions.',
    'COMP-PROC-01',
    'MEDIUM_PRACTICE',
    'Demonstrates guided consistency over 1 week; longer horizon needed for L3 independence.',
    'VERIFIED',
    now
  );

  insertEvidence.run(
    'ev_aarav_03',
    'usr_learner_aarav',
    'FORMAL_ASSESSMENT',
    'ass_aarav_01',
    'Guide Scenario Evaluation: Adverse Volatility Protocol',
    'Formal structured evaluation conducted by Dr. Vikram Sen testing pre-decision sizing and invalidation discipline.',
    'COMP-RISK-02',
    'HIGH_FORMAL',
    'Low uncertainty. Directly evaluated by an authorised Learning Guide against Rubric v1.2.0.',
    'VERIFIED',
    now
  );

  // Priya only has Discovery self-report so far (demonstrates INSUFFICIENT multi-source weight for formal progression)
  insertEvidence.run(
    'ev_priya_01',
    'usr_learner_priya',
    'DISCOVERY_RESPONSE',
    'sess_priya_01',
    'Canonical 34-Question Discovery Baseline',
    'Initial Discovery responses with contradiction flags between stated risk rules and averaging-down habits.',
    'COMP-RISK-02',
    'LOW_REFLECTION',
    'Single-source self-report with contradiction flags; formal assessment and Guide conversation required.',
    'PENDING_REVIEW',
    now
  );

  // 9. Seed Formal Assessments
  db.prepare(`
    INSERT INTO assessments (
      id, learner_id, competency_code, rubric_version, assessment_type, demonstrated_level, evidence_status, evaluator_guide_id, findings, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'ass_aarav_01',
    'usr_learner_aarav',
    'COMP-RISK-02',
    '1.2.0',
    'SCENARIO_EVALUATION',
    'L2',
    'SUFFICIENT',
    'usr_guide_vikram',
    'Learner accurately calculated position size from downside invalidation across 4 simulated volatility scenarios and demonstrated L2 Guided Application.',
    now
  );

  // 10. Seed Learner-Specific Competency Proposal
  db.prepare(`
    INSERT INTO learner_competency_proposals (
      id, learner_id, proposed_by, title, domain, description, rationale, target_level, status, reviewed_by, review_reason, created_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'lcp_aarav_01',
    'usr_learner_aarav',
    'usr_guide_vikram',
    'Expiry-Day Afternoon Restraint Protocol (Learner-Specific)',
    'RISK_EXECUTION',
    'Custom learner-specific competency tracking Aarav’s restraint during high-gamma Thursday afternoon index sessions.',
    'Specific to Aarav’s F&O participation context; tracked on his profile without modifying the permanent core competency library.',
    'L2',
    'APPROVED',
    'usr_guide_vikram',
    'Approved as a learner-specific competency enhancement; permanent Core Library remains untouched.',
    now,
    now
  );

  // 11. Seed Curated Training Examples
  const runAarav = db.prepare('SELECT * FROM ai_workflow_runs WHERE id = ?').get('run_aarav_01') as any;
  const runRohan = db.prepare('SELECT * FROM ai_workflow_runs WHERE id = ?').get('run_rohan_01') as any;

  const insertTraining = db.prepare(`
    INSERT INTO training_examples (
      id, source_run_id, participant_hash, dataset_version, rubric_version, split,
      consent_verified, deidentified_verified, guide_verified, curator_guide_id,
      inclusion_status, curation_reason, sanitized_context_json, gold_observation_json,
      gold_decision_json, gold_guide_brief_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTraining.run(
    'trn_gold_01',
    'run_aarav_01',
    'pt_8f31a90c42e1b711',
    'frins-curated-v1.0',
    '1.2.0',
    'TRAIN',
    1,
    1,
    1,
    'usr_guide_vikram',
    'INCLUDED',
    'Consented, de-identified, Guide-verified gold example of execution friction and stop-loss hesitation.',
    runAarav.sanitized_input_summary_json,
    runAarav.observational_stage_json,
    runAarav.decision_stage_json,
    runAarav.generative_stage_json,
    now
  );

  insertTraining.run(
    'trn_gold_02',
    'run_rohan_01',
    'pt_2d94e18b77c03a44',
    'frins-curated-v1.0',
    '1.2.0',
    'VALIDATION',
    1,
    1,
    1,
    'usr_guide_vikram',
    'INCLUDED',
    'Consented, de-identified, Guide-verified gold example of NO_CONCERN_ESTABLISHED (prevents model from manufacturing problems).',
    runRohan.sanitized_input_summary_json,
    runRohan.observational_stage_json,
    runRohan.decision_stage_json,
    runRohan.generative_stage_json,
    now
  );

  // 12. Seed Initial Benchmark Run
  const bench = runOfflineBenchmarkSuite();
  db.prepare(`
    INSERT INTO benchmark_runs (
      id, dataset_version, provider_mode, model_version, prompt_version, total_cases, passed_cases,
      grounding_score, uncertainty_calibration_score, safety_block_rate, no_advice_leakage,
      case_results_json, release_gate_status, executed_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'bnch_init_01',
    bench.datasetVersion,
    bench.providerMode,
    bench.modelVersion,
    bench.promptVersion,
    bench.totalCases,
    bench.passedCases,
    bench.groundingScore,
    bench.uncertaintyCalibrationScore,
    bench.safetyBlockRate,
    bench.noAdviceLeakage ? 1 : 0,
    JSON.stringify(bench.cases),
    bench.releaseGateStatus,
    'usr_admin_meera',
    now
  );

  // 13. Seed Initial Public Website Leads
  db.prepare(`
    INSERT INTO leads (id, name, email, track, status, notes, assigned_guide_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'lead_init_01',
    'Siddharth Joshi',
    'siddharth.j@example.com',
    'trader',
    'DISCOVERY_STARTED',
    'Requested 45-min FRINS Conversation via public website.',
    'usr_guide_vikram',
    now
  );

  // 14. Seed Audit Events
  writeAuditEvent({
    actorUserId: 'usr_admin_meera',
    actorRole: 'ADMIN',
    action: 'SYSTEM_INITIALIZED_AND_SEEDED',
    entityType: 'SYSTEM',
    entityId: 'frins-v1.0',
    details: {
      databaseEngine: 'SQLite (better-sqlite3, no Prisma)',
      canonicalQuestionBank: QUESTION_BANK_VERSION,
      rubricVersion: '1.2.0',
      aiProviderMode: process.env.AI_PROVIDER || 'mock'
    }
  });

  writeAuditEvent({
    actorUserId: 'usr_guide_vikram',
    actorRole: 'GUIDE',
    action: 'PDP_VERSION_APPROVED',
    entityType: 'PDP_VERSION',
    entityId: 'pdp_aarav_v1',
    details: {
      learnerId: 'usr_learner_aarav',
      versionNumber: 1,
      status: 'ACTIVE_APPROVED',
      reason: 'Approved following 45-minute human Guide conversation.'
    }
  });

  // Ensure Heikin-Ashi Task & Messages are seeded even on a fresh database
  const haCheck = db.prepare("SELECT COUNT(*) as count FROM learning_tasks WHERE id = 'tsk_heikin_ashi_01'").get() as { count: number };
  if (haCheck.count === 0) {
    const sampleHeikinAshiSvg =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="290" viewBox="0 0 680 290"><rect width="680" height="290" rx="12" fill="#0F172A"/><text x="24" y="34" fill="#F8FAFC" font-family="sans-serif" font-size="14" font-weight="700">STUDENT UPLOADED CHART: NIFTY 15m Heikin-Ashi Trend &amp; Reversal Identification</text><rect x="70" y="170" width="22" height="52" rx="2" fill="#10B981"/><rect x="130" y="138" width="22" height="58" rx="2" fill="#10B981"/><rect x="190" y="106" width="22" height="60" rx="2" fill="#10B981"/><rect x="250" y="78" width="22" height="54" rx="2" fill="#10B981"/><rect x="370" y="64" width="22" height="8" rx="1" fill="#F59E0B"/><rect x="430" y="76" width="22" height="48" rx="2" fill="#EF4444"/></svg>`
      );
    const subText =
      '1. Heikin-Ashi Formula: HA Close = (Open + High + Low + Close) / 4; HA Open = (Prior HA Open + Prior HA Close) / 2.\n' +
      '2. Strong Uptrend Continuation: Marked 5 consecutive green Heikin-Ashi candles with zero lower wicks (no lower shadows).\n' +
      '3. Trend Exhaustion / Reversal Signal: Highlighted the small-bodied Heikin-Ashi Doji with upper and lower shadows before the red reversal candle.\n' +
      '4. Risk Rule: Since Heikin-Ashi prices are synthetic averages, my invalidation stop is placed using the real market price (LTP) on the underlying chart.';
    const aiRev = analyzeStudentTaskSubmissionWithAI({
      taskTitle: 'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
      instructions: 'Identify Heikin-Ashi formula, strong uptrend candles with no lower shadows, and Doji reversal.',
      expectedCriteria: 'Formula (O+H+L+C)/4, no lower wicks in uptrend, Doji exhaustion, synthetic price vs real LTP.',
      learnerSubmission: subText,
      uploadedFileName: 'NIFTY_Heikin_Ashi_Trend_Analysis.svg'
    });
    db.prepare(`
      INSERT INTO learning_tasks (
        id, learner_id, pdp_version_id, course_id, title, category, instructions, expected_criteria,
        competency_code, status, learner_submission, uploaded_file_name, uploaded_file_data,
        ai_review_json, guide_feedback, due_date, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tsk_heikin_ashi_01',
      'usr_learner_aarav',
      'pdp_aarav_v1',
      'crs_heikin_ashi_01',
      'Find Heikin-Ashi Trend Continuation & Reversal Signals on Chart',
      'CHART_CONCEPT_LAB',
      '1. State the Heikin-Ashi Close & Open formula.\n2. Upload a chart marking strong uptrend Heikin-Ashi candles (no lower shadows/wicks).\n3. Mark a Heikin-Ashi Doji exhaustion candle and explain stop-loss placement vs. synthetic HA values.',
      'Must state HA Close = (O+H+L+C)/4 & HA Open = midpoint of prior HA body, identify consecutive green HA bodies with no lower shadows, mark a Doji/indecision candle with both wicks, and note that HA prices are synthetic.',
      'COMP-PROC-01',
      'SUBMITTED',
      subText,
      'NIFTY_Heikin_Ashi_Trend_Analysis.svg',
      sampleHeikinAshiSvg,
      JSON.stringify(aiRev),
      null,
      '2026-10-25',
      now
    );
  }
}
