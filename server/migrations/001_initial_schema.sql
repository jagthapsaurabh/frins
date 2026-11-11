-- FRINS Clean-Slate Initial Database Schema Migration (001_initial_schema.sql)
-- Database Engine: SQLite (better-sqlite3, WAL mode, Foreign Keys enforced)
-- ORM: None (Direct SQL per explicit project constraint: No Prisma)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. Users & Role Assignments (Requirement 12: User / Account, Role Assignment)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED')),
  consent_training_data INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- 2. Public Website Booking Leads (Requirement 6.1)
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  track TEXT NOT NULL,
  context TEXT,
  source TEXT NOT NULL DEFAULT 'public_website_modal',
  discovery_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_DISCOVERY',
  created_at TEXT NOT NULL
);

-- 3. Discovery Session & Responses (Requirement 6.2 & 12)
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id TEXT PRIMARY KEY,
  learner_user_id TEXT,
  participant_name TEXT,
  participant_email TEXT,
  track TEXT NOT NULL DEFAULT 'trader',
  question_bank_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'COMPLETED', 'SYNTHESIZED')),
  answers_json TEXT NOT NULL DEFAULT '{}',
  completeness_pct INTEGER NOT NULL DEFAULT 0,
  contradictions_json TEXT NOT NULL DEFAULT '[]',
  sufficiency_status TEXT NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  exit_pathway TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 4. Student Learning Profile (Requirement 12)
CREATE TABLE IF NOT EXISTS learner_profiles (
  learner_id TEXT PRIMARY KEY,
  assigned_guide_id TEXT,
  track TEXT NOT NULL DEFAULT 'trader',
  approved_level TEXT NOT NULL DEFAULT 'L1' CHECK(approved_level IN ('L1', 'L2', 'L3', 'L4')),
  proposed_level TEXT CHECK(proposed_level IN ('L1', 'L2', 'L3', 'L4')),
  level_review_state TEXT NOT NULL DEFAULT 'APPROVED' CHECK(level_review_state IN ('APPROVED', 'PENDING_GUIDE_REVIEW', 'CHANGES_REQUESTED', 'REJECTED')),
  exit_pathway TEXT NOT NULL DEFAULT 'STANDARD_DEVELOPMENT_PATHWAY',
  evidence_status TEXT NOT NULL DEFAULT 'SUFFICIENT',
  market_context_summary TEXT,
  guide_private_notes TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(learner_id) REFERENCES users(id)
);

-- 5. 45-Minute FRINS Guide Conversation Record (Requirement 5 Steps 6-8)
CREATE TABLE IF NOT EXISTS guide_conversations (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  guide_id TEXT NOT NULL,
  discovery_session_id TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  conversation_summary TEXT NOT NULL,
  agreed_learning_needs_json TEXT NOT NULL DEFAULT '[]',
  created_pdp_id TEXT,
  conducted_at TEXT NOT NULL,
  FOREIGN KEY(learner_id) REFERENCES users(id)
);

-- 6. Competency Library & Rubric Version (Requirement 11 & 12)
CREATE TABLE IF NOT EXISTS competency_library (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT NOT NULL,
  rubric_version TEXT NOT NULL DEFAULT '1.0.0',
  l1_criteria TEXT NOT NULL,
  l2_criteria TEXT NOT NULL,
  l3_criteria TEXT NOT NULL,
  l4_criteria TEXT NOT NULL,
  is_core INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at TEXT NOT NULL
);

-- 7. Learner-Specific Competency Proposals (Separated from Core Library per Requirement 11)
CREATE TABLE IF NOT EXISTS learner_competency_proposals (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT NOT NULL,
  target_level TEXT NOT NULL DEFAULT 'L1',
  review_state TEXT NOT NULL DEFAULT 'PENDING_GUIDE_REVIEW' CHECK(review_state IN ('PENDING_GUIDE_REVIEW', 'APPROVED_FOR_LEARNER', 'PROMOTED_TO_CORE_LIBRARY', 'REJECTED')),
  reviewed_by TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

-- 8. Personalised Development Plan (PDP) Version & Approval Decision (Requirement 10 & 12)
CREATE TABLE IF NOT EXISTS pdp_versions (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING_GUIDE_REVIEW', 'ACTIVE_APPROVED', 'SUPERSEDED', 'CHANGES_REQUESTED', 'REJECTED')),
  source_mode TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  objectives_json TEXT NOT NULL,
  practice_tasks_json TEXT NOT NULL,
  routine_schedule TEXT NOT NULL,
  review_cadence TEXT NOT NULL,
  drafted_from_ai_run_id TEXT,
  reviewed_by_guide_id TEXT,
  review_decision TEXT,
  review_reason TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(learner_id) REFERENCES users(id)
);

-- 9. Practice Task Submission, Reflection & Assessment Outcome (Requirement 11 & 12)
CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  pdp_version_id TEXT,
  competency_code TEXT,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN ('DISCOVERY_RESPONSE', 'GUIDE_CONVERSATION_NOTE', 'PRACTICE_SUBMISSION', 'REFLECTION_ENTRY', 'FORMAL_ASSESSMENT')),
  weight_category TEXT NOT NULL CHECK(weight_category IN ('LOW_REFLECTION', 'MEDIUM_PRACTICE', 'HIGH_FORMAL')),
  title TEXT NOT NULL,
  content_summary TEXT NOT NULL,
  structured_payload_json TEXT NOT NULL DEFAULT '{}',
  guide_observation TEXT,
  sufficiency_contribution TEXT NOT NULL DEFAULT 'SUPPORTING',
  created_at TEXT NOT NULL,
  FOREIGN KEY(learner_id) REFERENCES users(id)
);

-- 10. Three-Agent AI Run & Output Package (Requirement 7, 8 & 12)
CREATE TABLE IF NOT EXISTS ai_pipeline_runs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  learner_id TEXT,
  provider_mode TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  observational_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  generative_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'PENDING_GUIDE_REVIEW',
  reviewed_by_guide_id TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL
);

-- 11. Training Example Candidate & Dataset Version Record (Requirement 9 & 12)
CREATE TABLE IF NOT EXISTS training_examples (
  id TEXT PRIMARY KEY,
  dataset_version TEXT NOT NULL DEFAULT 'frins-gold-v1.0',
  split TEXT NOT NULL DEFAULT 'train' CHECK(split IN ('train', 'val', 'test')),
  source_session_id TEXT NOT NULL,
  source_ai_run_id TEXT,
  consent_verified INTEGER NOT NULL DEFAULT 1,
  deidentified_verified INTEGER NOT NULL DEFAULT 1,
  verified_by_guide_id TEXT NOT NULL,
  guide_rationale TEXT NOT NULL,
  sanitized_input_json TEXT NOT NULL,
  approved_output_json TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

-- 12. Audit Log Event (Requirement 12, 13 & 14)
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
