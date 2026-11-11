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
});
