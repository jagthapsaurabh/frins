# FRISMN LLM Learning and Training Roadmap

## Current implementation status
- Three-agent orchestration code: implemented in this package.
- Observational live LLM call: available behind server-side provider configuration; mock is the default.
- Decision stage: deterministic governed rules, intentionally not delegated to an unconstrained LLM.
- Generative stage: live provider call when configured; otherwise labelled template.
- Curated training-example store and JSONL export: implemented behind a configured Guide review key.
- Proprietary trained model, fine-tuning runner, automatic online learning, vector memory and production benchmark suite: **not implemented**.

## Stages
1. **Evaluation first**: build a consented, de-identified, Guide-labelled gold set; define rubric and safety cases.
2. **Offline benchmark**: compare prompt/provider/model versions against fixed examples; evaluate evidence citations, uncertainty calibration, unsupported claims, bias and advice leakage.
3. **Curation growth**: accept only Guide-verified corrections with explicit consent; preserve provenance and dataset version.
4. **Fine-tuning feasibility**: only after sufficient high-quality examples and a measured gap that prompting/retrieval cannot solve. Start with a small controlled experiment; never assume more data means better outcomes.
5. **Approval and release**: independent safety review, owner approval, model card, version pinning, canary deployment and rollback plan.
6. **Post-release monitoring**: track failures and Guide overrides without silently training on live learner conversations.

No fixed data-count threshold is treated as a guarantee of readiness. Dataset quality, coverage, consent, label consistency and evaluation performance determine whether fine-tuning is justified.
