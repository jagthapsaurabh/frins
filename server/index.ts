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
import { registerCommunityRoutes } from './communities.js';
import { registerSummaryRoutes } from './summaries.js';
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
    counts,
    timestamp: new Date().toISOString()
  });
});

const AI_PROVIDERS: Record<string, { label: string; model: string; baseUrl: string }> = {
  OPENAI: { label: 'OpenAI', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  GEMINI: { label: 'Google Gemini', model: 'gemini-1.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ANTHROPIC: { label: 'Anthropic', model: 'claude-3-5-sonnet-latest', baseUrl: 'https://api.anthropic.com/v1' },
  OPENAI_COMPATIBLE: { label: 'Any OpenAI-compatible API', model: '', baseUrl: '' },
  NONE: { label: 'Not connected', model: '', baseUrl: '' }
};

const readAiSettings = () => {
  const row = db.prepare("SELECT * FROM ai_settings WHERE id = 'default'").get() as any;
  return row || { id: 'default', provider: 'NONE', model: '', api_key: '', base_url: '', updated_at: null, updated_by: null };
};

const maskKey = (key?: string | null) => {
  if (!key) return '';
  const tail = key.slice(-4);
  return `${'•'.repeat(Math.min(12, Math.max(4, key.length - 4)))}${tail}`;
};

const aiPublicSettings = () => {
  const saved = readAiSettings();
  const provider = String(saved.provider || 'NONE').toUpperCase();
  const envKey = process.env.AI_API_KEY || '';
  const hasKey = Boolean(saved.api_key || envKey);
  return {
    provider,
    providerLabel: AI_PROVIDERS[provider]?.label || AI_PROVIDERS.NONE.label,
    model: saved.model || AI_PROVIDERS[provider]?.model || '',
    baseUrl: saved.base_url || AI_PROVIDERS[provider]?.baseUrl || '',
    hasKey,
    maskedKey: maskKey(saved.api_key || envKey),
    updatedAt: saved.updated_at || null,
    updatedBy: saved.updated_by || null,
    providers: Object.entries(AI_PROVIDERS).map(([value, meta]) => ({ value, ...meta }))
  };
};

app.get('/api/admin/ai/settings', requireRole(['ADMIN']), (_req, res) => {
  res.json({ success: true, settings: aiPublicSettings() });
});

app.put('/api/admin/ai/settings', requireRole(['ADMIN']), (req, res) => {
  const provider = String(req.body?.provider || 'NONE').toUpperCase();
  if (!AI_PROVIDERS[provider]) {
    return res.status(400).json({ success: false, error: 'Pick a provider from the list.' });
  }
  const model = String(req.body?.model || '').trim();
  const baseUrl = String(req.body?.baseUrl || '').trim();
  const incomingKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : null;
  const clearKey = Boolean(req.body?.clearKey);

  const current = readAiSettings();
  const nextKey = clearKey ? '' : incomingKey ? incomingKey : current.api_key || '';

  db.prepare(
    `INSERT INTO ai_settings (id, provider, model, api_key, base_url, updated_at, updated_by)
     VALUES ('default', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, model = excluded.model,
       api_key = excluded.api_key, base_url = excluded.base_url,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(provider, model, nextKey, baseUrl, new Date().toISOString(), req.user!.id);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'AI_PROVIDER_SETTINGS_UPDATED',
    entityType: 'AI_SETTINGS',
    entityId: 'default',
    details: { provider, model, hasKey: Boolean(nextKey) }
  });

  res.json({ success: true, settings: aiPublicSettings() });
});

app.post('/api/admin/ai/test', requireRole(['ADMIN']), async (req, res) => {
  const saved = readAiSettings();
  const provider = String(saved.provider || 'NONE').toUpperCase();
  const key = saved.api_key || process.env.AI_API_KEY || '';
  const model = saved.model || AI_PROVIDERS[provider]?.model || '';
  const baseUrl = saved.base_url || AI_PROVIDERS[provider]?.baseUrl || '';

  if (provider === 'NONE' || !key) {
    return res.status(400).json({ success: false, error: 'Add a provider and an API key first.' });
  }

  const started = Date.now();
  try {
    let url = '';
    let headers: Record<string, string> = {};
    if (provider === 'OPENAI' || provider === 'OPENAI_COMPATIBLE') {
      url = `${baseUrl.replace(/\/$/, '')}/models`;
      headers = { Authorization: `Bearer ${key}` };
    } else if (provider === 'GEMINI') {
      url = `${baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(key)}`;
    } else if (provider === 'ANTHROPIC') {
      url = `${baseUrl.replace(/\/$/, '')}/models`;
      headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `The provider answered with ${response.status}. Check the key and the model.`
      });
    }

    res.json({ success: true, latencyMs: Date.now() - started, model });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: err?.name === 'AbortError' ? 'The provider did not answer in time.' : 'Could not reach the provider from the server.'
    });
  }
});

app.get('/api/ai/status', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const saved = readAiSettings();
  const savedProvider = String(saved.provider || 'NONE').toUpperCase();
  const providerEnv = (process.env.AI_PROVIDER || '').toLowerCase();
  const hasLiveKey = Boolean((saved.api_key || process.env.AI_API_KEY || '').trim());
  const isLiveActive = savedProvider !== 'NONE' && hasLiveKey;
  const modelName =
    saved.model || AI_PROVIDERS[savedProvider]?.model || process.env.AI_MODEL || '';

  res.json({
    provider: savedProvider,
    providerLabel: AI_PROVIDERS[savedProvider]?.label || 'Not connected',
    providerMode: isLiveActive ? 'LIVE' : 'NOT_CONNECTED',
    configuredProviderEnv: providerEnv,
    liveProviderConfigured: isLiveActive,
    modelName: modelName || 'Not connected',
    hasKey: hasLiveKey,
    agents: [
      {
        name: 'ObservationalAgent',
        status: 'ACTIVE',
        mode: isLiveActive ? 'LIVE' : 'RULES'
      },
      {
        name: 'DecisionAgent',
        status: 'ACTIVE',
        mode: 'RULES'
      },
      {
        name: 'GenerativeAgent',
        status: 'ACTIVE',
        mode: isLiveActive ? 'LIVE' : 'TEMPLATE'
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
// Sign-in is rate limited against guessing. The suite signs in as six different
// accounts over and over, so the limit is not applied while tests are running.
const loginThrottle = process.env.NODE_ENV === 'test' ? (_req: Request, _res: Response, next: NextFunction) => next() : rateLimit(30, 60_000);

app.post('/api/auth/login', loginThrottle, (req, res) => {
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

/**
 * Change your own password. Requires the current password, so a stolen session
 * token alone cannot lock the owner out.
 */
app.post('/api/auth/change-password', requireAuth, rateLimit(10, 60_000), (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const currentToken = String(req.headers.authorization || '').replace(/^Bearer\s+/, '').trim();

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Enter your current password and a new one.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Use at least 8 characters for the new password.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ success: false, error: 'The new password must be different from the current one.' });
  }

  const account = db.prepare('SELECT id, role, password_hash FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!account || !verifyPassword(currentPassword, account.password_hash)) {
    return res.status(401).json({ success: false, error: 'Your current password is not correct.' });
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    new Date().toISOString(),
    account.id
  );

  // Every other device is signed out. This one stays signed in.
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token != ?').run(account.id, currentToken);

  writeAuditEvent({
    actorUserId: account.id,
    actorRole: account.role,
    action: 'USER_PASSWORD_CHANGED',
    entityType: 'USER',
    entityId: account.id,
    details: { otherSessionsRevoked: true }
  });

  res.json({ success: true, message: 'Password updated. Other devices were signed out.' });
});

// ============================================================================
// 3b. NOTIFICATIONS
// ============================================================================
function audienceMatches(audience: string, role: string): boolean {
  if (audience === 'ALL') return true;
  if (audience === 'LEARNERS') return role === 'LEARNER';
  if (audience === 'STAFF') return ['GUIDE', 'ADMIN', 'CURRICULUM_OWNER'].includes(role);
  return false;
}

/** Notices for the signed-in user, newest first, with a read flag. */
app.get('/api/notifications', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const role = req.user!.role;

  const rows = db
    .prepare(
      `SELECT n.*, CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read, r.read_at
         FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
        WHERE (n.audience = 'USER' AND n.target_user_id = ?)
           OR (n.audience != 'USER' AND substr(n.created_at, 1, 10) >= '2000-01-01')
        ORDER BY n.created_at DESC
        LIMIT 50`
    )
    .all(userId, userId) as any[];

  const mine = rows.filter((n) => n.audience === 'USER' || audienceMatches(n.audience, role));

  res.json({
    success: true,
    unreadCount: mine.filter((n) => !n.is_read).length,
    notifications: mine.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      audience: n.audience,
      createdByName: n.created_by_name,
      createdAt: n.created_at,
      isRead: Boolean(n.is_read)
    }))
  });
});

app.post('/api/notifications/:notificationId/read', requireAuth, (req, res) => {
  const { notificationId } = req.params;
  db.prepare(
    'INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at) VALUES (?, ?, ?)'
  ).run(notificationId, req.user!.id, new Date().toISOString());
  res.json({ success: true });
});

app.get('/api/admin/notifications', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM users u
                WHERE u.account_status = 'ACTIVE'
                  AND (n.audience = 'ALL'
                    OR (n.audience = 'LEARNERS' AND u.role = 'LEARNER')
                    OR (n.audience = 'STAFF' AND u.role IN ('GUIDE','ADMIN','CURRICULUM_OWNER'))
                    OR (n.audience = 'USER' AND u.id = n.target_user_id))) AS recipient_count,
              (SELECT COUNT(*) FROM notification_reads r WHERE r.notification_id = n.id) AS read_count
         FROM notifications n
        ORDER BY n.created_at DESC
        LIMIT 100`
    )
    .all() as any[];

  res.json({
    success: true,
    notifications: rows.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      audience: n.audience,
      targetUserId: n.target_user_id,
      createdByName: n.created_by_name,
      createdAt: n.created_at,
      recipientCount: n.recipient_count,
      readCount: n.read_count
    }))
  });
});

app.post('/api/admin/notifications', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  const audience = String(req.body?.audience || 'ALL').toUpperCase();
  const targetUserId = String(req.body?.targetUserId || '').trim();

  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Add a title and a message.' });
  }
  if (title.length > 120) {
    return res.status(400).json({ success: false, error: 'Keep the title under 120 characters.' });
  }
  if (!['ALL', 'LEARNERS', 'STAFF', 'USER'].includes(audience)) {
    return res.status(400).json({ success: false, error: 'Choose who should receive this.' });
  }
  if (audience === 'USER') {
    if (!targetUserId) {
      return res.status(400).json({ success: false, error: 'Pick the person who should receive this.' });
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'That account does not exist.' });
    }
  }

  const id = `ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO notifications (id, title, message, audience, target_user_id, created_by_id, created_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    message,
    audience,
    audience === 'USER' ? targetUserId : null,
    req.user!.id,
    req.user!.name,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'NOTIFICATION_SENT',
    entityType: 'NOTIFICATION',
    entityId: id,
    details: { audience, targetUserId: audience === 'USER' ? targetUserId : null, title }
  });

  res.status(201).json({ success: true, id });
});

app.delete('/api/admin/notifications/:notificationId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { notificationId } = req.params;
  db.prepare('DELETE FROM notification_reads WHERE notification_id = ?').run(notificationId);
  db.prepare('DELETE FROM notifications WHERE id = ?').run(notificationId);
  res.json({ success: true });
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
             c.description as course_description, c.modules_json,
             (SELECT COUNT(*) FROM course_steps s WHERE s.course_id = sc.course_id) AS step_count,
             (SELECT COUNT(*) FROM learner_step_progress p
                WHERE p.learner_id = sc.learner_id AND p.course_id = sc.course_id AND p.status = 'COMPLETED') AS steps_done
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

  const learnerCalls = db
    .prepare(
      `SELECT b.id, b.topic, b.status, b.preferred_date, b.preferred_time, b.notes, b.created_at,
              s.name AS staff_name, s.role AS staff_role
         FROM call_bookings b
         LEFT JOIN users s ON s.id = b.staff_id
        WHERE b.learner_id = ?
        ORDER BY b.preferred_date DESC, b.created_at DESC`
    )
    .all(targetLearnerId);

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
    calls: learnerCalls,
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

/**
 * Nudge one person. Used when a task is reviewed or a message is written, so the
 * other side sees it in the bell instead of having to open the task to find out.
 */
const notifyUser = (
  userId: string | null | undefined,
  title: string,
  message: string,
  actor: { id: string; name: string }
) => {
  if (!userId) return;
  db.prepare(
    `INSERT INTO notifications (id, title, message, audience, target_user_id, created_by_id, created_by_name, created_at)
     VALUES (?, ?, ?, 'USER', ?, ?, ?, ?)`
  ).run(
    `ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    title.slice(0, 120),
    message.slice(0, 500),
    userId,
    actor.id,
    actor.name,
    new Date().toISOString()
  );
};

/** Everyone who should answer a learner: their guide, and admins as a fallback. */
const staffToNudge = (learnerId: string) => {
  const learner = db.prepare('SELECT assigned_guide_id FROM users WHERE id = ?').get(learnerId) as any;
  if (learner?.assigned_guide_id) return [learner.assigned_guide_id];
  const admins = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND account_status = 'ACTIVE'").all() as any[];
  return admins.map((a) => a.id);
};

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

  // Tell the other side. A learner's message goes to their guide; a mentor's
  // reply goes back to the learner on that task.
  if (req.user!.role === 'LEARNER') {
    for (const staffId of staffToNudge(task.learner_id)) {
      notifyUser(
        staffId,
        `New message from ${req.user!.name}`,
        `${req.user!.name} wrote about "${task.title}": ${message.slice(0, 180)}`,
        { id: req.user!.id, name: req.user!.name }
      );
    }
  } else {
    notifyUser(
      task.learner_id,
      `New message about "${task.title}"`,
      `${req.user!.name}: ${message.slice(0, 180)}`,
      { id: req.user!.id, name: req.user!.name }
    );
  }

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
app.get('/api/guide/workspace', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
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

app.get('/api/guide/learners/:learnerId', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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
app.post('/api/guide/learners/:learnerId/conversations', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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
app.post('/api/guide/learners/:learnerId/assessments', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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
app.post('/api/guide/pdp/:pdpId/decision', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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
app.post('/api/guide/learners/:learnerId/level-decision', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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

app.post('/api/guide/learners/:learnerId/competency-proposal', requireRole(['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
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
/**
 * Paged list helpers.
 *
 * The console is built for a roster that starts at a thousand learners, so the
 * big lists are never sent in one go. Every list endpoint here takes `page` and
 * `limit`, answers with the rows for that page plus the total, and the UI shows
 * a pager. Search and status filters run in SQL, not in the browser.
 */
const readPaging = (req: Request, defaultLimit = 25, maxLimit = 200) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
};

/** Escape a user's search text for a LIKE, so % and _ stay literal. */
const likeTerm = (value: unknown) => `%${String(value ?? '').trim().replace(/[\\%_]/g, '')}%`;

const hasSearch = (value: unknown) => String(value ?? '').trim().length > 0;

const paged = (req: Request, res: Response, rows: any[], total: number, page: number, limit: number) =>
  res.json({ success: true, rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });

// Reference data and counts for the whole console. Small and cheap on purpose:
// the per-learner and per-task detail is fetched by the section that needs it.
app.get('/api/admin/metrics', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as any).c as number;

  const discoveryQuestions = getAllDiscoveryQuestions();
  const courses = (db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all() as any[]).map((c) => ({
    ...c,
    modules: JSON.parse(c.modules_json || '[]'),
    step_count: (db.prepare('SELECT COUNT(*) AS n FROM course_steps WHERE course_id = ?').get(c.id) as any).n
  }));
  const courseQuestions = (db.prepare('SELECT * FROM course_questions ORDER BY created_at ASC').all() as any[]).map((q) => ({
    ...q,
    options: JSON.parse(q.options_json || '[]')
  }));

  return res.json({
    success: true,
    metrics: {
      totalUsers: count('SELECT COUNT(*) AS c FROM users'),
      activeLearners: count("SELECT COUNT(*) AS c FROM users WHERE role = 'LEARNER' AND account_status = 'ACTIVE'"),
      activeGuides: count("SELECT COUNT(*) AS c FROM users WHERE role = 'GUIDE' AND account_status = 'ACTIVE'"),
      totalLeads: count('SELECT COUNT(*) AS c FROM leads'),
      newLeads: count("SELECT COUNT(*) AS c FROM leads WHERE status = 'NEW'"),
      totalCallBookings: count('SELECT COUNT(*) AS c FROM call_bookings'),
      activeDiscoveryQuestionsCount: discoveryQuestions.filter((q) => q.isActive).length,
      completedDiscoveries: count(
        'SELECT COUNT(DISTINCT session_id) AS c FROM discovery_responses'
      ),
      totalCourses: courses.length,
      totalCourseQuestions: courseQuestions.length,
      assignedStudentCourses: count('SELECT COUNT(*) AS c FROM student_courses'),
      submittedTasksForReview: count("SELECT COUNT(*) AS c FROM learning_tasks WHERE status = 'SUBMITTED'"),
      totalTasks: count('SELECT COUNT(*) AS c FROM learning_tasks'),
      pendingPDPReviews: count("SELECT COUNT(*) AS c FROM pdp_versions WHERE status = 'PENDING_GUIDE_REVIEW'")
    },
    courses,
    courseQuestions,
    competencies: db.prepare('SELECT * FROM core_competencies ORDER BY code ASC').all(),
    discoveryQuestions,
    activeQuestionsCount: discoveryQuestions.filter((q) => q.isActive).length
  });
});

// Learners, one page at a time, with their course and task counts worked out in SQL.
app.get('/api/admin/learners/directory', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, name, email, track FROM users WHERE role = 'LEARNER' AND account_status = 'ACTIVE' ORDER BY name ASC"
    )
    .all();
  res.json({ success: true, rows });
});

app.get('/api/admin/learners', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const q = req.query.q;
  const status = String(req.query.status || '').trim();
  const track = String(req.query.track || '').trim();

  const where: string[] = ["u.role = 'LEARNER'"];
  const params: any[] = [];
  if (hasSearch(q)) {
    where.push("(u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.phone, '') LIKE ?)");
    params.push(likeTerm(q), likeTerm(q), likeTerm(q));
  }
  if (status && status !== 'ALL') {
    where.push('u.account_status = ?');
    params.push(status);
  }
  if (track && track !== 'ALL') {
    where.push('u.track = ?');
    params.push(track);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM users u ${whereSql}`).get(...params) as any
  ).c as number;

  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.track, u.account_status, u.created_at, u.phone, u.city,
              g.name AS guide_name,
              (SELECT COUNT(*) FROM student_courses sc WHERE sc.learner_id = u.id) AS course_count,
              (SELECT COALESCE(SUM(sc.amount_paid), 0) FROM student_courses sc WHERE sc.learner_id = u.id) AS paid_total,
              (SELECT COUNT(*) FROM learning_tasks t WHERE t.learner_id = u.id) AS task_count,
              (SELECT COUNT(*) FROM learning_tasks t WHERE t.learner_id = u.id AND t.learner_submission IS NOT NULL) AS submitted_count,
              (SELECT COUNT(*) FROM learning_tasks t WHERE t.learner_id = u.id AND t.status IN ('REVIEWED', 'APPROVED')) AS reviewed_count,
              (SELECT MAX(COALESCE(t.submitted_at, t.reviewed_at, t.due_date)) FROM learning_tasks t WHERE t.learner_id = u.id) AS last_activity
       FROM users u
       LEFT JOIN users g ON g.id = u.assigned_guide_id
       ${whereSql}
       ORDER BY (last_activity IS NULL) ASC, last_activity DESC, u.name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return paged(req, res, rows, total, page, limit);
});

// One learner's course and task detail, used by the progress screen and dossiers.
app.get('/api/admin/learners/:learnerId/progress', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const learnerId = String(req.params.learnerId);
  const learner = db
    .prepare('SELECT id, name, email, role, track, account_status, created_at FROM users WHERE id = ?')
    .get(learnerId) as any;
  if (!learner) {
    return res.status(404).json({ success: false, error: 'Learner not found.' });
  }

  const courses = db
    .prepare(
      `SELECT sc.id, sc.course_id, sc.custom_notes, sc.status, sc.assigned_at,
              c.title AS course_title, c.level AS course_level, c.description AS course_description,
              (SELECT COUNT(*) FROM course_questions q WHERE q.course_id = sc.course_id) AS question_count,
              (SELECT COUNT(DISTINCT cqa.question_id) FROM course_question_attempts cqa
                 JOIN course_questions q ON q.id = cqa.question_id
                WHERE q.course_id = sc.course_id AND cqa.learner_id = sc.learner_id) AS answered_count,
              (SELECT COUNT(*) FROM learning_tasks t WHERE t.learner_id = sc.learner_id AND t.course_id = sc.course_id) AS task_count,
              (SELECT COUNT(*) FROM learning_tasks t WHERE t.learner_id = sc.learner_id AND t.course_id = sc.course_id
                 AND t.status IN ('SUBMITTED', 'REVIEWED', 'APPROVED')) AS tasks_started
       FROM student_courses sc
       JOIN courses c ON c.id = sc.course_id
       WHERE sc.learner_id = ?
       ORDER BY sc.assigned_at DESC`
    )
    .all(learnerId);

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.course_id, t.submitted_at, t.reviewed_at, t.due_date,
              t.learner_submission, t.uploaded_file_name, t.guide_feedback, t.ai_review_json,
              c.title AS course_title
       FROM learning_tasks t
       LEFT JOIN courses c ON c.id = t.course_id
       WHERE t.learner_id = ?
       ORDER BY COALESCE(t.submitted_at, t.reviewed_at, t.due_date) DESC`
    )
    .all(learnerId) as any[];

  const withVerdicts = tasks.map((t) => {
    let verdict: string | null = null;
    let confidence: number | null = null;
    if (t.ai_review_json) {
      try {
        const parsed = JSON.parse(t.ai_review_json);
        verdict = parsed.verdict || null;
        confidence = parsed.confidence ?? null;
      } catch {
        /* leave it empty */
      }
    }
    const { ai_review_json, learner_submission, ...rest } = t;
    return {
      ...rest,
      submission_preview: learner_submission ? String(learner_submission).slice(0, 220) : null,
      aiVerdict: verdict,
      aiConfidence: confidence
    };
  });

  const attempts = db
    .prepare('SELECT question_id, is_correct, attempted_at FROM course_question_attempts WHERE learner_id = ? ORDER BY attempted_at DESC')
    .all(learnerId);

  res.json({ success: true, learner, courses, tasks: withVerdicts, attempts });
});

// The review queue. Rows are light: no file blobs, no full submissions.
app.get('/api/admin/tasks', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const status = String(req.query.status || '').trim();
  const q = req.query.q;
  const courseId = String(req.query.courseId || '').trim();
  const range = String(req.query.range || '').trim().toUpperCase();

  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (status && status !== 'ALL') {
    where.push('t.status = ?');
    params.push(status);
  }
  if (courseId && courseId !== 'ALL') {
    where.push('t.course_id = ?');
    params.push(courseId);
  }
  if (range === 'TODAY') {
    where.push("date(COALESCE(t.submitted_at, t.assigned_at, t.due_date)) = date('now')");
  } else if (range === 'WEEK') {
    where.push("date(COALESCE(t.submitted_at, t.assigned_at, t.due_date)) >= date('now', '-7 day')");
  } else if (range === 'MONTH') {
    where.push("date(COALESCE(t.submitted_at, t.assigned_at, t.due_date)) >= date('now', '-30 day')");
  } else if (range === 'DUE') {
    where.push("t.status = 'ASSIGNED' AND t.due_date IS NOT NULL AND date(t.due_date) <= date('now', '+3 day')");
  }
  if (hasSearch(q)) {
    where.push("(t.title LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR COALESCE(c.title, '') LIKE ?)");
    params.push(likeTerm(q), likeTerm(q), likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c
         FROM learning_tasks t
         JOIN users u ON u.id = t.learner_id
         LEFT JOIN courses c ON c.id = t.course_id
         ${whereSql}`)
      .get(...params) as any
  ).c as number;

  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.course_id, t.step_id, t.learner_id,
              t.assigned_at, t.submitted_at, t.reviewed_at, t.due_date,
              t.uploaded_file_name, t.guide_feedback, t.ai_review_json,
              u.name AS learner_name, u.email AS learner_email, u.track AS learner_track,
              c.title AS course_title,
              (SELECT COUNT(*) FROM task_messages m WHERE m.task_id = t.id) AS message_count
       FROM learning_tasks t
       JOIN users u ON u.id = t.learner_id
       LEFT JOIN courses c ON c.id = t.course_id
       ${whereSql}
       ORDER BY CASE WHEN t.status = 'SUBMITTED' THEN 0 WHEN t.status = 'ASSIGNED' THEN 1 ELSE 2 END,
                COALESCE(t.submitted_at, t.reviewed_at, t.due_date) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as any[];

  const light = rows.map((t) => {
    let verdict: string | null = null;
    let confidence: number | null = null;
    let preview: string | null = null;
    if (t.ai_review_json) {
      try {
        const parsed = JSON.parse(t.ai_review_json);
        verdict = parsed.verdict || null;
        confidence = parsed.confidence ?? null;
      } catch {
        /* ignore */
      }
    }
    const submission = db.prepare('SELECT learner_submission FROM learning_tasks WHERE id = ?').get(t.id) as any;
    if (submission?.learner_submission) preview = String(submission.learner_submission).slice(0, 160);
    const { ai_review_json, ...rest } = t;
    return { ...rest, aiVerdict: verdict, aiConfidence: confidence, submission_preview: preview };
  });

  return paged(req, res, light, total, page, limit);
});

// Everything about one task: the submission, the AI pre-check and the chat.
app.get('/api/admin/tasks/:taskId', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const taskId = String(req.params.taskId);
  const task = db
    .prepare(
      `SELECT t.*, u.name AS learner_name, u.email AS learner_email, u.track AS learner_track,
              c.title AS course_title
       FROM learning_tasks t
       JOIN users u ON u.id = t.learner_id
       LEFT JOIN courses c ON c.id = t.course_id
       WHERE t.id = ?`
    )
    .get(taskId) as any;
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found.' });
  }

  let aiReview = null;
  if (task.ai_review_json) {
    try {
      aiReview = JSON.parse(task.ai_review_json);
    } catch {
      aiReview = null;
    }
  } else if (task.learner_submission) {
    aiReview = analyzeStudentTaskSubmissionWithAI({
      taskTitle: task.title,
      instructions: task.instructions,
      expectedCriteria: task.expected_criteria || '',
      learnerSubmission: task.learner_submission,
      uploadedFileName: task.uploaded_file_name || undefined
    });
  }

  const messages = db.prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
  res.json({ success: true, task: { ...task, aiReview, messages } });
});

app.get('/api/admin/leads', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const status = String(req.query.status || '').trim();
  const q = req.query.q;

  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (status && status !== 'ALL') {
    where.push('status = ?');
    params.push(status);
  }
  if (hasSearch(q)) {
    where.push('(name LIKE ? OR email LIKE ? OR track LIKE ? OR custom_track LIKE ?)');
    params.push(likeTerm(q), likeTerm(q), likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM leads ${whereSql}`).get(...params) as any).c as number;
  const rows = db
    .prepare(`SELECT * FROM leads ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return paged(req, res, rows, total, page, limit);
});

app.get('/api/admin/bookings', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const status = String(req.query.status || '').trim();
  const q = req.query.q;
  const source = String(req.query.source || '').trim().toUpperCase();

  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (status && status !== 'ALL') {
    where.push('b.status = ?');
    params.push(status);
  }
  if (source === 'LEARNER') {
    where.push('b.learner_id IS NOT NULL');
  } else if (source === 'PUBLIC') {
    where.push('b.learner_id IS NULL');
  }
  if (hasSearch(q)) {
    where.push(
      "(b.participant_name LIKE ? OR b.participant_email LIKE ? OR COALESCE(b.topic, '') LIKE ? OR COALESCE(learner.name, '') LIKE ?)"
    );
    params.push(likeTerm(q), likeTerm(q), likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM call_bookings b LEFT JOIN users learner ON learner.id = b.learner_id ${whereSql}`
      )
      .get(...params) as any
  ).c as number;
  const rows = (db
    .prepare(
      `SELECT b.*, staff.name AS staff_name, staff.role AS staff_role, learner.name AS learner_name,
              learner.email AS learner_email
         FROM call_bookings b
         LEFT JOIN users staff ON staff.id = b.staff_id
         LEFT JOIN users learner ON learner.id = b.learner_id
         ${whereSql}
         ORDER BY CASE WHEN b.status = 'REQUESTED' THEN 0 ELSE 1 END, b.created_at DESC
         LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as any[]).map((b) => ({
    ...b,
    phone: b.participant_phone,
    preferred_time_slot: b.preferred_time,
    result_summary: b.recommended_focus
  }));

  return paged(req, res, rows, total, page, limit);
});

app.get('/api/admin/users', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const role = String(req.query.role || '').trim();
  const scope = String(req.query.scope || '').trim();
  const q = req.query.q;

  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  // Staff and learners are two different jobs. The access list only ever shows
  // people who can sign in to a staff console.
  if (scope === 'staff') {
    where.push("role IN ('ADMIN', 'CURRICULUM_OWNER', 'GUIDE')");
  } else if (scope === 'learner') {
    where.push("role = 'LEARNER'");
  }
  if (role && role !== 'ALL') {
    where.push('role = ?');
    params.push(role);
  }
  if (hasSearch(q)) {
    where.push('(name LIKE ? OR email LIKE ?)');
    params.push(likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`).get(...params) as any).c as number;
  const rows = db
    .prepare(
      `SELECT id, name, email, role, account_status, track, created_at
       FROM users ${whereSql}
       ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'CURRICULUM_OWNER' THEN 1 WHEN 'GUIDE' THEN 2 ELSE 3 END, name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return paged(req, res, rows, total, page, limit);
});

app.get('/api/admin/student-courses', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 20);
  const q = req.query.q;
  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (hasSearch(q)) {
    where.push('(u.name LIKE ? OR c.title LIKE ?)');
    params.push(likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM student_courses sc
         JOIN courses c ON c.id = sc.course_id JOIN users u ON u.id = sc.learner_id ${whereSql}`
      )
      .get(...params) as any
  ).c as number;

  const rows = db
    .prepare(
      `SELECT sc.*, c.title AS course_title, c.track AS course_track, c.level AS course_level,
              u.name AS learner_name, u.email AS learner_email
       FROM student_courses sc
       JOIN courses c ON c.id = sc.course_id
       JOIN users u ON u.id = sc.learner_id
       ${whereSql}
       ORDER BY sc.assigned_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return paged(req, res, rows, total, page, limit);
});

app.get('/api/admin/audit', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 25);
  const q = req.query.q;
  const where: string[] = ['1 = 1'];
  const params: any[] = [];
  if (hasSearch(q)) {
    where.push('(action LIKE ? OR entity_id LIKE ? OR actor_role LIKE ?)');
    params.push(likeTerm(q), likeTerm(q), likeTerm(q));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_events ${whereSql}`).get(...params) as any).c as number;
  const rows = (db
    .prepare(`SELECT * FROM audit_events ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[]).map((a) => ({
    ...a,
    details: JSON.parse(a.details_json || '{}')
  }));

  return paged(req, res, rows, total, page, limit);
});

app.get('/api/admin/discovery-sessions', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { page, limit, offset } = readPaging(req, 12);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM discovery_sessions').get() as any).c as number;
  const sessions = db
    .prepare('SELECT * FROM discovery_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as any[];
  const discoveryQuestions = getAllDiscoveryQuestions();

  const rows = sessions.map((sess) => {
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
    return {
      ...sess,
      answeredCount: detailedAnswers.length,
      detailedAnswers,
      candidateResult: evaluateCandidateDiscoveryResult(flatAnswers, sess.track, sess.custom_track || '')
    };
  });

  return paged(req, res, rows, total, page, limit);
});

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
    modules: JSON.parse(c.modules_json || '[]'),
    step_count: (db.prepare('SELECT COUNT(*) AS n FROM course_steps WHERE course_id = ?').get(c.id) as any).n,
    learner_count: (db.prepare('SELECT COUNT(*) AS n FROM student_courses WHERE course_id = ?').get(c.id) as any).n
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

  // Course question attempts, so the console can show per-learner course progress.
  const courseQuestionAttempts = db
    .prepare('SELECT question_id, learner_id, is_correct, attempted_at FROM course_question_attempts ORDER BY attempted_at DESC')
    .all();

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
    courseQuestionAttempts,
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
  const durationHours = Number(req.body?.durationHours) > 0 ? Number(req.body.durationHours) : null;
  const price = Math.max(0, Number(req.body?.price) || 0);
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Course title and description are required.' });
  }

  const courseId = `crs_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO courses (id, title, track, level, description, modules_json, created_by, created_at,
                         duration_hours, price, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    courseId,
    title,
    track,
    level,
    description,
    JSON.stringify(rawModules.length > 0 ? rawModules : ['Module 1: Core Concepts', 'Module 2: Practical Strategy Application']),
    req.user!.id,
    now,
    durationHours,
    price,
    isActive
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_COURSE_CREATED',
    entityType: 'COURSE',
    entityId: courseId,
    details: { title, track, level, moduleCount: rawModules.length, durationHours, price, isActive }
  });

  res.status(201).json({ success: true, courseId });
});

app.post('/api/admin/courses/assign', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const courseId = String(req.body?.courseId || '').trim();
  const learnerId = String(req.body?.learnerId || '').trim();
  const customNotes = String(req.body?.customNotes || '').trim();
  const amountPaid = Math.max(0, Number(req.body?.amountPaid) || 0);
  const rawPayment = String(req.body?.paymentStatus || '').toUpperCase();
  const paymentStatus = ['PAID', 'PENDING', 'WAIVED', 'NOT_APPLICABLE'].includes(rawPayment)
    ? rawPayment
    : amountPaid > 0
      ? 'PAID'
      : 'NOT_APPLICABLE';

  if (!courseId || !learnerId) {
    return res.status(400).json({ success: false, error: 'Both courseId and learnerId are required.' });
  }

  const targetCourse = db.prepare('SELECT id, title, is_active FROM courses WHERE id = ?').get(courseId) as any;
  if (!targetCourse) {
    return res.status(404).json({ success: false, error: 'Course not found.' });
  }
  if (Number(targetCourse.is_active) === 0) {
    return res.status(400).json({
      success: false,
      error: 'That course is inactive. Switch it on before you assign it.'
    });
  }

  const id = `sc_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO student_courses (id, course_id, learner_id, custom_notes, progress_pct, status, assigned_by, assigned_at,
                                 source, amount_paid, payment_status, paid_at)
    VALUES (?, ?, ?, ?, 0, 'ACTIVE', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    courseId,
    learnerId,
    customNotes || 'Customised course assigned by Admin.',
    req.user!.id,
    now,
    amountPaid > 0 ? 'PURCHASED' : 'ADMIN_ASSIGNED',
    amountPaid,
    paymentStatus,
    amountPaid > 0 ? now : null
  );

  const assignedCourse = db.prepare('SELECT title FROM courses WHERE id = ?').get(courseId) as any;
  notifyUser(
    learnerId,
    'A new course is on your dashboard',
    `${req.user!.name} assigned "${assignedCourse?.title || 'a course'}" to you.${
      customNotes ? ` Note: ${customNotes}` : ''
    }`,
    { id: req.user!.id, name: req.user!.name }
  );

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

  const durationHours =
    req.body?.durationHours !== undefined
      ? Number(req.body.durationHours) > 0
        ? Number(req.body.durationHours)
        : null
      : existing.duration_hours;
  const price = req.body?.price !== undefined ? Math.max(0, Number(req.body.price) || 0) : existing.price;
  const isActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : existing.is_active;

  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Course title and description are required.' });
  }

  db.prepare(`
    UPDATE courses
       SET title = ?, track = ?, level = ?, description = ?, modules_json = ?,
           duration_hours = ?, price = ?, is_active = ?
     WHERE id = ?
  `).run(
    title,
    track,
    level,
    description,
    JSON.stringify(modules),
    durationHours,
    price,
    isActive,
    courseId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action:
      Number(existing.is_active) !== Number(isActive)
        ? isActive
          ? 'ADMIN_COURSE_ACTIVATED'
          : 'ADMIN_COURSE_DEACTIVATED'
        : 'ADMIN_COURSE_UPDATED',
    entityType: 'COURSE',
    entityId: courseId,
    details: { title, track, level, moduleCount: modules.length, durationHours, price, isActive }
  });

  return res.json({
    success: true,
    course: {
      ...existing,
      title,
      track,
      level,
      description,
      modules,
      modules_json: JSON.stringify(modules),
      duration_hours: durationHours,
      price,
      is_active: isActive
    }
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
      competency_code, status, due_date, assigned_at
    ) VALUES (?, ?, 'pdp_aarav_v1', ?, ?, ?, ?, ?, ?, 'ASSIGNED', ?, ?)
  `).run(
    taskId,
    learnerId,
    courseId,
    title,
    category,
    instructions,
    expectedCriteria || instructions,
    competencyCode,
    dueDate,
    now
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

  // A course milestone only opens the next step when a mentor passes it.
  if (task.step_id) {
    if (status === 'REVIEWED') {
      markStepCompleted({
        learnerId: task.learner_id,
        courseId: task.course_id,
        stepId: task.step_id,
        taskId,
        note: guideFeedback
      });
    } else {
      db.prepare(
        "UPDATE learner_step_progress SET status = 'IN_PROGRESS', updated_at = ? WHERE learner_id = ? AND step_id = ?"
      ).run(now, task.learner_id, task.step_id);
    }
  }

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

  notifyUser(
    task.learner_id,
    status === 'REVIEWED' ? `Task reviewed: ${task.title}` : `Changes asked on: ${task.title}`,
    guideFeedback,
    { id: req.user!.id, name: req.user!.name }
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

/**
 * Booking status. A booking starts as CONFIRMED, and the team moves it along.
 */
app.patch('/api/admin/bookings/:bookingId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { bookingId } = req.params;
  const status = String(req.body?.status || '').toUpperCase();
  const allowed = ['REQUESTED', 'NEW', 'DIRECT_CALL_BOOKED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: `Status must be one of: ${allowed.join(', ')}.` });
  }

  const booking = db.prepare('SELECT * FROM call_bookings WHERE id = ?').get(bookingId) as any;
  if (!booking) {
    return res.status(404).json({ success: false, error: 'Booking not found.' });
  }

  const staffId = req.body?.staffId !== undefined ? String(req.body.staffId).trim() || null : booking.staff_id;
  if (staffId && !db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('ADMIN', 'GUIDE', 'CURRICULUM_OWNER')").get(staffId)) {
    return res.status(400).json({ success: false, error: 'That person cannot take calls.' });
  }
  const preferredDate =
    req.body?.preferredDate !== undefined ? String(req.body.preferredDate).trim() : booking.preferred_date;
  const preferredTime =
    req.body?.preferredTime !== undefined ? String(req.body.preferredTime).trim() : booking.preferred_time;
  const topic = req.body?.topic !== undefined ? String(req.body.topic).trim() : booking.topic;
  const notes = req.body?.notes !== undefined ? String(req.body.notes).trim() : booking.notes;

  db.prepare(
    `UPDATE call_bookings
        SET status = ?, staff_id = ?, preferred_date = ?, preferred_time = ?, topic = ?, notes = ?, updated_at = ?
      WHERE id = ?`
  ).run(status, staffId, preferredDate, preferredTime, topic, notes, new Date().toISOString(), bookingId);

  if (booking.learner_id) {
    const verb =
      status === 'CONFIRMED'
        ? 'confirmed'
        : status === 'CANCELLED'
          ? 'cancelled'
          : status === 'RESCHEDULED'
            ? 'moved'
            : status === 'COMPLETED'
              ? 'marked done'
              : 'updated';
    notifyUser(
      booking.learner_id,
      `Your call is ${status === 'CONFIRMED' ? 'confirmed' : status.toLowerCase()}`,
      `The ${preferredDate} call was ${verb}${staffId ? ' with your mentor' : ''}. ${topic || ''}`.trim(),
      { id: req.user!.id, name: req.user!.name }
    );
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'CALL_BOOKING_UPDATED',
    entityType: 'CALL_BOOKING',
    entityId: bookingId,
    details: { previousStatus: booking.status, nextStatus: status, staffId, preferredDate, preferredTime }
  });

  res.json({ success: true, bookingId, status });
});

app.patch('/api/admin/leads/:leadId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const { leadId } = req.params;
  const status = String(req.body?.status || '').toUpperCase();
  const allowed = ['NEW', 'DISCOVERY_STARTED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'CLOSED'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: `Status must be one of: ${allowed.join(', ')}.` });
  }

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, leadId);
  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEAD_STATUS_UPDATED',
    entityType: 'LEAD',
    entityId: leadId,
    details: { previousStatus: lead.status, nextStatus: status }
  });

  res.json({ success: true, leadId, status });
});

/**
 * Admin-side password reset. Returns a one-time password; the account holder is
 * expected to change it after signing in.
 */
app.get('/api/admin/users/:userId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const row = db
    .prepare(
      `SELECT id, name, email, role, account_status, track, phone, city, created_at, updated_at
         FROM users WHERE id = ?`
    )
    .get(req.params.userId) as any;
  if (!row) return res.status(404).json({ success: false, error: 'User not found.' });
  res.json({ success: true, account: row });
});

app.post('/api/admin/users/:userId/reset-password', requireRole(['ADMIN']), (req, res) => {
  const { userId } = req.params;
  const target = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId) as any;
  if (!target) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  const temporaryPassword = generateTemporaryPassword();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(temporaryPassword),
    new Date().toISOString(),
    target.id
  );
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(target.id);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'USER_PASSWORD_RESET',
    entityType: 'USER',
    entityId: target.id,
    details: { targetEmail: target.email }
  });

  res.json({ success: true, userId: target.id, temporaryPassword });
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

app.get('/api/admin/competencies', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (_req, res) => {
  const rows = db.prepare('SELECT * FROM core_competencies ORDER BY code ASC').all();
  res.json({ success: true, rows, total: rows.length });
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


// ============================================================================
// COURSE STEPS, LEARNER DOSSIERS, DIRECT CALLS
//
// A course is a sequence of steps. A step can be reading, a video link, a PDF or
// Word file, a plain link, or a practical task. Steps open one at a time: the
// learner finishes step N and step N + 1 unlocks. Task steps are finished by a
// mentor review, not by ticking a box.
// ============================================================================

const STEP_KINDS = ['TEXT', 'VIDEO', 'PDF', 'DOC', 'LINK', 'TASK'] as const;
type StepKind = (typeof STEP_KINDS)[number];

const normaliseKind = (value: unknown): StepKind => {
  const kind = String(value || '').toUpperCase();
  return (STEP_KINDS as readonly string[]).includes(kind) ? (kind as StepKind) : 'TEXT';
};

const listCourseSteps = (courseId: string) =>
  db
    .prepare('SELECT * FROM course_steps WHERE course_id = ? ORDER BY position ASC, created_at ASC')
    .all(courseId) as any[];

const publicStep = (step: any) => {
  const { file_data, ...rest } = step;
  return {
    ...rest,
    isMilestone: Boolean(rest.is_milestone),
    hasFile: Boolean(file_data),
    fileAvailable: Boolean(file_data) || Boolean(step.resource_url)
  };
};

/** Recomputes the enrolment percentage from completed steps and keeps status in step. */
const recalcEnrollmentProgress = (learnerId: string, courseId: string) => {
  const enrollment = db
    .prepare('SELECT * FROM student_courses WHERE learner_id = ? AND course_id = ?')
    .get(learnerId, courseId) as any;
  if (!enrollment) return null;

  const total = (db.prepare('SELECT COUNT(*) AS c FROM course_steps WHERE course_id = ?').get(courseId) as any).c;
  const done = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM learner_step_progress WHERE learner_id = ? AND course_id = ? AND status = 'COMPLETED'"
      )
      .get(learnerId, courseId) as any
  ).c;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const now = new Date().toISOString();
  const nextStatus = total > 0 && done >= total ? 'COMPLETED' : enrollment.status;

  db.prepare(
    `UPDATE student_courses
        SET progress_pct = ?, status = ?, completed_at = CASE WHEN ? = 'COMPLETED' THEN COALESCE(completed_at, ?) ELSE completed_at END
      WHERE id = ?`
  ).run(pct, nextStatus, nextStatus, now, enrollment.id);

  return { pct, done, total, status: nextStatus };
};

const markStepCompleted = (params: {
  learnerId: string;
  courseId: string;
  stepId: string;
  taskId?: string | null;
  note?: string | null;
}) => {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM learner_step_progress WHERE learner_id = ? AND step_id = ?')
    .get(params.learnerId, params.stepId) as any;

  if (existing) {
    db.prepare(
      `UPDATE learner_step_progress
          SET status = 'COMPLETED', task_id = COALESCE(?, task_id), completed_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(params.taskId || null, now, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO learner_step_progress (id, learner_id, course_id, step_id, status, task_id, completed_at, updated_at)
       VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`
    ).run(
      `sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      params.learnerId,
      params.courseId,
      params.stepId,
      params.taskId || null,
      now,
      now
    );
  }

  return recalcEnrollmentProgress(params.learnerId, params.courseId);
};

const learnerOwnsCourse = (learnerId: string, courseId: string) =>
  Boolean(
    db.prepare('SELECT id FROM student_courses WHERE learner_id = ? AND course_id = ?').get(learnerId, courseId)
  );

const activeLearnerIdsForStaff = (staffId: string) =>
  (db.prepare("SELECT id FROM users WHERE role = 'LEARNER' AND assigned_guide_id = ?").all(staffId) as any[]).map(
    (r) => r.id
  );

// ---------------------------------------------------------------------------
// Admin: course builder
// ---------------------------------------------------------------------------

// A light course list for pickers. The overview payload is too heavy for a select.
app.get('/api/admin/courses', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.track, c.level, c.description, c.created_at,
              c.duration_hours, c.price, c.is_active,
              (SELECT COUNT(*) FROM course_steps s WHERE s.course_id = c.id) AS step_count,
              (SELECT ROUND(SUM(COALESCE(NULLIF(s.estimated_minutes, 0), 20)) / 60.0, 1)
                 FROM course_steps s WHERE s.course_id = c.id) AS derived_hours,
              (SELECT COUNT(*) FROM student_courses sc WHERE sc.course_id = c.id) AS learner_count,
              (SELECT COALESCE(SUM(sc.amount_paid), 0) FROM student_courses sc WHERE sc.course_id = c.id) AS revenue
         FROM courses c
        ORDER BY c.created_at DESC`
    )
    .all();
  res.json({ success: true, rows });
});

app.get('/api/admin/courses/:courseId', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const courseId = String(req.params.courseId);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as any;
  if (!course) return res.status(404).json({ success: false, error: 'Course not found.' });

  const steps = listCourseSteps(courseId);
  const enrolled = (
    db.prepare('SELECT COUNT(*) AS c FROM student_courses WHERE course_id = ?').get(courseId) as any
  ).c;
  const questions = (
    db.prepare('SELECT COUNT(*) AS c FROM course_questions WHERE course_id = ?').get(courseId) as any
  ).c;

  const enrollments = db
    .prepare(
      `SELECT sc.id, sc.learner_id, sc.status, sc.progress_pct, sc.amount_paid, sc.payment_status, sc.assigned_at,
              u.name AS learner_name, u.email AS learner_email,
              (SELECT COUNT(*) FROM learner_step_progress p
                WHERE p.learner_id = sc.learner_id AND p.course_id = sc.course_id AND p.status = 'COMPLETED') AS steps_done
         FROM student_courses sc
         JOIN users u ON u.id = sc.learner_id
        WHERE sc.course_id = ?
        ORDER BY sc.assigned_at DESC
        LIMIT 50`
    )
    .all(courseId) as any[];

  const revenue = enrollments.reduce((sum, row) => sum + (Number(row.amount_paid) || 0), 0);

  res.json({
    success: true,
    course: { ...course, modules: JSON.parse(course.modules_json || '[]') },
    steps: steps.map(publicStep),
    enrolled,
    questions,
    enrollments,
    revenue
  });
});

app.post('/api/admin/courses/:courseId/steps', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const courseId = String(req.params.courseId);
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ success: false, error: 'Course not found.' });

  const title = String(req.body?.title || '').trim();
  const kind = normaliseKind(req.body?.kind);
  const content = String(req.body?.content || '').trim();
  const resourceUrl = String(req.body?.resourceUrl || '').trim();
  const fileName = String(req.body?.fileName || '').trim();
  const fileData = String(req.body?.fileData || '').trim();

  if (!title) return res.status(400).json({ success: false, error: 'Give the step a title.' });
  if (kind === 'TASK' && !content) {
    return res.status(400).json({ success: false, error: 'A task step needs instructions the learner can follow.' });
  }
  if ((kind === 'VIDEO' || kind === 'LINK') && !resourceUrl) {
    return res.status(400).json({ success: false, error: 'Add the video or page link.' });
  }
  if ((kind === 'PDF' || kind === 'DOC') && !fileData && !resourceUrl) {
    return res.status(400).json({ success: false, error: 'Upload the file or paste a link to it.' });
  }

  const maxPosition = (
    db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM course_steps WHERE course_id = ?').get(courseId) as any
  ).p;
  const now = new Date().toISOString();
  const stepId = `stp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  db.prepare(
    `INSERT INTO course_steps (
       id, course_id, position, title, kind, summary, content, resource_url, file_name, file_data,
       due_days, estimated_minutes, is_milestone, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stepId,
    courseId,
    maxPosition + 1,
    title,
    kind,
    String(req.body?.summary || '').trim() || null,
    content || null,
    resourceUrl || null,
    fileName || null,
    fileData || null,
    Number(req.body?.dueDays) > 0 ? Number(req.body.dueDays) : 7,
    Number(req.body?.estimatedMinutes) > 0 ? Number(req.body.estimatedMinutes) : 15,
    req.body?.isMilestone ? 1 : 0,
    now,
    now
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COURSE_STEP_CREATED',
    entityType: 'COURSE_STEP',
    entityId: stepId,
    details: { courseId, title, kind }
  });

  res.status(201).json({ success: true, stepId, step: publicStep(listCourseSteps(courseId).slice(-1)[0]) });
});

app.patch('/api/admin/course-steps/:stepId', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const stepId = String(req.params.stepId);
  const step = db.prepare('SELECT * FROM course_steps WHERE id = ?').get(stepId) as any;
  if (!step) return res.status(404).json({ success: false, error: 'Step not found.' });

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : step.title;
  if (!title) return res.status(400).json({ success: false, error: 'Give the step a title.' });

  const kind = req.body?.kind !== undefined ? normaliseKind(req.body.kind) : (step.kind as StepKind);
  const content = req.body?.content !== undefined ? String(req.body.content).trim() : step.content;
  const resourceUrl =
    req.body?.resourceUrl !== undefined ? String(req.body.resourceUrl).trim() : step.resource_url;

  if ((kind === 'VIDEO' || kind === 'LINK') && !resourceUrl) {
    return res.status(400).json({ success: false, error: 'Add the video or page link.' });
  }
  if (kind === 'TASK' && !content) {
    return res.status(400).json({ success: false, error: 'A task step needs instructions.' });
  }

  db.prepare(
    `UPDATE course_steps
        SET title = ?, kind = ?, summary = ?, content = ?, resource_url = ?, file_name = ?, file_data = ?,
            due_days = ?, estimated_minutes = ?, is_milestone = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    title,
    kind,
    req.body?.summary !== undefined ? String(req.body.summary).trim() || null : step.summary,
    content || null,
    resourceUrl || null,
    req.body?.fileName !== undefined ? String(req.body.fileName).trim() || null : step.file_name,
    req.body?.fileData !== undefined ? String(req.body.fileData).trim() || null : step.file_data,
    req.body?.dueDays !== undefined ? Math.max(1, Number(req.body.dueDays) || 7) : step.due_days,
    req.body?.estimatedMinutes !== undefined
      ? Math.max(1, Number(req.body.estimatedMinutes) || 15)
      : step.estimated_minutes,
    req.body?.isMilestone !== undefined ? (req.body.isMilestone ? 1 : 0) : step.is_milestone,
    new Date().toISOString(),
    stepId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COURSE_STEP_UPDATED',
    entityType: 'COURSE_STEP',
    entityId: stepId,
    details: { courseId: step.course_id, title, kind }
  });

  res.json({ success: true, step: publicStep(db.prepare('SELECT * FROM course_steps WHERE id = ?').get(stepId)) });
});

app.delete('/api/admin/course-steps/:stepId', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const stepId = String(req.params.stepId);
  const step = db.prepare('SELECT * FROM course_steps WHERE id = ?').get(stepId) as any;
  if (!step) return res.status(404).json({ success: false, error: 'Step not found.' });

  db.prepare('DELETE FROM learner_step_progress WHERE step_id = ?').run(stepId);
  db.prepare('DELETE FROM course_steps WHERE id = ?').run(stepId);

  const remaining = listCourseSteps(step.course_id);
  remaining.forEach((row, index) => {
    db.prepare('UPDATE course_steps SET position = ? WHERE id = ?').run(index + 1, row.id);
  });

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'COURSE_STEP_DELETED',
    entityType: 'COURSE_STEP',
    entityId: stepId,
    details: { courseId: step.course_id, title: step.title }
  });

  res.json({ success: true, removed: stepId });
});

app.post('/api/admin/courses/:courseId/steps/reorder', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const courseId = String(req.params.courseId);
  const stepIds = Array.isArray(req.body?.stepIds) ? req.body.stepIds.map(String) : [];
  const existing = listCourseSteps(courseId).map((s) => s.id);
  if (stepIds.length !== existing.length || !stepIds.every((id: string) => existing.includes(id))) {
    return res.status(400).json({ success: false, error: 'Send every step of the course, in the new order.' });
  }

  stepIds.forEach((id: string, index: number) => {
    db.prepare('UPDATE course_steps SET position = ?, updated_at = ? WHERE id = ?').run(
      index + 1,
      new Date().toISOString(),
      id
    );
  });

  res.json({ success: true, steps: listCourseSteps(courseId).map(publicStep) });
});

// ---------------------------------------------------------------------------
// Learner: the course player
// ---------------------------------------------------------------------------

app.get('/api/learner/courses/:courseId', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const courseId = String(req.params.courseId);
  const learnerId =
    req.user!.role === 'LEARNER' ? req.user!.id : String(req.query.learnerId || req.user!.id);

  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as any;
  if (!course) return res.status(404).json({ success: false, error: 'Course not found.' });

  const enrollment = db
    .prepare('SELECT * FROM student_courses WHERE learner_id = ? AND course_id = ?')
    .get(learnerId, courseId) as any;
  if (!enrollment && req.user!.role === 'LEARNER') {
    return res.status(403).json({ success: false, error: 'This course is not assigned to you.' });
  }

  const steps = listCourseSteps(courseId);
  const progressRows = db
    .prepare('SELECT * FROM learner_step_progress WHERE learner_id = ? AND course_id = ?')
    .all(learnerId, courseId) as any[];

  let previousDone = true;
  const decorated = steps.map((step, index) => {
    const row = progressRows.find((p) => p.step_id === step.id) || null;
    const completed = row?.status === 'COMPLETED';
    const unlocked = index === 0 ? true : previousDone;
    previousDone = completed;
    return {
      ...publicStep(step),
      status: completed ? 'COMPLETED' : row?.status || (unlocked ? 'OPEN' : 'LOCKED'),
      completed_at: row?.completed_at || null,
      task_id: row?.task_id || null,
      unlocked
    };
  });

  const completedCount = decorated.filter((s) => s.status === 'COMPLETED').length;
  const nextStep = decorated.find((s) => s.unlocked && s.status !== 'COMPLETED') || null;

  res.json({
    success: true,
    course: { ...course, modules: JSON.parse(course.modules_json || '[]') },
    enrollment: enrollment
      ? { ...enrollment, progress_pct: enrollment.progress_pct }
      : null,
    steps: decorated,
    completedCount,
    totalSteps: decorated.length,
    progressPct: decorated.length ? Math.round((completedCount / decorated.length) * 100) : 0,
    nextStepId: nextStep?.id || null
  });
});

app.get('/api/learner/course-steps/:stepId/file', requireRole(['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const step = db.prepare('SELECT * FROM course_steps WHERE id = ?').get(String(req.params.stepId)) as any;
  if (!step?.file_data) return res.status(404).json({ success: false, error: 'This step has no file.' });
  res.json({ success: true, fileName: step.file_name, fileData: step.file_data });
});

app.post('/api/learner/courses/:courseId/steps/:stepId/complete', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const { courseId, stepId } = req.params;
  const learnerId =
    req.user!.role === 'LEARNER' ? req.user!.id : String(req.body?.learnerId || req.user!.id);

  if (!learnerOwnsCourse(learnerId, courseId)) {
    return res.status(403).json({ success: false, error: 'This course is not assigned to you.' });
  }

  const step = db.prepare('SELECT * FROM course_steps WHERE id = ? AND course_id = ?').get(stepId, courseId) as any;
  if (!step) return res.status(404).json({ success: false, error: 'Step not found.' });
  if (step.kind === 'TASK') {
    return res
      .status(400)
      .json({ success: false, error: 'Submit the task. Your mentor marks this step complete after review.' });
  }

  const ordered = listCourseSteps(courseId);
  const index = ordered.findIndex((s) => s.id === stepId);
  const progressRows = db
    .prepare('SELECT * FROM learner_step_progress WHERE learner_id = ? AND course_id = ?')
    .all(learnerId, courseId) as any[];
  for (let i = 0; i < index; i += 1) {
    if (!progressRows.some((p) => p.step_id === ordered[i].id && p.status === 'COMPLETED')) {
      return res.status(409).json({ success: false, error: 'Finish the step above this one first.' });
    }
  }

  const summary = markStepCompleted({ learnerId, courseId, stepId });

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_COURSE_STEP_COMPLETED',
    entityType: 'COURSE_STEP',
    entityId: stepId,
    details: { learnerId, courseId, title: step.title }
  });

  res.json({ success: true, stepId, progress: summary });
});

app.post('/api/learner/courses/:courseId/steps/:stepId/submit', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
  const { courseId, stepId } = req.params;
  const learnerId =
    req.user!.role === 'LEARNER' ? req.user!.id : String(req.body?.learnerId || req.user!.id);

  if (!learnerOwnsCourse(learnerId, courseId)) {
    return res.status(403).json({ success: false, error: 'This course is not assigned to you.' });
  }

  const step = db.prepare('SELECT * FROM course_steps WHERE id = ? AND course_id = ?').get(stepId, courseId) as any;
  if (!step) return res.status(404).json({ success: false, error: 'Step not found.' });
  if (step.kind !== 'TASK') {
    return res.status(400).json({ success: false, error: 'This step is completed with the button, not a submission.' });
  }

  const submissionText = String(req.body?.submissionText || '').trim();
  if (submissionText.length < 5) {
    return res.status(400).json({ success: false, error: 'Write what you did before you submit.' });
  }

  const ordered = listCourseSteps(courseId);
  const index = ordered.findIndex((s) => s.id === stepId);
  const done = db
    .prepare("SELECT step_id FROM learner_step_progress WHERE learner_id = ? AND course_id = ? AND status = 'COMPLETED'")
    .all(learnerId, courseId) as any[];
  for (let i = 0; i < index; i += 1) {
    if (!done.some((d) => d.step_id === ordered[i].id)) {
      return res.status(409).json({ success: false, error: 'Finish the step above this one first.' });
    }
  }

  const now = new Date().toISOString();
  const taskId = `tsk_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const dueDate = new Date(Date.now() + Math.max(1, Number(step.due_days) || 7) * 86400000)
    .toISOString()
    .slice(0, 10);

  const pdpRow = db
    .prepare("SELECT id FROM pdp_versions WHERE learner_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(learnerId) as any;

  db.prepare(
    `INSERT INTO learning_tasks (
       id, learner_id, pdp_version_id, course_id, step_id, title, category, instructions, expected_criteria,
       competency_code, status, learner_submission, uploaded_file_name, uploaded_file_data, due_date, assigned_at, submitted_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'COURSE_STEP', ?, ?, 'COMP-PROC-01', 'SUBMITTED', ?, ?, ?, ?, ?, ?)`
  ).run(
    taskId,
    learnerId,
    pdpRow?.id || 'pdp_self_build',
    courseId,
    stepId,
    step.title,
    step.content || step.summary || step.title,
    step.summary || step.content || step.title,
    submissionText,
    req.body?.uploadedFileName ? String(req.body.uploadedFileName) : null,
    req.body?.uploadedFileData ? String(req.body.uploadedFileData) : null,
    dueDate,
    now,
    now
  );

  const existingProgress = db
    .prepare('SELECT id FROM learner_step_progress WHERE learner_id = ? AND step_id = ?')
    .get(learnerId, stepId) as any;
  if (existingProgress) {
    db.prepare(
      "UPDATE learner_step_progress SET status = 'SUBMITTED', task_id = ?, updated_at = ? WHERE id = ?"
    ).run(taskId, now, existingProgress.id);
  } else {
    db.prepare(
      `INSERT INTO learner_step_progress (id, learner_id, course_id, step_id, status, task_id, updated_at)
       VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)`
    ).run(`sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, learnerId, courseId, stepId, taskId, now);
  }

  const evidenceId = `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(
    `INSERT INTO evidence_items (
       id, learner_id, source_type, source_ref_id, title, summary, competency_code,
       sufficiency_weight, uncertainty_note, verification_status, created_at
     ) VALUES (?, ?, 'PRACTICE_ARTEFACT', ?, ?, ?, 'COMP-PROC-01', 'MEDIUM_PRACTICE',
       'Course milestone awaiting mentor review.', 'PENDING_REVIEW', ?)`
  ).run(evidenceId, learnerId, taskId, `Course milestone: ${step.title}`, submissionText, now);

  staffToNudge(learnerId).forEach((staffId) =>
    notifyUser(
      staffId,
      `Milestone submitted: ${step.title}`,
      `${req.user!.name} sent their work for the course step "${step.title}".`,
      { id: req.user!.id, name: req.user!.name }
    )
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_COURSE_STEP_SUBMITTED',
    entityType: 'COURSE_STEP',
    entityId: stepId,
    details: { learnerId, courseId, taskId, title: step.title }
  });

  res.status(201).json({ success: true, taskId, stepId });
});

// ---------------------------------------------------------------------------
// Admin: learner roster, add learner, dossier
// ---------------------------------------------------------------------------

const LEARNER_TRACKS = ['student_concepts', 'strategy_learner', 'trader', 'investor', 'both'];

const generateTempPassword = () => `frins-${crypto.randomBytes(3).toString('hex')}`;

app.post('/api/admin/learners', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rawTrack = String(req.body?.track || 'student_concepts').trim().toLowerCase();
  const track = LEARNER_TRACKS.includes(rawTrack) ? rawTrack : 'student_concepts';
  const phone = String(req.body?.phone || '').trim();
  const city = String(req.body?.city || '').trim();
  const notes = String(req.body?.notes || '').trim();
  const suppliedPassword = String(req.body?.password || '').trim();
  const guideId = String(req.body?.guideId || '').trim();
  const courseId = String(req.body?.courseId || '').trim();
  const amountPaid = Math.max(0, Number(req.body?.amountPaid) || 0);
  const paymentStatus = String(req.body?.paymentStatus || '').toUpperCase();

  if (!name || name.length < 2) {
    return res.status(400).json({ success: false, error: 'Please enter the learner name.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
    return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
  }
  if (courseId && !db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId)) {
    return res.status(400).json({ success: false, error: 'That course no longer exists.' });
  }

  const password = suppliedPassword || generateTempPassword();
  const now = new Date().toISOString();
  const learnerId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const assignedGuide =
    guideId && db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('GUIDE', 'ADMIN')").get(guideId)
      ? guideId
      : defaultGuideId();

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, account_status, track, assigned_guide_id, phone, city, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'LEARNER', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    learnerId,
    name,
    email,
    hashPassword(password),
    track,
    assignedGuide,
    phone || null,
    city || null,
    notes || null,
    now,
    now
  );

  db.prepare(
    `INSERT INTO student_learning_profiles (
       id, learner_id, approved_level, proposed_level, level_review_state, primary_track,
       evidence_status, market_context_summary, rubric_version, updated_at
     ) VALUES (?, ?, 'L1', NULL, 'APPROVED', ?, 'INSUFFICIENT', 'Newly added by the team; awaiting Discovery or a first call.', '1.2.0', ?)`
  ).run(`slp_${learnerId}`, learnerId, track, now);

  let enrollmentId: string | null = null;
  if (courseId) {
    enrollmentId = `sc_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    db.prepare(
      `INSERT INTO student_courses (id, course_id, learner_id, custom_notes, progress_pct, status, assigned_by, assigned_at, source, amount_paid, payment_status, paid_at)
       VALUES (?, ?, ?, ?, 0, 'ACTIVE', ?, ?, ?, ?, ?, ?)`
    ).run(
      enrollmentId,
      courseId,
      learnerId,
      String(req.body?.customNotes || '').trim() || 'Enrolled when the learner was added.',
      req.user!.id,
      now,
      amountPaid > 0 ? 'PURCHASED' : 'ADMIN_ASSIGNED',
      amountPaid,
      ['PAID', 'PENDING', 'WAIVED'].includes(paymentStatus) ? paymentStatus : amountPaid > 0 ? 'PAID' : 'NOT_APPLICABLE',
      amountPaid > 0 ? now : null
    );
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_ADDED_BY_ADMIN',
    entityType: 'USER',
    entityId: learnerId,
    details: { name, email, track, courseId, amountPaid }
  });

  res.status(201).json({
    success: true,
    learnerId,
    enrollmentId,
    temporaryPassword: suppliedPassword ? null : password
  });
});

app.patch('/api/admin/learners/:learnerId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const learnerId = String(req.params.learnerId);
  const learner = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'LEARNER'").get(learnerId) as any;
  if (!learner) return res.status(404).json({ success: false, error: 'Learner not found.' });

  const nextEmail =
    req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : learner.email;
  if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  const clash = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(nextEmail, learnerId);
  if (clash) return res.status(409).json({ success: false, error: 'Another user already has this email.' });

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : learner.name;
  if (!name) return res.status(400).json({ success: false, error: 'The learner needs a name.' });

  const rawTrack = String(req.body?.track ?? learner.track).toLowerCase();
  const track = LEARNER_TRACKS.includes(rawTrack) ? rawTrack : learner.track;
  const accountStatus =
    req.body?.accountStatus !== undefined && ['ACTIVE', 'SUSPENDED'].includes(String(req.body.accountStatus))
      ? String(req.body.accountStatus)
      : learner.account_status;
  const guideId =
    req.body?.guideId !== undefined
      ? String(req.body.guideId).trim() ||
        (db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('GUIDE', 'ADMIN')").get(String(req.body.guideId))
          ? String(req.body.guideId)
          : null)
      : learner.assigned_guide_id;

  db.prepare(
    `UPDATE users
        SET name = ?, email = ?, track = ?, account_status = ?, assigned_guide_id = ?,
            phone = ?, city = ?, notes = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    name,
    nextEmail,
    track,
    accountStatus,
    guideId || null,
    req.body?.phone !== undefined ? String(req.body.phone).trim() || null : learner.phone,
    req.body?.city !== undefined ? String(req.body.city).trim() || null : learner.city,
    req.body?.notes !== undefined ? String(req.body.notes).trim() || null : learner.notes,
    new Date().toISOString(),
    learnerId
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_PROFILE_UPDATED',
    entityType: 'USER',
    entityId: learnerId,
    details: { name, nextEmail, track, accountStatus, guideId }
  });

  res.json({ success: true, learnerId });
});

app.get('/api/admin/learners/:learnerId/dossier', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
  const learnerId = String(req.params.learnerId);
  const learner = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'LEARNER'").get(learnerId) as any;
  if (!learner) return res.status(404).json({ success: false, error: 'Learner not found.' });

  const { password_hash, ...safeLearner } = learner;
  const guide = learner.assigned_guide_id
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(learner.assigned_guide_id)
    : null;

  const profile = db.prepare('SELECT * FROM student_learning_profiles WHERE learner_id = ?').get(learnerId) || null;

  const enrollments = db
    .prepare(
      `SELECT sc.*, c.title AS course_title, c.track AS course_track, c.level AS course_level, c.description AS course_description,
              (SELECT COUNT(*) FROM course_steps s WHERE s.course_id = sc.course_id) AS step_count,
              (SELECT COUNT(*) FROM learner_step_progress p WHERE p.learner_id = sc.learner_id AND p.course_id = sc.course_id AND p.status = 'COMPLETED') AS steps_done
         FROM student_courses sc
         JOIN courses c ON c.id = sc.course_id
        WHERE sc.learner_id = ?
        ORDER BY sc.assigned_at DESC`
    )
    .all(learnerId) as any[];

  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.status, t.category, t.course_id, t.step_id, t.due_date, t.assigned_at,
              t.submitted_at, t.reviewed_at, t.guide_feedback, t.uploaded_file_name,
              substr(COALESCE(t.learner_submission, ''), 1, 240) AS submission_preview,
              c.title AS course_title
         FROM learning_tasks t
         LEFT JOIN courses c ON c.id = t.course_id
        WHERE t.learner_id = ?
        ORDER BY COALESCE(t.submitted_at, t.assigned_at, t.due_date) DESC`
    )
    .all(learnerId) as any[];

  const calls = db
    .prepare(
      `SELECT b.*, s.name AS staff_name, s.role AS staff_role
         FROM call_bookings b
         LEFT JOIN users s ON s.id = b.staff_id
        WHERE b.learner_id = ?
        ORDER BY COALESCE(b.preferred_date, '') DESC, b.created_at DESC`
    )
    .all(learnerId) as any[];

  const reflections = db
    .prepare('SELECT id, title, market_context, process_adherence, created_at FROM reflections WHERE learner_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(learnerId);

  const reviewed = tasks.filter((t) => t.status === 'REVIEWED' || t.status === 'APPROVED').length;
  const submitted = tasks.filter((t) => t.status === 'SUBMITTED').length;
  const totalPaid = enrollments.reduce((sum, e) => sum + (Number(e.amount_paid) || 0), 0);
  const stepsDone = enrollments.reduce((sum, e) => sum + (Number(e.steps_done) || 0), 0);
  const stepsTotal = enrollments.reduce((sum, e) => sum + (Number(e.step_count) || 0), 0);

  res.json({
    success: true,
    learner: safeLearner,
    guide,
    profile,
    enrollments,
    tasks,
    calls,
    reflections,
    stats: {
      courseCount: enrollments.length,
      completedCourses: enrollments.filter((e) => e.status === 'COMPLETED').length,
      taskCount: tasks.length,
      submitted,
      reviewed,
      openTasks: tasks.length - reviewed - submitted,
      totalPaid,
      stepsDone,
      stepsTotal,
      progressPct: stepsTotal ? Math.round((stepsDone / stepsTotal) * 100) : 0
    }
  });
});

app.patch('/api/admin/enrollments/:enrollmentId', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const enrollmentId = String(req.params.enrollmentId);
  const enrollment = db.prepare('SELECT * FROM student_courses WHERE id = ?').get(enrollmentId) as any;
  if (!enrollment) return res.status(404).json({ success: false, error: 'Enrollment not found.' });

  const amountPaid =
    req.body?.amountPaid !== undefined ? Math.max(0, Number(req.body.amountPaid) || 0) : enrollment.amount_paid;
  const paymentStatus =
    req.body?.paymentStatus !== undefined
      ? String(req.body.paymentStatus).toUpperCase()
      : enrollment.payment_status;
  if (req.body?.paymentStatus !== undefined && !['PAID', 'PENDING', 'WAIVED', 'NOT_APPLICABLE'].includes(paymentStatus)) {
    return res.status(400).json({ success: false, error: 'Unknown payment status.' });
  }
  const status =
    req.body?.status !== undefined && ['ACTIVE', 'COMPLETED', 'PAUSED'].includes(String(req.body.status))
      ? String(req.body.status)
      : enrollment.status;

  db.prepare(
    `UPDATE student_courses
        SET status = ?, amount_paid = ?, payment_status = ?,
            paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, ?) ELSE paid_at END
      WHERE id = ?`
  ).run(status, amountPaid, paymentStatus, paymentStatus, new Date().toISOString(), enrollmentId);

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ENROLLMENT_UPDATED',
    entityType: 'STUDENT_COURSE',
    entityId: enrollmentId,
    details: { status, amountPaid, paymentStatus }
  });

  res.json({ success: true, enrollmentId });
});

// ---------------------------------------------------------------------------
// Direct calls: learner books a mentor, mentor confirms
// ---------------------------------------------------------------------------

app.get('/api/directory/staff', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, name, role, email FROM users WHERE role IN ('ADMIN', 'GUIDE', 'CURRICULUM_OWNER') AND account_status = 'ACTIVE' ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'GUIDE' THEN 1 ELSE 2 END, name ASC"
    )
    .all();
  res.json({ success: true, rows });
});

app.get('/api/learner/calls', requireRole(['LEARNER']), (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, s.name AS staff_name, s.role AS staff_role
         FROM call_bookings b
         LEFT JOIN users s ON s.id = b.staff_id
        WHERE b.learner_id = ?
        ORDER BY COALESCE(b.preferred_date, '') DESC, b.created_at DESC`
    )
    .all(req.user!.id);
  res.json({ success: true, rows });
});

app.post('/api/learner/calls', requireRole(['LEARNER']), (req, res) => {
  const staffId = String(req.body?.staffId || '').trim();
  if (!staffId) return res.status(400).json({ success: false, error: 'Choose who you want to talk to.' });

  const staff = db
    .prepare("SELECT id, name, role FROM users WHERE id = ? AND role IN ('ADMIN', 'GUIDE', 'CURRICULUM_OWNER') AND account_status = 'ACTIVE'")
    .get(staffId) as any;
  if (!staff) return res.status(400).json({ success: false, error: 'That person is not taking calls.' });

  const preferredDate = String(req.body?.preferredDate || '').trim();
  const preferredTime = String(req.body?.preferredTime || '').trim() || '11:30 AM IST';
  const topic = String(req.body?.topic || '').trim();
  const notes = String(req.body?.notes || '').trim();

  if (!preferredDate || !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    return res.status(400).json({ success: false, error: 'Pick a date for the call.' });
  }
  if (topic.length < 3) {
    return res.status(400).json({ success: false, error: 'Write a short topic so the team can prepare.' });
  }

  const learner = db
    .prepare('SELECT id, name, email, track, phone FROM users WHERE id = ?')
    .get(req.user!.id) as any;
  const bookingId = `book_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO call_bookings (
       id, session_id, participant_name, participant_email, participant_phone, track,
       preferred_date, preferred_time, notes, readiness_score, recommended_focus, status, created_at,
       learner_id, staff_id, topic, requested_by_role, updated_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'REQUESTED', ?, ?, ?, ?, 'LEARNER', ?)`
  ).run(
    bookingId,
    learner.name,
    learner.email,
    learner.phone || null,
    learner.track,
    preferredDate,
    preferredTime,
    notes || null,
    topic,
    now,
    learner.id,
    staff.id,
    topic,
    now
  );

  notifyUser(
    staff.id,
    `Call request from ${learner.name}`,
    `${topic} — asked for ${preferredDate}, ${preferredTime}.`,
    { id: learner.id, name: learner.name }
  );

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_BOOKED_DIRECT_CALL',
    entityType: 'CALL_BOOKING',
    entityId: bookingId,
    details: { staffId: staff.id, preferredDate, preferredTime, topic }
  });

  res.status(201).json({ success: true, bookingId });
});

app.post('/api/learner/calls/:bookingId/cancel', requireRole(['LEARNER']), (req, res) => {
  const booking = db
    .prepare('SELECT * FROM call_bookings WHERE id = ? AND learner_id = ?')
    .get(String(req.params.bookingId), req.user!.id) as any;
  if (!booking) return res.status(404).json({ success: false, error: 'Call not found.' });
  if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
    return res.status(400).json({ success: false, error: 'This call is already closed.' });
  }

  db.prepare("UPDATE call_bookings SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    booking.id
  );

  if (booking.staff_id) {
    notifyUser(booking.staff_id, 'Call cancelled', `${req.user!.name} cancelled the call on ${booking.preferred_date}.`, {
      id: req.user!.id,
      name: req.user!.name
    });
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'LEARNER_CANCELLED_DIRECT_CALL',
    entityType: 'CALL_BOOKING',
    entityId: booking.id,
    details: { previousStatus: booking.status }
  });

  res.json({ success: true, status: 'CANCELLED' });
});


// ============================================================================
// DIRECT MESSAGES
//
// One conversation per learner with the team. The learner writes from their
// panel; the guide or admin answers from the console. Task chat stays attached
// to a task; this is the open channel for everything else.
// ============================================================================

const CHAT_STAFF_ROLES: Array<'ADMIN' | 'CURRICULUM_OWNER' | 'GUIDE'> = ['ADMIN', 'CURRICULUM_OWNER', 'GUIDE'];

const chatThreadForLearner = (learnerId: string) =>
  db.prepare('SELECT * FROM chat_threads WHERE learner_id = ?').get(learnerId) as any;

const openChatThread = (learnerId: string, createdBy: string) => {
  const existing = chatThreadForLearner(learnerId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = `cht_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(
    `INSERT INTO chat_threads (id, learner_id, subject, created_by, last_message_at, created_at, updated_at)
     VALUES (?, ?, 'Direct messages', ?, ?, ?, ?)`
  ).run(id, learnerId, createdBy, now, now, now);
  return chatThreadForLearner(learnerId);
};

const chatMessagesFor = (threadId: string) =>
  db
    .prepare('SELECT id, sender_user_id, sender_name, sender_role, message, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId);

/** Staff side: one row per learner who has a conversation, newest first. */
app.get('/api/chat/threads', requireRole(CHAT_STAFF_ROLES), (req, res) => {
  const q = req.query.q;
  const filter = String(req.query.filter || 'ALL').toUpperCase();
  const { page, limit, offset } = readPaging(req, 30);
  const params: any[] = [];
  const where: string[] = ['1 = 1'];

  if (hasSearch(q)) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR COALESCE(t.subject, \'\') LIKE ?)');
    params.push(likeTerm(q), likeTerm(q), likeTerm(q));
  }
  if (filter === 'UNREAD') {
    where.push(`EXISTS (SELECT 1 FROM chat_messages m
      WHERE m.thread_id = t.id AND m.sender_role = 'LEARNER'
        AND (t.staff_last_read_at IS NULL OR m.created_at > t.staff_last_read_at))`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const base = `FROM chat_threads t JOIN users u ON u.id = t.learner_id ${whereSql}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params) as any).c as number;
  const unreadTotal = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_threads t JOIN users u ON u.id = t.learner_id
          WHERE EXISTS (SELECT 1 FROM chat_messages m
            WHERE m.thread_id = t.id AND m.sender_role = 'LEARNER'
              AND (t.staff_last_read_at IS NULL OR m.created_at > t.staff_last_read_at))`
      )
      .get() as any
  ).c as number;

  const rows = db
    .prepare(
      `SELECT t.id, t.learner_id, t.last_message_at, t.updated_at,
              u.name AS learner_name, u.email AS learner_email, u.track AS learner_track,
              u.account_status AS learner_status,
              (SELECT m.message FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT m.sender_name FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_sender,
              (SELECT m.created_at FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_sent_at,
              (SELECT COUNT(*) FROM chat_messages m
                WHERE m.thread_id = t.id AND m.sender_role = 'LEARNER'
                  AND (t.staff_last_read_at IS NULL OR m.created_at > t.staff_last_read_at)) AS unread
         FROM chat_threads t
         JOIN users u ON u.id = t.learner_id
         ${whereSql}
         ORDER BY COALESCE((SELECT MAX(m.created_at) FROM chat_messages m WHERE m.thread_id = t.id), t.created_at) DESC
         LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    success: true,
    rows,
    total,
    unreadTotal,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit
  });
});

// Open (or start) the conversation with one learner.
app.post('/api/chat/threads', requireRole(CHAT_STAFF_ROLES), (req, res) => {
  const learnerId = String(req.body?.learnerId || '').trim();
  const learner = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'LEARNER'").get(learnerId) as any;
  if (!learner) return res.status(404).json({ success: false, error: 'Learner not found.' });
  const thread = openChatThread(learnerId, req.user!.id);
  res.status(201).json({ success: true, threadId: thread.id, learnerName: learner.name });
});

// My own conversation, for the learner panel.
app.get('/api/chat/my-thread', requireRole(['LEARNER']), (req, res) => {
  const thread = openChatThread(req.user!.id, req.user!.id);
  db.prepare('UPDATE chat_threads SET learner_last_read_at = ?, updated_at = updated_at WHERE id = ?').run(
    new Date().toISOString(),
    thread.id
  );
  const staff = db
    .prepare("SELECT name, role FROM users WHERE role IN ('GUIDE', 'ADMIN') AND account_status = 'ACTIVE' ORDER BY CASE role WHEN 'GUIDE' THEN 0 ELSE 1 END LIMIT 1")
    .get() as any;
  res.json({
    success: true,
    thread: { id: thread.id, lastMessageAt: thread.last_message_at },
    mentorName: staff?.name || 'The FRINS team',
    messages: chatMessagesFor(thread.id)
  });
});

// One conversation, for either side. Opening it marks it read for that side.
app.get('/api/chat/threads/:threadId', requireRole(['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(String(req.params.threadId)) as any;
  if (!thread) return res.status(404).json({ success: false, error: 'Conversation not found.' });

  const isLearner = req.user!.role === 'LEARNER';
  if (isLearner && thread.learner_id !== req.user!.id) {
    return res.status(403).json({ success: false, error: 'That is not your conversation.' });
  }

  const learner = db
    .prepare('SELECT id, name, email, track, assigned_guide_id FROM users WHERE id = ?')
    .get(thread.learner_id) as any;

  const now = new Date().toISOString();
  db.prepare(
    isLearner
      ? 'UPDATE chat_threads SET learner_last_read_at = ? WHERE id = ?'
      : 'UPDATE chat_threads SET staff_last_read_at = ? WHERE id = ?'
  ).run(now, thread.id);

  res.json({
    success: true,
    thread: { id: thread.id, learnerId: thread.learner_id, lastMessageAt: thread.last_message_at },
    learner,
    messages: chatMessagesFor(thread.id)
  });
});

// Send a message. Either side can.
app.post('/api/chat/threads/:threadId/messages', requireRole(['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER']), (req, res) => {
  const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(String(req.params.threadId)) as any;
  if (!thread) return res.status(404).json({ success: false, error: 'Conversation not found.' });

  const isLearner = req.user!.role === 'LEARNER';
  if (isLearner && thread.learner_id !== req.user!.id) {
    return res.status(403).json({ success: false, error: 'That is not your conversation.' });
  }

  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'Write a message first.' });
  if (message.length > 2000) {
    return res.status(400).json({ success: false, error: 'Keep the message under 2000 characters.' });
  }

  const now = new Date().toISOString();
  const messageId = `cmg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  db.prepare(
    `INSERT INTO chat_messages (id, thread_id, sender_user_id, sender_name, sender_role, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(messageId, thread.id, req.user!.id, req.user!.name, req.user!.role, message, now);

  db.prepare(
    `UPDATE chat_threads
        SET last_message_at = ?, updated_at = ?,
            learner_last_read_at = CASE WHEN ? = 'LEARNER' THEN ? ELSE learner_last_read_at END,
            staff_last_read_at = CASE WHEN ? = 'LEARNER' THEN staff_last_read_at ELSE ? END
      WHERE id = ?`
  ).run(now, now, req.user!.role, now, req.user!.role, now, thread.id);

  if (isLearner) {
    staffToNudge(thread.learner_id).forEach((staffId) =>
      notifyUser(staffId, `New message from ${req.user!.name}`, message.slice(0, 140), {
        id: req.user!.id,
        name: req.user!.name
      })
    );
  } else {
    notifyUser(thread.learner_id, `New message from ${req.user!.name}`, message.slice(0, 140), {
      id: req.user!.id,
      name: req.user!.name
    });
  }

  writeAuditEvent({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'CHAT_MESSAGE_SENT',
    entityType: 'CHAT_THREAD',
    entityId: thread.id,
    details: { messageId, learnerId: thread.learner_id, role: req.user!.role }
  });

  res.status(201).json({
    success: true,
    message: {
      id: messageId,
      sender_user_id: req.user!.id,
      sender_name: req.user!.name,
      sender_role: req.user!.role,
      message,
      created_at: now
    }
  });
});

// Communities and the two compact dashboard summaries.
registerCommunityRoutes(app, requireRole);
registerSummaryRoutes(app, requireRole);

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
