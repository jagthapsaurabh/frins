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
- There is no account directory endpoint. `/api/auth/demo-accounts` was removed, so no page can list, prefill or switch into another account. Every session starts from a real email and password.
- Visitors stay anonymous. There is no silent auto-login. `/dashboard` redirects to the standalone `/login` page until the visitor signs in.

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

- The login forms start empty, are `autocomplete`-friendly, and never display or prefill credentials.
- Generic placeholders only (`you@example.com`, "Enter your full name"). No seeded person names appear anywhere in the UI.
- Discovery has no sample-profile auto-fill buttons. Candidates answer the questions themselves.
- The sign-in error is the same for an unknown email and a wrong password.

## 7. Seeded accounts (development only)

The seed exists so a fresh development database has something to look at. It creates five
accounts, all with the password `frins123`, and it only runs when the database has no accounts
and no questions.

| Role | Name | Email | Scenario |
| :--- | :--- | :--- | :--- |
| **Learner (Trader)** | Aarav Mehta | `aarav@example.com` | Approved Level `L2`; active PDP, practice tasks, reflections, formal assessment. |
| **Learner (Investor)** | Priya Nair | `priya@example.com` | Approved Level `L1`; completed Discovery with contradiction flags. |
| **Learner (No Concern)** | Rohan Verma | `rohan@example.com` | Approved Level `L3`; `NO_CONCERN_ESTABLISHED` pathway. |
| **Learning Guide** | Dr. Vikram Sen | `vikram.guide@frins.org` | Learner roster, AI briefs, PDP review, level decisions. |
| **Administrator** | Meera Krishnan | `admin@frins.org` | Account provisioning, rubrics, AI benchmarks, audit trail. |

Sign in with the email and password on the relevant login page. There is no switcher, and no
endpoint returns the account list.

**On a real server, remove them.** They share a published password, so a public install must not
keep them. Create your own admin, then purge:

```bash
npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN
npm run purge:demo              # shows what would be removed
npm run purge:demo -- --yes     # removes the five seeded accounts and their sessions
```

The purge refuses to run if it would leave the database with no active administrator.

---

## 7b. The Admin Console

Admin and Curriculum Owner sign in at `/admin/login` and land on `/admin`. The console is a set of
pages, not one long scrolling page. There is one sidebar: the same app sidebar every role gets, with
the admin sections grouped inside it. No second menu inside the page. Neither the admin sidebar nor
the learner sidebar has a "public website" entry; the site link sits in the account menu, so the
workspace stays a workspace.

| Group | Section | What it does |
| --- | --- | --- |
| Work | Overview | Counts and four cards that jump to whatever needs attention |
| Work | Tasks | Uploaded work, internal AI pre-check, direct chat, approve or send back. Give a task from the same tab |
| Work | Messages | Every learner conversation in one place: search, open a thread, reply |
| Work | Courses | The course list: search, paid or free, active or inactive. Open a course or add one |
| Work | Communities | Group feeds. Create one, add learners and guides, post, reply, attach files |
| People | Learners | The enrolled learner list: search, track and status filters, pages of twenty. Open a learner for their file, or add one |
| People | Learner progress | One learner at a time: courses with task and question bars, every task with its status, uploads and AI pre-check, and a box to assign another course |
| People | Staff & access | Change a role, suspend or reactivate, reset a password, create an account |
| Growth | Leads | Website form submissions with a status you can move along |
| Growth | Bookings | Every call, with a status: confirmed, completed, no show, cancelled |
| Growth | Notifications | Send a notice to everyone, all learners, all staff, or one person |
| Setup | Discovery | Question bank, how many questions are active, add or retire questions |
| Setup | Settings | Your own password, rubric versions, full audit trail |

### Built for a thousand learners

The roster starts at a thousand people, so the console is paged from the first day.

- Every long list has its own endpoint with `page` and `limit`, plus search and a status filter that
  run in SQL: `/api/admin/learners`, `/tasks`, `/leads`, `/bookings`, `/users`, `/student-courses`,
  `/audit`, `/discovery-sessions`. A page is at most twenty rows, and the response carries `total`
  and `pages` so the UI can show "21-40 of 1,003 learners".
- `/api/admin/overview` is no longer used by the console. `/api/admin/metrics` returns counts and the
  small reference tables only. One learner's full detail comes from
  `/api/admin/learners/:id/progress`; one task's submission, AI pre-check and chat come from
  `/api/admin/tasks/:id`.
- The top bar has a learner search for admins. Type two letters, pick a person, and you land on
  their progress page.
- Tables and the audit log scroll inside a bounded box with a sticky header, so the page itself does
  not grow with the data.

Notes:

- An admin can do everything a guide can. The guide API routes accept `GUIDE`, `ADMIN` and
  `CURRICULUM_OWNER`, and the Learners section renders the same review desk a guide sees.
- Each section has its own URL, so `/admin/tasks` or `/admin/bookings` can be bookmarked, shared,
  and survives a refresh. The sidebar highlights whatever section you are on.
- Staff no longer see a "My Learning" item, because `/dashboard` is the learner area and would
  bounce them to a sign-in page.
- The nav list lives in one file, `src/pages/adminSections.tsx`. The sidebar and the page both read
  it, so a section cannot exist in one and be missing in the other.
- The bell in the top bar shows unread notices and marks them read as they are opened.
- "Update password" is in the account menu for every role. Changing it signs out other devices.
- Resetting someone else's password requires no current password, returns a one-time password, and
  ends their sessions. Every reset is written to the audit trail.

## 7c. Learners, Courses That Teach, and Calls

### The learner tab

`/admin/learners` is the list admins asked for. It is a real table: name and email, track, course
count, reviewed task count, last activity, and account status. Search covers name, email and phone.
Two filters sit next to it, one for track and one for active or suspended. Twenty rows a page.

- Click a row to open `/admin/learners/:learnerId`. That page is the learner file: contact details,
  the guide, the level, every course they are enrolled in with its step bar, every task with the
  time it was given, when it was uploaded and when it was reviewed, every call they booked, and
  their reflection log. The details can be edited in place, the guide reassigned, the account
  suspended, and the payment on each course changed.
- **Add learner** opens `/admin/learners/new`. It creates the account, sets the track, picks a
  guide, and can enrol the learner in a course with the amount paid and payment status in the same
  step. Leave the password blank and a temporary one is generated and shown once.

### The course list

Courses and tasks are two separate tabs. `/admin/courses` is the list: title and track, level, the
duration the steps add up to, paid or free, steps, learners, and a switch for active or inactive.
Search sits over the table with a paid filter and a status filter. Turning a course off asks first,
and an inactive course cannot be assigned to anyone.

The header follows the learner tab: no subtitle and no gap under the title, so the table starts
right away.

- Click a row to open `/admin/courses/:courseId`. That page is the course: duration, price, status,
  learners, steps, money collected, a box to enrol a learner with the amount paid, the step list,
  and the builder itself.
- **Add course** opens `/admin/courses/new` on its own route. It asks for the title, track, level,
  description, duration and price, then drops you into the builder.

### Building a course that actually teaches

`/admin/courses/new` creates the course, then the same page becomes the builder
(`/admin/courses/:courseId`). A course is a list of **steps** in order:

| Step kind | What the learner gets |
| --- | --- |
| Reading | A written lesson, shown as text |
| YouTube video | The video embedded in the lesson |
| PDF / Word file | An upload, with a download button |
| Web link | A button that opens the page |
| Task / milestone | A brief, an upload box, and a mentor review |

Rules that make it a course rather than a file dump:

- Steps run top to bottom. Step 2 is locked until step 1 is marked done.
- A reading, video, file or link step is finished with **Mark this step done**.
- A task step is finished by submitting work and getting a mentor review. The submission creates a
  real task, so it lands in Task review and in the learner's Tasks tab, with the same chat.
- A reviewed milestone unlocks the next step and moves the course percentage along.
- Steps can be reordered, edited or deleted; deleting a step tells you what goes with it.
- The learner opens the course at `/dashboard/courses/:courseId` and works in the player.

### Messages, both ways

Chat lives in the sidebar on both sides. A learner sees **Messages** under Learning and gets one
thread with the team, named after their guide. An admin or guide sees **Messages** under Work: a
list of every learner they can talk to, a search box, and the same thread view. Either side can send
at any time. The other side gets a notification, the thread moves to the top of the list, and unread
counts clear when it is opened. Messages cap at 2000 characters and every send lands in the audit
trail. The older per-task chat is still there for a specific upload.

### Calling the team

A learner can book time from the top bar (**Book a call**), from the Calls tab, or from the card in
the sidebar. They pick a mentor, a date, a time and a topic. That writes a request, notifies the
mentor, and shows up in the learner's Calls tab and in the admin Bookings list with a **From
dashboard** tag. The mentor confirms, moves or cancels it from Bookings, and the learner is notified.

### Every task carries its dates

`learning_tasks` now stores `assigned_at`. The task list in Task review and in the learner's Tasks
tab shows four timestamps: given, due, uploaded, reviewed. Task review also filters by course and by
date range (today, last 7 days, last 30 days, due in the next 3 days), and the learner's own task
list has a search box plus status and course filters.

---

## 7d. The console: community, layout and routes

### One design, both consoles

The dashboard was rebuilt from the stylesheet up. `src/styles/console.css` loads after the public
site's styles and gives the admin console and the learner panel one language: a single blue accent,
hairline borders, 6px corners, no drop shadows and no decorative pills. The public website keeps its
own look, so a student sees a marketing page outside and a plain tool inside.

Rules the console follows:

- A page has one title. No subtitle under it and no empty space between the title and the content.
  The eyebrow above the title (Work, People, Setup) is enough context.
- Lists are tables, not cards. Every long list has a search box, its filters and a pager.
- Add, edit and open are routes. A list never grows a form inside it:
  `/admin/courses/new`, `/admin/staff/new`, `/admin/notifications/new`,
  `/admin/discovery/questions/new`, `/admin/communities/new`, plus the matching detail pages.
- Buttons carry an icon. Row actions are icon buttons with an accessible label.
- Nothing is rounded beyond 8px and no card floats above the page.

### Overview screens

`/admin` and `/dashboard` draw from `GET /api/admin/summary` and `GET /api/learner/summary`.
Those endpoints return only what the screen shows, so the first paint is one small request. The
admin overview is six counts, the review queue, and three short lists: calls, leads, and courses
that are switched off or have nobody on them. The learner overview is what is due, how far each
course has run, the last mentor feedback and who to talk to.

### Communities

A community is a group with one shared feed.

- An admin or guide creates one at `/admin/communities/new` or `/guide/communities/new`, gives it a
  name and a type, and picks the members.
- The feed is at `/admin/communities/:communityId`, and on the learner side at
  `/dashboard/communities/:communityId`. Both render the same room: posts in order, a quote of the
  message being replied to, and the file under the post.
- Anyone in the group can post, reply to one message, attach an image, PDF, Word, Excel or text
  file, and delete their own post. Moderators can delete any post and remove people.
- Files are stored under `data/uploads/community` and served through `GET /api/community-files/:id`
  with a membership check, so a copied URL does not leak a screenshot.
- New posts notify the other members. Unread counts show in the list and on the learner overview.
- Archiving a community makes it read only.

Members and settings live at `/admin/communities/:communityId/members`.

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
| `/dashboard` | Learner overview (redirects to `/login` when signed out) |
| `/dashboard/courses` | My courses: modules and the course questions |
| `/dashboard/tasks` | Tasks and uploads: write an answer, attach a chart, chat with the mentor |
| `/dashboard/progress` | Progress: approved plan, reflections, evidence |
| `/dashboard/messages` | Messages with the guide and the team |
| `/dashboard/calls` | Calls the learner booked from the panel |

`/learner` and `/prototype` now redirect to `/dashboard`.

The learner workspace uses the same shell as the admin console: one sidebar, page header, and the
section decided by the URL. Admin sections live under `/admin/:section` for the same reason.

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
cd /var/www/frins && sudo -u frins npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN
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
| `deploy/frins.service` | systemd unit: `/var/www/frins`, user `frins`, port 3100, 900 MB cap |
| `deploy/nginx-frins.in.conf` | server block for `frins.in` and `www.frins.in` |
| `deploy/install-nginx.sh` | installs that block, blocks duplicate `server_name` files, tests and rolls back |
| `deploy/deploy.sh` | pull, install, test, build, restart, health check |
| `deploy/backup.sh` | nightly safe SQLite backup with integrity check and retention |
| `deploy/setup-vps.sh` | one-shot server bootstrap: packages, user, build, systemd, nginx, TLS. Handles any clone folder, `DRY_RUN=1` to preview |
| `deploy/push-to-github.sh` | push to GitHub with a personal access token, without storing the token |

Folder layout, every settable option and the domain decision are covered in
[`docs/DEPLOY_CHANGES.md`](docs/DEPLOY_CHANGES.md). The short version: the clone folder is only a
bootstrap, the app installs to `/var/www/frins`, and the API shares the main domain, no subdomain.

### Fastest path on a fresh VPS

```bash
# on the server
cd /var/www
git clone https://github.com/jagthapsaurabh/frins.git frins
cd /var/www/frins

sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh

# then create your own admin
sudo -u frins npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN
```

The script installs Node 20, nginx, sqlite3 and certbot, creates the `frins` user, builds the app,
installs the systemd unit and nginx server block, optionally requests the certificate, and finishes
with a health check. It only touches its own files and only restarts its own service, so other sites
on the box keep running.

### CI

`.github/workflows/ci.yml` runs on every push to `main`: type check, the 19 tests, a production
build, and a live smoke test of `/api/health`.