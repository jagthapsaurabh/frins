import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Flag,
  UserPlus
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar
} from '../../components/console/ConsoleUI';
import { formatDateTime, timeAgo } from '../../utils/dates';

const REVIEW_LABEL: Record<string, string> = {
  NEW: 'To review',
  REVIEWED: 'Reviewed',
  FOLLOW_UP: 'Follow up'
};

const REVIEW_TONE: Record<string, string> = {
  NEW: 'warn',
  REVIEWED: 'approved',
  FOLLOW_UP: 'info'
};

const trackLabel = (row: any) => String(row.custom_track || row.track || '—').replace(/_/g, ' ');

/**
 * What people said when they worked through Discovery.
 *
 * Every submission lands here with the answers, the readiness readout and a
 * review state, so the team can read it, mark it and turn it into a learner.
 */
// The engine writes strengths and gaps as "Domain: what we saw". Repeating the
// domain on every line makes the panel noisy, so the domain is only printed when
// it changes, and exact duplicates are dropped.
function ReadoutList({ lines }: { lines: string[] }) {
  const seen = new Set<string>();
  const rows: { head: string; body: string; showHead: boolean }[] = [];
  let lastHead = '';
  for (const raw of lines || []) {
    const line = String(raw || '').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    const cut = line.indexOf(': ');
    const head = cut > 0 && cut < 60 ? line.slice(0, cut) : '';
    const body = head ? line.slice(cut + 2) : line;
    rows.push({ head, body, showHead: head !== lastHead });
    if (head) lastHead = head;
  }
  return (
    <ul className="readout-list">
      {rows.map((row, index) => (
        <li key={index}>
          {row.showHead && row.head ? <span className="readout-domain">{row.head}</span> : null}
          {row.body}
        </li>
      ))}
    </ul>
  );
}

export const DiscoveryResultsPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const list = usePagedList<any>(authFetch, '/api/admin/discovery-sessions', {
    q: query,
    status,
    page,
    limit: 20
  });

  const toReview = list.rows.filter((row) => !row.review_state || row.review_state === 'NEW').length;

  return (
    <div>
      <PageHead
        title="Discovery results"
        meta={
          list.total > 0
            ? `${list.total} ${list.total === 1 ? 'submission' : 'submissions'}${toReview ? ` · ${toReview} to review` : ''}`
            : undefined
        }
        actions={
          <Link className="btn btn-secondary" to="/admin/discovery/questions">
            <ClipboardList size={14} /> Question bank
          </Link>
        }
      />

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" />
        <FilterSelect
          label="Filter by review state"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Every result' },
            { value: 'NEW', label: 'To review' },
            { value: 'REVIEWED', label: 'Reviewed' },
            { value: 'FOLLOW_UP', label: 'Follow up' },
            { value: 'COMPLETED', label: 'Finished Discovery' },
            { value: 'IN_PROGRESS', label: 'Not finished' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty={
          query || status !== 'ALL'
            ? 'No submission matches these filters.'
            : 'No Discovery submission yet. They appear here the moment someone starts.'
        }
        columns={[
          { label: 'Candidate' },
          { label: 'Track', width: 170 },
          { label: 'Answers', width: 110 },
          { label: 'Readiness', width: 150 },
          { label: 'Review', width: 120 },
          { label: 'Updated', width: 130 },
          { label: '', width: 32 }
        ]}
      >
        {list.rows.map((row) => {
          const result = row.candidateResult || {};
          const state = row.review_state || 'NEW';
          return (
            <tr
              key={row.id}
              className="clickable-row"
              onClick={() => navigate(`/admin/discovery/results/${row.id}`)}
            >
              <td data-label="Candidate">
                <span className="row-title">{row.participant_name}</span>
                <span className="row-sub">{row.participant_email}</span>
              </td>
              <td data-label="Track" className="row-sub" style={{ textTransform: 'capitalize' }}>
                {trackLabel(row)}
              </td>
              <td data-label="Answers">
                <span className="row-title">
                  {row.answeredCount || 0}
                  {row.totalQuestions ? ` of ${row.totalQuestions}` : ''}
                </span>
                <span className="row-sub">
                  {row.totalQuestions
                    ? `${Math.min(100, Math.round(((row.answeredCount || 0) / row.totalQuestions) * 100))}% complete`
                    : `${row.completeness_pct || 0}% complete`}
                </span>
              </td>
              <td data-label="Readiness">
                <span className="row-title">{result.overallReadinessScore ?? '—'}</span>
                <span className="row-sub">{result.readinessLabel || 'Not scored yet'}</span>
              </td>
              <td data-label="Review">
                <span className={`status-pill ${REVIEW_TONE[state] || ''}`}>{REVIEW_LABEL[state] || state}</span>
              </td>
              <td data-label="Updated" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                {row.updated_at ? timeAgo(row.updated_at) : '—'}
              </td>
              <td>
                <ChevronRight size={14} color="#98A2B3" />
              </td>
            </tr>
          );
        })}
      </TableShell>

      <Pager
        page={list.page}
        pages={list.pages}
        total={list.total}
        limit={20}
        onChange={setPage}
        noun="submissions"
      />
    </div>
  );
};

/**
 * One Discovery submission: every answer, the readout the team gets from it,
 * and the two things they do next, review it or make the person a learner.
 */
export const DiscoveryResultPage: React.FC = () => {
  const { sessionId = '' } = useParams();
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/admin/discovery-sessions/${sessionId}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not open this submission.');
      setLoading(false);
      return;
    }
    setSession(json.session);
    setNote(json.session.review_note || '');
    setError(null);
    setLoading(false);
  }, [authFetch, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (state: 'REVIEWED' | 'FOLLOW_UP') => {
    setBusy(true);
    setError(null);
    const res = await authFetch(`/api/admin/discovery-sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewState: state, reviewNote: note })
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not save that.');
      return;
    }
    setBanner(state === 'REVIEWED' ? 'Marked reviewed.' : 'Flagged for follow up.');
    load();
  };

  const createLearner = async () => {
    setBusy(true);
    setError(null);
    const res = await authFetch(`/api/admin/discovery-sessions/${sessionId}/create-learner`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not create the learner.');
      load();
      return;
    }
    setNewPassword(json.temporaryPassword);
    setBanner('Learner account created from this Discovery.');
    load();
  };

  if (loading && !session) return <p className="section-note">Loading the submission.</p>;
  if (!session) return <div className="governance-alert danger">{error || 'Submission not found.'}</div>;

  const result = session.candidateResult || {};
  const answers: any[] = session.answers || [];
  const contradictions: any[] = session.contradictions || [];
  const byDomain = answers.reduce<Record<string, any[]>>((map, answer) => {
    const key = answer.domain || 'General';
    map[key] = map[key] || [];
    map[key].push(answer);
    return map;
  }, {});
  const state = session.review_state || 'NEW';
  const learnerId = session.converted_user_id || session.existingUser?.id || null;

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate('/admin/discovery')}>
        <ArrowLeft size={14} /> Discovery results
      </button>

      <PageHead
        title={session.participant_name}
        meta={`${session.participant_email} · ${trackLabel(session)} · ${formatDateTime(session.updated_at)}`}
        actions={
          learnerId ? (
            <Link className="btn btn-primary" to={`/admin/learners/${learnerId}`}>
              Open learner file
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" onClick={createLearner} disabled={busy}>
              <UserPlus size={14} /> Create learner account
            </button>
          )
        }
      />

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      {newPassword && (
        <div className="governance-alert success">
          They sign in with <strong>{session.participant_email}</strong> and this password:{' '}
          <strong>{newPassword}</strong>. Show it once, then ask them to change it.
        </div>
      )}

      <div className="fact-list facts-six" style={{ marginBottom: 14 }}>
        <div className="fact">
          <span>Answers</span>
          <strong>
            {session.answeredCount || 0}
            {result.totalConfiguredQuestions ? ` of ${result.totalConfiguredQuestions}` : ''} ·{' '}
            {Math.min(100, Math.round(((session.answeredCount || 0) / Math.max(1, result.totalConfiguredQuestions || 1)) * 100))}%
          </strong>
        </div>
        <div className="fact">
          <span>Readiness</span>
          <strong>
            {result.overallReadinessScore ?? '—'}
            {result.readinessLabel ? ` · ${result.readinessLabel}` : ''}
          </strong>
        </div>
        <div className="fact">
          <span>Suggested level</span>
          <strong>{result.recommendedLevel || '—'}</strong>
        </div>
        <div className="fact">
          <span>Discovery status</span>
          <strong>{session.status === 'COMPLETED' ? 'Finished' : 'Not finished'}</strong>
        </div>
        <div className="fact">
          <span>Review</span>
          <strong>{REVIEW_LABEL[state] || state}</strong>
        </div>
        <div className="fact">
          <span>Started</span>
          <strong>{formatDateTime(session.started_at)}</strong>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>What their answers say</h2>
              <span className="section-note">Generated from their own answers</span>
            </div>
            <p className="prose-block">{result.headline || 'Not enough answers to read yet.'}</p>

            {Array.isArray(result.pillars) && result.pillars.length > 0 && (
              <div className="pillar-list">
                {result.pillars.map((pillar: any) => (
                  <div key={pillar.domain} className="pillar">
                    <div className="pillar-head">
                      <span>{pillar.title}</span>
                      <strong>{pillar.scorePct}%</strong>
                    </div>
                    <div className="meter">
                      <span style={{ width: `${pillar.scorePct}%` }} />
                    </div>
                    <small>{String(pillar.status || '').replace(/_/g, ' ').toLowerCase()}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="readout-grid">
              <div>
                <h3 className="readout-title">Working well</h3>
                <ReadoutList lines={result.strengths || []} />
              </div>
              <div>
                <h3 className="readout-title">Build on this</h3>
                <ReadoutList lines={result.focusAreasForTeam || []} />
              </div>
            </div>

            {contradictions.length > 0 && (
              <div className="contradictions">
                <h3 className="readout-title">Answers that disagree</h3>
                {contradictions.map((item: any, index: number) => (
                  <p key={index} className="row-sub">
                    {typeof item === 'string' ? item : item.message || item.reason || JSON.stringify(item)}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Their answers</h2>
              <span className="section-note">
                {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
              </span>
            </div>

            {answers.length === 0 ? (
              <p className="section-note">They have not answered anything yet.</p>
            ) : (
              <div className="answer-groups">
                {Object.entries(byDomain).map(([domain, rows]) => (
                  <div key={domain} className="answer-group">
                    <h3 className="answer-domain">{domain}</h3>
                    {rows.map((answer) => (
                      <div key={answer.questionId} className="answer-row">
                        <p className="answer-prompt">{answer.prompt}</p>
                        <p className="answer-value">{answer.answerLabel || '—'}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Your review</h2>
              <span className="section-note">{session.reviewedBy ? session.reviewedBy.name : 'Not reviewed'}</span>
            </div>
            <p className="section-note" style={{ marginBottom: 10 }}>
              A note is for the team. The candidate never sees it.
            </p>
            <textarea
              className="form-textarea"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What stands out, and what should the call cover?"
              aria-label="Review note"
            />
            <div className="review-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => review('REVIEWED')}
                disabled={busy}
              >
                <CheckCircle2 size={14} /> Mark reviewed
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => review('FOLLOW_UP')}
                disabled={busy}
              >
                <Flag size={14} /> Follow up
              </button>
            </div>
            {session.review_note && (
              <p className="section-note" style={{ marginTop: 10 }}>
                Last note: {session.review_note}
                {session.reviewed_at ? ` · ${timeAgo(session.reviewed_at)}` : ''}
              </p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Next step</h2>
            </div>
            {learnerId ? (
              <>
                <p className="section-note" style={{ marginBottom: 10 }}>
                  This person already has a learner account.
                </p>
                <Link className="btn btn-primary btn-sm" to={`/admin/learners/${learnerId}`}>
                  Open the learner file
                </Link>
              </>
            ) : (
              <>
                <p className="section-note" style={{ marginBottom: 10 }}>
                  No account yet. Creating one uses the name, email and track from this Discovery.
                </p>
                <button type="button" className="btn btn-primary btn-sm" onClick={createLearner} disabled={busy}>
                  <UserPlus size={14} /> Create learner account
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
