import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
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
import { formatDate } from '../../utils/dates';

const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

/**
 * How far every learner has got. One row each, same order of columns as the
 * rest of the console, and the row opens the full learner file.
 */
export const LearnerProgress: React.FC = () => {
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

  const list = usePagedList<any>(authFetch, '/api/admin/learners', { q: query, status, page, limit: 20 });

  return (
    <div>
      <PageHead
        title="Learner progress"
        meta={list.total > 0 ? `${list.total} learners` : undefined}
      />

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search learner by name or email" />
        <FilterSelect
          label="Filter by account status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Every account' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Paused' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty="No learner matches this search."
        columns={[
          { label: 'Learner' },
          { label: 'Courses', width: 90 },
          { label: 'Tasks', width: 80 },
          { label: 'Sent', width: 90 },
          { label: 'Reviewed', width: 90 },
          { label: 'Completion', width: 180 },
          { label: 'Last sent', width: 130 },
          { label: '', width: 32 }
        ]}
      >
        {list.rows.map((row) => {
          const done = pct(row.reviewed_count, row.task_count);
          return (
            <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/learners/${row.id}`)}>
              <td data-label="Learner">
                <span className="row-title">{row.name}</span>
                <span className="row-sub">{row.email}</span>
              </td>
              <td data-label="Courses" className="num">
                {row.course_count}
              </td>
              <td data-label="Tasks" className="num">
                {row.task_count}
              </td>
              <td data-label="Sent" className="num">
                {row.submitted_count}
              </td>
              <td data-label="Reviewed" className="num">
                {row.reviewed_count}
              </td>
              <td data-label="Completion">
                <div className="meter">
                  <span style={{ width: `${done}%` }} />
                </div>
                <span className="row-sub">{done}% reviewed</span>
              </td>
              <td data-label="Last sent" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                {row.last_activity ? formatDate(row.last_activity) : 'None yet'}
              </td>
              <td>
                <ChevronRight size={14} color="#98A2B3" />
              </td>
            </tr>
          );
        })}
      </TableShell>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="learners" />
    </div>
  );
};
