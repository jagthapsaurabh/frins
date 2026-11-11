import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  CANONICAL_QUESTIONS,
  DISCOVERY_TEST_PERSONAS,
  evaluateDiscoverySessionDeterministically,
  QUESTION_BANK_VERSION
} from './canonicalQuestions.js';
import {
  executeThreeAgentPipeline,
  redactPII,
  runOfflineBenchmarkSuite
} from './aiPipeline.js';
import {
  analyzeStudentTaskSubmissionWithAI,
  db,
  evaluateCandidateDiscoveryResult,
  evaluateLearnerEvidenceSufficiencyAndAdaptation,
  getActiveDiscoveryQuestions,
  getAllDiscoveryQuestions,
  hashPassword,
  initDatabaseAndSeed,
  verifyPassword,
  writeAuditEvent
} from './db.js';

initDatabaseAndSeed();

export const app = express();

// Behind nginx / a cloud load balancer, trust the first proxy so the rate
// limiter sees the real client IP instead of the proxy address.
app.set('trust proxy', 1);

// CORS is same-origin by default because this process also serves the built
// frontend. Set CORS_ORIGIN (comma separated) only if the UI is hosted elsewhere.
const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : {}));
app.use(express.json({ limit: '1mb' }));

function defaultGuideId(): string | null {
  const guide = db
    .prepare("SELECT id FROM users WHERE role = 'GUIDE' AND account_status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  return guide?.id ?? null;
}

/**
 * Human-readable one-time password for accounts provisioned from the admin
 * console. The admin sees it once and passes it on; nobody can log in with a
 * guessable default.
 */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 6)}-${out.slice(6, 12)}-${out.slice(12, 18)}`;
}

// Simple in-memory rate limiter for public endpoints & AI triggers (Requirement 13)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${req.ip || 'local'}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please wait briefly before retrying.'
      });
    }
    return next();
  };
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';
  account_status: string;
  track: string;
  assigned_guide_id: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function resolveAuthUser(req: Request): AuthenticatedUser | undefined {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.headers['x-frins-token'] as string | undefined);

  if (!token) return undefined;

  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.name, u.email, u.role, u.account_status, u.track, u.assigned_guide_id
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!session) return undefined;
  if (session.account_status !== 'ACTIVE') return undefined;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    return undefined;
  }

  return {
    id: session.id,
    name: session.name,
    email: session.email,
    role: session.role,
    account_status: session.account_status,
    track: session.track,
    assigned_guide_id: session.assigned_guide_id
  };
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = resolveAuthUser(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in to access this workspace.'
    });
  }
  req.user = user;
  return next();
}

function requireRole(allowedRoles: Array<'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = resolveAuthUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }
    if (!allowedRoles.includes(user.role)) {
      writeAuditEvent({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'RBAC_ACCESS_DENIED',
        entityType: 'ENDPOINT',
        entityId: req.originalUrl,
        details: { requiredRoles: allowedRoles, attemptedMethod: req.method }
      });
      return res.status(403).json({
        success: false,
        error: `Access forbidden: Role '${user.role}' is not authorised for this resource. Required: ${allowedRoles.join(' or ')}.`
      });
    }
    req.user = user;
    return next();
  };
}

/**
 * Supports either authenticated GUIDE/ADMIN/CURRICULUM_OWNER session OR x-frins-guide-key header
 * per THREE_AGENT_AI_PIPELINE.md and Requirement 10.
 */
function requireGuideOrTrainingKey(req: Request, res: Response, next: NextFunction) {
  const guideKeyHeader = String(req.headers['x-frins-guide-key'] || '').trim();
  const configuredGuideKey = process.env.GUIDE_REVIEW_API_KEY || process.env.FRINS_TRAINING_GUIDE_KEY || '';
  // The published development keys are only honoured outside production, so a
  // deployed instance cannot be opened with a key that is written in the docs.
  const validGuideKeys = new Set<string>();
  if (configuredGuideKey) validGuideKeys.add(configuredGuideKey);
  if (process.env.NODE_ENV !== 'production') {
    validGuideKeys.add('frins-guide-review-key-2026');
    validGuideKeys.add('frins-guide-governance-key-2026');
  }

  const user = resolveAuthUser(req);
  if (user && ['GUIDE', 'ADMIN', 'CURRICULUM_OWNER'].includes(user.role)) {
    req.user = user;
    return next();
  }
  if (guideKeyHeader && validGuideKeys.has(guideKeyHeader)) {
    req.user = {
      id: 'usr_guide_vikram',
      name: 'Guide Key Curator',
      email: 'vikram.guide@frins.org',
      role: 'GUIDE',
      account_status: 'ACTIVE',
      track: 'both',
      assigned_guide_id: null
    };
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Guide/Admin RBAC session or valid x-frins-guide-key header is required for training curation and JSONL export.'
  });
}

// ============================================================================
// 1. HEALTH & AI STATUS ENDPOINTS
// ============================================================================
app.get('/api/health', (_req, res) => {
  const counts = {
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
    discoverySessions: (db.prepare('SELECT COUNT(*) as c FROM discovery_sessions').get() as any).c,
    pdpVersions: (db.prepare('SELECT COUNT(*) as c FROM pdp_versions').get() as any).c,
    aiWorkflowRuns: (db.prepare('SELECT COUNT(*) as c FROM ai_workflow_runs').get() as any).c,
    guideConversations: (db.prepare('SELECT COUNT(*) as c FROM guide_conversations').get() as any).c,
    auditEvents: (db.prepare('SELECT COUNT(*) as c FROM audit_events').get() as any).c
  };
  res.json({
    status: 'ok',
    product: 'FRINS Market Learning',
    database: 'SQLite (better-sqlite3, Prisma-free)',
    questionBankVersion: QUESTION_BANK_VERSION,
    counts,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ai/status', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const providerEnv = (process.env.AI_PROVIDER || 'mock').toLowerCase();
  const hasLiveKey = Boolean(process.env.AI_API_KEY && process.env.AI_API_KEY.trim().length > 0);
  const isLiveActive = (providerEnv === 'real' || providerEnv === 'external') && hasLiveKey;

  res.json({
    providerMode: isLiveActive ? 'LIVE_LLM' : 'MOCK_DETERMINISTIC',
    configuredProviderEnv: providerEnv,
    liveProviderConfigured: isLiveActive,
    modelName: isLiveActive ? process.env.AI_MODEL || 'gpt-4o-mini' : 'frins-deterministic-mock-v1',
    promptVersion: 'frins-prompt-v1.0.0',
    validatorVersion: '1.0.0-safety-gate',
    agents: [
      {
        name: 'ObservationalAgent',
        status: 'ACTIVE',
        mode: isLiveActive ? 'LIVE_LLM_WITH_FALLBACK' : 'MOCK_DETERMINISTIC',
        forbiddenAuthority: 'Cannot diagnose, invent facts, or make final learner-level decisions.'
      },
      {
        name: 'DecisionAgent',
        status: 'ACTIVE',
        mode: 'DETERMINISTIC_GOVERNED_RULES',
        forbiddenAuthority: 'Cannot publish a PDP, change an approved level, or override sufficiency rules.'
      },
      {
        name: 'GenerativeAgent',
        status: 'ACTIVE',
        mode: isLiveActive ? 'LIVE_LLM_WITH_TEMPLATE_FALLBACK' : 'TEMPLATE',
        forbiddenAuthority: 'Cannot present draft as approved or generate stock tips/trade signals.'
      }
    ],
    truthfulTrainingStatus: {
      curationAndExportImplemented: true,
      offlineBenchmarkSuiteImplemented: true,
      proprietaryFineTunedModelExists: false,
      automaticOnlineLearningFromChats: false,
      notice:
        'LLM API integration and training-data curation are active. No proprietary FRINS model weights have been trained; fine-tuning remains behind Stage Gate 4/5.'
    }
  });
});

// ============================================================================
// 2. PUBLIC BOOKING / LEAD CAPTURE & DIRECT CALL BOOKING ENDPOINTS
// ============================================================================
const ALLOWED_LEARNER_TRACKS = ['student_concepts', 'strategy_learner', 'trader', 'investor', 'both', 'other'];

app.post('/api/leads', rateLimit(20, 60_000), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rawTrack = String(req.body?.track || 'trader').trim().toLowerCase();
  const track = ALLOWED_LEARNER_TRACKS.includes(rawTrack) ? rawTrack : 'trader';
  const customTrack = String(req.body?.customTrack || '').trim().slice(0, 160);
  const notes = String(req.body?.notes || req.body?.context || '').trim();
  const submittedNotes = customTrack
    ? `${notes ? `${notes} | ` : ''}Self-described focus: ${customTrack}`
    : notes;

  if (!name || name.length < 2) {
    return res.status(400).json({ success: false, error: 'Please provide your full name (at least 2 characters).' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
  }

  const existing = db.prepare('SELECT id, created_at FROM leads WHERE lower(email) = ?').get(email) as any;
  if (existing) {
    return res.json({
      success: true,
      deduplicated: true,
      leadId: existing.id,
      message: 'Your details are saved. You can continue to your Discovery questions or book a call directly.'
    });
  }

  const leadId = `lead_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO leads (id, name, email, track, status, notes, assigned_guide_id, created_at, custom_track)
    VALUES (?, ?, ?, ?, 'NEW', ?, 'usr_guide_vikram', ?, ?)
  `).run(
    leadId,
    name,
    email,
    track,
    submittedNotes || 'Submitted via public website',
    now,
    track === 'other' ? customTrack || null : null
  );

  writeAuditEvent({
    actorUserId: null,
    actorRole: 'PUBLIC_VISITOR',
    action: 'PUBLIC_BOOKING_LEAD_CREATED',
    entityType: 'LEAD',
    entityId: leadId,
    details: { track, emailDomain: email.split('@')[1] }
  });

  return res.status(201).json({
    success: true,
    leadId,
    message: 'Details saved! Proceeding to your personalised learning journey.'
  });
});

/**
 * Direct Call Booking Endpoint (Book a 1-on-1 Call Directly From Home Page Without Discovery)
 */
app.post('/api/book-call', rateLimit(20, 60_000), (req, res) => {
  const name = String(req.body?.name || req.body?.participantName || '').trim();
  const email = String(req.body?.email || req.body?.participantEmail || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const rawTrack = String(req.body?.track || 'student_concepts').trim().toLowerCase();
  const track = ALLOWED_LEARNER_TRACKS.includes(rawTrack) ? rawTrack : 'student_concepts';
  const customTrack = String(req.body?.customTrack || '').trim().slice(0, 160);
  const preferredDate = String(req.body?.preferredDate || '').trim();
  const preferredTime = String(req.body?.preferredTimeSlot || req.body?.preferredTime || '11:30 AM IST').trim();
  const notes = String(req.body?.notes || '').trim();

  if (!name || name.length < 2) {
    return res.status(400).json({ success: false, error: 'Please provide your full name.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
  }
  if (track === 'other' && customTrack.length < 3) {
    return res.status(400).json({
      success: false,
      error: 'Please tell us what describes you best (at least 3 characters).'
    });
  }
  if (!preferredDate) {
    return res.status(400).json({ success: false, error: 'Please select a preferred date for your call.' });
  }

  const trackLabelMap: Record<string, string> = {
    student_concepts: 'Market Student · Concepts & Foundation',
    strategy_learner: 'Strategy Learner · Understanding & Building Strategies',
    trader: 'Active Trader · Execution & Risk Discipline',
    investor: 'Long-Term Investor · Thesis & Capital Allocation',
    both: 'All-Round Market Learner · Custom Course',
    other: customTrack || 'Other · Self-described focus'
  };

  const bookingId = `book_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();
  const focusSummary = `Direct Call Booking (${trackLabelMap[track] || track}): Custom Course & Mentorship Consultation`;

  db.prepare(`
    INSERT INTO call_bookings (
      id, session_id, participant_name, participant_email, participant_phone, track,
      preferred_date, preferred_time, notes, readiness_score, recommended_focus, status, created_at, custom_track
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DIRECT_CALL_BOOKED', ?, ?)
  `).run(
    bookingId,
    name,
    email,
    phone || null,
    track,
    preferredDate,
    preferredTime,
    customTrack
      ? `${notes || 'Booked directly from Home Page (without prior Discovery)'} | Self-described focus: ${customTrack}`
      : notes || 'Booked directly from Home Page (without prior Discovery)',
    0,
    focusSummary,
    now,
    track === 'other' ? customTrack || null : null
  );

  const existingLead = db.prepare('SELECT id FROM leads WHERE lower(email) = ?').get(email) as any;
  if (existingLead) {
    db.prepare('UPDATE leads SET status = ?, notes = ? WHERE id = ?').run(
      'DIRECT_CALL_BOOKED',
      `Direct Call Booked for ${preferredDate} at ${preferredTime} (${trackLabelMap[track] || track})`,
      existingLead.id
    );
  } else {
    const leadId = `lead_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    db.prepare(`
      INSERT INTO leads (id, name, email, track, status, notes, assigned_guide_id, created_at)
      VALUES (?, ?, ?, ?, 'DIRECT_CALL_BOOKED', ?, 'usr_guide_vikram', ?)
    `).run(
      leadId,
      name,
      email,
      track,
      `Direct Call Booked for ${preferredDate} at ${preferredTime} | ${customTrack ? `Self-described focus: ${customTrack}` : notes}`,
      now
    );
  }

  writeAuditEvent({
    actorUserId: null,
    actorRole: 'PUBLIC_VISITOR',
    action: 'DIRECT_CALL_BOOKED_WITHOUT_DISCOVERY',
    entityType: 'CALL_BOOKING',
    entityId: bookingId,
    details: { name, track, preferredDate, preferredTime }
  });

  return res.status(201).json({
    success: true,
    bookingId,
    booking: {
      id: bookingId,
      participantName: name,
      participantEmail: email,
      phone,
      track,
      trackLabel: trackLabelMap[track] || track,
      preferredDate,
      preferredTimeSlot: preferredTime,
      notes,
      status: 'DIRECT_CALL_BOOKED'
    }
  });
});

// ============================================================================
// 3. AUTHENTICATION
// ============================================================================
app.post('/api/auth/login', rateLimit(30, 60_000), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Enter your email and password.'
    });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE lower(email) = ?')
    .get(email) as any;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password. Please check your credentials and try again.'
    });
  }

  if (user.account_status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      error: 'This account is currently suspended. Please contact a FRINS Administrator.'
    });
  }

  const token = `tok_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO auth_sessions (token, user_id, role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, user.id, user.role, expiresAt, now.toISOString());

  writeAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'USER_LOGIN_SUCCESS',
    entityType: 'USER',
    entityId: user.id,
    details: { role: user.role }
  });

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      track: user.track,
      assigned_guide_id: user.assigned_guide_id
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});


// ============================================================================
// 4. DYNAMIC ADMIN-CONFIGURABLE DISCOVERY ENDPOINTS (N Questions)
// ============================================================================
app.get('/api/discovery/questions', (req, res) => {
  const requester = resolveAuthUser(req);
  const isAdmin = requester?.role === 'ADMIN' || requester?.role === 'CURRICULUM_OWNER';
  // Only admins may pull the full bank (including retired questions).
  const includeAll = isAdmin && req.query.all === 'true';
  const activeQuestions = getActiveDiscoveryQuestions();
  const allQuestions = includeAll ? getAllDiscoveryQuestions() : activeQuestions;

  const payload: Record<string, unknown> = {
    success: true,
    questionBankVersion: QUESTION_BANK_VERSION,
    totalQuestions: activeQuestions.length,
    questions: allQuestions
  };
  // Sample answer sets are test fixtures. They are not part of the public API.
  if (isAdmin) payload.personas = DISCOVERY_TEST_PERSONAS;

  res.json(payload);
});

app.post('/api/discovery/start', rateLimit(30, 60_000), (req, res) => {
  const user = resolveAuthUser(req);
  const participantName = String(req.body?.participantName || user?.name || 'Market Participant').trim();
  const participantEmail = String(req.body?.participantEmail || user?.email || 'participant@example.com').trim().toLowerCase();
  const track = ALLOWED_LEARNER_TRACKS.includes(req.body?.track) ? req.body.track : user?.track || 'trader';
  const customTrack = String(req.body?.customTrack || '').trim().slice(0, 160);

  if (track === 'other' && customTrack.length < 3) {
    return res.status(400).json({
      success: false,
      error: 'Please tell us what describes you best (at least 3 characters).'
    });
  }

  const sessionId = `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();
  const activeQuestions = getActiveDiscoveryQuestions();

  const initialEval = evaluateDiscoverySessionDeterministically({});

  db.prepare(`
    INSERT INTO discovery_sessions (
      id, participant_user_id, participant_name, participant_email, track, custom_track,
      question_bank_version, status, completeness_pct, sufficiency_status, exit_pathway,
      contradiction_flags_json, domain_summary_json, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 0, ?, ?, '[]', ?, ?, ?)
  `).run(
    sessionId,
    user?.id || null,
    participantName,
    participantEmail,
    track,
    track === 'other' ? customTrack : null,
    QUESTION_BANK_VERSION,
    initialEval.sufficiencyStatus,
    initialEval.exitPathway,
    JSON.stringify(initialEval.domainBreakdown),
    now,
    now
  );

  writeAuditEvent({
    actorUserId: user?.id || null,
    actorRole: user?.role || 'PUBLIC_VISITOR',
    action: 'DISCOVERY_SESSION_STARTED',
    entityType: 'DISCOVERY_SESSION',
    entityId: sessionId,
    details: { track, customTrack: track === 'other' ? customTrack : null, configuredQuestionCount: activeQuestions.length }
  });

  res.status(201).json({
    success: true,
    sessionId,
    session: {
      id: sessionId,
      participant_name: participantName,
      participant_email: participantEmail,
      track,
      custom_track: track === 'other' ? customTrack : null
    },
    questionBankVersion: QUESTION_BANK_VERSION,
    totalQuestions: activeQuestions.length
  });
});

app.get('/api/discovery/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = db.prepare('SELECT * FROM discovery_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    return res.status(404).json({ success: false, error: 'Discovery session not found.' });
  }

  const rows = db
    .prepare('SELECT question_id, domain, answer_value, answer_text, answered_at FROM discovery_responses WHERE session_id = ?')
    .all(sessionId) as any[];

  const responsesMap: Record<string, { answerValue: string; answerText?: string }> = {};
  const flatAnswers: Record<string, string> = {};
  for (const r of rows) {
    responsesMap[r.question_id] = {
      answerValue: r.answer_value,
      answerText: r.answer_text || undefined
    };
    flatAnswers[r.question_id] = r.answer_value || r.answer_text || '';
  }

  const evaluation = evaluateDiscoverySessionDeterministically(responsesMap);
  const candidateResult = evaluateCandidateDiscoveryResult(flatAnswers, session.track, session.custom_track || '');
  const latestAiRun = db
    .prepare('SELECT * FROM ai_workflow_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId) as any;
  const existingBooking = db
    .prepare('SELECT * FROM call_bookings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId) as any;

  res.json({
    success: true,
    session: {
      ...session,
      answers: flatAnswers,
      contradictionFlags: JSON.parse(session.contradiction_flags_json || '[]'),
      domainSummary: JSON.parse(session.domain_summary_json || '{}')
    },
    responses: responsesMap,
    evaluation,
    candidateResult,
    callBooking: existingBooking || null,
    latestAiRun: latestAiRun
      ? {
          id: latestAiRun.id,
          traceId: latestAiRun.trace_id,
          providerMode: latestAiRun.provider_mode,
          modelName: latestAiRun.model_name,
          runStatus: latestAiRun.run_status,
          reviewState: latestAiRun.review_state,
          observationalStage: JSON.parse(latestAiRun.observational_stage_json),
          decisionStage: JSON.parse(latestAiRun.decision_stage_json),
          generativeStage: JSON.parse(latestAiRun.generative_stage_json),
          validatorResult: JSON.parse(latestAiRun.validator_result_json),
          createdAt: latestAiRun.created_at
        }
      : null
  });
});

app.post('/api/discovery/answer', (req, res) => {
  const { sessionId, questionId, answer, answerValue, answerText, batchAnswers, answersBatch } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required.' });
  }

  const session = db.prepare('SELECT * FROM discovery_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    return res.status(404).json({ success: false, error: 'Discovery session not found.' });
  }

  const allConfiguredQuestions = getAllDiscoveryQuestions();
  const activeConfiguredQuestions = getActiveDiscoveryQuestions();
  const now = new Date().toISOString();
  const upsertStmt = db.prepare(`
    INSERT INTO discovery_responses (id, session_id, question_id, domain, answer_value, answer_text, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, question_id) DO UPDATE SET
      answer_value = excluded.answer_value,
      answer_text = excluded.answer_text,
      answered_at = excluded.answered_at
  `);

  const incomingBatch = batchAnswers || answersBatch;

  if (incomingBatch && typeof incomingBatch === 'object') {
    const tx = db.transaction(() => {
      for (const [qId, val] of Object.entries(incomingBatch)) {
        const q =
          allConfiguredQuestions.find((item) => item.id === qId) ||
          CANONICAL_QUESTIONS.find((item) => item.id === qId);
        const domain = q ? q.domain : 'DECISION_PROCESS';
        const strVal = String(val || '').trim();
        if (!strVal) continue;
        upsertStmt.run(
          `resp_${sessionId}_${qId}`,
          sessionId,
          qId,
          domain,
          strVal,
          strVal,
          now
        );
      }
    });
    tx();
  } else {
    const q =
      allConfiguredQuestions.find((item) => item.id === questionId) ||
      CANONICAL_QUESTIONS.find((item) => item.id === questionId);
    if (!q) {
      return res.status(400).json({ success: false, error: `Invalid questionId: ${questionId}` });
    }
    const strVal = String(answer ?? answerValue ?? answerText ?? '').trim();
    if (!strVal) {
      return res.status(400).json({ success: false, error: 'Answer cannot be empty.' });
    }
    upsertStmt.run(
      `resp_${sessionId}_${q.id}`,
      sessionId,
      q.id,
      q.domain,
      strVal,
      strVal,
      now
    );
  }

  const rows = db
    .prepare('SELECT question_id, answer_value, answer_text FROM discovery_responses WHERE session_id = ?')
    .all(sessionId) as any[];
  const responsesMap: Record<string, { answerValue: string; answerText?: string }> = {};
  const flatAnswers: Record<string, string> = {};
  for (const r of rows) {
    responsesMap[r.question_id] = { answerValue: r.answer_value, answerText: r.answer_text || undefined };
    flatAnswers[r.question_id] = r.answer_value || r.answer_text || '';
  }

  const evaluation = evaluateDiscoverySessionDeterministically(responsesMap);
  const candidateResult = evaluateCandidateDiscoveryResult(flatAnswers, session.track, session.custom_track || '');
  const newStatus = candidateResult.completenessPct >= 100 ? 'COMPLETED' : 'IN_PROGRESS';

  db.prepare(`
    UPDATE discovery_sessions
    SET status = ?,
        completeness_pct = ?,
        sufficiency_status = ?,
        exit_pathway = ?,
        contradiction_flags_json = ?,
        domain_summary_json = ?,
        completed_at = CASE WHEN ? = 'COMPLETED' AND completed_at IS NULL THEN ? ELSE completed_at END,
        updated_at = ?
    WHERE id = ?
  `).run(
    newStatus,
    candidateResult.completenessPct,
    evaluation.sufficiencyStatus,
    evaluation.exitPathway,
    JSON.stringify(evaluation.contradictionFlags),
    JSON.stringify(evaluation.domainBreakdown),
    newStatus,
    now,
    now,
    sessionId
  );

  res.json({
    success: true,
    sessionId,
    status: newStatus,
    answers: flatAnswers,
    evaluation,
    candidateResult
  });
});

/**
 * Candidate books a 1-on-1 call with our team right after solving the Discovery questions
 */
app.post('/api/discovery/:sessionId/book-call', (req, res) => {
  const { sessionId } = req.params;
  const session = db.prepare('SELECT * FROM discovery_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    return res.status(404).json({ success: false, error: 'Discovery session not found.' });
  }

  const preferredDate = String(req.body?.preferredDate || '').trim();
  const preferredTime = String(req.body?.preferredTimeSlot || req.body?.preferredTime || '11:30 AM IST').trim();
  const phone = String(req.body?.phone || '').trim();
  const notes = String(req.body?.notes || '').trim();

  if (!preferredDate) {
    return res.status(400).json({ success: false, error: 'Please select a preferred date for your call.' });
  }

  const rows = db
    .prepare('SELECT question_id, answer_value FROM discovery_responses WHERE session_id = ?')
    .all(sessionId) as any[];
  const flatAnswers: Record<string, string> = {};
  for (const r of rows) {
    flatAnswers[r.question_id] = r.answer_value;
  }
  const candidateResult = evaluateCandidateDiscoveryResult(flatAnswers, session.track, session.custom_track || '');
  const focusSummary = candidateResult.focusAreasForTeam.join(' | ');

  const bookingId = `book_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO call_bookings (
      id, session_id, participant_name, participant_email, participant_phone, track,
      preferred_date, preferred_time, notes, readiness_score, recommended_focus, status, created_at, custom_track
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)
  `).run(
    bookingId,
    sessionId,
    session.participant_name,
    session.participant_email,
    phone || null,
    session.track,
    preferredDate,
    preferredTime,
    notes || `Recommended: ${candidateResult.recommendedProgram}`,
    candidateResult.overallReadinessScore,
    focusSummary || candidateResult.recommendedProgram,
    now,
    session.custom_track || null
  );

  // Also update or create lead status so Admin & Guide see the booked call
  db.prepare(`
    UPDATE leads SET status = 'CALL_BOOKED', notes = ? WHERE lower(email) = ?
  `).run(
    `Call booked for ${preferredDate} at ${preferredTime} | Score: ${candidateResult.overallReadinessScore}% | Focus: ${candidateResult.recommendedProgram}`,
    String(session.participant_email || '').toLowerCase()
  );

  writeAuditEvent({
    actorUserId: session.participant_user_id || null,
    actorRole: 'CANDIDATE',
    action: 'DISCOVERY_CALL_BOOKED',
    entityType: 'CALL_BOOKING',
    entityId: bookingId,
    details: {
      sessionId,
      participantName: session.participant_name,
      preferredDate,
      preferredTime,
      readinessScore: candidateResult.overallReadinessScore
    }
  });

  res.status(201).json({
    success: true,
    bookingId,
    candidateResult,
    booking: {
      id: bookingId,
      sessionId,
      participantName: session.participant_name,
      participantEmail: session.participant_email,
      preferredDate,
      preferredTime,
      preferredTimeSlot: preferredTime,
      phone,
      notes,
      readinessScore: candidateResult.overallReadinessScore,
      recommendedProgram: candidateResult.recommendedProgram,
      status: 'CONFIRMED'
    }
  });
});

// ============================================================================
// 5. THREE-AGENT AI PIPELINE EXECUTION (/api/ai/run & /api/discovery/synthesize)
// ============================================================================
async function handleRunThreeAgentPipeline(req: Request, res: Response) {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required to generate your Discovery result.' });
  }

  const session = db.prepare('SELECT * FROM discovery_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    return res.status(404).json({ success: false, error: 'Discovery session not found.' });
  }

  const rows = db
    .prepare('SELECT question_id, answer_value, answer_text FROM discovery_responses WHERE session_id = ?')
    .all(sessionId) as any[];
  const responsesMap: Record<string, { answerValue: string; answerText?: string }> = {};
  const flatAnswers: Record<string, string> = {};
  for (const r of rows) {
    responsesMap[r.question_id] = { answerValue: r.answer_value, answerText: r.answer_text || undefined };
    flatAnswers[r.question_id] = r.answer_value || r.answer_text || '';
  }

  const evaluation = evaluateDiscoverySessionDeterministically(responsesMap);
  const candidateResult = evaluateCandidateDiscoveryResult(flatAnswers, session.track, session.custom_track || '');

  const pipelineResult = await executeThreeAgentPipeline(
    sessionId,
    session.participant_name,
    session.participant_email,
    session.track,
    responsesMap,
    evaluation
  );

  const runId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_workflow_runs (
      id, trace_id, session_id, learner_id, provider_mode, model_name, prompt_version, run_status,
      sanitized_input_summary_json, observational_stage_json, decision_stage_json, generative_stage_json,
      validator_result_json, review_state, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_GUIDE_REVIEW', ?, ?)
  `).run(
    runId,
    pipelineResult.traceId,
    sessionId,
    session.participant_user_id || null,
    pipelineResult.providerMode,
    pipelineResult.modelName,
    pipelineResult.promptVersion,
    pipelineResult.runStatus,
    JSON.stringify(pipelineResult.sanitizedPackage),
    JSON.stringify(pipelineResult.observationalStage),
    JSON.stringify(pipelineResult.decisionStage),
    JSON.stringify(pipelineResult.generativeStage),
    JSON.stringify(pipelineResult.validatorResult),
    pipelineResult.latencyMs,
    now
  );

  db.prepare("UPDATE discovery_sessions SET status = 'COMPLETED', updated_at = ? WHERE id = ?").run(now, sessionId);

  const user = resolveAuthUser(req);
  writeAuditEvent({
    correlationId: pipelineResult.traceId,
    actorUserId: user?.id || session.participant_user_id || null,
    actorRole: user?.role || 'PUBLIC_VISITOR',
    action: 'THREE_AGENT_AI_PIPELINE_EXECUTED',
    entityType: 'AI_WORKFLOW_RUN',
    entityId: runId,
    details: {
      sessionId,
      traceId: pipelineResult.traceId,
      providerMode: pipelineResult.providerMode,
      proposedAction: pipelineResult.decisionStage.proposedAction,
      validatorPassed: pipelineResult.validatorResult.passed,
      reviewState: 'PENDING_GUIDE_REVIEW'
    }
  });

  return res.json({
    success: true,
    runId,
    ...pipelineResult,
    aiOutput: pipelineResult,
    deterministicEvaluation: evaluation,
    candidateResult,
    reviewState: 'PENDING_GUIDE_REVIEW'
  });
}

app.post('/api/ai/run', requireRole(['ADMIN', 'CURRICULUM_OWNER']), rateLimit(20, 60_000), handleRunThreeAgentPipeline);
app.post('/api/discovery/synthesize', rateLimit(20, 60_000), handleRunThreeAgentPipeline);

app.get('/api/ai/runs', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, s.participant_name, s.track, s.sufficiency_status, s.exit_pathway
       FROM ai_workflow_runs r
       LEFT JOIN discovery_sessions s ON s.id = r.session_id
       ORDER BY r.created_at DESC`
    )
    .all() as any[];

  res.json({
    success: true,
    runs: rows.map((r) => ({
      id: r.id,
      traceId: r.trace_id,
      sessionId: r.session_id,
      learnerId: r.learner_id,
      participantName: r.participant_name || 'Participant',
      track: r.track || 'trader',
      sufficiencyStatus: r.sufficiency_status,
      exitPathway: r.exit_pathway,
      providerMode: r.provider_mode,
      modelName: r.model_name,
      promptVersion: r.prompt_version,
      runStatus: r.run_status,
      reviewState: r.review_state,
      guideReviewNotes: r.guide_review_notes,
      latencyMs: r.latency_ms,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      sanitizedInputSummary: JSON.parse(r.sanitized_input_summary_json),
      observationalStage: JSON.parse(r.observational_stage_json),
      decisionStage: JSON.parse(r.decision_stage_json),
      generativeStage: JSON.parse(r.generative_stage_json),
      validatorResult: JSON.parse(r.validator_result_json)
    }))
  });
});

app.post('/api/ai/test-safety', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const sampleText = String(req.body?.sampleText || '');
  const participantName = String(req.body?.participantName || 'Aarav Mehta');
  const participantEmail = String(req.body?.participantEmail || 'aarav@example.com');

  const redacted = redactPII(sampleText, participantName, participantEmail);
  const prohibitedMatches: string[] = [];

  const rules = [
    { pattern: /\b(buy|sell|short)\s+(nifty|banknifty|sensex|reliance|hdfc|infosys|tcs|options|calls|puts|shares)\b/i, label: 'Specific instrument buy/sell directive' },
    { pattern: /\b(guaranteed\s+returns?|sure\s+shot\s+profit|risk[- ]free\s+return|100%\s+accuracy)\b/i, label: 'Guaranteed return claim' },
    { pattern: /\b(target\s+price\s+of\s+rs|stop\s+loss\s+at\s+rs|intraday\s+tip|jackpot\s+call)\b/i, label: 'Price target or stock tip signal' },
    { pattern: /\b(clinically\s+diagnosed|pathological\s+gambler|psychiatric\s+disorder|adhd|bipolar)\b/i, label: 'Unsupported clinical/psychological diagnosis' }
  ];

  for (const r of rules) {
    if (r.pattern.test(sampleText)) {
      prohibitedMatches.push(r.label);
    }
  }

  res.json({
    success: true,
    passedSafetyGate: prohibitedMatches.length === 0,
    redactedText: redacted,
    prohibitedMatches
  });
});

// ============================================================================
// 6. LEARNER DASHBOARD ENDPOINTS (RBAC: Own records only; no Guide private notes!)
// ============================================================================
app.get('/api/learner/dashboard', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const targetLearnerId =
    req.user!.role === 'LEARNER'
      ? req.user!.id
      : String(req.query.learnerId || 'usr_learner_aarav');

  const userRecord = db
    .prepare('SELECT id, name, email, role, track, assigned_guide_id, created_at FROM users WHERE id = ?')
    .get(targetLearnerId) as any;

  if (!userRecord) {
    return res.status(404).json({ success: false, error: 'Learner profile not found.' });
  }

  const profile = db
    .prepare(
      `SELECT id, learner_id, approved_level, proposed_level, level_review_state,
              primary_track, evidence_status, market_context_summary, rubric_version, updated_at
       FROM student_learning_profiles WHERE learner_id = ?`
    )
    .get(targetLearnerId) as any;

  const guide = userRecord.assigned_guide_id
    ? db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userRecord.assigned_guide_id)
    : null;

  const pdpVersions = db
    .prepare('SELECT * FROM pdp_versions WHERE learner_id = ? ORDER BY version_number DESC')
    .all(targetLearnerId) as any[];

  const tasks = db
    .prepare('SELECT * FROM learning_tasks WHERE learner_id = ? ORDER BY due_date ASC')
    .all(targetLearnerId) as any[];

  const formattedPDPs = pdpVersions.map((p) => {
    const rawObjectives = JSON.parse(p.objectives_json || '[]');
    const rawFocus = JSON.parse(p.competency_focus_json || '[]');
    const structuredObjectives = rawObjectives.map((obj: any, idx: number) =>
      typeof obj === 'string'
        ? {
            focusArea: `Objective ${idx + 1}`,
            competencyCode: rawFocus[idx % Math.max(1, rawFocus.length)] || 'COMP-PROC-01',
            targetHabit: obj,
            successCriteria: 'Verified across 5 consecutive market decisions in practice log'
          }
        : obj
    );
    const practiceTasks = tasks
      .filter((t) => !p.id || t.pdp_version_id === p.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        cadence: t.category || 'DELIBERATE_PRACTICE',
        description: t.instructions
      }));

    return {
      ...p,
      source_mode: p.drafted_by,
      reviewed_by_guide_id: p.approved_by_guide_id,
      review_reason: p.approval_reason,
      objectives: structuredObjectives,
      competencyFocus: rawFocus,
      practiceTasks
    };
  });

  const activeApprovedPDP = formattedPDPs.find((p) => p.status === 'ACTIVE_APPROVED') || null;
  const pendingDraftPDP = formattedPDPs.find((p) => p.status === 'PENDING_GUIDE_REVIEW') || null;

  const reflections = db
    .prepare('SELECT * FROM reflections WHERE learner_id = ? ORDER BY created_at DESC')
    .all(targetLearnerId);

  const evidenceItems = db
    .prepare('SELECT * FROM evidence_items WHERE learner_id = ? ORDER BY created_at DESC')
    .all(targetLearnerId) as any[];

  const evidenceRecords = evidenceItems.map((ev) => ({
    ...ev,
    evidence_type: ev.source_type,
    weight_category: ev.sufficiency_weight,
    content_summary: ev.summary,
    guide_observation: ev.uncertainty_note
  }));

  const assessments = db
    .prepare('SELECT * FROM assessments WHERE learner_id = ? ORDER BY created_at DESC')
    .all(targetLearnerId);

  const guideConversations = db
    .prepare('SELECT id, duration_minutes, conversation_summary, agreed_learning_needs_json, conducted_at FROM guide_conversations WHERE learner_id = ? ORDER BY conducted_at DESC')
    .all(targetLearnerId) as any[];

  const competencyDecisions = db
    .prepare('SELECT * FROM competency_decisions WHERE learner_id = ? ORDER BY decided_at DESC')
    .all(targetLearnerId);

  const learnerSpecificCompetencies = db
    .prepare('SELECT * FROM learner_competency_proposals WHERE learner_id = ? ORDER BY created_at DESC')
    .all(targetLearnerId);

  const coreCompetencies = db.prepare('SELECT * FROM core_competencies WHERE status = ?').all('ACTIVE');
  const sufficiencyEvaluation = evaluateLearnerEvidenceSufficiencyAndAdaptation(targetLearnerId);

  // Assigned custom courses for this student
  const rawStudentCourses = db
    .prepare(`
      SELECT sc.*, c.title as course_title, c.track as course_track, c.level as course_level,
             c.description as course_description, c.modules_json
      FROM student_courses sc
      JOIN courses c ON c.id = sc.course_id
      WHERE sc.learner_id = ?
      ORDER BY sc.assigned_at DESC
    `)
    .all(targetLearnerId) as any[];

  const assignedCourses = rawStudentCourses.map((sc) => ({
    ...sc,
    modules: JSON.parse(sc.modules_json || '[]')
  }));

  // Course questions set by Admin. Correct answers/explanations are only released after the student answers.
  const assignedCourseIds = Array.from(new Set(assignedCourses.map((c) => c.course_id)));
  const rawCourseQuestions = (assignedCourseIds.length
    ? db
        .prepare(
          `SELECT * FROM course_questions WHERE course_id IN (${assignedCourseIds.map(() => '?').join(',')}) ORDER BY created_at ASC`
        )
        .all(...assignedCourseIds)
    : []) as any[];
  const questionAttempts = db
    .prepare('SELECT * FROM course_question_attempts WHERE learner_id = ? ORDER BY attempted_at DESC')
    .all(targetLearnerId) as any[];

  const courseQuestions = rawCourseQuestions.map((q) => {
    const attempt = questionAttempts.find((a) => a.question_id === q.id) || null;
    return {
      id: q.id,
      course_id: q.course_id,
      prompt: q.prompt,
      options: JSON.parse(q.options_json || '[]'),
      explanation: attempt ? q.explanation : null,
      correctOptionIndex: attempt ? q.correct_option_index : null,
      lastAttempt: attempt
        ? {
            selectedOptionIndex: attempt.selected_option_index,
            isCorrect: Boolean(attempt.is_correct),
            attemptedAt: attempt.attempted_at
          }
        : null
    };
  });

  // Sanitize tasks for Student view: include uploaded result & chat messages, but NEVER expose ai_review_json!
  const sanitizedStudentTasks = (tasks as any[]).map((t) => {
    const msgs = db
      .prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC')
      .all(t.id);
    const { ai_review_json, ...safeTask } = t;
    return {
      ...safeTask,
      messages: msgs
    };
  });

  res.json({
    success: true,
    learner: userRecord,
    assignedGuide: guide,
    profile: profile ? { ...profile, track: profile.primary_track || userRecord.track } : null, // Explicitly omits guide_private_notes per Requirement 6.3!
    activeApprovedPDP,
    pendingDraftPDP,
    allPDPVersions: formattedPDPs,
    assignedCourses,
    courseQuestions,
    tasks: sanitizedStudentTasks,
    reflections,
    evidenceItems,
    evidenceRecords,
    assessments,
    guideConversations: guideConversations.map((c) => ({
      ...c,
      agreedLearningNeeds: JSON.parse(c.agreed_learning_needs_json || '[]')
    })),
    sufficiencyEvaluation,
    competencyDecisions,
    learnerSpecificCompetencies,
    coreCompetencies
  });
});

// Student answers an Admin-defined course question; the correct answer is revealed only in the response.
app.post('/api/learner/course-questions/:questionId/answer', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const questionId = String(req.params.questionId);
  const learnerId = req.user!.role === 'LEARNER' ? req.user!.id : String(req.body?.learnerId || 'usr_learner_aarav');
  const selectedOptionIndex = Number(req.body?.selectedOptionIndex);

  const question = db.prepare('SELECT * FROM course_questions WHERE id = ?').get(questionId) as any;
  if (!question) {
    return res.status(404).json({ success: false, error: 'Course question not found.' });
  }

  const options = JSON.parse(question.options_json || '[]');
  if (!Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0 || selectedOptionIndex >= options.length) {
    return res.status(400).json({ success: false, error: 'Please select a valid answer option.' });
  }

  const isCorrect = selectedOptionIndex === Number(question.correct_option_index);
  const attemptId = `cqa_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO course_question_attempts (id, question_id, learner_id, selected_option_index, is_correct, attempted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(attemptId, questionId, learnerId, selectedOptionIndex, isCorrect ? 1 : 0, now);

  return res.json({
    success: true,
    isCorrect,
    correctOptionIndex: Number(question.correct_option_index),
    correctAnswer: options[Number(question.correct_option_index)],
    explanation: question.explanation || '',
    attemptId
  });
});

app.post('/api/learner/practice', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const learnerId = req.user!.role === 'LEARNER' ? req.user!.id : String(req.body?.learnerId || 'usr_learner_aarav');
  const competencyCode = String(req.body?.competencyCode || 'COMP-PROC-01').trim();
  const taskTitle = String(req.body?.taskTitle || 'Deliberate Practice Submission').trim();
  const scenarioContext = String(req.body?.scenarioContext || 'Market session check').trim();
  const submittedResponse = String(req.body?.submittedResponse || '').trim();

  if (!submittedResponse) {
    return res.status(400).json({ success: false, error: 'Submitted response is required.' });
  }

  const taskId = `tsk_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const evId = `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO learning_tasks (
      id, learner_id, pdp_version_id, title, category, competency_code,
      instructions, status, due_date, learner_submission, submitted_at, created_at
    ) VALUES (?, ?, 'pdp_aarav_v1', ?, 'DELIBERATE_PRACTICE', ?, ?, 'SUBMITTED', ?, ?, ?, ?)
  `).run(
    taskId,
    learnerId,
    taskTitle,
    competencyCode,
    scenarioContext,
    now.slice(0, 10),
    submittedResponse,
    now,
    now
  );

  db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code,
      sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, 'PRACTICE_ARTEFACT', ?, ?, ?, ?, 'MEDIUM_PRACTICE', 'Submitted deliberate practice artefact.', 'PENDING_REVIEW', ?)
  `).run(
    evId,
    learnerId,
    taskId,
    `Practice Submission: ${taskTitle}`,
    `${scenarioContext}: ${submittedResponse}`,
    competencyCode,
    now
  );

  const sufficiencyEvaluation = evaluateLearnerEvidenceSufficiencyAndAdaptation(learnerId);
  db.prepare('UPDATE student_learning_profiles SET evidence_status = ?, updated_at = ? WHERE learner_id = ?').run(
    sufficiencyEvaluation.evidenceStatus,
    now,
    learnerId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_PRACTICE_ARTEFACT_SUBMITTED',
    entityType: 'LEARNING_TASK',
    entityId: taskId,
    details: { competencyCode, evidenceItemId: evId, updatedEvidenceStatus: sufficiencyEvaluation.evidenceStatus }
  });

  res.status(201).json({ success: true, taskId, evidenceItemId: evId, sufficiencyEvaluation });
});

app.post('/api/learner/tasks/:taskId/submit', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const { taskId } = req.params;
  const submissionText = String(req.body?.submissionText || '').trim();
  const uploadedFileName = req.body?.uploadedFileName ? String(req.body.uploadedFileName).trim() : null;
  const uploadedFileData = req.body?.uploadedFileData ? String(req.body.uploadedFileData).trim() : null;

  if (!submissionText || submissionText.length < 5) {
    return res.status(400).json({
      success: false,
      error: 'Please enter your task result/answer or observations before submitting.'
    });
  }

  const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(taskId) as any;
  if (!task) {
    return res.status(404).json({ success: false, error: 'Learning task not found.' });
  }
  if (req.user!.role === 'LEARNER' && task.learner_id !== req.user!.id) {
    return res.status(403).json({ success: false, error: 'You may only submit your own assigned learning tasks.' });
  }

  // Run Internal AI Pre-Review BEFORE Admin checks the task (stored for Admin & Team only, never returned to the student)
  const aiReview = analyzeStudentTaskSubmissionWithAI({
    taskTitle: task.title,
    instructions: task.instructions,
    expectedCriteria: task.expected_criteria || '',
    learnerSubmission: submissionText,
    uploadedFileName: uploadedFileName || task.uploaded_file_name || undefined
  });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE learning_tasks
    SET status = 'SUBMITTED',
        learner_submission = ?,
        uploaded_file_name = COALESCE(?, uploaded_file_name),
        uploaded_file_data = COALESCE(?, uploaded_file_data),
        ai_review_json = ?,
        submitted_at = ?
    WHERE id = ?
  `).run(submissionText, uploadedFileName, uploadedFileData, JSON.stringify(aiReview), now, taskId);

  const evId = `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code,
      sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, 'PRACTICE_ARTEFACT', ?, ?, ?, ?, 'MEDIUM_PRACTICE', 'Submitted practice artefact awaiting Guide verification.', 'PENDING_REVIEW', ?)
  `).run(
    evId,
    task.learner_id,
    taskId,
    `Practice Submission: ${task.title}`,
    submissionText,
    task.competency_code,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_TASK_PRACTICE_SUBMITTED',
    entityType: 'LEARNING_TASK',
    entityId: taskId,
    details: {
      competencyCode: task.competency_code,
      evidenceItemId: evId,
      uploadedFileName,
      internalAiPreReviewVerdict: aiReview.verdict
    }
  });

  // Note: aiReview is intentionally OMITTED from the response to the learner!
  res.json({ success: true, taskId, evidenceItemId: evId });
});

app.post('/api/tasks/:taskId/chat', requireRole(['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { taskId } = req.params;
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message text is required.' });
  }

  const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(taskId) as any;
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found.' });
  }
  if (req.user!.role === 'LEARNER' && task.learner_id !== req.user!.id) {
    return res.status(403).json({ success: false, error: 'You can only chat on your own assigned tasks.' });
  }

  const msgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO task_messages (id, task_id, sender_user_id, sender_name, sender_role, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, taskId, req.user!.id, req.user!.name, req.user!.role, message, now);

  const messages = db
    .prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId);

  res.status(201).json({
    success: true,
    messageId: msgId,
    messages
  });
});

app.post('/api/learner/reflections', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const learnerId = req.user!.role === 'LEARNER' ? req.user!.id : String(req.body?.learnerId || req.user!.id);
  const title = String(req.body?.title || 'Structured Post-Session Reflection').trim();
  const marketContext = String(req.body?.marketContext || req.body?.emotionalStateTrigger || 'Regular session reflection').trim();
  const decisionTaken = String(req.body?.decisionTaken || 'Evaluated decision process adherence').trim();
  const processAdherence = String(req.body?.processAdherence || (req.body?.processAdherenceSelfRating ? `Self-Rating ${req.body.processAdherenceSelfRating}/5` : 'FOLLOWED_PLAN'));
  const emotionalState = String(req.body?.emotionalState || req.body?.emotionalStateTrigger || 'Observed calm').trim();
  const reflectionNotes = String(req.body?.reflectionNotes || req.body?.reflectionText || '').trim();
  const competencyCode = String(req.body?.competencyCode || 'COMP-REV-04');

  if (!reflectionNotes) {
    return res.status(400).json({
      success: false,
      error: 'Reflection narrative is required.'
    });
  }

  const refId = `ref_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const evId = `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO reflections (
      id, learner_id, title, market_context, decision_taken, process_adherence,
      emotional_state, reflection_notes, evidence_weight, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STRUCTURED_JOURNAL', ?)
  `).run(
    refId,
    learnerId,
    title,
    marketContext || 'Regular session reflection',
    decisionTaken,
    processAdherence,
    emotionalState || 'Observed calm',
    reflectionNotes,
    now
  );

  db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code,
      sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, 'STRUCTURED_REFLECTION', ?, ?, ?, ?, 'LOW_REFLECTION', 'Self-reported reflection; carries lower sufficiency weight than formal assessment per Rubric v1.2.0.', 'PENDING_REVIEW', ?)
  `).run(
    evId,
    learnerId,
    refId,
    `Reflection Log: ${title}`,
    `${processAdherence}: ${reflectionNotes.slice(0, 200)}`,
    competencyCode,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_REFLECTION_SUBMITTED',
    entityType: 'REFLECTION',
    entityId: refId,
    details: { learnerId, processAdherence, evidenceWeight: 'LOW_REFLECTION' }
  });

  res.status(201).json({ success: true, reflectionId: refId, evidenceItemId: evId });
});

// ============================================================================
// 7. GUIDE WORKSPACE & GOVERNANCE ENDPOINTS (RBAC: GUIDE or ADMIN only)
// ============================================================================
app.get('/api/guide/workspace', requireRole(['GUIDE', 'ADMIN']), (_req, res) => {
  const learners = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.track, u.account_status,
              p.approved_level, p.proposed_level, p.level_review_state, p.evidence_status,
              p.market_context_summary, p.guide_private_notes, p.rubric_version, p.updated_at
       FROM users u
       LEFT JOIN student_learning_profiles p ON p.learner_id = u.id
       WHERE u.role = 'LEARNER'
       ORDER BY u.name ASC`
    )
    .all() as any[];

  const enrichedLearners = learners.map((l) => {
    const pdps = db
      .prepare('SELECT * FROM pdp_versions WHERE learner_id = ? ORDER BY version_number DESC')
      .all(l.id) as any[];
    const activePDP = pdps.find((p) => p.status === 'ACTIVE_APPROVED') || null;
    const pendingPDP = pdps.find((p) => p.status === 'PENDING_GUIDE_REVIEW') || null;
    const evidenceCount = (db.prepare('SELECT COUNT(*) as c FROM evidence_items WHERE learner_id = ?').get(l.id) as any).c;
    const latestAiRun = db
      .prepare('SELECT id, trace_id, provider_mode, review_state, decision_stage_json, created_at FROM ai_workflow_runs WHERE learner_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(l.id) as any;

    return {
      ...l,
      activePDP: activePDP
        ? { ...activePDP, objectives: JSON.parse(activePDP.objectives_json), competencyFocus: JSON.parse(activePDP.competency_focus_json) }
        : null,
      pendingPDP: pendingPDP
        ? { ...pendingPDP, objectives: JSON.parse(pendingPDP.objectives_json), competencyFocus: JSON.parse(pendingPDP.competency_focus_json) }
        : null,
      allPDPs: pdps.map((p) => ({
        ...p,
        objectives: JSON.parse(p.objectives_json),
        competencyFocus: JSON.parse(p.competency_focus_json)
      })),
      evidenceCount,
      latestAiRun: latestAiRun
        ? {
            ...latestAiRun,
            decisionStage: JSON.parse(latestAiRun.decision_stage_json)
          }
        : null
    };
  });

  const pendingPDPs = db
    .prepare(
      `SELECT p.*, u.name as learner_name, u.email as learner_email, u.track as learner_track
       FROM pdp_versions p
       JOIN users u ON u.id = p.learner_id
       WHERE p.status = 'PENDING_GUIDE_REVIEW'
       ORDER BY p.created_at DESC`
    )
    .all() as any[];

  const coreCompetencies = db.prepare('SELECT * FROM core_competencies WHERE status = ?').all('ACTIVE');
  const learnerCompetencyProposals = db
    .prepare(
      `SELECT lcp.*, u.name as learner_name
       FROM learner_competency_proposals lcp
       JOIN users u ON u.id = lcp.learner_id
       ORDER BY lcp.created_at DESC`
    )
    .all();

  res.json({
    success: true,
    learners: enrichedLearners,
    pendingPDPs: pendingPDPs.map((p) => ({
      ...p,
      objectives: JSON.parse(p.objectives_json),
      competencyFocus: JSON.parse(p.competency_focus_json)
    })),
    coreCompetencies,
    learnerCompetencyProposals
  });
});

app.get('/api/guide/learners/:learnerId', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { learnerId } = req.params;
  const learner = db.prepare('SELECT id, name, email, role, track, created_at FROM users WHERE id = ?').get(learnerId) as any;
  if (!learner) {
    return res.status(404).json({ success: false, error: 'Learner not found.' });
  }

  const profile = db.prepare('SELECT * FROM student_learning_profiles WHERE learner_id = ?').get(learnerId);
  const pdpVersions = db
    .prepare('SELECT * FROM pdp_versions WHERE learner_id = ? ORDER BY version_number DESC')
    .all(learnerId) as any[];
  const tasks = db.prepare('SELECT * FROM learning_tasks WHERE learner_id = ? ORDER BY due_date ASC').all(learnerId);
  const reflections = db.prepare('SELECT * FROM reflections WHERE learner_id = ? ORDER BY created_at DESC').all(learnerId);
  const evidenceItems = db.prepare('SELECT * FROM evidence_items WHERE learner_id = ? ORDER BY created_at DESC').all(learnerId);
  const assessments = db.prepare('SELECT * FROM assessments WHERE learner_id = ? ORDER BY created_at DESC').all(learnerId);
  const guideConversations = db
    .prepare('SELECT * FROM guide_conversations WHERE learner_id = ? ORDER BY conducted_at DESC')
    .all(learnerId) as any[];
  const aiRuns = db.prepare('SELECT * FROM ai_workflow_runs WHERE learner_id = ? ORDER BY created_at DESC').all(learnerId) as any[];
  const competencyDecisions = db.prepare('SELECT * FROM competency_decisions WHERE learner_id = ? ORDER BY decided_at DESC').all(learnerId);
  const sufficiencyEvaluation = evaluateLearnerEvidenceSufficiencyAndAdaptation(learnerId);

  res.json({
    success: true,
    learner,
    profile, // Includes guide_private_notes for authorised Guide/Admin!
    pdpVersions: pdpVersions.map((p) => ({
      ...p,
      objectives: JSON.parse(p.objectives_json || '[]'),
      competencyFocus: JSON.parse(p.competency_focus_json || '[]')
    })),
    tasks,
    reflections,
    evidenceItems,
    assessments,
    guideConversations: guideConversations.map((c) => ({
      ...c,
      agreedLearningNeeds: JSON.parse(c.agreed_learning_needs_json || '[]')
    })),
    sufficiencyEvaluation,
    competencyDecisions,
    aiRuns: aiRuns.map((r) => ({
      ...r,
      observationalStage: JSON.parse(r.observational_stage_json),
      decisionStage: JSON.parse(r.decision_stage_json),
      generativeStage: JSON.parse(r.generative_stage_json),
      validatorResult: JSON.parse(r.validator_result_json)
    }))
  });
});

/**
 * Step 6, 7 & 8 of Product Journey:
 * Guide records the 45-minute 1-on-1 FRINS Conversation, agreed learning needs, and optionally drafts a candidate PDP version.
 */
app.post('/api/guide/learners/:learnerId/conversations', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { learnerId } = req.params;
  const conversationSummary = String(req.body?.conversationSummary || '').trim();
  const agreedLearningNeeds = Array.isArray(req.body?.agreedLearningNeeds)
    ? req.body.agreedLearningNeeds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const createPDPDraft = Boolean(req.body?.createPDPDraft);
  const draftTitle = String(req.body?.draftTitle || '').trim();
  const draftRoutine = String(req.body?.draftRoutine || 'Weekly 45-minute structured process & journal review').trim();

  if (!conversationSummary || conversationSummary.length < 10) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a summary of the 45-minute FRINS Conversation (at least 10 characters).'
    });
  }

  const convId = `conv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO guide_conversations (
      id, learner_id, guide_id, duration_minutes, conversation_summary, agreed_learning_needs_json, conducted_at
    ) VALUES (?, ?, ?, 45, ?, ?, ?)
  `).run(
    convId,
    learnerId,
    req.user!.id,
    conversationSummary,
    JSON.stringify(agreedLearningNeeds.length > 0 ? agreedLearningNeeds : ['Establish written pre-decision checklist']),
    now
  );

  // Also log a GUIDE_CONVERSATION_NOTE evidence item
  db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code,
      sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, 'GUIDE_CONVERSATION_NOTE', ?, '45-Minute FRINS Conversation Notes', ?, 'COMP-PROC-01', 'MEDIUM_PRACTICE', 'Direct human Guide conversation context.', 'VERIFIED', ?)
  `).run(
    `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    learnerId,
    convId,
    conversationSummary,
    now
  );

  let createdPdpId: string | null = null;
  if (createPDPDraft) {
    const maxVerRow = db
      .prepare('SELECT COALESCE(MAX(version_number), 0) as maxVer FROM pdp_versions WHERE learner_id = ?')
      .get(learnerId) as { maxVer: number };
    const nextVer = (maxVerRow?.maxVer || 0) + 1;
    createdPdpId = `pdp_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

    db.prepare(`
      INSERT INTO pdp_versions (
        id, learner_id, version_number, title, status, summary, objectives_json,
        competency_focus_json, routine_schedule, drafted_by, created_at
      ) VALUES (?, ?, ?, ?, 'PENDING_GUIDE_REVIEW', ?, ?, ?, ?, ?, ?)
    `).run(
      createdPdpId,
      learnerId,
      nextVer,
      draftTitle || `Development Plan (v${nextVer}.0, Pending Guide Approval)`,
      conversationSummary,
      JSON.stringify(
        agreedLearningNeeds.length > 0
          ? agreedLearningNeeds
          : ['Follow written pre-decision checklist and log post-session reflection']
      ),
      JSON.stringify(['COMP-PROC-01', 'COMP-RISK-02', 'COMP-REV-04']),
      draftRoutine,
      `${req.user!.name} (FRINS Conversation Draft)`,
      now
    );
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'GUIDE_CONVERSATION_RECORDED',
    entityType: 'GUIDE_CONVERSATION',
    entityId: convId,
    details: { learnerId, createdPdpId }
  });

  res.status(201).json({
    success: true,
    conversationId: convId,
    createdPdpId
  });
});

/**
 * Step 11 & 12 / Section 11:
 * Guide records a Formal Scenario/Process Assessment (HIGH_FORMAL weight) and updates multi-source sufficiency.
 */
app.post('/api/guide/learners/:learnerId/assessments', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { learnerId } = req.params;
  const competencyCode = String(req.body?.competencyCode || 'COMP-RISK-02');
  const assessmentType = String(req.body?.assessmentType || 'SCENARIO_EVALUATION');
  const demonstratedLevel = String(req.body?.demonstratedLevel || 'L2');
  const evidenceStatus = String(req.body?.evidenceStatus || 'SUFFICIENT');
  const findings = String(req.body?.findings || '').trim();

  if (!findings || findings.length < 10) {
    return res.status(400).json({
      success: false,
      error: 'Please enter formal assessment findings (at least 10 characters).'
    });
  }

  const assId = `ass_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const evId = `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO assessments (
      id, learner_id, competency_code, rubric_version, assessment_type,
      demonstrated_level, evidence_status, evaluator_guide_id, findings, created_at
    ) VALUES (?, ?, ?, '1.2.0', ?, ?, ?, ?, ?, ?)
  `).run(assId, learnerId, competencyCode, assessmentType, demonstratedLevel, evidenceStatus, req.user!.id, findings, now);

  db.prepare(`
    INSERT INTO evidence_items (
      id, learner_id, source_type, source_ref_id, title, summary, competency_code,
      sufficiency_weight, uncertainty_note, verification_status, created_at
    ) VALUES (?, ?, 'FORMAL_ASSESSMENT', ?, ?, ?, ?, 'HIGH_FORMAL', 'Low uncertainty. Formal Guide evaluation against Rubric v1.2.0.', ?, ?)
  `).run(
    evId,
    learnerId,
    assId,
    `Formal Guide Assessment (${assessmentType} · ${demonstratedLevel})`,
    findings,
    competencyCode,
    evidenceStatus === 'CONFLICTING' ? 'CONFLICTING' : 'VERIFIED',
    now
  );

  const updatedEval = evaluateLearnerEvidenceSufficiencyAndAdaptation(learnerId);
  db.prepare('UPDATE student_learning_profiles SET evidence_status = ?, updated_at = ? WHERE learner_id = ?').run(
    updatedEval.evidenceStatus,
    now,
    learnerId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'GUIDE_FORMAL_ASSESSMENT_RECORDED',
    entityType: 'ASSESSMENT',
    entityId: assId,
    details: {
      learnerId,
      competencyCode,
      demonstratedLevel,
      evidenceWeight: 'HIGH_FORMAL',
      newSufficiencyStatus: updatedEval.evidenceStatus,
      proposedAdaptationAction: updatedEval.proposedAdaptationAction
    }
  });

  res.status(201).json({
    success: true,
    assessmentId: assId,
    evidenceItemId: evId,
    sufficiencyEvaluation: updatedEval
  });
});

/**
 * Consequential Governance Endpoint: Guide Approves, Edits-and-Approves, Requests Changes, or Rejects a PDP Draft.
 */
app.post('/api/guide/pdp/:pdpId/decision', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { pdpId } = req.params;
  const action = String(req.body?.action || '').toUpperCase();
  const reason = String(req.body?.reason || '').trim();
  const editedTitle = req.body?.title ? String(req.body.title).trim() : undefined;
  const editedSummary = req.body?.summary ? String(req.body.summary).trim() : undefined;
  const editedObjectives = Array.isArray(req.body?.objectives) ? req.body.objectives : undefined;
  const editedRoutine = req.body?.routineSchedule ? String(req.body.routineSchedule).trim() : undefined;

  if (!['APPROVE', 'EDIT_AND_APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid action. Permitted actions: APPROVE, EDIT_AND_APPROVE, REQUEST_CHANGES, REJECT.'
    });
  }

  if (!reason || reason.length < 5) {
    return res.status(400).json({
      success: false,
      error: 'A clear governance reason (minimum 5 characters) is mandatory for every PDP decision.'
    });
  }

  const pdp = db.prepare('SELECT * FROM pdp_versions WHERE id = ?').get(pdpId) as any;
  if (!pdp) {
    return res.status(404).json({ success: false, error: 'PDP version not found.' });
  }

  const now = new Date().toISOString();
  const guideId = req.user!.id;

  const tx = db.transaction(() => {
    if (action === 'APPROVE' || action === 'EDIT_AND_APPROVE') {
      db.prepare(`
        UPDATE pdp_versions
        SET status = 'SUPERSEDED'
        WHERE learner_id = ? AND status = 'ACTIVE_APPROVED' AND id != ?
      `).run(pdp.learner_id, pdpId);

      const nextTitle = (editedTitle || pdp.title).replace(/\(.*Pending.*\)/i, '(Active, Approved)');
      const nextSummary = editedSummary || pdp.summary;
      const nextObjectivesJson = editedObjectives ? JSON.stringify(editedObjectives) : pdp.objectives_json;
      const nextRoutine = editedRoutine || pdp.routine_schedule;

      db.prepare(`
        UPDATE pdp_versions
        SET title = ?,
            summary = ?,
            objectives_json = ?,
            routine_schedule = ?,
            status = 'ACTIVE_APPROVED',
            reviewed_by_guide_id = ?,
            review_decision = ?,
            review_reason = ?,
            reviewed_at = ?,
            activated_at = ?
        WHERE id = ?
      `).run(
        nextTitle,
        nextSummary,
        nextObjectivesJson,
        nextRoutine,
        guideId,
        action,
        reason,
        now,
        now,
        pdpId
      );

      if (pdp.source_ai_run_id) {
        db.prepare(`
          UPDATE ai_workflow_runs
          SET review_state = 'APPROVED_BY_GUIDE', reviewed_by_guide_id = ?, guide_review_notes = ?, reviewed_at = ?
          WHERE id = ?
        `).run(guideId, reason, now, pdp.source_ai_run_id);
      }
    } else {
      const newStatus = action === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
      db.prepare(`
        UPDATE pdp_versions
        SET status = ?,
            reviewed_by_guide_id = ?,
            review_decision = ?,
            review_reason = ?,
            reviewed_at = ?
        WHERE id = ?
      `).run(newStatus, guideId, action, reason, now, pdpId);

      if (pdp.source_ai_run_id) {
        db.prepare(`
          UPDATE ai_workflow_runs
          SET review_state = ?, reviewed_by_guide_id = ?, guide_review_notes = ?, reviewed_at = ?
          WHERE id = ?
        `).run(newStatus, guideId, reason, now, pdp.source_ai_run_id);
      }
    }
  });

  tx();

  writeAuditEvent({
    actorUserId: guideId,
    actorRole: req.user!.role,
    action: `GUIDE_PDP_${action}`,
    entityType: 'PDP_VERSION',
    entityId: pdpId,
    details: {
      learnerId: pdp.learner_id,
      versionNumber: pdp.version_number,
      decision: action,
      reason
    }
  });

  const updatedPDP = db.prepare('SELECT * FROM pdp_versions WHERE id = ?').get(pdpId) as any;
  const activePDPForLearner = db
    .prepare("SELECT id, version_number, title, status FROM pdp_versions WHERE learner_id = ? AND status = 'ACTIVE_APPROVED'")
    .get(pdp.learner_id);

  res.json({
    success: true,
    updatedPDP: {
      ...updatedPDP,
      objectives: JSON.parse(updatedPDP.objectives_json),
      competencyFocus: JSON.parse(updatedPDP.competency_focus_json)
    },
    currentlyActiveApprovedPDP: activePDPForLearner || null
  });
});

/**
 * Consequential Governance Endpoint: Guide Approves or Rejects Competency Level Progression (L1 -> L2 -> L3 -> L4)
 */
app.post('/api/guide/learners/:learnerId/level-decision', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { learnerId } = req.params;
  const decisionStatus = String(req.body?.decisionStatus || 'APPROVED').toUpperCase();
  const targetLevel = String(req.body?.targetLevel || 'L2').toUpperCase();
  const competencyCode = String(req.body?.competencyCode || 'OVERALL_PROFILE');
  const reason = String(req.body?.reason || '').trim();
  const evidenceRefs = Array.isArray(req.body?.evidenceRefs) ? req.body.evidenceRefs : ['ev_aarav_02', 'ev_aarav_03'];

  if (!['L1', 'L2', 'L3', 'L4'].includes(targetLevel)) {
    return res.status(400).json({ success: false, error: 'Invalid level. Permitted levels: L1, L2, L3, L4.' });
  }
  if (!reason || reason.length < 5) {
    return res.status(400).json({ success: false, error: 'Mandatory governance reason is required for level decisions.' });
  }

  const profile = db.prepare('SELECT * FROM student_learning_profiles WHERE learner_id = ?').get(learnerId) as any;
  if (!profile) {
    return res.status(404).json({ success: false, error: 'Student Learning Profile not found.' });
  }

  const now = new Date().toISOString();
  const decId = `cdec_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  db.prepare(`
    INSERT INTO competency_decisions (
      id, learner_id, competency_code, previous_level, new_level, decision_status,
      evidence_refs_json, guide_id, reason, rubric_version, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decId,
    learnerId,
    competencyCode,
    profile.approved_level,
    decisionStatus === 'APPROVED' ? targetLevel : profile.approved_level,
    decisionStatus,
    JSON.stringify(evidenceRefs),
    req.user!.id,
    reason,
    profile.rubric_version,
    now
  );

  if (decisionStatus === 'APPROVED') {
    db.prepare(`
      UPDATE student_learning_profiles
      SET approved_level = ?, proposed_level = NULL, level_review_state = 'APPROVED', updated_at = ?
      WHERE learner_id = ?
    `).run(targetLevel, now, learnerId);
  } else {
    db.prepare(`
      UPDATE student_learning_profiles
      SET level_review_state = ?, updated_at = ?
      WHERE learner_id = ?
    `).run(decisionStatus, now, learnerId);
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: `GUIDE_LEVEL_DECISION_${decisionStatus}`,
    entityType: 'STUDENT_LEARNING_PROFILE',
    entityId: profile.id,
    details: {
      learnerId,
      previousLevel: profile.approved_level,
      targetLevel,
      decisionStatus,
      evidenceRefs,
      reason
    }
  });

  res.json({
    success: true,
    decisionId: decId,
    previousLevel: profile.approved_level,
    currentApprovedLevel: decisionStatus === 'APPROVED' ? targetLevel : profile.approved_level,
    decisionStatus
  });
});

app.post('/api/guide/learners/:learnerId/competency-proposal', requireRole(['GUIDE', 'ADMIN']), (req, res) => {
  const { learnerId } = req.params;
  const title = String(req.body?.title || '').trim();
  const domain = String(req.body?.domain || 'RISK_EXECUTION').trim();
  const description = String(req.body?.description || '').trim();
  const rationale = String(req.body?.rationale || '').trim();
  const targetLevel = String(req.body?.targetLevel || 'L2');

  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Title and description are required.' });
  }

  const id = `lcp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO learner_competency_proposals (
      id, learner_id, proposed_by, title, domain, description, rationale, target_level,
      status, reviewed_by, review_reason, created_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, 'Approved as learner-specific competency; Core Library unchanged.', ?, ?)
  `).run(id, learnerId, req.user!.id, title, domain, description, rationale || 'Contextual to learner', targetLevel, req.user!.id, now, now);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_SPECIFIC_COMPETENCY_APPROVED',
    entityType: 'LEARNER_COMPETENCY_PROPOSAL',
    entityId: id,
    details: { learnerId, title, permanentCoreLibraryModified: false }
  });

  res.status(201).json({
    success: true,
    proposalId: id,
    permanentCoreLibraryModified: false
  });
});

// ============================================================================
// 8. TRAINING DATA CURATION, BENCHMARK & JSONL EXPORT PIPELINE (Requirement 10)
// ============================================================================
app.get('/api/ai/training/examples', requireGuideOrTrainingKey, (_req, res) => {
  const examples = db.prepare('SELECT * FROM training_examples ORDER BY created_at DESC').all() as any[];
  const benchmarks = db.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC').all() as any[];

  res.json({
    success: true,
    datasetVersion: 'frins-curated-v1.0',
    totalExamples: examples.length,
    splits: {
      TRAIN: examples.filter((e) => e.split === 'TRAIN' && e.inclusion_status === 'INCLUDED').length,
      VALIDATION: examples.filter((e) => e.split === 'VALIDATION' && e.inclusion_status === 'INCLUDED').length,
      TEST: examples.filter((e) => e.split === 'TEST' && e.inclusion_status === 'INCLUDED').length
    },
    examples: examples.map((e) => ({
      ...e,
      consentVerified: Boolean(e.consent_verified),
      deidentifiedVerified: Boolean(e.deidentified_verified),
      guideVerified: Boolean(e.guide_verified)
    })),
    benchmarks: benchmarks.map((b) => ({
      ...b,
      cases: JSON.parse(b.case_results_json || '[]')
    }))
  });
});

app.post('/api/ai/training/examples', requireGuideOrTrainingKey, (req, res) => {
  const { sourceRunId, split, consentVerified, deidentifiedVerified, guideVerified, curationReason, inclusionStatus } = req.body || {};

  if (!consentVerified || !deidentifiedVerified || !guideVerified) {
    return res.status(400).json({
      success: false,
      error: 'Governance Block: Training examples require explicit Consent Verification, De-identification Verification, and Human Guide Verification.'
    });
  }

  const run = db.prepare('SELECT * FROM ai_workflow_runs WHERE id = ?').get(sourceRunId) as any;
  if (!run) {
    return res.status(404).json({ success: false, error: 'Source AIWorkflowRun not found.' });
  }

  const sanitizedSummary = JSON.parse(run.sanitized_input_summary_json || '{}');
  const participantHash = sanitizedSummary.participantHash || `pt_${crypto.randomUUID().slice(0, 12)}`;
  const validSplit = ['TRAIN', 'VALIDATION', 'TEST'].includes(split) ? split : 'TRAIN';

  const existingForParticipant = db
    .prepare('SELECT split FROM training_examples WHERE participant_hash = ? LIMIT 1')
    .get(participantHash) as any;

  const assignedSplit = existingForParticipant ? existingForParticipant.split : validSplit;
  const id = `trn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO training_examples (
      id, source_run_id, participant_hash, dataset_version, rubric_version, split,
      consent_verified, deidentified_verified, guide_verified, curator_guide_id,
      inclusion_status, curation_reason, sanitized_context_json, gold_observation_json,
      gold_decision_json, gold_guide_brief_json, created_at
    ) VALUES (?, ?, ?, 'frins-curated-v1.1', '1.2.0', ?, 1, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sourceRunId,
    participantHash,
    assignedSplit,
    req.user!.id,
    inclusionStatus === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED',
    String(curationReason || 'Guide-verified and de-identified gold example.'),
    run.sanitized_input_summary_json,
    run.observational_stage_json,
    run.decision_stage_json,
    run.generative_stage_json,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'TRAINING_EXAMPLE_CURATED',
    entityType: 'TRAINING_EXAMPLE',
    entityId: id,
    details: {
      sourceRunId,
      participantHash,
      assignedSplit,
      participantLeakagePrevented: Boolean(existingForParticipant)
    }
  });

  res.status(201).json({
    success: true,
    exampleId: id,
    assignedSplit,
    participantHash,
    leakageGuardNote: existingForParticipant
      ? `Participant hash already assigned to ${assignedSplit} split; kept in ${assignedSplit} to prevent train/test leakage.`
      : `Assigned to ${assignedSplit} split.`
  });
});

app.get('/api/ai/training/dataset.jsonl', requireGuideOrTrainingKey, (req, res) => {
  const examples = db
    .prepare("SELECT * FROM training_examples WHERE inclusion_status = 'INCLUDED' AND consent_verified = 1 AND deidentified_verified = 1 AND guide_verified = 1 ORDER BY created_at ASC")
    .all() as any[];

  const jsonlLines = examples.map((ex) =>
    JSON.stringify({
      id: ex.id,
      datasetVersion: ex.dataset_version,
      rubricVersion: ex.rubric_version,
      split: ex.split,
      participantHash: ex.participant_hash,
      governance: {
        consentVerified: true,
        deidentifiedVerified: true,
        guideVerified: true,
        curatorId: ex.curator_guide_id
      },
      messages: [
        {
          role: 'system',
          content: 'FRINS Governed Market Learning Assistant: evidence-grounded observation, deterministic decision alignment, and non-advisory Guide brief generation.'
        },
        {
          role: 'user',
          content: JSON.parse(ex.sanitized_context_json)
        },
        {
          role: 'assistant',
          content: {
            observationalStage: JSON.parse(ex.gold_observation_json),
            decisionStage: JSON.parse(ex.gold_decision_json),
            generativeStage: JSON.parse(ex.gold_guide_brief_json)
          }
        }
      ]
    })
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'TRAINING_DATASET_JSONL_EXPORTED',
    entityType: 'TRAINING_DATASET',
    entityId: 'frins-curated-v1.0',
    details: { exportedRecordCount: examples.length }
  });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="frins-curated-dataset-v1.0.jsonl"');
  res.send(jsonlLines.join('\n') + '\n');
});

app.post('/api/ai/benchmark/run', requireGuideOrTrainingKey, (req, res) => {
  const bench = runOfflineBenchmarkSuite();
  const id = `bnch_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO benchmark_runs (
      id, dataset_version, provider_mode, model_version, prompt_version, total_cases, passed_cases,
      grounding_score, uncertainty_calibration_score, safety_block_rate, no_advice_leakage,
      case_results_json, release_gate_status, executed_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
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
    req.user!.id,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'OFFLINE_AI_BENCHMARK_EXECUTED',
    entityType: 'BENCHMARK_RUN',
    entityId: id,
    details: { passedCases: bench.passedCases, totalCases: bench.totalCases }
  });

  res.json({ success: true, benchmarkRunId: id, ...bench });
});

// ============================================================================
// 9. ADMIN & CURRICULUM OWNER WORKSPACE ENDPOINTS (RBAC: ADMIN / CURRICULUM_OWNER)
// ============================================================================
app.get('/api/admin/overview', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const users = db
    .prepare('SELECT id, name, email, role, account_status, track, assigned_guide_id, created_at, updated_at FROM users ORDER BY created_at DESC')
    .all();
  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  const rawCallBookings = db.prepare('SELECT * FROM call_bookings ORDER BY created_at DESC').all() as any[];
  const callBookings = rawCallBookings.map((b) => ({
    ...b,
    phone: b.participant_phone,
    preferred_time_slot: b.preferred_time,
    result_summary: b.recommended_focus
  }));
  const discoveryQuestions = getAllDiscoveryQuestions();
  const activeQuestionsCount = discoveryQuestions.filter((q) => q.isActive).length;

  // Solved Discovery Sessions with full Question & Answer pairs
  const rawDiscoverySessions = db
    .prepare('SELECT * FROM discovery_sessions ORDER BY updated_at DESC')
    .all() as any[];

  const solvedDiscoverySessions = rawDiscoverySessions.map((sess) => {
    const respRows = db
      .prepare('SELECT question_id, domain, answer_value, answer_text, answered_at FROM discovery_responses WHERE session_id = ? ORDER BY question_id ASC')
      .all(sess.id) as any[];

    const flatAnswers: Record<string, string> = {};
    const detailedAnswers = respRows.map((r) => {
      flatAnswers[r.question_id] = r.answer_value || r.answer_text || '';
      const qDef =
        discoveryQuestions.find((q) => q.id === r.question_id) ||
        CANONICAL_QUESTIONS.find((q) => q.id === r.question_id);
      let readableAnswer = r.answer_text || r.answer_value;
      if (qDef && Array.isArray(qDef.options)) {
        const matchedOpt = qDef.options.find((o: any) => o.value === r.answer_value);
        if (matchedOpt) readableAnswer = matchedOpt.label;
      }
      return {
        questionId: r.question_id,
        domainTitle: qDef?.domainTitle || r.domain,
        prompt: qDef?.prompt || r.question_id,
        answerValue: r.answer_value,
        answerLabel: readableAnswer,
        answeredAt: r.answered_at
      };
    });

    const candidateResult = evaluateCandidateDiscoveryResult(flatAnswers, sess.track, sess.custom_track || '');
    return {
      ...sess,
      answeredCount: detailedAnswers.length,
      detailedAnswers,
      candidateResult
    };
  });

  // Courses & Assigned Student Courses
  const rawCourses = db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all() as any[];
  const courses = rawCourses.map((c) => ({
    ...c,
    modules: JSON.parse(c.modules_json || '[]')
  }));

  const courseQuestions = (db.prepare('SELECT * FROM course_questions ORDER BY created_at ASC').all() as any[]).map((q) => ({
    ...q,
    options: JSON.parse(q.options_json || '[]')
  }));

  const rawStudentCourses = db
    .prepare(`
      SELECT sc.*, c.title as course_title, c.track as course_track, c.level as course_level,
             u.name as learner_name, u.email as learner_email
      FROM student_courses sc
      JOIN courses c ON c.id = sc.course_id
      JOIN users u ON u.id = sc.learner_id
      ORDER BY sc.assigned_at DESC
    `)
    .all() as any[];

  // Student Tasks, Uploaded Results, Internal AI Pre-Reviews (Admin/Team Only) & Direct Chat Messages
  const rawStudentTasks = db
    .prepare(`
      SELECT t.*, u.name as learner_name, u.email as learner_email, u.track as learner_track,
             c.title as course_title
      FROM learning_tasks t
      JOIN users u ON u.id = t.learner_id
      LEFT JOIN courses c ON c.id = t.course_id
      ORDER BY CASE WHEN t.status = 'SUBMITTED' THEN 0 WHEN t.status = 'ASSIGNED' THEN 1 ELSE 2 END, t.submitted_at DESC
    `)
    .all() as any[];

  const studentTasks = rawStudentTasks.map((t) => {
    const messages = db
      .prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC')
      .all(t.id);
    let aiReview = null;
    if (t.ai_review_json) {
      try {
        aiReview = JSON.parse(t.ai_review_json);
      } catch {
        aiReview = null;
      }
    } else if (t.learner_submission) {
      // Auto-generate AI review for any legacy submitted task
      aiReview = analyzeStudentTaskSubmissionWithAI({
        taskTitle: t.title,
        instructions: t.instructions,
        expectedCriteria: t.expected_criteria || '',
        learnerSubmission: t.learner_submission,
        uploadedFileName: t.uploaded_file_name || undefined
      });
    }
    return {
      ...t,
      aiReview, // Strictly visible ONLY to Admin & Team!
      messages
    };
  });

  const competencies = db.prepare('SELECT * FROM core_competencies ORDER BY code ASC').all();
  const auditEvents = db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100').all() as any[];

  const metrics = {
    totalUsers: users.length,
    activeLearners: users.filter((u: any) => u.role === 'LEARNER' && u.account_status === 'ACTIVE').length,
    activeGuides: users.filter((u: any) => u.role === 'GUIDE' && u.account_status === 'ACTIVE').length,
    totalLeads: leads.length,
    totalCallBookings: callBookings.length,
    activeDiscoveryQuestionsCount: activeQuestionsCount,
    completedDiscoveries: solvedDiscoverySessions.filter((s) => s.answeredCount > 0).length,
    totalCourses: courses.length,
    assignedStudentCourses: rawStudentCourses.length,
    submittedTasksForReview: studentTasks.filter((t) => t.status === 'SUBMITTED').length,
    pendingPDPReviews: (db.prepare("SELECT COUNT(*) as c FROM pdp_versions WHERE status = 'PENDING_GUIDE_REVIEW'").get() as any).c,
    totalAiRuns: (db.prepare('SELECT COUNT(*) as c FROM ai_workflow_runs').get() as any).c,
    curatedTrainingExamples: (db.prepare("SELECT COUNT(*) as c FROM training_examples WHERE inclusion_status = 'INCLUDED'").get() as any).c
  };

  res.json({
    success: true,
    metrics,
    users,
    leads,
    callBookings,
    discoveryQuestions,
    activeQuestionsCount,
    solvedDiscoverySessions,
    courses,
    courseQuestions,
    studentCourses: rawStudentCourses,
    studentTasks,
    competencies,
    auditEvents: auditEvents.map((a) => ({
      ...a,
      details: JSON.parse(a.details_json || '{}')
    }))
  });
});

// Admin Discovery Question Configurator (Set N Questions, Add, Edit, Toggle, Delete)
app.get('/api/admin/discovery-questions', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (_req, res) => {
  const questions = getAllDiscoveryQuestions();
  const activeCount = questions.filter((q) => q.isActive).length;
  res.json({
    success: true,
    activeCount,
    totalBankCount: questions.length,
    questions
  });
});

app.post('/api/admin/discovery-questions/set-count', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const count = Math.max(1, Math.min(50, Number(req.body?.count || 7)));
  const allRows = db.prepare('SELECT id FROM discovery_questions ORDER BY sort_order ASC, id ASC').all() as Array<{ id: string }>;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    allRows.forEach((row, idx) => {
      db.prepare('UPDATE discovery_questions SET is_active = ?, updated_at = ? WHERE id = ?').run(
        idx < count ? 1 : 0,
        now,
        row.id
      );
    });
  });
  tx();

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SET_DISCOVERY_QUESTION_COUNT',
    entityType: 'DISCOVERY_QUESTIONS',
    entityId: 'active_count',
    details: { activeCount: Math.min(count, allRows.length) }
  });

  const updated = getAllDiscoveryQuestions();
  res.json({
    success: true,
    activeCount: updated.filter((q) => q.isActive).length,
    questions: updated
  });
});

app.post('/api/admin/discovery-questions', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const domain = String(req.body?.domain || 'DECISION_PROCESS').trim();
  const domainTitle = String(req.body?.domainTitle || 'Preparation & Decision Structure').trim();
  const inputType = req.body?.inputType === 'text' ? 'text' : 'single_choice';
  const rawOptions = Array.isArray(req.body?.options) ? req.body.options : [];
  const isActive = req.body?.isActive !== false ? 1 : 0;

  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Question prompt is required.' });
  }

  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM discovery_questions').get() as any).m;
  const newId = `Q_CUSTOM_${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  const now = new Date().toISOString();

  const formattedOptions =
    inputType === 'single_choice' && rawOptions.length > 0
      ? rawOptions.map((o: any, idx: number) =>
          typeof o === 'string'
            ? { value: `opt_${idx + 1}_${o.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20)}`, label: o }
            : { value: String(o.value || `opt_${idx + 1}`), label: String(o.label || o.value) }
        )
      : inputType === 'single_choice'
        ? [
            { value: 'structured_written_rule', label: 'Yes. I follow a written rule consistently' },
            { value: 'partial_informal_habit', label: 'Sometimes. I have a general habit, but it varies under pressure' },
            { value: 'reactive_no_fixed_rule', label: 'No. I usually decide in the moment without a fixed rule' }
          ]
        : [];

  db.prepare(`
    INSERT INTO discovery_questions (
      id, sort_order, domain, domain_title, prompt, input_type, options_json, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId,
    maxSort + 1,
    domain,
    domainTitle,
    prompt,
    inputType,
    JSON.stringify(formattedOptions),
    isActive,
    now,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_DISCOVERY_QUESTION_ADDED',
    entityType: 'DISCOVERY_QUESTION',
    entityId: newId,
    details: { prompt, domain, inputType, isActive: Boolean(isActive) }
  });

  const updated = getAllDiscoveryQuestions();
  res.status(201).json({
    success: true,
    questionId: newId,
    activeCount: updated.filter((q) => q.isActive).length,
    questions: updated
  });
});

app.patch('/api/admin/discovery-questions/:questionId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { questionId } = req.params;
  const existing = db.prepare('SELECT * FROM discovery_questions WHERE id = ?').get(questionId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Question not found.' });
  }

  const nextActive = typeof req.body?.isActive === 'boolean' ? (req.body.isActive ? 1 : 0) : existing.is_active;
  const nextPrompt = req.body?.prompt ? String(req.body.prompt).trim() : existing.prompt;
  const nextDomainTitle = req.body?.domainTitle ? String(req.body.domainTitle).trim() : existing.domain_title;
  const nextInputType =
    req.body?.inputType === 'text' || req.body?.inputType === 'single_choice'
      ? req.body.inputType
      : existing.input_type;

  let nextOptionsJson = existing.options_json;
  if (Array.isArray(req.body?.options)) {
    const formatted = req.body.options.map((o: any, idx: number) =>
      typeof o === 'string'
        ? { value: `opt_${idx + 1}_${o.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20)}`, label: o }
        : { value: String(o.value || `opt_${idx + 1}`), label: String(o.label || o.value) }
    );
    nextOptionsJson = JSON.stringify(formatted);
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE discovery_questions
    SET is_active = ?, prompt = ?, domain_title = ?, input_type = ?, options_json = ?, updated_at = ?
    WHERE id = ?
  `).run(nextActive, nextPrompt, nextDomainTitle, nextInputType, nextOptionsJson, now, questionId);

  const updated = getAllDiscoveryQuestions();
  res.json({
    success: true,
    activeCount: updated.filter((q) => q.isActive).length,
    questions: updated
  });
});

app.delete('/api/admin/discovery-questions/:questionId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { questionId } = req.params;
  db.prepare('DELETE FROM discovery_questions WHERE id = ?').run(questionId);
  const updated = getAllDiscoveryQuestions();
  res.json({
    success: true,
    activeCount: updated.filter((q) => q.isActive).length,
    questions: updated
  });
});

// ============================================================================
// ADMIN COURSE CREATION, COURSE ASSIGNMENT & STUDENT TASK REVIEW + AI PRE-CHECK
// ============================================================================
app.post('/api/admin/courses', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const title = String(req.body?.title || '').trim();
  const track = String(req.body?.track || 'student_concepts').trim();
  const level = String(req.body?.level || 'L1 → L2').trim();
  const description = String(req.body?.description || '').trim();
  const rawModules = Array.isArray(req.body?.modules) ? req.body.modules.map((m: any) => String(m).trim()).filter(Boolean) : [];

  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Course title and description are required.' });
  }

  const courseId = `crs_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO courses (id, title, track, level, description, modules_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    courseId,
    title,
    track,
    level,
    description,
    JSON.stringify(rawModules.length > 0 ? rawModules : ['Module 1: Core Concepts', 'Module 2: Practical Strategy Application']),
    req.user!.id,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_CREATED',
    entityType: 'COURSE',
    entityId: courseId,
    details: { title, track, level, moduleCount: rawModules.length }
  });

  res.status(201).json({ success: true, courseId });
});

app.post('/api/admin/courses/assign', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const courseId = String(req.body?.courseId || '').trim();
  const learnerId = String(req.body?.learnerId || '').trim();
  const customNotes = String(req.body?.customNotes || '').trim();

  if (!courseId || !learnerId) {
    return res.status(400).json({ success: false, error: 'Both courseId and learnerId are required.' });
  }

  const id = `sc_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO student_courses (id, course_id, learner_id, custom_notes, progress_pct, status, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?, 0, 'ACTIVE', ?, ?)
  `).run(id, courseId, learnerId, customNotes || 'Customised course assigned by Admin.', req.user!.id, now);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_ASSIGNED_TO_STUDENT',
    entityType: 'STUDENT_COURSE',
    entityId: id,
    details: { courseId, learnerId, customNotes }
  });

  res.status(201).json({ success: true, assignmentId: id });
});

// Admin can edit any course (title, track, level, description, modules)
app.patch('/api/admin/courses/:courseId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const courseId = String(req.params.courseId);
  const existing = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Course not found.' });
  }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
  const track = req.body?.track !== undefined ? String(req.body.track).trim() : existing.track;
  const level = req.body?.level !== undefined ? String(req.body.level).trim() : existing.level;
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
  const modules =
    Array.isArray(req.body?.modules)
      ? req.body.modules.map((m: any) => (typeof m === 'string' ? m.trim() : String(m?.title || '').trim())).filter(Boolean)
      : JSON.parse(existing.modules_json || '[]');

  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Course title and description are required.' });
  }

  db.prepare(`
    UPDATE courses SET title = ?, track = ?, level = ?, description = ?, modules_json = ? WHERE id = ?
  `).run(title, track, level, description, JSON.stringify(modules), courseId);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_UPDATED',
    entityType: 'COURSE',
    entityId: courseId,
    details: { title, track, level, moduleCount: modules.length }
  });

  return res.json({
    success: true,
    course: { ...existing, title, track, level, description, modules, modules_json: JSON.stringify(modules) }
  });
});

// Admin can delete a course along with its assignments and questions
app.delete('/api/admin/courses/:courseId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const courseId = String(req.params.courseId);
  const existing = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Course not found.' });
  }

  const removedAssignments = db.prepare('DELETE FROM student_courses WHERE course_id = ?').run(courseId).changes;
  const removedQuestions = db.prepare('DELETE FROM course_questions WHERE course_id = ?').run(courseId).changes;
  db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_DELETED',
    entityType: 'COURSE',
    entityId: courseId,
    details: { title: existing.title, removedAssignments, removedQuestions }
  });

  return res.json({ success: true, removedAssignments, removedQuestions });
});

// Admin creates a question inside a course
app.post('/api/admin/courses/:courseId/questions', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const courseId = String(req.params.courseId);
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found.' });
  }

  const prompt = String(req.body?.prompt || '').trim();
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map((o: any) => String(o).trim()).filter(Boolean)
    : [];
  const correctOptionIndex = Number(req.body?.correctOptionIndex ?? 0);
  const explanation = String(req.body?.explanation || '').trim();

  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Question prompt is required.' });
  }
  if (options.length < 2) {
    return res.status(400).json({ success: false, error: 'At least two answer options are required.' });
  }
  if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
    return res.status(400).json({ success: false, error: 'Correct option index is out of range.' });
  }

  const questionId = `cq_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO course_questions (id, course_id, prompt, options_json, correct_option_index, explanation, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(questionId, courseId, prompt, JSON.stringify(options), correctOptionIndex, explanation, req.user!.id, now);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_QUESTION_CREATED',
    entityType: 'COURSE_QUESTION',
    entityId: questionId,
    details: { courseId, prompt }
  });

  return res.status(201).json({ success: true, questionId });
});

// Admin edits a course question
app.patch('/api/admin/course-questions/:questionId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const questionId = String(req.params.questionId);
  const existing = db.prepare('SELECT * FROM course_questions WHERE id = ?').get(questionId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Course question not found.' });
  }

  const prompt = req.body?.prompt !== undefined ? String(req.body.prompt).trim() : existing.prompt;
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map((o: any) => String(o).trim()).filter(Boolean)
    : JSON.parse(existing.options_json || '[]');
  const correctOptionIndex = Number(req.body?.correctOptionIndex ?? existing.correct_option_index);
  const explanation = req.body?.explanation !== undefined ? String(req.body.explanation).trim() : existing.explanation;

  if (!prompt || options.length < 2) {
    return res.status(400).json({ success: false, error: 'Question prompt and at least two options are required.' });
  }
  if (!Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
    return res.status(400).json({ success: false, error: 'Correct option index is out of range.' });
  }

  db.prepare(`
    UPDATE course_questions SET prompt = ?, options_json = ?, correct_option_index = ?, explanation = ? WHERE id = ?
  `).run(prompt, JSON.stringify(options), correctOptionIndex, explanation, questionId);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_QUESTION_UPDATED',
    entityType: 'COURSE_QUESTION',
    entityId: questionId,
    details: { prompt }
  });

  return res.json({ success: true });
});

// Admin deletes a course question
app.delete('/api/admin/course-questions/:questionId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const questionId = String(req.params.questionId);
  const existing = db.prepare('SELECT * FROM course_questions WHERE id = ?').get(questionId) as any;
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Course question not found.' });
  }

  db.prepare('DELETE FROM course_question_attempts WHERE question_id = ?').run(questionId);
  db.prepare('DELETE FROM course_questions WHERE id = ?').run(questionId);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_QUESTION_DELETED',
    entityType: 'COURSE_QUESTION',
    entityId: questionId,
    details: { courseId: existing.course_id }
  });

  return res.json({ success: true });
});

app.post('/api/admin/tasks', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const learnerId = String(req.body?.learnerId || 'usr_learner_aarav').trim();
  const courseId = req.body?.courseId ? String(req.body.courseId).trim() : null;
  const title = String(req.body?.title || '').trim();
  const category = String(req.body?.category || 'CHART_CONCEPT_LAB').trim();
  const instructions = String(req.body?.instructions || '').trim();
  const expectedCriteria = String(req.body?.expectedCriteria || '').trim();
  const competencyCode = String(req.body?.competencyCode || 'COMP-PROC-01').trim();
  const dueDate = String(req.body?.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)).trim();

  if (!title || !instructions) {
    return res.status(400).json({ success: false, error: 'Task title and instructions are required.' });
  }

  const taskId = `tsk_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO learning_tasks (
      id, learner_id, pdp_version_id, course_id, title, category, instructions, expected_criteria,
      competency_code, status, due_date
    ) VALUES (?, ?, 'pdp_aarav_v1', ?, ?, ?, ?, ?, ?, 'ASSIGNED', ?)
  `).run(
    taskId,
    learnerId,
    courseId,
    title,
    category,
    instructions,
    expectedCriteria || instructions,
    competencyCode,
    dueDate
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_TASK_ASSIGNED_TO_STUDENT',
    entityType: 'LEARNING_TASK',
    entityId: taskId,
    details: { learnerId, courseId, title, category }
  });

  res.status(201).json({ success: true, taskId });
});

app.post('/api/admin/tasks/:taskId/ai-reanalyze', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const { taskId } = req.params;
  const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(taskId) as any;
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found.' });
  }

  const aiReview = analyzeStudentTaskSubmissionWithAI({
    taskTitle: task.title,
    instructions: task.instructions,
    expectedCriteria: task.expected_criteria || '',
    learnerSubmission: task.learner_submission || 'No submission text yet.',
    uploadedFileName: task.uploaded_file_name || undefined
  });

  db.prepare('UPDATE learning_tasks SET ai_review_json = ? WHERE id = ?').run(JSON.stringify(aiReview), taskId);

  res.json({
    success: true,
    taskId,
    aiReview
  });
});

app.post('/api/admin/tasks/:taskId/review', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const { taskId } = req.params;
  const status = req.body?.status === 'ASSIGNED' || req.body?.status === 'CHANGES_REQUESTED' ? 'ASSIGNED' : 'REVIEWED';
  const guideFeedback = String(req.body?.guideFeedback || '').trim();

  if (!guideFeedback) {
    return res.status(400).json({ success: false, error: 'Please provide review feedback for the student.' });
  }

  const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(taskId) as any;
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE learning_tasks
    SET status = ?, guide_feedback = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, guideFeedback, now, taskId);

  // Also add the official review message to the task chat thread so the student sees it immediately
  const msgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(`
    INSERT INTO task_messages (id, task_id, sender_user_id, sender_name, sender_role, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msgId,
    taskId,
    req.user!.id,
    `${req.user!.name} (${req.user!.role})`,
    req.user!.role,
    `[Official Task Review: ${status === 'REVIEWED' ? 'APPROVED ✓' : 'REVISION REQUESTED'}] ${guideFeedback}`,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_STUDENT_TASK_REVIEWED',
    entityType: 'LEARNING_TASK',
    entityId: taskId,
    details: { learnerId: task.learner_id, status, guideFeedback }
  });

  res.json({ success: true, taskId, status, guideFeedback });
});

app.post('/api/admin/users', requireRole(['ADMIN']), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'LEARNER').toUpperCase();
  const track = String(req.body?.track || 'trader').toLowerCase();
  const suppliedPassword = String(req.body?.password || '').trim();
  const password = suppliedPassword || generateTemporaryPassword();
  const generatedPassword = suppliedPassword ? null : password;

  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name and email are required.' });
  }
  if (!['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role specified.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) {
    return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
  }

  const id = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, account_status, track, assigned_guide_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
  `).run(
    id,
    name,
    email,
    hashPassword(password),
    role,
    track,
    role === 'LEARNER' ? defaultGuideId() : null,
    now,
    now
  );

  if (role === 'LEARNER') {
    db.prepare(`
      INSERT INTO student_learning_profiles (
        id, learner_id, approved_level, proposed_level, level_review_state, primary_track,
        evidence_status, market_context_summary, rubric_version, updated_at
      ) VALUES (?, ?, 'L1', NULL, 'APPROVED', ?, 'INSUFFICIENT', 'Newly provisioned learner account; awaiting Discovery completion.', '1.2.0', ?)
    `).run(`slp_${id}`, id, track, now);
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_USER_PROVISIONED',
    entityType: 'USER',
    entityId: id,
    details: { name, email, role, track }
  });

  res.status(201).json({
    success: true,
    userId: id,
    // Shown once in the admin console so it can be handed over securely.
    temporaryPassword: generatedPassword
  });
});

app.patch('/api/admin/users/:userId', requireRole(['ADMIN']), (req, res) => {
  const { userId } = req.params;
  const { role, accountStatus } = req.body || {};

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!target) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const nextRole = role && ['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER'].includes(role) ? role : target.role;
  const nextStatus = accountStatus && ['ACTIVE', 'SUSPENDED'].includes(accountStatus) ? accountStatus : target.account_status;
  const now = new Date().toISOString();

  db.prepare('UPDATE users SET role = ?, account_status = ?, updated_at = ? WHERE id = ?').run(
    nextRole,
    nextStatus,
    now,
    userId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_USER_UPDATED',
    entityType: 'USER',
    entityId: userId,
    details: { previousRole: target.role, nextRole, previousStatus: target.account_status, nextStatus }
  });

  res.json({ success: true, userId, role: nextRole, accountStatus: nextStatus });
});

app.post('/api/admin/competencies', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const title = String(req.body?.title || '').trim();
  const domain = String(req.body?.domain || 'DECISION_PROCESS').trim();
  const description = String(req.body?.description || '').trim();
  const l1 = String(req.body?.l1Criteria || '').trim();
  const l2 = String(req.body?.l2Criteria || '').trim();
  const l3 = String(req.body?.l3Criteria || '').trim();
  const l4 = String(req.body?.l4Criteria || '').trim();
  const rubricVersion = String(req.body?.rubricVersion || '1.3.0').trim();

  if (!code || !title || !description) {
    return res.status(400).json({ success: false, error: 'Code, title, and description are required for core competency governance.' });
  }

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM core_competencies WHERE code = ?').get(code) as any;

  if (existing) {
    db.prepare(`
      UPDATE core_competencies
      SET title = ?, domain = ?, description = ?, l1_criteria = ?, l2_criteria = ?, l3_criteria = ?, l4_criteria = ?,
          rubric_version = ?, approved_by = ?, updated_at = ?
      WHERE code = ?
    `).run(
      title,
      domain,
      description,
      l1 || existing.l1_criteria,
      l2 || existing.l2_criteria,
      l3 || existing.l3_criteria,
      l4 || existing.l4_criteria,
      rubricVersion,
      req.user!.id,
      now,
      code
    );
  } else {
    db.prepare(`
      INSERT INTO core_competencies (
        id, code, title, domain, description, l1_criteria, l2_criteria, l3_criteria, l4_criteria,
        rubric_version, status, approved_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(
      `comp_${crypto.randomUUID().slice(0, 8)}`,
      code,
      title,
      domain,
      description,
      l1 || 'L1 Foundational Understanding criteria',
      l2 || 'L2 Guided Application criteria',
      l3 || 'L3 Independent Application criteria',
      l4 || 'L4 Adaptive Mastery criteria',
      rubricVersion,
      req.user!.id,
      now
    );
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: existing ? 'CORE_COMPETENCY_RUBRIC_VERSION_UPDATED' : 'CORE_COMPETENCY_CREATED',
    entityType: 'CORE_COMPETENCY',
    entityId: code,
    details: { code, title, rubricVersion }
  });

  res.json({ success: true, code, rubricVersion });
});

// Serve built frontend on port 3001 from persisted public_build/ (or dist/)
const publicBuildDir = path.resolve(process.cwd(), 'public_build');
const distDir = path.resolve(process.cwd(), 'dist');

app.use(express.static(publicBuildDir));
app.use(express.static(distDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const publicIndex = path.join(publicBuildDir, 'index.html');
  const distIndex = path.join(distDir, 'index.html');
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  if (fs.existsSync(distIndex)) {
    return res.sendFile(distIndex);
  }
  return res.status(404).send('Frontend bundle not found. Run npm run build.');
});

const PORT = Number(process.env.PORT || 3001);
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[FRINS Server] Listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown so Docker / systemd restarts do not truncate SQLite writes.
  const shutdown = (signal: string) => {
    console.log(`[FRINS Server] ${signal} received, closing connections.`);
    server.close(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
