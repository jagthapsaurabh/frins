import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import {
  FilterSelect,
  InlineSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar
} from '../../components/console/ConsoleUI';
import { formatDate } from '../../utils/dates';

const LEAD_STATUSES = [
  { value: 'NEW', label: 'New' },
  { value: 'DISCOVERY_STARTED', label: 'Started Discovery' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'CLOSED', label: 'Closed' }
];

/**
 * Everyone who raised a hand from the public site. A status change saves on the
 * spot, so the list stays the only screen this job needs.
 */
export const LeadsDirectory: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const list = usePagedList<any>(authFetch, '/api/admin/leads', { q: query, status, page, limit: 20 });

  const saveStatus = async (leadId: string, next: string) => {
    setSavingId(leadId);
    setError(null);
    const res = await authFetch(`/api/admin/leads/${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next })
    });
    const json = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not save that status.');
      return;
    }
    list.reload();
  };

  return (
    <div>
      <PageHead
        title="Leads"
        meta={list.total > 0 ? `${list.total} ${list.total === 1 ? 'person' : 'people'}` : undefined}
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/discovery')}>
            Discovery answers
          </button>
        }
      />

      {error && <div className="governance-alert danger">{error}</div>}
      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or track" />
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'ALL', label: 'Every status' }, ...LEAD_STATUSES]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty="No lead matches these filters."
        columns={[
          { label: 'Name' },
          { label: 'Email' },
          { label: 'Track' },
          { label: 'Notes' },
          { label: 'Added' },
          { label: 'Status', width: 170 }
        ]}
      >
        {list.rows.map((lead) => (
          <tr key={lead.id}>
            <td data-label="Name">
              <span className="row-title">{lead.name}</span>
            </td>
            <td data-label="Email" className="row-sub">
              {lead.email}
            </td>
            <td data-label="Track">{lead.custom_track || lead.track || '—'}</td>
            <td data-label="Notes" className="row-sub" style={{ maxWidth: 300 }}>
              {lead.notes || '—'}
            </td>
            <td data-label="Added" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
              {formatDate(lead.created_at)}
            </td>
            <td data-label="Status">
              <InlineSelect
                label={`Status for ${lead.name}`}
                value={lead.status}
                disabled={savingId === lead.id}
                onChange={(next) => saveStatus(lead.id, next)}
                options={LEAD_STATUSES}
              />
            </td>
          </tr>
        ))}
      </TableShell>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="leads" />
    </div>
  );
};
