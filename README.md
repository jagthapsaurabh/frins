# FRINS: The Market Learning Ecosystem (Clean-Slate Edition V1.0)

Full-stack **React 18 + TypeScript + Express + SQLite (`better-sqlite3`, zero Prisma)** implementation of **FRINS: The Market Learning Ecosystem**.

---

## 1. Architecture & Key Principles Enforced

- **Prisma-Free Persistence (`server/db.ts`)**: Uses native SQLite (`better-sqlite3`) stored in `/home/user/data/frins.db` with WAL journaling, foreign-key enforcement, automatic schema migration, and deterministic seed data.
- **Approved Public Website (`src/pages/PublicWebsitePage.tsx`)**: Faithfully implements all 10 sections, typography (`Inter`), institutional color tokens (`#F7F5F0`, `#1B1A18`, `#2D5296`), interactive WAI-ARIA tabs, SEBI non-advisory notice, and Booking Modal wired to `POST /api/leads`.
- **Canonical 34-Question Discovery (`server/canonicalQuestions.ts`, `src/pages/DiscoveryPage.tsx`)**: Implements the canonical 34-question bank (`v1.0.0-canonical-34`) across 5 domains with deterministic completeness, contradiction detection, sufficiency classification (`SUFFICIENT`, `INSUFFICIENT`, `CONFLICTING`, `REVIEW_REQUIRED`), and permitted exit pathways including `NO_CONCERN_ESTABLISHED` (Requirement 3 & 8: never manufactures an artificial learning problem).
- **Three-Agent AI Orchestrator (`server/aiPipeline.ts`, `src/pages/AIPipelinePage.tsx`)**:
  - `Sanitize Context` (redacts names, emails, and phone numbers)
  - `ObservationalAgent` (summarises patterns, gaps, and uncertainty with question ID citations `evidenceRefs`)
  - `Safety & Grounding Validator` (verifies citations and blocks stock tips, buy/sell directives, guaranteed return claims, and clinical diagnoses)
  - `DecisionAgent` (deterministic governed classifier; forbidden from activating PDPs or altering approved levels)
  - `GenerativeAgent` (drafts Guide Conversation Brief & candidate PDP labelled `TEMPLATE` / `DRAFT PROPOSAL: REQUIRES EXPLICIT HUMAN GUIDE APPROVAL`, or `LIVE_LLM` when configured)
- **Human Governance & No Silent Progression (`src/pages/LearnerDashboardPage.tsx`, `src/pages/GuideWorkspacePage.tsx`)**:
  - Pending PDP revisions (`v2.0, PENDING_GUIDE_REVIEW`) remain separate from the currently active approved PDP (`v1.0, ACTIVE_APPROVED`) until a human Learning Guide explicitly executes `APPROVE` or `EDIT_AND_APPROVE`.
  - `REQUEST_CHANGES` and `REJECT` keep the previous approved PDP active.
  - Learner-specific competency proposals are tracked without mutating the permanent Core Competency Library.
- **Consented Training Curation & Offline Evaluation (`FRI-ML-001`, `FRI-ML-002`)**:
  - Requires explicit consent, de-identification, and Guide verification before storing training examples.
  - Enforces participant-hashed `TRAIN` / `VALIDATION` / `TEST` splits to prevent data leakage and supports one-click `.jsonl` export (`/api/ai/training/dataset.jsonl`).
  - Truthfully marks proprietary fine-tuning weights as `NOT IMPLEMENTED (Future Stage Gate)`.

---

## 2. Admin Course Questions, Website Leads & Rebrand

- **Brand**: the product is **FRINS: The Market Learning Ecosystem** everywhere (UI, API responses, database rows, seeded accounts `@frins.org`, package name `frins-ecosystem`, SQLite file `data/frins.db`).
- **Admin course questions**: Admin can create/edit/delete courses, edit their modules, and manage a per-course question bank. Students answer those questions from their dashboard and only see the correct answer + explanation after submitting.
- **Website leads inbox**: every public form submission (Basic Details / Discovery start, Book a Call, sign-ups) is stored in the `leads` table and rendered in Admin → *Solved Discovery Q&A & Call Leads* with contact details, track, status, notes and capture time.
- **AI isolation**: `/api/ai/status`, `/api/ai/run`, `/api/ai/runs`, `/api/ai/test-safety` and the whole training pipeline are restricted server-side to `ADMIN` / `CURRICULUM_OWNER`.

## 3. Public Website Is Learner-Only

- The marketing site exposes **only** learner-facing entry points: `Student Login`, `Book a Call`, `Start Discovery`.
- No Admin/Guide console links, staff portal menu, role badges or staff demo accounts appear anywhere on the public pages; the floating "Platform Portals" dock has been removed.
- Staff consoles (`/admin`, `/guide`, `/ai-pipeline`) remain reachable by direct URL but require a real staff email + password through a credential gate. The previous one-click "Switch to Admin/Guide" shortcuts (hardcoded password) were removed.
- `GET /api/auth/demo-accounts` returns **LEARNER accounts only** to anonymous/learner callers; the full staff directory requires an authenticated staff session.
- Visitors stay anonymous. There is no silent auto-login as a demo student. `/dashboard` redirects to the standalone `/login` page until the visitor signs in.

## 4. Dashboard Experience

- Signed-in workspaces use a persistent **application shell**: dark sidebar navigation, sticky top bar with breadcrumb, and an account menu (avatar, name, role).
- **Back to website** is available from the top bar, the sidebar ("Public Website") and the account menu, with no sign-out required. On the public site the header button becomes **My Learning** for a signed-in user.
- **Workspace switching**: Administrators / Curriculum Owners can switch to any active account (Guide, Learner, Admin) from the account menu → *Switch workspace*. The endpoint `POST /api/admin/session/switch` is server-side restricted to `ADMIN` / `CURRICULUM_OWNER`, issues a fresh session, and writes a `STAFF_WORKSPACE_SWITCHED` audit event. Learners cannot escalate. They get **Switch account**, which signs them out to enter other credentials.
- The dashboard is responsive: sidebar collapses into an off-canvas drawer below 1024px, account metadata hides below 720px.

## 5. Book a Call, Confirmations & Dashboard Stat Strips

- **Book a Call modal** is rebuilt as a three-step, mobile-first form (contact details → "What describes you best?" → preferred time) with 16px inputs (no iOS zoom), a bottom-sheet layout under 640px, inline validation and a summary footer.
- **"Other" track**: both the Book a Call form and the Discovery **Who You Are** step offer *Other (I will describe it myself)*, which reveals a required free-text field. The backend accepts `track: "other"` with `customTrack`, stores it in `custom_track` on `discovery_sessions`, `leads` and `call_bookings`, uses the text in the recommended course name (`Custom Course: <their words>`), and rejects Other without text (HTTP 400).
- The Discovery page also accepts a deep link, `/discovery?track=other`, which opens the form with Other already selected so the free-text field is visible.
- **Confirmation dialogs**: a reusable `ConfirmDialog` guards sign-out / switch-account, student account suspend/activate (deactivate is destructive-styled), and the deletion of courses and course questions. Native `window.confirm` is no longer used anywhere.
- **Professional dashboards**: both the learner and admin panels open with a hero header plus a responsive KPI strip (courses/tasks/submissions/questions/evidence for learners; leads/calls/reviews/courses/learners/Discovery for admins), collapsing 5 → 2 → 1 columns by breakpoint.

## 6. Real Credentials Only

- The login dialog no longer lists demo accounts, demo emails or passwords; fields start empty and are `autocomplete`-friendly.
- Generic placeholders only (`you@example.com`, "Enter your full name"). No seeded person names appear anywhere in the UI.
- Discovery's sample-profile auto-fill buttons are rendered for Admin sessions only, so real candidates see a clean questionnaire.
- The sign-in error no longer reveals the demo password.

## 7. Demo Role Accounts (Password for all: `frins123`)

You can switch between these accounts with one click using the top bar **Role Switcher** in the live preview:

| Role | Name | Email | Scenario |
| :--- | :--- | :--- | :--- |
| **Learner (Trader)** | Aarav Mehta | `aarav@example.com` | Approved Level `L2`; has Active PDP `v1.0` + Pending Revision `v2.0`, practice tasks, reflections, and formal assessment. |
| **Learner (Investor)** | Priya Nair | `priya@example.com` | Approved Level `L1`; completed Discovery with contradiction flags; awaiting Guide review of initial PDP `v1.0`. |
| **Learner (No Concern)** | Rohan Verma | `rohan@example.com` | Approved Level `L3`; deterministic `NO_CONCERN_ESTABLISHED` pathway with light maintenance charter. |
| **Learning Guide** | Dr. Vikram Sen | `vikram.guide@frins.org` | Full access to Learner Roster, Three-Agent AI Briefs, PDP Approve/Edit/Request-Changes/Reject workflow, and Level Decisions. |
| **Administrator / Curriculum Owner** | Meera Krishnan | `admin@frins.org` | Account provisioning, role/status controls, Core Competency & Rubric Versioning, AI Benchmarks, and Immutable Audit Trail. |

---

## 8. Routes, Copy Tone & Sign-In Pages

**Copy tone.** Website and dashboard copy is written to sound like a person, not a brochure: short
sentences, contractions, and concrete examples (a college student vs a live book). No "ecosystem",
"empower", "leverage", "seamless" or "personalised" phrasing. Em dashes are not used in app copy at
all; write a full stop, a colon or a comma instead. Headings stay around ten words or fewer.

### Public routes (learner-facing only)

| Route | Page |
| --- | --- |
| `/` | Home |
| `/why-frins` | Why FRINS |
| `/how-it-works` | How it works |
| `/tracks` | Tracks |
| `/discovery` | Discovery questions |
| `/login` | Student sign-in (standalone page) |
| `/dashboard` | Learner dashboard (redirects to `/login` when signed out) |

`/learner` and `/prototype` now redirect to `/dashboard`.

### Staff routes

Staff access is never linked from the public website, and each console has its own sign-in page.

| Console | Sign-in page | Console |
| --- | --- | --- |
| Admin Console | `/admin/login` | `/admin` |
| Guide Console | `/guide/login` | `/guide` |
| AI Engine | `/ai-pipeline/login` | `/ai-pipeline` |

- The sign-in page is a standalone screen with no dashboard chrome. On success it redirects to that
  console: `ADMIN` / `CURRICULUM_OWNER` go to `/admin`, `GUIDE` goes to `/guide`, `ADMIN` goes to
  `/ai-pipeline`.
- Opening a console URL directly while signed out (or with the wrong role) redirects to the matching
  `/login` page, so no console data is ever rendered for a guest. The server also checks the role on
  every API call, so a forged client redirect changes nothing.
- The primary sign-in page at `/login` is for learners. It has no staff links on it.
- **No dashboard opens without a session.** `src/auth/guard.ts` holds the rule (`decideDashboardAccess`): no user, no role, or the wrong role all resolve to `REDIRECT_TO_SIGN_IN`. The router applies it to `/dashboard`, `/admin`, `/guide` and `/ai-pipeline`, and the server independently rejects the same requests with 401 (no token) or 403 (wrong role) on every API route.

## 9. Accounts and database scripts

Seeded demo accounts exist so the app boots with something to look at. Create the real admin
before going live.

```bash
# Create a staff admin. Generates a strong password and prints it once.
npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN

# Supply your own password instead
npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN --password 'SomethingLong123'

# Other roles
npm run create:admin -- --email head@frins.in --name "Curriculum Lead" --role CURRICULUM_OWNER
npm run create:admin -- --email mentor@frins.in --name "Mentor" --role GUIDE
npm run create:user  -- --email learner@example.com --name "A Learner"     # LEARNER

# Reset an existing account's password and role
npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN --force

# See every account
npm run list:accounts
npm run create:admin -- --help

# Wipe and re-seed the database (asks for confirmation; --yes to skip)
npm run db:reset
```

On a server, run them as the app user so file ownership stays correct:

```bash
cd /var/www/frins.in && sudo -u frins npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN
```

The tool writes to the same `data/frins.db` the app uses, refuses to touch an existing email without
`--force`, rejects unknown roles and passwords under 8 characters, and records a
`STAFF_ACCOUNT_CREATED` or `STAFF_ACCOUNT_RESET` audit event.

## 10. Commands

```bash
# Install dependencies
npm install

# Run full-stack development server (Express API on :3001 + Vite React UI on :5173)
npm run dev

# Run automated acceptance tests (Vitest)
npm test

# Build production bundle (writes public_build/)
npm run build

# Serve API + built UI from one Node process on :3001
NODE_ENV=production npm start
```

## 11. Deployment

Stack and hosting instructions are in [`DEPLOYMENT.md`](DEPLOYMENT.md): the technology list, the
environment variables that matter, Docker and compose files, a VPS systemd unit, Render / Railway /
Fly notes, SQLite backup and restore, and the pre-production checklist. Operational details are in
[`docs/DEPLOYMENT_AND_OPERATIONAL_RUNBOOK.md`](docs/DEPLOYMENT_AND_OPERATIONAL_RUNBOOK.md).

For the live domain there is a tailored walkthrough: [`docs/HOSTINGER_VPS_SETUP.md`](docs/HOSTINGER_VPS_SETUP.md).
It covers pointing `frins.in` at the VPS, installing beside the existing sites under `/var/www`,
the `frins` service account, the nginx server block, certbot, deploys and rollbacks.

Ready-made files in [`deploy/`](deploy):

| File | Purpose |
| --- | --- |
| `deploy/frins.service` | systemd unit: `/var/www/frins.in`, user `frins`, port 3100, 900 MB cap |
| `deploy/nginx-frins.in.conf` | server block for `frins.in` and `www.frins.in` |
| `deploy/deploy.sh` | pull, install, test, build, restart, health check |
| `deploy/backup.sh` | nightly safe SQLite backup with integrity check and retention |
| `deploy/setup-vps.sh` | one-shot server bootstrap: packages, user, build, systemd, nginx, TLS |
| `deploy/push-to-github.sh` | push to GitHub with a personal access token, without storing the token |

### Fastest path on a fresh VPS

```bash
# on the server, from a checkout of the repo
sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh

# then create your own admin
cd /var/www/frins.in && sudo -u frins npm run create:admin -- \
  --email you@frins.in --name "Your Name" --role ADMIN
```

The script installs Node 20, nginx, sqlite3 and certbot, creates the `frins` user, builds the app,
installs the systemd unit and nginx server block, optionally requests the certificate, and finishes
with a health check. It only touches its own files and only restarts its own service, so other sites
on the box keep running.

### CI

`.github/workflows/ci.yml` runs on every push to `main`: type check, the 19 tests, a production
build, and a live smoke test of `/api/health`.