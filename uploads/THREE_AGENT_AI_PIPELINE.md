# FRISMN Three-Agent AI Layer and Governed Pipeline

## Purpose
This module adds a concrete orchestration layer while preserving FRISMN's governing principle: deterministic discovery rules remain authoritative, AI proposes, and a human Learning Guide reviews. The AI is for learning observations and development conversations—not trading signals, financial advice, predictions, or automated investment decisions.

## Agents

1. **Observational Agent** (`packages/server/src/ai/agents.ts`): runs the configured observation provider, validates the structured result through the safety scrubber, and records whether it used the live provider or a deterministic fallback. Inputs are the sanitized discovery context (no participant email/name).
2. **Decision Agent**: deterministic and governed. It classifies the next *review action* (continue discovery, Guide review, clarify, reassess evidence, or no concern established). It cannot change a competency level, publish a PDP, or override the deterministic sufficiency engine.
3. **Generative Agent**: produces a Guide-facing brief and discussion prompts. With `AI_PROVIDER=real|external` and a valid server-side key it asks the configured compatible LLM to phrase the brief; otherwise it uses a deterministic template and labels it `TEMPLATE`.

## End-to-end API

- `GET /api/ai/status`: provider mode and truthful implementation status; never returns secrets.
- `POST /api/ai/run` with `{ "sessionId": "<UUID>" }`: loads persisted discovery answers, reconstructs deterministic state, runs all three agents, safety-checks observations, persists an `AIWorkflowRun`, and returns a `PENDING_GUIDE_REVIEW` draft.
- Existing `POST /api/discovery/synthesize` remains available for the original observation-only flow.

## Pipeline stages

`Sanitize Context → Observational Agent → Safety Validation → Governed Decision Agent → Generative Agent → Final Safety Gate → Guide Review Queue`

No agent may approve itself. No output changes a learner's current approved level or activates a PDP. A rejected draft must be revised and reviewed again. A valid result may be “no concern established”; the system must not manufacture a learning problem.

## LLM configuration

Set only on the server in `packages/server/.env`:

- `AI_PROVIDER=mock` (default; offline and deterministic), or `AI_PROVIDER=real`
- `AI_API_KEY=<provider key>`
- `AI_MODEL=<provider model>`
- `AI_API_BASE_URL=<OpenAI-compatible chat-completions base URL>`
- `AI_TIMEOUT_MS=10000`

The adapter is OpenAI-compatible, not a claim of native compatibility with every provider. Confirm the provider's endpoint, authentication, JSON-mode support, retention terms and data-processing settings before using it with real learner information. The system sanitizes names/emails from the synthesis context, but free-text responses may still contain identifying details; use consent, minimization, and a privacy review before production.

## Learning, evaluation and training are different

This package implements **curation and export scaffolding**, not a trained FRISMN model.

- `POST /api/ai/training/examples`: stores an example only when consent, Guide verification and de-identification are explicitly asserted, and a configured `GUIDE_REVIEW_API_KEY` is supplied in `x-frismn-guide-key`.
- `GET /api/ai/training/dataset.jsonl`: exports curated examples with the same key.
- Examples are version-labelled and suitable for human review, offline evaluation, and future fine-tuning preparation. Saving/exporting examples does not train a model. There is no automatic learning from raw learner chats, no background fine-tuning job, and no model weights in this package.

Before fine-tuning: establish legal basis and consent, redact identifiers, split train/validation/test by participant (not by message), create Guide-approved gold labels, define a benchmark and safety evaluation, compare against the baseline, require owner approval, version the model, run staged deployment, and retain rollback capability. Do not place secrets or personal data in a training dataset.

## Production blockers

This is an implementation foundation, not a production certification. The Guide key is a narrow shared-secret gate for curation endpoints, not a replacement for full staff authentication/RBAC, key rotation, audit review, rate controls, data-retention controls or deployment secret management. The workflow-run record is stored, but full Guide approval/rejection UI and lifecycle APIs still need integration. Provider calls and schema validation require automated tests against the actual chosen provider before live use.
