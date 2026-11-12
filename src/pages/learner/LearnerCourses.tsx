import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight } from 'lucide-react';
import { PageHead, TableShell } from '../../components/console/ConsoleUI';

const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

/**
 * The courses on a learner's plan. One row each, with how far they have got and
 * the one button that matters: continue.
 */
export const LearnerCourses: React.FC<{ courses: any[] }> = ({ courses }) => (
  <div>
    <PageHead
      title="My courses"
      meta={courses.length > 0 ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}` : undefined}
    />

    {courses.length === 0 ? (
      <section className="panel-card">
        <div className="empty-state">
          <BookOpen size={18} />
          <strong>No course yet</strong>
          <span>Your mentor adds one when your plan is ready.</span>
        </div>
      </section>
    ) : (
      <div className="course-card-grid">
        {courses.map((course: any) => {
          const total = Number(course.step_count) || 0;
          const done = Number(course.steps_done) || 0;
          const progress = pct(done, total);
          const started = done > 0;
          return (
            <article key={course.id} className="course-card">
              <div className="course-card-top">
                <span className="course-card-icon">
                  <BookOpen size={15} />
                </span>
                <div className="course-card-title">
                  <h2>{course.course_title}</h2>
                  <span>
                    {course.course_level} · {total} {total === 1 ? 'step' : 'steps'}
                  </span>
                </div>
              </div>

              {course.course_description && <p className="course-card-copy">{course.course_description}</p>}

              {course.custom_notes && (
                <div className="course-note">
                  <strong>From your mentor</strong>
                  <span>{course.custom_notes}</span>
                </div>
              )}

              <div className="course-card-progress">
                <div className="meter">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <span className="row-sub">
                  {done} of {total} done · {progress}%
                </span>
              </div>

              {Array.isArray(course.modules) && course.modules.length > 0 && (
                <ul className="course-module-list">
                  {course.modules.slice(0, 6).map((module: string, index: number) => (
                    <li key={index}>{module}</li>
                  ))}
                </ul>
              )}

              <Link className="btn btn-primary" to={`/dashboard/courses/${course.course_id}`}>
                {started ? 'Continue course' : 'Start course'} <ChevronRight size={14} />
              </Link>
            </article>
          );
        })}
      </div>
    )}
  </div>
);
