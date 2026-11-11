# FRISMN AI Layer Release Notes

## Added
- Three-agent orchestration (`ObservationalAgent`, `DecisionAgent`, `GenerativeAgent`).
- Governed pipeline endpoint `POST /api/ai/run` and status endpoint `GET /api/ai/status`.
- Database persistence for workflow-run snapshots.
- Live compatible-LLM call for observation synthesis and Guide brief generation when configured; deterministic mock/template remains default.
- Guide-key-gated, explicit-consent, de-identified, Guide-verified training example curation and JSONL export.
- Discovery completion UI wired to the three-agent endpoint without redesigning the approved layout.
- Agent orchestration test, AI architecture guide and model-learning/training roadmap.

## Explicitly not included
- No pretrained/fine-tuned FRISMN model or model weights.
- No automatic training on learner conversations or online model updates.
- No production-ready Guide authentication/RBAC, complete PDP lifecycle, or full Learner/Guide/Admin dashboard persistence.
- No claim of a completed build or live provider test in this environment; dependency installation stalled.

## Required first-run verification
Run `START_FRISMN.bat`, which installs dependencies, generates the Prisma client, pushes the local database schema and builds. Confirm the terminal reports success for each step. Then verify `/api/health`, `/api/ai/status`, a complete Discovery session and `POST /api/ai/run`. Keep `AI_PROVIDER=mock` until you deliberately configure and verify a compatible live provider.
