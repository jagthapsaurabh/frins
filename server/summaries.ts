import { type Express, type NextFunction, type Request, type Response } from 'express';
import { db } from './db.js';

type Role = 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';
type RequireRole = (roles: Role[]) => (req: Request, res: Response, next: NextFunction) => void;

/**
 * Small, purpose-built payloads for the two home screens. The old overview
 * endpoints return the whole database; these return only what the dashboard
 * draws, which keeps the first paint quick once the roster is in the thousands.
 */
export function registerSummaryRoutes(app: Express, requireRole: RequireRole) {
  app.get('/api/admin/summary', requireRole(['ADMIN', 'CURRICULUM_OWNER']), (_req, res) => {
    const count = (sql: string, ...params: any[]) => (db.prepare(sql).get(...params) as any).c as number;

    const activeLearners = count("SELECT COUNT(*) AS c FROM users WHERE role = 'LEARNER' AND account_status = 'ACTIVE'");
    const activeStaff = count("SELECT COUNT(*) AS c FROM users WHERE role IN ('GUIDE','ADMIN','CURRICULUM_OWNER') AND account_status = 'ACTIVE'");
    const activeCourses = count('SELECT COUNT(*) AS c FROM courses WHERE is_active = 1');
    const awaitingReview = count("SELECT COUNT(*) AS c FROM learning_tasks WHERE status = 'SUBMITTED'");
    const openLeads = count("SELECT COUNT(*) AS c FROM leads WHERE status NOT IN ('CLOSED','CONVERTED')");
    const upcomingCalls = count(
      "SELECT COUNT(*) AS c FROM call_bookings WHERE status IN ('REQUESTED','NEW','CONFIRMED','DIRECT_CALL_BOOKED')"
    );
    const communities = count('SELECT COUNT(*) AS c FROM communities WHERE archived = 0');
    const unreadMessages = count(
      `SELECT COUNT(*) AS c FROM chat_messages m
        JOIN chat_threads t ON t.id = m.thread_id
       WHERE m.sender_role = 'LEARNER' AND (t.staff_last_read_at IS NULL OR m.created_at > t.staff_last_read_at)`
    );

    const queue = db
      .prepare(
        `SELECT t.id, t.title, t.status, t.submitted_at, t.assigned_at,
                u.name AS learner_name, u.id AS learner_id,
                c.title AS course_title
           FROM learning_tasks t
           JOIN users u ON u.id = t.learner_id
           LEFT JOIN courses c ON c.id = t.course_id
          WHERE t.status = 'SUBMITTED'
          ORDER BY t.submitted_at DESC
          LIMIT 6`
      )
      .all();

    const recent = db
      .prepare(
        `SELECT action, actor_role, entity_type, entity_id, created_at
           FROM audit_events
          WHERE action NOT IN ('USER_LOGIN_SUCCESS', 'RBAC_ACCESS_DENIED')
          ORDER BY created_at DESC LIMIT 8`
      )
      .all();

    const calls = db
      .prepare(
        `SELECT id, participant_name, topic, preferred_date, preferred_time, status, created_at
           FROM call_bookings
          WHERE status IN ('REQUESTED','NEW','CONFIRMED','DIRECT_CALL_BOOKED')
          ORDER BY COALESCE(preferred_date, created_at) ASC
          LIMIT 5`
      )
      .all();

    const leads = db
      .prepare(
        `SELECT id, name, email, track, status, created_at
           FROM leads ORDER BY created_at DESC LIMIT 5`
      )
      .all();

    // Courses that nobody is on yet, and courses that are switched off.
    const courseGaps = db
      .prepare(
        `SELECT c.id, c.title, c.is_active,
                (SELECT COUNT(*) FROM student_courses sc WHERE sc.course_id = c.id) AS learners
           FROM courses c
          WHERE c.is_active = 0
             OR (SELECT COUNT(*) FROM student_courses sc WHERE sc.course_id = c.id) = 0
          ORDER BY c.created_at DESC
          LIMIT 4`
      )
      .all();

    res.json({
      success: true,
      counts: {
        learners: activeLearners,
        staff: activeStaff,
        courses: activeCourses,
        awaitingReview,
        openLeads,
        upcomingCalls,
        communities,
        unreadMessages
      },
      queue,
      recent,
      calls,
      leads,
      courseGaps
    });
  });

  app.get('/api/learner/summary', requireRole(['LEARNER', 'GUIDE', 'ADMIN']), (req, res) => {
    const learnerId =
      req.user!.role === 'LEARNER' ? req.user!.id : String(req.query.learnerId || req.user!.id);

    const learner = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.track, u.created_at,
                p.approved_level, p.evidence_status, p.level_review_state,
                g.name AS guide_name
           FROM users u
           LEFT JOIN student_learning_profiles p ON p.learner_id = u.id
           LEFT JOIN users g ON g.id = u.assigned_guide_id
          WHERE u.id = ?`
      )
      .get(learnerId) as any;
    if (!learner) return res.status(404).json({ success: false, error: 'Learner not found.' });

    const courses = db
      .prepare(
        `SELECT c.id, c.title, c.level, c.duration_hours,
                (SELECT COUNT(*) FROM course_steps s WHERE s.course_id = c.id) AS step_count,
                (SELECT COUNT(*) FROM learner_step_progress p
                  WHERE p.course_id = c.id AND p.learner_id = ? AND p.status = 'COMPLETED') AS steps_done,
                sc.assigned_at
           FROM student_courses sc
           JOIN courses c ON c.id = sc.course_id
          WHERE sc.learner_id = ?
          ORDER BY sc.assigned_at DESC`
      )
      .all(learnerId, learnerId) as any[];

    const tasks = db
      .prepare(
        `SELECT t.id, t.title, t.status, t.due_date, t.assigned_at, t.submitted_at, t.reviewed_at,
                t.guide_feedback, c.title AS course_title
           FROM learning_tasks t
           LEFT JOIN courses c ON c.id = t.course_id
          WHERE t.learner_id = ?
          ORDER BY CASE t.status WHEN 'SUBMITTED' THEN 0 WHEN 'ASSIGNED' THEN 1 ELSE 2 END,
                   COALESCE(t.due_date, t.assigned_at) ASC`
      )
      .all(learnerId) as any[];

    const calls = db
      .prepare(
        `SELECT id, preferred_date, preferred_time, topic, status
           FROM call_bookings
          WHERE learner_id = ? AND status NOT IN ('CANCELLED','NO_SHOW')
          ORDER BY COALESCE(preferred_date, created_at) ASC
          LIMIT 3`
      )
      .all(learnerId);

    const communities = db
      .prepare(
        `SELECT c.id, c.name, m.last_read_at,
                (SELECT COUNT(*) FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL AND msg.sender_user_id <> ?
                    AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)) AS unread
           FROM communities c
           JOIN community_members m ON m.community_id = c.id AND m.user_id = ?
          WHERE c.archived = 0
          ORDER BY unread DESC, c.name ASC
          LIMIT 4`
      )
      .all(learnerId, learnerId);

    const latestFeedback = tasks.find((task: any) => task.guide_feedback && task.reviewed_at) || null;

    res.json({
      success: true,
      learner,
      courses,
      tasks,
      calls,
      communities,
      latestFeedback
    });
  });
}
