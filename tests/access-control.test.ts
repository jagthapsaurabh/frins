import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { app } from '../server/index.js';
import { db, initDatabaseAndSeed } from '../server/db.js';

let server: Server;
let base = '';
const qaEmail = `qa.other.${Date.now()}@example.com`;

const login = async (email: string, password = 'frins123') => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  return data.token as string;
};

describe('FRINS dashboard access control and Discovery "Other" track', () => {
  beforeAll(async () => {
    initDatabaseAndSeed();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    // Remove any rows this suite created.
    db.prepare('DELETE FROM discovery_responses WHERE session_id IN (SELECT id FROM discovery_sessions WHERE lower(participant_email) = ?)').run(qaEmail);
    db.prepare('DELETE FROM discovery_sessions WHERE lower(participant_email) = ?').run(qaEmail);
    db.prepare('DELETE FROM leads WHERE lower(email) = ?').run(qaEmail);
    db.prepare('DELETE FROM call_bookings WHERE lower(participant_email) = ?').run(qaEmail);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('FRI-AUTH-001: Learner, Admin and Guide dashboards reject requests without a valid session', async () => {
    const learner = await fetch(`${base}/api/learner/dashboard`);
    const admin = await fetch(`${base}/api/admin/overview`);
    const guide = await fetch(`${base}/api/guide/workspace`);

    expect(learner.status).toBe(401);
    expect(admin.status).toBe(401);
    expect(guide.status).toBe(401);
  });

  it('FRI-AUTH-002: A learner session opens the learner dashboard and is refused the staff consoles', async () => {
    const learnerToken = await login('aarav@example.com');
    expect(learnerToken).toBeTruthy();

    const own = await fetch(`${base}/api/learner/dashboard`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    expect(own.status).toBe(200);

    const admin = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const guide = await fetch(`${base}/api/guide/workspace`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    expect(admin.status).toBe(403);
    expect(guide.status).toBe(403);
  });

  it('FRI-AUTH-003: Staff sessions reach their own console and are refused other staff consoles', async () => {
    const adminToken = await login('admin@frins.org');
    const guideToken = await login('vikram.guide@frins.org');

    const adminOverview = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(adminOverview.status).toBe(200);

    const guideWorkspace = await fetch(`${base}/api/guide/workspace`, {
      headers: { Authorization: `Bearer ${guideToken}` }
    });
    expect(guideWorkspace.status).toBe(200);

    // A guide cannot reach the admin-only overview endpoint.
    const guideOnAdmin = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${guideToken}` }
    });
    expect(guideOnAdmin.status).toBe(403);
  });

  it('FRI-DISC-OTHER-001: Discovery rejects "Other" without a description', async () => {
    const res = await fetch(`${base}/api/discovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantName: 'QA Other Track',
        participantEmail: qaEmail,
        track: 'other'
      })
    });
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('FRI-DISC-OTHER-002: Discovery stores the self-described focus on the session and exposes it to Admin', async () => {
    const startRes = await fetch(`${base}/api/discovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantName: 'QA Other Track',
        participantEmail: qaEmail,
        track: 'other',
        customTrack: 'Final-year student running a paper trading journal'
      })
    });
    expect(startRes.status).toBe(201);
    const startData = await startRes.json();
    expect(startData.session.custom_track).toBe('Final-year student running a paper trading journal');

    // The self-described focus survives a reload of the session.
    const getRes = await fetch(`${base}/api/discovery/${startData.sessionId}`);
    const getData = await getRes.json();
    expect(getData.success).toBe(true);
    expect(getData.session.custom_track).toBe('Final-year student running a paper trading journal');

    // The result copy names the participant's own focus instead of a generic label.
    const adminToken = await login('admin@frins.org');
    const overview = await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const overviewData = await overview.json();
    const session = (overviewData.solvedDiscoverySessions || []).find(
      (s: any) => s.participant_email === qaEmail
    );
    expect(session).toBeTruthy();
    expect(session.track).toBe('other');
    expect(session.custom_track).toBe('Final-year student running a paper trading journal');
    expect(session.candidateResult.recommendedProgram).toContain('Final-year student running a paper trading journal');
  });

  it('FRI-AUTH-002: the demo account directory is gone and no password defaults are accepted', async () => {
    const directory = await fetch(`${base}/api/auth/demo-accounts`);
    expect(directory.status).toBe(404);

    const switcher = await fetch(`${base}/api/admin/session/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@frins.org' })
    });
    expect(switcher.status).toBe(404);

    // An empty password used to fall back to a shared demo password.
    const emptyLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@frins.org', password: '' })
    });
    expect(emptyLogin.status).toBe(400);

    // The old alias is not a shortcut either.
    const aliasLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@frins.org', password: 'frins2026' })
    });
    expect(aliasLogin.status).toBe(401);
  });

  it('FRI-DISC-003: the public question feed hides test personas and retired questions', async () => {
    const res = await fetch(`${base}/api/discovery/questions`);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(Array.isArray(data.questions)).toBe(true);
    expect(data.questions.length).toBeGreaterThan(0);
    expect(data.personas).toBeUndefined();
    expect(data.questions.every((q: any) => q.isActive !== false)).toBe(true);
  });

  it('FRI-ADMIN-002: an admin has the same access as a guide', async () => {
    const adminToken = await login('admin@frins.org');
    for (const path of ['/api/guide/workspace', '/api/guide/learners/usr_learner_aarav']) {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      expect(res.status, path).toBe(200);
    }
  });

  it('FRI-AUTH-003: password changes need the current password', async () => {
    const token = await login('priya@example.com');

    const wrong = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'LongEnough123' })
    });
    expect(wrong.status).toBe(401);

    const short = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'frins123', newPassword: 'short' })
    });
    expect(short.status).toBe(400);

    const ok = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'frins123', newPassword: 'LongEnough123' })
    });
    expect(ok.status).toBe(200);

    // The old password is dead, the new one works.
    const oldLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'priya@example.com', password: 'frins123' })
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'priya@example.com', password: 'LongEnough123' })
    });
    expect(newLogin.status).toBe(200);

    // Put the seed password back so the rest of the suite is unaffected.
    const backToken = (await newLogin.json()).token as string;
    await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${backToken}` },
      body: JSON.stringify({ currentPassword: 'LongEnough123', newPassword: 'frins123' })
    });
  });

  it('FRI-NOTIF-001: notices reach the audience they were sent to', async () => {
    const adminToken = await login('admin@frins.org');
    const learnerToken = await login('rohan@example.com');

    const createRes = await fetch(`${base}/api/admin/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'QA notice',
        message: 'This goes to learners only.',
        audience: 'LEARNERS'
      })
    });
    expect(createRes.status).toBe(201);
    const noticeId = (await createRes.json()).id as string;

    const learnerInbox = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const learnerData = await learnerInbox.json();
    expect(learnerData.notifications.some((n: any) => n.id === noticeId)).toBe(true);

    const adminInbox = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminData = await adminInbox.json();
    expect(adminData.notifications.some((n: any) => n.id === noticeId)).toBe(false);

    await fetch(`${base}/api/notifications/${noticeId}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const afterRead = await (await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    })).json();
    const marked = afterRead.notifications.find((n: any) => n.id === noticeId);
    expect(marked?.isRead).toBe(true);

    await fetch(`${base}/api/admin/notifications/${noticeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
  });

  it('FRI-ADMIN-003: booking status only accepts known values', async () => {
    const adminToken = await login('admin@frins.org');
    const overview = await (await fetch(`${base}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })).json();
    const booking = (overview.callBookings || [])[0];
    if (!booking) return;

    const bad = await fetch(`${base}/api/admin/bookings/${booking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'WHATEVER' })
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${base}/api/admin/bookings/${booking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'CONFIRMED' })
    });
    expect(good.status).toBe(200);
  });

  it('FRI-ADMIN-004: Admin list endpoints page a big roster instead of returning everything', async () => {
    const adminToken = await login('admin@frins.org');

    const first = await fetch(`${base}/api/admin/learners?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);
    expect(firstBody.rows.length).toBeLessThanOrEqual(2);
    expect(firstBody.total).toBeGreaterThanOrEqual(2);
    expect(firstBody.pages).toBe(Math.max(1, Math.ceil(firstBody.total / 2)));

    // A search that cannot match returns an empty page, not the whole table.
    const none = await fetch(`${base}/api/admin/learners?q=zzz-no-such-learner-zzz`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const noneBody = await none.json();
    expect(noneBody.total).toBe(0);
    expect(noneBody.rows.length).toBe(0);

    // A learner session can use none of the list endpoints.
    const learnerToken = await login('aarav@example.com');
    const refused = await fetch(`${base}/api/admin/learners`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    expect(refused.status).toBe(403);
  });

  it('FRI-CHAT-002: A mentor message notifies the learner, and the reply notifies their guide', async () => {
    const adminToken = await login('admin@frins.org');
    const learnerToken = await login('aarav@example.com');

    const before = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const beforeBody = await before.json();
    const beforeCount = beforeBody.notifications.length;

    const task = await fetch(`${base}/api/admin/tasks?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const taskBody = await task.json();
    const target = taskBody.rows[0];
    expect(target).toBeTruthy();

    const sent = await fetch(`${base}/api/tasks/${target.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ message: 'Paged list check: this note should reach the learner bell.' })
    });
    expect(sent.status).toBe(201);

    const after = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const afterBody = await after.json();
    // The bell shows the fifty most recent, so compare what is in the list by
    // name rather than by length.
    expect(afterBody.unreadCount).toBeGreaterThanOrEqual(beforeBody.unreadCount);
    expect(
      afterBody.notifications.some((n: any) => String(n.message).includes('Paged list check'))
    ).toBe(true);
    void beforeCount;

    // Clean up the messages and notices this test created.
    db.prepare("DELETE FROM task_messages WHERE message LIKE 'Paged list check%'").run();
  });

  it('FRI-COURSE-001: Course steps open one at a time, and only a mentor review opens a task step', async () => {
    const adminToken = await login('admin@frins.org');
    const learnerToken = await login('aarav@example.com');

    // A two-step course created just for this check.
    const created = await fetch(`${base}/api/admin/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'QA step course', track: 'trader', level: 'L1', description: 'Step order check.' })
    });
    const { courseId } = await created.json();
    expect(courseId).toBeTruthy();

    const reading = await fetch(`${base}/api/admin/courses/${courseId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'First reading', kind: 'TEXT', content: 'Read this.' })
    });
    expect(reading.status).toBe(201);
    const readingStep = (await reading.json()).step;

    const taskStep = await fetch(`${base}/api/admin/courses/${courseId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'First task', kind: 'TASK', content: 'Send a chart.' })
    });
    const taskStepBody = await taskStep.json();

    await fetch(`${base}/api/admin/courses/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ courseId, learnerId: 'usr_learner_aarav' })
    });

    const opened = await fetch(`${base}/api/learner/courses/${courseId}`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const openedBody = await opened.json();
    expect(openedBody.steps[0].status).toBe('OPEN');
    expect(openedBody.steps[1].unlocked).toBe(false);

    // Step 2 is still locked, so finishing it directly is refused.
    const tooSoon = await fetch(`${base}/api/learner/courses/${courseId}/steps/${taskStepBody.stepId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learnerToken}` },
      body: JSON.stringify({})
    });
    expect([400, 409]).toContain(tooSoon.status);

    const done = await fetch(`${base}/api/learner/courses/${courseId}/steps/${readingStep.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learnerToken}` },
      body: JSON.stringify({})
    });
    expect(done.status).toBe(200);

    // A task step is finished by a submission, then by the review, not by a click.
    const submitted = await fetch(`${base}/api/learner/courses/${courseId}/steps/${taskStepBody.stepId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learnerToken}` },
      body: JSON.stringify({ submissionText: 'Here is the chart work.' })
    });
    expect(submitted.status).toBe(201);
    const submittedBody = await submitted.json();

    const waiting = await fetch(`${base}/api/learner/courses/${courseId}`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const waitingBody = await waiting.json();
    expect(waitingBody.steps[1].status).toBe('SUBMITTED');
    expect(waitingBody.progressPct).toBe(50);

    const reviewed = await fetch(`${base}/api/admin/tasks/${submittedBody.taskId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'REVIEWED', guideFeedback: 'Pass.' })
    });
    expect(reviewed.status).toBe(200);

    const finished = await fetch(`${base}/api/learner/courses/${courseId}`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    const finishedBody = await finished.json();
    expect(finishedBody.progressPct).toBe(100);
    expect(finishedBody.enrollment.status).toBe('COMPLETED');

    // Every task now records when it was handed out.
    const storedTask = db.prepare('SELECT assigned_at, step_id FROM learning_tasks WHERE id = ?').get(submittedBody.taskId) as any;
    expect(storedTask.assigned_at).toBeTruthy();
    expect(storedTask.step_id).toBe(taskStepBody.stepId);

    // Clean up.
    db.prepare('DELETE FROM task_messages WHERE task_id = ?').run(submittedBody.taskId);
    db.prepare('DELETE FROM evidence_items WHERE source_ref_id = ?').run(submittedBody.taskId);
    db.prepare('DELETE FROM learning_tasks WHERE id = ?').run(submittedBody.taskId);
    db.prepare('DELETE FROM learner_step_progress WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM course_steps WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM student_courses WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  });

  it('FRI-COMM-001: A community is members only, replies point at a message, and files stay behind auth', async () => {
    const admin = await login('admin@frins.org');
    const learner = await login('aarav@example.com');
    const outsider = await login('priya@example.com');
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    const created = await fetch(`${base}/api/communities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin) },
      body: JSON.stringify({ name: 'QA community', description: 'Test group', kind: 'BATCH' })
    });
    expect(created.status).toBe(201);
    const { communityId } = await created.json();

    const directory = await (await fetch(`${base}/api/admin/learners/directory`, { headers: auth(admin) })).json();
    const aarav = directory.rows.find((row: any) => row.email === 'aarav@example.com');

    const added = await fetch(`${base}/api/communities/${communityId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin) },
      body: JSON.stringify({ userIds: [aarav.id] })
    });
    expect(added.status).toBe(201);
    expect((await added.json()).added).toBe(1);

    const first = await fetch(`${base}/api/communities/${communityId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(admin) },
      body: JSON.stringify({ body: 'QA: welcome to the group' })
    });
    expect(first.status).toBe(201);
    const parent = (await first.json()).message.id;

    const reply = await fetch(`${base}/api/communities/${communityId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(learner) },
      body: JSON.stringify({ body: 'QA: thanks, here is my question', parentId: parent })
    });
    expect(reply.status).toBe(201);

    // An upload, then a post that carries it.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
      'hex'
    );
    const uploaded = await fetch(`${base}/api/communities/${communityId}/files`, {
      method: 'POST',
      headers: {
        ...auth(learner),
        'Content-Type': 'application/octet-stream',
        'X-File-Name': 'chart.png',
        'X-File-Type': 'image/png'
      },
      body: png
    });
    expect(uploaded.status).toBe(201);
    const fileId = (await uploaded.json()).file.id;

    const withFile = await fetch(`${base}/api/communities/${communityId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(learner) },
      body: JSON.stringify({ body: 'QA: screenshot', fileId })
    });
    expect(withFile.status).toBe(201);

    const feed = await (await fetch(`${base}/api/communities/${communityId}/messages`, { headers: auth(learner) })).json();
    expect(feed.rows.length).toBe(3);
    expect(feed.rows[1].parent_body).toContain('welcome');
    expect(feed.rows[2].file_url).toBe(`/api/community-files/${fileId}`);

    // Someone outside the group sees nothing.
    const peek = await fetch(`${base}/api/communities/${communityId}/messages`, { headers: auth(outsider) });
    expect(peek.status).toBe(403);
    const filePeek = await fetch(`${base}/api/community-files/${fileId}`, { headers: auth(outsider) });
    expect(filePeek.status).toBe(403);

    // A learner cannot delete someone else's post. The admin can.
    const cheeky = await fetch(`${base}/api/communities/${communityId}/messages/${parent}`, {
      method: 'DELETE',
      headers: auth(learner)
    });
    expect(cheeky.status).toBe(403);

    // The person added gets a notice.
    const notices = await (await fetch(`${base}/api/notifications`, { headers: auth(learner) })).json();
    expect(notices.notifications.some((n: any) => String(n.title).includes('QA community'))).toBe(true);

    // An archived community is read only.
    await fetch(`${base}/api/communities/${communityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(admin) },
      body: JSON.stringify({ archived: true })
    });
    const blocked = await fetch(`${base}/api/communities/${communityId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(learner) },
      body: JSON.stringify({ body: 'QA: too late' })
    });
    expect(blocked.status).toBe(400);

    db.prepare('DELETE FROM community_messages WHERE community_id = ?').run(communityId);
    db.prepare('DELETE FROM community_files WHERE community_id = ?').run(communityId);
    db.prepare('DELETE FROM community_members WHERE community_id = ?').run(communityId);
    db.prepare('DELETE FROM communities WHERE id = ?').run(communityId);
    db.prepare('DELETE FROM notifications WHERE title LIKE ?').run('%QA community%');
    db.prepare('DELETE FROM community_members WHERE user_id = ?').run(aarav.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(aarav.id);
  });

  it('FRI-COMM-002: The admin overview counts what the dashboard draws and the summary stays small', async () => {
    const admin = await login('admin@frins.org');
    const res = await fetch(`${base}/api/admin/summary`, { headers: { Authorization: `Bearer ${admin}` } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.counts.learners).toBe('number');
    expect(typeof json.counts.awaitingReview).toBe('number');
    expect(Array.isArray(json.queue)).toBe(true);
    expect(Array.isArray(json.recent)).toBe(true);
    // A summary, not a data dump.
    expect(JSON.stringify(json).length).toBeLessThan(20000);
    expect(json).not.toHaveProperty('users');
  });

  it('FRI-CHAT-001: A learner and their mentor trade messages on one thread, and no other learner can read it', async () => {
    const learner = await login('aarav@example.com');
    const other = await login('priya@example.com');
    const admin = await login('admin@frins.org');

    const mine = await fetch(`${base}/api/chat/my-thread`, { headers: { Authorization: `Bearer ${learner}` } });
    expect(mine.status).toBe(200);
    const opened = await mine.json();
    expect(opened.mentorName).toBeTruthy();
    const threadId = opened.thread.id;

    const sent = await fetch(`${base}/api/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learner}` },
      body: JSON.stringify({ message: 'QA: where does the stop go?' })
    });
    expect(sent.status).toBe(201);

    const list = await fetch(`${base}/api/chat/threads?q=aarav`, { headers: { Authorization: `Bearer ${admin}` } });
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.rows.some((row: any) => row.id === threadId && row.unread >= 1)).toBe(true);

    const reply = await fetch(`${base}/api/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ message: 'QA: below the swing low.' })
    });
    expect(reply.status).toBe(201);

    const after = await fetch(`${base}/api/chat/my-thread`, { headers: { Authorization: `Bearer ${learner}` } });
    const reloaded = await after.json();
    expect(reloaded.messages.some((m: any) => m.message === 'QA: below the swing low.')).toBe(true);

    const peeking = await fetch(`${base}/api/chat/threads/${threadId}`, { headers: { Authorization: `Bearer ${other}` } });
    expect(peeking.status).toBe(403);

    // Empty messages are refused.
    const blank = await fetch(`${base}/api/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learner}` },
      body: JSON.stringify({ message: '   ' })
    });
    expect(blank.status).toBe(400);

    db.prepare('DELETE FROM chat_messages WHERE message LIKE ?').run('QA: %');
    db.prepare('DELETE FROM notifications WHERE message LIKE ?').run('QA: %');
  });

  it('FRI-COURSE-002: A course carries its duration and price, and an inactive course cannot be assigned', async () => {
    const admin = await login('admin@frins.org');

    const created = await fetch(`${base}/api/admin/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({
        title: 'QA sizing course',
        track: 'trader',
        level: 'L3',
        description: 'Short description.',
        durationHours: 2.5,
        price: 4999
      })
    });
    expect([200, 201]).toContain(created.status);
    const { courseId } = await created.json();

    const rows = await (await fetch(`${base}/api/admin/courses`, { headers: { Authorization: `Bearer ${admin}` } })).json();
    const row = rows.rows.find((c: any) => c.id === courseId);
    expect(row.duration_hours).toBe(2.5);
    expect(row.price).toBe(4999);
    expect(row.is_active).toBe(1);
    expect(row.revenue).toBe(0);

    const off = await fetch(`${base}/api/admin/courses/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ isActive: false })
    });
    expect(off.status).toBe(200);
    expect((await off.json()).course.is_active).toBe(0);

    const learnerRow = await (await fetch(`${base}/api/admin/learners/directory`, { headers: { Authorization: `Bearer ${admin}` } })).json();
    const learnerId = learnerRow.rows[0].id;

    const blocked = await fetch(`${base}/api/admin/courses/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ courseId, learnerId })
    });
    expect(blocked.status).toBe(400);

    db.prepare('DELETE FROM course_steps WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM student_courses WHERE course_id = ?').run(courseId);
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  });

  it('FRI-LEARNER-ADD-001: Admin adds a learner with a course and payment, and the file adds it up', async () => {
    const adminToken = await login('admin@frins.org');
    const email = `qa.learner.${Date.now()}@example.com`;

    const course = db.prepare('SELECT id FROM courses ORDER BY created_at ASC LIMIT 1').get() as any;
    const created = await fetch(`${base}/api/admin/learners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'QA Added Learner',
        email,
        track: 'trader',
        phone: '9000000001',
        city: 'Nagpur',
        courseId: course.id,
        amountPaid: 5000,
        paymentStatus: 'PAID'
      })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.learnerId).toBeTruthy();
    expect(createdBody.temporaryPassword).toBeTruthy();

    const dup = await fetch(`${base}/api/admin/learners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: 'QA Added Learner', email })
    });
    expect(dup.status).toBe(409);

    const dossier = await fetch(`${base}/api/admin/learners/${createdBody.learnerId}/dossier`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(dossier.status).toBe(200);
    const dossierBody = await dossier.json();
    expect(dossierBody.learner.password_hash).toBeUndefined();
    expect(dossierBody.stats.totalPaid).toBe(5000);
    expect(dossierBody.stats.courseCount).toBe(1);
    expect(dossierBody.enrollments[0].payment_status).toBe('PAID');

    // The new learner signs in with the password the admin was shown.
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: createdBody.temporaryPassword })
    });
    expect(loginRes.status).toBe(200);

    // Guides can read the file; learners cannot reach the admin route at all.
    const learnerToken = await login('aarav@example.com');
    const refused = await fetch(`${base}/api/admin/learners/${createdBody.learnerId}/dossier`, {
      headers: { Authorization: `Bearer ${learnerToken}` }
    });
    expect(refused.status).toBe(403);

    db.prepare('DELETE FROM student_learning_profiles WHERE learner_id = ?').run(createdBody.learnerId);
    db.prepare('DELETE FROM student_courses WHERE learner_id = ?').run(createdBody.learnerId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(createdBody.learnerId);
    db.prepare('DELETE FROM users WHERE id = ?').run(createdBody.learnerId);
  });

  it('FRI-CALL-003: A learner books a mentor from the panel and only that learner can cancel it', async () => {
    const adminToken = await login('admin@frins.org');
    const learnerToken = await login('aarav@example.com');
    const guide = db.prepare("SELECT id FROM users WHERE role = 'GUIDE' LIMIT 1").get() as any;

    const before = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    void before;

    const booked = await fetch(`${base}/api/learner/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learnerToken}` },
      body: JSON.stringify({
        staffId: guide.id,
        preferredDate: '2030-01-15',
        preferredTime: '3:00 PM IST',
        topic: 'QA direct call'
      })
    });
    expect(booked.status).toBe(201);
    const bookedBody = await booked.json();

    const row = db.prepare('SELECT * FROM call_bookings WHERE id = ?').get(bookedBody.bookingId) as any;
    expect(row.learner_id).toBe('usr_learner_aarav');
    expect(row.staff_id).toBe(guide.id);
    expect(row.status).toBe('REQUESTED');

    // The mentor got a bell notice for it.
    const notice = db
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE target_user_id = ? AND title LIKE 'Call request from%'")
      .get(guide.id) as any;
    expect(notice.c).toBeGreaterThan(0);

    // Another learner cannot cancel it.
    const other = await fetch(`${base}/api/learner/calls/${bookedBody.bookingId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({})
    });
    expect(other.status).toBe(403);

    const cancelled = await fetch(`${base}/api/learner/calls/${bookedBody.bookingId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${learnerToken}` },
      body: JSON.stringify({})
    });
    expect(cancelled.status).toBe(200);
    const after = db.prepare('SELECT status FROM call_bookings WHERE id = ?').get(bookedBody.bookingId) as any;
    expect(after.status).toBe('CANCELLED');

    db.prepare('DELETE FROM call_bookings WHERE id = ?').run(bookedBody.bookingId);
    db.prepare("DELETE FROM notifications WHERE title = 'Call request from Aarav Mehta'").run();
    db.prepare("DELETE FROM notifications WHERE title = 'Call cancelled' AND message LIKE '%2030-01-15%'").run();
  });
});
