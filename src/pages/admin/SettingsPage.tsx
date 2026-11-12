import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import { PageHead, SearchBox, Toolbar } from '../../components/console/ConsoleUI';
import { formatDateTime } from '../../utils/dates';

const humanAction = (action: string) =>
  action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * The audit trail: who did what, in order.
 *
 * Account security is handled by the sign-in flow, so there is no password
 * form here, and the competency library has its own home in the learner record.
 */
export const SettingsPage: React.FC = () => {
  const { authFetch } = useAuth();

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

  const audit = usePagedList<any>(authFetch, '/api/admin/audit', { q: query, page, limit: 25 });

  return (
    <div>
      <PageHead
        title="Settings"
        meta={audit.total > 0 ? `${audit.total} recorded events` : undefined}
      />

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h2>Audit trail</h2>
            <p>Every action in the console, newest first. Read only.</p>
          </div>
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

        <Pager
          page={audit.page}
          pages={audit.pages}
          total={audit.total}
          limit={25}
          onChange={setPage}
          noun="events"
        />
      </section>
    </div>
  );
};
