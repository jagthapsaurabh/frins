import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Pager } from '../../components/Pager';
import {
  FilterSelect,
  PageHead,
  SearchBox,
  TableShell,
  Toolbar
} from '../../components/console/ConsoleUI';

interface CourseRow {
  id: string;
  title: string;
  track: string;
  level: string;
  description: string;
  duration_hours: number | null;
  derived_hours: number | null;
  price: number;
  is_active: number;
  step_count: number;
  learner_count: number;
  revenue: number;
}

const TRACK_LABEL: Record<string, string> = {
  student_concepts: 'Student concepts',
  strategy_learner: 'Strategy learner',
  trader: 'Trader',
  investor: 'Investor',
  both: 'All-round'
};

export const formatDuration = (hours: number | null | undefined): string => {
  if (!hours || hours <= 0) return 'Not set';
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours === 0) return `${minutes} min`;
  if (minutes === 0) return `${wholeHours} hr`;
  return `${wholeHours} hr ${minutes} min`;
};

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

/**
 * The course list. Same shape as the learner list: title, a quick count, filters
 * and a table. Everything else lives on the course page.
 */
export const CoursesDirectory: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [price, setPrice] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [banner, setBanner] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<CourseRow | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/courses');
      if (!res.ok) {
        setError('Could not load the courses.');
        return;
      }
      const json = await res.json();
      setRows(json.rows || []);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesText =
        !term || `${row.title} ${row.description} ${row.level} ${TRACK_LABEL[row.track] || row.track}`.toLowerCase().includes(term);
      const matchesPrice =
        price === 'ALL' || (price === 'FREE' ? Number(row.price) === 0 : Number(row.price) > 0);
      const matchesStatus =
        status === 'ALL' || (status === 'ACTIVE' ? Number(row.is_active) === 1 : Number(row.is_active) === 0);
      return matchesText && matchesPrice && matchesStatus;
    });
  }, [rows, q, price, status]);

  const activeCount = rows.filter((row) => Number(row.is_active) === 1).length;
  const paidCount = rows.filter((row) => Number(row.price) > 0).length;
  const learnerTotal = rows.reduce((sum, row) => sum + Number(row.learner_count || 0), 0);

  const toggleActive = async () => {
    if (!toggleTarget) return;
    setToggleBusy(true);
    const next = Number(toggleTarget.is_active) === 1 ? false : true;
    const res = await authFetch(`/api/admin/courses/${toggleTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: next })
    });
    const json = await res.json();
    setToggleBusy(false);
    setToggleTarget(null);
    if (!res.ok || !json.success) {
      setBanner(json.error || 'Could not change the course status.');
      return;
    }
    setBanner(next ? `"${toggleTarget.title}" is active again.` : `"${toggleTarget.title}" is now inactive.`);
    load();
  };

  return (
    <div>
      <PageHead
        title="Courses"
        meta={rows.length > 0 ? `${rows.length} ${rows.length === 1 ? 'course' : 'courses'}` : undefined}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/courses/new')}>
            <Plus size={14} /> Add course
          </button>
        }
      />

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search courses" />
        <FilterSelect
          label="Filter by price"
          value={price}
          onChange={setPrice}
          options={[
            { value: 'ALL', label: 'Paid and free' },
            { value: 'PAID', label: 'Paid only' },
            { value: 'FREE', label: 'Free only' }
          ]}
        />
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'Active and inactive' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' }
          ]}
        />
      </Toolbar>

      <TableShell
        loading={loading}
        isEmpty={!loading && filtered.length === 0}
        empty="No course matches these filters."
        columns={[
          { label: 'Course' },
          { label: 'Level', width: 90 },
          { label: 'Duration', width: 110 },
          { label: 'Price', width: 90 },
          { label: 'Steps', width: 70, align: 'right' },
          { label: 'Learners', width: 90, align: 'right' },
          { label: 'Status', width: 110 },
          { label: '', width: 32 }
        ]}
      >
        {filtered.map((row) => (
          <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/courses/${row.id}`)}>
            <td data-label="Course">
              <span className="row-title">{row.title}</span>
              <span className="row-sub">
                {TRACK_LABEL[row.track] || row.track}
                {row.revenue > 0 ? ` · ${money(row.revenue)} collected` : ''}
              </span>
            </td>
            <td data-label="Level" style={{ whiteSpace: 'nowrap' }}>
              {row.level}
            </td>
            <td data-label="Duration" className="row-sub" style={{ whiteSpace: 'nowrap' }}>
              {formatDuration(row.duration_hours ?? row.derived_hours)}
            </td>
            <td data-label="Price">{Number(row.price) > 0 ? money(row.price) : 'Free'}</td>
            <td data-label="Steps" className="num">
              {row.step_count}
            </td>
            <td data-label="Learners" className="num">
              {row.learner_count}
            </td>
            <td data-label="Status">
              <button
                type="button"
                className={`status-pill ${Number(row.is_active) === 1 ? 'approved' : 'danger'}`}
                style={{ cursor: 'pointer' }}
                aria-pressed={Number(row.is_active) === 1}
                aria-label={`${Number(row.is_active) === 1 ? 'Deactivate' : 'Activate'} ${row.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setToggleTarget(row);
                }}
              >
                {Number(row.is_active) === 1 ? 'Active' : 'Inactive'}
              </button>
            </td>
            <td>
              <ChevronRight size={14} color="#98A2B3" />
            </td>
          </tr>
        ))}
      </TableShell>

      <Pager page={1} pages={1} total={filtered.length} limit={Math.max(filtered.length, 1)} onChange={() => {}} noun="courses" />

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget && Number(toggleTarget.is_active) === 1 ? 'Deactivate this course?' : 'Activate this course?'}
        message={
          toggleTarget && Number(toggleTarget.is_active) === 1 ? (
            <>
              <strong>{toggleTarget.title}</strong> will stop showing for new assignments. Learners already on it
              keep their access and their progress.
            </>
          ) : (
            <>
              <strong>{toggleTarget?.title}</strong> will be assignable again.
            </>
          )
        }
        confirmLabel={toggleTarget && Number(toggleTarget.is_active) === 1 ? 'Deactivate' : 'Activate'}
        variant={toggleTarget && Number(toggleTarget.is_active) === 1 ? 'danger' : 'primary'}
        busy={toggleBusy}
        onConfirm={toggleActive}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
};
