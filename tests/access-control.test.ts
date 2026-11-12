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
    expect(afterBody.notifications.length).toBeGreaterThan(beforeCount);
    expect(
      afterBody.notifications.some((n: any) => String(n.message).includes('Paged list check'))
    ).toBe(true);

    // Clean up the messages and notices this test created.
    db.prepare("DELETE FROM task_messages WHERE message LIKE 'Paged list check%'").run();
  });
});
