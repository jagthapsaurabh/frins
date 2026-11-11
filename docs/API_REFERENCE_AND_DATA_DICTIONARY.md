# FRINS API Reference & Data Dictionary

## 1. Data Dictionary (Section 12 Core Data Entities)

| Entity | SQLite Table | Primary Key | Description |
|---|---|---|---|
| **User / Account** | `users` | `id` | Provisioned accounts with role (`LEARNER`, `GUIDE`, `ADMIN`, `CURRICULUM_OWNER`), status, and training data consent flag. |
| **Role Session** | `auth_sessions` | `token` | Server-side authenticated Bearer sessions with expiry. |
| **Booking Lead** | `leads` | `id` | Public website booking submissions (`POST /api/leads`) linked to pre-call Discovery sessions. |
| **Discovery Session & Responses** | `discovery_sessions` | `id` | Canonical 34-question session (`v1.0.0-canonical-34`), answers JSON, completeness %, contradictions, sufficiency status, and exit pathway. |
| **Student Learning Profile** | `learner_profiles` | `learner_id` | Current approved competency level (`L1`–`L4`), proposed level, review state, exit pathway, and Guide-only confidential notes. |
| **45-Minute FRINS Conversation** | `guide_conversations` | `id` | Human Guide conversation record, agreed learning needs, and linked candidate PDP draft. |
| **Core Competency Library & Rubric** | `competency_library` | `code` | Permanent FRINS competency definitions (`COMP-PROC-01` .. `COMP-ADAPT-05`) with versioned `L1`–`L4` criteria. |
| **Learner-Specific Competency Proposal** | `learner_competency_proposals` | `id` | Learner-contextual competency proposals kept strictly separate from the permanent Core Competency Library until Curriculum Owner promotion. |
| **PDP Version & Approval Decision** | `pdp_versions` | `id` | Versioned Personalised Development Plans (`PENDING_GUIDE_REVIEW`, `ACTIVE_APPROVED`, `SUPERSEDED`, `CHANGES_REQUESTED`, `REJECTED`). |
| **Practice, Reflection & Assessment Evidence** | `evidence_records` | `id` | Multi-source evidence items tagged with weight tier (`LOW_REFLECTION`, `MEDIUM_PRACTICE`, `HIGH_FORMAL`). |
| **Three-Agent AI Run & Output Package** | `ai_pipeline_runs` | `id` | Traceable Three-Agent outputs (`observational_json`, `decision_json`, `generative_json`, `validation_json`). |
| **Training Example & Dataset Version** | `training_examples` | `id` | Consented, de-identified, Guide-verified gold examples (`frins-gold-v1.0`) with `train`/`val`/`test` split tracking. |
| **Audit Log Event** | `audit_events` | `id` | Immutable audit trail recording actor, role, action, target entity, reason, and timestamp. |

---

## 2. REST API Endpoints

### Health & Public Website (`FRI-WEB-001`)
- `GET /api/health` — Returns service health, SQLite connection status, AI provider mode, and canonical question bank version (`34` questions).
- `POST /api/leads` — Rate-limited booking/contact intake from the public website modal. Validates `name`, `email`, `track`, and `context`, persists lead, and writes an audit event.

### Authentication & Role Switching (`FRI-ADMIN-001`)
- `GET /api/auth/me` — Returns the current authenticated user.
- `POST /api/auth/login` — Authenticates via email/password and returns a Bearer token.
- `POST /api/auth/switch-role` — Switches role session for evaluation and testing.

### Canonical 34-Question Discovery (`FRI-DISC-001`)
- `GET /api/discovery/questions` — Returns the canonical 34-question bank (`v1.0.0-canonical-34`), domain metadata, and pre-built test personas.
- `POST /api/discovery/start` — Creates and persists a new Discovery session.
- `GET /api/discovery/:sessionId` — Resumes an existing Discovery session with live deterministic evaluation and latest Three-Agent AI run.
- `POST /api/discovery/answer` — Saves single or batch answers (`answersBatch`), recomputes completeness, contradiction rules, sufficiency status, and exit pathway (`NO_CONCERN_ESTABLISHED`, `FOUNDATIONAL_CLARIFICATION_PATHWAY`, `STANDARD_DEVELOPMENT_PATHWAY`, `INTENSIVE_BEHAVIOURAL_RESET_PATHWAY`).
- `POST /api/discovery/synthesize` — Runs deterministic evaluation + Three-Agent AI synthesis and optionally creates a `PENDING_GUIDE_REVIEW` PDP draft.

### Three-Agent AI & Training Curation (`FRI-AI-001..004`, `FRI-LLM-001`, `FRI-ML-001..002`)
- `GET /api/ai/status` — Returns active provider mode (`mock` vs `real`), agent readiness, prompt version, safety validator configuration, and training dataset split counts.
- `POST /api/ai/run` — Executes `ObservationalAgent -> DecisionAgent -> GenerativeAgent -> SafetyValidator` for `{ sessionId }`.
- `POST /api/ai/validate-custom` — Runs the Safety & Grounding Validator against custom payload text (used to verify blocking of stock tips, ungrounded claims, and governance bypasses).
- `GET /api/ai/benchmarks` — Runs the offline gold benchmark evaluation suite and release gate check.
- `GET /api/ai/training/examples` — Lists curated training examples (requires `GUIDE`, `ADMIN`, `CURRICULUM_OWNER`, or `x-frins-guide-key`).
- `POST /api/ai/training/examples` — Curates a consented, de-identified, Guide-verified gold example (requires `GUIDE`, `ADMIN`, `CURRICULUM_OWNER`, or `x-frins-guide-key`).
- `GET /api/ai/training/dataset.jsonl` — Exports curated examples in JSONL format for offline fine-tuning/evaluation (requires `GUIDE`, `ADMIN`, `CURRICULUM_OWNER`, or `x-frins-guide-key`).

### Learner Workspace (`FRI-LEARN-001`)
- `GET /api/learner/dashboard` — Returns Student Learning Profile (with `guide_private_notes` stripped), Active Approved PDP, Pending Draft PDP, 45-Minute Guide Conversations, Multi-Source Sufficiency Evaluation, Core Competencies, Evidence Timeline, assigned custom courses, sanitized course questions, and tasks with uploaded results plus chat (`ai_review_json` is always stripped).
- `POST /api/learner/course-questions/:questionId/answer` — Records the student's answer to an Admin-defined course question and returns correctness plus the explanation.
- `POST /api/learner/practice` — Submits a deliberate practice task artefact (`MEDIUM_PRACTICE` weight) and recomputes sufficiency status.
- `POST /api/learner/reflections` — Logs a structured post-decision reflection (`LOW_REFLECTION` weight).

### Learning Guide Workspace (`FRI-GUIDE-001`)
- `GET /api/guide/workspace` — Role-protected (`GUIDE`, `ADMIN`, `CURRICULUM_OWNER`) roster, pending PDP queue, and Discovery session queue.
- `GET /api/guide/learners/:learnerId` — Full learner dossier including Guide-only private notes, Three-Agent AI runs, PDP version history, 45-Minute Conversations, and Multi-Source Sufficiency Evaluation.
- `POST /api/guide/learners/:learnerId/conversations` — Records a 45-Minute FRINS Conversation, agreed learning needs, and optional candidate PDP draft (`PENDING_GUIDE_REVIEW`).
- `POST /api/guide/learners/:learnerId/assessments` — Records a formal scenario/process assessment (`HIGH_FORMAL` weight) and updates multi-source sufficiency.
- `POST /api/guide/pdp/:pdpId/decision` — Executes consequential PDP governance (`APPROVE`, `EDIT_AND_APPROVE`, `REQUEST_CHANGES`, `REJECT`) with mandatory reason and audit logging.
- `POST /api/guide/learners/:learnerId/level-decision` — Approves, requests changes, or rejects competency level progression (`L1`–`L4`).
- `POST /api/guide/learners/:learnerId/competency-proposal` — Creates a learner-specific competency without altering the permanent Core Competency Library.

### Admin & Curriculum Owner Workspace (`FRI-ADMIN-001`, `FRI-QA-001`)
- `GET /api/admin/overview` — Role-protected (`ADMIN`, `CURRICULUM_OWNER`) operational metrics, users, **website leads**, courses, **course questions**, student course assignments, student tasks (with Admin-only AI pre-review and chat), solved Discovery Q&A, call bookings, core competencies, learner proposals, audit events, and requirements acceptance matrix.
- `POST /api/admin/courses` — Creates a custom course with modules.
- `PATCH /api/admin/courses/:courseId` — Edits course title, track, level, description, and modules.
- `DELETE /api/admin/courses/:courseId` — Deletes a course and cascades its student assignments and course questions.
- `POST /api/admin/courses/assign` — Assigns a custom course to a specific student with personalised notes.
- `POST /api/admin/courses/:courseId/questions` — Adds an Admin-defined course question (prompt, options, correct option, explanation).
- `PATCH /api/admin/course-questions/:questionId` — Edits a course question.
- `DELETE /api/admin/course-questions/:questionId` — Deletes a course question and its student attempts.
- `POST /api/admin/tasks` — Assigns a task (e.g. **Find Heikin-Ashi**) with instructions and expected AI review criteria.
- `POST /api/admin/tasks/:taskId/ai-reanalyze` — Re-runs the Admin/Team-only AI pre-review on a student upload.
- `POST /api/admin/tasks/:taskId/review` — Records the official Admin/Guide review and feedback.
- `POST /api/admin/users` — Provisions staff/learner accounts with role assignment.
- `PATCH /api/admin/users/:userId` — Updates user role or account status (`ACTIVE` / `SUSPENDED`).
- `POST /api/admin/competencies` — Creates or versions a permanent Core Competency Library rubric entry.
- `POST /api/admin/competency-proposals/:proposalId/promote` — Promotes a learner-specific competency proposal into the permanent Core Competency Library.
