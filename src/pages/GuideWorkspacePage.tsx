import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StaffSignInGate } from '../components/StaffSignInGate';

export const GuideWorkspacePage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const [workspaceData, setWorkspaceData] = useState<any>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string>('usr_learner_aarav');
  const [learnerDossier, setLearnerDossier] = useState<any>(null);
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [trackFilter, setTrackFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // PDP Governance Decision state
  const [decisionPDPId, setDecisionPDPId] = useState<string>('');
  const [decisionAction, setDecisionAction] = useState<'APPROVE' | 'EDIT_AND_APPROVE' | 'REQUEST_CHANGES' | 'REJECT'>('APPROVE');
  const [decisionReason, setDecisionReason] = useState<string>('');
  const [editedTitle, setEditedTitle] = useState<string>('');
  const [editedSummary, setEditedSummary] = useState<string>('');
  const [editedRoutine, setEditedRoutine] = useState<string>('');
  const [governanceBanner, setGovernanceBanner] = useState<string>('');

  // 45-Minute FRINS Conversation form state (Step 6, 7 & 8)
  const [convSummary, setConvSummary] = useState<string>('');
  const [convNeeds, setConvNeeds] = useState<string>('Establish written pre-decision checklist; Enforcing 2-loss cool-down');
  const [convDraftPDP, setConvDraftPDP] = useState<boolean>(true);

  // Formal Assessment form state (Step 11 & 12)
  const [assCompetency, setAssCompetency] = useState<string>('COMP-EXEC-03');
  const [assType, setAssType] = useState<string>('SCENARIO_EVALUATION');
  const [assLevel, setAssLevel] = useState<string>('L3');
  const [assStatus, setAssStatus] = useState<string>('SUFFICIENT');
  const [assFindings, setAssFindings] = useState<string>('');

  // Level Progression state
  const [targetLevel, setTargetLevel] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L3');
  const [levelDecisionStatus, setLevelDecisionStatus] = useState<'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>('APPROVED');
  const [levelReason, setLevelReason] = useState<string>('');

  // Learner-Specific Competency Proposal state
  const [customCompTitle, setCustomCompTitle] = useState<string>('');
  const [customCompDesc, setCustomCompDesc] = useState<string>('');

  const loadGuideWorkspace = async () => {
    setLoading(true);
    setRbacError(null);
    try {
      const res = await authFetch('/api/guide/workspace');
      if (res.status === 403 || res.status === 401) {
        const errData = await res.json();
        setRbacError(errData.error || 'Access restricted to Learning Guides and Administrators.');
        setLoading(false);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        setWorkspaceData(json);
        await loadLearnerDossier(selectedLearnerId);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadLearnerDossier = async (learnerId: string) => {
    setSelectedLearnerId(learnerId);
    const res = await authFetch(`/api/guide/learners/${learnerId}`);
    if (res.ok) {
      const json = await res.json();
      setLearnerDossier(json);
      const pending = json.pdpVersions?.find((p: any) => p.status === 'PENDING_GUIDE_REVIEW') || json.pdpVersions?.[0];
      if (pending) {
        setDecisionPDPId(pending.id);
        setEditedTitle(pending.title);
        setEditedSummary(pending.summary);
        setEditedRoutine(pending.routine_schedule);
      }
    }
  };

  useEffect(() => {
    loadGuideWorkspace();
  }, [user]);

  const handleRecordConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convSummary.trim()) return;
    const needsArr = convNeeds
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await authFetch(`/api/guide/learners/${selectedLearnerId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({
        conversationSummary: convSummary,
        agreedLearningNeeds: needsArr,
        createPDPDraft: convDraftPDP
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setGovernanceBanner(
        `✓ Recorded 45-Minute FRINS Conversation (${out.conversationId})${
          out.createdPdpId ? ` and drafted candidate PDP (${out.createdPdpId}) in PENDING_GUIDE_REVIEW.` : '.'
        }`
      );
      setConvSummary('');
      await loadGuideWorkspace();
    } else {
      setGovernanceBanner(`⚠ ${out.error || 'Could not record conversation'}`);
    }
  };

  const handleRecordFormalAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assFindings.trim()) return;
    const res = await authFetch(`/api/guide/learners/${selectedLearnerId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        competencyCode: assCompetency,
        assessmentType: assType,
        demonstratedLevel: assLevel,
        evidenceStatus: assStatus,
        findings: assFindings
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setGovernanceBanner(
        `✓ Recorded Formal Assessment (${out.assessmentId}, Weight: HIGH_FORMAL). Updated Multi-Source Sufficiency: ${out.sufficiencyEvaluation.evidenceStatus} → Proposed Action: ${out.sufficiencyEvaluation.proposedAdaptationAction}`
      );
      setAssFindings('');
      await loadGuideWorkspace();
    } else {
      setGovernanceBanner(`⚠ ${out.error || 'Could not record formal assessment'}`);
    }
  };

  const handlePDPDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionPDPId || !decisionReason.trim()) return;
    const res = await authFetch(`/api/guide/pdp/${decisionPDPId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        action: decisionAction,
        reason: decisionReason,
        title: decisionAction === 'EDIT_AND_APPROVE' ? editedTitle : undefined,
        summary: decisionAction === 'EDIT_AND_APPROVE' ? editedSummary : undefined,
        routineSchedule: decisionAction === 'EDIT_AND_APPROVE' ? editedRoutine : undefined
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setGovernanceBanner(
        `✓ Recorded Guide Decision [${decisionAction}] on PDP ${decisionPDPId}. Currently Active Approved PDP for learner: ${
          out.currentlyActiveApprovedPDP
            ? `v${out.currentlyActiveApprovedPDP.version_number}.0 (${out.currentlyActiveApprovedPDP.title})`
            : 'None'
        }`
      );
      setDecisionReason('');
      await loadGuideWorkspace();
    } else {
      setGovernanceBanner(`⚠ ${out.error || 'Decision failed'}`);
    }
  };

  const handleLevelDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!levelReason.trim()) return;
    const res = await authFetch(`/api/guide/learners/${selectedLearnerId}/level-decision`, {
      method: 'POST',
      body: JSON.stringify({
        decisionStatus: levelDecisionStatus,
        targetLevel,
        reason: levelReason,
        evidenceRefs: ['ev_aarav_02', 'ev_aarav_03']
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setGovernanceBanner(
        `✓ Recorded Level Decision [${levelDecisionStatus}]: Learner level is now ${out.currentApprovedLevel} (Previous: ${out.previousLevel}). Logged to Audit Trail.`
      );
      setLevelReason('');
      await loadGuideWorkspace();
    } else {
      setGovernanceBanner(`⚠ ${out.error || 'Level decision failed'}`);
    }
  };

  const handleCreateLearnerSpecificCompetency = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCompTitle.trim() || !customCompDesc.trim()) return;
    const res = await authFetch(`/api/guide/learners/${selectedLearnerId}/competency-proposal`, {
      method: 'POST',
      body: JSON.stringify({
        title: customCompTitle,
        domain: 'RISK_EXECUTION',
        description: customCompDesc,
        rationale: 'Contextual to learner participation profile',
        targetLevel: 'L2'
      })
    });
    const out = await res.json();
    if (res.ok && out.success) {
      setGovernanceBanner(
        `✓ Approved Learner-Specific Competency (${out.proposalId}). Permanent Core Competency Library modified: FALSE (Requirement 11 enforced).`
      );
      setCustomCompTitle('');
      setCustomCompDesc('');
      await loadGuideWorkspace();
    }
  };

  if (!user || (user.role !== 'GUIDE' && user.role !== 'ADMIN' && user.role !== 'CURRICULUM_OWNER') || rbacError) {
    return (
      <StaffSignInGate
        consoleName="Guide Console"
        allowedRoles={['GUIDE', 'ADMIN', 'CURRICULUM_OWNER']}
        currentRole={user?.role}
      />
    );
  }

  const filteredLearners = (workspaceData?.learners || []).filter((l: any) => {
    if (trackFilter !== 'ALL' && l.track !== trackFilter) return false;
    if (
      searchQuery &&
      !l.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !l.email.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const latestAI = learnerDossier?.aiRuns?.[0];
  const suffEval = learnerDossier?.sufficiencyEvaluation;

  return (
    <div className="workspace-shell">
      <div className="container-wide">
        <div className="workspace-header-banner">
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="micro-tag accent">FRI-GUIDE-001 &middot; Human Governance Workspace</span>
              <span className="micro-tag success">Signed in: {user?.name} ({user?.role})</span>
            </div>
            <h1 style={{ fontSize: 30, marginBottom: 6 }}>Learning Guide Review &amp; Approval Console</h1>
            <p style={{ maxWidth: 760, fontSize: 14.5 }}>
              AI proposes; the human Learning Guide reviews evidence with the learner, conducts the 45-minute FRINS Conversation, and explicitly approves, edits-and-approves, requests changes, or rejects PDP versions and level progressions.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="metric-stat-box" style={{ padding: '10px 16px' }}>
              <span className="metric-label">Pending PDP Drafts</span>
              <span className="metric-value" style={{ fontSize: 20, color: 'var(--warn-text)' }}>
                {workspaceData?.pendingPDPs?.length || 0}
              </span>
            </div>
            <div className="metric-stat-box" style={{ padding: '10px 16px' }}>
              <span className="metric-label">Assigned Learners</span>
              <span className="metric-value" style={{ fontSize: 20 }}>
                {workspaceData?.learners?.length || 0}
              </span>
            </div>
          </div>
        </div>

        {governanceBanner && (
          <div className="governance-alert success">
            {governanceBanner}
          </div>
        )}

        <div className="workspace-sidebar-layout">
          {/* Left Column: Learner Roster & Learner-Specific Competency Creator */}
          <div>
            <div className="panel-card">
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>Authorised Learner Roster</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="form-input"
                  placeholder="Search learner..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ padding: '7px 10px', fontSize: 13 }}
                />
                <select
                  className="form-select"
                  value={trackFilter}
                  onChange={(e) => setTrackFilter(e.target.value)}
                  style={{ width: 110, padding: '7px 8px', fontSize: 12.5 }}
                >
                  <option value="ALL">All Tracks</option>
                  <option value="trader">Trader</option>
                  <option value="investor">Investor</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredLearners.map((l: any) => {
                  const isSelected = l.id === selectedLearnerId;
                  return (
                    <div
                      key={l.id}
                      onClick={() => loadLearnerDossier(l.id)}
                      style={{
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 14.5 }}>{l.name}</strong>
                        <span className="micro-tag accent" style={{ fontSize: 10, padding: '2px 8px' }}>
                          Approved: {l.approved_level}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Track: {l.track.toUpperCase()} &middot; Evidence: {l.evidence_status}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {l.activePDP && (
                          <span className="micro-tag success" style={{ fontSize: 10, padding: '2px 7px' }}>
                            Active PDP v{l.activePDP.version_number}.0
                          </span>
                        )}
                        {l.pendingPDP && (
                          <span className="micro-tag warn" style={{ fontSize: 10, padding: '2px 7px' }}>
                            Pending PDP v{l.pendingPDP.version_number}.0
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Learner-Specific vs Permanent Core Competency Governance */}
            <div className="panel-card">
              <span className="micro-tag accent">Requirement 11 Governance</span>
              <h3 style={{ fontSize: 16, margin: '6px 0 8px' }}>Add Learner-Specific Competency</h3>
              <p style={{ fontSize: 12, marginBottom: 12 }}>
                Approving a learner-specific competency attaches it to this learner&apos;s profile without modifying the permanent FRINS Core Competency Library.
              </p>
              <form onSubmit={handleCreateLearnerSpecificCompetency}>
                <div className="form-group">
                  <label className="form-label">Custom Competency Title</label>
                  <input
                    className="form-input"
                    value={customCompTitle}
                    onChange={(e) => setCustomCompTitle(e.target.value)}
                    placeholder="e.g. Opening 15-Minute Volatility Restraint"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description &amp; Criteria</label>
                  <input
                    className="form-input"
                    value={customCompDesc}
                    onChange={(e) => setCustomCompDesc(e.target.value)}
                    placeholder="Specific observable habit for this learner"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
                  + Approve Learner-Specific Competency
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Selected Learner Dossier, Three-Agent Brief, Conversation Logger & Consequential Approval Forms */}
          <div>
            {learnerDossier && (
              <>
                {/* Guide-Only Dossier Header */}
                <div className="panel-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                        <span className="micro-tag accent">Learner Dossier: {learnerDossier.learner.name}</span>
                        <span className="micro-tag success">Approved Level: {learnerDossier.profile?.approved_level}</span>
                        {learnerDossier.profile?.proposed_level && (
                          <span className="micro-tag warn">
                            Candidate Level Proposal: {learnerDossier.profile.proposed_level} ({learnerDossier.profile.level_review_state})
                          </span>
                        )}
                      </div>
                      <h2 style={{ fontSize: 22 }}>{learnerDossier.learner.name} ({learnerDossier.learner.email})</h2>
                      <p style={{ fontSize: 13.5, marginTop: 4 }}>{learnerDossier.profile?.market_context_summary}</p>
                    </div>
                  </div>

                  {/* Guide Private Notes Box */}
                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-dark)',
                      color: 'var(--text-white)',
                      fontSize: 13
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dark-muted)', marginBottom: 4 }}>
                      Guide-Only Confidential Notes (Never Exposed to Learner API)
                    </div>
                    <div>{learnerDossier.profile?.guide_private_notes}</div>
                  </div>
                </div>

                {/* Multi-Source Evidence Sufficiency & Post-Practice Adaptation Proposal (Requirement 8.26 & Section 11) */}
                {suffEval && (
                  <div className="panel-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <div>
                        <span className="micro-tag accent">Requirement 11 &middot; Multi-Source Sufficiency Engine</span>
                        <h3 style={{ fontSize: 18, marginTop: 4 }}>Evidence Weight &amp; Post-Practice Adaptation Proposal</h3>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span
                          className={`micro-tag ${
                            suffEval.evidenceStatus === 'SUFFICIENT'
                              ? 'success'
                              : suffEval.evidenceStatus === 'CONFLICTING'
                                ? 'danger'
                                : 'warn'
                          }`}
                        >
                          Status: {suffEval.evidenceStatus}
                        </span>
                        <span className="micro-tag accent">
                          Proposal: {suffEval.proposedAdaptationAction}
                        </span>
                      </div>
                    </div>

                    <div className="workspace-grid-3" style={{ marginBottom: 12 }}>
                      <div style={{ padding: 12, background: 'var(--bg-canvas)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-text)' }}>HIGH_FORMAL WEIGHT</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{suffEval.sourceBreakdown.highFormalAssessments}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Formal Guide Scenario / Process Evaluations</div>
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-canvas)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>MEDIUM_PRACTICE WEIGHT</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{suffEval.sourceBreakdown.mediumPracticeArtefacts}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Deliberate Practice &amp; Conversation Logs</div>
                      </div>

                      <div style={{ padding: 12, background: 'var(--bg-canvas)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light-muted)' }}>LOW_REFLECTION WEIGHT</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{suffEval.sourceBreakdown.lowWeightReflections}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Self-Reported Reflections &amp; Discovery</div>
                      </div>
                    </div>

                    <p style={{ fontSize: 13, color: 'var(--text-main)' }}>
                      <strong>Adaptation Rationale:</strong> {suffEval.rationale}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-light-muted)', marginTop: 4 }}>
                      <strong>Uncertainty Assessment:</strong> {suffEval.uncertaintyNote}
                    </p>
                  </div>
                )}

                {/* Three-Agent AI Brief & Proposal for Guide Review */}
                {latestAI && (
                  <div className="panel-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="micro-tag accent">Three-Agent AI Brief</span>
                        <span className="micro-tag warn">Mode: {latestAI.provider_mode}</span>
                        <span className="micro-tag">Trace: {latestAI.trace_id}</span>
                      </div>
                      <span className="micro-tag">{latestAI.review_state}</span>
                    </div>

                    <div style={{ padding: 14, background: 'var(--bg-canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
                        Generative Agent: Guide Conversation Brief ({latestAI.generativeStage?.sourceMode})
                      </div>
                      <p style={{ fontSize: 13.5, color: 'var(--text-main)' }}>
                        {latestAI.generativeStage?.guideBrief?.executiveSummary}
                      </p>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                        <strong>Uncertainty Disclosure:</strong> {latestAI.observationalStage?.overallUncertaintyNote}
                      </div>
                    </div>

                    <div className="workspace-grid-2">
                      <div>
                        <h4 style={{ fontSize: 14, marginBottom: 8 }}>Supported Observations &amp; Citations</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {latestAI.observationalStage?.observations?.map((o: any) => (
                            <div key={o.id} style={{ padding: 10, background: 'var(--bg-canvas)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                              <strong>[{o.category}] ({o.evidenceRefs?.join(', ')}):</strong> {o.statement}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 style={{ fontSize: 14, marginBottom: 8 }}>45-Minute Conversation Prompts</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {latestAI.generativeStage?.guideBrief?.discussionPrompts?.map((dp: any, idx: number) => (
                            <div key={idx} style={{ padding: 10, background: 'var(--bg-canvas)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                              <strong>{dp.topic} ({dp.linkedEvidenceRefs?.join(', ')}):</strong>
                              <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>&ldquo;{dp.questionForLearner}&rdquo;</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 6, 7 & 8: Record 45-Minute FRINS Conversation & Agreed Learning Needs */}
                <div className="panel-card">
                  <span className="micro-tag accent">Product Journey Steps 6, 7 &amp; 8</span>
                  <h3 style={{ fontSize: 18, margin: '6px 0 8px' }}>
                    Record 45-Minute FRINS Conversation &amp; Agreed Learning Needs
                  </h3>

                  {learnerDossier.guideConversations?.length > 0 && (
                    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {learnerDossier.guideConversations.map((c: any) => (
                        <div key={c.id} style={{ padding: 12, background: 'var(--bg-canvas)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                          <strong>Conducted ({c.duration_minutes} mins) on {new Date(c.conducted_at).toLocaleDateString()}:</strong>{' '}
                          {c.conversation_summary}
                          <div style={{ marginTop: 4, color: 'var(--accent)', fontWeight: 600 }}>
                            Agreed Learning Needs: {c.agreedLearningNeeds?.join(' · ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleRecordConversation} style={{ background: 'var(--bg-canvas)', padding: 14, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <div className="form-group">
                      <label className="form-label">45-Minute Conversation Notes &amp; Context Behind Responses</label>
                      <textarea
                        className="form-textarea"
                        placeholder="Summarise what emerged in the human conversation with the learner..."
                        value={convSummary}
                        onChange={(e) => setConvSummary(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Agreed Learning Needs (semicolon-separated)</label>
                      <input
                        className="form-input"
                        value={convNeeds}
                        onChange={(e) => setConvNeeds(e.target.value)}
                        required
                      />
                    </div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
                      <input
                        type="checkbox"
                        checked={convDraftPDP}
                        onChange={(e) => setConvDraftPDP(e.target.checked)}
                      />
                      <span>Also generate a new candidate PDP revision draft (<code>PENDING_GUIDE_REVIEW</code>) from these agreed needs</span>
                    </label>
                    <button type="submit" className="btn btn-secondary btn-sm">
                      Save Conversation Notes &amp; Agreed Needs
                    </button>
                  </form>
                </div>

                {/* Consequential Action 1: PDP Version Governance (Approve, Edit & Approve, Request Changes, Reject) */}
                <div className="panel-card" style={{ border: '1.5px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span className="micro-tag accent">Consequential Governance Gate 1 (Step 9 &amp; 10)</span>
                      <h3 style={{ fontSize: 19, marginTop: 4 }}>PDP Version Review &amp; Approval Workflow</h3>
                    </div>
                    <span className="micro-tag warn">Prior Approved PDP Remains Active Until Explicit Approval</span>
                  </div>

                  {/* All PDP Versions for this Learner */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                    {learnerDossier.pdpVersions?.map((p: any) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setDecisionPDPId(p.id);
                          setEditedTitle(p.title);
                          setEditedSummary(p.summary);
                          setEditedRoutine(p.routine_schedule);
                        }}
                        style={{
                          padding: 14,
                          borderRadius: 'var(--radius-md)',
                          border: decisionPDPId === p.id ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                          background: p.status === 'ACTIVE_APPROVED' ? 'var(--success-bg)' : 'var(--bg-canvas)',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <strong>v{p.version_number}.0, {p.title}</strong>
                          <span
                            className={`micro-tag ${
                              p.status === 'ACTIVE_APPROVED'
                                ? 'success'
                                : p.status === 'PENDING_GUIDE_REVIEW'
                                  ? 'warn'
                                  : 'danger'
                            }`}
                            style={{ fontSize: 10 }}
                          >
                            {p.status}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, marginTop: 4 }}>{p.summary}</p>
                        {p.review_reason && (
                          <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                            Last Governance Decision ({p.review_decision}): {p.review_reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handlePDPDecisionSubmit} style={{ background: 'var(--bg-canvas)', padding: 18, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div className="workspace-grid-2" style={{ gap: 12 }}>
                      <div className="form-group">
                        <label className="form-label">Select Target PDP Version</label>
                        <select
                          className="form-select"
                          value={decisionPDPId}
                          onChange={(e) => setDecisionPDPId(e.target.value)}
                        >
                          {learnerDossier.pdpVersions?.map((p: any) => (
                            <option key={p.id} value={p.id}>
                              v{p.version_number}.0, {p.title} [{p.status}]
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Guide Governance Decision</label>
                        <select
                          className="form-select"
                          value={decisionAction}
                          onChange={(e) => setDecisionAction(e.target.value as any)}
                        >
                          <option value="APPROVE">APPROVE (Activate this PDP &amp; supersede prior version)</option>
                          <option value="EDIT_AND_APPROVE">EDIT_AND_APPROVE (Modify draft &amp; activate immediately)</option>
                          <option value="REQUEST_CHANGES">REQUEST_CHANGES (Keep prior approved PDP active)</option>
                          <option value="REJECT">REJECT (Reject draft; keep prior approved PDP active)</option>
                        </select>
                      </div>
                    </div>

                    {decisionAction === 'EDIT_AND_APPROVE' && (
                      <div style={{ marginBottom: 12 }}>
                        <div className="form-group">
                          <label className="form-label">Edited PDP Title</label>
                          <input
                            className="form-input"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Edited PDP Summary</label>
                          <textarea
                            className="form-textarea"
                            value={editedSummary}
                            onChange={(e) => setEditedSummary(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Edited Routine Cadence</label>
                          <input
                            className="form-input"
                            value={editedRoutine}
                            onChange={(e) => setEditedRoutine(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label className="form-label">Mandatory Audit Reason for Decision</label>
                      <input
                        className="form-input"
                        placeholder="e.g. Reviewed with learner in 45-min call; agreed on 2-loss cool-down rule and pre-market log."
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        required
                      />
                    </div>

                    <button type="submit" className="btn btn-primary">
                      Execute &amp; Audit PDP Decision ({decisionAction})
                    </button>
                  </form>
                </div>

                {/* Consequential Action 2: Record Formal Assessment & Competency Level Progression */}
                <div className="workspace-grid-2">
                  <div className="panel-card">
                    <span className="micro-tag accent">HIGH_FORMAL Evidence Source</span>
                    <h3 style={{ fontSize: 17, margin: '4px 0 8px' }}>Record Formal Guide Assessment</h3>
                    <form onSubmit={handleRecordFormalAssessment}>
                      <div className="form-group">
                        <label className="form-label">Competency</label>
                        <select className="form-select" value={assCompetency} onChange={(e) => setAssCompetency(e.target.value)}>
                          <option value="COMP-PROC-01">COMP-PROC-01 · Pre-Decision Process</option>
                          <option value="COMP-RISK-02">COMP-RISK-02 · Downside Calibration</option>
                          <option value="COMP-EXEC-03">COMP-EXEC-03 · In-Flight Composure</option>
                          <option value="COMP-REV-04">COMP-REV-04 · Process vs Outcome Review</option>
                          <option value="COMP-ADAPT-05">COMP-ADAPT-05 · Deliberate Restraint</option>
                        </select>
                      </div>
                      <div className="workspace-grid-2" style={{ gap: 8 }}>
                        <div className="form-group">
                          <label className="form-label">Demonstrated Level</label>
                          <select className="form-select" value={assLevel} onChange={(e) => setAssLevel(e.target.value)}>
                            <option value="L1">L1</option>
                            <option value="L2">L2</option>
                            <option value="L3">L3</option>
                            <option value="L4">L4</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Evidence Status</label>
                          <select className="form-select" value={assStatus} onChange={(e) => setAssStatus(e.target.value)}>
                            <option value="SUFFICIENT">SUFFICIENT</option>
                            <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
                            <option value="CONFLICTING">CONFLICTING</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Evaluator Findings</label>
                        <textarea
                          className="form-textarea"
                          placeholder="Document formal scenario evaluation findings..."
                          value={assFindings}
                          onChange={(e) => setAssFindings(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-secondary btn-sm">
                        + Log Formal Assessment (HIGH_FORMAL)
                      </button>
                    </form>
                  </div>

                  <div className="panel-card">
                    <span className="micro-tag accent">Consequential Governance Gate 2</span>
                    <h3 style={{ fontSize: 17, margin: '4px 0 8px' }}>
                      Approve Level Progression (Current: {learnerDossier.profile?.approved_level})
                    </h3>
                    <form onSubmit={handleLevelDecisionSubmit}>
                      <div className="workspace-grid-2" style={{ gap: 8 }}>
                        <div className="form-group">
                          <label className="form-label">Target Level</label>
                          <select
                            className="form-select"
                            value={targetLevel}
                            onChange={(e) => setTargetLevel(e.target.value as any)}
                          >
                            <option value="L1">L1 · Foundational</option>
                            <option value="L2">L2 · Guided</option>
                            <option value="L3">L3 · Independent</option>
                            <option value="L4">L4 · Adaptive</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Outcome</label>
                          <select
                            className="form-select"
                            value={levelDecisionStatus}
                            onChange={(e) => setLevelDecisionStatus(e.target.value as any)}
                          >
                            <option value="APPROVED">APPROVED</option>
                            <option value="CHANGES_REQUESTED">CHANGES_REQUESTED</option>
                            <option value="REJECTED">REJECTED</option>
                          </select>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Evidence-Grounded Rationale</label>
                        <textarea
                          className="form-textarea"
                          placeholder="Cite practice artefacts and formal scenario assessments supporting this level decision..."
                          value={levelReason}
                          onChange={(e) => setLevelReason(e.target.value)}
                          required
                        />
                      </div>

                      <button type="submit" className="btn btn-dark btn-sm">
                        Record Audited Level Progression Decision
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
