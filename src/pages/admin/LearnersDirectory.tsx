import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedList } from '../../hooks/usePagedList';
import { Pager } from '../../components/Pager';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar
} from '../../components/console/ConsoleUI';
import { timeAgo } from '../../utils/dates';

export const TRACK_LABEL: Record<string, string> = {
  student_concepts: 'Student · concepts',
  strategy_learner: 'Strategy learner',
  trader: 'Active trader',
  investor: 'Investor',
  both: 'All-round learner'
};

/**
 * The learner roster. Same four blocks as every other tab: title, search and
 * filters, the table, then the pager.
 */
export const LearnersDirectory: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [track, setTrack] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, track]);

  const list = usePagedList<any>(authFetch, '/api/admin/learners', {
    page,
    limit: 20,
    q,
    status,
    track
  });

  return (
    <div>
      <PageHead
        title="Learners"
        meta={
          list.total > 0 ? `${list.total} ${list.total === 1 ? 'learner' : 'learners'}` : undefined
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/learners/new')}>
            <Plus size={14} /> Add learner
          </button>
        }
      />

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or phone" />
        <FilterSelect
          label="Filter by track"
          value={track}
          onChange={setTrack}
          options={[
            { value: 'ALL', label: 'Every track' },
            ...Object.entries(TRACK_LABEL).map(([value, label]) => ({ value, label }))
          ]}
        />
        <FilterSelect
          label="Filter by account status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Active and suspended' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'SUSPENDED', label: 'Suspended' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty="No learner matches this search."
        columns={[
          { label: 'Learner' },
          { label: 'Track', width: 150 },
          { label: 'Courses', width: 90 },
          { label: 'Tasks', width: 110 },
          { label: 'Last activity', width: 130 },
          { label: 'Status', width: 110 },
          { label: '', width: 32 }
        ]}
      >
        {list.rows.map((row: any) => (
          <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/learners/${row.id}`)}>
            <td data-label="Learner">
              <span className="row-title">{row.name}</span>
              <span className="row-sub">{row.email}</span>
            </td>
            <td data-label="Track">{TRACK_LABEL[row.track] || row.track}</td>
            <td data-label="Courses" className="num">
              {row.course_count}
            </td>
            <td data-label="Tasks" className="num">
              {row.reviewed_count}/{row.task_count}
            </td>
            <td data-label="Last activity" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
              {timeAgo(row.last_activity)}
            </td>
            <td data-label="Status">
              <span className={`status-pill ${row.account_status === 'ACTIVE' ? 'approved' : 'danger'}`}>
                {row.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
              </span>
            </td>
            <td>
              <ChevronRight size={14} color="#98A2B3" />
            </td>
          </tr>
        ))}
      </TableShell>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="learners" />
    </div>
  );
};
