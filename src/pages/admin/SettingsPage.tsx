import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import { PageHead, SearchBox, TableShell, Toolbar } from '../../components/console/ConsoleUI';
import { formatDateTime } from '../../utils/dates';
import { ShieldCheck } from 'lucide-react';

const humanAction = (action: string) =>
  action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Rubric versions and the audit trail. Account security is handled by the
 * sign-in flow, so there is no password form here.
 */
export const SettingsPage: React.FC = () => {
  const { authFetch } = useAuth();

  const [competencies, setCompetencies] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('2.0');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

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

  const publishRubric = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    const res = await authFetch('/api/admin/competencies', {
      method: 'POST',
      body: JSON.stringify({ code, title, description, rubricVersion: version })
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
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
                <ShieldCheck size={13} /> Competency rubrics
              </h2>
              <span className="section-note">Publishing keeps the old version in the audit trail</span>
            </div>

            <TableShell
              columns={[
                { label: 'Code', width: 130 },
                { label: 'Title' },
                { label: 'Rubric', width: 70 }
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

            <form onSubmit={publishRubric} style={{ marginTop: 16 }}>
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
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                {busy ? 'Publishing' : 'Publish version'}
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
