import React, { useState } from 'react';
import { ArrowRight, BadgeCheck, ClipboardList, FileText, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { PageHead, TableShell } from '../../components/console/ConsoleUI';
import { formatDate, timeAgo } from '../../utils/dates';

/**
 * Where the learner stands: their level, their plan, and the notes they have
 * written along the way.
 */
export const LearnerProgress: React.FC<{ data: any; onReload: () => void }> = ({ data, onReload }) => {
  const { authFetch } = useAuth();
  const profile = data?.profile;
  const plan = data?.activeApprovedPDP;
  const pending = data?.pendingDraftPDP;
  const tasks: any[] = data?.tasks || [];
  const reflections: any[] = data?.reflections || [];
  const evidence: any[] = data?.evidenceItems || [];

  const reviewed = tasks.filter((task) => ['REVIEWED', 'APPROVED'].includes(task.status)).length;
  const pct = tasks.length === 0 ? 0 : Math.round((reviewed / tasks.length) * 100);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) return;
    setBusy(true);
    setError(null);
    const res = await authFetch('/api/learner/reflections', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim() || 'Reflection',
        competencyCode: 'COMP-EXEC-03',
        reflectionNotes: notes.trim(),
        marketContext: 'Self logged',
        decisionTaken: 'Logged from the learner panel',
        processAdherence: 4
      })
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || 'Could not save this note.');
      return;
    }
    setTitle('');
    setNotes('');
    setBanner('Saved. Your mentor can read it.');
    onReload();
  };

  return (
    <div>
      <PageHead
        title="Progress"
        meta={`Level ${profile?.approved_level || 1} · ${pct}% of tasks reviewed`}
      />

      <div className="stat-strip">
        <div className="stat">
          <span className="stat-icon"><ClipboardList size={14} /></span>
          <div>
            <strong>{reviewed}/{tasks.length}</strong>
            <span>tasks reviewed</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><FileText size={14} /></span>
          <div>
            <strong>{reflections.length}</strong>
            <span>notes logged</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><BadgeCheck size={14} /></span>
          <div>
            <strong>{evidence.length}</strong>
            <span>pieces of evidence</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><TrendingUp size={14} /></span>
          <div>
            <strong>{pct}%</strong>
            <span>task progress</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Your plan</h2>
                <p>{plan ? 'Approved by your mentor.' : 'Not approved yet.'}</p>
              </div>
            </div>
            {plan ? (
              <>
                <h3 className="detail-title">{plan.title}</h3>
                <p className="prose-block">{plan.summary}</p>
                <div className="fact-list" style={{ marginTop: 12 }}>
                  <div className="fact">
                    <span>Routine</span>
                    <strong>{plan.routine_schedule || 'Set by your mentor'}</strong>
                  </div>
                  <div className="fact">
                    <span>Level</span>
                    <strong>{profile?.approved_level || 1}</strong>
                  </div>
                  <div className="fact">
                    <span>Approved</span>
                    <strong>{plan.approved_at ? formatDate(plan.approved_at) : 'Recently'}</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="section-note">Your mentor is writing your plan. It shows here once approved.</p>
            )}
            {pending && (
              <p className="section-note" style={{ marginTop: 12 }}>
                A newer plan is with your mentor for approval. This one stays active until then.
              </p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Write a note</h2>
              <span className="section-note">Your mentor reads these before your next call.</span>
            </div>
            <form onSubmit={save}>
              <div className="form-group">
                <label className="form-label" htmlFor="noteTitle">Title</label>
                <input
                  id="noteTitle"
                  className="form-input"
                  placeholder="Post-session check"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="noteBody">What did you notice?</label>
                <textarea
                  id="noteBody"
                  className="form-textarea"
                  rows={5}
                  placeholder="What you did, what worked, what you would change next time."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  required
                />
              </div>
              {error && <p className="form-error">{error}</p>}
              {banner && <p className="form-hint">{banner}</p>}
              <button type="submit" className="btn btn-primary" disabled={busy || !notes.trim()}>
                {busy ? 'Saving' : 'Save note'}
              </button>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Past notes</h2>
              <span className="section-note">{reflections.length}</span>
            </div>
            {reflections.length === 0 ? (
              <p className="section-note">Nothing yet. The box on the left is a start.</p>
            ) : (
              <div className="list-stack">
                {reflections.slice(0, 8).map((note) => (
                  <div key={note.id} className="note-row">
                    <strong>{note.title}</strong>
                    <span>{timeAgo(note.created_at)}</span>
                    <p>{note.reflection_notes}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <PageHead title="Evidence" />
      <TableShell
        isEmpty={evidence.length === 0}
        empty="Evidence builds up as you send tasks and your mentor reviews them."
        columns={[
          { label: 'Item' },
          { label: 'Type', width: 170 },
          { label: 'Status', width: 150 },
          { label: 'Added', width: 130 }
        ]}
      >
        {evidence.slice(0, 20).map((item) => (
          <tr key={item.id}>
            <td data-label="Item">
              <span className="row-title">{item.title}</span>
              <span className="row-sub">{item.summary}</span>
            </td>
            <td data-label="Type" className="row-sub">{String(item.source_type || '').replace(/_/g, ' ').toLowerCase()}</td>
            <td data-label="Status">
              <span className="status-pill neutral">
                {String(item.verification_status || '').replace(/_/g, ' ').toLowerCase()}
              </span>
            </td>
            <td data-label="Added" style={{ whiteSpace: 'nowrap' }}>{formatDate(item.created_at)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
};
