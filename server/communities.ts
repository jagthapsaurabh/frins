import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { db, writeAuditEvent } from './db.js';

/**
 * Communities: an admin opens one, adds learners and guides, and everyone in it
 * can post, reply to a particular message, and attach a file or screenshot.
 *
 * The same endpoints serve the admin console and the learner panel; what a
 * caller can see is decided by membership, not by which screen asked.
 */

type Role = 'LEARNER' | 'GUIDE' | 'ADMIN' | 'CURRICULUM_OWNER';
type RequireRole = (roles: Role[]) => (req: Request, res: Response, next: NextFunction) => void;

const STAFF: Role[] = ['ADMIN', 'CURRICULUM_OWNER', 'GUIDE'];
const ALL: Role[] = ['LEARNER', 'GUIDE', 'ADMIN', 'CURRICULUM_OWNER'];

const isStaff = (role: string) => STAFF.includes(role as Role);
const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'community');
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const memberRow = (communityId: string, userId: string) =>
  db.prepare('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?').get(communityId, userId) as
    | any
    | undefined;

/** Admins moderate everything. Everyone else needs a membership row. */
const canSee = (community: any, userId: string, role: string) =>
  isStaff(role) || Boolean(memberRow(community.id, userId));

const canModerate = (community: any, userId: string, role: string) =>
  role === 'ADMIN' || role === 'CURRICULUM_OWNER' || community.created_by_id === userId;

export function registerCommunityRoutes(app: Express, requireRole: RequireRole) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  /** Everything the current person is allowed to open, with their unread count. */
  app.get('/api/communities', requireRole(ALL), (req, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT c.*, m.role AS my_role, m.last_read_at,
                (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
                (SELECT COUNT(*) FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL) AS message_count,
                (SELECT msg.body FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL
                  ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
                (SELECT msg.sender_name FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL
                  ORDER BY msg.created_at DESC LIMIT 1) AS last_sender,
                (SELECT msg.created_at FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL
                  ORDER BY msg.created_at DESC LIMIT 1) AS last_message_at,
                (SELECT COUNT(*) FROM community_messages msg
                  WHERE msg.community_id = c.id AND msg.deleted_at IS NULL
                    AND msg.sender_user_id <> ?
                    AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)) AS unread
           FROM communities c
           LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = ?
          WHERE (c.created_by_id = ? OR m.user_id IS NOT NULL OR ? = 1)
          ORDER BY c.archived ASC, COALESCE(last_message_at, c.created_at) DESC`
      )
      .all(user.id, user.id, user.id, isStaff(user.role) ? 1 : 0) as any[];

    res.json({
      success: true,
      rows: rows.map((row) => ({ ...row, can_manage: canModerate(row, user.id, user.role) }))
    });
  });

  app.post('/api/communities', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const kind = String(req.body?.kind || 'GENERAL').toUpperCase();
    const memberIds: string[] = Array.isArray(req.body?.memberIds)
      ? req.body.memberIds.map((id: any) => String(id)).filter(Boolean)
      : [];

    if (!name) return res.status(400).json({ success: false, error: 'Give the community a name.' });
    if (name.length > 80) return res.status(400).json({ success: false, error: 'Keep the name under 80 characters.' });

    const id = newId('cmn');
    const now = nowIso();
    db.prepare(
      `INSERT INTO communities (id, name, description, kind, created_by_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, description || null, kind, req.user!.id, now, now);

    const addMember = db.prepare(
      'INSERT OR IGNORE INTO community_members (id, community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)'
    );
    addMember.run(newId('cmm'), id, req.user!.id, 'MODERATOR', now);
    for (const userId of memberIds) {
      const exists = db.prepare("SELECT id FROM users WHERE id = ? AND account_status = 'ACTIVE'").get(userId);
      if (exists) addMember.run(newId('cmm'), id, userId, 'MEMBER', now);
    }

    writeAuditEvent({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'COMMUNITY_CREATED',
      entityType: 'COMMUNITY',
      entityId: id,
      details: { name, members: memberIds.length + 1 }
    });

    res.status(201).json({ success: true, communityId: id });
  });

  app.get('/api/communities/:communityId', requireRole(ALL), (req, res) => {
    const user = req.user!;
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (!canSee(community, user.id, user.role)) {
      return res.status(403).json({ success: false, error: 'You are not a member of this community.' });
    }

    const members = db
      .prepare(
        `SELECT m.user_id, m.role, m.joined_at, u.name, u.email, u.role AS user_role, u.track
           FROM community_members m JOIN users u ON u.id = m.user_id
          WHERE m.community_id = ?
          ORDER BY CASE m.role WHEN 'MODERATOR' THEN 0 ELSE 1 END, u.name ASC`
      )
      .all(community.id) as any[];

    // Mark read before returning, so the count the caller sees is the next one.
    db.prepare('UPDATE community_members SET last_read_at = ? WHERE community_id = ? AND user_id = ?').run(
      nowIso(),
      community.id,
      user.id
    );

    res.json({
      success: true,
      community: { ...community, can_manage: canModerate(community, user.id, user.role) },
      members
    });
  });

  app.patch('/api/communities/:communityId', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (!canModerate(community, req.user!.id, req.user!.role)) {
      return res.status(403).json({ success: false, error: 'Only an admin can change this community.' });
    }

    const name = req.body?.name === undefined ? community.name : String(req.body.name).trim();
    const description =
      req.body?.description === undefined ? community.description : String(req.body.description).trim() || null;
    const archived = req.body?.archived === undefined ? community.archived : req.body.archived ? 1 : 0;

    if (!name) return res.status(400).json({ success: false, error: 'Give the community a name.' });

    db.prepare('UPDATE communities SET name = ?, description = ?, archived = ?, updated_at = ? WHERE id = ?').run(
      name,
      description,
      archived,
      nowIso(),
      community.id
    );

    writeAuditEvent({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'COMMUNITY_UPDATED',
      entityType: 'COMMUNITY',
      entityId: community.id,
      details: { name, archived }
    });

    res.json({ success: true });
  });

  app.post('/api/communities/:communityId/members', requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']), (req, res) => {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (!canModerate(community, req.user!.id, req.user!.role)) {
      return res.status(403).json({ success: false, error: 'Only an admin can add people here.' });
    }

    const ids: string[] = Array.isArray(req.body?.userIds)
      ? req.body.userIds.map((id: any) => String(id)).filter(Boolean)
      : [String(req.body?.userId || '')].filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ success: false, error: 'Pick at least one person.' });

    const insert = db.prepare(
      'INSERT OR IGNORE INTO community_members (id, community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)'
    );
    const now = nowIso();
    let added = 0;
    for (const userId of ids) {
      const user = db
        .prepare("SELECT id, name FROM users WHERE id = ? AND account_status = 'ACTIVE'")
        .get(userId) as any;
      if (!user) continue;
      const result = insert.run(newId('cmm'), community.id, userId, 'MEMBER', now);
      if (result.changes > 0) {
        added += 1;
        db.prepare(
          `INSERT INTO notifications (id, title, message, audience, target_user_id, created_by_id, created_by_name, created_at)
           VALUES (?, ?, ?, 'USER', ?, ?, ?, ?)`
        ).run(
          newId('ntf'),
          `Added to ${community.name}`,
          `${req.user!.name} added you to the community ${community.name}.`,
          userId,
          req.user!.id,
          req.user!.name,
          now
        );
      }
    }

    writeAuditEvent({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'COMMUNITY_MEMBERS_ADDED',
      entityType: 'COMMUNITY',
      entityId: community.id,
      details: { added }
    });

    res.status(201).json({ success: true, added });
  });

  app.delete(
    '/api/communities/:communityId/members/:userId',
    requireRole(['ADMIN', 'CURRICULUM_OWNER', 'GUIDE']),
    (req, res) => {
      const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
      if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
      if (!canModerate(community, req.user!.id, req.user!.role)) {
        return res.status(403).json({ success: false, error: 'Only an admin can remove people here.' });
      }
      if (String(req.params.userId) === community.created_by_id) {
        return res.status(400).json({ success: false, error: 'The person who started it cannot be removed.' });
      }

      db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(
        community.id,
        req.params.userId
      );
      writeAuditEvent({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'COMMUNITY_MEMBER_REMOVED',
        entityType: 'COMMUNITY',
        entityId: community.id,
        details: { userId: req.params.userId }
      });
      res.json({ success: true });
    }
  );

  /** The thread. Cursor on created_at is not needed at this size; cap at 200. */
  app.get('/api/communities/:communityId/messages', requireRole(ALL), (req, res) => {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (!canSee(community, req.user!.id, req.user!.role)) {
      return res.status(403).json({ success: false, error: 'You are not a member of this community.' });
    }

    const rows = db
      .prepare(
        `SELECT m.id, m.community_id, m.sender_user_id, m.sender_name, m.sender_role, m.parent_id,
                m.body, m.file_id, m.created_at, m.deleted_at,
                parent.body AS parent_body, parent.sender_name AS parent_sender,
                f.file_name, f.mime_type, f.size_bytes
           FROM community_messages m
           LEFT JOIN community_messages parent ON parent.id = m.parent_id
           LEFT JOIN community_files f ON f.id = m.file_id
          WHERE m.community_id = ?
          ORDER BY m.created_at ASC
          LIMIT 200`
      )
      .all(community.id) as any[];

    db.prepare('UPDATE community_members SET last_read_at = ? WHERE community_id = ? AND user_id = ?').run(
      nowIso(),
      community.id,
      req.user!.id
    );

    res.json({
      success: true,
      rows: rows.map((row) => ({
        ...row,
        mine: row.sender_user_id === req.user!.id,
        file_url: row.file_id ? `/api/community-files/${row.file_id}` : null
      }))
    });
  });

  app.post('/api/communities/:communityId/messages', requireRole(ALL), (req, res) => {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
    if (!canSee(community, req.user!.id, req.user!.role)) {
      return res.status(403).json({ success: false, error: 'You are not a member of this community.' });
    }
    if (Number(community.archived) === 1) {
      return res.status(400).json({ success: false, error: 'This community is archived. It is read only.' });
    }

    const body = String(req.body?.body || '').trim();
    const parentId = String(req.body?.parentId || '').trim() || null;
    const fileId = String(req.body?.fileId || '').trim() || null;

    if (!body && !fileId) return res.status(400).json({ success: false, error: 'Write a message first.' });
    if (body.length > 4000) return res.status(400).json({ success: false, error: 'Keep messages under 4000 characters.' });

    if (parentId) {
      const parent = db
        .prepare('SELECT id FROM community_messages WHERE id = ? AND community_id = ?')
        .get(parentId, community.id);
      if (!parent) return res.status(404).json({ success: false, error: 'The message you replied to is gone.' });
    }
    if (fileId) {
      const file = db
        .prepare('SELECT id FROM community_files WHERE id = ? AND community_id = ?')
        .get(fileId, community.id);
      if (!file) return res.status(404).json({ success: false, error: 'That file is not part of this community.' });
    }

    const id = newId('cmg');
    const now = nowIso();
    db.prepare(
      `INSERT INTO community_messages (id, community_id, sender_user_id, sender_name, sender_role, parent_id, body, file_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, community.id, req.user!.id, req.user!.name, req.user!.role, parentId, body, fileId, now);

    db.prepare('UPDATE communities SET updated_at = ? WHERE id = ?').run(now, community.id);

    // Tell the other members. Small groups only; cap so one post cannot fan out
    // into a thousand writes.
    const others = db
      .prepare('SELECT user_id FROM community_members WHERE community_id = ? AND user_id <> ? LIMIT 200')
      .all(community.id, req.user!.id) as any[];
    const notice = db.prepare(
      `INSERT INTO notifications (id, title, message, audience, target_user_id, created_by_id, created_by_name, created_at)
       VALUES (?, ?, ?, 'USER', ?, ?, ?, ?)`
    );
    for (const row of others) {
      notice.run(
        newId('ntf'),
        `New message in ${community.name}`,
        `${req.user!.name}: ${body ? body.slice(0, 120) : 'sent a file'}`,
        row.user_id,
        req.user!.id,
        req.user!.name,
        now
      );
    }

    writeAuditEvent({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'COMMUNITY_MESSAGE_SENT',
      entityType: 'COMMUNITY',
      entityId: community.id,
      details: { messageId: id, reply: Boolean(parentId), file: Boolean(fileId) }
    });

    const saved = db.prepare('SELECT * FROM community_messages WHERE id = ?').get(id) as any;
    return res.status(201).json({
      success: true,
      message: {
        ...saved,
        mine: true,
        file_url: fileId ? `/api/community-files/${fileId}` : null
      }
    });
  });

  app.delete('/api/communities/:communityId/messages/:messageId', requireRole(ALL), (req, res) => {
    const message = db
      .prepare('SELECT * FROM community_messages WHERE id = ? AND community_id = ?')
      .get(req.params.messageId, req.params.communityId) as any;
    if (!message) return res.status(404).json({ success: false, error: 'Message not found.' });

    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
    const allowed =
      message.sender_user_id === req.user!.id || canModerate(community, req.user!.id, req.user!.role);
    if (!allowed) return res.status(403).json({ success: false, error: 'You can only delete your own messages.' });

    db.prepare('UPDATE community_messages SET deleted_at = ?, body = ? WHERE id = ?').run(
      nowIso(),
      'This message was deleted.',
      message.id
    );

    writeAuditEvent({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'COMMUNITY_MESSAGE_DELETED',
      entityType: 'COMMUNITY',
      entityId: community.id,
      details: { messageId: message.id }
    });

    res.json({ success: true });
  });

  /**
   * Binary upload for a screenshot or a document. Raw body keeps the base64
   * overhead out of the request and out of the 1 MB JSON limit.
   */
  app.post(
    '/api/communities/:communityId/files',
    requireRole(ALL),
    express.raw({ type: 'application/octet-stream', limit: MAX_FILE_BYTES }),
    (req, res) => {
      const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.communityId) as any;
      if (!community) return res.status(404).json({ success: false, error: 'Community not found.' });
      if (!canSee(community, req.user!.id, req.user!.role)) {
        return res.status(403).json({ success: false, error: 'You are not a member of this community.' });
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buffer.length === 0) return res.status(400).json({ success: false, error: 'The file is empty.' });
      if (buffer.length > MAX_FILE_BYTES) {
        return res.status(413).json({ success: false, error: 'Keep files under 6 MB.' });
      }

      const mime = String(req.header('x-file-type') || 'application/octet-stream').toLowerCase();
      if (!ALLOWED_MIME.includes(mime)) {
        return res.status(400).json({ success: false, error: 'Images, PDF, Word, Excel and text files only.' });
      }

      const rawName = String(req.header('x-file-name') || 'file');
      const fileName = decodeURIComponent(rawName).replace(/[\\/\r\n"]/g, '_').slice(0, 160) || 'file';
      const fileId = newId('cf');
      const ext = path.extname(fileName).toLowerCase().slice(0, 10);
      const storagePath = path.join(UPLOAD_DIR, `${fileId}${ext}`);
      fs.writeFileSync(storagePath, buffer);

      db.prepare(
        `INSERT INTO community_files (id, community_id, uploader_id, file_name, mime_type, size_bytes, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(fileId, community.id, req.user!.id, fileName, mime, buffer.length, storagePath, nowIso());

      res.status(201).json({
        success: true,
        file: { id: fileId, name: fileName, mime, size: buffer.length, url: `/api/community-files/${fileId}` }
      });
    }
  );

  /** Served through the API, not statically, so a random URL cannot leak a file. */
  app.get('/api/community-files/:fileId', requireRole(ALL), (req, res) => {
    const file = db.prepare('SELECT * FROM community_files WHERE id = ?').get(req.params.fileId) as any;
    if (!file) return res.status(404).json({ success: false, error: 'File not found.' });

    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(file.community_id) as any;
    if (!canSee(community, req.user!.id, req.user!.role)) {
      return res.status(403).json({ success: false, error: 'You are not a member of this community.' });
    }
    if (!fs.existsSync(file.storage_path)) {
      return res.status(404).json({ success: false, error: 'That file is no longer on disk.' });
    }

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(file.storage_path).pipe(res);
  });
}
