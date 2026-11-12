import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePagedList } from '../../hooks/usePagedList';
import { Pager } from '../../components/Pager';
import { timeAgo } from '../../utils/dates';

export const TRACK_LABEL: Record<string, string> = {
  student_concepts: 'Student · concepts',
  strategy_learner: 'Strategy learner',
  trader: 'Active trader',
  investor: 'Investor',
  both: 'All-round learner'
};

/**
 * The enrolled learner list. Search, track filter, status filter and real pages,
 * so the screen behaves the same at twenty learners or a thousand.
 */
export const LearnersDirectory: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [track, setTrack] = useState('ALL');
  const [page, setPage] = useState(1);

  const list = usePagedList(authFetch, '/api/admin/learners', {
    page,
    limit: 20,
    q,
    status,
    track
  });

  const activeCount = list.rows.filter((row: any) => row.account_status === 'ACTIVE').length;

  return (
    <div>
      <header className="admin-page-head learner-directory-head">
        <div>
          <span className="admin-page-eyebrow">People</span>
          <h1>Enrolled learners</h1>
          <p>
            Everyone learning with FRINS. Search the list, open a learner to see their courses, payments and
            reviews, or add someone new.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/learners/new')}>
          <Plus size={16} /> Add learner
        </button>
      </header>

      <section className="panel-card">
        <div className="admin-mini-stats">
          <span>
            <strong>{list.total.toLocaleString()}</strong> learners
          </span>
          <span>
            <strong>{activeCount}</strong> active on this page
          </span>
          <span>
            <strong>{list.pages.toLocaleString()}</strong> {list.pages === 1 ? 'page' : 'pages'} of 20
          </span>
        </div>

        <div className="list-tools">
          <div className="list-search-wrap">
            <Search size={15} />
            <input
              className="form-input list-search"
              placeholder="Search name, email or phone"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              aria-label="Search learners"
            />
          </div>
          <select
            className="form-select list-filter"
            value={track}
            onChange={(e) => {
              setTrack(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by track"
          >
            <option value="ALL">Every track</option>
            {Object.entries(TRACK_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="form-select list-filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by account status"
          >
            <option value="ALL">Active and suspended</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>

        {list.error && <p className="admin-muted">{list.error}</p>}

        <div className="admin-table-wrap">
          <table className="data-table learner-table">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Track</th>
                <th>Courses</th>
                <th>Tasks</th>
                <th>Last activity</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row: any) => (
                <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/learners/${row.id}`)}>
                  <td>
                    <div className="learner-cell">
                      <span className="learner-avatar">
                        <UserRound size={15} />
                      </span>
                      <div>
                        <button
                          type="button"
                          className="link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/learners/${row.id}`);
                          }}
                        >
                          {row.name}
                        </button>
                        <div className="admin-muted small">{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Track">{TRACK_LABEL[row.track] || row.track}</td>
                  <td data-label="Courses">{row.course_count}</td>
                  <td data-label="Tasks">
                    {row.reviewed_count}/{row.task_count}
                    <span className="admin-muted small"> reviewed</span>
                  </td>
                  <td className="admin-muted" data-label="Last activity">{timeAgo(row.last_activity)}</td>
                  <td data-label="Status">
                    <span className={`micro-tag ${row.account_status === 'ACTIVE' ? 'success' : 'danger'}`}>
                      {row.account_status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td>
                    <ChevronRight size={16} className="row-chevron" />
                  </td>
                </tr>
              ))}
              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <p className="admin-muted" style={{ margin: 0 }}>
                      No learner matches this search. Clear the filters or add the learner.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {list.loading && <p className="admin-muted">Loading learners…</p>}

        <Pager
          page={list.page}
          pages={list.pages}
          total={list.total}
          limit={20}
          onChange={setPage}
          noun="learners"
        />
      </section>
    </div>
  );
};
