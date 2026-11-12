import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Pager } from '../components/Pager';
import { usePagedList } from '../hooks/usePagedList';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar,
  labelFor,
  toneFor
} from '../components/console/ConsoleUI';
import { formatDate, timeAgo } from '../utils/dates';

const FILTERS = [
  { value: 'SUBMITTED', label: 'Waiting for review' },
  { value: 'CHANGES_REQUESTED', label: 'Sent back' },
  { value: 'REVIEWED', label: 'Completed' },
  { value: 'ALL', label: 'Every task' }
];

/**
 * The guide's review queue.
 *
 * A learner sends work, it lands here, and the guide either marks it complete or
 * sends it back with notes. Rows open the full task, where the work and the
 * conversation live.
 */
export const GuideReviewsPage: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('SUBMITTED');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  const list = usePagedList<any>(authFetch, '/api/admin/tasks', { q, status, page, limit: 20 });

  return (
    <div>
      <PageHead
        title="Task reviews"
        meta={
          list.loading
            ? undefined
            : status === 'SUBMITTED'
              ? `${list.total} ${list.total === 1 ? 'task is' : 'tasks are'} waiting for you`
              : `${list.total} ${list.total === 1 ? 'task' : 'tasks'}`
        }
      />

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search learner or task" />
        <FilterSelect label="Filter by state" value={status} onChange={setStatus} options={FILTERS} />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty={
          status === 'SUBMITTED'
            ? 'Nothing is waiting for you. Work appears here the moment a learner sends it.'
            : 'No task matches that.'
        }
        columns={[
          { label: 'Task' },
          { label: 'Learner', width: 190 },
          { label: 'Course', width: 190 },
          { label: 'Sent', width: 140 },
          { label: 'Status', width: 140 },
          { label: '', width: 32 }
        ]}
      >
        {list.rows.map((task) => (
          <tr
            key={task.id}
            className="clickable-row"
            onClick={() => navigate(`/guide/tasks/${task.id}`)}
          >
            <td data-label="Task">
              <span className="row-title">{task.title}</span>
              <span className="row-sub">
                {task.status === 'SUBMITTED'
                  ? 'Waiting for your review'
                  : task.status === 'CHANGES_REQUESTED'
                    ? 'With the learner'
                    : task.status === 'REVIEWED' || task.status === 'APPROVED'
                      ? 'Completed'
                      : 'Not sent yet'}
              </span>
            </td>
            <td data-label="Learner">
              <span className="row-title" style={{ fontSize: 12.5 }}>{task.learner_name}</span>
              <span className="row-sub">{task.learner_email}</span>
            </td>
            <td data-label="Course" className="row-sub">
              {task.course_title || 'General task'}
            </td>
            <td data-label="Sent" style={{ whiteSpace: 'nowrap' }}>
              {task.submitted_at ? (
                <>
                  <span className="row-title" style={{ fontSize: 12.5 }}>{timeAgo(task.submitted_at)}</span>
                  <span className="row-sub">{formatDate(task.submitted_at)}</span>
                </>
              ) : (
                <span className="row-sub">Not sent</span>
              )}
            </td>
            <td data-label="Status">
              <span className={`status-pill ${toneFor(task.status)}`}>{labelFor(task.status)}</span>
            </td>
            <td>
              <ChevronRight size={14} color="#98A2B3" />
            </td>
          </tr>
        ))}
      </TableShell>

      <Pager page={list.page} pages={list.pages} total={list.total} limit={20} onChange={setPage} noun="tasks" />
    </div>
  );
};
