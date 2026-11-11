# FRINS Clean-Slate Architecture & Implementation Plan

## 1. Executive Summary & Architectural Philosophy
FRINS (**The Market Learning Ecosystem**) is a human-led, AI-supported, personalised learning and capability-development platform for retail traders and investors. It develops **how** a market participant thinks, prepares, decides, manages risk, behaves under uncertainty, and reviews outcomes — rather than offering market calls, stock tips, signal feeds, or generic course libraries.

### Core Governing Invariants
1. **AI Proposes, Human Approves (`FRI-PROD-001`, `FRI-GUIDE-001`)**: No AI output can autonomously finalize a diagnosis, activate or replace a Personalised Development Plan (PDP), promote a learner's competency level (`L1 -> L4`), or modify the permanent Core Competency Library.
2. **Prior Approved PDP Remains Active (`FRI-LEARN-001`)**: While any candidate PDP revision is in `PENDING_GUIDE_REVIEW`, the learner's previously approved PDP remains active (`ACTIVE_APPROVED`).
3. **Multi-Source Evidence Weighting (`Requirement 11`)**: Self-reported reflections carry `LOW_REFLECTION` weight and cannot alone justify competency progression. Progression requires corroboration from `MEDIUM_PRACTICE` artefacts and `HIGH_FORMAL` Guide assessments.
4. **No Prisma / Explicit SQL Persistence**: All persistence is handled via explicit SQLite DDL (`server/migrations/001_initial_schema.sql`) and `better-sqlite3` with WAL journaling and strict foreign key constraints.

---

## 2. System Topology & Module Boundaries

```
+-----------------------------------------------------------------------------------+
|                        React 18 Client (Vite / TypeScript)                        |
|  - /            : Public Website (FRI-WEB-001, index.html design & tabs + modal)  |
|  - /discovery   : Canonical 34-Question Discovery Experience (FRI-DISC-001)       |
|  - /learner     : Learner Dashboard & Deliberate Practice Workspace (FRI-LEARN)   |
|  - /guide       : Learning Guide Review & Governance Console (FRI-GUIDE-001)      |
|  - /ai-pipeline : Three-Agent AI & Training Curation Sandbox (FRI-AI/ML)          |
|  - /admin       : Admin & Curriculum Owner Console (FRI-ADMIN-001)                |
+-----------------------------------------+-----------------------------------------+
                                          | Same-origin /api proxy
                                          v
+-----------------------------------------------------------------------------------+
|                     Express 4 API Server (server/index.ts)                        |
|  - Auth & Server-Side RBAC Middleware (requireAuth, requireRoles, rateLimiter)    |
|  - Canonical 34-Q Discovery Engine (server/canonicalQuestions.ts)                 |
|  - Three-Agent AI Pipeline & Safety Gate (server/aiPipeline.ts)                   |
|  - Multi-Source Sufficiency & Adaptation Engine (server/db.ts)                    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                SQLite Database (data/frins.db via better-sqlite3)                |
|  users | auth_sessions | leads | discovery_sessions | learner_profiles            |
|  guide_conversations | competency_library | learner_competency_proposals          |
|  pdp_versions | evidence_records | ai_pipeline_runs | training_examples           |
|  audit_events                                                                     |
+-----------------------------------------------------------------------------------+
```

---

## 3. Three-Agent AI Pipeline & Safety Boundary

```
Raw Discovery / Practice / Reflection Context
       │
       ▼
[1. Context Sanitizer (redactPII)]
   Strips emails, phone numbers, PAN/account numbers
       │
       ▼
[2. Agent 1: Observational Agent]
   Extracts grounded observations, tensions/contradictions,
   evidence sufficiency status, and uncertainty notes.
       │
       ▼
[3. Agent 2: Governed Decision Agent]
   Applies FRINS curriculum rules to propose exit pathway,
   post-practice adaptation action (CONTINUE, REINFORCE, CLARIFY,
   REASSESS, PROPOSE_PROGRESSION, PROPOSE_REVISION, PAUSE_FOR_GUIDE),
   and candidate competency level.
   Hard invariants: requiresHumanApproval=true, canDirectlyChangeLevel=false.
       │
       ▼
[4. Agent 3: Generative Agent]
   Drafts structured 45-Minute Guide Conversation Brief and
   candidate PDP draft in PENDING_GUIDE_REVIEW state.
       │
       ▼
[5. Final Safety & Grounding Validator]
   Blocks prohibited financial advice, stock tips, buy/sell signals,
   guarantee language, ungrounded claims, and governance bypasses.
```
