import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import { PageHead, SearchBox, TableShell, Toolbar } from '../../components/console/ConsoleUI';
import { formatDateTime } from '../../utils/dates';
import { KeyRound, ShieldCheck } from 'lucide-react';

const humanAction = (action: string) =>
  action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Account, rubric versions and the audit trail. Nothing here is a list of
 * people, so it keeps the two column shape: the things you change on the left,
 * the record you cannot change on the right.
 */
export const SettingsPage: React.FC = () => {
  const { authFetch } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [competencies, setCompetencies] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('2.0');
  const [rubricBusy, setRubricBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadCompetencies = useCallback(async () => {
    const res = await authFetch('/api/admin/competencies');
    if (!res.ok) return;
    const json = await res.json();
    setCompetencies(json.rows || []);
  }, [authFetch]);

  useEffect(() => {
    loadCompetencies();
  }, [loadCompetencies]);

  const audit = usePagedList<any>(authFetch, '/api/admin/audit', { q: query, page, limit: 25 });

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setBanner(null);
    if (next.length < 8) {
      setPasswordError('Use at least 8 characters.');
      return;
    }
    if (next !== again) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: next })
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !json.success) {
      setPasswordError(json.error || 'Could not change the password.');
      return;
    }
    setCurrent('');
    setNext('');
    setAgain('');
    setBanner('Password changed. Other devices signed out.');
  };

  const publishRubric = async (e: React.FormEvent) => {
    e.preventDefault();
    setRubricBusy(true);
    const res = await authFetch('/api/admin/competencies', {
      method: 'POST',
      body: JSON.stringify({ code, title, description, rubricVersion: version })
    });
    const json = await res.json().catch(() => ({}));
    setRubricBusy(false);
    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not publish that version.');
      return;
    }
    setBanner(`${code} is now on rubric v${version}.`);
    setCode('');
    setTitle('');
    setDescription('');
    loadCompetencies();
  };

  return (
    <div>
      <PageHead title="Settings" />

      {banner && <div className="governance-alert success">{banner}</div>}

      <div className="detail-grid settings-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <h2>
                <KeyRound size={13} /> Your password
              </h2>
              <span className="section-note">Other devices signed in as you get signed out</span>
            </div>

            <form onSubmit={changePassword}>
              <div className="form-group">
                <label className="form-label" htmlFor="currentPassword">
                  Current password
                </label>
                <input
                  id="currentPassword"
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="newPassword">
                    New password
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="againPassword">
                    New password again
                  </label>
                  <input
                    id="againPassword"
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                    required
                  />
                </div>
              </div>

              {passwordError && <p className="form-error">{passwordError}</p>}

              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Updating' : 'Update password'}
              </button>
            </form>
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>
                <ShieldCheck size={13} /> Competency rubrics
              </h2>
              <span className="section-note">Publishing records a new version</span>
            </div>

            <TableShell
              columns={[
                { label: 'Code', width: 120 },
                { label: 'Title' },
                { label: 'Rubric', width: 90 }
              ]}
              isEmpty={competencies.length === 0}
              empty="No competency loaded."
            >
              {competencies.map((item) => (
                <tr key={item.code}>
                  <td data-label="Code" className="row-sub" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {item.code}
                  </td>
                  <td data-label="Title">
                    <span className="row-title">{item.title}</span>
                    <span className="row-sub">{item.description}</span>
                  </td>
                  <td data-label="Rubric">v{item.rubric_version}</td>
                </tr>
              ))}
            </TableShell>

            <form onSubmit={publishRubric} style={{ marginTop: 14 }}>
              <div className="form-row-3">
                <div className="form-group">
                  <label className="form-label" htmlFor="rubricCode">
                    Code
                  </label>
                  <input
                    id="rubricCode"
                    className="form-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="COMP-PROC-01"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rubricTitle">
                    Title
                  </label>
                  <input
                    id="rubricTitle"
                    className="form-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rubricVersion">
                    Version
                  </label>
                  <input
                    id="rubricVersion"
                    className="form-input"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rubricDescription">
                  What it means
                </label>
                <input
                  id="rubricDescription"
                  className="form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-secondary" disabled={rubricBusy}>
                {rubricBusy ? 'Publishing' : 'Publish version'}
              </button>
            </form>
          </section>
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Audit trail</h2>
              <span className="section-note">Read only</span>
            </div>

            <Toolbar>
              <SearchBox value={search} onChange={setSearch} placeholder="Search action or record" />
            </Toolbar>

            <div className="audit-list">
              {audit.rows.map((event) => (
                <div key={event.id} className="audit-row">
                  <div>
                    <strong>{humanAction(event.action)}</strong>
                    <small>
                      {event.entity_type} · {event.entity_id}
                    </small>
                  </div>
                  <div className="audit-meta">
                    <span>{event.actor_role}</span>
                    <small>{formatDateTime(event.created_at)}</small>
                  </div>
                </div>
              ))}
              {!audit.loading && audit.rows.length === 0 && (
                <p className="section-note">Nothing recorded yet.</p>
              )}
            </div>

            <Pager page={audit.page} pages={audit.pages} total={audit.total} limit={25} onChange={setPage} noun="events" />
          </section>
        </div>
      </div>
    </div>
  );
};
