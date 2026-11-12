import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../../components/Pager';
import { usePagedList } from '../../hooks/usePagedList';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  StatusPill,
  TableShell,
  Toolbar,
  labelFor,
  toneFor
} from '../../components/console/ConsoleUI';
import { formatDateTime } from '../../utils/dates';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  course_title: string | null;
  assigned_at: string | null;
  due_date: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  message_count: number;
}

const short = (value?: string | null) => (value ? formatDateTime(value) : '—');

/**
 * The task list. One row per task with who it belongs to, when it was given,
 * when it came back, and where it stands. Opening a row goes to its own page.
 */
export const TasksDirectory: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [range, setRange] = useState('ALL');
  const [courseId, setCourseId] = useState('ALL');
  const [page, setPage] = useState(1);
  const [courses, setCourses] = useState<any[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, range, courseId]);

  useEffect(() => {
    authFetch('/api/admin/courses')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => setCourses(json.rows || []))
      .catch(() => setCourses([]));
  }, [authFetch]);

  const list = usePagedList<TaskRow>(authFetch, '/api/admin/tasks', {
    q: query,
    status,
    range,
    courseId,
    page,
    limit: 20
  });

  return (
    <div>
      <PageHead
        title="Tasks"
        meta={list.total > 0 ? `${list.total} ${list.total === 1 ? 'task' : 'tasks'}` : undefined}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/tasks/new')}>
            <Plus size={14} /> Give a task
          </button>
        }
      />

      {list.error && <div className="governance-alert danger">{list.error}</div>}

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search task, learner or course" />
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Every status' },
            { value: 'SUBMITTED', label: 'Waiting review' },
            { value: 'ASSIGNED', label: 'To start' },
            { value: 'REVIEWED', label: 'Reviewed' }
          ]}
        />
        <FilterSelect
          label="Filter by course"
          value={courseId}
          onChange={setCourseId}
          options={[
            { value: 'ALL', label: 'Every course' },
            ...courses.map((course) => ({ value: course.id, label: course.title }))
          ]}
        />
        <FilterSelect
          label="Filter by date"
          value={range}
          onChange={setRange}
          options={[
            { value: 'ALL', label: 'Any date' },
            { value: 'TODAY', label: 'Today' },
            { value: 'WEEK', label: 'Last 7 days' },
            { value: 'MONTH', label: 'Last 30 days' },
            { value: 'DUE', label: 'Due in 3 days' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={list.loading}
        isEmpty={!list.loading && list.rows.length === 0}
        empty="No task matches these filters."
        columns={[
          { label: 'Learner' },
          { label: 'Task' },
          { label: 'Given' },
          { label: 'Due' },
          { label: 'Submitted' },
          { label: 'Status', width: 130 },
          { label: '', width: 32 }
        ]}
      >
        {list.rows.map((row) => (
          <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/tasks/${row.id}`)}>
            <td data-label="Learner">
              <span className="row-title">{row.learner_name}</span>
              <span className="row-sub">{row.learner_email}</span>
            </td>
            <td data-label="Task">
              <span className="row-title">{row.title}</span>
              <span className="row-sub">{row.course_title || 'General task'}</span>
            </td>
            <td data-label="Given" className="row-sub" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {short(row.assigned_at)}
            </td>
            <td data-label="Due" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
              {row.due_date ? formatDateTime(row.due_date) : '—'}
            </td>
            <td data-label="Submitted" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
              {short(row.submitted_at)}
            </td>
            <td data-label="Status">
              <StatusPill status={labelFor(row.status)} tone={toneFor(row.status) as any} />
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
