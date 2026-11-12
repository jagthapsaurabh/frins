import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookCallDialog } from '../components/BookCallDialog';
import { LearnerOverview } from './learner/LearnerOverview';
import { LearnerCourses } from './learner/LearnerCourses';
import { LearnerTasks } from './learner/LearnerTasks';
import { LearnerProgress } from './learner/LearnerProgress';
import { LearnerCalls } from './learner/LearnerCalls';
import { LearnerNotifications } from './learner/LearnerNotifications';

type LearnerSection = 'overview' | 'courses' | 'tasks' | 'progress' | 'calls' | 'notifications';

const SECTIONS: LearnerSection[] = ['overview', 'courses', 'tasks', 'progress', 'calls', 'notifications'];

/**
 * The learner panel. Loads the learner's data once, then shows one section at a
 * time. Every section is a small page of its own, so each stays readable on a
 * phone.
 */
export const LearnerDashboardPage: React.FC = () => {
  const { user, authFetch } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const section: LearnerSection = SECTIONS.includes(params.section as LearnerSection)
    ? (params.section as LearnerSection)
    : 'overview';
  const unknownSection = Boolean(params.section) && !SECTIONS.includes(params.section as LearnerSection);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/learner/dashboard');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load your dashboard.');
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load, user]);

  useEffect(() => {
    if (unknownSection) navigate('/dashboard', { replace: true });
  }, [unknownSection, navigate]);

  if (loading && !data) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton-block" />
        <div className="skeleton-block" style={{ height: 180 }} />
        <div className="skeleton-block" style={{ height: 220 }} />
      </div>
    );
  }

  if (!data) {
    return <div className="governance-alert danger">{error || 'Could not load your dashboard.'}</div>;
  }

  const tasks: any[] = data.tasks || [];
  const courses: any[] = data.assignedCourses || [];
  const calls: any[] = data.calls || [];

  return (
    <div>
      {banner && <div className="governance-alert success">{banner}</div>}

      {section === 'overview' && (
        <LearnerOverview
          data={data}
          myCalls={calls}
          onOpenCall={() => setCallOpen(true)}
        />
      )}

      {section === 'courses' && <LearnerCourses courses={courses} />}

      {section === 'tasks' && <LearnerTasks tasks={tasks} courses={courses} />}

      {section === 'progress' && <LearnerProgress data={data} onReload={load} />}

      {section === 'calls' && <LearnerCalls calls={calls} onReload={load} />}

      {section === 'notifications' && <LearnerNotifications />}

      <BookCallDialog
        open={callOpen}
        onClose={() => setCallOpen(false)}
        onBooked={() => {
          setCallOpen(false);
          setBanner('Call requested. It shows on your Calls page once confirmed.');
          load();
        }}
      />
    </div>
  );
};
