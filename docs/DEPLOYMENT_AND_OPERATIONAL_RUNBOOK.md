# FRINS Deployment & Operational Runbook

The full deployment guide lives in [`/DEPLOYMENT.md`](../DEPLOYMENT.md): stack, hosting options,
environment variables, backups, and the pre-production checklist. This page is the short operational
reference.

## 1. Local development

```bash
npm install
npm test                 # 19 tests
npm run dev              # Express API on :3001 + Vite on :5173 with /api proxied
```

## 2. Production build and start

```bash
npm ci
npm run build            # writes public_build/
NODE_ENV=production npm start
```

One Node process on `PORT` (default 3001) serves both the API and the built UI. Verify with
`curl -f http://localhost:3001/api/health`.

## 3. Database and migration model (no Prisma)

- Engine: SQLite through `better-sqlite3`, file at `<working directory>/data/frins.db` in WAL mode.
  There is **no** database path environment variable; start the process from the project root.
- Schema: `CREATE TABLE IF NOT EXISTS` statements in `server/db.ts` plus the reference DDL in
  `server/migrations/001_initial_schema.sql`. Additive column migrations run on boot and ignore
  "duplicate column" errors.
- Seeding is idempotent and only fills empty tables on first boot.
- Backups must use the SQLite backup command, not `cp`:

```bash
sqlite3 data/frins.db ".backup 'backups/frins-$(date +%F).db'"
```

Restore by stopping the service, replacing `data/frins.db`, deleting `frins.db-wal` and
`frins.db-shm`, then starting the service again.

## 4. AI provider modes

| Mode | Configuration | Behaviour |
| --- | --- | --- |
| Deterministic mock (default) | `AI_PROVIDER=mock` or unset | Three-agent pipeline runs with no network calls, output tagged `sourceMode: deterministic-mock` |
| Live LLM | `AI_PROVIDER=real` and `AI_API_KEY` set | Uses `AI_API_BASE_URL` (default `https://api.openai.com/v1`) and `AI_MODEL` (default `gpt-4o-mini`) with `AI_TIMEOUT_MS` |

Every output still passes `validateThreeAgentOutput()` before it is stored or shown, and upstream
timeouts degrade to deterministic output with an audit record. Check the active mode at
`GET /api/ai/status` (admin only).

## 5. Training data endpoints

- Curation: `POST /api/ai/training/examples`
- Export: `GET /api/ai/training/dataset.jsonl`
- Benchmark: `POST /api/ai/benchmark/run`

Authorisation is either a signed-in `GUIDE` / `ADMIN` / `CURRICULUM_OWNER` bearer token, or the
`x-frins-guide-key` header matching `GUIDE_REVIEW_API_KEY` (or `FRINS_TRAINING_GUIDE_KEY`). The
development keys documented in older revisions are only accepted when `NODE_ENV` is not
`production`, so a deployed instance requires a real key or a staff session.

A model or prompt change must pass the benchmark with 100% pass rate before release.
