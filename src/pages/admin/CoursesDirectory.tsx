import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight, Clock, Plus, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';

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
      <header className="compact-head">
        <div>
          <span className="admin-page-eyebrow">Work</span>
          <h1>Courses</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/courses/new')}>
          <Plus size={16} /> Add course
        </button>
      </header>

      {banner && <div className="governance-alert success">{banner}</div>}
      {error && <div className="governance-alert danger">{error}</div>}

      <section className="panel-card">
        <div className="admin-mini-stats">
          <span>
            <strong>{rows.length}</strong> courses
          </span>
          <span>
            <strong>{activeCount}</strong> active
          </span>
          <span>
            <strong>{paidCount}</strong> paid
          </span>
          <span>
            <strong>{learnerTotal}</strong> learners enrolled
          </span>
        </div>

        <div className="list-tools">
          <div className="list-search-wrap">
            <Search size={15} />
            <input
              className="form-input list-search"
              placeholder="Search courses"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search courses"
            />
          </div>
          <select
            className="form-select list-filter"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-label="Filter by price"
          >
            <option value="ALL">Paid and free</option>
            <option value="PAID">Paid only</option>
            <option value="FREE">Free only</option>
          </select>
          <select
            className="form-select list-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="ALL">Active and inactive</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>

        <div className="admin-table-wrap">
          <table className="data-table course-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Level</th>
                <th>Duration</th>
                <th>Price</th>
                <th>Steps</th>
                <th>Learners</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="clickable-row" onClick={() => navigate(`/admin/courses/${row.id}`)}>
                  <td>
                    <div className="course-cell">
                      <span className="course-icon">
                        <BookOpen size={15} />
                      </span>
                      <div>
                        <button
                          type="button"
                          className="link-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/courses/${row.id}`);
                          }}
                        >
                          {row.title}
                        </button>
                        <div className="admin-muted small">
                          {TRACK_LABEL[row.track] || row.track}
                          {row.revenue > 0 ? ` · ${money(row.revenue)} collected` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{row.level}</td>
                  <td>
                    <span className="inline-meta">
                      <Clock size={13} />
                      {formatDuration(row.duration_hours ?? row.derived_hours)}
                    </span>
                  </td>
                  <td>
                    {Number(row.price) > 0 ? (
                      <span className="price-tag">{money(row.price)}</span>
                    ) : (
                      <span className="price-tag free">Free</span>
                    )}
                  </td>
                  <td>{row.step_count}</td>
                  <td>{row.learner_count}</td>
                  <td>
                    <button
                      type="button"
                      className={`switch ${Number(row.is_active) === 1 ? 'on' : ''}`}
                      aria-pressed={Number(row.is_active) === 1}
                      aria-label={`${Number(row.is_active) === 1 ? 'Deactivate' : 'Activate'} ${row.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setToggleTarget(row);
                      }}
                    >
                      <span className="switch-dot" />
                      <span className="switch-label">{Number(row.is_active) === 1 ? 'Active' : 'Inactive'}</span>
                    </button>
                  </td>
                  <td>
                    <ChevronRight size={16} className="row-chevron" />
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <p className="admin-muted" style={{ margin: 0 }}>
                      {rows.length === 0
                        ? 'No course yet. Add the first one.'
                        : 'No course matches these filters.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && <p className="admin-muted">Loading courses…</p>}
      </section>

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
