import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Result {
  id: string;
  name: string;
  email: string;
  track: string | null;
  course_count: number;
  task_count: number;
}

/**
 * Jump to a learner from anywhere in the console.
 *
 * With a thousand learners, scrolling a roster is not a plan. Type a name or an
 * email, pick the person, and land on their progress page.
 */
export const LearnerSearch: React.FC = () => {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/admin/learners?q=${encodeURIComponent(q)}&limit=6`);
        const json = await res.json();
        if (!cancelled && json.success) setRows(json.rows || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, authFetch]);

  const go = (id: string) => {
    setOpen(false);
    setText('');
    navigate(`/admin/progress?learner=${id}`);
  };

  return (
    <div className="app-search" ref={wrapRef}>
      <Search size={15} />
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Find a learner"
        aria-label="Find a learner"
      />

      {open && text.trim().length >= 2 && (
        <div className="app-search-panel">
          {loading && <p className="app-search-empty">Searching...</p>}
          {!loading && rows.length === 0 && <p className="app-search-empty">No learner matches that.</p>}
          {rows.map((row) => (
            <button key={row.id} type="button" className="app-search-row" onClick={() => go(row.id)}>
              <span className="app-search-name">{row.name}</span>
              <span className="app-search-meta">
                {row.email} &middot; {row.course_count} course{row.course_count === 1 ? '' : 's'} &middot;{' '}
                {row.task_count} task{row.task_count === 1 ? '' : 's'}
              </span>
            </button>
          ))}
          {rows.length > 0 && (
            <button
              type="button"
              className="app-search-all"
              onClick={() => {
                setOpen(false);
                navigate('/admin/progress');
              }}
            >
              Open learner progress
            </button>
          )}
        </div>
      )}
    </div>
  );
};
