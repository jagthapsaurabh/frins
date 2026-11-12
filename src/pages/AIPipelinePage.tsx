import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StaffSignInGate } from '../components/StaffSignInGate';
import { PageHead, StatusPill, TableShell } from '../components/console/ConsoleUI';
import { formatDateTime } from '../utils/dates';
import { Beaker, Check, Download, FlaskConical, ShieldAlert, Sparkles } from 'lucide-react';

const human = (value?: string) => {
  const words = (value || '—').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The team's view of the AI layer: what ran, what the safety gate stopped, and
 * what is cleared to go into the training set. Nothing here decides a learner's
 * outcome. A person always signs off.
 */
export const AIPipelinePage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [trainingData, setTrainingData] = useState<any>(null);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [notice, setNotice] = useState<string>('');

  const [sampleText, setSampleText] = useState<string>(
    'Contact the participant at participant@example.com or +91 9000000000. Buy NIFTY calls with a target price of Rs 450 for guaranteed returns.'
  );
  const [safetyTestResult, setSafetyTestResult] = useState<any>(null);

  const [curationRunId, setCurationRunId] = useState<string>('');
  const [curationSplit, setCurationSplit] = useState<'TRAIN' | 'VALIDATION' | 'TEST'>('TRAIN');
  const [consentChecked, setConsentChecked] = useState<boolean>(true);
  const [deidChecked, setDeidChecked] = useState<boolean>(true);
  const [guideChecked, setGuideChecked] = useState<boolean>(true);
  const [curationReason, setCurationReason] = useState<string>(
    'Guide-verified example of grounded observation and a non-advisory conversation brief.'
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
      const data = await runsRes.json();
      const rows = data.runs || [];
      setRuns(rows);
      setSelectedRun((current: any) => current || rows[0] || null);
      setCurationRunId((current: string) => current || rows[0]?.id || '');
    }
    if (trainRes.ok) setTrainingData(await trainRes.json());
  };

  useEffect(() => {
    loadAll();
  }, [user]);

  const runSafetyTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await authFetch('/api/ai/test-safety', {
      method: 'POST',
      body: JSON.stringify({
        sampleText,
        participantName: 'Sample Participant',
        participantEmail: 'participant@example.com'
      })
    });
    if (res.ok) setSafetyTestResult(await res.json());
  };

  const runBenchmark = async () => {
    const res = await authFetch('/api/ai/benchmark/run', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      setNotice(`Benchmark finished. ${data.passedCases} of ${data.totalCases} cases passed.`);
      loadAll();
    } else {
      setNotice(data.error || 'Only an admin or curriculum owner can run the benchmark.');
    }
  };

  const curateExample = async (e: React.FormEvent) => {
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
      setNotice(`Example ${data.exampleId} added to the ${curationSplit.toLowerCase()} set.`);
      loadAll();
    } else {
      setNotice(data.error || 'A guide or admin has to sign off on this example.');
    }
  };

  const exportJSONL = async () => {
    const res = await authFetch('/api/ai/training/dataset.jsonl');
    if (res.ok) {
      setJsonlPreview(await res.text());
      setNotice('Dataset exported and the export is on the audit trail.');
    } else {
      setNotice('A guide or admin can export the dataset.');
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

  const splits = trainingData?.splits || {};
  const benchmark = trainingData?.benchmarks?.[0];
  const passedCases = (benchmark?.cases || []).filter((item: any) => item.passed).length;
  const model = aiStatus?.modelName || 'frins-deterministic-mock-v1';
  const live = aiStatus?.liveProviderConfigured;

  return (
    <div>
      <PageHead
        title="AI engine"
        meta={aiStatus ? `Running ${live ? 'a live model' : 'the offline mock'}` : undefined}
        actions={
          <button type="button" className="btn btn-secondary" onClick={runBenchmark}>
            <FlaskConical size={14} /> Run benchmark
          </button>
        }
      />

      {notice && <div className="governance-alert success">{notice}</div>}

      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <span className="kpi-icon">
            <Sparkles size={14} />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">Model</span>
            <span className="kpi-value" style={{ fontSize: 14 }}>
              {model}
            </span>
            <span className="kpi-hint">{human(aiStatus?.providerMode)}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-icon">
            <Beaker size={14} />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">Runs recorded</span>
            <span className="kpi-value">{runs.length}</span>
            <span className="kpi-hint">Every run keeps its trace</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-icon">
            <Check size={14} />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">Benchmark</span>
            <span className="kpi-value">
              {benchmark ? `${passedCases}/${benchmark.cases.length}` : 'Not run'}
            </span>
            <span className="kpi-hint">Gold cases passing</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-icon">
            <Download size={14} />
          </span>
          <span className="kpi-body">
            <span className="kpi-label">Curated examples</span>
            <span className="kpi-value">
              {(splits.TRAIN || 0) + (splits.VALIDATION || 0) + (splits.TEST || 0)}
            </span>
            <span className="kpi-hint">Across three splits</span>
          </span>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Recent runs</h2>
              <span className="section-note">Newest first</span>
            </div>

            <TableShell
              loading={!aiStatus && runs.length === 0}
              isEmpty={runs.length === 0}
              empty="No run has been recorded yet."
              columns={[
                { label: 'Participant' },
                { label: 'Pathway' },
                { label: 'Review', width: 140 },
                { label: 'When', width: 160 }
              ]}
            >
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="clickable-row"
                  onClick={() => setSelectedRun(run)}
                  style={selectedRun?.id === run.id ? { background: '#F8FAFC' } : undefined}
                >
                  <td data-label="Participant">
                    <span className="row-title">{run.participantName}</span>
                    <span className="row-sub">{run.traceId?.slice(0, 16)}</span>
                  </td>
                  <td data-label="Pathway" className="row-sub">
                    {human(run.exitPathway)}
                  </td>
                  <td data-label="Review">
                    <StatusPill
                      status={human(run.reviewState)}
                      tone={run.reviewState === 'APPROVED' ? 'approved' : 'warn'}
                    />
                  </td>
                  <td data-label="When" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(run.createdAt)}
                  </td>
                </tr>
              ))}
            </TableShell>

            {selectedRun && (
              <div className="fact-list" style={{ marginTop: 14 }}>
                <div className="fact">
                  <span>Decision</span>
                  <strong>{human(selectedRun.decisionStage?.proposedAction)}</strong>
                </div>
                <div className="fact">
                  <span>Validator</span>
                  <strong>{selectedRun.validatorResult?.passed ? 'Passed' : 'Stopped'}</strong>
                </div>
                <div className="fact">
                  <span>Sufficiency</span>
                  <strong>{human(selectedRun.sufficiencyStatus)}</strong>
                </div>
                <div className="fact">
                  <span>Learner hash</span>
                  <strong style={{ fontSize: 11 }}>
                    {selectedRun.sanitizedInputSummary?.participantHash || 'Not recorded'}
                  </strong>
                </div>
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>
                <ShieldAlert size={13} /> Safety check
              </h2>
              <span className="section-note">Paste any text before it reaches a learner</span>
            </div>

            <form onSubmit={runSafetyTest}>
              <div className="form-group">
                <label className="form-label" htmlFor="safetySample">
                  Text to check
                </label>
                <textarea
                  id="safetySample"
                  className="form-textarea"
                  rows={4}
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                />
              </div>
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="submit" className="btn btn-primary">
                  Check text
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setSampleText(
                      'The participant paused on their invalidation exits in two of the scenarios. Worth a short conversation on routine consistency.'
                    )
                  }
                >
                  Load a clean example
                </button>
              </div>
            </form>

            {safetyTestResult && (
              <div className={`feedback-note ${safetyTestResult.passedSafetyGate ? '' : 'danger'}`} style={{ marginTop: 12 }}>
                <strong>{safetyTestResult.passedSafetyGate ? 'Clear to send' : 'Blocked'}</strong>
                <p>
                  {safetyTestResult.passedSafetyGate
                    ? 'No advice and no personal details found.'
                    : `Found ${safetyTestResult.prohibitedMatches.join(', ')}.`}
                </p>
                <span style={{ wordBreak: 'break-word' }}>{safetyTestResult.redactedText}</span>
              </div>
            )}
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Training data</h2>
              <button type="button" className="link-button" onClick={exportJSONL}>
                Export
              </button>
            </div>

            <div className="fact-list fact-list-3" style={{ marginBottom: 14 }}>
              <div className="fact">
                <span>Train</span>
                <strong>{splits.TRAIN || 0}</strong>
              </div>
              <div className="fact">
                <span>Validation</span>
                <strong>{splits.VALIDATION || 0}</strong>
              </div>
              <div className="fact">
                <span>Test</span>
                <strong>{splits.TEST || 0}</strong>
              </div>
            </div>

            <form onSubmit={curateExample}>
              <div className="form-group">
                <label className="form-label" htmlFor="curationRun">
                  From run
                </label>
                <select
                  id="curationRun"
                  className="form-select"
                  value={curationRunId}
                  onChange={(e) => setCurationRunId(e.target.value)}
                  required
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.participantName} · {human(run.reviewState)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="curationSplit">
                  Split
                </label>
                <select
                  id="curationSplit"
                  className="form-select"
                  value={curationSplit}
                  onChange={(e) => setCurationSplit(e.target.value as any)}
                >
                  <option value="TRAIN">Train</option>
                  <option value="VALIDATION">Validation</option>
                  <option value="TEST">Test</option>
                </select>
              </div>

              <div className="check-list">
                <label>
                  <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                  Consent on record
                </label>
                <label>
                  <input type="checkbox" checked={deidChecked} onChange={(e) => setDeidChecked(e.target.checked)} />
                  Names and contact details removed
                </label>
                <label>
                  <input type="checkbox" checked={guideChecked} onChange={(e) => setGuideChecked(e.target.checked)} />
                  A guide has verified it
                </label>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="curationReason">
                  Why this example
                </label>
                <input
                  id="curationReason"
                  className="form-input"
                  value={curationReason}
                  onChange={(e) => setCurationReason(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-secondary" style={{ width: '100%' }}>
                Add to the dataset
              </button>
            </form>

            {jsonlPreview && <pre className="code-block">{jsonlPreview}</pre>}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Benchmark cases</h2>
            </div>
            <div className="audit-list">
              {(benchmark?.cases || []).map((item: any) => (
                <div key={item.id} className="audit-row">
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.details}</small>
                  </div>
                  <span className={`status-pill ${item.passed ? 'approved' : 'danger'}`}>
                    {item.passed ? 'Pass' : 'Fail'}
                  </span>
                </div>
              ))}
              {!benchmark && <p className="section-note">Run the benchmark to fill this in.</p>}
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>What is not built</h2>
            </div>
            <p className="prose-block muted">
              A live model writes the draft and the rules below it decide what is allowed. The team trains
              nothing online from chats. No FRINS model weights exist yet. Fine-tuning stays locked until the
              curated set is big enough and an owner signs off.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
