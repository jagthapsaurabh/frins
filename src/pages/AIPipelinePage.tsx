import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StaffSignInGate } from '../components/StaffSignInGate';

export const AIPipelinePage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [trainingData, setTrainingData] = useState<any>(null);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [notice, setNotice] = useState<string>('');

  // Safety Validator Sandbox state
  const [sampleText, setSampleText] = useState<string>(
    'Contact the participant at participant@example.com or +91 9000000000. Buy NIFTY calls with a target price of Rs 450 for guaranteed returns.'
  );
  const [safetyTestResult, setSafetyTestResult] = useState<any>(null);

  // Training curation form state
  const [curationRunId, setCurationRunId] = useState<string>('run_aarav_01');
  const [curationSplit, setCurationSplit] = useState<'TRAIN' | 'VALIDATION' | 'TEST'>('TRAIN');
  const [consentChecked, setConsentChecked] = useState<boolean>(true);
  const [deidChecked, setDeidChecked] = useState<boolean>(true);
  const [guideChecked, setGuideChecked] = useState<boolean>(true);
  const [curationReason, setCurationReason] = useState<string>(
    'Guide-verified gold example demonstrating grounded observation and non-advisory conversation brief.'
  );
  const [jsonlPreview, setJsonlPreview] = useState<string>('');

  const loadAll = async () => {
    const [statusRes, runsRes, trainRes] = await Promise.all([
      authFetch('/api/ai/status'),
      authFetch('/api/ai/runs'),
      authFetch('/api/ai/training/examples')
    ]);

    if (statusRes.ok) setAiStatus(await statusRes.json());
    if (runsRes.ok) {
      const rData = await runsRes.json();
      setRuns(rData.runs || []);
      if (!selectedRun && rData.runs?.length > 0) {
        setSelectedRun(rData.runs[0]);
      }
    }
    if (trainRes.ok) {
      setTrainingData(await trainRes.json());
    }
  };

  useEffect(() => {
    loadAll();
  }, [user]);

  const handleRunSafetyTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/ai/test-safety', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleText,
        participantName: 'Sample Participant',
        participantEmail: 'participant@example.com'
      })
    });
    if (res.ok) {
      setSafetyTestResult(await res.json());
    }
  };

  const handleRunOfflineBenchmark = async () => {
    const res = await authFetch('/api/ai/benchmark/run', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      setNotice(`✓ Offline Benchmark Suite Executed (${data.passedCases}/${data.totalCases} gold cases passed). Audit event recorded.`);
      loadAll();
    } else {
      setNotice(`⚠ Switch to Guide or Admin role to execute benchmark runs (${data.error || 'Forbidden'}).`);
    }
  };

  const handleCurateExample = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/ai/training/examples', {
      method: 'POST',
      body: JSON.stringify({
        sourceRunId: curationRunId,
        split: curationSplit,
        consentVerified: consentChecked,
        deidentifiedVerified: deidChecked,
        guideVerified: guideChecked,
        curationReason
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setNotice(`✓ Curated Training Example ${data.exampleId} (${data.leakageGuardNote})`);
      loadAll();
    } else {
      setNotice(`⚠ ${data.error || 'Curation requires Guide or Admin authorisation.'}`);
    }
  };

  const handleExportJSONL = async () => {
    const res = await authFetch('/api/ai/training/dataset.jsonl');
    if (res.ok) {
      const text = await res.text();
      setJsonlPreview(text);
      setNotice('✓ Exported verified training dataset in JSONL format and recorded audit trail.');
    } else {
      setNotice('⚠ Switch to Guide or Admin role to export JSONL dataset.');
    }
  };

  const isAdminUser = user?.role === 'ADMIN' || user?.role === 'CURRICULUM_OWNER';

  if (!isAdminUser) {
    return (
      <StaffSignInGate
        consoleName="AI Engine Console"
        allowedRoles={['ADMIN', 'CURRICULUM_OWNER']}
        currentRole={user?.role}
      />
    );
  }

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        <div className="workspace-header-banner">
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="micro-tag accent">FRI-AI-001..004 &middot; FRI-LLM-001 &middot; FRI-ML-001..002</span>
              <span className="micro-tag warn">
                Active Runtime Mode: {aiStatus?.providerMode || 'MOCK_DETERMINISTIC'}
              </span>
              <span className="micro-tag">Model: {aiStatus?.modelName}</span>
            </div>
            <h1 style={{ fontSize: 30, marginBottom: 6 }}>
              Three-Agent AI Orchestrator &amp; Governed Training Pipeline
            </h1>
            <p style={{ maxWidth: 780, fontSize: 14.5 }}>
              Pipeline sequence: <code>Sanitize Context &rarr; Observational Agent &rarr; Safety Validator &rarr; Governed Decision Agent &rarr; Generative Agent &rarr; Final Safety Gate &rarr; Guide Review Queue</code>.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-dark btn-sm" onClick={handleRunOfflineBenchmark}>
              Run Offline Gold Benchmark Suite (6 Cases)
            </button>
          </div>
        </div>

        {notice && (
          <div className="governance-alert success">
            {notice}
          </div>
        )}

        {/* Truthful Distinction Banner: LLM API vs Fine-Tuning Roadmap (Requirement 3, 9, 10) */}
        <div className="panel-card dark">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ maxWidth: 820 }}>
              <span className="micro-tag dark">Transparency &amp; Truthful AI Disclosure (Requirement 10)</span>
              <h3 style={{ fontSize: 20, margin: '8px 0 6px' }}>
                LLM Integration, Evaluation &amp; Proprietary Fine-Tuning Stage Gates
              </h3>
              <p style={{ fontSize: 13.5 }}>
                {aiStatus?.truthfulTrainingStatus?.notice} Raw learner chats are never automatically used for training. Only explicitly consented, de-identified, Guide-verified examples enter the curated JSONL store.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="micro-tag success">Stage 1–3: Curation &amp; Offline Eval ACTIVE</span>
              <span className="micro-tag warn">Stage 4–5: Fine-Tuning Weights NOT_IMPLEMENTED (Future Gate)</span>
            </div>
          </div>

          {/* 6-Stage Roadmap Track */}
          <div className="workspace-grid-3" style={{ marginTop: 18 }}>
            <div style={{ padding: 14, background: 'var(--bg-dark-surface)', borderRadius: 8, border: '1px solid var(--border-dark)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8AE2A8' }}>STAGE 1 &amp; 2 · IMPLEMENTED</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#FFF', marginTop: 4 }}>Gold Rubric &amp; Offline Benchmark</div>
              <div style={{ fontSize: 12, color: 'var(--text-dark-muted)', marginTop: 4 }}>
                Evaluates evidence citations, uncertainty calibration, contradiction detection, and blocks prohibited stock tips.
              </div>
            </div>

            <div style={{ padding: 14, background: 'var(--bg-dark-surface)', borderRadius: 8, border: '1px solid var(--border-dark)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8AE2A8' }}>STAGE 3 · IMPLEMENTED</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#FFF', marginTop: 4 }}>Consented De-Identified Curation</div>
              <div style={{ fontSize: 12, color: 'var(--text-dark-muted)', marginTop: 4 }}>
                Participant-hashed TRAIN / VALIDATION / TEST splits preventing data leakage, with audited JSONL export.
              </div>
            </div>

            <div style={{ padding: 14, background: 'var(--bg-dark-surface)', borderRadius: 8, border: '1px solid var(--border-dark)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#F5C469' }}>STAGE 4–6 · LOCKED FUTURE GATE</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#FFF', marginTop: 4 }}>Fine-Tuning &amp; Canary Release</div>
              <div style={{ fontSize: 12, color: 'var(--text-dark-muted)', marginTop: 4 }}>
                Requires owner sign-off, privacy audit, and measured gap over prompting before any model weights are trained.
              </div>
            </div>
          </div>
        </div>

        {/* Three Specialised Agent Contracts */}
        <div className="workspace-grid-3" style={{ marginBottom: 20 }}>
          {aiStatus?.agents?.map((ag: any, idx: number) => (
            <div key={ag.name} className="panel-card" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className="micro-tag accent">Agent 0{idx + 1}</span>
                <span className="micro-tag success">{ag.mode}</span>
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>{ag.name}</h3>
              <p style={{ fontSize: 13 }}>
                <strong>Forbidden Authority:</strong> {ag.forbiddenAuthority}
              </p>
            </div>
          ))}
        </div>

        <div className="workspace-grid-2">
          {/* Left Column: Persisted AIWorkflowRun Inspector + Safety Validator Sandbox */}
          <div>
            <div className="panel-card">
              <span className="micro-tag accent">Traceability &amp; Auditability</span>
              <h3 style={{ fontSize: 19, margin: '6px 0 12px' }}>Persisted Three-Agent Workflow Runs</h3>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`btn btn-sm ${selectedRun?.id === r.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSelectedRun(r)}
                  >
                    {r.participantName} ({r.traceId.slice(0, 10)})
                  </button>
                ))}
              </div>

              {selectedRun && (
                <div style={{ background: 'var(--bg-canvas)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <strong>Run ID: {selectedRun.id} &middot; Trace: {selectedRun.traceId}</strong>
                    <span className="micro-tag warn">{selectedRun.providerMode}</span>
                  </div>
                  <div><strong>Participant Hash (De-identified):</strong> <code>{selectedRun.sanitizedInputSummary?.participantHash}</code></div>
                  <div><strong>Deterministic Sufficiency:</strong> {selectedRun.sufficiencyStatus} &middot; <strong>Exit:</strong> {selectedRun.exitPathway}</div>
                  <div><strong>Decision Agent Proposal:</strong> <code>{selectedRun.decisionStage?.proposedAction}</code> (Review State: <code>{selectedRun.reviewState}</code>)</div>
                  <div><strong>Safety Validator Passed:</strong> {selectedRun.validatorResult?.passed ? 'TRUE (0 violations)' : 'FALSE'}</div>
                </div>
              )}
            </div>

            {/* Interactive Safety & PII Validator Sandbox */}
            <div className="panel-card">
              <span className="micro-tag accent">Validator / Safety Layer Test</span>
              <h3 style={{ fontSize: 19, margin: '6px 0 6px' }}>Test Prohibited Advice &amp; PII Redaction</h3>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Test how the FRINS Validator blocks stock tips, buy/sell directives, guaranteed return claims, clinical diagnoses, and redacts personal identifiers.
              </p>

              <form onSubmit={handleRunSafetyTest}>
                <div className="form-group">
                  <label className="form-label">Input Text to Validate &amp; Scrub</label>
                  <textarea
                    className="form-textarea"
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Run Safety &amp; PII Validator
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setSampleText(
                        'Participant reported hesitating on pre-defined invalidation exits in Q14 and Q20. Explore routine consistency in the 45-minute Guide conversation.'
                      )
                    }
                  >
                    Load Clean Compliant Observation
                  </button>
                </div>
              </form>

              {safetyTestResult && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                    background: safetyTestResult.passedSafetyGate ? 'var(--success-bg)' : 'var(--danger-bg)',
                    border: `1px solid ${safetyTestResult.passedSafetyGate ? 'var(--success-border)' : 'var(--danger-border)'}`,
                    fontSize: 13
                  }}
                >
                  <div>
                    <strong>Safety Gate Verdict:</strong>{' '}
                    {safetyTestResult.passedSafetyGate
                      ? 'PASSED. Safe for Guide review queue'
                      : `BLOCKED. ${safetyTestResult.prohibitedMatches.join(', ')}`}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong>PII-Scrubbed Output:</strong> <code>{safetyTestResult.redactedText}</code>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Training Curation & JSONL Export + Offline Benchmark Results */}
          <div>
            <div className="panel-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span className="micro-tag accent">FRI-ML-001 &middot; Curated Learning-Data Pipeline</span>
                  <h3 style={{ fontSize: 19, marginTop: 4 }}>Consented Training Curation &amp; JSONL Export</h3>
                </div>
                <button type="button" className="btn btn-dark btn-sm" onClick={handleExportJSONL}>
                  Export Curated Dataset (.jsonl)
                </button>
              </div>

              {trainingData && (
                <div className="workspace-grid-3" style={{ marginBottom: 14 }}>
                  <div className="metric-stat-box" style={{ padding: 12 }}>
                    <span className="metric-label">TRAIN Split</span>
                    <span className="metric-value" style={{ fontSize: 20 }}>{trainingData.splits?.TRAIN || 0}</span>
                  </div>
                  <div className="metric-stat-box" style={{ padding: 12 }}>
                    <span className="metric-label">VALIDATION Split</span>
                    <span className="metric-value" style={{ fontSize: 20 }}>{trainingData.splits?.VALIDATION || 0}</span>
                  </div>
                  <div className="metric-stat-box" style={{ padding: 12 }}>
                    <span className="metric-label">TEST Split</span>
                    <span className="metric-value" style={{ fontSize: 20 }}>{trainingData.splits?.TEST || 0}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleCurateExample} style={{ background: 'var(--bg-canvas)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div className="workspace-grid-2" style={{ gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Source Verified AI Run</label>
                    <select
                      className="form-select"
                      value={curationRunId}
                      onChange={(e) => setCurationRunId(e.target.value)}
                    >
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} ({r.participantName}: {r.decisionStage?.proposedAction})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Split (Participant-Locked)</label>
                    <select
                      className="form-select"
                      value={curationSplit}
                      onChange={(e) => setCurationSplit(e.target.value as any)}
                    >
                      <option value="TRAIN">TRAIN</option>
                      <option value="VALIDATION">VALIDATION</option>
                      <option value="TEST">TEST</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, marginBottom: 12 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                    <span>Explicit Participant Consent Verified (Q34 / Consent Record)</span>
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={deidChecked} onChange={(e) => setDeidChecked(e.target.checked)} />
                    <span>De-Identification &amp; PII Redaction Verified</span>
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={guideChecked} onChange={(e) => setGuideChecked(e.target.checked)} />
                    <span>Human Learning Guide Gold-Label Verification Complete</span>
                  </label>
                </div>

                <div className="form-group">
                  <label className="form-label">Curation Provenance &amp; Reason</label>
                  <input
                    className="form-input"
                    value={curationReason}
                    onChange={(e) => setCurationReason(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary btn-sm">
                  + Add Verified Example to Curated Store
                </button>
              </form>

              {jsonlPreview && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                    Exported JSONL Dataset Preview (<code>/api/ai/training/dataset.jsonl</code>):
                  </div>
                  <pre
                    style={{
                      background: '#1B1A18',
                      color: '#E7E3DC',
                      padding: 12,
                      borderRadius: 6,
                      fontSize: 11,
                      overflowX: 'auto',
                      maxHeight: 180
                    }}
                  >
                    {jsonlPreview}
                  </pre>
                </div>
              )}
            </div>

            {/* Offline Benchmark Evaluation Cases */}
            <div className="panel-card">
              <span className="micro-tag success">Offline Evaluation Suite</span>
              <h3 style={{ fontSize: 18, margin: '6px 0 10px' }}>Benchmark Cases (Grounding, Safety, Privacy)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trainingData?.benchmarks?.[0]?.cases?.map((c: any) => (
                  <div
                    key={c.id}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12.5
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{c.id}: {c.name}</strong>
                      <span className="micro-tag success" style={{ fontSize: 10, padding: '1px 7px' }}>
                        {c.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{c.details}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
