import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList } from 'lucide-react';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar,
  labelFor,
  toneFor
} from '../../components/console/ConsoleUI';
import { formatDate } from '../../utils/dates';

/**
 * Everything a learner has been asked to do. The row opens the task, where the
 * brief, the upload and the mentor chat live.
 */
export const LearnerTasks: React.FC<{ tasks: any[]; courses: any[] }> = ({ tasks, courses }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [courseId, setCourseId] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, status, courseId]);

  const courseTitle = (task: any) =>
    courses.find((course) => course.course_id === task.course_id)?.course_title || 'General task';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesText =
        !term || `${task.title} ${task.instructions || ''} ${courseTitle(task)}`.toLowerCase().includes(term);
      const matchesStatus =
        status === 'ALL' ||
        (status === 'OPEN' && ['ASSIGNED', 'IN_PROGRESS'].includes(task.status)) ||
        (status === 'SUBMITTED' && task.status === 'SUBMITTED') ||
        (status === 'REVIEWED' && ['REVIEWED', 'APPROVED'].includes(task.status));
      const matchesCourse = courseId === 'ALL' || task.course_id === courseId;
      return matchesText && matchesStatus && matchesCourse;
    });
  }, [tasks, search, status, courseId, courses]);

  const openCount = tasks.filter((task) => !['REVIEWED', 'APPROVED'].includes(task.status)).length;

  return (
    <div>
      <PageHead
        title="Tasks"
        meta={tasks.length > 0 ? `${openCount} open, ${tasks.length} in total` : undefined}
      />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search your tasks" />
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Every status' },
            { value: 'OPEN', label: 'To do' },
            { value: 'SUBMITTED', label: 'With your mentor' },
            { value: 'REVIEWED', label: 'Reviewed' }
          ]}
        />
        <FilterSelect
          label="Filter by course"
          value={courseId}
          onChange={setCourseId}
          options={[
            { value: 'ALL', label: 'Every course' },
            ...courses.map((course) => ({ value: course.course_id, label: course.course_title }))
          ]}
        />
      </Toolbar>

      <TableShell
        isEmpty={filtered.length === 0}
        empty={tasks.length === 0 ? 'No task yet. Your mentor will add one.' : 'No task matches these filters.'}
        columns={[
          { label: 'Task' },
          { label: 'Course', width: 220 },
          { label: 'Due', width: 130 },
          { label: 'Status', width: 140 },
          { label: '', width: 32 }
        ]}
      >
        {filtered.map((task) => (
          <tr
            key={task.id}
            className="clickable-row"
            onClick={() => navigate(`/dashboard/tasks/${task.id}`)}
          >
            <td data-label="Task">
              <span className="row-title">{task.title}</span>
              <span className="row-sub">{task.submitted_at ? 'Sent to your mentor' : 'Not sent yet'}</span>
            </td>
            <td data-label="Course" className="row-sub">
              {courseTitle(task)}
            </td>
            <td data-label="Due" style={{ whiteSpace: 'nowrap' }}>
              {task.due_date ? formatDate(task.due_date) : 'No date'}
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

      {tasks.length === 0 && (
        <div className="empty-state" style={{ marginTop: 14 }}>
          <ClipboardList size={18} />
          <strong>Nothing assigned</strong>
          <span>New work from your mentor shows up here.</span>
        </div>
      )}
    </div>
  );
};
