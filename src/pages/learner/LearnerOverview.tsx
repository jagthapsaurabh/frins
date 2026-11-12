import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  PhoneCall,
  TrendingUp
} from 'lucide-react';
import { PageHead } from '../../components/console/ConsoleUI';
import { formatDate, timeAgo } from '../../utils/dates';

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'To do',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'With mentor',
  REVIEWED: 'Reviewed',
  APPROVED: 'Approved'
};

/**
 * The first screen a learner sees. What is next, how far they have got, and one
 * clear way to talk to their mentor.
 */
export const LearnerOverview: React.FC<{
  data: any;
  unread?: number;
  myCalls?: any[];
  onOpenCall?: () => void;
}> = ({ data, unread = 0, myCalls = [], onOpenCall }) => {
  const learner = data?.learner;
  const tasks: any[] = data?.tasks || [];
  const courses: any[] = data?.assignedCourses || [];
  const profile = data?.profile;
  const plan = data?.activeApprovedPDP;

  const openTasks = tasks.filter((task) => !['REVIEWED', 'APPROVED'].includes(task.status));
  const nextTask = openTasks[0];
  const reviewed = tasks.filter((task) => ['REVIEWED', 'APPROVED'].includes(task.status)).length;
  const stepsDone = courses.reduce((sum, course) => sum + (Number(course.steps_done) || 0), 0);
  const stepsTotal = courses.reduce((sum, course) => sum + (Number(course.step_count) || 0), 0);
  const coursePct = stepsTotal === 0 ? 0 : Math.round((stepsDone / stepsTotal) * 100);
  const nextCall = (myCalls || []).find((call) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(call.status));
  const latestFeedback = tasks.find((task) => Boolean(task.guide_feedback));
  const firstName = (learner?.name || 'there').split(' ')[0];

  return (
    <div>
      <PageHead
        title={`Hi ${firstName}`}
        meta={
          learner?.track
            ? `${learner.track} track · Level ${profile?.approved_level || 1}`
            : `Level ${profile?.approved_level || 1}`
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={onOpenCall}>
            <PhoneCall size={14} /> Book a call
          </button>
        }
      />

      <div className="stat-strip">
        <div className="stat">
          <span className="stat-icon"><ClipboardList size={14} /></span>
          <div>
            <strong>{openTasks.length}</strong>
            <span>tasks to do</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><CheckCircle2 size={14} /></span>
          <div>
            <strong>{reviewed}</strong>
            <span>reviewed</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><BookOpen size={14} /></span>
          <div>
            <strong>{coursePct}%</strong>
            <span>course done</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon"><MessageSquare size={14} /></span>
          <div>
            <strong>{unread}</strong>
            <span>new messages</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <h2>Do this next</h2>
                <p>Set by {learner?.assigned_guide_id ? 'your mentor' : 'the FRINS team'}.</p>
              </div>
              <Link to="/dashboard/tasks" className="link-button" style={{ fontSize: 12 }}>
                All tasks
              </Link>
            </div>

            {nextTask ? (
              <div className="next-task">
                <div className="next-task-top">
                  <span className="status-pill neutral">{STATUS_LABEL[nextTask.status] || nextTask.status}</span>
                  {nextTask.due_date && <span className="row-sub">Due {formatDate(nextTask.due_date)}</span>}
                </div>
                <h3>{nextTask.title}</h3>
                <p>{nextTask.instructions}</p>
                <Link className="btn btn-primary btn-sm" to={`/dashboard/tasks/${nextTask.id}`}>
                  Open task <ArrowRight size={13} />
                </Link>
              </div>
            ) : (
              <div className="empty-state">
                <CheckCircle2 size={18} />
                <strong>Nothing waiting</strong>
                <span>You are up to date. New work from your mentor appears here.</span>
              </div>
            )}

            {openTasks.length > 1 && (
              <ul className="quiet-list">
                {openTasks.slice(1, 4).map((task) => (
                  <li key={task.id}>
                    <Link to={`/dashboard/tasks/${task.id}`}>{task.title}</Link>
                    <span>{task.due_date ? formatDate(task.due_date) : 'No date'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {latestFeedback && (
            <section className="panel-card">
              <div className="panel-head">
                <h2>Mentor feedback</h2>
                <span className="section-note">{timeAgo(latestFeedback.reviewed_at)}</span>
              </div>
              <div className="feedback-note">
                <MessageSquare size={15} />
                <div>
                  <strong>{latestFeedback.title}</strong>
                  <p>{latestFeedback.guide_feedback}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="detail-side">
          <section className="panel-card">
            <div className="panel-head">
              <h2>Your courses</h2>
              <Link to="/dashboard/courses" className="link-button" style={{ fontSize: 12 }}>
                All
              </Link>
            </div>
            {courses.length === 0 ? (
              <p className="section-note">No course on your plan yet.</p>
            ) : (
              <div className="list-stack">
                {courses.slice(0, 3).map((course) => {
                  const total = Number(course.step_count) || 0;
                  const done = Number(course.steps_done) || 0;
                  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
                  return (
                    <Link key={course.id} className="list-row" to={`/dashboard/courses/${course.course_id}`}>
                      <span className="kpi-icon"><BookOpen size={14} /></span>
                      <div className="list-row-main">
                        <span className="list-row-title">{course.course_title}</span>
                        <div className="meter" style={{ marginTop: 6, width: 120 }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="row-sub">{pct}%</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Your plan</h2>
            </div>
            {plan ? (
              <>
                <p className="prose-block" style={{ marginBottom: 10 }}>{plan.title}</p>
                <p className="row-sub">{plan.routine_schedule || 'Routine set by your mentor.'}</p>
                <Link to="/dashboard/progress" className="link-button" style={{ fontSize: 12, marginTop: 10 }}>
                  See the full plan
                </Link>
              </>
            ) : (
              <p className="section-note">Your mentor is building your plan.</p>
            )}
          </section>

          <section className="panel-card">
            <div className="panel-head">
              <h2>Next call</h2>
              <Link to="/dashboard/calls" className="link-button" style={{ fontSize: 12 }}>
                Calls
              </Link>
            </div>
            {nextCall ? (
              <div className="list-row">
                <span className="kpi-icon"><CalendarClock size={14} /></span>
                <div className="list-row-main">
                  <span className="list-row-title">{formatDate(nextCall.preferred_date)} · {nextCall.preferred_time}</span>
                  <span className="list-row-sub">{nextCall.topic || 'General call'}</span>
                </div>
                <span className="status-pill neutral">{nextCall.status}</span>
              </div>
            ) : (
              <p className="section-note">No call booked.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
