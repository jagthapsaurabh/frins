import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  FileText,
  MessageSquareReply,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDate, timeAgo } from '../utils/dates';

interface Community {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  member_count: number;
  message_count: number;
  last_message: string | null;
  last_sender: string | null;
  last_message_at: string | null;
  unread: number;
  archived: number;
  can_manage: boolean;
  created_by_id: string;
}

interface Post {
  id: string;
  sender_user_id: string;
  sender_name: string;
  sender_role: string;
  parent_id: string | null;
  parent_body: string | null;
  parent_sender: string | null;
  body: string;
  file_id: string | null;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  deleted_at: string | null;
  mine: boolean;
}

const roleLabel = (role: string) =>
  role === 'LEARNER' ? 'Student' : role === 'GUIDE' ? 'Guide' : role === 'ADMIN' ? 'Admin' : 'Team';

const initialsOf = (name?: string) =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

const kb = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Files are behind auth, so an <img src> cannot fetch them directly. */
const useAuthedBlob = (url: string | null) => {
  const { authFetch } = useAuth();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!url) {
      setHref(null);
      return;
    }
    authFetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('nope'))))
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setHref(revoked);
      })
      .catch(() => setHref(null));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url, authFetch]);

  return href;
};

/**
 * Attachments are behind auth, so they cannot be a plain <img src>. One small
 * component per attachment owns its object URL and releases it on unmount.
 * Never mount it without a file: its hooks have to keep a stable order.
 */
const Attachment: React.FC<{ post: Post; onOpenImage: (src: string) => void }> = ({ post, onOpenImage }) => {
  const href = useAuthedBlob(post.file_url);
  if (!post.file_id) return null;

  const saveFile = () => {
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.download = post.file_name || 'file';
    link.click();
  };

  if ((post.mime_type || '').startsWith('image/')) {
    return href ? (
      <img
        className="post-image"
        src={href}
        alt={post.file_name || 'attachment'}
        onClick={() => onOpenImage(href)}
      />
    ) : (
      <span className="post-file">Loading image…</span>
    );
  }

  return (
    <button type="button" className="post-file" onClick={saveFile}>
      <FileText size={14} />
      {post.file_name || 'File'}
      {post.size_bytes ? <span style={{ color: '#667085' }}>· {kb(post.size_bytes)}</span> : null}
      <Download size={13} />
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* List                                                               */
/* ------------------------------------------------------------------ */

export const CommunityListPage: React.FC = () => {
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const base = user?.role === 'LEARNER' ? '/dashboard' : user?.role === 'GUIDE' ? '/guide' : '/admin';
  const canCreate = user?.role !== 'LEARNER';

  const [rows, setRows] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/communities');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load communities.');
      setRows(json.rows || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load communities.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Communities</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => navigate(`${base}/communities/new`)}>
              <Plus size={14} /> New community
            </button>
          )}
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <section className="panel-card" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '14px 16px', margin: 0 }}>
          <div>
            <h2>Your groups</h2>
            <p>Each group has one feed. Open one to read and post.</p>
          </div>
          <span className="section-note">{rows.length} total</span>
        </div>

        {loading ? (
          <p className="section-note" style={{ padding: 16 }}>Loading.</p>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16 }}>
            <div className="empty-state">
              <strong>No community yet</strong>
              {canCreate
                ? 'Create one and add the learners and guides who should be in it.'
                : 'Your mentor will add you to a group when one is ready.'}
            </div>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Community</th>
                  <th>Members</th>
                  <th>Posts</th>
                  <th>Last activity</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="clickable-row"
                    onClick={() => navigate(`${base}/communities/${row.id}`)}
                  >
                    <td>
                      <span className="row-title">
                        {row.name}
                        {row.unread > 0 && (
                          <span className="chat-unread" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                            {row.unread}
                          </span>
                        )}
                      </span>
                      <span className="row-sub">{row.last_message || row.description || 'No post yet'}</span>
                    </td>
                    <td className="num">{row.member_count}</td>
                    <td className="num">{row.message_count}</td>
                    <td className="row-sub" style={{ whiteSpace: 'nowrap' }}>
                      {row.last_message_at ? timeAgo(row.last_message_at) : '—'}
                    </td>
                    <td style={{ width: 28 }}>
                      <UsersRound size={14} color="#98A2B3" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Create                                                             */
/* ------------------------------------------------------------------ */

export const NewCommunityPage: React.FC = () => {
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const base = user?.role === 'GUIDE' ? '/guide' : '/admin';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('GENERAL');
  const [people, setPeople] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/admin/learners/directory')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => setPeople(json.rows || []))
      .catch(() => setPeople([]));
  }, [authFetch]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return people;
    return people.filter((p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term));
  }, [people, q]);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the community a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authFetch('/api/communities', {
      method: 'POST',
      body: JSON.stringify({ name, description, kind, memberIds: selected })
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not create the community.');
      return;
    }
    navigate(`${base}/communities/${json.communityId}`);
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate(`${base}/communities`)}>
        <ArrowLeft size={14} /> Communities
      </button>

      <div className="page-head">
        <div>
          <h1>Create a community</h1>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <form onSubmit={submit} className="form-layout">
        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Details</h2>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="community-name">Name</label>
            <input
              id="community-name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Batch 4: Nifty swing traders"
              maxLength={80}
              required
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="community-kind">Type</label>
              <select id="community-kind" className="form-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="GENERAL">General</option>
                <option value="BATCH">Batch</option>
                <option value="COURSE">Course group</option>
                <option value="TRACK">Track group</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="community-desc">What is it for</label>
              <input
                id="community-desc"
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One line the members will see."
              />
            </div>
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Members</h2>
              <p>You are added automatically. Pick everyone else now or later.</p>
            </div>
            <span className="section-note">{selected.length} selected</span>
          </div>

          <div className="search-field" style={{ marginBottom: 10 }}>
            <UsersRound size={14} />
            <input
              className="form-input"
              placeholder="Search learners"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search learners for the community"
            />
          </div>

          <div className="pick-list thin-scroll">
            {filtered.length === 0 && <p className="section-note">No learner matches that search.</p>}
            {filtered.map((person) => (
              <label key={person.id} className={`pick-row ${selected.includes(person.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(person.id)}
                  onChange={() => toggle(person.id)}
                />
                <span className="pick-avatar">{initialsOf(person.name)}</span>
                <span className="pick-text">
                  <strong>{person.name}</strong>
                  <small>{person.email}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`${base}/communities`)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create community'}
          </button>
        </div>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Room                                                               */
/* ------------------------------------------------------------------ */

export const CommunityRoomPage: React.FC = () => {
  const { communityId = '' } = useParams();
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const base = user?.role === 'LEARNER' ? '/dashboard' : user?.role === 'GUIDE' ? '/guide' : '/admin';
  const isStaff = user?.role !== 'LEARNER';

  const [community, setCommunity] = useState<Community | null>(null);
  const [counts, setCounts] = useState<{ members: number; posts: number }>({ members: 0, posts: 0 });
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [pendingFile, setPendingFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [metaRes, feedRes] = await Promise.all([
        authFetch(`/api/communities/${communityId}`),
        authFetch(`/api/communities/${communityId}/messages`)
      ]);
      const meta = await metaRes.json();
      const feed = await feedRes.json();
      if (!metaRes.ok || !meta.success) throw new Error(meta.error || 'Could not open this community.');
      if (!feedRes.ok || !feed.success) throw new Error(feed.error || 'Could not load the feed.');
      setCommunity(meta.community);
      setCounts({ members: (meta.members || []).length, posts: (feed.rows || []).length });
      setPosts(feed.rows || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not open this community.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, communityId]);

  useEffect(() => {
    load();
  }, [load]);

  // New posts arrive without a reload.
  useEffect(() => {
    const timer = setInterval(() => load(true), 12000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const node = feedRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [posts.length]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/communities/${communityId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Type': file.type || 'application/octet-stream'
        },
        body: file
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'That file could not be uploaded.');
      setPendingFile({ id: json.file.id, name: json.file.name, size: json.file.size });
    } catch (err: any) {
      setError(err?.message || 'That file could not be uploaded.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body && !pendingFile) return;
    setSending(true);
    setError(null);
    const res = await authFetch(`/api/communities/${communityId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        parentId: replyTo?.id || null,
        fileId: pendingFile?.id || null
      })
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not post that.');
      return;
    }
    setDraft('');
    setReplyTo(null);
    setPendingFile(null);
    await load(true);
    requestAnimationFrame(() => {
      const node = feedRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  };

  const removePost = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    await authFetch(`/api/communities/${communityId}/messages/${deleteTarget.id}`, { method: 'DELETE' });
    setDeleteBusy(false);
    setDeleteTarget(null);
    load(true);
  };

  const startReply = (post: Post) => {
    setReplyTo(post);
    composerRef.current?.focus();
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate(`${base}/communities`)}>
        <ArrowLeft size={14} /> Communities
      </button>

      <div className="page-head">
        <div>
          <h1>{community?.name || 'Community'}</h1>
        </div>
        <div className="page-head-actions">
          {community?.archived === 1 && <span className="micro-tag danger">Archived</span>}
          {isStaff && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`${base}/communities/${communityId}/members`)}
            >
              <UserPlus size={14} /> Members
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}

      <section className="panel-card community-room">
        <div className="community-feed thin-scroll" ref={feedRef}>
          {posts.length === 0 && !loading && (
            <div className="empty-state" style={{ margin: '24px auto', maxWidth: 420 }}>
              <strong>Nothing posted yet</strong>
              Say hello. Everyone in this community gets a notification.
            </div>
          )}

          {posts.map((post) => (
            <article key={post.id} className="post">
              <span className="post-avatar">{initialsOf(post.sender_name)}</span>
              <div className="post-body">
                <div className="post-head">
                  <span className="post-author">{post.mine ? 'You' : post.sender_name}</span>
                  <span className="post-role">{roleLabel(post.sender_role)}</span>
                  <span className="post-time">{timeAgo(post.created_at)}</span>
                </div>

                {post.parent_id && (
                  <div className="post-quote">
                    <strong>{post.parent_sender || 'Earlier message'}</strong>
                    {post.parent_body}
                  </div>
                )}

                {post.body && post.body !== 'This message was deleted.' && (
                  <div className="post-text">{post.body}</div>
                )}
                {post.body === 'This message was deleted.' && (
                  <div className="post-text" style={{ color: '#98A2B3', fontStyle: 'italic' }}>
                    This message was deleted.
                  </div>
                )}

                <Attachment post={post} onOpenImage={setLightbox} />

                {!post.deleted_at && (
                  <div className="post-tools">
                    <button type="button" className="post-tool" onClick={() => startReply(post)}>
                      <MessageSquareReply size={12} /> Reply
                    </button>
                    {(post.mine || community?.can_manage) && (
                      <button type="button" className="post-tool" onClick={() => setDeleteTarget(post)}>
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="community-composer">
          {replyTo && (
            <div className="composer-quote">
              <span>
                Replying to <strong>{replyTo.mine ? 'yourself' : replyTo.sender_name}</strong>:{' '}
                {replyTo.body.slice(0, 90) || 'file'}
              </span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X size={13} />
              </button>
            </div>
          )}

          {pendingFile && (
            <div className="file-chip">
              <Paperclip size={12} /> {pendingFile.name} · {kb(pendingFile.size)}
              <button type="button" onClick={() => setPendingFile(null)} aria-label="Remove attachment">
                <X size={12} />
              </button>
            </div>
          )}

          <form className="composer-row" onSubmit={send}>
            <button
              type="button"
              className="composer-attach"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || community?.archived === 1}
              title="Attach a file or screenshot"
              aria-label="Attach a file or screenshot"
            >
              {uploading ? <RefreshCw size={14} className="spin" /> : <Paperclip size={14} />}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <textarea
              ref={composerRef}
              className="form-textarea"
              rows={1}
              placeholder={community?.archived === 1 ? 'This community is archived' : 'Write a message. Ctrl + Enter sends.'}
              value={draft}
              disabled={community?.archived === 1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label="Write a message"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || uploading || community?.archived === 1 || (!draft.trim() && !pendingFile)}
            >
              <Send size={14} /> Send
            </button>
          </form>
          <p className="form-hint" style={{ marginTop: 6 }}>
            Images, PDF, Word and Excel up to 6 MB. Everyone in the group is notified.
          </p>
        </div>
      </section>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <img src={lightbox} alt="Attachment" />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this message?"
        message="It will show as deleted for everyone in the community. Replies stay."
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={removePost}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Members                                                            */
/* ------------------------------------------------------------------ */

export const CommunityMembersPage: React.FC = () => {
  const { communityId = '' } = useParams();
  const { authFetch, user } = useAuth();
  const navigate = useNavigate();
  const base = user?.role === 'GUIDE' ? '/guide' : '/admin';

  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    const [metaRes, dirRes] = await Promise.all([
      authFetch(`/api/communities/${communityId}`),
      authFetch('/api/admin/learners/directory')
    ]);
    const meta = await metaRes.json();
    if (metaRes.ok && meta.success) {
      setCommunity(meta.community);
      setMembers(meta.members || []);
      setName(meta.community.name);
      setDescription(meta.community.description || '');
    }
    const dir = await dirRes.json();
    setPeople(dir.rows || []);
  }, [authFetch, communityId]);

  useEffect(() => {
    load();
  }, [load]);

  const memberIds = members.map((m) => m.user_id);
  const candidates = people.filter((p) => !memberIds.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase()));

  const addSelected = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    const res = await authFetch(`/api/communities/${communityId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds: selected })
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok || !json.success) {
      setError(json.error || 'Could not add those people.');
      return;
    }
    setSelected([]);
    setBanner(`${json.added} ${json.added === 1 ? 'person' : 'people'} added and notified.`);
    load();
  };

  const removeMember = async () => {
    if (!removeTarget) return;
    setBusy(true);
    await authFetch(`/api/communities/${communityId}/members/${removeTarget.user_id}`, { method: 'DELETE' });
    setBusy(false);
    setRemoveTarget(null);
    load();
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await authFetch(`/api/communities/${communityId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, description })
    });
    setBusy(false);
    setBanner(res.ok ? 'Details saved.' : 'Could not save the details.');
  };

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    await authFetch(`/api/communities/${communityId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived })
    });
    setBusy(false);
    load();
  };

  return (
    <div>
      <button type="button" className="back-link" onClick={() => navigate(`${base}/communities/${communityId}`)}>
        <ArrowLeft size={14} /> Back to the feed
      </button>

      <div className="page-head">
        <div>
          <h1>Members and settings</h1>
        </div>
        <div className="page-head-actions">
          {community && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setArchived(community.archived !== 1)}
              disabled={busy}
            >
              {community.archived === 1 ? 'Reopen community' : 'Archive community'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="governance-alert danger">{error}</div>}
      {banner && <div className="governance-alert success">{banner}</div>}

      <div className="members-layout">
        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Add people</h2>
              <p>Learners and guides get a notification when you add them.</p>
            </div>
          </div>

          <div className="search-field" style={{ marginBottom: 10 }}>
            <UsersRound size={14} />
            <input
              className="form-input"
              placeholder="Search learners"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search learners to add"
            />
          </div>

          <div className="pick-list thin-scroll" style={{ maxHeight: 260 }}>
            {candidates.length === 0 && <p className="section-note">Everyone matching that is already in.</p>}
            {candidates.map((person) => (
              <label key={person.id} className={`pick-row ${selected.includes(person.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(person.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(person.id) ? current.filter((x) => x !== person.id) : [...current, person.id]
                    )
                  }
                />
                <span className="pick-avatar">{initialsOf(person.name)}</span>
                <span className="pick-text">
                  <strong>{person.name}</strong>
                  <small>{person.email}</small>
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 10 }}
            onClick={addSelected}
            disabled={busy || selected.length === 0}
          >
            <UserPlus size={14} /> Add {selected.length > 0 ? selected.length : ''}
          </button>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>In this community</h2>
            </div>
            <span className="section-note">{members.length}</span>
          </div>

          <div className="list-stack">
            {members.map((member) => (
              <div className="list-row" key={member.user_id}>
                <span className="pick-avatar">{initialsOf(member.name)}</span>
                <div className="list-row-main">
                  <Link to={member.user_role === 'LEARNER' ? `/admin/learners/${member.user_id}` : '#'} className="list-row-title">
                    {member.name}
                  </Link>
                  <span className="list-row-sub">
                    {roleLabel(member.user_role)} · joined {formatDate(member.joined_at)}
                  </span>
                </div>
                {member.role === 'MODERATOR' ? (
                  <span className="micro-tag accent">Owner</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRemoveTarget(member)}
                    aria-label={`Remove ${member.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-head">
            <div>
              <h2>Details</h2>
            </div>
          </div>
          <form onSubmit={saveDetails}>
            <div className="form-group">
              <label className="form-label" htmlFor="edit-name">Name</label>
              <input id="edit-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="edit-desc">Description</label>
              <input
                id="edit-desc"
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Save details
            </button>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove from the community?"
        message={removeTarget ? `${removeTarget.name} will lose access to this feed.` : ''}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={removeMember}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
};
